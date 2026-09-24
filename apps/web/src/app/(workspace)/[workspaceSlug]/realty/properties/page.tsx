import type { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Properties' };

const PAGE_SIZE = 200;

/**
 * The unit register, across every project.
 *
 * This is the one screen in the Real Estate inventory group that is genuinely
 * new rather than a Sales page reached through a second URL. The rows already
 * exist — `UnitInventory`, written by the project importer and moved by
 * `services/inventory/unitStatus.ts` — but nothing listed them across projects.
 * They were reachable only inside one project's detail screen, or through
 * `/api/v1/projects/{id}/units`, which also answers for a single project. So
 * the brokerage question "what is available right now" had no screen at all,
 * while the dashboard counted the answer and linked here.
 *
 * `module: 'REAL_ESTATE'` rather than the shared `SALES_OR_REALTY`: the shared
 * screens are shared because Sales has them and links to them. This one is
 * offered by the Real Estate navigation alone, and claiming otherwise would
 * promise a Sales screen that does not exist.
 *
 * ── Permission: `projects`, not `listings` ──────────────────────────────────
 *
 * A unit belongs to a project — `projectId`, cascade-deleted with it — and
 * `/api/v1/projects/[id]/units` gates on `projects:VIEW`. A `Listing` is a
 * different object: an advertisement that may point at a unit. Gating on
 * `listings` would be a second answer to a question the API has already
 * answered, and the two would disagree for anyone holding one permission and
 * not the other.
 *
 * ── Tenant-scoped, and deliberately not `visibilityWhere` ───────────────────
 *
 * `UnitInventory` has no owner. It is stock, not a worked record, so there is
 * no OWN/TEAM/BRANCH axis to resolve and nothing for a scope resolver to
 * narrow — asking it would invent a hierarchy the table does not have.
 * `tenantId` is the whole boundary here, exactly as the dashboard's
 * availability count reads it.
 */
const STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: 'viridian',
  HELD: 'brass',
  BOOKED: 'wine',
  SOLD: 'slate',
  BLOCKED: 'vermillion',
};

const TABS: [label: string, key: string, where: Prisma.UnitInventoryWhereInput][] = [
  ['All', '', {}],
  ['Available', 'available', { status: 'AVAILABLE' }],
  ['Held', 'held', { status: 'HELD' }],
  ['Booked', 'booked', { status: 'BOOKED' }],
  ['Sold', 'sold', { status: 'SOLD' }],
  ['Blocked', 'blocked', { status: 'BLOCKED' }],
];

/** `AED 1,250,000`, in the row's own currency rather than an assumed one. */
function money(amount: Prisma.Decimal | null, currency: string): string {
  if (!amount) return '—';
  return `${currency} ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
}

/** `A / 12 / 1204`, skipping the parts this project does not use. */
function address(tower: string | null, floor: number | null, unitNumber: string): string {
  return [tower, floor === null ? null : String(floor), unitNumber].filter(Boolean).join(' / ');
}

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'REAL_ESTATE', permission: ['projects', 'VIEW'] });

  const tab = TABS.find(([, key]) => key === (params.tab ?? '')) ?? TABS[0]!;
  const where: Prisma.UnitInventoryWhereInput = { tenantId: ctx.tenantId, ...tab[2] };

  const [rows, total, available] = await Promise.all([
    prisma.unitInventory.findMany({
      where,
      orderBy: [{ project: { name: 'asc' } }, { tower: 'asc' }, { floor: 'asc' }, { unitNumber: 'asc' }],
      take: PAGE_SIZE,
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
        project: { select: { id: true, name: true } },
        unitPlan: { select: { name: true, unitType: true } },
      },
    }),
    prisma.unitInventory.count({ where }),
    prisma.unitInventory.count({ where: { tenantId: ctx.tenantId, status: 'AVAILABLE' } }),
  ]);

  const now = Date.now();

  return (
    <>
      <ListHeader
        title="Properties"
        count={total}
        noun="unit"
        capped={rows.length === PAGE_SIZE}
        description={
          <>
            {total.toLocaleString('en-AE')} unit{total === 1 ? '' : 's'} {'·'} {available.toLocaleString('en-AE')}{' '}
            available across the workspace
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Unit status">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            href={key ? `/properties?tab=${key}` : '/properties'}
            className="lf-tab"
            aria-current={key === (params.tab ?? '') ? 'page' : undefined}
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title="No units here"
          description="Units appear as projects are added and their inventory is loaded."
        />
      ) : (
        <div className="lf-table-wrap">
          <table className="lf-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Unit</th>
                <th>Type</th>
                <th className="lf-num">Area</th>
                <th className="lf-num">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((unit) => {
                /**
                 * A hold with a past expiry is not a hold. The schema says as
                 * much — without the expiry, held inventory is
                 * indistinguishable from sold inventory a week later — and the
                 * sweep that releases them runs on a schedule, so a row can sit
                 * here expired and still marked HELD. Saying "hold expired" is
                 * honest about the row as stored; quietly showing it as
                 * available would be this screen overruling the record.
                 */
                const expired = unit.status === 'HELD' && unit.heldUntil !== null && unit.heldUntil.getTime() < now;
                return (
                  <tr key={unit.id}>
                    {/*
                     * Always a link: the page gate above is `projects:VIEW`, so
                     * anybody reading this row already holds what the project
                     * screen asks for. A `can()` check here would read as a
                     * second, weaker rule and could never be false.
                     */}
                    <td>
                      <SalesLink href={`/projects/${unit.project.id}`}>{unit.project.name}</SalesLink>
                    </td>
                    <td>{address(unit.tower, unit.floor, unit.unitNumber)}</td>
                    <td>
                      {unit.unitPlan?.unitType ?? unit.unitPlan?.name ?? '—'}
                      {unit.facing ? ` · ${unit.facing}` : ''}
                    </td>
                    <td className="lf-num">{unit.areaSqft ? `${unit.areaSqft.toLocaleString('en-AE')} sqft` : '—'}</td>
                    <td className="lf-num">{money(unit.price, unit.currency)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[unit.status] ?? 'slate'} value={unit.status} />
                      {expired && (
                        <>
                          {' '}
                          <Badge tone="vermillion">hold expired</Badge>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
