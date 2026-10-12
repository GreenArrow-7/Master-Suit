import Link from 'next/link';
import { notFound } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';
import ListHeader from '@/components/workspace/ListHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { prisma } from '@/lib/db';
import { fieldMapOf, isLeadSource, LEAD_SOURCES, MAPPABLE_FIELDS } from '@/lib/integrations/leadSources';
import { entityRoute } from '@/lib/nav/entityRoute';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import { workspaceTimezone } from '@/services/hr/attendance';
import { inFlight, listDeliveries, type DeliveryStatus } from '@/services/leads/deliveries';
import { FieldMapEditor, ReplayButton } from './LeadSourceControls';

export const metadata = { title: 'Lead source' };

const STATUS: Record<DeliveryStatus, [label: string, tone: Tone]> = {
  created: ['Lead created', 'viridian'],
  attached: ['Added to an existing lead', 'viridian'],
  test: ['Test delivery', 'slate'],
  anonymous: ['Named nobody', 'brass'],
  processed: ['Processed', 'slate'],
  queued: ['Queued', 'slate'],
  retrying: ['Retrying', 'brass'],
  dead_lettered: ['Failed: gave up', 'vermillion'],
};

/**
 * A lead source's own screen, opened from its Integrations card: the
 * deliveries it has sent (M6-21, M6-22) and the map from its fields to the
 * lead's (M6-20). Reading needs integrations:VIEW; replaying and mapping need
 * MANAGE_CONFIGURATION, which the API checks again.
 */
export default async function LeadSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; provider: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string }>;
}) {
  const { workspaceSlug, provider } = await params;
  const query = await searchParams;
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'], module: LEAD_MODULES });
  if (!isLeadSource(provider)) notFound();
  const connection = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    select: { status: true, metadata: true },
  });
  if (!connection) notFound();

  const canEdit = can(ctx, 'integrations', 'MANAGE_CONFIGURATION');
  const mapping = query.tab === 'mapping';
  // An id, as the API takes it; anything else is the first page.
  const cursor = /^c[a-z0-9]{20,40}$/.test(query.cursor ?? '') ? query.cursor : undefined;
  const here = `/${workspaceSlug}/admin/lead-sources/${provider}`;
  const list = mapping ? null : await listDeliveries(ctx, provider, cursor);

  return (
    <>
      <Link className="lf-meta__back" href={`/${workspaceSlug}/admin/integrations`}>
        ← Integrations
      </Link>
      <ListHeader
        title={LEAD_SOURCES[provider].label}
        description={<Badge value={connection.status} />}
        help={
          <p>
            Every delivery is stored as it arrived before anything reads it. Replay one after changing the field
            mapping, or after the queue gave up on it, and it is read again with the mapping as it is now. A delivery
            that finds the lead it made again changes nothing on it; correct that lead on the lead itself.
          </p>
        }
      />
      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        <Link className="lf-tab" href={here} aria-selected={!mapping} role="tab">
          Deliveries
        </Link>
        <Link className="lf-tab" href={`${here}?tab=mapping`} aria-selected={mapping} role="tab">
          Field mapping
        </Link>
      </nav>
      {list ? (
        deliveries(list, await workspaceTimezone(ctx), { provider, cursor, here, slug: workspaceSlug, canEdit })
      ) : (
        <FieldMapEditor
          provider={provider}
          canEdit={canEdit}
          initial={Object.entries(fieldMapOf(connection.metadata))}
          fields={Object.entries(MAPPABLE_FIELDS).map(([value, { label }]) => ({ value, label }))}
        />
      )}
    </>
  );
}

/** The Deliveries tab: received in the workspace's time zone, newest first. */
function deliveries(
  { deliveries, nextCursor }: Awaited<ReturnType<typeof listDeliveries>>,
  timeZone: string,
  {
    provider,
    cursor,
    here,
    slug,
    canEdit,
  }: { provider: string; cursor?: string; here: string; slug: string; canEdit: boolean },
) {
  const when = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <WorkspaceTable
        headers={[
          { label: 'Received', priority: 'primary' },
          { label: 'Outcome', priority: 'secondary' },
          'Lead',
          'Attempts',
          'Last error',
          ...(canEdit ? ['Action'] : []),
        ]}
        searchable={false}
        empty="Nothing has been delivered yet. Deliveries appear here as the source sends them."
        rows={deliveries.map((d) => {
          const [label, tone] = STATUS[d.status];
          const lead = d.lead && entityRoute('lead', d.lead.id, slug);
          return [
            when.format(d.receivedAt),
            <Badge key="status" tone={tone}>
              {label}
            </Badge>,
            d.lead && lead ? (
              <Link key="lead" className="lf-link" href={lead}>
                {d.lead.name}
              </Link>
            ) : (
              '—'
            ),
            d.attempts,
            d.error ?? '—',
            // The queue still holds a queued or retrying one; replaying it beside that job would run it twice.
            ...(canEdit
              ? [inFlight(d.status) ? '—' : <ReplayButton key="replay" provider={provider} id={d.id} />]
              : []),
          ];
        })}
      />
      {(cursor || nextCursor) && (
        <nav style={{ display: 'flex', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-4)' }} aria-label="Pages">
          {cursor && (
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" href={here}>
              Newest
            </Link>
          )}
          {nextCursor && (
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" href={`${here}?cursor=${nextCursor}`}>
              Older
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
