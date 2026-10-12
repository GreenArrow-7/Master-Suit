import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { listLeadSources, sourceKey } from '@/services/leads/leadSources';

/**
 * The workspace's source catalogue (M4-03): sources and their sub-sources,
 * read by anyone who may see settings, changed under `settings:MANAGE_CONFIGURATION`
 * like the pipeline's stages. An entry is never deleted — leads and reports
 * point at it — only deactivated, which takes it off the pickers. A name the
 * parent already has answers 409 from the unique key.
 */
const idQuery = z.object({ id: z.string().cuid() });
const name = z.string().trim().min(1).max(80);

export const GET = route({ module: 'settings', productModule: LEAD_MODULES, action: 'VIEW' }, ({ ctx }) =>
  listLeadSources(prisma, ctx.tenantId),
);

export const POST = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    body: z.object({ name, parentId: z.string().cuid().optional() }).strict(),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const parent = body.parentId
      ? await prisma.leadSource.findFirst({
          where: { tenantId: ctx.tenantId, id: body.parentId, parentId: null },
          select: { id: true, key: true },
        })
      : null;
    if (body.parentId && !parent) throw NotFound('Lead source');
    const position = await prisma.leadSource.count({ where: { tenantId: ctx.tenantId, parentId: parent?.id ?? null } });
    return prisma.leadSource.create({
      data: {
        tenantId: ctx.tenantId,
        parentId: parent?.id,
        key: sourceKey(body.name, parent?.key),
        name: body.name,
        position,
      },
    });
  },
);

export const PATCH = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    query: idQuery,
    body: z.object({ name: name.optional(), isActive: z.boolean().optional() }).strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, query, body }) => {
    const entry = await prisma.leadSource.findFirst({ where: { tenantId: ctx.tenantId, id: query.id } });
    if (!entry) throw NotFound('Lead source');
    return prisma.leadSource.update({ where: { tenantId: ctx.tenantId, id: entry.id }, data: body });
  },
);
