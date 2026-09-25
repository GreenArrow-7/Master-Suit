import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { createProposal } from '@/services/proposals/proposals';

/**
 * Proposals: the shortlists an agency has sent, and a new one.
 *
 * Gated on `requirements` rather than a module of its own — the reasoning is on
 * PERMISSION_MODULE in services/proposals/proposals.ts.
 */
const listQuery = z.object({
  status: z.enum(['DRAFT', 'SENT', 'CLOSED']).optional(),
  leadId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(
  { module: 'requirements', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) =>
    withTx(ctx.tenantId, async (tx) => {
      const proposals = await tx.proposal.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.leadId ? { leadId: query.leadId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        select: {
          id: true,
          title: true,
          status: true,
          sentAt: true,
          firstViewedAt: true,
          lastViewedAt: true,
          viewCount: true,
          createdAt: true,
          owner: { select: { fullName: true } },
          _count: { select: { items: true } },
        },
      });

      // What came back, per proposal. The count an agent scans the list for.
      const interested = await tx.proposalItem.groupBy({
        by: ['proposalId'],
        where: { tenantId: ctx.tenantId, reaction: 'INTERESTED', proposalId: { in: proposals.map((p) => p.id) } },
        _count: { _all: true },
      });
      const likes = new Map(interested.map((row) => [row.proposalId, row._count._all]));

      return {
        proposals: proposals.map((proposal) => ({
          id: proposal.id,
          title: proposal.title,
          status: proposal.status,
          owner: proposal.owner?.fullName ?? null,
          properties: proposal._count.items,
          interested: likes.get(proposal.id) ?? 0,
          sentAt: proposal.sentAt,
          firstViewedAt: proposal.firstViewedAt,
          lastViewedAt: proposal.lastViewedAt,
          viewCount: proposal.viewCount,
          createdAt: proposal.createdAt,
        })),
      };
    }),
);

const createBody = z.object({
  leadId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  requirementId: z.string().min(1).nullable().optional(),
  title: z.string().min(2).max(160),
  message: z.string().max(2000).nullable().optional(),
  listingIds: z.array(z.string().min(1)).min(1).max(20),
  /** Days until the link stops resolving. Null leaves it open. */
  expiresInDays: z.coerce.number().int().min(1).max(180).nullable().optional(),
});

export const POST = route(
  {
    module: 'requirements',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) =>
    createProposal(ctx, {
      leadId: body.leadId ?? null,
      contactId: body.contactId ?? null,
      requirementId: body.requirementId ?? null,
      title: body.title,
      message: body.message ?? null,
      listingIds: body.listingIds,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
    }),
);
