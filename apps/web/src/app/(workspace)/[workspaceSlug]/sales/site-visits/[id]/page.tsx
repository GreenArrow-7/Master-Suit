import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visitPolicy } from '@/services/visits/punch';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import VisitActions from './VisitActions';

export const metadata = { title: 'Site visit' };

/**
 * One visit: where it is, whether it was approved, whether somebody actually
 * turned up, and whether a leader believes them.
 *
 * The map is a link rather than an embed. A rendered Google map needs a
 * JavaScript API key and a billing account, and a coordinate that opens in
 * whatever map app the phone already has answers the same question — "is this
 * where it should be" — at no cost. Swap it for the embed when a key exists.
 */
export default async function SiteVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['visits', 'VIEW'] });

  const [visit, policy] = await Promise.all([
    prisma.siteVisit.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        project: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        listing: { select: { id: true, reference: true, title: true, latitude: true, longitude: true } },
        unit: { select: { id: true, unitNumber: true, tower: true, floor: true } },
      },
    }),
    visitPolicy(ctx.tenantId),
  ]);
  if (!visit) notFound();

  const client = visit.leadId
    ? await prisma.lead.findFirst({
        where: { id: visit.leadId, tenantId: ctx.tenantId },
        select: { id: true, fullName: true, phone: true },
      })
    : visit.contactId
      ? await prisma.contact.findFirst({
          where: { id: visit.contactId, tenantId: ctx.tenantId },
          select: { id: true, fullName: true, phone: true },
        })
      : null;

  const destination = {
    latitude: visit.latitude ?? visit.project?.latitude ?? visit.listing?.latitude ?? null,
    longitude: visit.longitude ?? visit.project?.longitude ?? visit.listing?.longitude ?? null,
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header>
        <p className="lf-eyebrow">
          {visit.kind === 'CLIENT_MEETING' ? 'Client meeting' : 'Property visit'}
          {client && ' · '}
          {client && (
            <SalesLink href={visit.leadId ? `/leads/${client.id}` : `/contacts/${client.id}`}>
              {client.fullName}
            </SalesLink>
          )}
        </p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
          {visit.project?.name ?? visit.listing?.title ?? visit.address ?? 'Visit'}
        </h1>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Badge value={visit.status} />
          <Badge
            value={visit.verification}
            tone={
              visit.verification === 'VERIFIED'
                ? 'viridian'
                : visit.verification === 'DISPUTED'
                  ? 'vermillion'
                  : 'slate'
            }
          />
          {visit.locationSuspect && <Badge value="LOCATION FLAGGED" tone="vermillion" />}
          {visit.amendedAt && <Badge value="AMENDED" tone="brass" />}
        </div>
      </header>

      <section className="lf-metric-grid">
        <Metric
          label="Scheduled"
          value={visit.scheduledAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        />
        <Metric label="Duration" value={`${visit.durationMin} min`} />
        <Metric
          label="Checked in"
          value={visit.checkInAt ? visit.checkInAt.toLocaleTimeString('en-GB', { timeStyle: 'short' }) : '—'}
        />
        <Metric
          label="Checked out"
          value={visit.checkOutAt ? visit.checkOutAt.toLocaleTimeString('en-GB', { timeStyle: 'short' }) : '—'}
        />
        <Metric
          label="Distance"
          value={
            visit.distanceMeters == null
              ? '—'
              : visit.distanceMeters >= 1000
                ? `${(visit.distanceMeters / 1000).toFixed(1)} km`
                : `${visit.distanceMeters} m`
          }
        />
        <Metric
          label="Geofence"
          value={visit.geofenceOk == null ? 'Not measured' : visit.geofenceOk ? 'Inside' : 'Outside'}
        />
      </section>

      {visit.locationSuspect && visit.suspectReason && (
        <div className="lf-alert" role="status">
          <strong>Flagged for review:</strong> {visit.suspectReason}. Recorded, not refused — the browser cannot detect
          a mocked location, so this is a prompt for a human rather than a verdict.
        </div>
      )}

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
          Where
        </h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
          <Row label="Destination" value={visit.project?.name ?? visit.listing?.title ?? visit.address ?? undefined} />
          {visit.unit && (
            <Row label="Unit" value={`${visit.unit.tower ? `${visit.unit.tower} · ` : ''}${visit.unit.unitNumber}`} />
          )}
          <Row label="Address" value={visit.address ?? visit.project?.address ?? undefined} />
          <Row label="Fence" value={`${policy.radiusM} m`} />
        </dl>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {destination.latitude != null && destination.longitude != null && (
            <a
              className="lf-btn lf-btn--secondary lf-btn--sm"
              href={`https://www.google.com/maps?q=${destination.latitude},${destination.longitude}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the property in Maps
            </a>
          )}
          {visit.checkInLat != null && visit.checkInLng != null && (
            <a
              className="lf-btn lf-btn--ghost lf-btn--sm"
              href={`https://www.google.com/maps?q=${visit.checkInLat},${visit.checkInLng}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open where the check-in came from
            </a>
          )}
        </div>
      </section>

      <VisitActions
        visitId={visit.id}
        status={visit.status}
        verification={visit.verification}
        isOwner={visit.ownerId === ctx.actor.id}
        canApprove={can(ctx, 'visits', 'APPROVE')}
        canVerify={can(ctx, 'visits', 'MANAGE_USERS')}
        canEdit={can(ctx, 'visits', 'EDIT')}
      />

      {(visit.outcome || visit.notes || visit.decisionNote || visit.amendReason) && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Record
          </h2>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
            <Row label="Outcome" value={visit.outcome ?? undefined} />
            <Row label="Notes" value={visit.notes ?? undefined} />
            <Row label="Decision" value={visit.decisionNote ?? undefined} />
            {visit.amendReason && (
              <>
                <dt style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>Amended</dt>
                <dd style={{ margin: 0 }}>
                  {visit.amendReason}
                  <span className="lf-hint">
                    {' '}
                    · {visit.amendedAt?.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="lf-metric-card">
      <div className="lf-eyebrow">{label}</div>
      <div className="lf-metric-card__value" style={{ fontSize: 'var(--lf-text-lg)' }}>
        {value}
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <dt style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </>
  );
}
