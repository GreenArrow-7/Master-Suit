import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
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

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(422, 'validation-failed', 'Attach a file to upload.');

    const employeeId = String(form.get('employeeId') ?? '');
    const kind = String(form.get('kind') ?? '');
    if (!employeeId || !kind) throw new AppError(422, 'validation-failed', 'An employee and a document kind are required.');

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
      return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
    }
    logger.error({ err: error, requestId }, 'document upload failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
