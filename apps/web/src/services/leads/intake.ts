/**
 * An enquiry becomes a lead, or a fresh enquiry on the lead that already holds
 * the person's number or email: a portal or ad delivery (`applyEnquiry`), or a
 * QR capture form (`takeEnquiry`).
 *
 * Runs on the `webhook` queue (five attempts, exponential backoff) after the
 * receiver in api/v1/webhooks/leads has verified, stored and de-duplicated the
 * delivery. Reads the stored payload rather than the job's, so fixing a field
 * mapping and replaying the event is enough to recover a badly parsed lead.
 */
import type { RecordSource } from '@prisma/client';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { LEAD_SOURCES, parseEnquiry, type Enquiry, type LeadSourceKey } from '@/lib/integrations/leadSources';
import { findDuplicates } from './findDuplicates';
import { normalizePhone } from './normalizePhone';
import { nextReference } from '../shared/reference';

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
    select: { payload: true, processed: true },
  });
  if (!event || event.processed) return;
  // Thrown, so the delivery waits, stored, rather than becoming a lead in a
  // workspace that can no longer open its leads.
  await assertAnyModuleEntitlement(tenantId, LEAD_MODULES);

  // Stored as the raw body: see the receiver.
  const enquiry = parseEnquiry(JSON.parse(event.payload as string));
  if (enquiry.isTest) return { skipped: 'test' as const };

  const { label, source: recordSource } = LEAD_SOURCES[source];
  return takeEnquiry(tenantId, enquiry, {
    label,
    source: recordSource,
    sourceDetail: enquiry.reference ? `${source}:${enquiry.reference}` : source,
  });
}

/** Where an enquiry came from, as the lead records it. */
export interface EnquiryOrigin {
  /** "Enquiry via …" on the timeline. */
  label: string;
  source: RecordSource;
  sourceDetail: string;
  /** Straight to this agent; none leaves it to distribution. */
  ownerId?: string | null;
}

export async function takeEnquiry(
  tenantId: string,
  enquiry: Pick<Enquiry, 'fullName' | 'email' | 'phones' | 'message' | 'reference' | 'details'>,
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
        stageId: stage.id,
        source: recordSource,
        sourceDetail: origin.sourceDetail,
        // They asked to be contacted.
        consentStatus: 'IMPLIED',
        slaDueAt,
        ...(ownerId && { ownerId, assignedAt: new Date() }),
      },
      select: { id: true },
    });
    if (ownerId) {
      await tx.leadAssignmentHistory.create({
        data: { tenantId, leadId: lead.id, toOwnerId: ownerId, reason: 'CREATED' },
      });
    }
    await addPhones(tx, tenantId, lead.id, numbers, main?.[0], label);
    await tx.leadStageHistory.create({ data: { tenantId, leadId: lead.id, toStageId: stage.id } });
    await timeline(tx, lead.id);
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
