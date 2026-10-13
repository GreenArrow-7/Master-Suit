import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, isUniqueViolation, NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { ensureLeadSources, listLeadSources, sourceKey } from '@/services/leads/leadSources';

/**
 * The workspace's source catalogue (M4-03): sources and their sub-sources,
 * read by anyone who may see settings, changed under `settings:MANAGE_CONFIGURATION`
 * like the pipeline's stages. An entry is never deleted — leads and reports
 * point at it — only deactivated, which takes it off the pickers. A name its
 * parent already has (in any case) answers 409; the key is only an id, so one
 * another entry holds (an old name, a sub-source's composite) gets a suffix.
 */
const idQuery = z.object({ id: z.string().cuid() });
const name = z.string().trim().min(1).max(80);

/** 409 when an entry beside it (same parent) already has this name, other than `except`. */
async function assertNameFree(tenantId: string, parentId: string | null, value: string, except?: string) {
  const taken = await prisma.leadSource.findFirst({
    where: { tenantId, parentId, name: { equals: value, mode: 'insensitive' }, ...(except && { NOT: { id: except } }) },
    select: { id: true },
  });
  if (taken) throw Conflict(`“${value}” is already in the catalogue.`);
}

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
    // The first entry an administrator adds comes after the defaults, not instead of them.
    await ensureLeadSources(prisma, ctx.tenantId);
    const parent = body.parentId
      ? await prisma.leadSource.findFirst({
          where: { tenantId: ctx.tenantId, id: body.parentId, parentId: null },
          select: { id: true, key: true },
        })
      : null;
    if (body.parentId && !parent) throw NotFound('Lead source');
    await assertNameFree(ctx.tenantId, parent?.id ?? null, body.name);
    const position = await prisma.leadSource.count({ where: { tenantId: ctx.tenantId, parentId: parent?.id ?? null } });
    const key = sourceKey(body.name, parent?.key);
    const create = (k: string) =>
      prisma.leadSource.create({
        data: { tenantId: ctx.tenantId, parentId: parent?.id, key: k, name: body.name, position },
      });
    try {
      return await create(key);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return create(`${key.slice(0, 51)}_${randomBytes(4).toString('hex')}`);
    }
  },
);

export const PATCH = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    query: idQuery,
    body: z
      .object({
        name: name.optional(),
        isActive: z.boolean().optional(),
        /** The points a new lead from this entry starts with (M4-11). */
        weight: z.number().int().min(0).max(100).optional(),
      })
      .strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, query, body }) => {
    const entry = await prisma.leadSource.findFirst({ where: { tenantId: ctx.tenantId, id: query.id } });
    if (!entry) throw NotFound('Lead source');
    if (body.name) await assertNameFree(ctx.tenantId, entry.parentId, body.name, entry.id);
    return prisma.leadSource.update({ where: { tenantId: ctx.tenantId, id: entry.id }, data: body });
  },
);
