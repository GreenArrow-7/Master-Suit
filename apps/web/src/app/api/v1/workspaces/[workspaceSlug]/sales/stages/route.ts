import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';

/**
 * Pipeline stages.
 *
 * Created once by workspace provisioning and never editable again — a company
 * whose pipeline was not "New → Qualified → Won/Lost" had no way to say so, and
 * a stage named wrongly at provisioning stayed wrong.
 *
 * A stage carries a `category` the reporting layer keys on: OPEN, CONVERSION,
 * TERMINAL_NEGATIVE. That is why the terminal stages cannot simply be renamed
 * away — a pipeline with nothing to convert into reports zero conversions
 * forever, and the failure looks like bad data rather than bad configuration.
 */
const paramsSchema = z.object({ workspaceSlug: z.string().min(2).max(64) });
const idQuery = z.object({ id: z.string().min(1).max(64) });

const stageBody = z.object({
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Use lower-case letters, numbers and underscores.'),
  name: z.string().min(2).max(80),
  position: z.coerce.number().int().min(0).max(100),
  category: z.enum(['OPEN', 'CONVERSION', 'TERMINAL_NEGATIVE']).default('OPEN'),
  isDefault: z.coerce.boolean().optional(),
});

export const GET = route(
  { module: 'settings', productModule: 'SALES', action: 'VIEW', params: paramsSchema },
  async ({ ctx, params }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    return prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  },
);

export const POST = route(
  {
    module: 'settings',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    params: paramsSchema,
    body: stageBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    const clash = await prisma.leadStage.findFirst({
      where: { tenantId: ctx.tenantId, key: body.key, deletedAt: null },
    });
    if (clash) throw Conflict('A stage with that key already exists.');

    // Exactly one default, or a new lead has nowhere to land.
    if (body.isDefault) await clearDefault(ctx.tenantId);
    return prisma.leadStage.create({ data: { tenantId: ctx.tenantId, ...body } });
  },
);

export const PATCH = route(
  {
    module: 'settings',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    params: paramsSchema,
    query: idQuery,
    body: stageBody.partial(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, query, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    const stage = await prisma.leadStage.findFirst({
      where: { tenantId: ctx.tenantId, id: query.id, deletedAt: null },
    });
    if (!stage) throw NotFound('Stage');

    if (body.isDefault) await clearDefault(ctx.tenantId);
    return prisma.leadStage.update({ where: { tenantId: ctx.tenantId, id: stage.id }, data: body });
  },
);

export const DELETE = route(
  {
    module: 'settings',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    params: paramsSchema,
    query: idQuery,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    const stage = await prisma.leadStage.findFirst({
      where: { tenantId: ctx.tenantId, id: query.id, deletedAt: null },
    });
    if (!stage) throw NotFound('Stage');

    // Leads point at stages, and stage history points at both. Removing a stage
    // that still holds leads would strand them somewhere the pipeline cannot
    // render, so say what is in the way rather than failing on a foreign key.
    const held = await prisma.lead.count({ where: { tenantId: ctx.tenantId, stageId: stage.id, deletedAt: null } });
    if (held > 0) {
      throw Conflict(`${held} lead${held === 1 ? '' : 's'} are still in that stage. Move them first.`);
    }
    if (stage.isDefault) {
      throw Conflict('That is the stage new leads land in. Make another stage the default first.');
    }

    return prisma.leadStage.update({
      where: { tenantId: ctx.tenantId, id: stage.id },
      data: { deletedAt: new Date() },
    });
  },
);

async function clearDefault(tenantId: string) {
  await prisma.leadStage.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
}
