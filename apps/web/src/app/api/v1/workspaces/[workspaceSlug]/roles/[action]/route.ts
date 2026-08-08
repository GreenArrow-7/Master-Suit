import { z } from 'zod';
import { MethodNotAllowed } from '@/lib/errors';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import {
  assignRole,
  createRole,
  deleteRole,
  listRoles,
  permissionMatrix,
  revokeRoleAssignment,
  roleAssignmentHistory,
  updatePermissionMatrix,
  updateRole,
} from '@/services/identity/roles';

/**
 * Roles, the permission matrix, and effective-dated assignment.
 *
 * Reads are gated on `roles:VIEW`, writes on `roles:MANAGE_CONFIGURATION`. The
 * rule that actually protects this surface — you may never grant more than you
 * hold yourself — depends on the acting role's own scopes, so it lives in the
 * service layer where those are resolved.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum(['roles', 'matrix', 'history', 'create', 'update', 'delete', 'matrix-update', 'assign', 'revoke']),
});

const id = z.string().min(1).max(64);
const scope = z.enum(['NONE', 'OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION']);

export const GET = route(
  {
    module: 'roles',
    action: 'VIEW',
    params: paramsSchema,
    query: z
      .object({
        roleId: z.string().max(64).optional(),
        membershipId: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .passthrough(),
  },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    switch (params.action) {
      case 'roles':
        return listRoles(ctx);
      case 'matrix': {
        if (!query.roleId) throw new Error('roleId is required.');
        return permissionMatrix(ctx, query.roleId);
      }
      case 'history':
        return roleAssignmentHistory(ctx, {
          roleId: query.roleId,
          membershipId: query.membershipId,
          limit: query.limit,
        });
      default:
        throw MethodNotAllowed('POST');
    }
  },
);

export const POST = route(
  { module: 'roles', action: 'MANAGE_CONFIGURATION', params: paramsSchema, body: z.record(z.string(), z.unknown()) },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    switch (params.action) {
      case 'create': {
        const input = z
          .object({
            key: z.string().min(2).max(50),
            name: z.string().min(2).max(80),
            description: z.string().max(300).optional(),
            rank: z.coerce.number().int().min(0).max(1000),
            defaultScope: scope.default('OWN'),
          })
          .parse(body);
        return createRole(ctx, input);
      }
      case 'update': {
        const input = z
          .object({
            roleId: id,
            name: z.string().min(2).max(80).optional(),
            description: z.string().max(300).optional(),
            rank: z.coerce.number().int().min(0).max(1000).optional(),
            defaultScope: scope.optional(),
          })
          .parse(body);
        const { roleId, ...changes } = input;
        return updateRole(ctx, roleId, changes);
      }
      case 'delete': {
        const input = z.object({ roleId: id }).parse(body);
        return deleteRole(ctx, input.roleId);
      }
      case 'matrix-update': {
        const input = z
          .object({
            roleId: id,
            changes: z
              .array(z.object({ permissionId: id, granted: z.coerce.boolean(), scope }))
              .min(1)
              .max(500),
          })
          .parse(body);
        return updatePermissionMatrix(ctx, input.roleId, input.changes);
      }
      case 'assign': {
        const input = z
          .object({
            membershipId: id,
            roleId: id,
            effectiveFrom: z.coerce.date().optional(),
            effectiveTo: z.coerce.date().optional(),
            scopeType: z.string().max(40).optional(),
            scopeId: id.optional(),
          })
          .parse(body);
        return assignRole(ctx, input);
      }
      case 'revoke': {
        const input = z.object({ assignmentId: id, reason: z.string().max(300).optional() }).parse(body);
        return revokeRoleAssignment(ctx, input.assignmentId, input.reason);
      }
      default:
        throw new Error('Use GET for this action.');
    }
  },
);
