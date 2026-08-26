import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { applyMetaEvent, type ApplyMetaEventJob } from '@/services/meta/applyEvent';

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
export function startWebhookWorker() {
  return new Worker(
    'webhook',
    async (job) => {
      if (job.name !== 'meta.event') {
        logger.warn({ jobName: job.name }, 'unknown webhook job');
        return;
      }

      const data = job.data as ApplyMetaEventJob & { externalId: string; provider: string };
      try {
        const result = await applyMetaEvent(data);
        await mark(data, true);
        return result;
      } catch (err) {
        // Recorded on every attempt, so the last message an administrator sees
        // is the reason it finally gave up rather than the first thing that
        // went wrong.
        await mark(data, false, (err as Error).message.slice(0, 500));
        throw err;
      }
    },
    { connection: redis },
  );
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
