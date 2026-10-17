/**
 * An enquiry becomes a lead, or a fresh enquiry on the lead that already holds
 * the person's number or email: a portal or ad delivery or a portal's lead email
 * (`applyEnquiry`), or a QR capture form, a website form, a new WhatsApp number
 * or an unknown caller (`takeEnquiry`).
 *
 * Runs on the `webhook` queue (five attempts, exponential backoff) after the
 * receiver in api/v1/webhooks/leads has verified, stored and de-duplicated the
 * delivery. Reads the stored payload rather than the job's, so fixing a field
 * mapping and replaying the event is enough to recover a badly parsed lead.
 */
import type { ConsentStatus, RecordSource } from '@prisma/client';
import type { SettingField } from '@/lib/integrations/registry';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { audit } from '@/lib/security/audit';
import {
  assertAnyModuleEntitlement,
  hasAnyModuleEntitlement,
  hasModuleEntitlement,
  LEAD_MODULES,
} from '@/lib/security/entitlements';
import type { Ctx } from '@/lib/security/rbac';
import {
  fieldMapOf,
  LEAD_SOURCES,
  parseEnquiry,
  parsePortalEmail,
  type Enquiry,
  type LeadSourceKey,
} from '@/lib/integrations/leadSources';
import { findDuplicates } from './findDuplicates';
import { leadSourceIdFor } from './leadSources';
import { takeRequirement } from './requirement';
import { withSourceScore } from './scoring';
import { normalizePhone } from './normalizePhone';
import { nextReference } from '../shared/reference';
import { notifyCrm } from '../crm/notify';

export interface EnquiryJob {
  tenantId: string;
  /** The stored event's provider: `<source>:<connection id>`. */
  provider: string;
  externalId: string;
  source: LeadSourceKey;
}

export async function applyEnquiry({ tenantId, provider, externalId, source }: EnquiryJob) {
  const event = await prisma.webhookEvent.findUnique({
    where: { tenantId_provider_externalId: { tenantId, provider, externalId } },
    select: { payload: true, processed: true, leadId: true },
  });
  if (!event || event.processed) return;
  // Thrown, so the delivery waits, stored, rather than becoming a lead in a
  // workspace that can no longer open its leads.
  await assertAnyModuleEntitlement(tenantId, LEAD_MODULES);

  // Stored as the raw body: see the receiver. Read through the source's field
  // map as it is now, so a replay after the map is fixed reads it right.
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider: source } },
    select: { metadata: true },
  });
  const payload = JSON.parse(event.payload as string);
  const fieldMap = fieldMapOf(connection?.metadata);
  // A portal's lead email is that portal's lead (M6-12); any other email is kept unread.
  const mail = source === 'inbound_email' ? parsePortalEmail(payload, fieldMap) : null;
  if (source === 'inbound_email' && !mail) return { skipped: 'unparsed' as const };
  const kind = mail?.portal ?? source;
  const enquiry = mail?.enquiry ?? parseEnquiry(payload, fieldMap);
  if (enquiry.isTest) return { skipped: 'test' as const };

  const { label, source: recordSource } = LEAD_SOURCES[kind];
  return takeEnquiry(tenantId, enquiry, {
    label: mail ? `${label} email` : label,
    source: recordSource,
    sourceDetail: enquiry.reference ? `${kind}:${enquiry.reference}` : kind,
    // The workspace's catalogue entry for this kind of connection (M4-03). The
    // defaults have none for a Custom webhook: its leads land on one once an
    // administrator adds "Custom webhook" under Sources.
    sourceId: await leadSourceIdFor(prisma, tenantId, kind),
    reached: event.leadId,
  });
}

/** The connection setting that decides it (lib/integrations/registry.ts). */
export type CaptureSetting = 'createLeadsFromNewNumbers' | 'createLeadsFromUnknownCallers';

/**
 * Whether a number nobody holds becomes a lead: a WhatsApp sender (M6-10,
 * `createLeadsFromNewNumbers` on the WhatsApp Business connection) or a caller
 * (M6-11, `createLeadsFromUnknownCallers` on a telephony one). The setting once
 * an administrator has saved it; until then on for callers, and for WhatsApp
 * only in a Lead Eagle workspace (elsewhere a new number opens a conversation
 * only, as it always did). Never without a lead product.
 */
export async function capturesUnknown(tenantId: string, setting: CaptureSetting, metadata: unknown) {
  if (!(await hasAnyModuleEntitlement(tenantId, LEAD_MODULES))) return false;
  const saved = (metadata as Record<string, unknown> | null)?.[setting];
  if (typeof saved === 'boolean') return saved;
  return setting === 'createLeadsFromUnknownCallers' || hasModuleEntitlement(tenantId, 'LEAD_EAGLE');
}

/**
 * A connection's switches as Integrations lists them: each as saved or as its
 * default, the way `capturesUnknown` reads it, and none in a workspace without
 * a lead product, where they would switch nothing.
 */
export async function withSwitches(tenantId: string, fields: readonly SettingField[], metadata: unknown) {
  const leads = await hasAnyModuleEntitlement(tenantId, LEAD_MODULES);
  const settings = { ...((metadata ?? {}) as Record<string, unknown>) };
  for (const f of fields.filter((f) => f.toggle)) {
    if (leads) settings[f.key] = await capturesUnknown(tenantId, f.key as CaptureSetting, metadata);
    else delete settings[f.key];
  }
  return { settingFields: fields.filter((f) => leads || !f.toggle), settings };
}

/**
 * A number a contact or a colleague holds: a customer already on the books, or
 * somebody on the staff ringing in from their own phone. Neither is somebody new.
 */
export async function heldInWorkspace(tenantId: string, phoneNormalized: string) {
  const contact = await prisma.contact.findFirst({
    where: { tenantId, phoneNormalized, deletedAt: null },
    select: { id: true },
  });
  if (contact) return true;
  // ponytail: User.phone is stored as typed, so each colleague's is normalised here; a
  // normalised column is the upgrade if a workspace's staff runs into the thousands.
  const staff = await prisma.user.findMany({
    where: { tenantId, deletedAt: null, phone: { not: null } },
    select: { phone: true },
  });
  return staff.some((u) => normalizePhone(u.phone!) === phoneNormalized);
}

/** Where an enquiry came from, as the lead records it. */
export interface EnquiryOrigin {
  /** "Enquiry via …" on the timeline. */
  label: string;
  source: RecordSource;
  sourceDetail: string;
  /** The catalogue entry (LeadSource) a new lead is attributed to. */
  sourceId?: string | null;
  /** Straight to this agent; none leaves it to distribution. */
  ownerId?: string | null;
  /** The person who sent it in (cold data); none is the system, audited as `sourceDetail`. */
  actor?: Ctx;
  /**
   * The lead this enquiry already made or joined: a replayed delivery. Matching
   * it again is the same enquiry, not the client coming back, so nothing is
   * written and nobody is told.
   */
  reached?: string | null;
  /**
   * Implied, for somebody who asked to be contacted. A caller or a message from
   * a new number has not asked for marketing: UNKNOWN, which campaigns pass by.
   */
  consent?: ConsentStatus;
}

export async function takeEnquiry(
  tenantId: string,
  enquiry: Pick<Enquiry, 'fullName' | 'email' | 'phones' | 'message' | 'reference' | 'details'> &
    Partial<Pick<Enquiry, 'requirement'>> & {
      /** A website form may ask for one; the portals never do. */
      company?: string | null;
    },
  origin: EnquiryOrigin,
) {
  // [normalised, as typed], one per distinct number.
  const numbers = [
    ...new Map(
      enquiry.phones.flatMap((raw) => {
        const normalized = normalizePhone(raw);
        return normalized ? [[normalized, raw] as const] : [];
      }),
    ),
  ];
  if (!enquiry.fullName && !enquiry.email && !numbers.length) {
    logger.warn({ tenantId, source: origin.sourceDetail }, 'enquiry named nobody');
    return { skipped: 'anonymous' as const };
  }

  // A number or an email, never a name alone: two people share a name every week.
  const match = (
    await findDuplicates(tenantId, {
      email: enquiry.email,
      phoneNormalized: numbers[0]?.[0] ?? null,
      otherPhones: numbers.slice(1).map(([n]) => n),
      fullName: enquiry.fullName,
    })
  ).find((m) => m.matchedOn !== 'fullName');

  if (match && match.id === origin.reached) return { leadId: match.id, created: false, unchanged: true as const };

  const { label, source: recordSource, ownerId } = origin;
  const note = [
    `Enquiry via ${label}`,
    enquiry.reference && `Ref: ${enquiry.reference}`,
    ...enquiry.details,
    enquiry.message,
  ]
    .filter(Boolean)
    .join('\n');
  // Created when missing, as the spreadsheet import does: the note is the only
  // place the enquiry's own words are kept.
  const noteType = await prisma.activityType.upsert({
    where: { tenantId_key: { tenantId, key: 'note' } },
    update: {},
    create: { tenantId, key: 'note', name: 'Note', icon: 'note' },
    select: { id: true },
  });
  const timeline = (tx: TxClient, leadId: string) =>
    tx.activity.create({ data: { tenantId, typeId: noteType.id, leadId, notes: note, source: recordSource } });
  const by = origin.actor ?? { tenantId, source: origin.sourceDetail };

  if (match) {
    await withTx(tenantId, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow({
        where: { tenantId, id: match.id },
        select: { id: true, reference: true, fullName: true, ownerId: true, phoneNormalized: true },
      });
      // A lead with no number yet takes the first one as its main number.
      const main = lead.phoneNormalized ? null : numbers[0];
      await tx.lead.update({
        where: { tenantId, id: lead.id },
        data: { lastActivityAt: new Date(), ...(main && { phone: main[1], phoneNormalized: main[0] }) },
      });
      await addPhones(tx, tenantId, lead.id, numbers, lead.phoneNormalized ?? main?.[0], label);
      await timeline(tx, lead.id);
      // What it wants, unless the lead already has an open search (M6-29).
      await takeRequirement(tx, by, lead.id, enquiry.requirement, lead.ownerId);
      await audit(
        by,
        { event: 'RECORD_UPDATED', objectType: 'lead', recordId: lead.id, metadata: { action: 'lead.enquired_again' } },
        tx,
      );
      // A repeat enquiry is the strongest buying signal there is; its owner hears of it.
      if (lead.ownerId) {
        await tx.notification.create({
          data: {
            tenantId,
            userId: lead.ownerId,
            kind: 'lead.enquiry',
            title: `${lead.fullName} enquired again`,
            body: `${lead.reference} · ${label}`,
            objectType: 'lead',
            recordId: lead.id,
            priority: 'HIGH',
            channels: ['in_app'],
          },
        });
      }
    });
    logger.info({ tenantId, leadId: match.id, source: origin.sourceDetail }, 'enquiry attached to existing lead');
    return { leadId: match.id, created: false };
  }

  const stage = await prisma.leadStage.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true, slaMinutes: true },
  });
  if (!stage) throw new Error('tenant has no default lead stage');
  const slaDueAt = stage.slaMinutes ? new Date(Date.now() + stage.slaMinutes * 60_000) : null;
  const [main] = numbers;

  const lead = await withTx(tenantId, async (tx) => {
    const lead = await tx.lead.create({
      data: {
        tenantId,
        reference: await nextReference(tx, tenantId, 'LEAD'),
        fullName: enquiry.fullName ?? enquiry.email ?? main![1],
        email: enquiry.email,
        phone: main?.[1] ?? null,
        phoneNormalized: main?.[0] ?? null,
        company: enquiry.company ?? null,
        stageId: stage.id,
        source: recordSource,
        sourceDetail: origin.sourceDetail,
        // The entry, and the points a lead from it starts with (M4-11).
        ...(await withSourceScore(tx, tenantId, origin.sourceId)),
        // They asked to be contacted.
        consentStatus: origin.consent ?? 'IMPLIED',
        slaDueAt,
        ...(ownerId && { ownerId, assignedAt: new Date() }),
      },
      select: { id: true, fullName: true, reference: true },
    });
    if (ownerId) {
      await tx.leadAssignmentHistory.create({
        // Who converted it, when someone did: their own cold record is not "given to" them.
        data: {
          tenantId,
          leadId: lead.id,
          toOwnerId: ownerId,
          assignedById: origin.actor?.actor.id ?? null,
          reason: 'CREATED',
        },
      });
    }
    await addPhones(tx, tenantId, lead.id, numbers, main?.[0], label);
    await tx.leadStageHistory.create({ data: { tenantId, leadId: lead.id, toStageId: stage.id } });
    await timeline(tx, lead.id);
    // What it wants, as a requirement on the lead, not only as note text (M6-29).
    await takeRequirement(tx, by, lead.id, enquiry.requirement, ownerId ?? null);
    await audit(by, { event: 'RECORD_CREATED', objectType: 'lead', recordId: lead.id }, tx);
    return lead;
  });

  // The after-commit pipeline every new lead gets: an owner, the first-contact
  // clock, and the workspace's automations.
  await Promise.all([
    enqueue('distribution', 'assign-lead', { tenantId, leadId: lead.id }, { skip: !!ownerId }),
    enqueue(
      'sla',
      'lead-first-contact',
      { tenantId, leadId: lead.id },
      { skip: !slaDueAt, delayMs: slaDueAt ? Math.max(slaDueAt.getTime() - Date.now(), 0) : undefined },
    ),
    enqueue('automation', 'trigger', { tenantId, event: 'record.created', object: 'LEAD', recordId: lead.id }),
  ]);
  // Straight to an agent (a QR code's, a cold record's): told at once, as automatic
  // assignment tells one (audit M17-05). The person who sent it in is not told of it.
  if (ownerId) {
    await notifyCrm(
      { tenantId, actor: { id: origin.actor?.actor.id ?? 'intake' } },
      {
        event: 'lead.assigned',
        ownerId,
        title: `Lead assigned: ${lead.fullName}`,
        body: lead.reference,
        objectType: 'lead',
        recordId: lead.id,
        priority: 'HIGH',
      },
    );
  }
  logger.info({ tenantId, leadId: lead.id, source: origin.sourceDetail }, 'enquiry created a lead');
  return { leadId: lead.id, created: true };
}

/** Every number but the lead's main one; a number it already has is skipped. */
function addPhones(
  tx: TxClient,
  tenantId: string,
  leadId: string,
  numbers: (readonly [string, string])[],
  main: string | null | undefined,
  label: string,
) {
  const extra = numbers.filter(([normalized]) => normalized !== main);
  return extra.length
    ? tx.leadPhone.createMany({
        data: extra.map(([normalized, raw]) => ({ tenantId, leadId, raw, normalized, label, isWhatsapp: true })),
        skipDuplicates: true,
      })
    : null;
}
