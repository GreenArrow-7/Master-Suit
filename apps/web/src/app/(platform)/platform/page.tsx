import Link from 'next/link';
import { withPlatformTx } from '@/lib/db';
import { PRODUCT_NAME } from '@/lib/branding';
import { buildId } from '@/lib/build';
import { platformSecuritySnapshot } from '@/services/platform/identity';

/**
 * The owner's control room.
 *
 * The masthead is the one dark brand surface in the console — the same wine the
 * login door uses — and its headline is a live sentence about the customer
 * base, with the figure set in the display serif the product reserves for hero
 * metrics. Below it, each product module gets a panel in its own identity
 * color (viridian is People everywhere in the product, wine is Sales), showing
 * adoption as a share of the base. The ledger closes the page in the audit
 * voice: tone dots and monospace timestamps.
 */
export default async function PlatformOverviewPage() {
  const [
    workspaceCount,
    activeCount,
    trialCount,
    suspendedCount,
    userCount,
    employeeCount,
    hrmsCount,
    salesCount,
    recentEvents,
  ] = // Platform reads span every tenant, so they run with app.platform_admin set.
    // Without it the RLS policies match no rows and the console reported zero
    // employees, no modules and no subscriptions for perfectly healthy workspaces.
    await withPlatformTx((tx) =>
      Promise.all([
        tx.tenant.count({ where: { deletedAt: null } }),
        tx.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        tx.tenantSubscription.count({ where: { tenantId: { not: '' }, state: 'TRIAL' } }),
        tx.tenant.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
        tx.platformUser.count({ where: { deletedAt: null } }),
        tx.employeeProfile.count({ where: { tenantId: { not: '' }, deletedAt: null } }),
        tx.moduleEntitlement.count({
          where: {
            tenantId: { not: '' },
            module: 'HRMS',
            state: { in: ['TRIAL', 'ACTIVE', 'GRACE'] },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
        }),
        tx.moduleEntitlement.count({
          where: {
            tenantId: { not: '' },
            module: 'SALES',
            state: { in: ['TRIAL', 'ACTIVE', 'GRACE'] },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
        }),
        tx.platformAuditEvent.findMany({
          take: 9,
          orderBy: { occurredAt: 'desc' },
          include: { actor: true, tenant: true },
        }),
      ]),
    );

  // The counters an operator acts on, kept separate from the commercial ones
  // above: a locked account is a support call already in progress.
  const security = await platformSecuritySnapshot();

  const modules = [
    {
      key: 'people',
      title: 'People / HRMS',
      accent: 'var(--lf-viridian)',
      count: hrmsCount,
      blurb: 'Employees, attendance, leave and payroll.',
      href: '/platform/workspaces',
      linkLabel: 'Workspaces →',
    },
    {
      key: 'sales',
      title: 'Sales CRM',
      accent: 'var(--lf-wine-700)',
      count: salesCount,
      blurb: 'Leads, pipeline, calls and campaigns.',
      href: '/platform/subscriptions',
      linkLabel: 'Subscriptions →',
    },
  ];

  const eventTone = (event: string) =>
    event.includes('DELETED') || event.includes('CANCELED')
      ? 'var(--lf-vermillion)'
      : event.includes('CREATED')
        ? 'var(--lf-viridian)'
        : event.includes('LOGIN')
          ? 'var(--lf-brass)'
          : 'var(--lf-slate)';

  return (
    <div className="lf-page-stack">
      {/* Masthead */}
      <section className="lf-command-band">
        <div
          className="lf-command-band__row"
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 28,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="lf-eyebrow">Commercial operations</div>
            <h1 className="lf-command-band__headline">
              <strong>{activeCount}</strong> {activeCount === 1 ? 'company runs' : 'companies run'} on {PRODUCT_NAME}.
            </h1>
            <p className="lf-command-band__sub">
              {userCount} platform users · {employeeCount} employee records under management ·{' '}
              <span title="Running build">build {buildId()}</span>
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <Link className="lf-btn lf-btn--brass" href="/platform/workspaces/new">
                Create workspace
              </Link>
              <Link className="lf-btn lf-btn--onband" href="/platform/subscriptions">
                View subscriptions
              </Link>
            </div>
          </div>

          <div className="lf-stat-strip">
            {[
              { label: 'Workspaces', value: workspaceCount, href: '/platform/workspaces' },
              { label: 'Active', value: activeCount, href: '/platform/workspaces' },
              { label: 'In trial', value: trialCount, href: '/platform/subscriptions' },
              { label: 'Suspended', value: suspendedCount, href: '/platform/workspaces' },
            ].map((stat) => (
              <Link key={stat.label} href={stat.href}>
                <span className="lf-figure" style={{ color: '#fff' }}>
                  {stat.value}
                </span>
                <span className="lf-eyebrow">{stat.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Module adoption */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {modules.map((module) => {
          const share = workspaceCount ? Math.round((module.count / workspaceCount) * 100) : 0;
          return (
            <article
              key={module.key}
              className="lf-module-panel"
              style={{ ['--panel-accent' as string]: module.accent }}
            >
              <div className="lf-module-panel__head">
                <h2 className="lf-module-panel__title">{module.title}</h2>
                <Link className="lf-module-panel__link" href={module.href}>
                  {module.linkLabel}
                </Link>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="lf-figure lf-figure--lg">{module.count}</span>
                <span style={{ color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
                  of {workspaceCount} workspaces · {share}%
                </span>
              </div>
              <div
                className="lf-meter"
                style={{ marginTop: 10 }}
                role="img"
                aria-label={`${module.title} enabled in ${module.count} of ${workspaceCount} workspaces`}
              >
                <span style={{ width: `${share}%` }} />
              </div>
              <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                {module.blurb}
              </p>
            </article>
          );
        })}

        {/* Directory */}
        <article className="lf-module-panel">
          <div className="lf-module-panel__head">
            <h2 className="lf-module-panel__title">Directory</h2>
            <Link className="lf-module-panel__link" href="/platform/users">
              Platform users →
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 34 }}>
            <div>
              <span className="lf-figure lf-figure--lg">{userCount}</span>
              <div className="lf-eyebrow" style={{ marginTop: 4 }}>
                Logins
              </div>
            </div>
            <div>
              <span className="lf-figure lf-figure--lg">{employeeCount}</span>
              <div className="lf-eyebrow" style={{ marginTop: 4 }}>
                Employees
              </div>
            </div>
          </div>
          <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            One account per person, however many workspaces they belong to.
          </p>
        </article>
      </section>

      {/* Accounts needing attention.
          Deliberately above the ledger: the ledger says what happened, this says
          what is still wrong and links straight to the screen that fixes it. */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 className="lf-h2" style={{ margin: 0 }}>
            Accounts needing attention
          </h2>
          <Link href="/platform/users" style={{ fontSize: 'var(--lf-text-sm)' }}>
            Platform users →
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <article className="lf-module-panel" style={{ ['--panel-accent' as string]: 'var(--lf-vermillion)' }}>
            <div className="lf-module-panel__head">
              <h3 className="lf-module-panel__title">Locked accounts</h3>
              <Link className="lf-module-panel__link" href="/platform/users?lock=LOCKED">
                Review →
              </Link>
            </div>
            <span className="lf-figure lf-figure--lg">{security.locked.length}</span>
            {security.locked.length === 0 ? (
              <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                Nobody is locked out right now.
              </p>
            ) : (
              <ul className="lf-eventlist" style={{ marginTop: 10 }}>
                {security.locked.map((row) => (
                  <li key={row.id}>
                    <Link href={`/platform/users?user=${row.id}`}>{row.email}</Link>
                    <time>locked after repeated attempts</time>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="lf-module-panel" style={{ ['--panel-accent' as string]: 'var(--lf-brass)' }}>
            <div className="lf-module-panel__head">
              <h3 className="lf-module-panel__title">Privileged without MFA</h3>
              <Link className="lf-module-panel__link" href="/platform/users?mfa=ENROLMENT_REQUIRED">
                Review →
              </Link>
            </div>
            <span className="lf-figure lf-figure--lg">{security.privilegedWithoutMfa.length}</span>
            <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
              {security.privilegedWithoutMfa.length === 0
                ? 'Every platform role that can cross a tenant boundary has a second factor.'
                : 'These accounts reach customer data. Login routes them to enrolment before it issues a session.'}
            </p>
            {security.privilegedWithoutMfa.length > 0 && (
              <ul className="lf-eventlist" style={{ marginTop: 10 }}>
                {security.privilegedWithoutMfa.map((row) => (
                  <li key={row.id}>
                    <Link href={`/platform/users?user=${row.id}`}>{row.email}</Link>
                    <time>{row.platformRole.replaceAll('_', ' ').toLowerCase()}</time>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="lf-module-panel">
            <div className="lf-module-panel__head">
              <h3 className="lf-module-panel__title">Sign-in failures</h3>
              <Link className="lf-module-panel__link" href="/platform/audit">
                Audit log →
              </Link>
            </div>
            <span className="lf-figure lf-figure--lg">{security.failures}</span>
            <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
              Refused sign-ins in the last 24 hours, across every workspace. The form tells the visitor nothing; the
              reason is recorded here and shown per account in Platform users.
            </p>
          </article>
        </div>
      </section>

      {/* Ledger */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 className="lf-h2" style={{ margin: 0 }}>
            Recent platform activity
          </h2>
          <Link href="/platform/audit" style={{ fontSize: 'var(--lf-text-sm)' }}>
            Full audit log →
          </Link>
        </div>
        <div className="lf-ledger">
          {recentEvents.length === 0 ? (
            <div className="lf-empty">
              <strong>No platform events yet</strong>
              <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-3)' }}>
                Provisioning, sign-ins and subscription changes will appear here as they happen.
              </p>
            </div>
          ) : (
            recentEvents.map((event) => (
              <div key={event.id} className="lf-ledger__row">
                <span className="lf-ledger__dot" style={{ background: eventTone(event.event) }} aria-hidden="true" />
                <span className="lf-ledger__event">{event.event.replaceAll('_', ' ')}</span>
                <span className="lf-ledger__meta">{event.tenant?.displayName ?? 'Global'}</span>
                <span className="lf-ledger__meta">{event.actor?.email ?? 'System'}</span>
                <span className="lf-ledger__time">{event.occurredAt.toLocaleString('en-AE')}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
