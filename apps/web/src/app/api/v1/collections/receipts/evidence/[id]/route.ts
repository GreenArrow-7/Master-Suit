import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { getObject } from '@/lib/storage';
import { assertBookingInScope, EVIDENCE_CATEGORY } from '@/services/money/collections';

/**
 * Download receipt evidence. `collections:VIEW` over the sale it was uploaded
 * for, this workspace only, clean files only; every read is audited.
 */
export const GET = route(
  {
    module: 'collections',
    productModule: 'SALES',
    action: 'VIEW',
    params: z.object({ id: z.string().cuid() }),
    auditEvent: 'DOCUMENT_ACCESSED',
  },
  async ({ ctx, params }) => {
    const document = await prisma.document.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: params.id,
        category: EVIDENCE_CATEGORY,
        scanState: 'CLEAN',
        deletedAt: null,
      },
    });
    // Evidence is stored under its booking (evidencePrefix); that is the sale whose scope governs it.
    const bookingId = document?.storageKey.match(/^documents\/t-[^/]+\/booking-([^/]+)\//)?.[1];
    if (!document || !bookingId) throw NotFound('Document');
    await withTx(ctx.tenantId, (tx) => assertBookingInScope(tx, ctx, 'collections', 'VIEW', bookingId, 'Document'));
    const body = await getObject(document.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="${document.name.replace(/[^\w.\- ]+/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);
