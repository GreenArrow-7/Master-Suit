import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
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
export const GET = route(
  {
    module: 'hr_documents',
    action: 'VIEW',
    productModule: 'HRMS',
    sessionOnly: true,
    params: z.object({ workspaceSlug: z.string(), documentId: z.string() }),
  },
  async ({ ctx, params }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    const file = await downloadDocument(ctx, params.documentId);

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.contentType,
        'content-length': String(file.bytes.length),
        // `attachment` so a malicious upload cannot execute in the workspace origin.
        'content-disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
      },
    });
  },
);
