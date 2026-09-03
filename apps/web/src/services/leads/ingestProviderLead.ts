import type { RecordSource } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { categoriseIntegrationError, httpStatusOf, recordIntegrationEvent } from '@/services/integrations/eventLog';
import { enqueue } from '@/lib/queue';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { nextReference } from '@/services/shared/reference';

/**
 * The one path an inbound lead takes, whoever sent it.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 *
 * This logic lived inside `applyLeadgen` in services/meta/applyEvent.ts, welded
 * to the half above it that exchanges a `leadgen_id` for answers through the
 * Graph API. That made "a lead arrived from somewhere" inseparable from "Meta
 * sent it", so any second source — a demo generator, a website form, WhatsApp —
 * could only be built by duplicating deduplication, routing, attribution,
 * assignment and automation, or by bypassing them.
 *
 * A second copy of this would not stay in step. Duplicate detection and the
 * distribution hand-off are exactly the things that quietly diverge, and the
 * divergence shows up as a customer contacted twice or not at all.
 *
 * So the provider-specific part is now only *normalisation*: an adapter turns
 * whatever the provider sent into `ProviderLeadEvent` and calls this. Everything
 * after that point is identical for every source, which is the property that
 * makes a demo lead worth generating — it exercises the real pipeline rather
 * than a parallel one.
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 *
 * Keyed on `(tenantId, provider, externalLeadId)` via `WebhookEvent`'s unique
 * constraint — the same one the Meta receiver already uses for redeliveries.
 * Claiming it here rather than at each entry point means a provider that has no
 * webhook (the demo generator) gets the same protection as one that does, and
 * replaying an event is a no-op rather than a second customer record.
 */
export interface ProviderLeadEvent {
  tenantId: string;
  /** Namespaced provider identity, e.g. `meta:<connectionId>` or `demo:FACEBOOK`. */
  provider: string;
  /** The provider's own id for this lead. Idempotency key with tenant + provider. */
  externalLeadId: string;
  occurredAt: Date;
  identity: {
    fullName?: string | null;
    email?: string | null;
    /** As the provider sent it; normalised here, both forms are stored. */
    phone?: string | null;
  };
  /** The provider's form, when it has one. Routing rules are keyed on it. */
  formId?: string | null;
  /** What the CRM should call this. Adapters pick; a routing rule may override. */
  source: RecordSource;
  sourceDetail: string;
  /**
   * Provider identifiers worth keeping for reconciliation, stored under
   * `attributionKey` inside `Lead.customData`.
   */
  attribution: Record<string, unknown>;
  attributionKey: string;
  /** Skip the WebhookEvent claim — for callers that already made it. */
  alreadyClaimed?: boolean;
}

export type IngestResult =
  { leadId: string; created: boolean } | { skipped: 'duplicate-event' | 'routing-disabled' | 'no-identity' };

/**
 * Claims `(tenantId, provider, externalLeadId)`, or reports it already taken.
 *
 * The unique constraint is the whole mechanism — a read-then-write would race
 * two concurrent deliveries of the same event straight past each other.
 */
async function claim(event: ProviderLeadEvent): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        tenantId: event.tenantId,
        provider: event.provider,
        externalId: event.externalLeadId,
        eventType: 'LEAD_CREATED',
        payload: {
          source: event.source,
          formId: event.formId ?? null,
          occurredAt: event.occurredAt.toISOString(),
        },
      },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return false;
    throw error;
  }
}

/**
 * Ingests one provider lead and writes down what became of it.
 *
 * The recording wraps the work rather than living inside it because every one of
 * the five exits is an answer somebody wants: a lead was created, a lead was
 * attached to a customer who already existed, the delivery was a redelivery, the
 * routing rule is switched off, or the payload carried nothing to contact anyone
 * on. Before this, four of those five were a log line and then nothing.
 */
export async function ingestProviderLead(event: ProviderLeadEvent): Promise<IngestResult> {
  const { tenantId } = event;

  const common = {
    tenantId,
    provider: event.provider,
    direction: 'INBOUND' as const,
    operation: 'lead',
    externalId: event.externalLeadId,
  };

  try {
    const result = await runIngest(event);
    await recordIntegrationEvent(
      'leadId' in result
        ? {
            ...common,
            outcome: 'OK',
            detail: result.created ? 'lead created' : 'attached to an existing customer',
            entityType: 'Lead',
            entityId: result.leadId,
          }
        : {
            ...common,
            // Not a failure of the provider, and not a success either: nothing
            // was produced, on purpose. SKIPPED is what makes the difference
            // visible without raising an alarm about working behaviour.
            outcome: result.skipped === 'no-identity' ? 'FAILED' : 'SKIPPED',
            ...(result.skipped === 'no-identity'
              ? // The provider sent a form submission with no name, email or
                // phone. Nothing on this side can fix that, and it is the one
                // skip that means something is actually wrong.
                { errorCategory: 'INVALID_REQUEST' as const, detail: 'the submission carried no name, email or phone' }
              : { detail: SKIP_DETAIL[result.skipped] }),
          },
    );
    return result;
  } catch (err) {
    await recordIntegrationEvent({
      ...common,
      outcome: 'FAILED',
      errorCategory: categoriseIntegrationError(err),
      detail: err instanceof Error ? err.message : String(err),
      httpStatus: httpStatusOf(err),
    });
    throw err;
  }
}

const SKIP_DETAIL: Record<'duplicate-event' | 'routing-disabled', string> = {
  'duplicate-event': 'a redelivery of an event already ingested — the first one was kept',
  'routing-disabled': 'the lead form routing rule for this form is switched off',
};

async function runIngest(event: ProviderLeadEvent): Promise<IngestResult> {
  const { tenantId } = event;

  if (!event.alreadyClaimed && !(await claim(event))) {
    logger.info(
      { tenantId, provider: event.provider, externalLeadId: event.externalLeadId },
      'provider lead already ingested — not creating a second one',
    );
    return { skipped: 'duplicate-event' };
  }

  const fullName = event.identity.fullName?.trim() || null;
  const email = event.identity.email?.trim().toLowerCase() || null;
  const rawPhone = event.identity.phone?.trim() || null;
  const phoneNormalized = rawPhone ? normalizePhone(rawPhone, 'AE') : null;

  // A lead nobody can be contacted on is not a lead.
  if (!fullName && !email && !phoneNormalized) {
    logger.warn({ tenantId, provider: event.provider }, 'provider lead carried no identifying field');
    return { skipped: 'no-identity' };
  }

  const [existing] = await findDuplicates(tenantId, { email, phoneNormalized, fullName });

  /**
   * An existing customer gets the touch recorded, not rewritten.
   *
   * `source` and `sourceDetail` are left alone deliberately: someone who first
   * arrived through the website and later filled in a Facebook form is still a
   * website lead. And `customData` is merged rather than assigned — it is a
   * single Json column shared with whatever else the tenant keeps on a lead, so
   * an object literal would silently delete all of it.
   */
  if (existing) {
    const current = await prisma.lead.findFirst({
      where: { id: existing.id, tenantId },
      select: { customData: true },
    });
    await prisma.lead.update({
      where: { id: existing.id, tenantId },
      data: {
        lastActivityAt: event.occurredAt,
        customData: {
          ...((current?.customData ?? {}) as Record<string, unknown>),
          [event.attributionKey]: event.attribution,
        },
      },
    });
    logger.info(
      { tenantId, leadId: existing.id, provider: event.provider },
      'provider lead attached to existing customer',
    );
    return { leadId: existing.id, created: false };
  }

  /**
   * What this form means to the CRM, if an administrator has said.
   *
   * The routing table is keyed on `(tenantId, providerFormId)` and is consulted
   * for any provider that supplies a form id. A disabled rule stops lead
   * creation without discarding the event — the claim above is already
   * committed, so re-enabling the form does not lose the record that it fired.
   */
  const routing = event.formId
    ? await prisma.metaLeadFormRouting.findUnique({
        where: { tenantId_providerFormId: { tenantId, providerFormId: event.formId } },
        select: {
          id: true,
          enabled: true,
          source: true,
          stageId: true,
          priority: true,
          assignedUserId: true,
          assignedTeamId: true,
        },
      })
    : null;

  if (routing && !routing.enabled) {
    logger.info({ tenantId, provider: event.provider, formId: event.formId }, 'lead form routing is disabled');
    return { skipped: 'routing-disabled' };
  }

  // The rule's stage when it names one, the tenant default otherwise. A rule
  // whose stage was deleted falls back rather than failing the ingestion.
  const stage = routing?.stageId
    ? await prisma.leadStage.findFirst({ where: { tenantId, id: routing.stageId }, select: { id: true } })
    : null;
  const fallbackStage =
    stage ?? (await prisma.leadStage.findFirst({ where: { tenantId, isDefault: true }, select: { id: true } }));
  if (!fallbackStage) throw new Error('tenant has no default lead stage');

  const lead = await withTx(tenantId, async (tx) =>
    tx.lead.create({
      data: {
        tenantId,
        reference: await nextReference(tx, tenantId, 'LEAD'),
        fullName: fullName ?? email ?? phoneNormalized!,
        email,
        phone: rawPhone,
        phoneNormalized,
        stageId: fallbackStage.id,
        source: routing?.source ?? event.source,
        priority: routing?.priority ?? 'MEDIUM',
        ownerId: routing?.assignedUserId ?? null,
        teamId: routing?.assignedTeamId ?? null,
        sourceDetail: event.sourceDetail,
        // They asked to be contacted.
        consentStatus: 'IMPLIED',
        // customData, not campaignId: Lead.campaignId is a foreign key to a CRM
        // Campaign, and putting a provider's ad id in it would point at nothing.
        customData: { [event.attributionKey]: event.attribution },
      },
      select: { id: true },
    }),
  );

  if (routing) {
    // Best-effort: the lead is committed, and failing to stamp "last lead" must
    // not send the job back through ingestion.
    await prisma.metaLeadFormRouting
      .update({ where: { id: routing.id }, data: { lastLeadAt: event.occurredAt } })
      .catch(() => {});
  }

  /**
   * The same after-commit pipeline a website or manual lead gets.
   *
   * Distribution is skipped only when the rule already named an owner — running
   * it anyway would let the engine reassign a lead an administrator deliberately
   * routed. A rule naming only a team still goes through distribution, which is
   * what picks a person within it.
   */
  await Promise.all([
    ...(routing?.assignedUserId ? [] : [enqueue('distribution', 'assign-lead', { tenantId, leadId: lead.id })]),
    enqueue('automation', 'trigger', { tenantId, event: 'record.created', object: 'LEAD', recordId: lead.id }),
  ]);

  logger.info({ tenantId, leadId: lead.id, provider: event.provider }, 'provider lead created');
  return { leadId: lead.id, created: true };
}
