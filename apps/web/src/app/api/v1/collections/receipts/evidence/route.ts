import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveGuardedCtx } from '@/lib/api/guarded';
import { scanBuffer } from '@/lib/antivirus';
import { prisma, withTx } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getUploadMaxMb } from '@/lib/platform-settings';
import { deleteObject, putObject } from '@/lib/storage';
import { assertBookingInScope, EVIDENCE_CATEGORY, evidencePrefix } from '@/services/money/collections';

/** The only kinds of file a receipt is evidenced by, recognised by their first bytes rather than their name. */
const SIGNATURES: { type: string; bytes: number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/**
 * Upload the document that evidences a receipt.
 *
 * The same pipeline as every other upload — size guard before parsing, malware
 * scan, object storage, a `Document` row — with two additions: only PDF, PNG and
 * JPEG are accepted, by content; and the object is stored under the booking, so
 * a document uploaded for one sale cannot be attached to another.
 *
 * Uploading is not recording and never verifies anything: the response is a
 * document id, which the receipt form then submits with the amount, date and
 * reference, and the receipt still waits for a second person.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  let storedKey = '';
  try {
    const ctx = await resolveGuardedCtx(req, requestId, {
      productModule: 'SALES',
      permission: ['collections', 'CREATE'],
    });

    const uploadMaxMb = await getUploadMaxMb();
    const maxBytes = uploadMaxMb * 1024 * 1024;
    const tooLarge = () => new AppError(413, 'file-too-large', `Files must be under ${uploadMaxMb} MB.`);
    if (Number(req.headers.get('content-length') ?? 0) > maxBytes + 64 * 1024) throw tooLarge();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0)
      throw new AppError(422, 'validation-failed', 'Attach a file to upload.');
    if (file.size > maxBytes) throw tooLarge();

    const bookingId = String(form.get('bookingId') ?? '');
    if (!bookingId) throw new AppError(404, 'not-found', 'Booking not found.');
    await withTx(ctx.tenantId, (tx) => assertBookingInScope(tx, ctx, 'collections', 'CREATE', bookingId));
    const booking = { id: bookingId };

    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b));
    if (!kind) throw new AppError(422, 'validation-failed', 'Evidence must be a PDF, PNG or JPEG file.');

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

    const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'evidence';
    storedKey = `${evidencePrefix(ctx.tenantId, booking.id)}${ulid()}-${safeName}`;
    await putObject(storedKey, bytes, kind.type);

    const document = await prisma.document.create({
      data: {
        tenantId: ctx.tenantId,
        name: file.name.slice(0, 200),
        category: EVIDENCE_CATEGORY,
        storageKey: storedKey,
        storageBucket: env.S3_BUCKET,
        mimeType: kind.type,
        sizeBytes: bytes.length,
        status: 'UPLOADED',
        scanState: 'CLEAN',
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true, name: true, sizeBytes: true, mimeType: true, createdAt: true },
    });
    return NextResponse.json(document, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    // Stored but not recorded: take the object back out, so a failed upload
    // leaves nothing behind that no row points at.
    if (storedKey) await deleteObject(storedKey).catch(() => {});
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'receipt evidence upload failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
