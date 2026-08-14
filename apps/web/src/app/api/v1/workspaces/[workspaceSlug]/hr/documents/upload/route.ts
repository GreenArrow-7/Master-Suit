import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { getUploadMaxMb } from '@/lib/platform-settings';
import { logger } from '@/lib/logger';
import { assertPermission } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { requireWorkspace } from '@/lib/workspace';
import { uploadDocument } from '@/services/hr/documents';

/**
 * Multipart upload. This cannot go through the API kernel, which parses every
 * body as JSON — so it reproduces the kernel's security order by hand:
 * authenticate, check the module entitlement, assert the permission, and only
 * then read the payload.
 */
export async function POST(req: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const { workspaceSlug } = await context.params;
    const ctx = await resolveCtx(req, requestId);
    await assertModuleEntitlement(ctx.tenantId, 'HRMS');
    assertPermission(ctx, 'hr_documents', 'CREATE');
    await requireWorkspace(ctx, workspaceSlug, 'HRMS');

    /**
     * Refuse on the declared size, before anything is read.
     *
     * The size check lived in uploadDocument, which receives a Buffer — so the
     * whole body had already been parsed by `req.formData()` and copied again by
     * `file.arrayBuffer()` before anyone asked how big it was. A 2 GB POST was
     * read into memory in full and *then* rejected, which is a way to exhaust
     * the server with requests it is going to refuse anyway.
     *
     * Three checks, cheapest first: the declared length, then the part's own
     * size, then the real byte count in the service (a Content-Length can lie).
     */
    const uploadMaxMb = await getUploadMaxMb();
    const maxBytes = uploadMaxMb * 1024 * 1024;
    const tooLarge = () => new AppError(413, 'file-too-large', `Files must be under ${uploadMaxMb} MB.`);

    const declared = Number(req.headers.get('content-length') ?? 0);
    // Multipart framing adds headers and boundaries around the file itself, so
    // the envelope is allowed a little more than the file limit.
    if (declared > maxBytes + 64 * 1024) throw tooLarge();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(422, 'validation-failed', 'Attach a file to upload.');
    // Known without reading the bytes.
    if (file.size > maxBytes) throw tooLarge();

    const employeeId = String(form.get('employeeId') ?? '');
    const kind = String(form.get('kind') ?? '');
    if (!employeeId || !kind)
      throw new AppError(422, 'validation-failed', 'An employee and a document kind are required.');

    const issuedAtRaw = String(form.get('issuedAt') ?? '');
    const expiresAtRaw = String(form.get('expiresAt') ?? '');

    const document = await uploadDocument(ctx, {
      employeeId,
      kind,
      number: String(form.get('number') ?? '') || undefined,
      issuedAt: issuedAtRaw ? new Date(issuedAtRaw) : undefined,
      expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : undefined,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json(document, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'document upload failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
