import { resolveWorkspacePage } from '@/lib/workspace-page';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
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
    ...(tab === 'converted' ? { status: 'CONVERTED' } : {}),
    // Spam and dismissed are captured for marketing, not for a salesperson's
    // queue, so they surface only on their own tab.
    ...(tab === 'dismissed' ? { status: { in: [...hidden] } } : {}),
    ...(tab === 'all' || tab === 'new' || tab === 'high' || tab === 'unassigned'
      ? { status: { notIn: [...hidden] } }
      : {}),
  };

  const [rows, counts] = await Promise.all([
    prisma.socialComment.findMany({
      where,
      orderBy: [{ intent: 'asc' }, { commentCreatedAt: 'desc' }],
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

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Engage"
        title="Social Leads"
        description="Review and respond to sales enquiries coming from Facebook and Instagram."
        breadcrumbs={[{ label: 'Engage' }, { label: 'Social Leads' }]}
      />

      <SocialLeadList
        leads={JSON.parse(JSON.stringify(rows))}
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
          converted: byStatus.CONVERTED ?? 0,
        }}
      />
    </div>
  );
}
