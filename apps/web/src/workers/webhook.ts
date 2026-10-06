import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { applyMetaEvent, type ApplyMetaEventJob } from '@/services/meta/applyEvent';
import { applyEnquiry, type EnquiryJob } from '@/services/leads/intake';

/**
 * Applies provider events that a webhook receiver has already authenticated,
 * stored and deduplicated.
 *
 * The queue is configured for five attempts with exponential backoff, which is
 * §63's requirement: a transient Graph outage or a token being reconnected must
 * not cost a customer enquiry. When the attempts are exhausted BullMQ keeps the
 * job in its failed set — that is the dead-letter state, and `errorMessage` on
 * WebhookEvent is the copy an administrator can see without Redis access.
 */
export const applyWebhookEvent = (data: ApplyMetaEventJob & { externalId: string; provider: string }) =>
  stamped(data, () => applyMetaEvent(data));

/** Property portals and Google Ads lead forms: services/leads/intake.ts. */
export const applyLeadSourceEvent = (data: EnquiryJob) => stamped(data, () => applyEnquiry(data));

async function stamped<T>(data: { tenantId: string; provider: string; externalId: string }, run: () => Promise<T>) {
  try {
    const result = await run();
    await mark(data, true);
    return result;
  } catch (err) {
    // Recorded on every attempt, so the last message an administrator sees
    // is the reason it finally gave up rather than the first thing that
    // went wrong.
    await mark(data, false, (err as Error).message.slice(0, 500));
    throw err;
  }
}

/**
 * Stamps the stored event. Best-effort: losing the bookkeeping must not fail a
 * job whose CRM write already succeeded, or the retry would apply it twice.
 */
async function mark(
  data: { tenantId: string; provider: string; externalId: string },
  processed: boolean,
  errorMessage?: string,
) {
  await prisma.webhookEvent
    .update({
      where: {
        tenantId_provider_externalId: {
          tenantId: data.tenantId,
          provider: data.provider,
          externalId: data.externalId,
        },
      },
      data: {
        processed,
        processedAt: processed ? new Date() : null,
        attempts: { increment: 1 },
        errorMessage: errorMessage ?? null,
      },
    })
    .catch((err) => logger.warn({ err: (err as Error).message }, 'could not stamp webhook event'));
}
