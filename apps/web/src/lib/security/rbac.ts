import { Forbidden } from '../errors';

export type Scope = 'NONE' | 'OWN' | 'TEAM' | 'BRANCH' | 'REGION' | 'ORGANIZATION';

export type Action =
  | 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'EXPORT' | 'IMPORT' | 'ASSIGN' | 'REASSIGN'
  | 'BULK_UPDATE' | 'VIEW_REPORTS' | 'MANAGE_AUTOMATION' | 'MANAGE_USERS'
  | 'MANAGE_CONFIGURATION' | 'ACCESS_API' | 'VIEW_SENSITIVE_FIELDS';

export const SCOPE_RANK: Record<Scope, number> = {
  NONE: 0, OWN: 1, TEAM: 2, BRANCH: 3, REGION: 4, ORGANIZATION: 5,
};

/** `module:ACTION` → granted scope. Built once per request from the role's rows. */
export type PermissionMap = ReadonlyMap<string, Scope>;

export interface Actor {
  id: string;
  tenantId: string;
  roleId: string;
  roleKey: string;
  roleRank: number;
  branchId: string | null;
  regionId: string | null;
  teamIds: readonly string[];
  managedUserIds: readonly string[];
  permissions: PermissionMap;
}

export interface Ctx {
  tenantId: string;
  actor: Actor;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  /** Set when the request authenticated with an API key rather than a session. */
  apiKeyId?: string;
}

const key = (module: string, action: Action) => `${module}:${action}`;

export function scopeFor(ctx: Ctx, module: string, action: Action): Scope {
  return ctx.actor.permissions.get(key(module, action)) ?? 'NONE';
}

export function can(ctx: Ctx, module: string, action: Action): boolean {
  return scopeFor(ctx, module, action) !== 'NONE';
}

/**
 * Called by the API kernel before the handler body runs. A handler that reaches
 * its first statement has already cleared this gate.
 */
export function assertPermission(ctx: Ctx, module: string, action: Action): Scope {
  const scope = scopeFor(ctx, module, action);
  if (scope === 'NONE') {
    throw Forbidden(`Your role does not allow ${action.toLowerCase().replace(/_/g, ' ')} on ${module}.`);
  }
  return scope;
}

export function assertScopeAtLeast(ctx: Ctx, module: string, action: Action, minimum: Scope) {
  const scope = assertPermission(ctx, module, action);
  if (SCOPE_RANK[scope] < SCOPE_RANK[minimum]) throw Forbidden();
  return scope;
}

/**
 * Vertical escalation guard: a user may only administer roles ranked strictly below
 * their own, and never their own role. Without this, an org admin's deputy can
 * promote themselves.
 */
export function assertMayAdministerRole(ctx: Ctx, targetRoleRank: number, targetRoleId: string) {
  if (targetRoleId === ctx.actor.roleId) throw Forbidden('You cannot modify your own role.');
  if (targetRoleRank <= ctx.actor.roleRank) throw Forbidden('You cannot modify a role at or above your own level.');
}
