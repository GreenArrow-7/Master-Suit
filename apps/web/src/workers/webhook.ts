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

/**
 * Property portals, Google Ads lead forms and Custom webhooks: services/leads/intake.ts.
 * What became of the delivery is kept on it for the Deliveries tab. A job that
 * found the event already worked, or a replay that found the lead it made,
 * leaves the outcome as it was.
 */
export const applyLeadSourceEvent = (data: EnquiryJob) =>
  stamped(
    data,
    () => applyEnquiry(data),
    (result) =>
      !result || 'unchanged' in result
        ? undefined
        : result.skipped
          ? { outcome: result.skipped, leadId: null }
          : { outcome: result.created ? 'created' : 'attached', leadId: result.leadId },
  );

async function stamped<T>(
  data: { tenantId: string; provider: string; externalId: string },
  run: () => Promise<T>,
  outcome?: (result: T) => Outcome | undefined,
) {
  try {
    const result = await run();
    await mark(data, true, undefined, outcome?.(result));
    return result;
  } catch (err) {
    // Recorded on every attempt, so the last message an administrator sees
    // is the reason it finally gave up rather than the first thing that
    // went wrong.
    await mark(data, false, (err as Error).message.slice(0, 500));
    throw err;
  }
}

type Outcome = { outcome: string; leadId: string | null };

/**
 * Stamps the stored event. Best-effort: losing the bookkeeping must not fail a
 * job whose CRM write already succeeded, or the retry would apply it twice.
 */
async function mark(
  data: { tenantId: string; provider: string; externalId: string },
  processed: boolean,
  errorMessage?: string,
  outcome?: Outcome,
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
        ...outcome,
      },
    })
    .catch((err) => logger.warn({ err: (err as Error).message }, 'could not stamp webhook event'));
}
