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
import { connectionCredentials } from '@/lib/integrations/connection';
import { applySocialComment } from '@/services/social/applySocialComment';
import { ingestProviderLead } from '@/services/leads/ingestProviderLead';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { normalizePhone } from '@/services/leads/normalizePhone';
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
    case 'SOCIAL_COMMENT_RECEIVED':
      return applySocialComment({ tenantId, connectionId, event });
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

  /**
   * Everything below the Graph call is provider-agnostic and lives in
   * services/leads/ingestProviderLead.ts.
   *
   * This function's job is now exactly the part only Meta can do: exchange a
   * `leadgen_id` for the answers, and map Meta's field names onto the common
   * shape. Deduplication, routing, attribution merging, stage and source
   * selection, distribution and automation are shared with every other source —
   * which is what lets the demo generator exercise this pipeline instead of a
   * parallel one.
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

  return ingestProviderLead({
    tenantId,
    provider: `meta:${connectionId}`,
    externalLeadId: leadgenId,
    occurredAt: event.occurredAt,
    identity: {
      fullName: answers.full_name ?? ([answers.first_name, answers.last_name].filter(Boolean).join(' ').trim() || null),
      email: answers.email ?? null,
      phone: answers.phone_number ?? answers.phone ?? null,
    },
    formId: event.lead?.formId ?? null,
    // AD_LEAD_FORM, not SOCIAL: RecordSource already has the precise term for a
    // lead that came from an ad's lead form, and the reports read it. A routing
    // rule may override it — some workspaces report Instagram and Facebook
    // separately.
    source: 'AD_LEAD_FORM',
    sourceDetail: `facebook:${event.lead?.formId ?? 'leadgen'}`,
    attribution,
    attributionKey: 'metaLeadgen',
    /**
     * The webhook route already claimed this delivery on
     * `WebhookEvent(tenantId, 'meta:<id>', externalId)` before enqueuing, and
     * that externalId is the webhook change id rather than the leadgen id — so
     * claiming again here would be a second, different row rather than a
     * duplicate guard. Retries of this job are covered by that first claim.
     */
    alreadyClaimed: true,
  });
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
