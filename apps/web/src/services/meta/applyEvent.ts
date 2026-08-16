/**
 * Turns a normalised Meta event into CRM records.
 *
 * Runs on the `webhook` queue, never in the request that received the callback:
 * Meta must not wait on our database work (§52), and a failure has to be
 * retryable rather than lost inside an HTTP handler (§63). The queue is already
 * configured for five attempts with exponential backoff.
 *
 * Everything here is idempotent. The route deduplicates on
 * `WebhookEvent(tenantId, provider, externalId)` before enqueuing, but a job can
 * still be retried after a partial failure, so each write is an upsert or is
 * keyed on something the provider gave us.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { connectionCredentials } from '@/lib/integrations/connection';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { nextReference } from '@/services/shared/reference';
import { withTx } from '@/lib/db';
import type { NormalizedMetaEvent } from '@/lib/integrations/meta/events';

/** Pinned in one place; Meta sunsets a version roughly two years after release. */
const GRAPH_VERSION = 'v26.0';

export interface ApplyMetaEventJob {
  tenantId: string;
  connectionId: string;
  event: NormalizedMetaEvent;
}

export async function applyMetaEvent({ tenantId, connectionId, event }: ApplyMetaEventJob) {
  switch (event.kind) {
    case 'LEAD_CREATED':
      return applyLeadgen(tenantId, connectionId, event);
    case 'MESSAGE_RECEIVED':
      return applyInboundMessage(tenantId, event);
    case 'MESSAGE_SENT':
    case 'MESSAGE_DELIVERED':
    case 'MESSAGE_READ':
    case 'MESSAGE_FAILED':
      return applyStatus(tenantId, event);
    default:
      logger.warn({ tenantId, kind: event.kind }, 'meta event has no handler');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead Ads (§8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The webhook announces a lead; it does not contain one.
 *
 * `leadgen_id` has to be exchanged for the answers through the Graph API, which
 * needs `leads_retrieval` on a page token. Nothing about the person is in the
 * callback, so a connection whose token has lapsed cannot produce a lead at all
 * — that is a retryable failure, not an empty lead.
 */
async function applyLeadgen(tenantId: string, connectionId: string, event: NormalizedMetaEvent) {
  const leadgenId = event.lead?.leadgenId;
  if (!leadgenId) return;

  const credentials = await connectionCredentials(tenantId, 'meta');
  if (!credentials?.accessToken) {
    // Throw: the queue retries, and an administrator reconnecting inside the
    // backoff window recovers the enquiry. Swallowing it would silently drop a
    // customer who filled in a form (§63).
    throw new Error('meta connection has no access token — cannot retrieve lead');
  }

  const fields = await fetchLeadFields(leadgenId, credentials.accessToken);
  const answers = Object.fromEntries(fields.map((f) => [f.name, f.value]));

  const fullName =
    answers.full_name ?? ([answers.first_name, answers.last_name].filter(Boolean).join(' ').trim() || null);
  const email = answers.email?.trim().toLowerCase() ?? null;
  const rawPhone = answers.phone_number ?? answers.phone ?? null;
  const phoneNormalized = rawPhone ? normalizePhone(rawPhone, 'AE') : null;

  if (!fullName && !email && !phoneNormalized) {
    logger.warn({ tenantId, leadgenId }, 'meta lead carried no identifying field');
    return;
  }

  // The same duplicate rules every other entry point obeys (§9).
  const [existing] = await findDuplicates(tenantId, { email, phoneNormalized, fullName });

  /**
   * Attribution (§40). First touch is written only when the lead is new — a
   * customer who first arrived from the website and later filled in a Facebook
   * form did not become a Facebook lead, and overwriting that is exactly the
   * "thoughtless overwrite" §40 warns against. The Meta identifiers go into
   * metadata either way, so the touch is still recorded on an existing lead.
   */
  const attribution = {
    metaLeadgenId: leadgenId,
    metaFormId: event.lead?.formId ?? null,
    metaAdId: event.lead?.adId ?? null,
    metaAdgroupId: event.lead?.adgroupId ?? null,
    metaPageId: event.lead?.pageId ?? null,
    // No campaign id: the leadgen webhook does not carry one. Resolving it needs
    // a separate Graph call against the ad, which is not done here.
    receivedAt: new Date().toISOString(),
  };

  if (existing) {
    /**
     * Merged, not replaced. `customData` is a single Json column shared with
     * whatever else the tenant keeps on a lead, so assigning an object literal
     * would silently delete all of it — §40's thoughtless overwrite, applied to
     * the customer's own data rather than just their attribution.
     *
     * `source` and `sourceDetail` are deliberately left alone: someone who first
     * arrived through the website and later filled in a Facebook form is still a
     * website lead. This records the touch without rewriting first contact.
     */
    const current = await prisma.lead.findFirst({
      where: { id: existing.id, tenantId },
      select: { customData: true },
    });
    await prisma.lead.update({
      where: { id: existing.id, tenantId },
      data: {
        lastActivityAt: event.occurredAt,
        customData: { ...((current?.customData ?? {}) as Record<string, unknown>), metaLeadgen: attribution },
      },
    });
    logger.info({ tenantId, leadId: existing.id, leadgenId }, 'meta lead attached to existing customer');
    return { leadId: existing.id, created: false };
  }

  /**
   * What this form means to the CRM, if an administrator has said (§20).
   *
   * Without a rule the behaviour is exactly what it was before Phase 2: default
   * stage, default source, distribution engine picks the owner. A rule narrows
   * that, and a disabled rule stops lead creation without discarding the event —
   * the WebhookEvent row is already stored, so turning the form back on does not
   * lose the record that it fired.
   */
  const routing = event.lead?.formId
    ? await prisma.metaLeadFormRouting.findUnique({
        where: { tenantId_providerFormId: { tenantId, providerFormId: event.lead.formId } },
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
    logger.info(
      { tenantId, leadgenId, formId: event.lead?.formId },
      'meta lead form routing is disabled — not creating a lead',
    );
    return { skipped: 'routing-disabled' as const };
  }

  // The rule's stage when it names one, the tenant default otherwise. A rule
  // whose stage was deleted falls back rather than failing the ingestion.
  const stage = routing?.stageId
    ? await prisma.leadStage.findFirst({ where: { tenantId, id: routing.stageId }, select: { id: true } })
    : null;
  const fallbackStage =
    stage ?? (await prisma.leadStage.findFirst({ where: { tenantId, isDefault: true }, select: { id: true } }));
  if (!fallbackStage) throw new Error('tenant has no default lead stage');

  const lead = await withTx(tenantId, async (tx) => {
    return tx.lead.create({
      data: {
        tenantId,
        reference: await nextReference(tx, tenantId, 'LEAD'),
        fullName: fullName ?? email ?? phoneNormalized!,
        email,
        phone: rawPhone,
        phoneNormalized,
        stageId: fallbackStage.id,
        // AD_LEAD_FORM, not SOCIAL: RecordSource already has the precise term
        // for a lead that came from an ad's lead form, and the reports read it.
        // A routing rule may override it — some workspaces report Instagram and
        // Facebook separately.
        source: routing?.source ?? 'AD_LEAD_FORM',
        priority: routing?.priority ?? 'MEDIUM',
        // A named owner or team from the rule; distribution fills the gap below
        // when the rule names neither.
        ownerId: routing?.assignedUserId ?? null,
        teamId: routing?.assignedTeamId ?? null,
        sourceDetail: `facebook:${event.lead?.formId ?? 'leadgen'}`,
        // They completed a lead form asking to be contacted.
        consentStatus: 'IMPLIED',
        // customData, not campaignId: Lead.campaignId is a foreign key to a CRM
        // Campaign, and putting a Meta ad id in it would point at nothing.
        customData: { metaLeadgen: attribution },
      },
      select: { id: true },
    });
  });

  if (routing) {
    // Best-effort: the lead is already committed, and failing to stamp "last
    // lead" must not send the job back through ingestion.
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

  logger.info({ tenantId, leadId: lead.id, leadgenId, connectionId }, 'meta lead created');
  return { leadId: lead.id, created: true };
}

async function fetchLeadFields(leadgenId: string, accessToken: string) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?fields=field_data`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Thrown, so the queue retries: Meta rate-limits and tokens lapse, and both
    // recover without anyone re-submitting the form.
    throw new Error(`graph lead retrieval failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { field_data?: { name?: string; values?: string[] }[] };
  return (data.field_data ?? [])
    .map((f) => ({ name: String(f.name ?? ''), value: String(f.values?.[0] ?? '') }))
    .filter((f) => f.name && f.value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound messages (§24, §29)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A message from a number nobody recognises is still a message.
 *
 * The thread is created before anyone knows who is on the other end — that is
 * §29's "New WhatsApp contact" state — and linked to a lead only when the
 * tenant's own duplicate rules already match one. It never creates a lead: an
 * inbound "wrong number" should not manufacture a customer record.
 */
async function applyInboundMessage(tenantId: string, event: NormalizedMetaEvent) {
  const threadId = event.threadId;
  if (!threadId || !event.messageId) return;

  const phoneNormalized = normalizePhone(threadId, 'AE');
  const [match] = await findDuplicates(tenantId, { phoneNormalized });

  const conversation = await prisma.conversation.upsert({
    where: { tenantId_channel_externalId: { tenantId, channel: 'WHATSAPP', externalId: threadId } },
    create: {
      tenantId,
      channel: 'WHATSAPP',
      providerKey: 'meta',
      externalId: threadId,
      displayName: event.displayName ?? threadId,
      leadId: match?.id ?? null,
      lastMessageAt: event.occurredAt,
      unreadCount: 1,
    },
    update: {
      lastMessageAt: event.occurredAt,
      unreadCount: { increment: 1 },
      // Fill the link in if the customer has since been identified, but never
      // clear one that is already there.
      ...(match?.id ? { leadId: match.id } : {}),
      ...(event.displayName ? { displayName: event.displayName } : {}),
    },
    select: { id: true, leadId: true },
  });

  // Keyed on the provider's message id, so a retried job updates rather than
  // duplicating the message.
  const existing = await prisma.communication.findFirst({
    where: { tenantId, providerMessageId: event.messageId },
    select: { id: true },
  });
  if (existing) return { conversationId: conversation.id, messageId: existing.id, duplicate: true };

  const message = await prisma.communication.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      channel: 'WHATSAPP',
      direction: 'INBOUND',
      status: 'DELIVERED',
      leadId: conversation.leadId,
      fromAddress: threadId,
      toAddress: event.assetId ?? 'business',
      body: event.text ?? null,
      providerKey: 'meta',
      providerMessageId: event.messageId,
      deliveredAt: event.occurredAt,
    },
    select: { id: true },
  });

  return { conversationId: conversation.id, messageId: message.id, duplicate: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery receipts (§33)
// ─────────────────────────────────────────────────────────────────────────────

/** Ranked so a late `sent` cannot pull a message back from `read`. */
const RANK: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 4 };

async function applyStatus(tenantId: string, event: NormalizedMetaEvent) {
  if (!event.messageId || !event.status) return;

  const message = await prisma.communication.findFirst({
    where: { tenantId, providerMessageId: event.messageId },
    select: { id: true, status: true },
  });
  if (!message) {
    // Routine, not an error: a receipt can overtake the response to the send
    // that created the row.
    logger.info({ tenantId, providerMessageId: event.messageId }, 'meta status for unknown message');
    return;
  }

  // Receipts arrive out of order often enough that it is not an anomaly.
  if ((RANK[event.status] ?? 0) < (RANK[message.status] ?? 0)) return;

  await prisma.communication.update({
    where: { id: message.id, tenantId },
    data: {
      status: event.status,
      ...(event.status === 'SENT' ? { sentAt: event.occurredAt } : {}),
      ...(event.status === 'DELIVERED' ? { deliveredAt: event.occurredAt } : {}),
      ...(event.status === 'READ' ? { openedAt: event.occurredAt } : {}),
      ...(event.status === 'FAILED' ? { errorCode: event.errorCode ?? null } : {}),
    },
  });

  return { messageId: message.id, status: event.status };
}
