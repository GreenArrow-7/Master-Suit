import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertPermission } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { scanBuffer } from '@/lib/antivirus';
import { putObject } from '@/lib/storage';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { transcribeCall, analyseAndAudit } from '@/services/shared/callIntelligence';

/**
 * Upload a call recording as an audio file.
 *
 * Recordings normally arrive from the telephony webhook; this is the path for
 * the call that happened off-platform — a phone handed over in a meeting, a
 * vendor export — that still deserves the same transcript, analysis and audit.
 *
 * Multipart, so it reproduces the kernel's security order by hand exactly as
 * the document upload routes do: authenticate, entitlement, permission, then
 * read the payload.
 */

/** Types the transcription providers actually accept — reject the rest here. */
const AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
]);

/** Matches the providers' inline ceiling, so the upload fails here with a clear
 *  message rather than minutes later inside the transcription job. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const { id: callId } = await params;
    const ctx = await resolveCtx(req, requestId);
    await assertModuleEntitlement(ctx.tenantId, 'SALES');
    assertPermission(ctx, 'calls', 'EDIT');

    const call = await prisma.call.findFirst({
      where: { id: callId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!call) throw new AppError(404, 'not-found', 'Call not found.');

    // Checked before the file is read: withdrawn consent must stop the upload,
    // not only the transcription that would follow it.
    const consent = await prisma.recordingConsent.findFirst({
      where: { callId, tenantId: ctx.tenantId },
    });
    if (!consent?.consentGiven || consent.withdrawnAt) {
      throw new AppError(403, 'forbidden', 'Record consent before uploading audio for this call.');
    }

    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > MAX_AUDIO_BYTES + 64 * 1024) {
      throw new AppError(413, 'file-too-large', 'Audio must be under 10 MB.');
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(422, 'validation-failed', 'Attach an audio file.');
    if (file.size > MAX_AUDIO_BYTES) throw new AppError(413, 'file-too-large', 'Audio must be under 10 MB.');

    const mimeType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.has(mimeType)) {
      throw new AppError(422, 'validation-failed', `Audio format ${mimeType || 'unknown'} is not supported.`);
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Same antivirus discipline as documents: an unscannable file is not stored.
    const scan = await scanBuffer(bytes);
    if (scan.verdict !== 'CLEAN') {
      throw new AppError(422, 'validation-failed', 'The file did not pass the malware scan.');
    }

    const storageKey = `recordings/${ctx.tenantId}/${callId}-${ulid()}.upload`;
    await putObject(storageKey, bytes, mimeType);

    await prisma.recording.upsert({
      where: { callId, tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        callId,
        storageKey,
        storageBucket: null,
        mimeType,
        sizeBytes: bytes.length,
      },
      // A re-upload replaces the pointer; the old object stays for the
      // retention sweep rather than being deleted mid-request.
      update: { storageKey, storageBucket: null, mimeType, sizeBytes: bytes.length },
    });

    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'Recording',
      recordId: callId,
      metadata: { action: 'recording.uploaded', sizeBytes: bytes.length, mimeType },
    });

    // Kick the transcribe → analyse → audit chain the way the transcript route
    // does: queue when a worker is listening, inline when this box is all there is.
    if (await queueHasWorkers('ai')) {
      await enqueue('ai', 'transcribe', { tenantId: ctx.tenantId, callId }, { fresh: true });
    } else {
      void transcribeCall({ tenantId: ctx.tenantId, callId })
        .then(() => analyseAndAudit(ctx.tenantId, callId))
        .catch((err) => logger.error({ err, callId }, 'inline transcribe-analyse-audit failed'));
    }

    return NextResponse.json({ status: 'QUEUED' }, { status: 202 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { title: err.code, detail: err.message, requestId },
        { status: err.status },
      );
    }
    logger.error({ err, requestId }, 'recording upload failed');
    return NextResponse.json(
      { title: 'internal-error', detail: 'Something went wrong on our side.', requestId },
      { status: 500 },
    );
  }
}
