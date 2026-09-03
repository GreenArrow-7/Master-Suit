import type { TranscriptionState } from '@prisma/client';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFound, Forbidden, Invalid } from '@/lib/errors';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { analyseAndAudit } from '@/services/shared/callIntelligence';
import { connectionCredentials } from '@/lib/integrations/connection';
import { transcriptionProviderFor } from '@/lib/integrations/transcription';
import { requireVisibleCall } from '@/services/crm/callVisibility';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    /**
     * Omit to transcribe the stored recording with the tenant's speech-to-text
     * provider, which happens on the `ai` queue. Supplied text still wins, so an
     * externally produced transcript or a human correction can be posted
     * directly — and that path stays synchronous, because storing text the
     * caller already holds costs nothing.
     */
    content: z.string().min(1).max(500_000).optional(),
    language: z.string().max(10).default('en'),
    provider: z.string().max(50).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    await requireVisibleCall(ctx, params.id);
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    // Checked before any audio is read or sent anywhere: withdrawn consent must
    // stop the transcription too, not only the storing of its result.
    const consent = await prisma.recordingConsent.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('Cannot store transcript without active recording consent.');
    }

    if (!body.content) {
      const recording = await prisma.recording.findFirst({
        where: { callId: params.id, tenantId: ctx.tenantId },
      });
      if (!recording) throw NotFound('Recording — upload a recording or post transcript text directly');
      if (recording.storageBucket === 'provider') {
        throw Invalid([
          {
            field: 'recording',
            code: 'not_ingested',
            message: 'The recording is still transferring from the telephony provider. Try again shortly.',
          },
        ]);
      }

      const credentials = await connectionCredentials(ctx.tenantId, 'transcription');
      if (!transcriptionProviderFor(credentials)) {
        throw Invalid([
          {
            field: 'integration',
            code: 'not_connected',
            message: 'Connect a speech-to-text provider, or post the transcript text directly.',
          },
        ]);
      }

      await enqueue(
        'ai',
        'transcribe',
        { tenantId: ctx.tenantId, callId: params.id, language: body.language },
        { fresh: true },
      );
      return { callId: params.id, status: 'QUEUED' };
    }

    const { content, language, provider, confidence } = body;
    const transcript = await prisma.transcript.upsert({
      where: { callId: params.id, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId: params.id,
        content,
        language,
        provider,
        confidence,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
      update: {
        content,
        language,
        provider,
        confidence,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
    });

    // A transcript arriving by any route starts the same chain. Otherwise a
    // workspace pasting transcripts from its own recorder would get no summary,
    // no audit and no coaching — the whole point of the transcript.
    if (await queueHasWorkers('ai')) {
      await enqueue('ai', 'analyse', { tenantId: ctx.tenantId, callId: params.id });
    } else {
      const tenantId = ctx.tenantId;
      const callId = params.id;
      void analyseAndAudit(tenantId, callId).catch((err) =>
        logger.error({ err: (err as Error).message, callId }, 'inline analysis chain failed'),
      );
    }
    return transcript;
  },
);

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    await requireVisibleCall(ctx, params.id);
    const transcript = await prisma.transcript.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!transcript) {
      /**
       * Still a 404 — there is no transcript — but it says which of the four
       * reasons applies. A bare "Transcript not found" answered identically for
       * a job still queued, a recording nobody consented to, and four spent
       * attempts against a vendor that is down, which left the caller to guess.
       */
      const call = await prisma.call.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId },
        select: { transcriptionState: true, transcriptionDetail: true, transcriptionAttempts: true },
      });
      throw NotFound(call ? `Transcript — ${describeTranscription(call)}` : 'Transcript');
    }
    return transcript;
  },
);

/**
 * The transcription state as a sentence, for the 404 a reader gets instead of a
 * transcript. Deliberately in the response rather than only in a log: the person
 * who needs it is looking at a call screen, not at Loki.
 */
function describeTranscription(call: {
  transcriptionState: TranscriptionState;
  transcriptionDetail: string | null;
  transcriptionAttempts: number;
}): string {
  const because = call.transcriptionDetail ? `: ${call.transcriptionDetail}` : '';
  switch (call.transcriptionState) {
    case 'READY':
      // A transcript that is READY but absent means somebody deleted the row.
      return `it was transcribed, but the transcript is gone${because}`;
    case 'RETRYING':
      return `transcription failed and will be retried (attempt ${call.transcriptionAttempts})${because}`;
    case 'FAILED':
      return `transcription failed after ${call.transcriptionAttempts} attempt${call.transcriptionAttempts === 1 ? '' : 's'}${because}`;
    case 'SKIPPED':
      return `this call was not transcribed${because}`;
    case 'PENDING':
    default:
      return 'transcription has not run yet';
  }
}
