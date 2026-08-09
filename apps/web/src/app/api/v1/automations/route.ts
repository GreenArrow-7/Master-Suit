import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { filterTreeSchema } from '@/lib/api/filterTree';
import { automationGraph } from '@/services/automation/graph';

/**
 * The engine (services/automation) could enroll, walk graphs and run actions —
 * but nothing could create an automation, so it only ever ran against seeded
 * rows. This is the missing front door: one trigger, an optional condition, one
 * action. The graph format supports more; the composer starts honest.
 */
const actionSpec = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_task'),
    taskTypeKey: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    dueInMinutes: z.coerce.number().int().min(1).max(60 * 24 * 30).default(30),
  }),
  z.object({ action: z.literal('notify_owner'), template: z.string().min(1).max(200) }),
  z.object({ action: z.literal('notify_manager'), template: z.string().min(1).max(200) }),
  z.object({ action: z.literal('add_tag'), tag: z.string().min(1).max(60) }),
  z.object({ action: z.literal('update_field'), field: z.string().min(1).max(80), value: z.unknown() }),
]);

const createBody = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(500).optional(),
    objectType: z.enum(['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT']),
    event: z.enum(['created', 'updated']),
    condition: filterTreeSchema.optional(),
    actionSpec,
    /** Publish immediately; otherwise it sits in DRAFT until activated. */
    activate: z.boolean().default(false),
  })
  .strict();

export const POST = route(
  {
    module: 'automation',
    productModule: 'SALES',
    action: 'MANAGE_AUTOMATION',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const triggerSpec = { event: `record.${body.event}`, object: body.objectType };

    const nodes = [
      { id: 'trigger', type: 'trigger' as const, spec: triggerSpec, next: body.condition ? 'condition' : 'action' },
      ...(body.condition
        ? [
            {
              id: 'condition',
              type: 'condition' as const,
              spec: { filter: body.condition },
              branches: { true: 'action', false: null },
            },
          ]
        : []),
      { id: 'action', type: 'action' as const, spec: body.actionSpec, next: 'stop' },
      { id: 'stop', type: 'stop' as const, spec: {} },
    ];
    // The same validation the engine applies at enrollment time; a graph this
    // route can produce but the engine would refuse is a bug caught here.
    const graph = automationGraph.parse({ entry: 'trigger', nodes });

    const automation = await prisma.automation.create({
      data: {
        tenantId: ctx.tenantId,
        name: body.name,
        description: body.description ?? null,
        objectType: body.objectType,
        state: 'DRAFT',
        createdById: ctx.actor.id,
      },
    });
    const version = await prisma.automationVersion.create({
      data: {
        tenantId: ctx.tenantId,
        automationId: automation.id,
        versionNumber: 1,
        graph,
        triggerSpec,
        createdById: ctx.actor.id,
        ...(body.activate ? { publishedAt: new Date(), publishedById: ctx.actor.id } : {}),
      },
    });

    if (body.activate) {
      await prisma.automation.update({
        where: { id: automation.id, tenantId: ctx.tenantId },
        data: { state: 'PUBLISHED', activeVersionId: version.id, updatedById: ctx.actor.id },
      });
    }

    return { id: automation.id, state: body.activate ? 'PUBLISHED' : 'DRAFT', versionId: version.id };
  },
);
