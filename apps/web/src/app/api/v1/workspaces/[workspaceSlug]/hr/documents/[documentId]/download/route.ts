import { resolveGuardedCtx } from '@/lib/api/guarded';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';

import { requireWorkspace } from '@/lib/workspace';
import { downloadDocument } from '@/services/hr/documents';
import { toResponse } from '@/lib/api/handler';

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
    const ctx = await resolveGuardedCtx(req, requestId, {
      productModule: 'HRMS',
      permission: ['hr_documents', 'VIEW'],
    });
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
    return toResponse(error, requestId, {
      route: '/api/v1/workspaces/[workspaceSlug]/hr/documents/[documentId]/download',
    });
  }
}
