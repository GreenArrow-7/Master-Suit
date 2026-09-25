import { ASSISTANT_NAME } from '@/lib/branding';

/**
 * The workspace navigation model — one rail for the whole product.
 *
 * Sales and People used to be two sidebars behind a switch, 55 and 28 links
 * long, each with its own overview, its own reports, its own admin. A person
 * working across both had to change mode to change task. This is the single
 * model both the sidebar and the ⌘K palette read, so what you can click and
 * what you can jump to can never disagree.
 *
 * Shape: Home, Sales, People, Reports, Settings. Sales and People each carry
 * their daily items open and their long tail behind a collapsed "Show all"
 * group placed directly after them (keyed `sales-more` / `people-more`, with
 * `parent` naming the group they belong to). ONE AI is the first item of
 * Reports, gated exactly as its API is. Every item still carries the
 * permission the page itself asserts server-side — this is presentation, not
 * access control.
 *
 * Pure: no React, no hooks, no ambient URL. Same inputs, same groups.
 */

export type IconName =
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
  | 'shield'
  | 'spark';

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Every listed permission must be held (a dashboard of lead data needs both). */
  permission?: string | string[];
  /** Extra words the palette matches on, for what people actually type. */
  keywords?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
  /** Collapsed by default; opens when the current page is inside it. */
  collapsible?: boolean;
  /**
   * The group a long tail belongs to. The rail renders the tail as its own
   * <details> under the parent; the palette files its rows under the parent's
   * heading, so one "Sales" heading covers both.
   */
  parent?: string;
}

export interface NavInput {
  slug: string;
  /** Entitled modules: 'SALES', 'HRMS'. */
  modules: string[];
  /** Permission modules the signed-in role may VIEW. */
  permitted: string[];
  /** A platform service identity: no personal queues, no "my" anything. */
  serviceMode?: boolean;
}

/** True when the viewer holds every permission the item names. */
export const itemAllowed = (item: NavItem, permitted: string[]) =>
  !item.permission ||
  (Array.isArray(item.permission) ? item.permission : [item.permission]).every((p) => permitted.includes(p));

/**
 * Module roots (`/{slug}/sales`, `/{slug}/people`, `/{slug}/dashboard`) match
 * exactly — prefix matching would light "Sales overview" on every sales page;
 * deeper paths match their descendants so /sales/leads/123 keeps Leads lit.
 * `?view=` is the only query the model uses: a `?view=` item lights when the
 * path and the view both match, and its bare sibling (`/clients` beside
 * `/clients?view=referrals`) only when no view is set, so one row lights.
 */
export function isNavItemActive(item: NavItem, pathname: string, view: string | null): boolean {
  const [path = item.href, query] = item.href.split('?');
  if (query) return pathname === path && new URLSearchParams(query).get('view') === view;
  if (pathname === path) return view === null;
  const moduleRoot = path.split('/').filter(Boolean).length <= 2;
  return !moduleRoot && pathname.startsWith(`${path}/`);
}

/** The label of the item the current page belongs to; the most specific wins. */
export function activeNavLabel(groups: NavGroup[], pathname: string, view: string | null): string | undefined {
  return groups
    .flatMap((group) => group.items)
    .filter((item) => isNavItemActive(item, pathname, view))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label;
}

export function buildWorkspaceNav({ slug, modules, permitted, serviceMode = false }: NavInput): NavGroup[] {
  const sales = modules.includes('SALES');
  const people = modules.includes('HRMS');
  const s = (path: string) => `/${slug}/sales${path}`;
  const p = (path: string) => `/${slug}/people${path}`;
  const a = (path: string) => `/${slug}/admin${path}`;

  const groups: NavGroup[] = [];

  // A service identity owns no tasks and receives no notifications; the group
  // rendered three empty pages. Follow-ups is workspace work, so it stays under
  // Sales below.
  if (!serviceMode)
    groups.push({
      key: 'home',
      label: 'Home',
      items: [
        { label: 'Overview', href: `/${slug}/dashboard`, icon: 'home', keywords: 'dashboard home start' },
        { label: 'My tasks', href: `/${slug}/tasks`, icon: 'task', keywords: 'todo' },
        { label: 'Notifications', href: `/${slug}/notifications`, icon: 'bell', keywords: 'alerts inbox' },
      ],
    });

  if (sales) {
    groups.push({
      key: 'sales',
      label: 'Sales',
      items: [
        { label: 'Leads', href: s('/leads'), icon: 'lead', permission: 'leads', keywords: 'pipeline prospects' },
        {
          label: 'Opportunities',
          href: s('/opportunities'),
          icon: 'deal',
          permission: 'opportunities',
          keywords: 'deals',
        },
        { label: 'Accounts', href: s('/accounts'), icon: 'company', permission: 'accounts', keywords: 'companies' },
        { label: 'Contacts', href: s('/contacts'), icon: 'contact', permission: 'contacts', keywords: 'people' },
        { label: 'Calls', href: s('/calls'), icon: 'call', permission: 'calls', keywords: 'recordings dialer' },
        { label: 'Follow-ups', href: s('/follow-ups'), icon: 'task', keywords: 'overdue due today' },
      ],
    });

    // Management used to be its own three-item group that came and went with
    // the role; a group that appears and vanishes is noise in a 236px column.
    // A service identity has no targets to manage.
    const management: NavItem[] = serviceMode
      ? []
      : [
          { label: 'Targets', href: s('/targets'), icon: 'report', keywords: 'quota goals' },
          {
            label: 'Commissions',
            href: s('/commissions'),
            icon: 'report',
            permission: 'commissions',
            keywords: 'payouts',
          },
          { label: 'Leadership', href: s('/leadership'), icon: 'report', permission: 'reports', keywords: 'executive' },
        ];

    groups.push({
      key: 'sales-more',
      label: 'Show all',
      parent: 'Sales',
      collapsible: true,
      items: [
        { label: 'Sales overview', href: s(''), icon: 'home', keywords: 'my day' },
        { label: 'Calendar', href: s('/calendar'), icon: 'calendar', permission: 'tasks', keywords: 'schedule' },
        ...management,
        {
          label: 'Smart views',
          href: s('/smart-views'),
          icon: 'activity',
          permission: 'smartviews',
          keywords: 'saved filters',
        },
        { label: 'Activities', href: s('/activities'), icon: 'activity', permission: 'activities' },
        { label: 'All tasks', href: s('/tasks'), icon: 'task', permission: 'tasks', keywords: 'team tasks' },
        { label: 'Site visits', href: s('/site-visits'), icon: 'attendance', permission: 'visits' },
        /**
         * Only where People is not licensed, so a brokerage on Sales alone can
         * still find the one screen its agents open every morning. With HRMS on,
         * the People group already carries it and a second entry to the same
         * page is just two places to look.
         */
        ...(people
          ? []
          : [
              {
                label: 'Check in',
                href: p('/check-in'),
                icon: 'attendance' as const,
                keywords: 'punch clock face attendance',
              },
            ]),
        { label: 'Projects', href: s('/projects'), icon: 'company', permission: 'projects', keywords: 'inventory' },
        { label: 'Listings', href: s('/listings'), icon: 'deal', permission: 'listings', keywords: 'inventory units' },
        {
          label: 'Portals',
          href: s('/portals'),
          icon: 'deal',
          permission: 'listings',
          keywords: 'bayut property finder dubizzle syndication publish',
        },
        { label: 'Requirements', href: s('/requirements'), icon: 'lead', permission: 'requirements' },
        {
          label: 'Proposals',
          href: s('/proposals'),
          icon: 'deal',
          permission: 'requirements',
          keywords: 'shortlist send client brochure',
        },
        { label: 'Client profiles', href: s('/clients'), icon: 'contact', permission: 'clientprofiles' },
        { label: 'Testimonials', href: s('/clients?view=testimonials'), icon: 'activity', permission: 'testimonials' },
        { label: 'Referrals', href: s('/clients?view=referrals'), icon: 'lead', permission: 'referrals' },
        {
          label: 'Inbox',
          href: s('/communications/inbox'),
          icon: 'activity',
          permission: 'communications',
          keywords: 'messages whatsapp',
        },
        {
          label: 'Communications',
          href: s('/communications'),
          icon: 'activity',
          permission: 'communications',
          keywords: 'channels',
        },
        { label: 'Campaigns', href: s('/campaigns'), icon: 'campaign', permission: 'campaigns', keywords: 'marketing' },
        {
          label: 'Recycle leads',
          href: s('/leads/recycle'),
          icon: 'lead',
          permission: 'leads',
          keywords: 'lost cold re-engage revive',
        },
        {
          label: 'Social leads',
          href: s('/social-leads'),
          icon: 'campaign',
          permission: 'leads',
          keywords: 'facebook instagram',
        },
        { label: 'Events', href: s('/events'), icon: 'calendar', permission: 'events' },
        { label: 'Forms', href: s('/forms'), icon: 'document', permission: 'forms', keywords: 'web forms' },
        { label: 'Landing pages', href: s('/landing-pages'), icon: 'document', permission: 'landingpages' },
        { label: 'Field sales', href: s('/field-sales'), icon: 'company', permission: 'fieldsales' },
        { label: 'Service', href: s('/service'), icon: 'shield', permission: 'tickets', keywords: 'tickets support' },
        { label: 'Products', href: s('/products'), icon: 'deal', permission: 'products' },
        { label: 'Documents', href: s('/documents'), icon: 'document', permission: 'documents' },
        {
          label: 'Allocation',
          href: s('/allocation'),
          icon: 'lead',
          permission: 'allocation',
          keywords: 'distribution rules',
        },
        {
          label: 'Automation',
          href: s('/automation'),
          icon: 'settings',
          permission: 'automation',
          keywords: 'workflows',
        },
        { label: 'Team feed', href: s('/engagement'), icon: 'activity', permission: 'posts' },
        { label: 'Contests', href: s('/engagement?view=contests'), icon: 'report', permission: 'contests' },
        { label: 'Awards', href: s('/engagement?view=awards'), icon: 'calendar', permission: 'contests' },
        { label: 'Playbook', href: s('/playbook'), icon: 'document', permission: 'calls' },
        { label: 'Practice', href: s('/practice'), icon: 'activity', permission: 'calls', keywords: 'roleplay' },
        { label: 'Slab rules', href: s('/commissions/slabs'), icon: 'settings', permission: 'commissionslabs' },
      ],
    });
  }

  if (people) {
    groups.push({
      key: 'people',
      label: 'People',
      items: [
        {
          label: 'Employees',
          href: p('/employees'),
          icon: 'people',
          permission: 'employee',
          keywords: 'staff directory',
        },
        {
          label: 'Attendance',
          href: p('/attendance'),
          icon: 'attendance',
          permission: 'employee',
          keywords: 'present absent late',
        },
        { label: 'Leave', href: p('/leave'), icon: 'leave', keywords: 'holiday time off' },
        { label: 'Check in', href: p('/check-in'), icon: 'attendance', keywords: 'punch clock face' },
        {
          label: 'Performance',
          href: p('/performance'),
          icon: 'report',
          permission: 'employee',
          keywords: 'reviews ratings',
        },
      ],
    });

    groups.push({
      key: 'people-more',
      label: 'Show all',
      parent: 'People',
      collapsible: true,
      items: [
        { label: 'People overview', href: p(''), icon: 'home', permission: 'employee' },
        {
          label: 'Lifecycle',
          href: p('/lifecycle'),
          icon: 'people',
          permission: 'employee',
          keywords: 'joiners leavers',
        },
        { label: 'Onboarding', href: p('/onboarding'), icon: 'people', permission: 'employee' },
        { label: 'Offboarding', href: p('/offboarding'), icon: 'people', permission: 'employee' },
        { label: 'Overtime', href: p('/overtime'), icon: 'attendance', permission: 'employee' },
        { label: 'My pay', href: p('/payslips'), icon: 'report', permission: 'employee', keywords: 'payslip salary' },
        { label: 'Payroll', href: p('/payroll'), icon: 'report', permission: 'payroll', keywords: 'wps runs' },
        { label: 'Departments', href: p('/departments'), icon: 'org', permission: 'employee' },
        { label: 'Requests', href: p('/requests'), icon: 'task', permission: 'employee' },
        { label: 'Shifts', href: p('/shifts'), icon: 'calendar', permission: 'employee' },
        { label: 'Roster', href: p('/roster'), icon: 'calendar', permission: 'employee' },
        { label: 'Holidays', href: p('/holidays'), icon: 'calendar', permission: 'employee' },
        { label: 'HR documents', href: p('/documents'), icon: 'document', permission: 'hr_documents' },
        {
          label: 'Compliance',
          href: p('/compliance'),
          icon: 'shield',
          permission: 'employee',
          keywords: 'visa expiry',
        },
        {
          label: 'Attendance locations',
          href: p('/work-locations'),
          icon: 'company',
          permission: 'employee',
          keywords: 'geofence office',
        },
        { label: 'Face recognition activity', href: p('/face-activity'), icon: 'shield', permission: 'employee' },
        { label: 'HR policy', href: p('/settings'), icon: 'settings', permission: 'employee' },
      ],
    });
  }

  // Reports, not "Intelligence": the group holds audits, coaching and reports,
  // and naming it after the copilot made the copilot read as a bolt-on with a
  // fake home. ONE AI leads it instead, gated exactly as its API is — the SALES
  // entitlement and leads:VIEW (app/api/v1/assistant/route.ts).
  const reports: NavItem[] = [];
  if (sales)
    reports.push(
      {
        label: ASSISTANT_NAME,
        href: `/${slug}/ai`,
        icon: 'spark',
        permission: 'leads',
        keywords: 'assistant copilot ask chat',
      },
      {
        label: 'Call audits',
        href: s('/call-audits'),
        icon: 'shield',
        permission: 'calls',
        keywords: 'ai scoring quality',
      },
      { label: 'Coaching', href: s('/coaching'), icon: 'people', permission: 'calls' },
      { label: 'Reports', href: s('/reports'), icon: 'report', permission: 'reports', keywords: 'analytics export' },
      {
        label: 'Dashboards',
        href: s('/dashboards'),
        icon: 'report',
        permission: ['dashboards', 'leads'],
        keywords: 'charts',
      },
    );
  if (people)
    reports.push({
      label: 'People reports',
      href: p('/reports'),
      icon: 'report',
      permission: 'employee',
      keywords: 'hr analytics',
    });
  groups.push({ key: 'reports', label: 'Reports', items: reports });

  // One door for administration and the account: Admin and Account were two
  // collapsed groups for twelve settings screens. Users and Roles live here
  // and nowhere else — one screen each, one door.
  groups.push({
    key: 'settings',
    label: 'Settings',
    collapsible: true,
    items: [
      { label: 'Company', href: a('/company'), icon: 'company', permission: 'settings', keywords: 'profile branding' },
      { label: 'Users', href: a('/users'), icon: 'people', permission: 'users', keywords: 'invite members' },
      { label: 'Roles & permissions', href: a('/roles'), icon: 'shield', permission: 'roles', keywords: 'rbac access' },
      { label: 'Modules', href: a('/modules'), icon: 'settings', permission: 'settings' },
      {
        label: 'Subscription',
        href: a('/subscription'),
        icon: 'document',
        permission: 'settings',
        keywords: 'plan billing',
      },
      {
        label: 'Integrations',
        href: a('/integrations'),
        icon: 'activity',
        permission: 'integrations',
        keywords: 'meta whatsapp twilio',
      },
      { label: 'Security', href: a('/security'), icon: 'shield', permission: 'settings', keywords: 'mfa policy' },
      { label: 'Workspace settings', href: a('/settings'), icon: 'settings', permission: 'settings' },
      { label: 'Audit logs', href: a('/audit'), icon: 'report', permission: 'auditlogs', keywords: 'history events' },
      { label: 'My security', href: `/${slug}/profile/security`, icon: 'shield', keywords: 'password mfa' },
      { label: 'My role & access', href: `/${slug}/profile/role`, icon: 'people' },
      { label: 'Appearance', href: `/${slug}/profile/appearance`, icon: 'settings', keywords: 'theme density' },
    ],
  });

  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => itemAllowed(item, permitted)) }))
    .filter((group) => group.items.length > 0);
}

/** Module-relative href → "/{slug}/sales/leads?q=x". The lists that read `?q=`. */
export function searchTargets({ slug, modules, permitted }: NavInput): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const sales = modules.includes('SALES');
  if (sales && permitted.includes('leads')) out.push({ label: 'leads', href: `/${slug}/sales/leads` });
  if (sales && permitted.includes('opportunities'))
    out.push({ label: 'opportunities', href: `/${slug}/sales/opportunities` });
  if (sales && permitted.includes('accounts')) out.push({ label: 'accounts', href: `/${slug}/sales/accounts` });
  if (sales && permitted.includes('contacts')) out.push({ label: 'contacts', href: `/${slug}/sales/contacts` });
  if (modules.includes('HRMS') && permitted.includes('employee'))
    out.push({ label: 'employees', href: `/${slug}/people/employees` });
  return out;
}
