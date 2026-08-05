import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import {
  accountDetail, changeUserRole, listAccounts, resetUserPassword,
  revokeUserSessions, setManager, setUserActive, unlockUser,
} from '@/services/identity/accounts';
import { removeTotpFor } from '@/services/identity/twoFactor';

/**
 * Administering *other people's* accounts. Everything here needs
 * `users:MANAGE_USERS`; self-service lives in `./self` because an employee must
 * be able to change their own password without being granted the ability to
 * change everyone else's.
 *
 * The finer rules — never act on an account at or above your own level, never
 * strand the last administrator — depend on the target record rather than the
 * role alone, so they are enforced in the service layer.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum([
    'accounts', 'account',
    'password-reset', 'account-unlock', 'account-active', 'account-role',
    'account-manager', 'sessions-revoke', 'two-factor-remove',
  ]),
});

const id = z.string().min(1).max(64);

export const GET = route(
  { module: 'users', productModule: 'HRMS', action: 'VIEW', params: paramsSchema, query: z.object({ userId: z.string().max(64).optional() }).passthrough() },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    switch (params.action) {
      case 'accounts': return listAccounts(ctx);
      case 'account': return accountDetail(ctx, query.userId ?? ctx.actor.id);
      default: throw new Error('Use POST for this action.');
    }
  },
);

export const POST = route(
  { module: 'users', productModule: 'HRMS', action: 'MANAGE_USERS', params: paramsSchema, body: z.record(z.string(), z.unknown()) },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    switch (params.action) {
      case 'password-reset': {
        const input = z.object({ userId: id, temporaryPassword: z.string().min(8).max(200).optional() }).parse(body);
        return resetUserPassword(ctx, input.userId, input.temporaryPassword);
      }
      case 'account-unlock': {
        const input = z.object({ userId: id }).parse(body);
        return unlockUser(ctx, input.userId);
      }
      case 'account-active': {
        const input = z.object({ userId: id, active: z.coerce.boolean(), reason: z.string().max(300).optional() }).parse(body);
        return setUserActive(ctx, input.userId, input.active, input.reason);
      }
      case 'account-role': {
        const input = z.object({ userId: id, roleId: id }).parse(body);
        return changeUserRole(ctx, input.userId, input.roleId);
      }
      case 'account-manager': {
        const input = z.object({ employeeId: id, managerEmployeeId: id.optional().or(z.literal('')) }).parse(body);
        return setManager(ctx, input.employeeId, input.managerEmployeeId || null);
      }
      case 'sessions-revoke': {
        const input = z.object({ userId: id }).parse(body);
        return revokeUserSessions(ctx, input.userId);
      }
      case 'two-factor-remove': {
        const input = z.object({ userId: id }).parse(body);
        return removeTotpFor(ctx, input.userId);
      }
      default: throw new Error('Use GET for this action.');
    }
  },
);
