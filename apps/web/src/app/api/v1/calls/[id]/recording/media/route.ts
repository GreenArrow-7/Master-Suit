import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Forbidden, NotFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getObject, putObject } from '@/lib/storage';
import { scanBuffer } from '@/lib/antivirus';
import { getUploadMaxMb } from '@/lib/platform-settings';
import { resolveGuardedCtx } from '@/lib/api/guarded';
import { audit } from '@/lib/security/audit';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { analyseAndAudit, markTranscriptionExhausted, transcribeCall } from '@/services/shared/callIntelligence';
import { assertCallInScope, requireVisibleCall } from '@/services/crm/callVisibility';

const params = z.object({ id: z.string().cuid() });

/**
 * The only way to the bytes of a call recording.
 *
 * Not a pre-signed URL: a pre-signed URL is a bearer token for a client's
 * conversation that works for anyone who obtains it, cannot be revoked when
 * consent is withdrawn, and writes no audit row on use. Streaming through an
 * authorised handler costs a hop and keeps all three.
 *
 * Consent is re-checked on every read, so withdrawing consent takes effect
 * immediately for playback and not only for future recordings.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'RECORDING_ACCESSED' },
  async ({ ctx, params }) => {
    await requireVisibleCall(ctx, params.id);
    const [recording, consent] = await Promise.all([
      prisma.recording.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
      prisma.recordingConsent.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
    ]);
    if (!recording) throw NotFound('Recording');
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw Forbidden('This recording is not available: consent was declined or withdrawn.');
    }
    if (recording.storageBucket === 'provider') {
      throw NotFound('Recording media — it has not finished transferring from the telephony provider yet');
    }

    await prisma.recording.update({
      where: { callId: params.id, tenantId: ctx.tenantId },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });

    const body = await getObject(recording.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': recording.mimeType,
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="call-${params.id}"`,
        // Never in a shared cache, never on disk beyond the tab.
        'cache-control': 'private, no-store',
      },
    });
  },
);

/**
 * Uploads the recording itself — audio or video — for a call.
 *
 * Multipart, so it cannot go through the JSON kernel in lib/api/handler.ts.
 * `resolveGuardedCtx` runs the kernel's order for it — authenticate, entitle,
 * permit, throttle — rather than the prologue being retyped here. That matters
 * for the fourth step: the hand-written version of this had no rate limit, which
 * is the same omission the five HR bypasses had and for the same reason. There
 * is no way to ask that function for no limit.
 *
 * Consent is checked after the prologue and before a byte of the body is read.
 *
 * PUT rather than a second POST endpoint: this is the same resource the GET
 * above streams back, and a separate `/upload` path would be a second URL for
 * one object with its own copy of all of the above to keep in step.
 *
 * The bytes are the only copy of a client conversation, so the order matters:
 * scan first, store only a clean file, and write the row last. A row pointing at
 * an object that was never stored is worse than no row — the transcription job
 * would retry against it forever.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await resolveGuardedCtx(req, requestId, {
      productModule: 'SALES',
      permission: ['calls', 'EDIT'],
    });

    const { id: callId } = await context.params;
    if (!/^[a-z0-9]{20,32}$/i.test(callId)) throw new AppError(422, 'validation-failed', 'Invalid call id.');

    const uploadMaxMb = await getUploadMaxMb();
    const maxBytes = uploadMaxMb * 1024 * 1024;
    const tooLarge = () => new AppError(413, 'file-too-large', `Recordings must be under ${uploadMaxMb} MB.`);
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > maxBytes + 64 * 1024) throw tooLarge();

    const [call, consent] = await Promise.all([
      prisma.call.findFirst({
        where: { id: callId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, callerId: true },
      }),
      prisma.recordingConsent.findFirst({ where: { callId, tenantId: ctx.tenantId } }),
    ]);
    if (!call) throw new AppError(404, 'not-found', 'Call not found.');
    // This handler is multipart and bypasses the JSON kernel, so it authorises
    // the record itself. Without it, `calls:EDIT` at OWN could attach a
    // recording to a colleague's call.
    await assertCallInScope(ctx, call);
    // The same rule the JSON recording endpoint enforces, checked before a byte
    // is read: recording must never begin without active consent.
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw new AppError(403, 'forbidden', 'Cannot store a recording without active consent.');
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(422, 'validation-failed', 'Attach a recording to upload.');
    if (file.size > maxBytes) throw tooLarge();

    const mimeType = (file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_MEDIA.test(mimeType)) {
      throw new AppError(422, 'validation-failed', 'Upload an audio or video recording.');
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const scan = await scanBuffer(bytes);
    if (scan.verdict !== 'CLEAN') {
      throw new AppError(
        422,
        'validation-failed',
        scan.verdict === 'INFECTED'
          ? 'The file failed the malware scan and was not stored.'
          : 'The malware scanner was unavailable; try again.',
      );
    }

    const durationSecs = Number(form.get('durationSecs') ?? 0) || null;
    const storageKey = `recordings/t-${ctx.tenantId}/call-${callId}/${ulid()}`;
    await putObject(storageKey, bytes, mimeType);

    const recording = await prisma.recording.upsert({
      where: { callId, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId,
        storageKey,
        storageBucket: env.S3_BUCKET,
        mimeType,
        sizeBytes: bytes.length,
        durationSecs,
      },
      update: { storageKey, storageBucket: env.S3_BUCKET, mimeType, sizeBytes: bytes.length, durationSecs },
      select: { id: true, mimeType: true, sizeBytes: true, durationSecs: true, createdAt: true },
    });

    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'calls',
      recordId: callId,
      metadata: { method: 'PUT', path: `/api/v1/calls/${callId}/recording/media`, sizeBytes: bytes.length },
    });

    /**
     * Transcription is a minutes-long provider call and never runs on this
     * thread. On a box with no worker draining the queue it runs detached, the
     * way the analysis route already does, so a dev clone still completes the
     * chain — the transcript row is claimed by its own uniqueness constraint, so
     * racing a worker cannot produce two.
     */
    const language = String(form.get('language') ?? 'en').slice(0, 10);
    if (await queueHasWorkers('ai')) {
      await enqueue('ai', 'transcribe', { tenantId: ctx.tenantId, callId, language });
    } else {
      const tenantId = ctx.tenantId;
      void transcribeCall({ tenantId, callId, language })
        .then(
          () => analyseAndAudit(tenantId, callId),
          async (err) => {
            /**
             * Two arguments rather than a trailing `.catch`, so this only sees a
             * failure of the transcription itself. A trailing catch would also
             * catch `analyseAndAudit` blowing up and mark a transcript that
             * exists and is readable as FAILED.
             *
             * There is no queue behind this path, so the first failure is the
             * last one — leaving it at RETRYING would promise a retry that
             * nothing is going to run.
             */
            await markTranscriptionExhausted(tenantId, callId, (err as Error).message);
            throw err;
          },
        )
        .catch((err) => logger.error({ err: (err as Error).message, callId }, 'inline transcription chain failed'));
    }

    return NextResponse.json({ ...recording, transcription: 'QUEUED' }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'call recording upload failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

/** Audio and video only. A transcription provider rejects anything else anyway. */
const ACCEPTED_MEDIA = /^(audio|video)\//;
