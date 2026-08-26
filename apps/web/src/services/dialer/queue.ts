/**
 * Loading a campaign queue.
 *
 * Who the floor rings today is a campaign decision, not an agent's, so this is
 * gated on `dialer:CREATE` and lives apart from the session code that consumes
 * it. Two sources, because they are the two ways a real campaign gets built: a
 * marketing list somebody curated, or a filter over leads.
 */
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { normalizePhone } from '@/services/leads/normalizePhone';

/** One request cannot load more than this, so a mis-set filter is survivable. */
const MAX_PER_LOAD = 5_000;

export interface LoadQueueInput {
  tenantId: string;
  actorId: string;
  campaignId: string;
  /** A curated MarketingList, or a stage filter over leads. */
  listId?: string;
  stageIds?: string[];
  ownerIds?: string[];
  limit?: number;
}

export interface LoadResult {
  loaded: number;
  skippedNoPhone: number;
  skippedDuplicate: number;
  skippedSuppressed: number;
}

export async function loadQueue(input: LoadQueueInput): Promise<LoadResult> {
  const limit = Math.min(input.limit ?? MAX_PER_LOAD, MAX_PER_LOAD);

  // Deliberately *not* the same rule the dialer applies. Calling needs the
  // campaign to be RUNNING; building its list does not, because a list is
  // curated before the campaign starts and that is the order of the work. What
  // is refused is the two states a campaign does not come back from: adding
  // people to a finished or cancelled campaign is either a mistake or somebody
  // reaching for a list that was stopped on purpose.
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, tenantId: input.tenantId, deletedAt: null },
    select: { status: true },
  });
  if (!campaign) throw NotFound('Campaign');
  if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
    throw Conflict(
      campaign.status === 'COMPLETED'
        ? 'This campaign is complete. Reopen it before adding anybody to its queue.'
        : 'This campaign was cancelled. Nobody else should be added to its queue.',
    );
  }

  if (!input.listId && !input.stageIds?.length) {
    throw Invalid([
      { field: 'listId', code: 'required', message: 'Choose a marketing list or a lead stage to load from.' },
    ]);
  }

  // The audience. A marketing list stores bare record ids, so either way this
  // ends up as a set of leads.
  const leadIds = input.listId
    ? (
        await prisma.marketingListMember.findMany({
          where: { tenantId: input.tenantId, listId: input.listId },
          select: { recordId: true },
          take: limit,
        })
      ).map((m) => m.recordId)
    : undefined;

  const leads = await prisma.lead.findMany({
    where: {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(leadIds ? { id: { in: leadIds } } : {}),
      ...(input.stageIds?.length ? { stageId: { in: input.stageIds } } : {}),
      ...(input.ownerIds?.length ? { ownerId: { in: input.ownerIds } } : {}),
    },
    select: { id: true, fullName: true, phone: true, phoneNormalized: true, consentStatus: true, score: true },
    // Highest score first: a queue worked top-down should start with the people
    // most likely to answer, and `position` freezes that order once loaded.
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: limit,
  });

  const result: LoadResult = { loaded: 0, skippedNoPhone: 0, skippedDuplicate: 0, skippedSuppressed: 0 };
  const rows: {
    tenantId: string;
    campaignId: string;
    leadId: string;
    displayName: string;
    phone: string;
    phoneNormalized: string;
    position: number;
    createdById: string;
  }[] = [];

  const seen = new Set<string>();
  let position = await prisma.campaignContact.count({
    where: { tenantId: input.tenantId, campaignId: input.campaignId },
  });

  for (const lead of leads) {
    // `WITHDRAWN` is this platform's do-not-contact: somebody asked not to be
    // called. Not queued at all, not even as SUPPRESSED — a withdrawn lead has
    // no business appearing on a calling screen, and a row that exists is a row
    // an agent can un-skip.
    if (lead.consentStatus === 'WITHDRAWN') {
      result.skippedSuppressed += 1;
      continue;
    }

    const phone = lead.phone;
    const normalized = lead.phoneNormalized ?? (phone ? normalizePhone(phone) : null);
    if (!phone || !normalized) {
      result.skippedNoPhone += 1;
      continue;
    }

    // Deduplicated inside the batch as well as against the table: two leads
    // sharing a household number is common, and the unique index would fail the
    // whole insert rather than skip the second.
    if (seen.has(normalized)) {
      result.skippedDuplicate += 1;
      continue;
    }
    seen.add(normalized);

    rows.push({
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      leadId: lead.id,
      displayName: lead.fullName,
      phone,
      phoneNormalized: normalized,
      position: position++,
      createdById: input.actorId,
    });
  }

  if (rows.length === 0) return result;

  const created = await withTx(input.tenantId, async (tx) =>
    // `skipDuplicates` against (campaignId, phoneNormalized): re-running a load
    // tops the queue up rather than failing, because building a campaign is an
    // interrupted, resumed job.
    tx.campaignContact.createMany({ data: rows, skipDuplicates: true }),
  );

  result.loaded = created.count;
  result.skippedDuplicate += rows.length - created.count;
  return result;
}

export interface QueueStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  callback: number;
  skipped: number;
  exhausted: number;
  suppressed: number;
}

export async function queueStats(tenantId: string, campaignId: string): Promise<QueueStats> {
  const rows = await prisma.campaignContact.groupBy({
    by: ['status'],
    where: { tenantId, campaignId },
    _count: { _all: true },
  });

  const by = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
  return {
    total: rows.reduce((sum, r) => sum + r._count._all, 0),
    pending: by('PENDING'),
    inProgress: by('IN_PROGRESS'),
    completed: by('COMPLETED'),
    callback: by('CALLBACK'),
    skipped: by('SKIPPED'),
    exhausted: by('EXHAUSTED'),
    suppressed: by('SUPPRESSED'),
  };
}
