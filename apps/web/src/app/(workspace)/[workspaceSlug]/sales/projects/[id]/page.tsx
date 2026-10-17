import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { can } from '@/lib/security/rbac';
import { leadScope } from '@/lib/security/record-scope';
import { releaseExpiredHolds } from '@/services/inventory/unitStatus';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import FavouriteButton, { ProjectFlags } from './FavouriteButton';
import UnitBoard from './UnitBoard';
import { Metric } from '@/components/ui/MetricCard';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import MediaUpload from '@/components/workspace/MediaUpload';
import { readMilestones } from '@/lib/inventory/paymentPlans';

export const metadata = { title: 'Project' };

/** Interested leads listed, the most recently updated first (M4-06). */
const INTERESTED_SHOWN = 50;

/**
 * Everything a salesperson needs on a call about one project, on one screen:
 * what it costs, what is left, what it is near, and how it compares.
 *
 * The comparison is computed here rather than fetched from /cma, because the
 * page is already server-rendered and a second round trip to our own API to
 * render the section below the fold is a hop for nothing.
 */
export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['projects', 'VIEW'] });

  const project = await prisma.project.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    include: {
      developer: { select: { id: true, name: true, logoUrl: true } },
      micromarket: { select: { id: true, name: true, city: true } },
      media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
      unitPlans: { orderBy: { position: 'asc' } },
      paymentPlans: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, milestones: true },
      },
    },
  });
  if (!project) notFound();

  // Holds that ran out come back to the market when someone looks, so the count
  // on this page and the units below it cannot disagree.
  await releaseExpiredHolds(ctx.tenantId, project.id);

  const [favourite, amenities, peers, units, interested] = await Promise.all([
    prisma.projectFavourite.findFirst({
      where: { tenantId: ctx.tenantId, projectId: project.id, userId: ctx.actor.id },
      select: { id: true },
    }),
    project.amenityKeys.length
      ? prisma.amenity.findMany({
          where: { tenantId: ctx.tenantId, key: { in: project.amenityKeys } },
          select: { key: true, label: true },
          orderBy: { position: 'asc' },
        })
      : [],
    project.micromarketId
      ? prisma.project.findMany({
          where: {
            tenantId: ctx.tenantId,
            deletedAt: null,
            micromarketId: project.micromarketId,
            id: { not: project.id },
            pricePerSqft: { not: null },
          },
          select: { id: true, name: true, pricePerSqft: true, possessionStatus: true, availableUnits: true },
          take: 200,
        })
      : [],
    prisma.unitInventory.findMany({
      where: { tenantId: ctx.tenantId, projectId: project.id },
      orderBy: [{ tower: 'asc' }, { floor: 'asc' }, { unitNumber: 'asc' }],
      take: 500,
      select: {
        id: true,
        tower: true,
        floor: true,
        unitNumber: true,
        status: true,
        price: true,
        currency: true,
        areaSqft: true,
        facing: true,
        heldUntil: true,
        unitPlan: { select: { id: true, name: true, unitType: true } },
      },
    }),
    // The leads that asked about it (M4-06): only those the viewer may see.
    can(ctx, 'leads', 'VIEW')
      ? leadScope(ctx, 'VIEW', { includeUnassigned: true }).then((scope) =>
          prisma.lead.findMany({
            where: { ...scope, projectInterests: { some: { projectId: project.id } } },
            orderBy: { updatedAt: 'desc' },
            // ponytail: the latest 50, said so on the page; a leads-list filter by project when books outgrow it.
            take: INTERESTED_SHOWN + 1,
            select: {
              id: true,
              reference: true,
              fullName: true,
              stage: { select: { name: true } },
              owner: { select: { fullName: true } },
            },
          }),
        )
      : null,
  ]);

  const rates = peers.map((p) => p.pricePerSqft!).sort((a, b) => a.comparedTo(b));
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;
  const deltaPct =
    project.pricePerSqft && median && !median.isZero()
      ? project.pricePerSqft.minus(median).div(median).times(100).toDecimalPlaces(1)
      : null;
  const comparables = project.pricePerSqft
    ? peers
        .map((p) => ({ ...p, gap: p.pricePerSqft!.minus(project.pricePerSqft!).abs() }))
        .sort((a, b) => a.gap.comparedTo(b.gap))
        .slice(0, 5)
    : [];

  const canEdit = can(ctx, 'projects', 'EDIT');
  // Plans and units are added under `projects:CREATE`, as their POST routes ask.
  const canAdd = can(ctx, 'projects', 'CREATE');
  const gallery = project.media.filter((m) => m.kind === 'IMAGE');
  const documents = project.media.filter(
    (m) => m.kind === 'BROCHURE' || m.kind === 'CREATIVE' || m.kind === 'FLOOR_PLAN',
  );
  const embeds = project.media.filter((m) => m.kind === 'VIDEO' || m.kind === 'VR_TOUR');

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <p className="lf-eyebrow">
            {project.micromarket ? `${project.micromarket.name}, ${project.micromarket.city}` : 'Unplaced'}
            {project.developer ? ` · ${project.developer.name}` : ''}
          </p>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
            {project.name}
          </h1>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Badge value={project.status} />
            <Badge value={project.possessionStatus} />
            {project.isPriority && <Badge value="PRIORITY" tone="brass" />}
            {!project.isPitchable && <Badge value="NOT PITCHABLE" tone="slate" />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FavouriteButton projectId={project.id} initial={Boolean(favourite)} />
          {canEdit && (
            <ProjectFlags projectId={project.id} isPriority={project.isPriority} isPitchable={project.isPitchable} />
          )}
        </div>
      </header>

      <section className="lf-metric-grid">
        <Metric label="Price from" value={money(project.minPrice, project.currency)} />
        <Metric label="Price to" value={money(project.maxPrice, project.currency)} />
        <Metric label="Rate / sqft" value={money(project.pricePerSqft, project.currency)} />
        <Metric
          label="Available"
          value={project.totalUnits ? `${project.availableUnits} / ${project.totalUnits}` : '—'}
        />
        <Metric label="Sold or booked" value={String(project.soldUnits)} />
        <Metric
          label="Possession"
          value={
            project.possessionAt
              ? project.possessionAt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
              : '—'
          }
        />
      </section>

      {project.description && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            About
          </h2>
          <p style={{ color: 'var(--lf-ink-2)', margin: 0 }}>{project.description}</p>
          {project.highlights.length > 0 && (
            <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--lf-ink-2)' }}>
              {project.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* RERA and the equivalent regulator elsewhere. Shown even when empty, so
          an unregistered project is visibly unregistered rather than looking
          like a page that forgot to load the section. */}
      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
          Registration
        </h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
          <Row label="RERA number" value={project.reraNumber} />
          <Row label="Authority" value={project.reraAuthority} />
          <Row label="Approved" value={project.reraApprovedAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' })} />
          <Row
            label="Expires"
            value={project.reraExpiresAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
            warn={project.reraExpiresAt != null && project.reraExpiresAt < new Date()}
          />
        </dl>
      </section>

      {(project.unitPlans.length > 0 || canAdd) && (
        <section className="lf-card" style={{ padding: 18 }} aria-label="Unit plans">
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Unit plans
          </h2>
          {project.unitPlans.length > 0 && (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Type</th>
                    <th>Beds</th>
                    <th style={{ textAlign: 'right' }}>Carpet sqft</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {project.unitPlans.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>{p.unitType}</td>
                      <td>{p.bedrooms ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{p.carpetAreaSqft?.toLocaleString('en-GB') ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{money(p.price, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Entering a tower from this page (M11-04): the typologies, then
              the units floor by floor. The price band and the counts above
              follow, recalculated by the same POST that adds them. */}
          {canAdd && (
            <>
              <details style={{ marginTop: 12 }}>
                <summary className="lf-btn lf-btn--secondary lf-btn--sm">Add unit plan</summary>
                <WorkspaceRecordForm
                  endpoint={`/api/v1/projects/${project.id}/plans`}
                  submitLabel="Add plan"
                  fields={[
                    { name: 'name', label: 'Plan name', required: true, placeholder: '2 bed Type A' },
                    { name: 'unitType', label: 'Type', required: true, placeholder: '2BR' },
                    { name: 'bedrooms', label: 'Bedrooms', type: 'number', min: 0 },
                    { name: 'bathrooms', label: 'Bathrooms', type: 'number', min: 0 },
                    { name: 'carpetAreaSqft', label: 'Area (sqft)', type: 'number', min: 1 },
                    { name: 'price', label: `Price (${project.currency})`, type: 'number', min: 0 },
                  ]}
                />
              </details>
              <details style={{ marginTop: 12 }}>
                <summary className="lf-btn lf-btn--secondary lf-btn--sm">Add units (floor range)</summary>
                <WorkspaceRecordForm
                  endpoint={`/api/v1/projects/${project.id}/units`}
                  submitLabel="Add units"
                  fields={[
                    {
                      name: 'unitPlanId',
                      label: 'Unit plan',
                      type: 'select',
                      options: project.unitPlans.map((p) => ({ value: p.id, label: p.name })),
                    },
                    { name: 'tower', label: 'Tower or block' },
                    { name: 'fromFloor', label: 'From floor', type: 'number', required: true },
                    { name: 'toFloor', label: 'To floor', type: 'number', required: true },
                    { name: 'unitsPerFloor', label: 'Units per floor', type: 'number', required: true, min: 1 },
                    {
                      name: 'numberPattern',
                      label: 'Unit numbers',
                      defaultValue: '{floor}0{n}',
                      hint: '{floor} and {n}: floor 12, unit 1 reads 1201.',
                    },
                    { name: 'price', label: `Price (${project.currency})`, type: 'number', min: 0 },
                    { name: 'areaSqft', label: 'Area (sqft)', type: 'number', min: 1 },
                    { name: 'facing', label: 'View' },
                  ]}
                />
              </details>
            </>
          )}
        </section>
      )}

      {/* Payment plans (M11-02): what a buyer pays when. */}
      {(project.paymentPlans.length > 0 || canEdit) && (
        <section className="lf-card" style={{ padding: 18 }} aria-label="Payment plans">
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Payment plans
          </h2>
          {project.paymentPlans.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No payment plan recorded yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {project.paymentPlans.map((plan) => (
                <li key={plan.id}>
                  <strong>{plan.name}</strong>
                  <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {' — '}
                    {readMilestones(plan.milestones)
                      .map((m) => `${m.percent}% ${m.label}`)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <details style={{ marginTop: 12 }}>
              <summary className="lf-btn lf-btn--secondary lf-btn--sm">Add payment plan</summary>
              <WorkspaceRecordForm
                endpoint={`/api/v1/projects/${project.id}/payment-plans`}
                submitLabel="Add plan"
                fields={[
                  { name: 'name', label: 'Payment plan name', required: true, placeholder: '20/80 post-handover' },
                  {
                    name: 'milestones',
                    label: 'Milestones',
                    required: true,
                    placeholder: '20 On booking, 80 Post-handover',
                    hint: 'A share and a label each, adding up to 100.',
                  },
                ]}
              />
            </details>
          )}
        </section>
      )}

      {interested && (
        <section className="lf-card" style={{ padding: 18 }} aria-label="Interested leads">
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Interested leads
          </h2>
          {interested.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No lead you can see has asked about this project.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {interested.slice(0, INTERESTED_SHOWN).map((lead) => (
                <li
                  key={lead.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    fontSize: 'var(--lf-text-sm)',
                  }}
                >
                  <SalesLink href={`/leads/${lead.id}`} style={{ fontWeight: 500 }}>
                    {lead.fullName}
                  </SalesLink>
                  <span
                    style={{
                      fontFamily: 'var(--lf-font-mono)',
                      fontSize: 'var(--lf-text-xs)',
                      color: 'var(--lf-ink-3)',
                    }}
                  >
                    {lead.reference}
                  </span>
                  <Badge tone="slate">{lead.stage.name}</Badge>
                  <span style={{ color: 'var(--lf-ink-3)' }}>{lead.owner?.fullName ?? 'Unassigned'}</span>
                </li>
              ))}
            </ul>
          )}
          {interested.length > INTERESTED_SHOWN && (
            <p className="lf-hint" style={{ margin: '8px 0 0' }}>
              {`Showing the ${INTERESTED_SHOWN} most recently updated; more leads you can see asked about it.`}
            </p>
          )}
        </section>
      )}

      <UnitBoard
        // Remounted when units are added above, so the board shows them.
        key={units.length}
        projectId={project.id}
        canEdit={canEdit}
        // Decimal and Date do not survive the server/client boundary, so the
        // board receives them the same shape the API returns.
        initialUnits={units.map((u) => ({
          ...u,
          price: u.price ? u.price.toString() : null,
          heldUntil: u.heldUntil ? u.heldUntil.toISOString() : null,
        }))}
      />

      {amenities.length > 0 && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Amenities
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {amenities.map((a) => (
              <Badge key={a.key} value={a.label} tone="slate" />
            ))}
          </div>
        </section>
      )}

      {(gallery.length > 0 || documents.length > 0 || embeds.length > 0 || canEdit) && (
        <section className="lf-card" style={{ padding: 18 }} aria-label="Media">
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Media
          </h2>

          {gallery.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 8,
                marginBottom: 16,
              }}
            >
              {gallery.map((m) => (
                <figure key={m.id} style={{ margin: 0 }}>
                  {/* Served through the authorised media route, never a bucket
                      URL — the same rule call recordings follow. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/v1/projects/${project.id}/media/${m.id}/file`}
                    alt={m.title ?? project.name}
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6 }}
                  />
                </figure>
              ))}
            </div>
          )}

          {documents.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 6 }}>
              {documents.map((m) => (
                <li key={m.id}>
                  <a
                    href={`/api/v1/projects/${project.id}/media/${m.id}/file`}
                    className="lf-btn lf-btn--secondary lf-btn--sm"
                  >
                    {MEDIA_LABEL[m.kind] ?? 'File'}: {m.title ?? 'Untitled'}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {embeds.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {embeds.map((m) => (
                <li key={m.id}>
                  <a href={m.externalUrl ?? '#'} target="_blank" rel="noreferrer noopener">
                    {m.kind === 'VR_TOUR' ? 'Virtual tour' : 'Video'}: {m.title ?? m.externalUrl}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {canEdit && <MediaUpload endpoint={`/api/v1/projects/${project.id}/media/upload`} />}
        </section>
      )}

      {/* Comparative market analysis. Five nearest by rate within the same
          micromarket — not the geographically nearest, which in a dense market
          is the same developer's other tower and answers nothing. */}
      {comparables.length > 0 && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            How it compares
          </h2>
          <p className="lf-hint" style={{ marginTop: 0 }}>
            Against {rates.length} priced project{rates.length === 1 ? '' : 's'} in {project.micromarket?.name}. Median{' '}
            {money(median, project.currency)} per sqft
            {deltaPct != null && (
              <>
                {' '}
                — this project is{' '}
                <strong style={{ color: deltaPct.isNegative() ? 'var(--lf-viridian)' : 'var(--lf-brass)' }}>
                  {deltaPct.abs().toString()}% {deltaPct.isNegative() ? 'below' : 'above'}
                </strong>{' '}
                it.
              </>
            )}
          </p>
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Possession</th>
                  <th style={{ textAlign: 'right' }}>Rate / sqft</th>
                  <th style={{ textAlign: 'right' }}>Available</th>
                </tr>
              </thead>
              <tbody>
                {comparables.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <SalesLink href={`/projects/${c.id}`}>{c.name}</SalesLink>
                    </td>
                    <td>
                      <Badge value={c.possessionStatus} />
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(c.pricePerSqft, project.currency)}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {c.availableUnits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value?: string | null; warn?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{label}</dt>
      <dd style={{ margin: 0, color: warn ? 'var(--lf-vermillion)' : undefined }}>
        {value || '—'}
        {warn ? ' (expired)' : ''}
      </dd>
    </>
  );
}

const MEDIA_LABEL: Record<string, string> = { BROCHURE: 'Brochure', CREATIVE: 'Creative', FLOOR_PLAN: 'Floor plan' };

const money = (amount: Prisma.Decimal | null, currency: string) =>
  amount == null ? '—' : `${currency} ${Number(amount).toLocaleString('en-AE')}`;
