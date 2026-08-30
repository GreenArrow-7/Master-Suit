import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Forbidden, Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { logger } from '@/lib/logger';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getTranscriptionProvider, transcriptionProviderFor } from '@/lib/integrations/transcription';
import { coachTick, heuristicHints, detectStage, type CoachHint } from '@/lib/ai/liveCoach';
import { leadCallContext, contextPromptBlock } from '@/services/leads/callContext';
import { analyseAndAudit } from '@/services/shared/callIntelligence';

const params = z.object({ id: z.string().cuid() });
const query = z
  .object({
    /** BCP-47-ish language hint passed straight to the STT provider. */
    language: z.string().max(12).optional(),
    /** Set on chunks where the client wants a model coach tick, not just heuristics. */
    tick: z.coerce.boolean().default(false),
    /** The last chunk: finalise the call and run analyse → audit inline. */
    final: z.coerce.boolean().default(false),
  })
  .strict();

/**
 * The real-call live transport: the browser microphone, five seconds at a time.
 *
 * The agent takes the call on their phone with the workspace open; the browser
 * records short standalone chunks and posts them here. Each chunk goes through
 * the workspace's connected speech-to-text provider, lands on the call's
 * Transcript row, and comes back with coaching — heuristics instantly, the
 * model on ticks. Audio is transcribed and discarded, never stored.
 *
 * This is deliberately not vendor media streaming: it needs no telephony
 * change, works with the batch STT already connected, and its ~5–8s latency is
 * honest. A vendor's live stream plugs into the same downstream (transcript
 * append → hints → finalise) when that project lands.
 *
 * Consent is a precondition, same as the recording upload route: processing
 * call audio without recorded consent is the thing the consent table exists to
 * prevent, and the workspace records it before the first chunk.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, query },
  async ({ ctx, params, query, req }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');
    const scope = scopeFor(ctx, 'calls', 'EDIT');
    if (call.callerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Call');

    const consent = await prisma.recordingConsent.findFirst({
      where: { callId: call.id, tenantId: ctx.tenantId },
    });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('Record consent before streaming call audio.');
    }

    // ── Finalise ─────────────────────────────────────────────────────────────
    if (query.final) {
      const endedAt = new Date();
      const startedAt = call.startedAt ?? endedAt;
      await prisma.call.update({
        where: { id: call.id, tenantId: ctx.tenantId },
        data: {
          status: 'COMPLETED',
          endedAt,
          durationSecs: Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
          outcome: call.outcome ?? 'CONNECTED',
        },
      });
      const transcript = await prisma.transcript.findFirst({
        where: { callId: call.id, tenantId: ctx.tenantId },
        select: { content: true },
      });
      if (transcript?.content) {
        await analyseAndAudit(ctx.tenantId, call.id).catch((err) =>
          logger.error({ err: (err as Error).message, callId: call.id }, 'live-mic finalise analysis failed'),
        );
      }
      return { done: true };
    }

    // ── One audio chunk ──────────────────────────────────────────────────────
    const audio = Buffer.from(await req.arrayBuffer());
    if (audio.length < 1000) return { text: '', hints: [], stage: null };
    if (audio.length > 5_000_000) {
      throw Invalid([{ field: 'body', code: 'too_large', message: 'Audio chunk exceeds 5MB.' }]);
    }

    const credentials = await connectionCredentials(ctx.tenantId, 'transcription');
    const providerKey = transcriptionProviderFor(credentials);
    if (!providerKey) {
      throw Invalid([
        {
          field: 'provider',
          code: 'not_connected',
          message: 'Connect a speech-to-text provider under Administration → Integrations for live coaching.',
        },
      ]);
    }

    if (['SCHEDULED', 'RINGING'].includes(call.status)) {
      const startedAt = new Date();
      await prisma.call.update({
        where: { id: call.id, tenantId: ctx.tenantId },
        data: { status: 'IN_PROGRESS', startedAt, answeredAt: startedAt, providerName: 'live-mic' },
      });
    }

    const result = await getTranscriptionProvider(providerKey, credentials ?? {}).transcribe({
      audio,
      mimeType: req.headers.get('content-type') ?? 'audio/webm',
      language: query.language ?? 'en',
    });
    const text = result.text?.trim() ?? '';

    let windowText = text;
    if (text) {
      // Appended, not replaced: the row is the rolling transcript of this call.
      const existing = await prisma.transcript.findFirst({
        where: { callId: call.id, tenantId: ctx.tenantId },
        select: { content: true },
      });
      const content = existing?.content ? `${existing.content}\n${text}` : text;
      await prisma.transcript.upsert({
        where: { callId: call.id, tenantId: ctx.tenantId },
        create: {
          tenantId: ctx.tenantId,
          callId: call.id,
          content,
          language: query.language ?? 'en',
          provider: 'live-mic',
          wordCount: content.split(/\s+/).filter(Boolean).length,
        },
        update: { content, provider: 'live-mic', wordCount: content.split(/\s+/).filter(Boolean).length },
      });
      windowText = content.split('\n').slice(-8).join('\n');
    }

    let hints: CoachHint[] = text ? heuristicHints(text) : [];
    if (query.tick && windowText) {
      const context = call.leadId ? await leadCallContext(ctx.tenantId, call.leadId).catch(() => null) : null;
      const modelHints = await coachTick(windowText, ctx.tenantId, context ? contextPromptBlock(context) : undefined);
      hints = [...hints, ...modelHints.filter((h) => h.source === 'gemini')].slice(0, 3);
    }

    return {
      text,
      hints,
      stage: windowText ? detectStage(windowText, windowText.split('\n').length) : null,
    };
  },
);
