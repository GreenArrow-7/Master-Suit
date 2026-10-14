import { withTx, prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { can } from '@/lib/security/rbac';
import { assertAssignableUser } from '@/lib/security/record-scope';
import {
  applyFieldSecurity,
  loadFieldRules,
  seesField,
  type FieldRule,
  type SensitiveFields,
} from '@/lib/security/fieldSecurity';
import { findDuplicates } from './findDuplicates';
import { assertLeadSource } from './leadSources';
import { withSourceScore } from './scoring';
import { customForCreate } from './customFields';
import { normalizePhone } from './normalizePhone';
import { nextReference } from '../shared/reference';
import { enqueue } from '@/lib/queue';
import { notifyCrm } from '../crm/notify';
import { recordTargetProgress } from '../targets/progress';

/**
 * A lead's contact details, and how each reads to a role without
 * `leads:VIEW_SENSITIVE_FIELDS` — the switch in the role editor. The main phone
 * and email joined in M2-06; masked rather than removed, because an absent
 * number reads as "none on file" and sends somebody hunting for one.
 */
export const LEAD_SENSITIVE_FIELDS = {
  phone: 'MASK_PARTIAL',
  phoneNormalized: 'MASK_PARTIAL',
  whatsappNumber: 'MASK_PARTIAL',
  secondaryPhone: 'MASK_PARTIAL',
  email: 'MASK_EMAIL',
  secondaryEmail: 'MASK_EMAIL',
  addressLine: 'HIDE',
  postalCode: 'HIDE',
} as const satisfies SensitiveFields;

/**
 * A lead's number kept outside the lead row — one of its other numbers
 * (LeadPhone), the number a call to it went to — read exactly as the lead's own
 * `phone` reads to this role.
 */
export const asLeadPhone = (ctx: Ctx, rules: Map<string, FieldRule>, value: string | null): string | null =>
  (applyFieldSecurity(ctx, 'LEAD', rules, { phone: value }, LEAD_SENSITIVE_FIELDS).phone as string | null) ?? null;

/**
 * The email and phone clauses of a lead search. A typed number, in any format,
 * is normalised as the lead's numbers were (`normalizePhone`) and matched
 * against the main number and every other number (LeadPhone). A role that sees
 * them masked finds a lead by the whole value only: a few fragment searches
 * would read a masked number back digit by digit, while the whole value tells
 * the searcher nothing they did not type.
 */
function contactSearch(ctx: Ctx, rules: Map<string, FieldRule>, q: string) {
  const sees = (field: 'phone' | 'email') => seesField(ctx, 'LEAD', rules, field, LEAD_SENSITIVE_FIELDS);
  const number = normalizePhone(q);
  return [
    sees('email')
      ? { email: { contains: q, mode: 'insensitive' as const } }
      : { email: { equals: q.trim(), mode: 'insensitive' as const } },
    ...(sees('phone') ? [{ phone: { contains: q } }] : []),
    ...(number ? [{ phoneNormalized: number }, { phones: { some: { normalized: number } } }] : []),
  ];
}

/**
 * The lead search every list answers `q` with — the grid, the board, the v1
 * list API, the CSV export, the assistant: name, company, reference, and
 * `contactSearch`'s email and numbers.
 */
export function leadSearch(ctx: Ctx, rules: Map<string, FieldRule>, q: string) {
  return {
    OR: [
      { fullName: { contains: q, mode: 'insensitive' as const } },
      { company: { contains: q, mode: 'insensitive' as const } },
      { reference: { contains: q, mode: 'insensitive' as const } },
      ...contactSearch(ctx, rules, q),
    ],
  };
}

/**
 * Calls on their way out. A call with a lead or a contact holds that person's
 * number — the one dialled, or on an inbound call the one that rang in
 * (`callerNumber`) — and it reads as their phone does: the lead's field rules
 * and sensitive fields, or the contact's field rules. The other side is the
 * workspace's own line.
 */
export async function maskCallNumbers<
  T extends {
    leadId: string | null;
    contactId?: string | null;
    recipientNumber: string | null;
    direction?: string;
    callerNumber?: string | null;
  },
>(ctx: Ctx, calls: T[]): Promise<T[]> {
  const toLead = calls.some((call) => call.leadId);
  const toContact = calls.some((call) => !call.leadId && call.contactId);
  if (!toLead && !toContact) return calls;
  const [leadRules, contactRules] = await Promise.all([
    toLead ? loadFieldRules(ctx, 'LEAD') : new Map<string, FieldRule>(),
    toContact ? loadFieldRules(ctx, 'CONTACT') : new Map<string, FieldRule>(),
  ]);
  const asPhone = (call: T, value: string | null) =>
    call.leadId
      ? asLeadPhone(ctx, leadRules, value)
      : ((applyFieldSecurity(ctx, 'CONTACT', contactRules, { phone: value }).phone as string | null) ?? null);
  return calls.map((call) => {
    if (!call.leadId && !call.contactId) return call;
    return call.direction === 'INBOUND'
      ? { ...call, callerNumber: asPhone(call, call.callerNumber ?? null) }
      : { ...call, recipientNumber: asPhone(call, call.recipientNumber) };
  });
}

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
  const phoneNormalized = input.phone ? normalizePhone(input.phone) : null;

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
  // With it, only to someone their ASSIGN scope reaches (404 otherwise).
  const ownerId = input.ownerId && can(ctx, 'leads', 'ASSIGN') ? input.ownerId : ctx.actor.id;
  if (ownerId !== ctx.actor.id) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', ownerId);
  // The catalogue entry it is attributed to: this workspace's, or not found.
  const sourceId = (input.sourceId as string | undefined) ?? null;
  if (sourceId) await assertLeadSource(prisma, ctx.tenantId, sourceId);
  // The workspace's own fields checked by type (M4-13): a wrong one is a 422, not a failed insert.
  const custom = await customForCreate(prisma, ctx.tenantId, input.custom ?? {});

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
        // The entry, and the points a lead from it starts with (M4-11).
        ...(await withSourceScore(tx, ctx.tenantId, sourceId)),
        campaignName: (input.campaignName as string) ?? null,
        campaignId: (input.campaignId as string) ?? null,
        nationality: (input.nationality as string) ?? null,
        // On unless switched off (the column's default), as every other way in leaves it.
        ...(input.phoneIsWhatsapp !== undefined && { phoneIsWhatsapp: Boolean(input.phoneIsWhatsapp) }),
        stageId: stage.id,
        ownerId,
        assignedAt: ownerId ? new Date() : null,
        priority: (input.priority as any) ?? 'MEDIUM',
        tags: (input.tags as string[]) ?? [],
        customData: custom.data as any,
        slaDueAt: stage.slaMinutes ? new Date(Date.now() + stage.slaMinutes * 60_000) : null,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    // Normalized custom-field values; Lead.customData above is the read projection.
    for (const row of custom.rows) {
      await tx.leadCustomFieldValue.create({ data: { tenantId: ctx.tenantId, leadId: created.id, ...row } });
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

  if (ownerId) await recordTargetProgress(ctx, ownerId, 'LEADS_ASSIGNED');

  return lead;
}
