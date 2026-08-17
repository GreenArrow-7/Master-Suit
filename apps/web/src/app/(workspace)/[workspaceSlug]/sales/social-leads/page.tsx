import { resolveWorkspacePage } from '@/lib/workspace-page';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import { socialSlaState, socialSlaTarget } from '@/services/social/sla';
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
    // Past the deadline and still unanswered. `repliedAt`/`convertedAt` null is
    // the same test `socialSlaState` makes, expressed in SQL so the tab counts
    // and the badges cannot disagree.
    ...(tab === 'overdue' ? { slaDueAt: { lt: new Date() }, repliedAt: null, convertedAt: null } : {}),
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
       * Work still owed, soonest deadline first — so the row to pick up next is
       * the top one.
       *
       * The two nulls-first keys are what stop an answered enquiry from
       * outranking a live one: its deadline is older, so ordering on the
       * deadline alone floated finished work to the top of the queue. Nulls
       * last on the deadline then puts "nothing owed" — praise, spam, LOW —
       * below everything with a clock, whatever its intent.
       */
      orderBy: [
        { repliedAt: { sort: 'asc', nulls: 'first' } },
        { convertedAt: { sort: 'asc', nulls: 'first' } },
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
  const overdueCount = await prisma.socialComment.count({
    where: {
      ...visible,
      slaDueAt: { lt: new Date() },
      repliedAt: null,
      convertedAt: null,
      status: { notIn: ['CONVERTED', 'DISMISSED', 'SPAM'] },
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
  const leads = rows.map((row) => ({
    ...row,
    sla: socialSlaState(row, now, (row.intent === 'HIGH' ? highTarget : mediumTarget)?.warningPct ?? 80),
    reply: replyCapability({ ...row, grantedScopes: scopesFor(row.provider) }, now),
  }));

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
