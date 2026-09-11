import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { assertSensitiveAccess } from '@/lib/auth/sensitive-access';
import { logger } from '@/lib/logger';
import { NotFound, Forbidden, Invalid } from '@/lib/errors';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { analyseAndAudit } from '@/services/shared/callIntelligence';
import { connectionCredentials } from '@/lib/integrations/connection';
import { transcriptionProviderFor } from '@/lib/integrations/transcription';

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

/**
 * The text of a client's conversation, and — now — a record of who read it.
 *
 * This declared no `auditEvent` while both of its siblings did: the recording
 * metadata route and the media stream each write `RECORDING_ACCESSED`. The
 * transcript is the same conversation in a form that is easier to read, search
 * and copy, so the one of the three that left no trail was the one that cost
 * least to abuse.
 *
 * `DOCUMENT_ACCESSED` rather than a new enum value: it is the event this
 * codebase already uses for reading a stored artefact — `payslipDetail` and the
 * HR document download both write it — and adding an enum member is a migration
 * on the audit table for no distinction a reader needs. `objectType` is `calls`
 * and the metadata carries the path, so a transcript read is separable from a
 * recording read by the query that would ask.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'DOCUMENT_ACCESSED' },
  async ({ ctx, params }) => {
    await assertSensitiveAccess(ctx, 'call transcripts');
    const transcript = await prisma.transcript.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!transcript) throw NotFound('Transcript');
    return transcript;
  },
);
