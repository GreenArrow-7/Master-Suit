import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { uploadMedia } from '@/services/inventory/media';

/**
 * Add photo / Add file on a project (M11-03): a multipart upload, scanned and
 * stored, then served by `media/[mediaId]/file`. The kernel leaves a body that
 * is not JSON unread, so the file reaches readUpload after authentication,
 * entitlement, permission and the rate limit.
 */
export const POST = route(
  {
    module: 'projects',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    sessionOnly: true,
    params: z.object({ id: z.string().cuid() }),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, req }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw NotFound('Project');
    return uploadMedia(ctx, req, { project: project.id });
  },
);
