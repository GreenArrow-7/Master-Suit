import { resolveWorkspacePage } from '@/lib/workspace-page';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import { socialSlaState, socialSlaTarget, queueRank } from '@/services/social/sla';
import { replyCapability } from '@/lib/integrations/meta/replyCapability';
import PageHeader from '@/components/ui/PageHeader';
import SocialLeadList from '@/components/workspace/SocialLeadList';

export const metadata = { title: 'Social Leads' };

/**
 * The sales queue for Facebook and Instagram enquiries.
 *
 * Deliberately in `sales/`, not under Settings → Integrations: connecting Meta
 * is configuration, working the enquiries it produces is daily sales work, and
 * a salesperson must not have to walk through an admin screen to find it.
 *
 * Server-rendered with link-based tabs rather than a client fetch — the list is
 * read-mostly, the filters are shareable URLs, and a refresh shows the truth.
 */
const TABS = [
  ['all', 'All'],
  ['new', 'New'],
  ['high', 'High intent'],
  ['assigned', 'Assigned'],
  ['unassigned', 'Unassigned'],
  ['overdue', 'Overdue'],
  ['converted', 'Converted'],
  ['dismissed', 'Dismissed'],
] as const;

export default async function SocialLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ tab?: string; channel?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { tab = 'all', channel } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'SALES', permission: ['leads', 'VIEW'] });

  // The same row scoping every other list uses: a rep sees their own, a manager
  // their team's. Unassigned is included so somebody can pick an enquiry up.
  const visible = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });

  const hidden = ['DISMISSED', 'SPAM'] as const;
  const where: Prisma.SocialCommentWhereInput = {
    ...visible,
    ...(channel ? { provider: channel } : {}),
    ...(tab === 'new' ? { status: 'NEW' } : {}),
    ...(tab === 'high' ? { intent: 'HIGH' } : {}),
    ...(tab === 'assigned' ? { status: 'ASSIGNED' } : {}),
    // Everything a salesperson should be working that nobody owns. Spam and
    // praise are excluded — they were never meant to be assigned.
    ...(tab === 'unassigned' ? { ownerId: null, intent: { in: ['HIGH', 'MEDIUM'] } } : {}),
    /**
     * Past the deadline and still unanswered — `repliedAt: null` is the same
     * test `socialSlaState` makes, written in SQL so the tab, the count and the
     * badges cannot disagree.
     *
     * Converting is deliberately not an exclusion. An enquiry someone turned
     * into a CRM lead without ever answering the person who asked is precisely
     * the failure this tab exists to surface.
     */
    ...(tab === 'overdue' ? { slaDueAt: { lt: new Date() }, repliedAt: null } : {}),
    ...(tab === 'converted' ? { status: 'CONVERTED' } : {}),
    // Spam and dismissed are captured for marketing, not for a salesperson's
    // queue, so they surface only on their own tab.
    ...(tab === 'dismissed' ? { status: { in: [...hidden] } } : {}),
    ...(tab === 'all' || tab === 'new' || tab === 'high' || tab === 'unassigned' || tab === 'overdue'
      ? { status: { notIn: [...hidden] } }
      : {}),
  };

  const [rows, counts] = await Promise.all([
    prisma.socialComment.findMany({
      where,
      /**
       * A pre-filter, not the final order — SLA state is derived, so the
       * operational ranking has to happen after these rows are read (see the
       * sort below). Unanswered first, then soonest deadline, so the page this
       * takes is the right hundred rows to rank.
       */
      orderBy: [
        { repliedAt: { sort: 'asc', nulls: 'first' } },
        { slaDueAt: { sort: 'asc', nulls: 'last' } },
        { commentCreatedAt: 'desc' },
      ],
      take: 100,
      select: {
        id: true,
        provider: true,
        authorName: true,
        commentText: true,
        commentCreatedAt: true,
        mediaType: true,
        providerAdTitle: true,
        intent: true,
        intentScore: true,
        intentReasons: true,
        status: true,
        assignmentNote: true,
        parentCommentId: true,
        providerReplyId: true,
        slaDueAt: true,
        repliedAt: true,
        convertedAt: true,
        linkedLeadId: true,
        owner: { select: { fullName: true } },
        team: { select: { name: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          take: 20,
          select: {
            id: true,
            kind: true,
            channel: true,
            body: true,
            delivered: true,
            aiAssisted: true,
            sentById: true,
            createdAt: true,
          },
        },
        assignments: {
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: {
            id: true,
            createdAt: true,
            source: true,
            reason: true,
            toOwnerId: true,
            fromOwnerId: true,
            assignedById: true,
          },
        },
      },
    }),
    prisma.socialComment.groupBy({
      by: ['status'],
      where: visible,
      _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const highCount = await prisma.socialComment.count({
    where: {
      ...visible,
      intent: 'HIGH',
      status: { notIn: ['CONVERTED', 'DISMISSED', 'SPAM'] },
    } as Prisma.SocialCommentWhereInput,
  });

  // The number a manager actually acts on: real enquiries nobody owns.
  const unassignedCount = await prisma.socialComment.count({
    where: {
      ...visible,
      ownerId: null,
      intent: { in: ['HIGH', 'MEDIUM'] },
      status: { notIn: ['CONVERTED', 'DISMISSED', 'SPAM'] },
    } as Prisma.SocialCommentWhereInput,
  });

  // The other number a manager acts on: past target and still unanswered.
  // Converted rows are counted too — see the Overdue tab filter above.
  const overdueCount = await prisma.socialComment.count({
    where: {
      ...visible,
      slaDueAt: { lt: new Date() },
      repliedAt: null,
      status: { notIn: ['DISMISSED', 'SPAM'] },
    } as Prisma.SocialCommentWhereInput,
  });

  // Only people who can actually take work. Listing every User row would offer
  // suspended accounts as destinations.
  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
      orderBy: { fullName: 'asc' },
      take: 200,
      select: { id: true, fullName: true },
    }),
    prisma.team.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  /**
   * SLA state is derived here rather than in the browser so the badge, the
   * Overdue tab and the count are all one clock. The tenant's warning threshold
   * comes from its own SLA row when it has configured one.
   */
  const [highTarget, mediumTarget, connections] = await Promise.all([
    socialSlaTarget(ctx.tenantId, 'HIGH'),
    socialSlaTarget(ctx.tenantId, 'MEDIUM'),
    // What Meta actually granted this workspace. Without it the drawer would
    // promise a reply the connection has no permission to send.
    prisma.integrationConnection.findMany({
      where: { tenantId: ctx.tenantId, provider: { in: ['facebook', 'instagram', 'meta'] } },
      select: { provider: true, scopes: true },
    }),
  ]);
  const scopesFor = (provider: string) =>
    connections.find((c) => c.provider === provider)?.scopes ?? connections.find((c) => c.provider === 'meta')?.scopes;

  const now = new Date();
  const leads = rows
    .map((row) => ({
      ...row,
      sla: socialSlaState(row, now, (row.intent === 'HIGH' ? highTarget : mediumTarget)?.warningPct ?? 80),
      reply: replyCapability(
        {
          ...row,
          // Only a private reply spends Meta's single private-reply allowance.
          privateReplySent: row.replies.some((reply) => reply.kind === 'PRIVATE'),
          grantedScopes: scopesFor(row.provider),
        },
        now,
      ),
    }))
    /**
     * Worst first, intent before lateness. The database ordering above is a
     * proxy — SLA state is derived, so it cannot be sorted on in SQL.
     *
     * ponytail: that means the operational order is applied to the fetched page
     * rather than the whole table, so with more than `take` rows the ranking is
     * within the page. Move the state into a stored column if a workspace ever
     * runs a backlog that deep.
     */
    .sort((a, b) => {
      const [x, y] = [queueRank(a), queueRank(b)];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    });

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Engage"
        title="Social Leads"
        description="Review and respond to sales enquiries coming from Facebook and Instagram."
        breadcrumbs={[{ label: 'Engage' }, { label: 'Social Leads' }]}
      />

      <SocialLeadList
        leads={JSON.parse(JSON.stringify(leads))}
        tabs={TABS.map(([key, label]) => ({ key, label }))}
        activeTab={tab}
        activeChannel={channel ?? ''}
        workspaceSlug={workspaceSlug}
        canAssign={can(ctx, 'leads', 'ASSIGN')}
        me={ctx.actor.id}
        options={{ users, teams }}
        summary={{
          new: byStatus.NEW ?? 0,
          high: highCount,
          unassigned: unassignedCount,
          overdue: overdueCount,
          converted: byStatus.CONVERTED ?? 0,
        }}
      />
    </div>
  );
}
