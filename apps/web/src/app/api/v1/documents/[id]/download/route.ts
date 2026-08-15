import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { getObject } from '@/lib/storage';
import { visibilityWhere } from '@/lib/security/visibility';

const params = z.object({ id: z.string().cuid() });

/**
 * Streams a stored document through an authorised handler, like call
 * recordings: no pre-signed URLs, an audit row on access, and the viewer must
 * be able to see the lead the document hangs off.
 */
export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'DOCUMENT_ACCESSED' },
  async ({ ctx, params }) => {
    const document = await prisma.document.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
    });
    if (!document) throw NotFound('Document');
    if (document.scanState !== 'CLEAN' || !document.storageKey) {
      throw Forbidden('This file is not available for download.');
    }
    if (document.leadId) {
      const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
      const lead = await prisma.lead.findFirst({ where: { ...scope, id: document.leadId }, select: { id: true } });
      if (!lead) throw NotFound('Document');
    }

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
