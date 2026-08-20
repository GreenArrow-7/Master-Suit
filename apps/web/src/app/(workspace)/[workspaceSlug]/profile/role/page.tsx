import { requirePageAccess, SELF_SERVICE } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';

export const metadata = { title: 'My role & access' };

/**
 * What am I responsible for, what can I see, what can I do — in the user's
 * language. The responsibility copy is curated per role; the access lists are
 * derived live from the actual grants, so this page cannot drift from what the
 * server enforces. Raw permission keys stay in the admin area.
 */

const SCOPE_LABEL: Record<string, string> = {
  OWN: 'records assigned to you',
  TEAM: 'your team’s records',
  BRANCH: 'your branch’s records',
  REGION: 'your region’s records',
  ORGANIZATION: 'all of Manath Homes',
};

const MODULE_LABEL: Record<string, string> = {
  leads: 'Leads',
  opportunities: 'Opportunities',
  accounts: 'Accounts',
  contacts: 'Contacts',
  activities: 'Activities',
  tasks: 'Tasks',
  calls: 'Calls & call audits',
  events: 'Events',
  campaigns: 'Campaigns',
  communications: 'Communications',
  documents: 'Documents',
  forms: 'Forms',
  landingpages: 'Landing pages',
  reports: 'Reports',
  dashboards: 'Dashboards',
  smartviews: 'Smart views',
  targets: 'Targets',
  users: 'User management',
  roles: 'Role management',
  settings: 'Workspace settings',
  integrations: 'Integrations',
  auditlogs: 'Audit logs',
};

const ROLE_COPY: Record<string, { title: string; responsibilities: string[] }> = {
  org_admin: {
    title: 'Organization Administrator',
    responsibilities: [
      'Run the Manath Homes workspace end to end',
      'Manage users, roles and teams',
      'Oversee the full pipeline, targets and SLA health',
      'Review calls, call audits and team performance',
      'Configure sales settings and integrations',
    ],
  },
  sales_director: {
    title: 'Sales Director',
    responsibilities: [
      'Own the organisation-wide pipeline and revenue',
      'Set and review targets across regions',
      'Monitor conversion, SLA and team performance',
    ],
  },
  team_manager: {
    title: 'Sales Manager',
    responsibilities: [
      'Run the sales team’s day: assignments, follow-ups, coverage',
      'Assign and reassign the team’s leads',
      'Track team targets, pipeline and SLA risks',
      'Review the team’s calls and call audits',
    ],
  },
  sales_rep: {
    title: 'Sales Representative',
    responsibilities: [
      'Work your assigned leads and opportunities',
      'Call customers and log every interaction',
      'Keep follow-ups and tasks on time',
      'Move deals through the pipeline to close',
    ],
  },
  analyst: {
    title: 'Call Quality & Reporting Analyst',
    responsibilities: [
      'Review calls, transcripts and quality audits',
      'Track agent performance and compliance',
      'Build and share reports and dashboards',
    ],
  },
  read_only: {
    title: 'Executive (read-only)',
    responsibilities: [
      'Follow business performance across the organisation',
      'Review pipeline, targets and conversion',
      'No records are edited from this account',
    ],
  },
};

export default async function RolePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  // Was `requestCtx()`, which resolves the actor but runs neither of the two
  // checks every other workspace page runs — the structural test in
  // tests/permission/page-access.spec.ts has been failing on exactly that. The
  // page shows the viewer their own role and needs no permission, which is what
  // SELF_SERVICE is for; going through requirePageAccess is what restores the
  // invariant that no workspace page reaches ctx by a private door.
  let ctx;
  try {
    ctx = await requirePageAccess({ permission: SELF_SERVICE });
  } catch {
    redirect('/login');
  }

  const [user, role] = await Promise.all([
    prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, id: ctx.actor.id },
      select: { fullName: true, email: true },
    }),
    prisma.role.findFirst({
      where: { tenantId: ctx.tenantId, id: ctx.actor.roleId },
      select: {
        key: true,
        name: true,
        permissions: {
          where: { granted: true },
          select: { scope: true, permission: { select: { module: true, action: true } } },
        },
      },
    }),
  ]);

  const copy = ROLE_COPY[role?.key ?? ''] ?? { title: role?.name ?? 'Team member', responsibilities: [] };

  // Collapse grants to "module → widest view scope + can create/edit" facts.
  const access = new Map<string, { view?: string; write: boolean }>();
  for (const grant of role?.permissions ?? []) {
    const { module, action } = grant.permission;
    if (!MODULE_LABEL[module]) continue;
    const entry = access.get(module) ?? { write: false };
    if (action === 'VIEW') entry.view = grant.scope;
    if (['CREATE', 'EDIT', 'DELETE', 'ASSIGN', 'MANAGE_CONFIGURATION', 'MANAGE_USERS'].includes(action))
      entry.write = true;
    access.set(module, entry);
  }
  const rows = [...access.entries()]
    .filter(([, v]) => v.view)
    .map(([module, v]) => ({
      module: MODULE_LABEL[module],
      scope: SCOPE_LABEL[v.view!] ?? v.view!,
      write: v.write,
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 'var(--lf-space-5)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          My role &amp; access
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          What this account is responsible for, and what it can see and do.
        </p>
      </header>

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{user?.fullName ?? user?.email}</div>
            <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>{user?.email}</div>
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <Badge tone="wine">{copy.title}</Badge>
          </span>
        </div>
      </section>

      {copy.responsibilities.length > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Your responsibilities
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 6, fontSize: 'var(--lf-text-sm)' }}>
            {copy.responsibilities.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
          Your access
        </div>
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Area</th>
                <th>You can see</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.module}>
                  <td data-label="Area" style={{ fontWeight: 500 }}>
                    {row.module}
                  </td>
                  <td data-label="You can see">{row.scope}</td>
                  <td data-label="Changes">
                    <Badge tone={row.write ? 'viridian' : 'slate'}>{row.write ? 'allowed' : 'read-only'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: 'var(--lf-space-3) 0 0', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-4)' }}>
          Access is enforced by the server on every request — hiding a menu is never the only barrier. Workspace:{' '}
          {workspaceSlug}.
        </p>
      </section>
    </div>
  );
}
