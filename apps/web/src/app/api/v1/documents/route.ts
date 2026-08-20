import { resolveGuardedCtx } from '@/lib/api/guarded';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { getUploadMaxMb } from '@/lib/platform-settings';
import { logger } from '@/lib/logger';
import { visibilityWhere } from '@/lib/security/visibility';
import { scanBuffer } from '@/lib/antivirus';
import { putObject } from '@/lib/storage';
import { prisma } from '@/lib/db';

/**
 * Upload a document against a lead. Multipart, so it reproduces the kernel's
 * security order by hand exactly as the HR upload route does: authenticate,
 * entitlement, permission, then read the payload.
 *
 * Same antivirus discipline as HR documents, simplified: a CLEAN file is
 * stored and downloadable, an INFECTED one is never stored (the row remains as
 * the record of the attempt), and a scanner ERROR stores nothing rather than
 * keeping unscanned bytes around.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await resolveGuardedCtx(req, requestId, {
      productModule: 'SALES',
      permission: ['leads', 'EDIT'],
    });

    const uploadMaxMb = await getUploadMaxMb();
    const maxBytes = uploadMaxMb * 1024 * 1024;
    const tooLarge = () => new AppError(413, 'file-too-large', `Files must be under ${uploadMaxMb} MB.`);

    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > maxBytes + 64 * 1024) throw tooLarge();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(422, 'validation-failed', 'Attach a file to upload.');
    if (file.size > maxBytes) throw tooLarge();

    const leadId = String(form.get('leadId') ?? '');
    if (!leadId) throw new AppError(422, 'validation-failed', 'A lead is required.');
    const scope = await visibilityWhere(ctx, 'leads', 'EDIT', { includeUnassigned: true });
    const lead = await prisma.lead.findFirst({ where: { ...scope, id: leadId }, select: { id: true } });
    if (!lead) throw new AppError(404, 'not-found', 'Lead not found.');

    const category = String(form.get('category') ?? '') || null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';

    const scan = await scanBuffer(bytes);
    let storageKey = '';
    if (scan.verdict === 'CLEAN') {
      storageKey = `documents/t-${ctx.tenantId}/lead-${lead.id}/${ulid()}-${safeName}`;
      await putObject(storageKey, bytes, contentType);
    }

    const document = await prisma.document.create({
      data: {
        tenantId: ctx.tenantId,
        name: file.name.slice(0, 200),
        category,
        storageKey,
        storageBucket: scan.verdict === 'CLEAN' ? env.S3_BUCKET : 'none',
        mimeType: contentType,
        sizeBytes: bytes.length,
        status: scan.verdict === 'CLEAN' ? 'UPLOADED' : 'REJECTED',
        scanState: scan.verdict,
        scanResult: scan.verdict === 'CLEAN' ? null : (scan.detail ?? scan.verdict),
        leadId: lead.id,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true, name: true, status: true, scanState: true, sizeBytes: true, createdAt: true },
    });

    if (scan.verdict !== 'CLEAN') {
      // The row records the attempt; tell the uploader plainly.
      return NextResponse.json(
        {
          ...document,
          detail:
            scan.verdict === 'INFECTED'
              ? 'The file failed the malware scan and was not stored.'
              : 'The malware scanner was unavailable; try again.',
        },
        { status: 422, headers: { 'x-request-id': requestId } },
      );
    }

    return NextResponse.json(document, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'sales document upload failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
