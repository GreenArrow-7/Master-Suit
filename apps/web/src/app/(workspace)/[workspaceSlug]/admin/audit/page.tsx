import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import EmptyState from '@/components/ui/EmptyState';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';

export const metadata = { title: 'Audit log' };

/**
 * The audit log, across every domain.
 *
 * Two things this has to do that a raw table of event codes does not:
 *
 *   1. **Show the actor as a person.** `actorUserId` is a cuid, and "who did
 *      this" is the first question anyone opening an audit log has.
 *   2. **Show the domain action.** Every HR operation records its specific verb
 *      in metadata — `leave.approved`, `document.downloaded`,
 *      `mfa.removed.by_admin` — while the coarse event enum only says
 *      RECORD_UPDATED. Without surfacing it, forty RECORD_UPDATED rows answer
 *      nothing.
 *
 * Sign-in events live in `PlatformAuditEvent` because they happen before a
 * workspace is resolved. They are merged in here so the log reads as one
 * timeline instead of making anyone check two screens.
 */
const DOMAINS: Record<string, { label: string; objectTypes: string[] }> = {
  auth: { label: 'Sign-in', objectTypes: ['platform_user', 'platform_session'] },
  access: { label: 'Accounts and roles', objectTypes: ['user', 'role', 'membership_role', 'hr_policy'] },
  leave: { label: 'Leave', objectTypes: ['hr_leave_request', 'hr_leave_balance'] },
  attendance: {
    label: 'Attendance',
    objectTypes: ['hr_attendance_punch', 'hr_attendance_exception_request', 'hr_temporary_location_request'],
  },
  lifecycle: { label: 'Lifecycle', objectTypes: ['employee', 'hr_checklist_task', 'hr_offboarding_case'] },
  documents: { label: 'Documents', objectTypes: ['hr_employee_document'] },
  biometrics: { label: 'Biometrics', objectTypes: ['biometric_consent', 'hr_face_template'] },
};

const title = (value: string) => value.replace(/[_.]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const truncate = (value: string) => (value.length > 40 ? `${value.slice(0, 40)}…` : value);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { domain } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: ['auditlogs', 'VIEW'] });

  if (!can(ctx, 'auditlogs', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view the audit log." />;
  }

  const selected = domain && DOMAINS[domain] ? DOMAINS[domain] : null;
  const showAuth = !selected || domain === 'auth';

  const [records, platformEvents] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, ...(selected ? { objectType: { in: selected.objectTypes } } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: 150,
      select: {
        id: true,
        event: true,
        objectType: true,
        fieldKey: true,
        previousValue: true,
        newValue: true,
        metadata: true,
        actorUserId: true,
        ipAddress: true,
        occurredAt: true,
      },
    }),
    showAuth
      ? prisma.platformAuditEvent.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { occurredAt: 'desc' },
          take: 60,
          select: {
            id: true,
            event: true,
            objectType: true,
            metadata: true,
            actorUserId: true,
            ipAddress: true,
            occurredAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // One name lookup for both tables rather than a join per row.
  const [users, platformUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: [...new Set(records.map((row) => row.actorUserId).filter(Boolean))] as string[] },
      },
      select: { id: true, fullName: true },
    }),
    prisma.platformUser.findMany({
      where: { id: { in: [...new Set(platformEvents.map((row) => row.actorUserId).filter(Boolean))] as string[] } },
      select: { id: true, fullName: true },
    }),
  ]);
  const names = new Map<string, string>([
    ...users.map((user) => [user.id, user.fullName] as const),
    ...platformUsers.map((user) => [user.id, user.fullName] as const),
  ]);

  const merged = [
    ...records.map((row) => ({
      id: row.id,
      at: row.occurredAt,
      actor: row.actorUserId ? (names.get(row.actorUserId) ?? 'Removed user') : 'System',
      action: (row.metadata as { action?: string } | null)?.action ?? row.event,
      event: row.event as string,
      objectType: row.objectType ?? '—',
      detail: describe(row),
      ip: row.ipAddress,
    })),
    ...platformEvents.map((row) => {
      const reason = (row.metadata as { reason?: string } | null)?.reason;
      return {
        id: row.id,
        at: row.occurredAt,
        actor: row.actorUserId ? (names.get(row.actorUserId) ?? 'Removed user') : 'System',
        action: reason ? `${row.event.toLowerCase()} · ${reason}` : row.event.toLowerCase(),
        event: row.event as string,
        objectType: row.objectType ?? 'platform_user',
        detail: describe({ fieldKey: null, previousValue: null, newValue: null, metadata: row.metadata }),
        ip: row.ipAddress,
      };
    }),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 200);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Audit log</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '80ch' }}>
          Who did what, and from where. Sign-in events are merged in from the platform log so this reads as one
          timeline. Nothing here can be edited or deleted from within the product.
        </p>
      </section>

      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Filter by domain">
        <Link className="lf-btn lf-btn--ghost" href="?" aria-current={!selected ? 'page' : undefined}>
          All
        </Link>
        {Object.entries(DOMAINS).map(([key, value]) => (
          <Link
            key={key}
            className="lf-btn lf-btn--ghost"
            href={`?domain=${key}`}
            aria-current={domain === key ? 'page' : undefined}
          >
            {value.label}
          </Link>
        ))}
      </nav>

      <WorkspaceTable
        headers={['When', 'Who', 'Action', 'Object', 'Detail', 'From']}
        empty="Nothing recorded in this domain yet."
        rows={merged.map((row) => [
          row.at.toLocaleString('en-AE', { timeZone: 'UTC' }),
          row.actor,
          <span key="a">
            <strong>{title(row.action)}</strong>
            {row.action !== row.event && (
              <div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>
                {row.event.toLowerCase().replace(/_/g, ' ')}
              </div>
            )}
          </span>,
          <code key="o" style={{ fontSize: 'var(--lf-text-xs)' }}>
            {row.objectType}
          </code>,
          <span key="d" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-600)' }}>
            {row.detail}
          </span>,
          row.ip ?? '—',
        ])}
      />
    </div>
  );
}

/** A one-line summary: the field that changed, or whatever else the action recorded. */
function describe(row: {
  fieldKey: string | null;
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
}): string {
  if (row.fieldKey) {
    return `${row.fieldKey}: ${truncate(JSON.stringify(row.previousValue) ?? 'null')} → ${truncate(JSON.stringify(row.newValue) ?? 'null')}`;
  }
  const metadata = { ...(row.metadata as Record<string, unknown> | null) };
  delete metadata.action;
  const parts = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined);
  return parts.length
    ? parts
        .map(([key, value]) => `${key}=${truncate(String(value))}`)
        .join(' · ')
        .slice(0, 120)
    : '—';
}
