import type { ReactNode } from 'react';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import FollowUpRowActions from '@/app/(workspace)/[workspaceSlug]/sales/follow-ups/FollowUpRowActions';
import type { GridObject } from '@/lib/grid/columns';

/** Rows arrive shaped by each page's own query, so access is deliberately loose. */
export type GridRow = Record<string, any>;

const dash = <span style={{ color: 'var(--lf-ink-3)' }}>—</span>;
const muted = (value: ReactNode) => <span style={{ color: 'var(--lf-ink-2)' }}>{value}</span>;

function date(value: unknown): ReactNode {
  if (!value) return dash;
  return new Date(value as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function dateTime(value: unknown): ReactNode {
  if (!value) return dash;
  return new Date(value as string).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function duration(seconds: unknown): ReactNode {
  const total = Number(seconds ?? 0);
  if (!Number.isFinite(total) || total <= 0) return dash;
  const mins = Math.floor(total / 60);
  return (
    <span className="lf-num">
      {mins}m {String(total % 60).padStart(2, '0')}s
    </span>
  );
}

function money(amount: unknown, currency: unknown = 'AED'): ReactNode {
  if (amount === null || amount === undefined) return dash;
  return (
    <span className="lf-num">
      {String(currency)} {Number(amount).toLocaleString('en-AE')}
    </span>
  );
}

function bytes(value: unknown): ReactNode {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return dash;
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let n = size;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index += 1;
  }
  return (
    <span className="lf-num">
      {n.toFixed(index === 0 ? 0 : 1)} {units[index]}
    </span>
  );
}

const overdue = (value: unknown) =>
  value && new Date(value as string) < new Date() ? 'var(--lf-vermillion)' : 'var(--lf-ink-2)';

function link(href: string, label: ReactNode, mono = false): ReactNode {
  return (
    <SalesLink
      href={href}
      style={
        mono
          ? { fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }
          : { fontWeight: 500, color: 'var(--lf-ink)' }
      }
    >
      {label}
    </SalesLink>
  );
}

const leadCell = (row: GridRow) => (row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash);

/**
 * One place that knows how each configurable column is drawn. Keeping it here
 * rather than in thirteen page files is what makes a column reorderable at all —
 * the page no longer decides what sits in which position.
 */
export function renderCell(object: GridObject, key: string, row: GridRow): ReactNode {
  switch (object) {
    case 'ACCOUNT':
      switch (key) {
        case 'reference':
          return link(`/accounts/${row.id}`, row.reference, true);
        case 'name':
          return link(`/accounts/${row.id}`, row.name);
        case 'industry':
          return muted(row.industry ?? '—');
        case 'mainPhone':
          return muted(row.mainPhone ?? '—');
        case 'mainEmail':
          return muted(row.mainEmail ?? '—');
        case 'status':
          return row.status ? <Badge value={row.status} /> : dash;
        case 'customerTier':
          return row.customerTier ? <Badge value={row.customerTier} /> : dash;
        case 'owner':
          return row.owner?.fullName ?? dash;
        case 'updatedAt':
          return date(row.updatedAt);
        default:
          return dash;
      }

    case 'CONTACT':
      switch (key) {
        case 'reference':
          return link(`/contacts/${row.id}`, row.reference, true);
        case 'fullName':
          return link(`/contacts/${row.id}`, row.fullName);
        case 'jobTitle':
          return muted(row.jobTitle ?? '—');
        case 'account':
          return row.account ? link(`/accounts/${row.account.id}`, row.account.name) : dash;
        case 'email':
          return muted(row.email ?? '—');
        case 'phone':
          return muted(row.phone ?? '—');
        case 'owner':
          return row.owner?.fullName ?? dash;
        case 'updatedAt':
          return date(row.updatedAt);
        default:
          return dash;
      }

    case 'OPPORTUNITY':
      switch (key) {
        case 'reference':
          return link(`/opportunities/${row.id}`, row.reference, true);
        case 'name':
          return link(`/opportunities/${row.id}`, row.name);
        case 'account':
          return muted(row.account?.name ?? '—');
        case 'stage':
          return row.stage ? <Badge value={row.stage.key}>{row.stage.name}</Badge> : dash;
        case 'status':
          return <Badge value={row.status} />;
        case 'amount':
          return money(row.amount, row.currency);
        case 'probability':
          return row.probability == null ? dash : <span className="lf-num">{row.probability}%</span>;
        case 'expectedCloseDate':
          return date(row.expectedCloseDate);
        case 'owner':
          return row.owner?.fullName ?? dash;
        case 'updatedAt':
          return date(row.updatedAt);
        default:
          return dash;
      }

    case 'ACTIVITY':
      switch (key) {
        case 'occurredAt':
          return dateTime(row.occurredAt);
        case 'type':
          return row.type ? <Badge value={row.type.key}>{row.type.name}</Badge> : dash;
        case 'lead':
          return leadCell(row);
        case 'outcome':
          return muted(row.outcome ?? '—');
        case 'durationSecs':
          return duration(row.durationSecs);
        case 'owner':
          return row.owner?.fullName ?? dash;
        default:
          return dash;
      }

    case 'TASK':
      switch (key) {
        case 'title':
          return <span style={{ fontWeight: 500 }}>{row.title}</span>;
        case 'type':
          return row.type ? <Badge value={row.type.key}>{row.type.name}</Badge> : dash;
        case 'lead':
          return leadCell(row);
        case 'dueAt':
          return <span style={{ color: overdue(row.dueAt) }}>{date(row.dueAt)}</span>;
        case 'priority':
          return <Badge value={row.priority} />;
        case 'status':
          return <Badge value={row.status} />;
        case 'owner':
          return row.owner?.fullName ?? dash;
        case 'completedAt':
          return date(row.completedAt);
        default:
          return dash;
      }

    case 'CALL':
      switch (key) {
        case 'createdAt':
          return link(`/calls/${row.id}`, dateTime(row.createdAt));
        case 'lead':
          return row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;
        case 'caller':
          return row.caller?.fullName ?? dash;
        case 'recipientNumber':
          return <span style={{ fontFamily: 'var(--lf-font-mono)' }}>{row.recipientNumber ?? '—'}</span>;
        case 'direction':
          return <Badge value={row.direction} />;
        case 'durationSecs':
          return duration(row.durationSecs);
        case 'outcome':
          return row.outcome ? <Badge value={row.outcome} /> : dash;
        case 'status':
          return <Badge value={row.status} />;
        case 'startedAt':
          return dateTime(row.startedAt);
        case 'notes':
          return muted(row.notes ?? '—');
        default:
          return dash;
      }

    case 'CAMPAIGN':
      switch (key) {
        case 'name':
          return link(`/campaigns/${row.id}`, row.name);
        case 'campaignType':
          return muted(row.campaignType ?? '—');
        case 'channel':
          return row.channel ? <Badge value={row.channel} /> : dash;
        case 'status':
          return <Badge value={row.status} />;
        case 'startDate':
          return date(row.startDate);
        case 'endDate':
          return date(row.endDate);
        case 'budget':
          return row.budget == null ? dash : money(row.budget, row.currency ?? 'AED');
        default:
          return dash;
      }

    case 'COMMUNICATION':
      switch (key) {
        case 'createdAt':
          return dateTime(row.createdAt);
        case 'channel':
          return <Badge value={row.channel} />;
        case 'direction':
          return <Badge value={row.direction} />;
        case 'toAddress':
          return muted(row.toAddress ?? '—');
        case 'subject':
          return row.subject ?? dash;
        case 'status':
          return <Badge value={row.status} />;
        default:
          return dash;
      }

    case 'PRODUCT':
      switch (key) {
        case 'code':
          return <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}>{row.code}</span>;
        case 'name':
          return <span style={{ fontWeight: 500 }}>{row.name}</span>;
        case 'category':
          return muted(row.category ?? '—');
        case 'unitPrice':
          return money(row.unitPrice, row.currency ?? 'AED');
        case 'status':
          return <Badge value={row.status} />;
        default:
          return dash;
      }

    case 'TICKET':
      switch (key) {
        case 'number':
          return <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}>{row.number}</span>;
        case 'subject':
          return <span style={{ fontWeight: 500 }}>{row.subject}</span>;
        case 'priority':
          return <Badge value={row.priority} />;
        case 'status':
          return <Badge value={row.status} />;
        case 'channel':
          return row.channel ? <Badge value={row.channel} /> : dash;
        case 'slaState':
          return row.slaState ? <Badge value={row.slaState} /> : dash;
        case 'agent':
          return row.agent?.fullName ?? dash;
        case 'createdAt':
          return date(row.createdAt);
        default:
          return dash;
      }

    case 'DOCUMENT':
      switch (key) {
        case 'name':
          // Plain anchor on purpose: SalesLink would prefix the module base
          // onto an /api path. Only clean files are downloadable.
          return row.scanState === 'CLEAN' ? (
            <a href={`/api/v1/documents/${row.id}/download`} style={{ fontWeight: 500 }}>
              {row.name}
            </a>
          ) : (
            <span style={{ fontWeight: 500 }}>{row.name}</span>
          );
        case 'category':
          return muted(row.category ?? '—');
        case 'mimeType':
          return muted(row.mimeType ?? '—');
        case 'sizeBytes':
          return bytes(row.sizeBytes);
        case 'status':
          return <Badge value={row.status} />;
        case 'createdAt':
          return date(row.createdAt);
        default:
          return dash;
      }

    case 'FOLLOWUP':
      switch (key) {
        case 'title':
          return <span style={{ fontWeight: 500 }}>{row.title}</span>;
        case 'actions':
          return <FollowUpRowActions id={String(row.id)} status={String(row.status)} />;
        case 'lead':
          return row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;
        case 'owner':
          /**
           * A tag, because this column only appears on a list spanning several
           * people and the eye scans for whose row it is before reading
           * anything else — but the name is passed as a child, not as `value`.
           *
           * `Badge` lower-cases its `value`, which is right for the enum labels
           * it exists to render (`IN_PROGRESS` → "in progress") and wrong for a
           * person: it turned "Sana Chowdhury" into "sana chowdhury".
           */
          return row.owner ? <Badge value="owner">{String(row.owner)}</Badge> : dash;
        case 'dueAt':
          return (
            <span style={{ color: overdue(row.dueAt) }}>
              {date(row.dueAt)}
              {row.dueAt && new Date(row.dueAt) < new Date() ? ' (overdue)' : ''}
            </span>
          );
        case 'priority':
          return <Badge value={row.priority} />;
        case 'status':
          return <Badge value={row.status} />;
        default:
          return dash;
      }

    case 'FIELDVISIT':
      switch (key) {
        case 'rep':
          return row.rep ?? dash;
        case 'lead':
          return row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;
        case 'status':
          return <Badge value={row.status} />;
        case 'plannedAt':
          return dateTime(row.plannedAt);
        case 'checkInAt':
          return dateTime(row.checkInAt);
        case 'duration':
          return duration(row.durationSecs);
        case 'distanceMeters':
          return row.distanceMeters == null ? (
            dash
          ) : (
            <span className="lf-num">{Math.round(Number(row.distanceMeters))} m</span>
          );
        case 'geofenceOk':
          return (
            <Badge value={row.geofenceOk ? 'INSIDE' : 'OUTSIDE'} tone={row.geofenceOk ? 'viridian' : 'vermillion'} />
          );
        case 'outcome':
          return muted(row.outcome ?? '—');
        default:
          return dash;
      }

    case 'PROJECT':
      switch (key) {
        case 'name':
          return link(`/projects/${row.id}`, row.name);
        case 'code':
          return muted(row.code ?? '—');
        case 'micromarket':
          return row.micromarket ? `${row.micromarket.name}, ${row.micromarket.city}` : dash;
        case 'developer':
          return row.developer ? row.developer.name : dash;
        case 'priceBand':
          // One cell, because a buyer reads a band, not two numbers in two columns.
          return row.minPrice == null && row.maxPrice == null
            ? dash
            : money(row.minPrice ?? row.maxPrice, row.currency);
        case 'pricePerSqft':
          return money(row.pricePerSqft, row.currency);
        case 'possession':
          return <Badge value={row.possessionStatus} />;
        case 'availability':
          // The number that decides whether this row is worth opening: what is
          // still sellable, against what was ever built.
          return row.totalUnits === 0 ? (
            dash
          ) : (
            <span className="lf-num" style={{ color: row.availableUnits === 0 ? 'var(--lf-ink-3)' : undefined }}>
              {row.availableUnits} / {row.totalUnits}
            </span>
          );
        case 'status':
          return <Badge value={row.status} />;
        case 'unitTypes':
          return row.unitTypes?.length ? muted(row.unitTypes.join(', ')) : dash;
        case 'flags':
          return (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {row.isPriority ? <Badge value="PRIORITY" tone="brass" /> : null}
              {row.isPitchable ? null : <Badge value="NOT PITCHABLE" tone="slate" />}
            </span>
          );
        case 'updatedAt':
          return dateTime(row.updatedAt);
        default:
          return dash;
      }

    case 'LISTING':
      switch (key) {
        case 'reference':
          return link(`/listings/${row.id}`, row.reference, true);
        case 'title':
          return link(`/listings/${row.id}`, row.title);
        case 'listingType':
          return <Badge value={row.listingType} tone={row.listingType === 'RENT' ? 'brass' : 'viridian'} />;
        case 'propertyType':
          return muted(
            String(row.propertyType ?? '')
              .replace(/_/g, ' ')
              .toLowerCase(),
          );
        case 'priceCell':
          // Rent carries its frequency; a sale price has none and needs none.
          return (
            <span className="lf-num">
              {money(row.price, row.currency)}
              {row.rentFrequency ? (
                <span style={{ color: 'var(--lf-ink-3)' }}>
                  {' /'}
                  {String(row.rentFrequency).toLowerCase().slice(0, 2)}
                </span>
              ) : null}
            </span>
          );
        case 'beds':
          return row.bedrooms == null ? dash : <span className="lf-num">{row.bedrooms}</span>;
        case 'areaSqft':
          return row.areaSqft == null ? dash : <span className="lf-num">{row.areaSqft.toLocaleString('en-GB')}</span>;
        case 'micromarket':
          return row.micromarket ? `${row.micromarket.name}, ${row.micromarket.city}` : dash;
        case 'status':
          return <Badge value={row.status} />;
        case 'mandate':
          // The expiry is the number that matters, so it sits in the cell rather
          // than a click away — an exclusive with nine days left needs chasing.
          if (!row.mandateType) return dash;
          return (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
              <Badge value={row.mandateType} tone={row.mandateType === 'EXCLUSIVE' ? 'viridian' : 'slate'} />
              {row.mandateExpires ? (
                <span style={{ fontSize: 'var(--lf-text-xs)', color: overdue(row.mandateExpires) }}>
                  {date(row.mandateExpires)}
                </span>
              ) : null}
            </span>
          );
        case 'propertyOwner':
          return row.propertyOwner ? row.propertyOwner.fullName : dash;
        case 'updatedAt':
          return dateTime(row.updatedAt);
        default:
          return dash;
      }

    default:
      return dash;
  }
}
