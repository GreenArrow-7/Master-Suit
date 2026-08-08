import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Forbidden, Invalid } from '@/lib/errors';
import { connectionCredentials } from '@/lib/integrations/connection';
import { getTranscriptionProvider } from '@/lib/integrations/transcription';
import { getObject } from '@/lib/storage';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    /**
     * Omit to transcribe the stored recording with the tenant's speech-to-text
     * provider. Supplied text still wins, so an externally produced transcript
     * or a human correction can be posted directly.
     */
    content: z.string().min(1).max(500_000).optional(),
    language: z.string().max(10).default('en'),
    provider: z.string().max(50).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Telephony webhooks store a provider URL; uploads store an object key. */
async function readAudio(storageKey: string): Promise<Buffer> {
  if (/^https:\/\//i.test(storageKey)) {
    const res = await fetch(storageKey);
    if (!res.ok) throw new Error(`Recording fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return getObject(storageKey);
}

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!call) throw NotFound('Call');

    // Checked before any audio is read or sent anywhere: withdrawn consent must
    // stop the transcription too, not only the storing of its result.
    const consent = await prisma.recordingConsent.findUnique({ where: { callId: params.id } });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('Cannot store transcript without active recording consent.');
    }

    let { content, provider, confidence } = body;
    const { language } = body;

    if (!content) {
      const recording = await prisma.recording.findFirst({
        where: { callId: params.id, tenantId: ctx.tenantId },
      });
      if (!recording) throw NotFound('Recording — upload a recording or post transcript text directly');

      const credentials = await connectionCredentials(ctx.tenantId, 'transcription');
      if (!credentials?.provider) {
        throw Invalid([
          {
            field: 'integration',
            code: 'not_connected',
            message: 'Connect a speech-to-text provider, or post the transcript text directly.',
          },
        ]);
      }

      const result = await getTranscriptionProvider(credentials.provider, credentials).transcribe({
        audio: await readAudio(recording.storageKey),
        mimeType: recording.mimeType,
        language,
      });

      if (!result.text) throw Invalid([{ field: 'content', code: 'empty', message: 'No speech was recognised.' }]);

      content = result.text;
      provider = result.provider;
      confidence = result.confidence;
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return prisma.transcript.upsert({
      where: { callId: params.id },
      create: { tenantId: ctx.tenantId, callId: params.id, content, language, provider, confidence, wordCount },
      update: { content, language, provider, confidence, wordCount },
    });
  },
);

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const transcript = await prisma.transcript.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!transcript) throw NotFound('Transcript');
    return transcript;
  },
);
