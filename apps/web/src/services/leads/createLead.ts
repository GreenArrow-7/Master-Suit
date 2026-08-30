import { withTx, prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { can } from '@/lib/security/rbac';
import { findDuplicates } from './findDuplicates';
import { normalizePhone } from './normalizePhone';
import { nextReference } from '../shared/reference';
import { emit } from '../shared/events';
import { enqueue } from '@/lib/queue';
import { notifyCrm } from '../crm/notify';

export const LEAD_SENSITIVE_FIELDS = ['secondaryEmail', 'secondaryPhone', 'addressLine', 'postalCode'] as const;

export interface CreateLeadInput {
  fullName: string;
  email?: string;
  phone?: string;
  stageId?: string;
  ownerId?: string;
  custom?: Record<string, unknown>;
  onDuplicate?: 'BLOCK' | 'WARN' | 'MERGE';
  [k: string]: unknown;
}

/**
 * Workflow 1 from the brief, end to end:
 *   duplicate check → source + campaign → initial score → distribution → notify →
 *   first-contact task → SLA timer → timeline.
 *
 * Everything that can be deferred is deferred: the record is committed fast, and
 * assignment, scoring and notification run on queues. That keeps a form POST under
 * 100 ms even when five automations are listening.
 */
export async function createLead(ctx: Ctx, input: CreateLeadInput) {
  const phoneNormalized = input.phone ? normalizePhone(input.phone, 'AE') : null;

  // 1. Duplicate check ───────────────────────────────────────────────────────
  const duplicates = await findDuplicates(ctx.tenantId, {
    email: input.email,
    phoneNormalized,
    fullName: input.fullName,
  });
  if (duplicates.length && (input.onDuplicate ?? 'BLOCK') === 'BLOCK') {
    throw Conflict(`A lead with this ${duplicates[0]!.matchedOn} already exists (${duplicates[0]!.reference}).`);
  }

  // 2. Stage: explicit, or the tenant's configured default ───────────────────
  const stage = input.stageId
    ? await prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: input.stageId } })
    : await prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true } });
  if (!stage) throw NotFound('Lead stage');

  // A user without ASSIGN cannot hand the lead to someone else; it stays theirs.
  const ownerId = input.ownerId && can(ctx, 'leads', 'ASSIGN') ? input.ownerId : ctx.actor.id;

  const lead = await withTx(ctx.tenantId, async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'LEAD');

    const created = await tx.lead.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        fullName: input.fullName,
        firstName: (input.firstName as string) ?? null,
        lastName: (input.lastName as string) ?? null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone ?? null,
        phoneNormalized,
        company: (input.company as string) ?? null,
        jobTitle: (input.jobTitle as string) ?? null,
        country: (input.country as string) ?? null,
        city: (input.city as string) ?? null,
        source: (input.source as any) ?? 'MANUAL',
        sourceDetail: (input.sourceDetail as string) ?? null,
        campaignId: (input.campaignId as string) ?? null,
        stageId: stage.id,
        ownerId,
        assignedAt: ownerId ? new Date() : null,
        priority: (input.priority as any) ?? 'MEDIUM',
        tags: (input.tags as string[]) ?? [],
        customData: (input.custom ?? {}) as any,
        slaDueAt: stage.slaMinutes ? new Date(Date.now() + stage.slaMinutes * 60_000) : null,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    // Normalized custom-field values; Lead.customData above is the read projection.
    if (input.custom && Object.keys(input.custom).length) {
      const defs = await tx.leadCustomFieldDefinition.findMany({
        where: { tenantId: ctx.tenantId, objectType: 'LEAD', key: { in: Object.keys(input.custom) } },
      });
      for (const def of defs) {
        await tx.leadCustomFieldValue.create({
          data: {
            tenantId: ctx.tenantId,
            leadId: created.id,
            definitionId: def.id,
            ...columnFor(def.type, input.custom[def.key]),
          },
        });
      }
    }

    await tx.leadStageHistory.create({
      data: { tenantId: ctx.tenantId, leadId: created.id, toStageId: stage.id, changedById: ctx.actor.id },
    });

    if (ownerId) {
      await tx.leadAssignmentHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: created.id,
          toOwnerId: ownerId,
          assignedById: ctx.actor.id,
          reason: 'CREATED',
        },
      });
    }

    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'lead', recordId: created.id, newValue: { reference, stage: stage.key } },
      tx,
    );
    return created;
  });

  // 3. Everything downstream runs off the transaction, after commit. An automation
  //    must never observe a state that was rolled back.
  await Promise.all([
    enqueue('distribution', 'assign-lead', { tenantId: ctx.tenantId, leadId: lead.id }, { skip: !!ownerId }),
    enqueue(
      'sla',
      'lead-first-contact',
      { tenantId: ctx.tenantId, leadId: lead.id },
      {
        skip: !lead.slaDueAt,
        delayMs: lead.slaDueAt ? Math.max(lead.slaDueAt.getTime() - Date.now(), 0) : undefined,
      },
    ),
    enqueue('automation', 'trigger', {
      tenantId: ctx.tenantId,
      event: 'record.created',
      object: 'LEAD',
      recordId: lead.id,
    }),
  ]);

  /**
   * The "notify" step this function's own comment has always listed.
   *
   * Deliberately after the commit and outside the Promise.all above: those are
   * queue writes that may be skipped, this is a database write that must see the
   * committed lead. `notifyCrm` excludes the actor, so the common case — a rep
   * creating a lead for themselves — sends nothing, and only a lead created
   * *for* somebody else reaches a bell.
   */
  await notifyCrm(ctx, {
    event: 'lead.created',
    ownerId,
    title: `New lead: ${lead.fullName}`,
    body: lead.reference,
    objectType: 'lead',
    recordId: lead.id,
    priority: 'HIGH',
  });

  emit(ctx, 'lead.created', { leadId: lead.id, duplicates: duplicates.length });
  return lead;
}

function columnFor(type: string, value: unknown) {
  switch (type) {
    case 'NUMBER':
    case 'CURRENCY':
    case 'PERCENTAGE':
      return { valueNumber: value as any };
    case 'CHECKBOX':
      return { valueBool: Boolean(value) };
    case 'DATE':
    case 'DATETIME':
      return { valueDate: new Date(value as string) };
    case 'MULTI_SELECT':
    case 'GEO_POINT':
    case 'FORMULA':
      return { valueJson: value as any };
    default:
      return { valueText: value == null ? null : String(value) };
  }
}
