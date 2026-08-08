import { z } from 'zod';
import { MethodNotAllowed } from '@/lib/errors';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import {
  accountDetail,
  changeUserRole,
  listAccounts,
  resetUserPassword,
  revokeUserSessions,
  setManager,
  setUserActive,
  unlockUser,
} from '@/services/identity/accounts';
import { inviteUser, listInvitations, resendInvitation, revokeInvitation } from '@/services/identity/invitations';
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
    'accounts',
    'account',
    'invitations',
    'password-reset',
    'account-unlock',
    'account-active',
    'account-role',
    'account-manager',
    'sessions-revoke',
    'two-factor-remove',
    'invite',
    'invitation-resend',
    'invitation-revoke',
  ]),
});

const id = z.string().min(1).max(64);

export const GET = route(
  {
    module: 'users',
    action: 'VIEW',
    params: paramsSchema,
    query: z.object({ userId: z.string().max(64).optional() }).passthrough(),
  },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    switch (params.action) {
      case 'accounts':
        return listAccounts(ctx);
      case 'invitations':
        return listInvitations(ctx);
      case 'account':
        return accountDetail(ctx, query.userId ?? ctx.actor.id);
      default:
        throw MethodNotAllowed('POST');
    }
  },
);

export const POST = route(
  { module: 'users', action: 'MANAGE_USERS', params: paramsSchema, body: z.record(z.string(), z.unknown()) },
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
        const input = z
          .object({ userId: id, active: z.coerce.boolean(), reason: z.string().max(300).optional() })
          .parse(body);
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

      // ── Invitations ───────────────────────────────────────────────────────
      // The only route by which a login comes into existence. Every field the
      // new account starts with is decided here; the password is not one of
      // them, and is never seen by the person sending the invitation.
      case 'invite': {
        const input = z
          .object({
            email: z.string().email().max(254),
            fullName: z.string().min(2).max(160),
            roleId: id,
            employeeNumber: z.string().min(1).max(40).optional(),
            jobTitle: z.string().max(120).optional(),
            departmentId: id.optional().or(z.literal('')),
          })
          .parse(body);
        return inviteUser(ctx, { ...input, departmentId: input.departmentId || undefined });
      }
      case 'invitation-resend': {
        const input = z.object({ invitationId: id }).parse(body);
        return resendInvitation(ctx, input.invitationId);
      }
      case 'invitation-revoke': {
        const input = z.object({ invitationId: id, reason: z.string().max(300).optional() }).parse(body);
        return revokeInvitation(ctx, input.invitationId, input.reason);
      }
      default:
        throw new Error('Use GET for this action.');
    }
  },
);
