import type { PermissionAction, VisibilityScope } from '@prisma/client';
import type { TxClient } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { ensureLeadSources } from '@/services/leads/leadSources';

type Grants = Record<string, PermissionAction[]>;

const WORK: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT'];

/**
 * An agent's day in Lead Eagle: leads with their follow-ups, activity and cold
 * data (all `leads`), calls, tasks, site visits, buyer requirements, asking the
 * pool for leads, the inventory to pitch, and their own figures.
 */
const AGENT = {
  leads: [...WORK, 'VIEW_SENSITIVE_FIELDS', 'EXPORT'],
  calls: WORK,
  tasks: WORK,
  visits: WORK,
  requirements: WORK,
  allocation: ['VIEW', 'CREATE'],
  projects: ['VIEW'],
  listings: ['VIEW'],
  reports: ['VIEW'],
} satisfies Grants;

const at = (scope: VisibilityScope, grants: Grants) =>
  Object.entries(grants).flatMap(([module, actions]) => actions.map((action) => ({ module, action, scope })));
const only = (grants: Grants, keep: (action: PermissionAction) => boolean): Grants =>
  Object.fromEntries(Object.entries(grants).map(([module, actions]) => [module, actions.filter(keep)]));

// Check-in is self-service. These are the attendance record and its requests:
// your own, or your reporting line's with the early check-out decision — a
// manager decides for their own team, the Company Admin for anyone (owner, 5 Oct).
const OWN_ATTENDANCE = at('OWN', { employee: ['VIEW'], attendance: ['VIEW'] });
const TEAM_ATTENDANCE = at('TEAM', { employee: ['VIEW'], attendance: ['VIEW', 'APPROVE'] });

/**
 * Lead Eagle's starter roles (M2-03), beside the Company Administrator. Ordinary
 * roles (`isSystem` false), ranked below the administrator, so the role editor
 * edits, deactivates or deletes them like any other. Only the modules a lead
 * desk works; users, roles, settings and integrations stay with the
 * administrator. Pool allocation (`allocation:APPROVE`) does not narrow by
 * scope, so it is the manager's alone; so is visit verification, the sign-off
 * a commission rests on. Visit approval follows the approver's scope
 * (services/visits/lifecycle.ts), so a team lead decides its team's.
 */
const STARTER_ROLES = [
  {
    key: 'manager',
    name: 'Manager',
    rank: 20,
    defaultScope: 'ORGANIZATION',
    description: 'Runs the lead desk: every lead, assignment and the pool, inventory, reports and exports.',
    grants: [
      ...at('ORGANIZATION', {
        ...AGENT,
        leads: [...AGENT.leads, 'ASSIGN', 'REASSIGN', 'BULK_UPDATE', 'IMPORT'],
        tasks: [...WORK, 'DELETE'],
        visits: [...WORK, 'APPROVE', 'MANAGE_USERS'],
        requirements: [...WORK, 'DELETE'],
        allocation: ['VIEW', 'CREATE', 'APPROVE'],
        projects: [...WORK, 'DELETE'],
        listings: [...WORK, 'DELETE', 'VIEW_SENSITIVE_FIELDS'],
        reports: ['VIEW', 'EXPORT'],
      }),
      ...TEAM_ATTENDANCE,
    ],
  },
  {
    key: 'team_lead',
    name: 'Team Lead',
    rank: 30,
    defaultScope: 'TEAM',
    description:
      'An agent’s work across their team: assigns the team’s leads, approves its site visits and early check-outs.',
    grants: [
      ...at('TEAM', {
        ...AGENT,
        leads: [...AGENT.leads, 'ASSIGN', 'REASSIGN', 'BULK_UPDATE'],
        visits: [...WORK, 'APPROVE'],
      }),
      ...TEAM_ATTENDANCE,
    ],
  },
  {
    key: 'agent',
    name: 'Agent',
    rank: 40,
    defaultScope: 'OWN',
    description: 'Works their own leads, follow-ups, calls, site visits and cold data.',
    grants: [...at('OWN', AGENT), ...OWN_ATTENDANCE],
  },
  {
    key: 'telecaller',
    name: 'Telecaller',
    rank: 50,
    defaultScope: 'OWN',
    description: 'An agent’s work, without the permissions for full contact details or for exporting leads.',
    grants: [
      ...at(
        'OWN',
        only(AGENT, (action) => action !== 'VIEW_SENSITIVE_FIELDS' && action !== 'EXPORT'),
      ),
      ...OWN_ATTENDANCE,
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    rank: 60,
    defaultScope: 'ORGANIZATION',
    description: 'Reads the whole lead desk, without the permission for full contact details.',
    grants: [
      ...at(
        'ORGANIZATION',
        only(AGENT, (action) => action === 'VIEW'),
      ),
      ...OWN_ATTENDANCE,
    ],
  },
] satisfies {
  key: string;
  name: string;
  rank: number;
  defaultScope: VisibilityScope;
  description: string;
  grants: { module: string; action: PermissionAction; scope: VisibilityScope }[];
}[];

/**
 * Adds each starter role whose key and name the workspace does not already use
 * (names compared ignoring case). A role that exists is never touched, so an
 * administrator's edits stand.
 */
async function provisionStarterRoles(tx: TxClient, tenantId: string) {
  const existing = await tx.role.findMany({ where: { tenantId }, select: { key: true, name: true } });
  const taken = new Set(existing.flatMap((role) => [role.key, role.name.trim().toLowerCase()]));
  const missing = STARTER_ROLES.filter((role) => !taken.has(role.key) && !taken.has(role.name.toLowerCase()));
  if (missing.length === 0) return;

  const roles = await tx.role.createManyAndReturn({
    data: missing.map(({ key, name, rank, defaultScope, description }) => ({
      tenantId,
      key,
      name,
      rank,
      defaultScope,
      description,
      isSystem: false,
    })),
    select: { id: true, key: true },
  });
  const permissions = await tx.permission.findMany({ select: { id: true, module: true, action: true } });
  const permissionId = new Map(permissions.map((p) => [`${p.module}:${p.action}`, p.id]));
  await tx.rolePermission.createMany({
    data: roles.flatMap((role) =>
      missing
        .find((spec) => spec.key === role.key)!
        .grants.map(({ module, action, scope }) => {
          const id = permissionId.get(`${module}:${action}`);
          // Every pair is in PERMISSION_CATALOGUE, which a migration defines.
          if (!id) throw new Error(`Permission ${module}:${action} is not defined in this database.`);
          return { tenantId, roleId: role.id, permissionId: id, granted: true, scope };
        }),
    ),
  });
}

/**
 * What a workspace needs before it can work a lead: lead stages, activity types
 * and task types, and with Lead Eagle its starter roles.
 *
 * `Lead.stageId`, `Activity.typeId` and `Task.typeId` are required, and every
 * composer picks from these per-tenant lists. With a list empty a lead cannot be
 * created ("Lead stage not found") and pressing "Log" does nothing at all. Any
 * module that works leads needs them — Sales, Real Estate and Lead Eagle — but
 * they were provisioned for Sales alone, so a Real-Estate-only or
 * Lead-Eagle-only workspace created through the wizard could not take its first
 * lead.
 *
 * Deliberately a small starting set rather than the seed's twenty: the ones every
 * team uses on day one; a workspace adds its own. `scoreDelta` mirrors the seed
 * so lead scoring behaves the same in a provisioned workspace as in the demo.
 *
 * Each list is filled only when the workspace has none of it: this is for a
 * workspace that has nothing yet — at creation, or when a module that works
 * leads is switched on later — never a reset of one that has made its own.
 *
 * The starter roles come only when Lead Eagle arrives (`modules` has it,
 * `before` did not). The console's editor sends the modules with every save, so
 * keying on the roles alone would bring back one an administrator deleted, and
 * backfill workspaces that had Lead Eagle before the roles existed.
 */
export async function provisionLeadWork(
  tx: TxClient,
  tenantId: string,
  /** The workspace's modules after this change. */
  modules: readonly string[],
  /** Its live modules before it; empty for a new workspace. */
  before: readonly string[] = [],
): Promise<void> {
  if (!modules.some((module) => (LEAD_MODULES as readonly string[]).includes(module))) return;
  if (modules.includes('LEAD_EAGLE') && !before.includes('LEAD_EAGLE')) await provisionStarterRoles(tx, tenantId);
  // The source catalogue (M4-03): the same seed the screens and intake apply on first use.
  await ensureLeadSources(tx, tenantId);
  if ((await tx.leadStage.count({ where: { tenantId } })) === 0) {
    await tx.leadStage.createMany({
      data: [
        { tenantId, key: 'new', name: 'New', position: 1, isDefault: true },
        { tenantId, key: 'qualified', name: 'Qualified', position: 2 },
        { tenantId, key: 'won', name: 'Won', position: 3, category: 'CONVERSION' },
        { tenantId, key: 'lost', name: 'Lost', position: 4, category: 'TERMINAL_NEGATIVE' },
      ],
    });
  }
  if ((await tx.activityType.count({ where: { tenantId } })) === 0) {
    await tx.activityType.createMany({
      data: [
        { tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3, position: 0 },
        { tenantId, key: 'call_in', name: 'Incoming call', scoreDelta: 8, position: 1 },
        { tenantId, key: 'email_sent', name: 'Email sent', scoreDelta: 1, position: 2 },
        { tenantId, key: 'meeting', name: 'Meeting', scoreDelta: 12, position: 3 },
        { tenantId, key: 'follow_up', name: 'Follow-up completed', scoreDelta: 3, position: 4 },
        { tenantId, key: 'note', name: 'Lead note', scoreDelta: 0, position: 5 },
      ],
    });
  }
  if ((await tx.taskType.count({ where: { tenantId } })) === 0) {
    await tx.taskType.createMany({
      data: [
        { tenantId, key: 'call', name: 'Call', category: 'TODO' },
        { tenantId, key: 'meeting', name: 'Meeting', category: 'APPOINTMENT' },
        { tenantId, key: 'follow_up', name: 'Follow-up', category: 'TODO' },
        { tenantId, key: 'internal', name: 'Internal task', category: 'TODO' },
      ],
    });
  }
}
