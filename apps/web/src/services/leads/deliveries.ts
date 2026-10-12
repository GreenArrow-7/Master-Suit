/**
 * A lead source's Deliveries tab (Lead Eagle audit rows M6-21, M6-22): every
 * delivery the receiver stored, with what the intake made of it, and a replay
 * that queues the stored body again — after a field map is fixed, or after the
 * queue gave up on it.
 *
 * Listed by source rather than by connection id, so a source disconnected and
 * connected again keeps its history.
 */
import { prisma, withTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { isLeadSource } from '@/lib/integrations/leadSources';
import { enqueue, RETRY } from '@/lib/queue';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { leadsInScope } from '@/lib/security/record-scope';

const PAGE_SIZE = 25;

/** What became of a delivery: the intake's outcome once worked, else where the queue stands. */
export type DeliveryStatus =
  'created' | 'attached' | 'test' | 'anonymous' | 'processed' | 'queued' | 'retrying' | 'dead_lettered';

const statusOf = (e: { processed: boolean; outcome: string | null; attempts: number }): DeliveryStatus =>
  e.processed
    ? ((e.outcome ?? 'processed') as DeliveryStatus)
    : // The queue's last attempt failed: BullMQ keeps the job in its failed set and stops.
      e.attempts >= RETRY.webhook.attempts
      ? 'dead_lettered'
      : e.attempts > 0
        ? 'retrying'
        : 'queued';

/** A lead source this workspace has connected; anything else is not found. */
async function storedProvider(ctx: Ctx, provider: string) {
  if (!isLeadSource(provider)) throw NotFound('Lead source');
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    select: { id: true },
  });
  if (!connection) throw NotFound('Connection');
  // The receiver stores `<source>:<connection id>`.
  return { startsWith: `${provider}:` };
}

export async function listDeliveries(ctx: Ctx, provider: string, page = 1) {
  const rows = await prisma.webhookEvent.findMany({
    where: { tenantId: ctx.tenantId, provider: await storedProvider(ctx, provider) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      createdAt: true,
      processed: true,
      attempts: true,
      errorMessage: true,
      outcome: true,
      leadId: true,
    },
  });
  const shown = rows.slice(0, PAGE_SIZE);
  // Named and linked only for a viewer whose leads scope reaches it.
  const leads = await leadsInScope(
    ctx,
    shown.map((r) => r.leadId),
  );
  return {
    page,
    hasMore: rows.length > PAGE_SIZE,
    deliveries: shown.map((r) => {
      const lead = r.leadId ? leads.get(r.leadId) : undefined;
      return {
        id: r.id,
        receivedAt: r.createdAt,
        status: statusOf(r),
        attempts: r.attempts,
        error: r.errorMessage,
        lead: lead ? { id: lead.id, name: lead.fullName } : null,
      };
    }),
  };
}

/** Queue the stored body again, read through the source's field map as it is now. */
export async function replayDelivery(ctx: Ctx, provider: string, id: string) {
  const stored = await storedProvider(ctx, provider);
  const event = await withTx(ctx.tenantId, async (tx) => {
    const event = await tx.webhookEvent.findFirst({
      where: { tenantId: ctx.tenantId, id, provider: stored },
      select: {
        provider: true,
        externalId: true,
        processed: true,
        attempts: true,
        errorMessage: true,
        outcome: true,
        leadId: true,
      },
    });
    if (!event) throw NotFound('Delivery');
    // A fresh count, so the replay gets the queue's full set of attempts.
    await tx.webhookEvent.update({
      where: { tenantId: ctx.tenantId, id },
      data: { processed: false, processedAt: null, attempts: 0, errorMessage: null },
    });
    await audit(
      ctx,
      {
        event: 'INTEGRATION_MODIFIED',
        objectType: 'webhook_event',
        recordId: id,
        metadata: {
          action: 'delivery.replayed',
          provider,
          previous: {
            status: statusOf(event),
            attempts: event.attempts,
            error: event.errorMessage,
            leadId: event.leadId,
          },
        },
      },
      tx,
    );
    return event;
  });

  // `fresh`: the same payload's job id would converge on the finished (or failed) job BullMQ keeps.
  const job = { tenantId: ctx.tenantId, provider: event.provider, externalId: event.externalId, source: provider };
  if (!(await enqueue('webhook', 'lead-source.enquiry', job, { fresh: true }))) {
    throw new AppError(503, 'queue-unavailable', 'The queue could not be reached. Replay it again shortly.');
  }
  return { id, status: 'queued' as const };
}
