'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PRODUCT_NAME } from '@/lib/branding';

type Item = { label: string; href: string; icon: IconName; permission?: string };
type Section = { label: string; items: Item[] };
type IconName =
  | 'home'
  | 'bell'
  | 'task'
  | 'lead'
  | 'deal'
  | 'company'
  | 'contact'
  | 'activity'
  | 'calendar'
  | 'call'
  | 'campaign'
  | 'report'
  | 'people'
  | 'attendance'
  | 'leave'
  | 'org'
  | 'document'
  | 'settings'
  | 'shield';

export default function WorkspaceSidebar({
  slug,
  name,
  modules,
  permitted,
  workspaces,
  user,
}: {
  slug: string;
  name: string;
  modules: string[];
  /** Permission modules the signed-in role may VIEW, resolved server-side. */
  permitted: string[];
  workspaces: { slug: string; name: string }[];
  user: { name: string; role: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeModule = pathname.includes('/people') ? 'people' : 'sales';

  // Remembering the module is a side effect and belongs here. Closing the
  // mobile drawer is not: setting state synchronously in an effect causes a
  // second render pass on every navigation. It happens where the navigation
  // happens instead — on the link click.
  useEffect(() => {
    window.localStorage.setItem(`master-suite:${slug}:module`, activeModule);
  }, [activeModule, slug]);

  const sections = useMemo<Section[]>(() => {
    const common: Section = {
      label: 'Work',
      items: [
        { label: 'Overview', href: `/${slug}/dashboard`, icon: 'home' },
        { label: 'Notifications', href: `/${slug}/notifications`, icon: 'bell' },
        { label: 'My tasks', href: `/${slug}/tasks`, icon: 'task' },
      ],
    };
    // People was rendered unfiltered — every HR screen shown to everyone in an
    // HRMS workspace. Now keyed on the granular permissions from P1-8. Check-in
    // is deliberately unkeyed: recording your own attendance is self-service.
    if (activeModule === 'people')
      return [
        common,
        {
          label: 'People',
          items: (
            [
              { label: 'People overview', href: `/${slug}/people`, icon: 'people', permission: 'employee' },
              { label: 'Employees', href: `/${slug}/people/employees`, icon: 'people', permission: 'employee' },
              { label: 'Check in', href: `/${slug}/people/check-in`, icon: 'attendance' },
              { label: 'Attendance', href: `/${slug}/people/attendance`, icon: 'attendance', permission: 'employee' },
              { label: 'Leave', href: `/${slug}/people/leave`, icon: 'leave', permission: 'employee' },
              // Unkeyed to `overtime` deliberately: claiming your own overtime is
              // self-service, the same as checking in. The page shows the
              // approval queue only to someone holding `overtime:APPROVE`.
              { label: 'Overtime', href: `/${slug}/people/overtime`, icon: 'attendance', permission: 'employee' },
              // Reading your own payslip is self-service; administering payroll
              // is not. Two entries, two different keys — §90 keeps HR and
              // payroll separable, so managing people must not reveal salaries.
              { label: 'My pay', href: `/${slug}/people/payslips`, icon: 'report', permission: 'employee' },
              { label: 'Payroll', href: `/${slug}/people/payroll`, icon: 'report', permission: 'payroll' },
              { label: 'Lifecycle', href: `/${slug}/people/lifecycle`, icon: 'shield', permission: 'employee' },
              { label: 'Departments', href: `/${slug}/people/departments`, icon: 'org', permission: 'employee' },
              {
                label: 'Work locations',
                href: `/${slug}/people/work-locations`,
                icon: 'company',
                permission: 'employee',
              },
              { label: 'Requests', href: `/${slug}/people/requests`, icon: 'task', permission: 'employee' },
              { label: 'Shifts', href: `/${slug}/people/shifts`, icon: 'calendar', permission: 'employee' },
              // Unkeyed to `shifts` deliberately: everyone reads their own
              // roster and can ask to change it. The page shows the planning
              // tools only to someone holding `shifts:EDIT`.
              { label: 'Roster', href: `/${slug}/people/roster`, icon: 'calendar', permission: 'employee' },
              { label: 'Holidays', href: `/${slug}/people/holidays`, icon: 'calendar', permission: 'employee' },
              { label: 'Documents', href: `/${slug}/people/documents`, icon: 'document', permission: 'hr_documents' },
              // Unkeyed to `performance` deliberately: writing your own
              // self-assessment and acknowledging your own review are
              // self-service. The page shows the manager and HR sections only to
              // people the service will actually let write them.
              { label: 'Performance', href: `/${slug}/people/performance`, icon: 'report', permission: 'employee' },
              { label: 'Recruitment', href: `/${slug}/people/recruitment`, icon: 'people', permission: 'recruitment' },
              { label: 'People reports', href: `/${slug}/people/reports`, icon: 'report', permission: 'employee' },
              { label: 'HR policy', href: `/${slug}/people/settings`, icon: 'settings', permission: 'employee' },
            ] as Item[]
          ).filter((item) => !item.permission || permitted.includes(item.permission)),
        },
      ];
    const sales: Section[] = [
      {
        label: 'My day',
        items: [
          { label: 'Sales overview', href: `/${slug}/sales`, icon: 'home' },
          { label: 'My targets', href: `/${slug}/sales/targets`, icon: 'report' },
          { label: 'Follow-ups', href: `/${slug}/sales/follow-ups`, icon: 'task' },
          { label: 'Smart views', href: `/${slug}/sales/smart-views`, icon: 'activity', permission: 'smartviews' },
        ],
      },
      {
        label: 'Pipeline',
        items: [
          { label: 'Leads', href: `/${slug}/sales/leads`, icon: 'lead', permission: 'leads' },
          { label: 'Opportunities', href: `/${slug}/sales/opportunities`, icon: 'deal', permission: 'opportunities' },
          { label: 'Accounts', href: `/${slug}/sales/accounts`, icon: 'company', permission: 'accounts' },
          { label: 'Contacts', href: `/${slug}/sales/contacts`, icon: 'contact', permission: 'contacts' },
          { label: 'Activities', href: `/${slug}/sales/activities`, icon: 'activity', permission: 'activities' },
          { label: 'Tasks', href: `/${slug}/sales/tasks`, icon: 'task', permission: 'tasks' },
          { label: 'Calendar', href: `/${slug}/sales/calendar`, icon: 'calendar', permission: 'tasks' },
        ],
      },
      {
        // Inventory sits above Engage on purpose: a salesperson opens what they
        // are selling before they open the thing they are selling it with.
        label: 'Inventory',
        items: [
          { label: 'Projects', href: `/${slug}/sales/projects`, icon: 'company', permission: 'projects' },
          { label: 'Listings', href: `/${slug}/sales/listings`, icon: 'deal', permission: 'listings' },
          { label: 'Requirements', href: `/${slug}/sales/requirements`, icon: 'lead', permission: 'requirements' },
        ],
      },
      {
        label: 'Engage',
        items: [
          { label: 'Calls', href: `/${slug}/sales/calls`, icon: 'call', permission: 'calls' },
          { label: 'Events', href: `/${slug}/sales/events`, icon: 'calendar', permission: 'events' },
          { label: 'Campaigns', href: `/${slug}/sales/campaigns`, icon: 'campaign', permission: 'campaigns' },
          {
            label: 'Communications',
            href: `/${slug}/sales/communications`,
            icon: 'activity',
            permission: 'communications',
          },
        ],
      },
      {
        label: 'Grow',
        items: [
          { label: 'Forms', href: `/${slug}/sales/forms`, icon: 'document', permission: 'forms' },
          {
            label: 'Landing pages',
            href: `/${slug}/sales/landing-pages`,
            icon: 'document',
            permission: 'landingpages',
          },
          { label: 'Automation', href: `/${slug}/sales/automation`, icon: 'settings', permission: 'automation' },
        ],
      },
      {
        label: 'Operate',
        items: [
          { label: 'Field sales', href: `/${slug}/sales/field-sales`, icon: 'company', permission: 'fieldsales' },
          { label: 'Service', href: `/${slug}/sales/service`, icon: 'shield', permission: 'tickets' },
          { label: 'Documents', href: `/${slug}/sales/documents`, icon: 'document', permission: 'documents' },
          { label: 'Products', href: `/${slug}/sales/products`, icon: 'deal', permission: 'products' },
        ],
      },
      {
        label: 'Insight',
        items: [
          { label: 'Reports', href: `/${slug}/sales/reports`, icon: 'report', permission: 'reports' },
          { label: 'Dashboards', href: `/${slug}/sales/dashboards`, icon: 'report', permission: 'dashboards' },
          { label: 'Call audits', href: `/${slug}/sales/call-audits`, icon: 'shield', permission: 'calls' },
        ],
      },
    ];

    return [common, ...sales]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || permitted.includes(item.permission)),
      }))
      .filter((section) => section.items.length > 0);
  }, [activeModule, permitted, slug]);

  /**
   * Administration, filtered like everything else.
   *
   * Every entry here was rendered to every user unconditionally, while the Sales
   * items above were already filtered — so an ordinary employee saw Users, Roles
   * & permissions, Subscription, Security and Audit logs in their sidebar and
   * got a 403 on clicking any of them.
   *
   * This is presentation only. The pages themselves assert their permission
   * server-side (P1-1); hiding a link the URL still reaches would be theatre.
   * "My security" carries no permission because it shows only your own account.
   */
  const administration: Item[] = (
    [
      { label: 'Company profile', href: `/${slug}/admin/company`, icon: 'company', permission: 'settings' },
      { label: 'Users', href: `/${slug}/admin/users`, icon: 'people', permission: 'users' },
      { label: 'Roles & permissions', href: `/${slug}/admin/roles`, icon: 'shield', permission: 'roles' },
      { label: 'Modules', href: `/${slug}/admin/modules`, icon: 'settings', permission: 'settings' },
      { label: 'Subscription', href: `/${slug}/admin/subscription`, icon: 'document', permission: 'settings' },
      { label: 'Integrations', href: `/${slug}/admin/integrations`, icon: 'activity', permission: 'integrations' },
      { label: 'Security', href: `/${slug}/admin/security`, icon: 'shield', permission: 'settings' },
      { label: 'My security', href: `/${slug}/profile/security`, icon: 'shield' },
      { label: 'Settings', href: `/${slug}/admin/settings`, icon: 'settings', permission: 'settings' },
      { label: 'Audit logs', href: `/${slug}/admin/audit`, icon: 'report', permission: 'auditlogs' },
    ] as Item[]
  ).filter((item) => !item.permission || permitted.includes(item.permission));

  return (
    <>
      <button
        className="lf-mobile-nav-button"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
      >
        ☰
      </button>
      <aside className="lf-workspace-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
        <div className="lf-sidebar-brand">
          <Link href={`/${slug}/dashboard`} className="lf-brand-mark" aria-label={`${name} dashboard`}>
            {initials(name)}
          </Link>
          {!collapsed && (
            <div className="lf-brand-copy">
              <strong>{name}</strong>
              {workspaces.length > 1 ? (
                <select
                  value={slug}
                  aria-label="Switch workspace"
                  onChange={(event) => router.push(`/${event.target.value}/dashboard`)}
                  style={{
                    width: '100%',
                    marginTop: 2,
                    border: 0,
                    padding: 0,
                    background: 'transparent',
                    color: 'rgb(255 255 255 / .48)',
                    fontSize: 10,
                  }}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.slug} value={workspace.slug}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{PRODUCT_NAME}</span>
              )}
            </div>
          )}
          <button
            className="lf-sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {!collapsed && (
          <div className="lf-module-switch" aria-label="Product modules">
            {modules.includes('SALES') && (
              <Link href={`/${slug}/sales`} aria-current={activeModule === 'sales' ? 'page' : undefined}>
                <Icon name="lead" />
                Sales
              </Link>
            )}
            {modules.includes('HRMS') && (
              <Link href={`/${slug}/people`} aria-current={activeModule === 'people' ? 'page' : undefined}>
                <Icon name="people" />
                People
              </Link>
            )}
          </div>
        )}

        <nav className="lf-sidebar-nav" aria-label="Workspace">
          {sections.map((section) => (
            <section className="lf-nav-section" key={section.label}>
              {!collapsed && <div className="lf-nav-label">{section.label}</div>}
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </section>
          ))}
          <section className="lf-nav-section">
            {!collapsed && <div className="lf-nav-label">Administration</div>}
            {administration.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </section>
        </nav>

        <div className="lf-sidebar-user">
          <span className="lf-avatar" style={{ background: 'rgb(255 255 255 / .11)', color: '#fff' }}>
            {initials(user.name)}
          </span>
          {!collapsed && (
            <div className="lf-sidebar-user-copy">
              <strong>{user.name}</strong>
              <span>{user.role.replaceAll('_', ' ')}</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: Item;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      className="lf-nav-link"
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon name={item.icon} />
      {!collapsed && item.label}
    </Link>
  );
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    home: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z M9 21v-7h6v7',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    task: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
    lead: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21a8 8 0 0 1 16 0',
    deal: 'M4 7h16v13H4z M8 7V4h8v3 M4 12h16',
    company: 'M4 21V4h10v17 M14 9h6v12 M8 8h2 M8 12h2 M8 16h2',
    contact: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6',
    activity: 'M3 12h4l2-7 4 14 2-7h6',
    calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
    call: 'M5 4h4l2 5-3 2a16 16 0 0 0 5 5l2-3 5 2v4c0 1-1 2-2 2A17 17 0 0 1 3 6c0-1 1-2 2-2',
    campaign: 'M3 11v3h4l9 4V7l-9 4z M7 14l2 6',
    report: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    people: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21a6 6 0 0 1 12 0 M17 11a3 3 0 1 0 0-6 M16 16a5 5 0 0 1 6 5',
    attendance: 'M4 5h16v16H4z M8 3v4 M16 3v4 M8 14l3 3 5-6',
    leave: 'M12 21s7-4 7-11V4l-7-2-7 2v6c0 7 7 11 7 11 M9 12l2 2 4-5',
    org: 'M12 3v6 M5 21v-6h14v6 M5 15v-3h14v3 M9 9h6v3',
    document: 'M6 2h8l4 4v16H6z M14 2v5h5 M9 13h6 M9 17h6',
    settings:
      'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21H10v-.2A2 2 0 0 0 8.8 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.4 15 2 2 0 0 0 2.6 13H2V9h.6a2 2 0 0 0 1.8-1.2A2 2 0 0 0 4 5.6l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 8.8 3.4 2 2 0 0 0 10 1.6V1h4v.6a2 2 0 0 0 1.2 1.8 2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2A2 2 0 0 0 21.4 9h.6v4h-.6a2 2 0 0 0-2 2z',
    shield: 'M12 22s8-4 8-12V4l-8-2-8 2v6c0 8 8 12 8 12 M9 12l2 2 4-5',
  };
  return (
    <svg
      className="lf-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const initials = (value: string) =>
  value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
