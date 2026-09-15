/**
 * The workspace navigation model: the sidebar lists work areas, and the screens
 * inside an area are its tabs.
 *
 * One model feeds the sidebar, the tab strip above each page and the ⌘K
 * palette, so what can be clicked, what is highlighted and what can be jumped
 * to never disagree.
 *
 * Every tab points at an existing route and names the permission (and product
 * module) that route asserts server-side. That keeps bookmarks, deep links and
 * query strings working unchanged, and it means hiding a tab here is only
 * presentation: the page still refuses a role that cannot open it.
 *
 * A tab exists only for a screen that exists. Screens the plan names but the
 * product does not have yet are listed in docs/product/NAVIGATION-MAP.md, not
 * rendered as empty tabs.
 *
 * Pure: no React, no hooks, no ambient URL. Same inputs, same result.
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
  | 'shield';

type Module = 'SALES' | 'HRMS';

/**
 * Who a People screen is for. The HR screens serve both an employee and HR from
 * one route, scoped by role on the server, so the same route is labelled
 * "My Leave" for someone who sees only their own records and "Leave Requests"
 * for someone who oversees others — never both, and never a "My" label over
 * other people's data.
 */
type Audience = 'self' | 'oversight';

export interface NavTab {
  label: string;
  href: string;
  /** `module` means VIEW; `module:ACTION` names another action. All must be held. */
  permission?: string | string[];
  module?: Module;
  audience?: Audience;
  /** Other routes that are this same screen (older duplicates, sub-pages). */
  aliases?: string[];
  keywords?: string;
}

export interface WorkArea {
  key: string;
  label: string;
  icon: IconName;
  /** The first tab the viewer may open. */
  href: string;
  tabs: NavTab[];
}

export interface NavSection {
  key: string;
  label: string;
  areas: WorkArea[];
  /** Collapsed by default; opens when the current page is inside it. */
  collapsible?: boolean;
}

export interface NavInput {
  slug: string;
  /** Entitled product modules: 'SALES', 'HRMS'. */
  modules: string[];
  /** Permission tokens the signed-in role holds; see NAV_PERMISSIONS. */
  permitted: string[];
  /** A platform service identity: no personal work areas. */
  serviceMode?: boolean;
  /** Sees other employees' People records (employee VIEW at TEAM scope or wider). */
  peopleOversight?: boolean;
  /**
   * Platform staff or a platform service identity inside a customer workspace.
   * The People section is hidden outright: they hold no employee record here, so
   * the self-service tabs (which carry no permission) are meaningless, and the
   * monitoring boundary excludes HR.
   */
  platformStaff?: boolean;
}

interface AreaDef {
  key: string;
  label: string;
  icon: IconName;
  personal?: boolean;
  tabs: NavTab[];
}
interface SectionDef {
  key: string;
  label: string;
  collapsible?: boolean;
  areas: AreaDef[];
}

function definitions(slug: string): SectionDef[] {
  const s = (path: string) => `/${slug}/sales${path}`;
  const p = (path: string) => `/${slug}/people${path}`;
  const a = (path: string) => `/${slug}/admin${path}`;
  const S = 'SALES' as const;
  const H = 'HRMS' as const;

  return [
    {
      key: 'home',
      label: 'Home',
      areas: [
        {
          key: 'my-workspace',
          label: 'My Workspace',
          icon: 'home',
          personal: true,
          tabs: [
            // The existing home screen: role-scoped summary cards and workspace-wide
            // queues. Labelled for what it shows; the personal My Day is Milestone 2.
            {
              label: 'Workspace Summary',
              href: `/${slug}/dashboard`,
              keywords: 'home dashboard my day today start',
            },
            { label: 'Sales Overview', href: s(''), module: S, keywords: 'sales desk overdue sla' },
            {
              label: 'Team Work',
              href: s('/leadership?view=chasing'),
              permission: 'reports',
              module: S,
              keywords: 'chasing overdue team queue',
            },
            {
              label: 'Business Overview',
              href: s('/leadership'),
              permission: 'reports',
              module: S,
              keywords: 'leadership executive funnel',
            },
            { label: 'Team Feed', href: s('/engagement'), permission: 'posts', module: S, keywords: 'contests awards' },
          ],
        },
        {
          key: 'inbox',
          label: 'Inbox',
          icon: 'bell',
          personal: true,
          tabs: [{ label: 'All', href: `/${slug}/notifications`, keywords: 'notifications alerts' }],
        },
      ],
    },
    {
      key: 'crm',
      label: 'CRM',
      areas: [
        {
          key: 'leads',
          label: 'Leads',
          icon: 'lead',
          tabs: [
            { label: 'All Leads', href: s('/leads'), permission: 'leads', module: S, keywords: 'prospects' },
            { label: 'My Leads', href: s('/leads?filter=mine'), permission: 'leads', module: S },
            { label: 'Unassigned', href: s('/leads?filter=unassigned'), permission: 'leads', module: S },
            {
              label: 'Saved Views',
              href: s('/smart-views'),
              permission: 'smartviews',
              module: S,
              keywords: 'smart filters',
            },
          ],
        },
        {
          key: 'customers',
          label: 'Customers',
          icon: 'contact',
          tabs: [
            { label: 'Contacts', href: s('/contacts'), permission: 'contacts', module: S, keywords: 'people' },
            { label: 'Accounts', href: s('/accounts'), permission: 'accounts', module: S, keywords: 'companies' },
            {
              label: 'Conversations',
              href: s('/communications/inbox'),
              permission: 'communications',
              module: S,
              keywords: 'whatsapp messages inbox',
            },
            { label: 'Client Profiles', href: s('/clients'), permission: 'clientprofiles', module: S },
            {
              label: 'Testimonials',
              href: s('/clients?view=testimonials'),
              permission: ['clientprofiles', 'testimonials'],
              module: S,
            },
            {
              label: 'Referrals',
              href: s('/clients?view=referrals'),
              permission: ['clientprofiles', 'referrals'],
              module: S,
            },
            { label: 'Service', href: s('/service'), permission: 'tickets', module: S, keywords: 'tickets support' },
            { label: 'Documents', href: s('/documents'), permission: 'documents', module: S },
          ],
        },
        {
          key: 'opportunities',
          label: 'Opportunities',
          icon: 'deal',
          tabs: [
            { label: 'List', href: s('/opportunities'), permission: 'opportunities', module: S, keywords: 'deals' },
          ],
        },
        {
          key: 'activities',
          label: 'Activities',
          icon: 'task',
          tabs: [
            {
              label: 'Tasks & Follow-ups',
              href: s('/follow-ups'),
              permission: 'leads',
              module: S,
              keywords: 'overdue due today',
            },
            { label: 'My Tasks', href: `/${slug}/tasks`, permission: 'tasks', keywords: 'todo' },
            { label: 'All Tasks', href: s('/tasks'), permission: 'tasks', module: S, keywords: 'team tasks' },
            { label: 'Calendar', href: s('/calendar'), permission: 'tasks', module: S, keywords: 'schedule' },
            { label: 'Viewings', href: s('/site-visits'), permission: 'visits', module: S, keywords: 'site visits' },
            { label: 'Activity Log', href: s('/activities'), permission: 'activities', module: S },
            { label: 'Field Sales', href: s('/field-sales'), permission: 'fieldsales', module: S },
          ],
        },
        {
          key: 'calls',
          label: 'Calls & Coaching',
          icon: 'call',
          tabs: [
            { label: 'Calls', href: s('/calls'), permission: 'calls', module: S, keywords: 'recordings dialer' },
            {
              label: 'Call Audits',
              href: s('/call-audits'),
              permission: 'calls',
              module: S,
              keywords: 'quality scoring',
            },
            { label: 'Coaching', href: s('/coaching'), permission: 'calls', module: S },
            { label: 'Playbook', href: s('/playbook'), permission: 'calls', module: S, keywords: 'objections scripts' },
            { label: 'Practice', href: s('/practice'), permission: 'calls', module: S, keywords: 'roleplay' },
          ],
        },
      ],
    },
    {
      key: 'properties',
      label: 'Properties',
      areas: [
        {
          key: 'inventory',
          label: 'Property Inventory',
          icon: 'company',
          tabs: [
            { label: 'Projects', href: s('/projects'), permission: 'projects', module: S, keywords: 'units inventory' },
            { label: 'Listings', href: s('/listings'), permission: 'listings', module: S },
            {
              label: 'Buyer Requirements',
              href: s('/requirements'),
              permission: 'requirements',
              module: S,
              keywords: 'demand matching',
            },
            { label: 'Products', href: s('/products'), permission: 'products', module: S },
          ],
        },
      ],
    },
    {
      key: 'marketing',
      label: 'Marketing',
      areas: [
        {
          key: 'campaigns',
          label: 'Campaigns',
          icon: 'campaign',
          tabs: [
            { label: 'Campaigns', href: s('/campaigns'), permission: 'campaigns', module: S, keywords: 'marketing' },
            { label: 'Events', href: s('/events'), permission: 'events', module: S },
          ],
        },
        {
          key: 'lead-sources',
          label: 'Lead Sources',
          icon: 'document',
          tabs: [
            { label: 'Forms', href: s('/forms'), permission: 'forms', module: S, keywords: 'web forms' },
            { label: 'Landing Pages', href: s('/landing-pages'), permission: 'landingpages', module: S },
            {
              label: 'Social Sources',
              href: s('/social-leads'),
              permission: 'leads',
              module: S,
              keywords: 'facebook instagram meta',
            },
          ],
        },
      ],
    },
    {
      key: 'people',
      label: 'People',
      areas: [
        {
          key: 'my-hr',
          label: 'My HR',
          icon: 'people',
          personal: true,
          tabs: [
            { label: 'Overview', href: p(''), module: H, audience: 'self' },
            { label: 'Check-in', href: p('/check-in'), module: H, keywords: 'punch clock face' },
            { label: 'My Attendance', href: p('/attendance'), module: H, audience: 'self' },
            { label: 'My Leave', href: p('/leave'), module: H, audience: 'self', keywords: 'holiday time off' },
            {
              label: 'My Roster',
              href: p('/roster'),
              permission: 'employee',
              module: H,
              audience: 'self',
              keywords: 'shifts',
            },
            { label: 'My Overtime', href: p('/overtime'), permission: 'employee', module: H, audience: 'self' },
            { label: 'Holidays', href: p('/holidays'), permission: 'employee', module: H, audience: 'self' },
            { label: 'My Payslips', href: p('/payslips'), permission: 'employee', module: H, keywords: 'pay salary' },
            { label: 'My Requests', href: p('/requests'), permission: 'employee', module: H, audience: 'self' },
          ],
        },
        {
          key: 'employees',
          label: 'Employees',
          icon: 'org',
          tabs: [
            { label: 'Overview', href: p(''), module: H, audience: 'oversight' },
            {
              label: 'Directory',
              href: p('/employees'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
              keywords: 'staff',
            },
            { label: 'Onboarding', href: p('/onboarding'), permission: 'employee', module: H, audience: 'oversight' },
            { label: 'Offboarding', href: p('/offboarding'), permission: 'employee', module: H, audience: 'oversight' },
            {
              label: 'Lifecycle',
              href: p('/lifecycle'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
              keywords: 'joiners leavers',
            },
            { label: 'Departments', href: p('/departments'), permission: 'employee', module: H, audience: 'oversight' },
            {
              label: 'Compliance',
              href: p('/compliance'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
              keywords: 'visa expiry',
            },
            { label: 'Documents', href: p('/documents'), permission: 'hr_documents', module: H },
          ],
        },
        {
          key: 'attendance-leave',
          label: 'Attendance & Leave',
          icon: 'attendance',
          tabs: [
            { label: 'Attendance', href: p('/attendance'), module: H, audience: 'oversight' },
            { label: 'Leave Requests', href: p('/leave'), module: H, audience: 'oversight' },
            { label: 'Shifts', href: p('/shifts'), permission: 'employee', module: H, audience: 'oversight' },
            { label: 'Rosters', href: p('/roster'), permission: 'employee', module: H, audience: 'oversight' },
            { label: 'Holidays', href: p('/holidays'), permission: 'employee', module: H, audience: 'oversight' },
            {
              label: 'Exceptions',
              href: p('/requests'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
              keywords: 'attendance exceptions temporary work location',
            },
            { label: 'Overtime', href: p('/overtime'), permission: 'employee', module: H, audience: 'oversight' },
            {
              label: 'Work Locations',
              href: p('/work-locations'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
              keywords: 'geofence office',
            },
            {
              label: 'Face Activity',
              href: p('/face-activity'),
              permission: 'employee',
              module: H,
              audience: 'oversight',
            },
          ],
        },
        {
          key: 'payroll',
          label: 'Payroll',
          icon: 'report',
          tabs: [{ label: 'Payroll Runs', href: p('/payroll'), permission: 'payroll', module: H, keywords: 'wps' }],
        },
        {
          key: 'recruitment',
          label: 'Recruitment',
          icon: 'lead',
          tabs: [
            {
              label: 'Recruitment',
              href: p('/recruitment'),
              permission: 'recruitment',
              module: H,
              keywords: 'candidates hiring requisitions',
            },
          ],
        },
        {
          key: 'performance',
          label: 'Performance',
          icon: 'activity',
          tabs: [
            {
              label: 'Performance',
              href: p('/performance'),
              permission: 'employee',
              module: H,
              keywords: 'reviews goals',
            },
          ],
        },
      ],
    },
    {
      key: 'finance',
      label: 'Finance',
      areas: [
        {
          key: 'collections',
          label: 'Collections',
          icon: 'deal',
          tabs: [
            {
              label: 'Overview',
              href: s('/collections'),
              permission: 'collections',
              module: S,
              keywords: 'receipts agency fee',
            },
            {
              label: 'Recovery Cases',
              href: s('/collections/recovery'),
              permission: 'collections',
              module: S,
            },
          ],
        },
        {
          key: 'commissions',
          label: 'Commissions & Payouts',
          icon: 'report',
          tabs: [
            {
              label: 'Commissions',
              href: s('/commissions'),
              permission: 'commissions',
              module: S,
              keywords: 'earnings',
            },
            { label: 'Payout Runs', href: s('/commissions?view=payouts'), permission: 'commissions', module: S },
            {
              label: 'Commission Plans',
              href: s('/commissions/slabs'),
              permission: 'commissionslabs',
              module: S,
              keywords: 'slabs rules',
            },
          ],
        },
      ],
    },
    {
      key: 'insights',
      label: 'Insights',
      areas: [
        {
          key: 'reports',
          label: 'Reports',
          icon: 'report',
          tabs: [
            { label: 'Sales', href: s('/reports'), permission: 'reports', module: S, keywords: 'analytics export' },
            { label: 'Team Activity', href: s('/leadership?view=compliance'), permission: 'reports', module: S },
            { label: 'Activity Feed', href: s('/leadership?view=feed'), permission: 'reports', module: S },
            { label: 'HR', href: p('/reports'), permission: 'employee', module: H, audience: 'oversight' },
            {
              label: 'Finance',
              href: s('/leadership?view=pl'),
              permission: 'reports',
              module: S,
              keywords: 'p&l margin',
            },
            { label: 'Dashboards', href: s('/dashboards'), permission: 'leads', module: S, keywords: 'charts' },
            { label: 'Targets', href: s('/targets'), module: S, keywords: 'quota goals' },
          ],
        },
      ],
    },
    {
      key: 'administration',
      label: 'Administration',
      areas: [
        {
          key: 'settings',
          label: 'Settings',
          icon: 'settings',
          tabs: [
            { label: 'Workspace', href: a('/settings'), permission: 'settings' },
            { label: 'Company', href: a('/company'), permission: 'settings', keywords: 'profile branding' },
            { label: 'Modules', href: a('/modules'), permission: 'settings' },
            { label: 'Subscription', href: a('/subscription'), permission: 'settings', keywords: 'plan billing' },
            { label: 'Security Policy', href: a('/security'), permission: 'settings', keywords: 'mfa password policy' },
            {
              label: 'Users',
              href: a('/users'),
              permission: 'users',
              aliases: [p('/users')],
              keywords: 'invite members',
            },
            {
              label: 'Roles',
              href: a('/roles'),
              permission: 'roles',
              aliases: [p('/roles')],
              keywords: 'permissions rbac access',
            },
            { label: 'Teams', href: s('/people'), permission: 'users', module: S, keywords: 'sales team members' },
            {
              label: 'Allocation',
              href: s('/allocation'),
              permission: 'allocation',
              module: S,
              keywords: 'distribution rules',
            },
            { label: 'HR Policies', href: p('/settings'), permission: 'employee:EDIT', module: H },
            {
              label: 'Integrations',
              href: a('/integrations'),
              permission: 'integrations',
              keywords: 'meta whatsapp telephony',
            },
            {
              label: 'Channels',
              href: s('/communications'),
              permission: 'communications',
              module: S,
              keywords: 'communications',
            },
            { label: 'Automation', href: s('/automation'), permission: 'automation', module: S, keywords: 'workflows' },
            { label: 'Audit Log', href: a('/audit'), permission: 'auditlogs', keywords: 'history events' },
          ],
        },
      ],
    },
    {
      key: 'account',
      label: 'Account',
      collapsible: true,
      areas: [
        {
          key: 'my-account',
          label: 'My Account',
          icon: 'shield',
          personal: true,
          tabs: [
            {
              label: 'Security',
              href: `/${slug}/profile/security`,
              aliases: [p('/security')],
              keywords: 'password mfa',
            },
            { label: 'Role & Access', href: `/${slug}/profile/role` },
            { label: 'Appearance', href: `/${slug}/profile/appearance`, keywords: 'theme density' },
          ],
        },
      ],
    },
  ];
}

const tokens = (tab: NavTab) =>
  tab.permission ? (Array.isArray(tab.permission) ? tab.permission : [tab.permission]) : [];

/**
 * Every permission token any tab asks for, so the layout resolves exactly these
 * and no item can silently vanish because its module was never checked.
 */
export const NAV_PERMISSIONS: string[] = [
  ...new Set(
    definitions('_')
      .flatMap((section) => section.areas)
      .flatMap((area) => area.tabs)
      .flatMap(tokens),
  ),
].sort();

/** `leads` → ['leads', 'VIEW']; `employee:EDIT` → ['employee', 'EDIT']. */
export const parsePermission = (token: string): [string, string] => {
  const [module, action] = token.split(':');
  return [module!, action ?? 'VIEW'];
};

export function tabAllowed(tab: NavTab, input: NavInput): boolean {
  if (tab.module && !input.modules.includes(tab.module)) return false;
  if (tab.audience === 'self' && input.peopleOversight) return false;
  if (tab.audience === 'oversight' && !input.peopleOversight) return false;
  return tokens(tab).every((token) => input.permitted.includes(token));
}

export function buildNavigation(input: NavInput): NavSection[] {
  return definitions(input.slug)
    .filter((section) => !(input.platformStaff && section.key === 'people'))
    .map((section) => ({
      key: section.key,
      label: section.label,
      collapsible: section.collapsible,
      areas: section.areas
        .filter((area) => !(input.serviceMode && area.personal))
        .map((area) => {
          const tabs = area.tabs.filter((tab) => tabAllowed(tab, input));
          return { key: area.key, label: area.label, icon: area.icon, href: tabs[0]?.href ?? '', tabs };
        })
        .filter((area) => area.tabs.length > 0),
    }))
    .filter((section) => section.areas.length > 0);
}

export interface ActiveLocation {
  area: WorkArea;
  tab: NavTab;
}

/**
 * The area and tab a URL belongs to.
 *
 * A tab whose path and every query value match wins; then a tab on the same path
 * with no query of its own; then the deepest tab the path sits beneath (a record
 * page belongs to its list). Module roots (`/slug/sales`, `/slug/people`) only
 * ever match exactly, and a tab that carries a query never claims sub-pages.
 */
export function findActive(sections: NavSection[], pathname: string, search: URLSearchParams): ActiveLocation | null {
  let best: { score: number; depth: number; location: ActiveLocation } | null = null;
  for (const section of sections)
    for (const area of section.areas)
      for (const tab of area.tabs) {
        const [path, query] = tab.href.split('?');
        const tabParams = new URLSearchParams(query ?? '');
        for (const candidate of [path!, ...(tab.aliases ?? [])]) {
          const moduleRoot = candidate.split('/').filter(Boolean).length <= 2;
          let score = 0;
          if (pathname === candidate) {
            const keys = [...tabParams.keys()];
            if (keys.length === 0) score = 2;
            else if (keys.every((key) => search.get(key) === tabParams.get(key))) score = 3 + keys.length;
          } else if (!moduleRoot && !query && pathname.startsWith(`${candidate}/`)) {
            score = 1;
          }
          if (!score) continue;
          const depth = candidate.length;
          if (!best || score > best.score || (score === best.score && depth > best.depth))
            best = { score, depth, location: { area, tab } };
        }
      }
  return best?.location ?? null;
}

/**
 * Where a tab link goes from the current page. Moving between tabs of the same
 * screen keeps the viewer's own filters (a date range, a search, a person) and
 * drops only the query keys the tabs themselves choose between.
 */
export function tabTarget(tab: NavTab, area: WorkArea, pathname: string, search: URLSearchParams): string {
  const [path, query] = tab.href.split('?');
  if (pathname !== path) return tab.href;
  const selectors = new Set(['page']);
  for (const sibling of area.tabs) {
    const [siblingPath, siblingQuery] = sibling.href.split('?');
    if (siblingPath === path) new URLSearchParams(siblingQuery ?? '').forEach((_value, key) => selectors.add(key));
  }
  const next = new URLSearchParams();
  search.forEach((value, key) => {
    if (!selectors.has(key)) next.append(key, value);
  });
  new URLSearchParams(query ?? '').forEach((value, key) => next.set(key, value));
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path!;
}

/** The lists that read `?q=`, for "Search leads for …" in the palette. */
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
