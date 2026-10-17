import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { can } from '@/lib/security/rbac';
import { filterTreeSchema } from '@/lib/api/filterTree';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertAssignableUser } from '@/lib/security/record-scope';
import { automationGraph } from '@/services/automation/graph';
import { mayAssignLeads } from '@/services/automation/actions';
import { RECORD_MODULE } from '@/services/automation/records';
import { newWebhookSecret } from '@/services/automation/webhook';
import { sendableTemplate } from '@/services/conversations/send';

/**
 * The engine (services/automation) could enroll, walk graphs and run actions —
 * but nothing could create an automation, so it only ever ran against seeded
 * rows. This is the missing front door: one trigger, an optional condition, one
 * action. The graph format supports more; the composer starts honest.
 *
 * Every lead module (audit M7-11): a Lead-Eagle-only workspace authors its own.
 * A lead may also be assigned, sent a template, or announced to a signed
 * webhook (M7-12), and a trigger may be time after the lead arrived.
 */
const actionSpec = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_task'),
    taskTypeKey: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    dueInMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 30)
      .default(30),
  }),
  z.object({ action: z.literal('notify_owner'), template: z.string().min(1).max(200) }),
  z.object({ action: z.literal('notify_manager'), template: z.string().min(1).max(200) }),
  z.object({ action: z.literal('add_tag'), tag: z.string().min(1).max(60) }),
  z.object({ action: z.literal('update_field'), field: z.string().min(1).max(80), value: z.unknown() }),
  /** A named person, or none: the next in turn under the assignment rules. */
  z.object({ action: z.literal('assign'), userId: z.string().min(1).max(64).optional() }),
  z.object({
    action: z.literal('send_template'),
    channel: z.enum(['WHATSAPP', 'EMAIL']),
    templateKey: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal('webhook'),
    url: z
      .string()
      .url()
      .max(500)
      .refine((url) => url.startsWith('https://'), 'A webhook must be an https address.'),
  }),
]);

const LEAD_ONLY = new Set(['assign', 'send_template']);

const createBody = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(500).optional(),
    objectType: z.enum(['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT']),
    /** `time`: `afterMinutes` after the lead was created (services/automation/engine.ts sweepTimeTriggers). */
    event: z.enum(['created', 'updated', 'time']),
    afterMinutes: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .optional(),
    condition: filterTreeSchema.optional(),
    actionSpec,
    /** Publish immediately; otherwise it sits in DRAFT until activated. */
    activate: z.boolean().default(false),
  })
  .strict()
  .superRefine((body, issues) => {
    if (body.event === 'time' && body.afterMinutes === undefined) {
      issues.addIssue({ code: 'custom', path: ['afterMinutes'], message: 'Say how long after it arrives.' });
    }
    if ((body.event === 'time' || LEAD_ONLY.has(body.actionSpec.action)) && body.objectType !== 'LEAD') {
      issues.addIssue({ code: 'custom', path: ['objectType'], message: 'Only a lead can take this.' });
    }
  });

export const POST = route(
  {
    module: 'automation',
    productModule: LEAD_MODULES,
    action: 'MANAGE_AUTOMATION',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
    // A webhook's signing secret is in the answer, once: never in a replay store.
    idempotent: false,
  },
  async ({ ctx, body }) => {
    const triggerSpec =
      body.event === 'time'
        ? { event: 'time', object: body.objectType, afterMinutes: body.afterMinutes }
        : { event: `record.${body.event}`, object: body.objectType };

    // Checked now, as the author: a hand-over to someone outside their reach,
    // or a template that cannot be sent, is refused here rather than failing
    // every time the rule fires.
    let spec: Record<string, unknown> = body.actionSpec;
    let webhookSecret: string | undefined;
    if (body.actionSpec.action === 'assign') {
      // updateLead drops an owner change from someone without either grant, so the rule would do nothing, every time.
      if (!mayAssignLeads(ctx)) throw Forbidden('You cannot assign leads.');
      if (body.actionSpec.userId) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', body.actionSpec.userId);
    }
    if (body.actionSpec.action === 'send_template') {
      await sendableTemplate(ctx.tenantId, body.actionSpec.channel, body.actionSpec.templateKey);
    }
    if (body.actionSpec.action === 'webhook') {
      // It sends records out of the platform: only ones the author may open (each run checks the record too).
      if (!can(ctx, RECORD_MODULE[body.objectType], 'VIEW')) throw Forbidden('You cannot see these records.');
      const secret = newWebhookSecret();
      webhookSecret = secret.plain;
      spec = { ...body.actionSpec, secret: secret.sealed };
    }

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
      { id: 'action', type: 'action' as const, spec: { ...spec, action: body.actionSpec.action }, next: 'stop' },
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

    return {
      id: automation.id,
      state: body.activate ? 'PUBLISHED' : 'DRAFT',
      versionId: version.id,
      // Shown once: the receiver checks X-Youhan-Signature with it.
      ...(webhookSecret ? { webhookSecret } : {}),
    };
  },
);
