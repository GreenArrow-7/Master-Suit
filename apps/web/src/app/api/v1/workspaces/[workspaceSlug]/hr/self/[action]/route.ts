import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import { grantConsent, preflight, punch, requestChallenge, withdrawConsent } from '@/services/hr/attendance';

/**
 * The things an employee does to their own record: consent, and clocking in.
 *
 * All of it used to live on the HR action dispatcher, which is gated on
 * `employee:VIEW` — an HR directory permission an ordinary employee does not
 * hold. The effect was backwards on both counts. The one person entitled to
 * give biometric consent got a 403, and the only accounts that could record it
 * were HR's, acting on somebody else's behalf, which is precisely what UAE PDPL
 * exists to prevent. Checking yourself in failed the same way, so attendance
 * only worked for staff who happened to hold HR's permissions.
 *
 * The fix is an explicit self-service authorization, not a wider HR permission:
 * widening `employee:VIEW` to let everyone clock in would also let everyone
 * read the directory.
 *
 * Marked `selfService`: authenticated and tenant-checked, no module permission.
 * No action here takes a target. Every one resolves the employee from
 * `ctx.actor` via `myEmployee`, so there is no parameter through which one
 * employee could consent, clock in, or clock out as another. Acting on someone
 * else's record stays on the HR dispatcher, where it is audited as an HR act.
 *
 * What is *not* relaxed: the punch still proves consent, liveness, face match,
 * geofence and GPS accuracy on the server. This changes who may ask, never what
 * is checked.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum([
    'consent-grant',
    'consent-withdraw',
    'attendance-preflight',
    'attendance-challenge',
    'attendance-punch',
  ]),
});

export const POST = route(
  {
    module: 'hr_self',
    action: 'VIEW',
    selfService: true,
    params: paramsSchema,
    body: z.record(z.string(), z.unknown()),
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug);

    switch (params.action) {
      case 'consent-grant': {
        const input = z.object({ policyVersion: z.string().max(40).optional() }).parse(body);
        return grantConsent(ctx, input.policyVersion);
      }
      // No employeeId is read: withdrawing your own consent is the only thing
      // this route will do, whatever the caller puts in the body.
      case 'consent-withdraw':
        return withdrawConsent(ctx);

      case 'attendance-preflight': {
        const input = z
          .object({
            action: z.enum(['CHECK_IN', 'CHECK_OUT']),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            gpsAccuracyM: z.coerce.number().min(0).max(10_000),
          })
          .parse(body);
        return preflight(ctx, input.action, input);
      }
      case 'attendance-challenge':
        return requestChallenge(ctx);
      case 'attendance-punch': {
        const input = z
          .object({
            punchType: z.enum(['CHECK_IN', 'CHECK_OUT']),
            nonce: z.string().min(8).max(200),
            frames: z.array(z.string().min(16)).min(1).max(10),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            gpsAccuracyM: z.coerce.number().min(0).max(10_000),
            deviceFingerprint: z.string().max(200).default('unknown-device'),
            capturedAt: z.string().datetime().optional(),
          })
          .parse(body);
        return punch(ctx, input);
      }
    }
  },
);
