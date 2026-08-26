/**
 * Meta's webhook vocabulary, normalised once (§15).
 *
 * Facebook Lead Ads, Instagram and WhatsApp all deliver through the same
 * subscription mechanism and the same envelope — `entry[].changes[].value` — but
 * the shape inside `value` differs per product, and Meta renames things between
 * Graph versions. Normalising here means the route, the CRM writes and anything
 * downstream speak one vocabulary, and a Graph upgrade is a change to this file
 * rather than a hunt through the application.
 *
 * Shapes verified against the current documentation rather than recalled:
 *   developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 *   developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

import { normalizeSocialComment, type NormalizedSocialComment } from './comments';

export type MetaEventKind =
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_DELIVERED'
  | 'MESSAGE_READ'
  | 'MESSAGE_FAILED'
  | 'LEAD_CREATED'
  | 'SOCIAL_COMMENT_RECEIVED';

/** Maps onto CommunicationStatus without the caller restating the vocabulary. */
export const STATUS_FOR: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

export interface NormalizedMetaEvent {
  kind: MetaEventKind;
  /**
   * The provider's own identifier for this event, and therefore the idempotency
   * key. A WhatsApp message id (`wamid…`) is unique per message; a status update
   * is keyed by message id *and* status, because one message legitimately
   * produces sent, delivered and read against the same id.
   */
  externalId: string;
  occurredAt: Date;
  /** Which business asset received it — the WhatsApp number id or the page id. */
  assetId?: string;

  /** Messaging events. `threadId` is the customer's handle: a phone or a PSID. */
  threadId?: string;
  displayName?: string;
  text?: string;
  messageId?: string;
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  errorCode?: string;

  /** Facebook/Instagram comment, already provider-normalised. */
  comment?: NormalizedSocialComment;

  /**
   * Lead Ads. Note what is absent: the webhook carries ad and ad-set ids but no
   * campaign id, so campaign attribution needs a follow-up Graph call against
   * the ad — it cannot be read off the payload however much one would like to.
   */
  lead?: {
    leadgenId: string;
    formId?: string;
    pageId?: string;
    adId?: string;
    adgroupId?: string;
  };
}

/** Meta stamps seconds; everything downstream wants a Date. */
const at = (seconds: unknown): Date => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

/**
 * Never throws on a malformed payload.
 *
 * Meta retries anything that is not a 2xx, so an exception here would turn one
 * bad delivery into an indefinite retry loop. Anything unrecognised is simply
 * not returned, and the caller answers 200 having stored the raw event.
 */
export function normalizeMetaWebhook(payload: unknown): NormalizedMetaEvent[] {
  const root = payload as { object?: string; entry?: unknown[] } | null;
  if (!root?.entry || !Array.isArray(root.entry)) return [];

  const events: NormalizedMetaEvent[] = [];

  for (const rawEntry of root.entry) {
    const entry = rawEntry as { id?: unknown; changes?: unknown[] };
    if (!Array.isArray(entry.changes)) continue;

    for (const rawChange of entry.changes) {
      const change = rawChange as { field?: string; value?: Record<string, unknown> };
      const value = change.value;
      if (!value) continue;

      if (change.field === 'leadgen') {
        const leadgenId = str(value.leadgen_id);
        if (!leadgenId) continue;
        events.push({
          kind: 'LEAD_CREATED',
          externalId: `leadgen:${leadgenId}`,
          occurredAt: at(value.created_time),
          assetId: str(value.page_id) ?? str(entry.id),
          lead: {
            leadgenId,
            formId: str(value.form_id),
            pageId: str(value.page_id),
            adId: str(value.ad_id),
            adgroupId: str(value.adgroup_id),
          },
        });
        continue;
      }

      /**
       * Comments. `feed` also carries posts, likes and shares, so the adapter
       * returns null for anything that is not one — this walks the same
       * envelope everything else does rather than standing up a second
       * receiver, which is why the route needed no change to support them.
       */
      if (change.field === 'feed' || change.field === 'comments') {
        const comment = normalizeSocialComment(change.field, value);
        if (!comment) continue;
        events.push({
          kind: 'SOCIAL_COMMENT_RECEIVED',
          // Provider-scoped: Facebook and Instagram mint ids separately, and
          // this is the key the route deduplicates on.
          externalId: `comment:${comment.provider}:${comment.providerCommentId}`,
          occurredAt: comment.commentCreatedAt,
          assetId: comment.providerMediaId ?? str(entry.id),
          comment,
        });
        continue;
      }

      if (change.field !== 'messages') continue;

      const assetId = str((value.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id);

      // Inbound messages. `contacts[]` carries the profile name, which is the
      // only readable label an unknown number has before anyone links it (§29).
      const contacts = (value.contacts as { wa_id?: unknown; profile?: { name?: unknown } }[] | undefined) ?? [];
      const nameFor = (waId?: string) => str(contacts.find((contact) => str(contact.wa_id) === waId)?.profile?.name);

      for (const rawMessage of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const id = str(rawMessage.id);
        const from = str(rawMessage.from);
        if (!id || !from) continue;
        events.push({
          kind: 'MESSAGE_RECEIVED',
          externalId: id,
          occurredAt: at(rawMessage.timestamp),
          assetId,
          threadId: from,
          displayName: nameFor(from),
          messageId: id,
          // Only text is read here. Media arrives as an id that must be fetched
          // and streamed to object storage (§58), which is not this function's
          // job — the raw event is stored, so nothing is lost by not doing it.
          text: str((rawMessage.text as { body?: unknown } | undefined)?.body),
        });
      }

      for (const rawStatus of (value.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const id = str(rawStatus.id);
        const status = STATUS_FOR[String(rawStatus.status)];
        if (!id || !status) continue;
        events.push({
          // `sent` stays MESSAGE_SENT. Reporting it as delivered would claim the
          // handset received something Meta has only accepted for sending, and
          // §27 is explicit that status must not be invented.
          kind: `MESSAGE_${status}` as MetaEventKind,
          // Keyed by message *and* status: one message produces sent, delivered
          // and read against the same id, and all three must be storable.
          externalId: `${id}:${status}`,
          occurredAt: at(rawStatus.timestamp),
          assetId,
          threadId: str(rawStatus.recipient_id),
          messageId: id,
          status,
          errorCode: str((rawStatus.errors as { code?: unknown }[] | undefined)?.[0]?.code),
        });
      }
    }
  }

  return events;
}
