import { prisma } from '@/lib/db';
import type { Ctx } from '@/lib/security/rbac';
import { updateRecordField, addTag, type AutomationObjectType } from './records';

export interface ActionContext {
  ctx: Ctx;
  objectType: AutomationObjectType;
  recordId: string;
  spec: Record<string, unknown>;
}

/**
 * The action groups from docs/04-AUTOMATION-ENGINE.md §5 that are wired up. The
 * doc lists ~20 (distribute, opportunity/ticket creation, messaging, lists,
 * webhooks, sub-automations); this registry covers the record/task actions that
 * don't need a second integration (email/SMS/webhook providers) to be real.
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
      await prisma.task.create({
        data: {
          tenantId: ctx.tenantId,
          typeId: type.id,
          title: spec.title as string,
          dueAt: new Date(Date.now() + dueInMinutes * 60_000),
          ownerId: ctx.actor.id,
          [`${objectType.toLowerCase()}Id`]: recordId,
        },
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
      await prisma.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: record.ownerId,
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
