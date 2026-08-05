import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertPermission } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { requireWorkspace } from '@/lib/workspace';
import { downloadDocument } from '@/services/hr/documents';

/**
 * The only route to a stored document's bytes.
 *
 * Deliberately not a pre-signed object-store URL: a pre-signed link is a bearer
 * token for a passport scan that works for anyone who obtains it and produces no
 * record of who did. Streaming through here keeps the permission check and the
 * audit row on the same path as the bytes.
 */
export async function GET(req: Request, context: { params: Promise<{ workspaceSlug: string; documentId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const { workspaceSlug, documentId } = await context.params;
    const ctx = await resolveCtx(req, requestId);
    await assertModuleEntitlement(ctx.tenantId, 'HRMS');
    assertPermission(ctx, 'hr_documents', 'VIEW');
    await requireWorkspace(ctx, workspaceSlug, 'HRMS');

    const file = await downloadDocument(ctx, documentId);

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.contentType,
        'content-length': String(file.bytes.length),
        // `attachment` so a malicious upload cannot execute in the workspace origin.
        'content-disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
    }
    logger.error({ err: error, requestId }, 'document download failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
