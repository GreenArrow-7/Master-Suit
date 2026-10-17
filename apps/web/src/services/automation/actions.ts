import { prisma, withTx } from '@/lib/db';
import { AppError, Forbidden } from '@/lib/errors';
import { can, type Ctx } from '@/lib/security/rbac';
import { assertLeadInScope, assertRecordInScope } from '@/lib/security/record-scope';
import { updateRecordField, addTag, loadRecord, RECORD_MODULE, type AutomationObjectType } from './records';
import { postWebhook } from './webhook';
import { withRecompute } from '@/services/leads/nextFollowUp';
import { updateLead } from '@/services/leads/updateLead';
import { sendLeadMessage, type MessageChannel } from '@/services/leads/leadMessages';
import { assignLead } from '@/services/distribution/assignLead';

/** What updateLead requires before it writes an owner (`services/leads/updateLead.ts`). */
export const mayAssignLeads = (ctx: Ctx) => can(ctx, 'leads', 'ASSIGN') || can(ctx, 'leads', 'REASSIGN');

export interface ActionContext {
  ctx: Ctx;
  objectType: AutomationObjectType;
  recordId: string;
  spec: Record<string, unknown>;
}

/**
 * The record as the automation's author may VIEW it, or null. Anything that
 * leaves the platform goes through here: the engine runs as the author, and a
 * webhook must not carry a record their role could not open.
 */
async function viewableRecord(ctx: Ctx, objectType: AutomationObjectType, recordId: string) {
  try {
    if (objectType === 'LEAD') return await assertLeadInScope(ctx, recordId, prisma, 'VIEW');
    const record = await loadRecord(ctx.tenantId, objectType, recordId);
    if (record) await assertRecordInScope(ctx, RECORD_MODULE[objectType], record, prisma, 'VIEW', objectType);
    return record;
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The action groups from docs/04-AUTOMATION-ENGINE.md §5 that are wired up. The
 * doc lists ~20 (distribute, opportunity/ticket creation, messaging, lists,
 * webhooks, sub-automations); this registry covers the record and task actions,
 * and for a lead: assign, send a template (WhatsApp or email, through the
 * lead's own send) and a signed webhook (audit M7-12).
 * ponytail: add a case here per action as it's needed — throwing on an unknown
 * action fails the node loudly instead of silently no-opping.
 */
export async function runAction({ ctx, objectType, recordId, spec }: ActionContext) {
  switch (spec.action) {
    case 'update_field':
      return updateRecordField(ctx.tenantId, objectType, recordId, spec.field as string, spec.value);

    case 'add_tag':
      return addTag(ctx.tenantId, objectType, recordId, spec.tag as string);

    case 'create_task': {
      const type = await prisma.taskType.findFirst({
        where: { tenantId: ctx.tenantId, key: spec.taskTypeKey as string },
      });
      if (!type) throw new Error(`Unknown task type "${spec.taskTypeKey}"`);
      const dueInMinutes = (spec.dueInMinutes as number) ?? 30;
      // A rule firing on a lead creates an obligation on that lead, so it takes
      // the same lock and recompute as a person creating one by hand. Rules on
      // an opportunity, account or ticket attach elsewhere and affect no lead
      // aggregate — hence the conditional id rather than an unconditional one.
      const leadId = objectType === 'LEAD' ? recordId : null;
      await withTx(ctx.tenantId, (tx) =>
        withRecompute(tx, ctx.tenantId, [leadId], () =>
          tx.task.create({
            data: {
              tenantId: ctx.tenantId,
              typeId: type.id,
              title: spec.title as string,
              dueAt: new Date(Date.now() + dueInMinutes * 60_000),
              ownerId: ctx.actor.id,
              [`${objectType.toLowerCase()}Id`]: recordId,
            },
          }),
        ),
      );
      return;
    }

    // A named person (checked as a hand-over by the automation's author), or
    // for a lead nobody holds, the next in turn under the assignment rules.
    case 'assign':
      if (objectType !== 'LEAD') throw new Error('Only a lead can be assigned.');
      // An author who has lost both grants fails the step: updateLead would drop the owner and report success.
      if (!mayAssignLeads(ctx)) throw Forbidden('The author of this automation cannot assign leads.');
      if (spec.userId) await updateLead(ctx, recordId, { ownerId: spec.userId as string });
      else await assignLead(ctx.tenantId, recordId);
      return;

    case 'send_template':
      if (objectType !== 'LEAD') throw new Error('A template is sent to a lead.');
      await sendLeadMessage(ctx, recordId, {
        channel: spec.channel as MessageChannel,
        templateKey: spec.templateKey as string,
      });
      return;

    // Who and what, never the lead's numbers or email: the receiver reads more through the API.
    case 'webhook': {
      const record = await viewableRecord(ctx, objectType, recordId);
      if (!record) return;
      await postWebhook(spec as { url: string; secret: string }, {
        event: 'automation',
        objectType,
        recordId,
        reference: record.reference ?? null,
        name: record.fullName ?? record.name ?? null,
        ownerId: record.ownerId ?? null,
        stageId: record.stageId ?? null,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    case 'notify_manager':
    case 'notify_owner': {
      const record = await (prisma as any)[objectType.toLowerCase()].findFirst({
        where: { tenantId: ctx.tenantId, id: recordId },
        select: { ownerId: true },
      });
      if (!record?.ownerId) return;
      // The manager is the owner's (User.managerId); it used to notify the owner too.
      let userId: string = record.ownerId;
      if (spec.action === 'notify_manager') {
        const owner = await prisma.user.findFirst({
          where: { tenantId: ctx.tenantId, id: record.ownerId },
          select: { managerId: true },
        });
        if (!owner?.managerId) return;
        userId = owner.managerId;
      }
      /**
       * No `actionUrl`: the destination is resolved on read, from `objectType`
       * and `recordId`, by `src/lib/nav/entityRoute.ts`. `objectType` here is
       * one of LEAD, OPPORTUNITY, ACCOUNT or CONTACT — see `records.ts` — and
       * all four have detail screens, so these rows became clickable the moment
       * the feed started resolving instead of pushing stored paths. They had
       * been inert since they were written.
       */
      await prisma.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId,
          kind: 'AUTOMATION',
          title: (spec.template as string) ?? 'Automation notification',
          objectType,
          recordId,
        },
      });
      return;
    }

    default:
      throw new Error(`Unsupported automation action "${spec.action}"`);
  }
}
