import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { demoScript, coachTick, heuristicHints, nextBestQuestion, detectStage } from '@/lib/ai/liveCoach';
import { leadCallContext, contextPromptBlock, budgetMatchHint } from '@/services/leads/callContext';
import { analyseAndAudit } from '@/services/shared/callIntelligence';
import { liveChannel } from '@/lib/integrations/telephony/stream';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * Relay mode: the call is live at a telephony vendor and the realtime engine
 * (worker process) is producing segments, hints and stage changes onto this
 * call's redis channel. The SSE here only forwards — the browser never touches
 * audio, and closing the tab stops nothing but the display.
 */
function relayStream(callId: string, initialStatus: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: 'status', status: initialStatus, transport: 'vendor-stream' });

      const subscriber = redis.duplicate();
      // SSE needs periodic bytes or proxies reap the connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': hb\n\n'));
        } catch {
          /* closing */
        }
      }, 15_000);

      const stop = async () => {
        clearInterval(heartbeat);
        await subscriber.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      subscriber.on('message', (_channel: string, message: string) => {
        try {
          send(JSON.parse(message));
          if ((JSON.parse(message) as { type?: string }).type === 'done') void stop();
        } catch {
          /* skip malformed event */
        }
      });
      await subscriber.subscribe(liveChannel(callId)).catch(() => void stop());
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

const params = z.object({ id: z.string().cuid() });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The live-call stream: Server-Sent Events carrying transcript segments,
 * coaching hints and status changes for the live workspace.
 *
 * Today the only transport is the demo simulation — a scripted conversation
 * replayed in real time, coached by Gemini when GEMINI_API_KEY is set and by
 * the built-in heuristics otherwise. A telephony vendor's media stream would
 * plug in at the same seam: replace the script iterator with the vendor's
 * streaming-STT segments and everything downstream (coach ticks, finalise,
 * analysis, audit) is already wired.
 *
 * Finalisation is idempotent and runs on script completion or client abort:
 * the call is marked COMPLETED with its duration, the transcript is stored,
 * and the standard analyse → audit chain runs inline so the workspace shows a
 * full call audit moments after hanging up, without requiring a worker.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params },
  async ({ ctx, params, req }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    const scope = scopeFor(ctx, 'calls', 'EDIT');
    if (call.callerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Call');

    if (!['SCHEDULED', 'RINGING', 'IN_PROGRESS'].includes(call.status)) {
      throw Invalid([
        { field: 'status', code: 'not_live', message: `A ${call.status.toLowerCase()} call has no live session.` },
      ]);
    }

    // A call placed through a real telephony vendor is fed by the realtime
    // engine, not by the demo script — this SSE only relays its events.
    if (call.externalCallId && call.providerName && !['demo-simulation', 'live-mic'].includes(call.providerName)) {
      return relayStream(call.id, call.status);
    }

    // The lead context is loaded once per session and carried on every coach
    // tick — the AI never operates without CRM context when context exists.
    const [context, agent] = await Promise.all([
      call.leadId ? leadCallContext(ctx.tenantId, call.leadId).catch(() => null) : null,
      prisma.user.findFirst({ where: { tenantId: ctx.tenantId, id: call.callerId }, select: { fullName: true } }),
    ]);
    const lead = context?.lead ?? null;
    const contextBlock = context ? contextPromptBlock(context) : undefined;

    // The demo session assumes verbal consent, records that assumption, and
    // says so in the workspace banner. Real vendors go through the existing
    // consent endpoints before dialling.
    await prisma.recordingConsent.upsert({
      where: { callId: call.id, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId: call.id,
        consentGiven: true,
        method: 'VERBAL',
        consentedBy: 'Demo simulation — verbal consent assumed at session start',
        givenAt: new Date(),
      },
      update: {},
    });

    const startedAt = new Date();
    await prisma.call.update({
      where: { id: call.id, tenantId: ctx.tenantId },
      data: { status: 'IN_PROGRESS', startedAt, answeredAt: startedAt, providerName: 'demo-simulation' },
    });

    const script = demoScript(agent?.fullName ?? 'The agent', lead?.fullName ?? 'the client');
    const tenantId = ctx.tenantId;
    const callId = call.id;

    let finalised = false;
    let stage: string = 'INTRODUCTION';
    let budgetHinted = false;
    const spoken: string[] = [];

    async function finalise(reason: 'completed' | 'aborted') {
      if (finalised) return;
      finalised = true;
      try {
        const endedAt = new Date();
        const durationSecs = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
        const content = spoken.join('\n');

        await prisma.call.update({
          where: { id: callId, tenantId },
          data: {
            status: 'COMPLETED',
            endedAt,
            durationSecs,
            ...(reason === 'completed' ? { outcome: 'CONNECTED' } : {}),
          },
        });

        if (content.length > 0) {
          await prisma.transcript.upsert({
            where: { callId, tenantId },
            create: {
              tenantId,
              callId,
              content,
              language: 'en',
              provider: 'demo-simulation',
              wordCount: content.split(/\s+/).filter(Boolean).length,
            },
            update: { content, provider: 'demo-simulation', wordCount: content.split(/\s+/).filter(Boolean).length },
          });

          // Inline analyse → audit: no worker required for the demo loop, and
          // both steps are claim-guarded so a running worker cannot double-fire.
          await analyseAndAudit(tenantId, callId);
        }
      } catch (err) {
        logger.error({ err: (err as Error).message, callId }, 'live call finalise failed');
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const aborted = () => req.signal.aborted;
        req.signal.addEventListener('abort', () => void finalise('aborted'));

        send({ type: 'status', status: 'IN_PROGRESS', startedAt: startedAt.toISOString() });
        send({
          type: 'coach',
          kind: 'COMPLIANCE',
          text: 'Open with the recording disclosure, your name and the reason for the call.',
          source: 'simulated',
          at: 0,
        });
        // The opening move: the single most useful question, from what the CRM
        // already knows about this lead. Deterministic — no provider needed.
        const opener = nextBestQuestion(context?.requirement ?? null);
        send({ type: 'coach', kind: 'ASK', text: opener.text, why: opener.why, source: 'simulated', at: 0 });

        try {
          for (let i = 0; i < script.length; i++) {
            if (aborted()) break;

            const turn = script[i];
            // Reading pace: proportional to line length, clamped to feel live.
            await sleep(Math.min(4200, Math.max(1500, turn.text.length * 45)));
            if (aborted()) break;

            const at = Math.round((Date.now() - startedAt.getTime()) / 1000);
            spoken.push(`${turn.speaker}: ${turn.text}`);
            send({ type: 'segment', speaker: turn.speaker, text: turn.text, at });

            // Coach after each customer turn, on a rolling window. Heuristics
            // answer instantly; Gemini (when configured) adds model hints.
            if (turn.speaker === 'Customer') {
              const window = spoken.slice(-6).join('\n');
              // The sales-stage chip: recomputed per customer turn, sent on change.
              const nowStage = detectStage(window, spoken.length);
              if (nowStage !== stage) {
                stage = nowStage;
                send({ type: 'stage', stage, at });
              }
              const instant = heuristicHints(turn.text);
              for (const hint of instant) send({ type: 'coach', ...hint, at });
              // A budget just stated re-queries the live book on the spot; once
              // per call, or the same recommendation nags every restatement.
              if (!budgetHinted) {
                const match = await budgetMatchHint(ctx.tenantId, turn.text).catch(() => null);
                if (match) {
                  budgetHinted = true;
                  send({ type: 'coach', ...match, at });
                }
              }
              // The workspace's own key when it has one, the deployment's
              // otherwise — `coachTick` degrades to heuristics with neither.
              if (i % 4 === 3) {
                const hints = await coachTick(window, ctx.tenantId, contextBlock);
                for (const hint of hints.filter((h) => h.source === 'gemini')) send({ type: 'coach', ...hint, at });
              }
            }
          }

          if (!aborted()) {
            send({ type: 'status', status: 'WRAPPING_UP' });
            await finalise('completed');
            send({ type: 'done', callId });
          }
        } catch (err) {
          logger.error({ err: (err as Error).message, callId }, 'live call stream error');
          await finalise('aborted');
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed by abort */
          }
        }
      },
      cancel() {
        void finalise('aborted');
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  },
);
