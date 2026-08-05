import type { ReactNode } from 'react';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
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
  return new Date(value as string).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function duration(seconds: unknown): ReactNode {
  const total = Number(seconds ?? 0);
  if (!Number.isFinite(total) || total <= 0) return dash;
  const mins = Math.floor(total / 60);
  return <span className="lf-num">{mins}m {String(total % 60).padStart(2, '0')}s</span>;
}

function money(amount: unknown, currency: unknown = 'AED'): ReactNode {
  if (amount === null || amount === undefined) return dash;
  return <span className="lf-num">{String(currency)} {Number(amount).toLocaleString('en-AE')}</span>;
}

function bytes(value: unknown): ReactNode {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return dash;
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let n = size;
  while (n >= 1024 && index < units.length - 1) { n /= 1024; index += 1; }
  return <span className="lf-num">{n.toFixed(index === 0 ? 0 : 1)} {units[index]}</span>;
}

const overdue = (value: unknown) =>
  value && new Date(value as string) < new Date() ? 'var(--lf-vermillion)' : 'var(--lf-ink-2)';

function link(href: string, label: ReactNode, mono = false): ReactNode {
  return (
    <SalesLink href={href} style={mono
      ? { fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }
      : { fontWeight: 500, color: 'var(--lf-ink)' }}>
      {label}
    </SalesLink>
  );
}

const leadCell = (row: GridRow) =>
  row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;

/**
 * One place that knows how each configurable column is drawn. Keeping it here
 * rather than in thirteen page files is what makes a column reorderable at all —
 * the page no longer decides what sits in which position.
 */
export function renderCell(object: GridObject, key: string, row: GridRow): ReactNode {
  switch (object) {
    case 'ACCOUNT':
      switch (key) {
        case 'reference': return link(`/accounts/${row.id}`, row.reference, true);
        case 'name': return link(`/accounts/${row.id}`, row.name);
        case 'industry': return muted(row.industry ?? '—');
        case 'mainPhone': return muted(row.mainPhone ?? '—');
        case 'mainEmail': return muted(row.mainEmail ?? '—');
        case 'status': return row.status ? <Badge value={row.status} /> : dash;
        case 'customerTier': return row.customerTier ? <Badge value={row.customerTier} /> : dash;
        case 'owner': return row.owner?.fullName ?? dash;
        case 'updatedAt': return date(row.updatedAt);
        default: return dash;
      }

    case 'CONTACT':
      switch (key) {
        case 'reference': return link(`/contacts/${row.id}`, row.reference, true);
        case 'fullName': return link(`/contacts/${row.id}`, row.fullName);
        case 'jobTitle': return muted(row.jobTitle ?? '—');
        case 'account': return row.account ? link(`/accounts/${row.account.id}`, row.account.name) : dash;
        case 'email': return muted(row.email ?? '—');
        case 'phone': return muted(row.phone ?? '—');
        case 'owner': return row.owner?.fullName ?? dash;
        case 'updatedAt': return date(row.updatedAt);
        default: return dash;
      }

    case 'OPPORTUNITY':
      switch (key) {
        case 'reference': return link(`/opportunities/${row.id}`, row.reference, true);
        case 'name': return link(`/opportunities/${row.id}`, row.name);
        case 'account': return muted(row.account?.name ?? '—');
        case 'stage': return row.stage ? <Badge value={row.stage.key}>{row.stage.name}</Badge> : dash;
        case 'status': return <Badge value={row.status} />;
        case 'amount': return money(row.amount, row.currency);
        case 'probability': return row.probability == null ? dash : <span className="lf-num">{row.probability}%</span>;
        case 'expectedCloseDate': return date(row.expectedCloseDate);
        case 'owner': return row.owner?.fullName ?? dash;
        case 'updatedAt': return date(row.updatedAt);
        default: return dash;
      }

    case 'ACTIVITY':
      switch (key) {
        case 'occurredAt': return dateTime(row.occurredAt);
        case 'type': return row.type ? <Badge value={row.type.key}>{row.type.name}</Badge> : dash;
        case 'lead': return leadCell(row);
        case 'outcome': return muted(row.outcome ?? '—');
        case 'durationSecs': return duration(row.durationSecs);
        case 'owner': return row.owner?.fullName ?? dash;
        default: return dash;
      }

    case 'TASK':
      switch (key) {
        case 'title': return <span style={{ fontWeight: 500 }}>{row.title}</span>;
        case 'type': return row.type ? <Badge value={row.type.key}>{row.type.name}</Badge> : dash;
        case 'lead': return leadCell(row);
        case 'dueAt': return <span style={{ color: overdue(row.dueAt) }}>{date(row.dueAt)}</span>;
        case 'priority': return <Badge value={row.priority} />;
        case 'status': return <Badge value={row.status} />;
        case 'owner': return row.owner?.fullName ?? dash;
        case 'completedAt': return date(row.completedAt);
        default: return dash;
      }

    case 'CALL':
      switch (key) {
        case 'createdAt': return link(`/calls/${row.id}`, dateTime(row.createdAt));
        case 'recipientNumber': return <span style={{ fontFamily: 'var(--lf-font-mono)' }}>{row.recipientNumber ?? '—'}</span>;
        case 'direction': return <Badge value={row.direction} />;
        case 'durationSecs': return duration(row.durationSecs);
        case 'outcome': return row.outcome ? <Badge value={row.outcome} /> : dash;
        case 'status': return <Badge value={row.status} />;
        case 'startedAt': return dateTime(row.startedAt);
        case 'notes': return muted(row.notes ?? '—');
        default: return dash;
      }

    case 'CAMPAIGN':
      switch (key) {
        case 'name': return link(`/campaigns/${row.id}`, row.name);
        case 'campaignType': return muted(row.campaignType ?? '—');
        case 'channel': return row.channel ? <Badge value={row.channel} /> : dash;
        case 'status': return <Badge value={row.status} />;
        case 'startDate': return date(row.startDate);
        case 'endDate': return date(row.endDate);
        case 'budget': return row.budget == null ? dash : money(row.budget, row.currency ?? 'AED');
        default: return dash;
      }

    case 'COMMUNICATION':
      switch (key) {
        case 'createdAt': return dateTime(row.createdAt);
        case 'channel': return <Badge value={row.channel} />;
        case 'direction': return <Badge value={row.direction} />;
        case 'toAddress': return muted(row.toAddress ?? '—');
        case 'subject': return row.subject ?? dash;
        case 'status': return <Badge value={row.status} />;
        default: return dash;
      }

    case 'PRODUCT':
      switch (key) {
        case 'code': return <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}>{row.code}</span>;
        case 'name': return <span style={{ fontWeight: 500 }}>{row.name}</span>;
        case 'category': return muted(row.category ?? '—');
        case 'unitPrice': return money(row.unitPrice, row.currency ?? 'AED');
        case 'status': return <Badge value={row.status} />;
        default: return dash;
      }

    case 'TICKET':
      switch (key) {
        case 'number': return <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)' }}>{row.number}</span>;
        case 'subject': return <span style={{ fontWeight: 500 }}>{row.subject}</span>;
        case 'priority': return <Badge value={row.priority} />;
        case 'status': return <Badge value={row.status} />;
        case 'channel': return row.channel ? <Badge value={row.channel} /> : dash;
        case 'slaState': return row.slaState ? <Badge value={row.slaState} /> : dash;
        case 'agent': return row.agent?.fullName ?? dash;
        case 'createdAt': return date(row.createdAt);
        default: return dash;
      }

    case 'DOCUMENT':
      switch (key) {
        case 'name': return <span style={{ fontWeight: 500 }}>{row.name}</span>;
        case 'category': return muted(row.category ?? '—');
        case 'mimeType': return muted(row.mimeType ?? '—');
        case 'sizeBytes': return bytes(row.sizeBytes);
        case 'status': return <Badge value={row.status} />;
        case 'createdAt': return date(row.createdAt);
        default: return dash;
      }

    case 'FOLLOWUP':
      switch (key) {
        case 'title': return <span style={{ fontWeight: 500 }}>{row.title}</span>;
        case 'lead': return row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;
        case 'dueAt': return (
          <span style={{ color: overdue(row.dueAt) }}>
            {date(row.dueAt)}{row.dueAt && new Date(row.dueAt) < new Date() ? ' (overdue)' : ''}
          </span>
        );
        case 'priority': return <Badge value={row.priority} />;
        case 'status': return <Badge value={row.status} />;
        default: return dash;
      }

    case 'FIELDVISIT':
      switch (key) {
        case 'rep': return row.rep ?? dash;
        case 'lead': return row.lead ? link(`/leads/${row.lead.id}`, row.lead.fullName) : dash;
        case 'status': return <Badge value={row.status} />;
        case 'plannedAt': return dateTime(row.plannedAt);
        case 'checkInAt': return dateTime(row.checkInAt);
        case 'duration': return duration(row.durationSecs);
        case 'distanceMeters': return row.distanceMeters == null ? dash : <span className="lf-num">{Math.round(Number(row.distanceMeters))} m</span>;
        case 'geofenceOk': return <Badge value={row.geofenceOk ? 'INSIDE' : 'OUTSIDE'} tone={row.geofenceOk ? 'viridian' : 'vermillion'} />;
        case 'outcome': return muted(row.outcome ?? '—');
        default: return dash;
      }

    default:
      return dash;
  }
}
