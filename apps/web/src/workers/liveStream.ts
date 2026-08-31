/**
 * The realtime call engine: where a telephony vendor's forked call audio
 * becomes live coaching.
 *
 *   vendor media WS ──► per-track streaming STT ──► transcript append
 *        │                                              │
 *        └── token auth (per call)                      ├─► redis pub/sub ──► the live SSE
 *                                                       ├─► heuristics + stage per segment
 *                                                       └─► model coach tick every Nth customer turn
 *
 * Runs in the worker process because a WebSocket server cannot live in Next's
 * route handlers, and the worker already owns everything asynchronous. The
 * browser is only a display: it subscribes to the same SSE the demo transport
 * feeds, and never touches audio.
 *
 * Failure posture: a call must never be harmed by its coaching. STT missing or
 * erroring publishes a visible notice and swallows the audio; every DB write is
 * per-segment and idempotent-enough (append) that a dropped socket loses at
 * most one sentence; finalisation runs the same claim-guarded analyse → audit
 * chain the other transports use, so racing the telephony webhook is safe.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { connectionCredentials } from '@/lib/integrations/connection';
import { parseStreamMessage, verifyStreamToken, liveChannel } from '@/lib/integrations/telephony/stream';
import { openLiveStt, type LiveSttFactory, type LiveSttConnection } from '@/lib/integrations/transcriptionStream';
import { coachTick, heuristicHints, nextBestQuestion, detectStage } from '@/lib/ai/liveCoach';
import {
  leadCallContext,
  contextPromptBlock,
  budgetMatchHint,
  type LeadCallContext,
} from '@/services/leads/callContext';
import { analyseAndAudit } from '@/services/shared/callIntelligence';

interface Session {
  tenantId: string;
  callId: string;
  startedAt: number;
  lines: string[];
  customerTurns: number;
  stage: string;
  context: LeadCallContext | null;
  contextBlock?: string;
  stt: Partial<Record<'inbound' | 'outbound', LiveSttConnection>>;
  finalised: boolean;
  budgetHinted: boolean;
}

const publish = (callId: string, event: Record<string, unknown>) =>
  redis.publish(liveChannel(callId), JSON.stringify(event)).catch(() => undefined);

async function appendTranscript(session: Session, line: string) {
  const content = session.lines.join('\n');
  await prisma.transcript
    .upsert({
      where: { callId: session.callId, tenantId: session.tenantId },
      create: {
        tenantId: session.tenantId,
        callId: session.callId,
        content,
        language: 'en',
        provider: 'live-stream',
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
      update: { content, provider: 'live-stream', wordCount: content.split(/\s+/).filter(Boolean).length },
    })
    .catch((err) => logger.warn({ err: err.message, line }, 'live transcript write failed'));
}

async function onSegment(session: Session, speaker: 'Agent' | 'Customer', text: string) {
  const at = Math.round((Date.now() - session.startedAt) / 1000);
  session.lines.push(`${speaker}: ${text}`);
  await appendTranscript(session, text);
  await publish(session.callId, { type: 'segment', speaker, text, at });

  if (speaker !== 'Customer') return;
  session.customerTurns += 1;

  const window = session.lines.slice(-8).join('\n');
  const stage = detectStage(window, session.lines.length);
  if (stage !== session.stage) {
    session.stage = stage;
    await publish(session.callId, { type: 'stage', stage, at });
  }

  for (const hint of heuristicHints(text)) await publish(session.callId, { type: 'coach', ...hint, at });

  // Budget just stated → re-query the live book on the spot, once per call.
  if (!session.budgetHinted) {
    const match = await budgetMatchHint(session.tenantId, text).catch(() => null);
    if (match) {
      session.budgetHinted = true;
      await publish(session.callId, { type: 'coach', ...match, at });
    }
  }

  if (session.customerTurns % 4 === 0) {
    // Fire-and-forget: a slow model must not back-pressure the audio path.
    void coachTick(window, session.tenantId, session.contextBlock)
      .then(async (hints) => {
        for (const hint of hints.filter((h) => h.source === 'gemini')) {
          await publish(session.callId, { type: 'coach', ...hint, at });
        }
      })
      .catch(() => undefined);
  }
}

async function finalise(session: Session) {
  if (session.finalised) return;
  session.finalised = true;
  await Promise.all(Object.values(session.stt).map((conn) => conn?.close()));
  if (session.lines.length === 0) {
    await publish(session.callId, { type: 'done', callId: session.callId });
    return;
  }
  await publish(session.callId, { type: 'status', status: 'WRAPPING_UP' });
  // Claim-guarded, so racing the telephony webhook's own chain double-runs nothing.
  await analyseAndAudit(session.tenantId, session.callId).catch((err) =>
    logger.error({ err: (err as Error).message, callId: session.callId }, 'live stream finalise analysis failed'),
  );
  await publish(session.callId, { type: 'done', callId: session.callId });
}

async function openSession(
  msg: {
    tenantId: string;
    callId: string;
    token: string;
    mediaFormat: { sampleRate: number };
  },
  stt: LiveSttFactory,
): Promise<Session | { refused: string }> {
  if (!msg.tenantId || !msg.callId || !verifyStreamToken(msg.tenantId, msg.callId, msg.token)) {
    return { refused: 'bad token' };
  }

  const call = await prisma.call.findFirst({
    where: { id: msg.callId, tenantId: msg.tenantId, deletedAt: null },
    select: { id: true, leadId: true, status: true },
  });
  if (!call || !['RINGING', 'IN_PROGRESS'].includes(call.status)) return { refused: 'call not live' };

  // Same rule as every other transport: no consent, no processing.
  const consent = await prisma.recordingConsent.findFirst({
    where: { callId: call.id, tenantId: msg.tenantId },
  });
  if (!consent?.consentGiven || consent.withdrawnAt) return { refused: 'no consent' };

  const credentials = await connectionCredentials(msg.tenantId, 'transcription').catch(() => null);
  // Admin-typed provider names ("Deepgram", "deepgram") match case-insensitively,
  // same as getTranscriptionProvider.
  if (credentials?.provider?.trim().toLowerCase() !== 'deepgram' || !credentials.apiKey) {
    await publish(msg.callId, {
      type: 'error',
      message: 'Live coaching needs a connected Deepgram speech-to-text key (Administration → Integrations).',
    });
    return { refused: 'no streaming STT' };
  }
  const apiKey = String(credentials.apiKey);

  const context = call.leadId ? await leadCallContext(msg.tenantId, call.leadId).catch(() => null) : null;
  const session: Session = {
    tenantId: msg.tenantId,
    callId: msg.callId,
    startedAt: Date.now(),
    lines: [],
    customerTurns: 0,
    stage: 'INTRODUCTION',
    context,
    contextBlock: context ? contextPromptBlock(context) : undefined,
    stt: {},
    finalised: false,
    budgetHinted: false,
  };

  // One STT connection per track keeps attribution exact: 'inbound' is the
  // agent's own audio on the leg Twilio dialled; 'outbound' is what the agent
  // hears — the customer.
  for (const [track, speaker] of [
    ['inbound', 'Agent'],
    ['outbound', 'Customer'],
  ] as const) {
    session.stt[track] = stt({
      apiKey,
      sampleRate: msg.mediaFormat.sampleRate,
      onTranscript: (text) => void onSegment(session, speaker, text),
      onError: (err) => logger.warn({ err: err.message, track, callId: msg.callId }, 'live STT error'),
    });
  }

  await publish(msg.callId, { type: 'status', status: 'IN_PROGRESS' });
  const opener = nextBestQuestion(session.context?.requirement ?? null);
  await publish(msg.callId, { type: 'coach', kind: 'ASK', ...opener, source: 'simulated', at: 0 });

  return session;
}

export function startLiveStreamServer(stt: LiveSttFactory = openLiveStt, port = env.LIVE_STREAM_PORT) {
  const server = new WebSocketServer({ port, path: '/twilio-media' });

  server.on('connection', (socket: WebSocket) => {
    let session: Session | null = null;

    socket.on('message', (raw) => {
      void (async () => {
        let msg;
        try {
          msg = parseStreamMessage(raw.toString());
        } catch {
          socket.close(1008, 'malformed message');
          return;
        }

        if (msg.event === 'start') {
          const opened = await openSession(msg, stt);
          if ('refused' in opened) {
            logger.warn({ reason: opened.refused }, 'live stream refused');
            socket.close(1008, opened.refused);
            return;
          }
          session = opened;
          logger.info({ callId: session.callId }, 'live stream attached');
        } else if (msg.event === 'media' && session) {
          session.stt[msg.track]?.sendAudio(msg.payload);
        } else if (msg.event === 'stop' && session) {
          await finalise(session);
          socket.close(1000);
        }
      })();
    });

    socket.on('close', () => {
      if (session) void finalise(session);
    });
    socket.on('error', () => socket.close());
  });

  server.on('listening', () => logger.info({ port }, 'realtime call engine listening'));
  return server;
}
