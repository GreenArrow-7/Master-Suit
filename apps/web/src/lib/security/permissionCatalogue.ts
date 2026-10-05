import type { PermissionAction } from '@prisma/client';

/**
 * Every permission definition the application expects to exist.
 *
 * A `Permission` row is a *definition* — a (module, action) pair a role can be
 * granted. It confers nothing by existing; authority comes only from
 * `RolePermission` rows. A missing definition, though, can never be granted:
 * on a clean install (migrations, first owner, a workspace — no demo seed)
 * twenty-five pairs the code checks had no row, so Service, Documents, Products,
 * Forms, Landing Pages, Automation, Communications, Saved Views and Field Sales
 * could be granted to nobody, and the monitoring allowlist's `tickets:VIEW` was
 * inert.
 *
 * This list is the union of where the catalogue has actually come from: the demo
 * seed's record and admin catalogues, the workspace-provisioning floor, and every
 * pair an earlier migration inserts. Migration
 * `20260915140000_permission_catalogue_definitions` inserts exactly this list,
 * idempotently and **without granting anything**.
 *
 * Adding a module: add it here, write a migration that inserts the new pairs
 * (definitions only), and `tests/unit/permission-catalogue.spec.ts` will insist
 * the two agree and that every navigation and monitoring permission is covered.
 * `scripts/check-permission-catalogue.ts` verifies a migrated database.
 */
/** Administrative and configuration surfaces: keys, roles, settings, automation, reports. */
const CONFIGURATION_SURFACE: readonly PermissionAction[] = [
  'ACCESS_API',
  'CREATE',
  'DELETE',
  'EDIT',
  'EXPORT',
  'MANAGE_AUTOMATION',
  'MANAGE_CONFIGURATION',
  'MANAGE_USERS',
  'VIEW',
  'VIEW_REPORTS',
];

/** The CRM records, with their configuration and user-management actions. */
const MANAGED_RECORD: readonly PermissionAction[] = [
  'ASSIGN',
  'BULK_UPDATE',
  'CREATE',
  'DELETE',
  'EDIT',
  'EXPORT',
  'IMPORT',
  'MANAGE_CONFIGURATION',
  'MANAGE_USERS',
  'REASSIGN',
  'VIEW',
  'VIEW_SENSITIVE_FIELDS',
];

/** Records without configuration or user-management actions of their own. */
const RECORD: readonly PermissionAction[] = [
  'ASSIGN',
  'BULK_UPDATE',
  'CREATE',
  'DELETE',
  'EDIT',
  'EXPORT',
  'IMPORT',
  'REASSIGN',
  'VIEW',
  'VIEW_SENSITIVE_FIELDS',
];

export const PERMISSION_CATALOGUE: Readonly<Record<string, readonly PermissionAction[]>> = {
  accounts: MANAGED_RECORD,
  activities: MANAGED_RECORD,
  agencyfee: ['APPROVE', 'CREATE', 'VIEW'],
  allocation: ['APPROVE', 'CREATE', 'VIEW'],
  apikeys: CONFIGURATION_SURFACE,
  attendance: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  auditlogs: CONFIGURATION_SURFACE,
  automation: CONFIGURATION_SURFACE,
  bookings: ['CREATE', 'DELETE', 'EDIT', 'VIEW'],
  calls: MANAGED_RECORD,
  campaigns: MANAGED_RECORD,
  clientprofiles: ['CREATE', 'DELETE', 'EDIT', 'VIEW'],
  collections: ['APPROVE', 'CREATE', 'VIEW'],
  commissions: ['APPROVE', 'EDIT', 'EXPORT', 'VIEW'],
  commissionslabs: ['APPROVE', 'EDIT', 'VIEW'],
  communications: CONFIGURATION_SURFACE,
  contacts: MANAGED_RECORD,
  contests: ['CREATE', 'EDIT', 'VIEW'],
  dashboards: CONFIGURATION_SURFACE,
  departments: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  dialer: ['CREATE', 'EDIT', 'MANAGE_USERS', 'VIEW'],
  distribution: CONFIGURATION_SURFACE,
  documents: RECORD,
  employee: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  events: RECORD,
  exports: CONFIGURATION_SURFACE,
  fieldsales: RECORD,
  forms: CONFIGURATION_SURFACE,
  holidays: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  hr_documents: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW', 'VIEW_SENSITIVE_FIELDS'],
  hr_reports: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  hrms: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  imports: CONFIGURATION_SURFACE,
  integrations: CONFIGURATION_SURFACE,
  landingpages: CONFIGURATION_SURFACE,
  leads: MANAGED_RECORD,
  leave: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  listings: ['CREATE', 'DELETE', 'EDIT', 'EXPORT', 'VIEW', 'VIEW_SENSITIVE_FIELDS'],
  lists: CONFIGURATION_SURFACE,
  opportunities: MANAGED_RECORD,
  overtime: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  payouts: ['APPROVE', 'CREATE', 'VIEW'],
  payroll: ['APPROVE', 'CREATE', 'EDIT', 'EXPORT', 'VIEW'],
  performance: ['APPROVE', 'CREATE', 'EDIT', 'VIEW'],
  posts: ['CREATE', 'DELETE', 'EDIT', 'VIEW'],
  products: RECORD,
  projects: ['CREATE', 'DELETE', 'EDIT', 'EXPORT', 'VIEW'],
  recruitment: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'VIEW', 'VIEW_SENSITIVE_FIELDS'],
  referrals: ['CREATE', 'EDIT', 'VIEW'],
  reports: CONFIGURATION_SURFACE,
  requirements: ['CREATE', 'DELETE', 'EDIT', 'VIEW'],
  roles: CONFIGURATION_SURFACE,
  settings: CONFIGURATION_SURFACE,
  shifts: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
  sla: CONFIGURATION_SURFACE,
  smartviews: CONFIGURATION_SURFACE,
  tasks: MANAGED_RECORD,
  testimonials: ['APPROVE', 'CREATE', 'EDIT', 'VIEW'],
  tickets: RECORD,
  users: CONFIGURATION_SURFACE,
  visits: ['APPROVE', 'CREATE', 'DELETE', 'EDIT', 'MANAGE_USERS', 'VIEW'],
  work_locations: ['CREATE', 'DELETE', 'EDIT', 'MANAGE_CONFIGURATION', 'MANAGE_USERS', 'VIEW'],
};

/** The catalogue as `module:ACTION` tokens. */
export const catalogueTokens = (): string[] =>
  Object.entries(PERMISSION_CATALOGUE).flatMap(([module, actions]) => actions.map((action) => `${module}:${action}`));
