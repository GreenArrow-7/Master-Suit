import { z } from 'zod';
import { Forbidden, MethodNotAllowed } from '@/lib/errors';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import { changeOwnPassword, mustChangePassword } from '@/services/identity/accounts';
import {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
  twoFactorStatus,
} from '@/services/identity/twoFactor';

/**
 * Your own account: password and authenticator. Nothing here takes a target —
 * every action reads `ctx.actor`, so there is no parameter through which one
 * employee could reach another's credentials.
 *
 * Marked `selfService`: authenticated and tenant-checked, but no permission.
 * It was gated on `hrms:VIEW`, which locked every user of a Sales-only
 * workspace out of their own password; gating it on `users` instead would lock
 * out the HR-created employees who most need to replace a temporary one.
 * Changing your own credentials is not a privilege that can be withheld.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum([
    'password-status',
    'two-factor-status',
    'password-change',
    'two-factor-begin',
    'two-factor-confirm',
    'two-factor-disable',
    'two-factor-recovery-regenerate',
  ]),
});

export const GET = route(
  { module: 'identity_self', action: 'VIEW', selfService: true, params: paramsSchema },
  async ({ ctx, params }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    switch (params.action) {
      case 'password-status':
        return { mustChangePassword: await mustChangePassword(ctx) };
      case 'two-factor-status':
        return twoFactorStatus(ctx);
      default:
        throw MethodNotAllowed('POST');
    }
  },
);

export const POST = route(
  {
    module: 'identity_self',
    action: 'VIEW',
    selfService: true,
    params: paramsSchema,
    body: z.record(z.string(), z.unknown()),
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    /**
     * Every action below manages the account's own credentials, and a machine
     * credential cannot stand in for the person who owns them. An API key
     * authenticates as the user who created it, so without this it could change
     * that person's password or enrol an authenticator on their account —
     * neither of which a key is ever the right instrument for.
     */
    if (ctx.apiKeyId) throw Forbidden('This endpoint requires a signed-in session.');

    switch (params.action) {
      case 'password-change': {
        const input = z
          .object({ currentPassword: z.string().min(1).max(512), newPassword: z.string().min(8).max(512) })
          .parse(body);
        return changeOwnPassword(ctx, input.currentPassword, input.newPassword);
      }
      case 'two-factor-begin': {
        // Re-authentication: see beginTotpEnrolment for why enrolment is not a
        // read and must not ride on a session alone.
        const input = z.object({ currentPassword: z.string().min(1).max(512) }).parse(body);
        return beginTotpEnrolment(ctx, input.currentPassword);
      }
      case 'two-factor-confirm': {
        const input = z.object({ code: z.string().length(6) }).parse(body);
        return confirmTotpEnrolment(ctx, input.code);
      }
      case 'two-factor-disable': {
        const input = z.object({ password: z.string().min(1).max(512), code: z.string().length(6) }).parse(body);
        return disableTotp(ctx, input.password, input.code);
      }
      case 'two-factor-recovery-regenerate': {
        const input = z.object({ code: z.string().length(6) }).parse(body);
        return regenerateRecoveryCodes(ctx, input.code);
      }
      default:
        throw new Error('Use GET for this action.');
    }
  },
);
