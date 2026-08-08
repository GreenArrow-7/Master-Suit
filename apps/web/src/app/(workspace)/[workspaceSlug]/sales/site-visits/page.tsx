import type { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { leaderQueues } from '@/services/visits/lifecycle';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Site visits' };

const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  REQUESTED: 'brass',
  APPROVED: 'viridian',
  CHECKED_IN: 'viridian',
  COMPLETED: 'slate',
  REJECTED: 'vermillion',
  CANCELLED: 'slate',
  NO_SHOW: 'vermillion',
};

/**
 * The visit register.
 *
 * The two tabs a leader opens are the point of the page: what is waiting to be
 * approved, and what has happened and not yet been believed. Both are counted in
 * the header so neither is something you have to remember to look for.
 */
export default async function SiteVisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['visits', 'VIEW'] });

  const isLeader = can(ctx, 'visits', 'APPROVE') || can(ctx, 'visits', 'MANAGE_USERS');
  const scope = await visibilityWhere(ctx, 'visits', 'VIEW');

  const queueWhere: Prisma.SiteVisitWhereInput =
    params.queue === 'approval'
      ? { status: 'REQUESTED' }
      : params.queue === 'verification'
        ? { status: { in: ['COMPLETED', 'NO_SHOW'] }, verification: 'PENDING' }
        : params.queue === 'suspect'
          ? { locationSuspect: true }
          : {};

  const [rows, queues] = await Promise.all([
    prisma.siteVisit.findMany({
      where: { ...scope, deletedAt: null, ...queueWhere },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
      select: {
        id: true,
        kind: true,
        status: true,
        verification: true,
        scheduledAt: true,
        address: true,
        leadId: true,
        checkInAt: true,
        distanceMeters: true,
        geofenceOk: true,
        locationSuspect: true,
        amendedAt: true,
        outcome: true,
        project: { select: { id: true, name: true } },
        listing: { select: { id: true, title: true } },
      },
    }),
    isLeader ? leaderQueues(ctx.tenantId) : null,
  ]);

  return (
    <>
      <ListHeader
        title="Site visits"
        description={
          <>
            {rows.length} visit{rows.length === 1 ? '' : 's'}
            {queues && queues.awaitingApproval > 0 && (
              <>
                {' · '}
                <SalesLink href="/site-visits?queue=approval" style={{ color: 'var(--lf-brass)' }}>
                  {queues.awaitingApproval} awaiting approval
                </SalesLink>
              </>
            )}
            {queues && queues.awaitingVerification > 0 && (
              <>
                {' · '}
                <SalesLink href="/site-visits?queue=verification" style={{ color: 'var(--lf-brass)' }}>
                  {queues.awaitingVerification} to verify
                </SalesLink>
              </>
            )}
          </>
        }
        actions={
          can(ctx, 'visits', 'CREATE') && (
            <SalesLink className="lf-btn lf-btn--sm" href="/site-visits/new">
              Request a visit
            </SalesLink>
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Queue">
        {(
          [
            ['All', ''],
            ['Awaiting approval', 'approval'],
            ['To verify', 'verification'],
            ['Flagged location', 'suspect'],
          ] as const
        ).map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/site-visits?queue=${key}` : '/site-visits'}
            aria-selected={(params.queue ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="Nothing here"
            description={
              params.queue === 'verification'
                ? 'Every completed visit has been signed off.'
                : params.queue === 'approval'
                  ? 'No visits are waiting for a decision.'
                  : 'Request a visit and it will appear here once a leader approves it.'
            }
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Where</th>
                <th>Status</th>
                <th>Check-in</th>
                <th style={{ textAlign: 'right' }}>Distance</th>
                <th>Verified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 500 }}>
                    {v.scheduledAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td>
                    {v.project ? (
                      <SalesLink href={`/projects/${v.project.id}`}>{v.project.name}</SalesLink>
                    ) : v.listing ? (
                      <SalesLink href={`/listings/${v.listing.id}`}>{v.listing.title}</SalesLink>
                    ) : (
                      (v.address ?? '—')
                    )}
                  </td>
                  <td>
                    <Badge value={v.status} tone={TONE[v.status] ?? 'slate'} />
                    {v.amendedAt && (
                      <span className="lf-hint" style={{ marginLeft: 6 }}>
                        amended
                      </span>
                    )}
                  </td>
                  <td>
                    {v.checkInAt
                      ? v.checkInAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {/* Outside the fence, or a day that did not add up: both are
                        shown, neither was refused. */}
                    {v.distanceMeters == null ? (
                      '—'
                    ) : (
                      <span style={{ color: v.geofenceOk === false ? 'var(--lf-vermillion)' : undefined }}>
                        {v.distanceMeters >= 1000
                          ? `${(v.distanceMeters / 1000).toFixed(1)} km`
                          : `${v.distanceMeters} m`}
                      </span>
                    )}
                    {v.locationSuspect && <Badge value="FLAGGED" tone="vermillion" />}
                  </td>
                  <td>
                    <Badge
                      value={v.verification}
                      tone={
                        v.verification === 'VERIFIED'
                          ? 'viridian'
                          : v.verification === 'DISPUTED'
                            ? 'vermillion'
                            : 'slate'
                      }
                    />
                  </td>
                  <td>
                    <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={`/site-visits/${v.id}`}>
                      Open
                    </SalesLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
