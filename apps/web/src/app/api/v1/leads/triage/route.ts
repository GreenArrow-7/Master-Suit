import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { listTriageQueue } from '@/services/distribution/triageQueue';

/**
 * The unassigned-lead queue.
 *
 * Scoped through `visibilityWhere` on the lead itself, so a team manager sees
 * their team's waiting leads and a branch manager sees the branch — the same
 * scope that governs every other lead surface. Nobody's access is widened to
 * make the queue useful.
 */
const listQuery = z.object({
  take: z.coerce.number().int().min(1).max(200).default(100),
  /** Only what this actor is personally accountable for. */
  mine: z.coerce.boolean().default(false),
});

export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rows = await listTriageQueue(ctx, { take: query.take, mineOnly: query.mine });
    return {
      data: rows.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        episode: r.episode,
        lead: { name: r.leadName, source: r.source, sourceDetail: r.sourceDetail },
        reason: r.reason,
        reasonText: r.reasonText,
        candidates: r.detail.candidates ?? [],
        unsupportedPolicy: r.detail.unsupported ?? [],
        openedAt: r.openedAt.toISOString(),
        waitingMs: r.waitingMs,
        reviewDueAt: r.reviewDueAt?.toISOString() ?? null,
        reviewPolicyMissing: r.reviewPolicyMissing,
        routingPolicyMissing: r.routingPolicyMissing,
        overdue: r.overdue,
        escalatedAt: r.escalatedAt?.toISOString() ?? null,
        responsible: {
          userId: r.responsibleUserId,
          userName: r.responsibleUserName,
          teamId: r.responsibleTeamId,
          teamName: r.responsibleTeamName,
        },
      })),
      count: rows.length,
    };
  },
);
