import type { PermissionAction, VisibilityScope } from '@prisma/client';

/**
 * The six business roles a brokerage recognises, as role templates.
 *
 * ── Why these exist ────────────────────────────────────────────────────────
 *
 * A new workspace used to be provisioned with exactly one role — Company
 * Administrator, holding the whole catalogue (`services/platform/createWorkspace.ts`)
 * — and five lead-desk roles (Manager, Team Lead, Agent, Telecaller, Viewer)
 * only when Lead Eagle was switched on. A Sales-only or Real-Estate-only
 * company therefore started with a single role and an administrator who had to
 * hand-build Sales Manager, Sales Agent and HR across 64 permission modules.
 *
 * These are templates, not a new permission model. Each one is a set of
 * `(module, action, scope)` rows in the same shape `provisioning.ts` already
 * writes, and once created a template role is an ordinary `Role` row the role
 * editor edits, deactivates or deletes like any other. `Role` already carries
 * `description`, `isSystem`, `isActive`, `rank` and `defaultScope`, so no
 * schema change and no migration.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 * Absence is refusal. A grant missing from a template is a permission the role
 * does not get, and three of those omissions are the separation-of-duty
 * controls the product is audited on:
 *
 *   - HR Administrator prepares payroll (`payroll:EDIT`) and cannot approve it
 *     (`payroll:APPROVE` withheld). `services/hr/payroll.ts` also refuses
 *     `preparedById === actor.id` whatever the role holds, so this is belt and
 *     braces rather than the only control.
 *   - HR Administrator cannot decide recruitment offers (`recruitment:APPROVE`).
 *   - Real Estate Operations sees collection and commission *status*
 *     (`VIEW`) and holds no `APPROVE` on either, no `payouts` and no
 *     `agencyfee`.
 *
 * Salary stays behind `hr_documents:VIEW_SENSITIVE_FIELDS`, which no template
 * grants: an administrator grants it per workspace, deliberately.
 *
 * ── Scopes ─────────────────────────────────────────────────────────────────
 *
 * Sales Manager defaults to TEAM, not ORGANIZATION. Holding the title is not a
 * reason to read the whole company; an administrator widens it to BRANCH,
 * REGION or ORGANIZATION in the editor where the company works that way.
 *
 * Mirrors docs/product/SIX-ROLE-SIMPLIFICATION.md §B.
 */

type Grants = Record<string, PermissionAction[]>;

const VIEW: PermissionAction[] = ['VIEW'];
const WORK: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT'];
const SELF_ATTENDANCE: Grants = { attendance: ['VIEW', 'CREATE'], leave: ['VIEW', 'CREATE'] };

/** Expands a grant map at one scope into the rows a role is given. */
export const at = (scope: VisibilityScope, grants: Grants) =>
  Object.entries(grants).flatMap(([module, actions]) => actions.map((action) => ({ module, action, scope })));

export interface RoleTemplate {
  key: string;
  name: string;
  rank: number;
  defaultScope: VisibilityScope;
  /** Shown in the role editor and the Add-user form, in place of the key. */
  description: string;
  /** The work areas this role covers, for the "what can it reach" summary. */
  summary: string[];
  /**
   * Product modules this template is for. The workspace gets the template only
   * when it is entitled to one of them; an empty list means every workspace.
   */
  modules: readonly string[];
  grants: { module: string; action: PermissionAction; scope: VisibilityScope }[];
}

const LEAD = ['SALES', 'REAL_ESTATE', 'LEAD_EAGLE'] as const;

/**
 * Sales Manager. A sales team's work at TEAM scope, plus the inventory to pitch
 * and the reports to run.
 *
 * Withheld on purpose: `allocation:APPROVE`, which does not narrow by scope and
 * so cannot be given to a team-scoped role without handing it the whole pool
 * (see the note on STARTER_ROLES in services/platform/provisioning.ts); every
 * money module; and users, roles, settings and integrations.
 */
const SALES_MANAGER_TEAM: Grants = {
  leads: ['VIEW', 'CREATE', 'EDIT', 'ASSIGN', 'REASSIGN', 'BULK_UPDATE', 'EXPORT', 'IMPORT', 'VIEW_SENSITIVE_FIELDS'],
  contacts: WORK,
  accounts: WORK,
  opportunities: ['VIEW', 'CREATE', 'EDIT', 'EXPORT'],
  activities: ['VIEW', 'CREATE'],
  tasks: ['VIEW', 'CREATE', 'EDIT', 'ASSIGN'],
  // calls:EDIT is what carries live coaching, post-call analysis, audit scoring
  // and follow-up drafting (the AI routes gate on it); at TEAM it is the team's
  // calls, which is the review the brief asks a manager to be able to do.
  calls: ['VIEW', 'CREATE', 'EDIT', 'EXPORT', 'VIEW_SENSITIVE_FIELDS'],
  dialer: VIEW,
  visits: ['VIEW', 'CREATE', 'EDIT', 'APPROVE'],
  requirements: WORK,
  allocation: ['VIEW', 'CREATE'],
  campaigns: VIEW,
  smartviews: ['VIEW', 'CREATE'],
  reports: ['VIEW', 'VIEW_REPORTS', 'EXPORT'],
  dashboards: VIEW,
  distribution: VIEW,
  employee: VIEW,
  attendance: ['VIEW', 'APPROVE'],
  leave: ['VIEW', 'APPROVE'],
};

/** Read-only across the company: the inventory a manager pitches from. */
const SALES_MANAGER_ORG: Grants = { projects: VIEW, listings: VIEW };

/**
 * Sales Agent, everything at OWN. `calls:EDIT` and `dialer:VIEW` together are
 * the live AI-assisted calling experience — the Live Call workspace, consent,
 * transcription, coaching hints, the action buttons, the post-call summary and
 * scorecard all gate on those two and need no permission of their own.
 */
const SALES_AGENT_OWN: Grants = {
  leads: ['VIEW', 'CREATE', 'EDIT', 'VIEW_SENSITIVE_FIELDS'],
  contacts: WORK,
  accounts: VIEW,
  opportunities: WORK,
  activities: ['VIEW', 'CREATE'],
  tasks: WORK,
  calls: WORK,
  dialer: VIEW,
  visits: WORK,
  requirements: WORK,
  clientprofiles: WORK,
  documents: ['VIEW', 'CREATE'],
  communications: ['CREATE'],
  projects: VIEW,
  listings: VIEW,
  employee: VIEW,
  ...SELF_ATTENDANCE,
};

/**
 * Real Estate Operations: inventory and transaction coordination.
 *
 * `collections:VIEW` and `commissions:VIEW` are status visibility. No `APPROVE`
 * on either, and no `payouts` or `agencyfee` at all — operations coordinates a
 * transaction, it does not authorise money.
 */
const REALESTATE_OPS_ORG: Grants = {
  projects: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT'],
  listings: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT', 'VIEW_SENSITIVE_FIELDS'],
  bookings: ['VIEW', 'CREATE', 'EDIT'],
  visits: ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'MANAGE_USERS'],
  requirements: WORK,
  events: WORK,
  leads: VIEW,
  contacts: VIEW,
  accounts: VIEW,
  documents: ['VIEW', 'CREATE'],
  tasks: WORK,
  collections: VIEW,
  commissions: VIEW,
  reports: ['VIEW', 'VIEW_REPORTS', 'EXPORT'],
};

/**
 * HR Administrator: the employee lifecycle, attendance, leave, recruitment,
 * performance and payroll *preparation*.
 *
 * `payroll` has CREATE/EDIT/EXPORT and no APPROVE; `recruitment` has no
 * APPROVE; `hr_documents` has no VIEW_SENSITIVE_FIELDS. Those three omissions
 * are the point of the template, not an oversight.
 */
const HR_ADMIN_ORG: Grants = {
  employee: ['VIEW', 'CREATE', 'EDIT', 'MANAGE_USERS'],
  departments: WORK,
  attendance: ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'MANAGE_CONFIGURATION'],
  leave: ['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'MANAGE_CONFIGURATION'],
  shifts: ['VIEW', 'CREATE', 'EDIT', 'APPROVE'],
  overtime: ['VIEW', 'CREATE', 'EDIT', 'APPROVE'],
  holidays: WORK,
  work_locations: WORK,
  hr_documents: WORK,
  hr_reports: ['VIEW', 'CREATE'],
  recruitment: WORK,
  performance: WORK,
  payroll: ['VIEW', 'CREATE', 'EDIT', 'EXPORT'],
  hrms: VIEW,
};

/**
 * Employee. No business module at all.
 *
 * Everything the brief lists for this role — personal dashboard, profile,
 * check-in, attendance history, leave and balance, tasks, notifications,
 * roster, payslips, HR documents, holidays, performance, account security,
 * role visibility — is served by the self-service routes, which carry no
 * permission token (`SELF_SERVICE` in lib/workspace-page.ts, and the
 * `personal` areas in lib/nav/workspaceNav.ts). Granting a business module
 * here would widen what an employee reads about colleagues, so nothing is
 * granted beyond their own attendance, leave and tasks.
 */
const EMPLOYEE_OWN: Grants = { ...SELF_ATTENDANCE, tasks: ['VIEW', 'EDIT'] };

/**
 * The six, ranked. Company Administrator is not here: `createWorkspace.ts`
 * already creates it with the whole catalogue and this must not duplicate it.
 * `PRIMARY_TEMPLATE_KEYS` below includes it so the UI can list all six.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    rank: 30,
    defaultScope: 'TEAM',
    description:
      'Runs a sales team: assigns leads, watches the pipeline, sets targets, reviews calls and coaches the team.',
    summary: ['Leads & assignment', 'Pipeline & opportunities', 'Calls & AI coaching', 'Targets & reports'],
    modules: LEAD,
    grants: [...at('TEAM', SALES_MANAGER_TEAM), ...at('ORGANIZATION', SALES_MANAGER_ORG)],
  },
  {
    key: 'hr_administrator',
    name: 'HR Administrator',
    rank: 35,
    defaultScope: 'ORGANIZATION',
    description:
      'Employees, attendance, leave, shifts, recruitment and performance, and prepares payroll for someone else to approve.',
    summary: ['Employees & departments', 'Attendance & leave', 'Recruitment & performance', 'Payroll preparation'],
    modules: ['HRMS'],
    grants: at('ORGANIZATION', HR_ADMIN_ORG),
  },
  {
    key: 'realestate_ops',
    name: 'Real Estate Operations',
    rank: 40,
    defaultScope: 'ORGANIZATION',
    description: 'Property inventory, listings, viewings, bookings and transaction coordination.',
    summary: ['Projects & listings', 'Site visits & bookings', 'Transaction status', 'Property reports'],
    modules: ['REAL_ESTATE', 'SALES'],
    grants: [...at('ORGANIZATION', REALESTATE_OPS_ORG), ...at('OWN', SELF_ATTENDANCE)],
  },
  {
    key: 'sales_agent',
    name: 'Sales Agent',
    rank: 50,
    defaultScope: 'OWN',
    description: 'Works their own leads, calls, follow-ups and viewings, with live AI call assistance.',
    summary: ['My leads & follow-ups', 'Calls & live AI assistance', 'Viewings & requirements', 'My opportunities'],
    modules: LEAD,
    grants: at('OWN', SALES_AGENT_OWN),
  },
  {
    key: 'employee_self',
    name: 'Employee',
    rank: 90,
    defaultScope: 'OWN',
    description: 'Their own work only: check-in, attendance, leave, tasks, payslips and personal records.',
    summary: ['Check-in & attendance', 'My leave', 'My tasks', 'My payslips & documents'],
    modules: [],
    grants: at('OWN', EMPLOYEE_OWN),
  },
];

/** The role the workspace is created with; a template in the UI, never re-created. */
export const COMPANY_ADMIN_KEY = 'company_admin';

/** All six primary keys, administrator first, for listing them ahead of the rest. */
export const PRIMARY_TEMPLATE_KEYS: readonly string[] = [
  COMPANY_ADMIN_KEY,
  'sales_manager',
  'hr_administrator',
  'realestate_ops',
  'sales_agent',
  'employee_self',
];

/**
 * Specialist roles kept available but listed under Advanced, not offered as a
 * primary choice. These are the Lead Eagle starter roles that have no template
 * equivalent and encode a real distinction: a telecaller deliberately cannot
 * export or read full contact details, a viewer reads the desk without them.
 */
export const SPECIALIST_ROLE_KEYS: readonly string[] = ['manager', 'team_lead', 'agent', 'telecaller', 'viewer'];

/** The templates a workspace with these product modules should be offered. */
export function templatesFor(modules: readonly string[]): readonly RoleTemplate[] {
  return ROLE_TEMPLATES.filter(
    (template) => template.modules.length === 0 || template.modules.some((module) => modules.includes(module)),
  );
}
