import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { paymentPlanBody, readMilestones } from '@/lib/inventory/paymentPlans';

const params = z.object({ id: z.string().cuid() });

async function liveProject(tenantId: string, id: string) {
  const project = await prisma.project.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw NotFound('Project');
  return project;
}

/** A project's payment plans (M11-02), oldest first: the order they were added in. */
export const GET = route(
  { module: 'projects', productModule: LEAD_MODULES, action: 'VIEW', params },
  async ({ ctx, params }) => {
    const project = await liveProject(ctx.tenantId, params.id);
    const plans = await prisma.paymentPlan.findMany({
      where: { tenantId: ctx.tenantId, projectId: project.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, milestones: true, createdAt: true },
    });
    return { data: plans.map((p) => ({ ...p, milestones: readMilestones(p.milestones) })) };
  },
);

/** Records a plan the project sells on: a name and milestones summing to 100%. */
export const POST = route(
  {
    module: 'projects',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: paymentPlanBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const project = await liveProject(ctx.tenantId, params.id);
    const clash = await prisma.paymentPlan.findFirst({
      where: { tenantId: ctx.tenantId, projectId: project.id, name: body.name },
      select: { id: true },
    });
    if (clash) throw Conflict(`This project already has a plan called ${body.name}.`);
    return prisma.paymentPlan.create({
      data: { tenantId: ctx.tenantId, projectId: project.id, createdById: ctx.actor.id, ...body },
      select: { id: true, name: true, milestones: true },
    });
  },
);

/** Removes one plan, by `?planId=`. */
export const DELETE = route(
  {
    module: 'projects',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    query: z.object({ planId: z.string().cuid() }).strict(),
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    const { count } = await prisma.paymentPlan.deleteMany({
      where: { tenantId: ctx.tenantId, projectId: params.id, id: query.planId },
    });
    if (count === 0) throw NotFound('Payment plan');
    return { deleted: count };
  },
);
