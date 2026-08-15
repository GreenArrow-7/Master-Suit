import Link from 'next/link';
import { prisma } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';
import Badge, { type Tone } from '@/components/ui/Badge';
import { listPlatformUsers, platformUserDetail, type MfaState } from '@/services/platform/identity';
import UserDrawer, { type PlatformUserView } from './UserDrawer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform users' };

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'viridian',
  INVITED: 'brass',
  SUSPENDED: 'vermillion',
  DEACTIVATED: 'slate',
};
const MFA_TONE: Record<MfaState, Tone> = {
  ENABLED: 'viridian',
  ENROLMENT_PENDING: 'brass',
  ENROLMENT_REQUIRED: 'brass',
  RECOVERY_REQUIRED: 'brass',
  NOT_CONFIGURED: 'slate',
};
const MFA_LABEL: Record<MfaState, string> = {
  ENABLED: 'Enabled',
  ENROLMENT_PENDING: 'Enrolment pending',
  ENROLMENT_REQUIRED: 'Enrolment required',
  RECOVERY_REQUIRED: 'Recovery required',
  NOT_CONFIGURED: 'Not configured',
};

const when = (value: Date | null) => (value ? value.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const day = (value: Date) => value.toLocaleDateString('en-AE', { dateStyle: 'medium' });

type Query = {
  q?: string;
  workspace?: string;
  status?: string;
  role?: string;
  mfa?: string;
  lock?: string;
  user?: string;
};

/**
 * The operational answer to "this customer cannot sign in".
 *
 * Ordered the way the call actually goes: search for the person, read whether
 * the platform would let them in and why not, then act. The drawer is opened by
 * `?user=`, so the search that found them survives the repair.
 */
export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;

  const [rows, workspaces, roleKeys] = await Promise.all([
    listPlatformUsers({
      q: query.q,
      tenantId: query.workspace,
      status: query.status,
      role: query.role,
      lock: query.lock === 'LOCKED' || query.lock === 'NORMAL' ? query.lock : undefined,
      mfa:
        query.mfa === 'ENABLED' || query.mfa === 'DISABLED' || query.mfa === 'ENROLMENT_REQUIRED'
          ? query.mfa
          : undefined,
    }),
    prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
    // The role filter offers the keys actually in use across the platform, not a
    // hardcoded list that drifts the moment a workspace defines its own role.
    prisma.workspaceMembership
      .findMany({ where: { roleSnapshot: { not: null } }, select: { roleSnapshot: true }, distinct: ['roleSnapshot'] })
      .then((r) => r.map((row) => row.roleSnapshot!).sort()),
  ]);

  const detail = query.user ? await platformUserDetail(query.user).catch(() => null) : null;

  const locked = rows.filter((row) => row.locked).length;
  const mfaGap = rows.filter((row) => row.mfaState === 'ENROLMENT_REQUIRED').length;
  const inactive = rows.filter((row) => row.status !== 'ACTIVE').length;

  // Preserved across drawer open/close so closing returns to the same search.
  const listQuery = new URLSearchParams(
    Object.entries(query).filter(([key, value]) => key !== 'user' && value) as [string, string][],
  ).toString();
  const back = listQuery ? `/platform/users?${listQuery}` : '/platform/users';

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Identity & recovery"
        title="Platform users"
        description="Every login across every workspace. Inspect the real authentication state, unlock accounts, reset passwords and second factors, and repair workspace membership — without touching the database."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Platform users' }]}
      />

      <div className="lf-statstrip">
        <div className="lf-statstrip__item">
          <span className="lf-eyebrow">Matching accounts</span>
          <b>{rows.length}</b>
        </div>
        <div className="lf-statstrip__item" data-alarm={locked > 0}>
          <span className="lf-eyebrow">Locked</span>
          <b>{locked}</b>
        </div>
        <div className="lf-statstrip__item" data-alarm={mfaGap > 0}>
          <span className="lf-eyebrow">MFA enrolment due</span>
          <b>{mfaGap}</b>
        </div>
        <div className="lf-statstrip__item">
          <span className="lf-eyebrow">Not active</span>
          <b>{inactive}</b>
        </div>
      </div>

      <form className="lf-card lf-filters" method="get" role="search">
        <div className="lf-field lf-filters__search">
          <label className="lf-label" htmlFor="pu-q">
            Search
          </label>
          <input
            id="pu-q"
            className="lf-input"
            name="q"
            type="search"
            defaultValue={query.q ?? ''}
            placeholder="Name, email, workspace or role"
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="pu-workspace">
            Workspace
          </label>
          <select id="pu-workspace" className="lf-input" name="workspace" defaultValue={query.workspace ?? ''}>
            <option value="">All workspaces</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="pu-status">
            Account status
          </label>
          <select id="pu-status" className="lf-input" name="status" defaultValue={query.status ?? ''}>
            <option value="">Any</option>
            {['ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED'].map((value) => (
              <option key={value} value={value}>
                {value[0] + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="pu-role">
            Workspace role
          </label>
          <select id="pu-role" className="lf-input" name="role" defaultValue={query.role ?? ''}>
            <option value="">Any role</option>
            {roleKeys.map((key) => (
              <option key={key} value={key}>
                {key.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="pu-mfa">
            MFA
          </label>
          <select id="pu-mfa" className="lf-input" name="mfa" defaultValue={query.mfa ?? ''}>
            <option value="">Any</option>
            <option value="ENABLED">Enabled</option>
            <option value="DISABLED">Disabled</option>
            <option value="ENROLMENT_REQUIRED">Enrolment required</option>
          </select>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="pu-lock">
            Lock
          </label>
          <select id="pu-lock" className="lf-input" name="lock" defaultValue={query.lock ?? ''}>
            <option value="">Any</option>
            <option value="LOCKED">Locked</option>
            <option value="NORMAL">Not locked</option>
          </select>
        </div>
        <button className="lf-btn" type="submit">
          Apply
        </button>
        <Link className="lf-btn lf-btn--ghost" href="/platform/users">
          Clear
        </Link>
      </form>

      {rows.length === 0 ? (
        <div className="lf-card lf-empty">
          <span className="lf-empty__mark">∅</span>
          No account matches those filters.
        </div>
      ) : (
        <div className="lf-table-wrap">
          <table className="lf-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Workspace</th>
                <th>Workspace role</th>
                <th>Platform role</th>
                <th>Status</th>
                <th>MFA</th>
                <th>Lock</th>
                <th>Last login</th>
                <th>Fails</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.id}>
                  <td data-label="User">
                    <span className="lf-usercell">
                      <strong>{user.fullName}</strong>
                      <span>{user.email}</span>
                    </span>
                  </td>
                  <td data-label="Workspace">
                    {user.memberships.length === 0
                      ? '—'
                      : user.memberships.map((m) => m.tenant.displayName).join(', ')}
                  </td>
                  <td data-label="Workspace role">
                    {user.primaryMembership?.roleSnapshot?.replaceAll('_', ' ') ?? '—'}
                  </td>
                  <td data-label="Platform role">
                    <Badge tone={user.platformRole === 'USER' ? 'slate' : 'wine'}>
                      {user.platformRole.replaceAll('_', ' ')}
                    </Badge>
                  </td>
                  <td data-label="Status">
                    <Badge tone={STATUS_TONE[user.status] ?? 'slate'}>{user.status.toLowerCase()}</Badge>
                  </td>
                  <td data-label="MFA">
                    <Badge tone={MFA_TONE[user.mfaState]}>{MFA_LABEL[user.mfaState]}</Badge>
                  </td>
                  <td data-label="Lock">
                    {user.locked ? <Badge tone="vermillion">Locked</Badge> : <span>Normal</span>}
                  </td>
                  <td data-label="Last login" data-type="date">
                    {when(user.lastLoginAt)}
                  </td>
                  <td data-label="Fails" data-type="number">
                    {user.failedLoginCount}
                  </td>
                  <td data-label="Created" data-type="date">
                    {day(user.createdAt)}
                  </td>
                  <td data-label="">
                    <Link className="lf-btn lf-btn--secondary lf-btn--sm" href={`${back}${listQuery ? '&' : '?'}user=${user.id}`}>
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <UserDrawer user={serialise(detail)} back={back} />}
    </div>
  );
}

/**
 * Dates and Decimals do not survive the server→client boundary as themselves,
 * and the drawer only ever displays them. Formatting here also keeps a single
 * locale for the whole console.
 */
function serialise(detail: Awaited<ReturnType<typeof platformUserDetail>>): PlatformUserView {
  return {
    id: detail.id,
    fullName: detail.fullName,
    email: detail.email,
    phone: detail.phone,
    status: detail.status,
    platformRole: detail.platformRole,
    mfaState: detail.mfaState,
    locked: detail.locked,
    lockedUntil: detail.lockedUntil ? when(detail.lockedUntil) : null,
    failedLoginCount: detail.failedLoginCount,
    lastLoginAt: when(detail.lastLoginAt),
    createdAt: when(detail.createdAt),
    emailVerified: detail.emailVerifiedAt !== null,
    hasPassword: detail.hasPassword,
    mustChangePassword: detail.mustChangePassword,
    passwordChangedAt: detail.passwordChangedAt ? when(detail.passwordChangedAt) : null,
    canSignIn: detail.canSignIn,
    throttle: {
      used: detail.throttle.used,
      max: detail.throttle.max,
      throttled: detail.throttle.throttled,
      resetsAt: when(detail.throttle.resetsAt),
    },
    memberships: detail.memberships.map((membership) => ({
      id: membership.id,
      workspace: membership.tenant.displayName,
      slug: membership.tenant.slug,
      workspaceStatus: membership.tenant.status,
      status: membership.status,
      roleKey: membership.salesUser?.role.key ?? membership.roleSnapshot ?? null,
      roleName: membership.salesUser?.role.name ?? membership.roleSnapshot ?? 'Unknown',
      roleId: membership.salesUser?.roleId ?? null,
      salesUserStatus: membership.salesUser?.status ?? null,
      joinedAt: membership.joinedAt ? when(membership.joinedAt) : null,
      isPrimaryAdmin: membership.isPrimaryAdmin,
    })),
    effectiveAccess: detail.effectiveAccess,
    roleOptions: detail.roleOptions,
    events: detail.events.map((event) => {
      const meta = (typeof event.metadata === 'object' && event.metadata !== null ? event.metadata : {}) as Record<
        string,
        unknown
      >;
      return {
        id: event.id,
        event: event.event,
        occurredAt: when(event.occurredAt),
        // The refusal reason on a failed sign-in, or the result of an
        // administrative action. Never the value that was set.
        reason: (meta.reason as string | undefined) ?? (meta.scope as string | undefined) ?? null,
        // Distinguishes "this account signed in" from "an owner acted on it".
        byOperator: event.actorUserId !== null && event.actorUserId !== detail.id,
      };
    }),
  };
}
