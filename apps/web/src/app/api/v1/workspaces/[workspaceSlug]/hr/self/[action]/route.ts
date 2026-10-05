import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import { grantConsent, myPunches, preflight, punch, requestChallenge, withdrawConsent } from '@/services/hr/attendance';
import { requestAttendanceException } from '@/services/hr/requests';

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
    'early-checkout-request',
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
        // `punchType` is the field: attendance-punch below reads it, the HR
        // dispatcher reads it, and the check-in console sends it. This route
        // read `action` instead, which no client in the repository sends — so
        // since the console moved here, every self-service preflight threw on
        // validation before reading a coordinate.
        //
        // `action` is still accepted, as a deprecated alias. This route takes
        // API keys by design, so an integration outside this repository may
        // have been sending it successfully all along; fixing the console must
        // not break a caller nobody here can see.
        const input = z
          .object({
            punchType: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(),
            action: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            gpsAccuracyM: z.coerce.number().min(0).max(10_000).default(0),
          })
          .refine((fields) => Boolean(fields.punchType ?? fields.action), {
            message: 'Required',
            path: ['punchType'],
          })
          .parse(body);
        return preflight(ctx, (input.punchType ?? input.action)!, input);
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
      // Asked from the check-in screen when the work gate holds the check-out.
      // The action, time and reason are fixed here, so the request says exactly
      // what the gate refused; the line manager or an administrator decides.
      case 'early-checkout-request': {
        const input = z.object({ reasonText: z.string().max(500).optional() }).parse(body);
        return requestAttendanceException(ctx, {
          requestedAction: 'CHECK_OUT',
          requestedFor: new Date(),
          reasonCode: 'work_pending',
          reasonText: input.reasonText,
        });
      }
    }
  },
);

/**
 * Your own punch history — the “Recent” list on the check-in console.
 *
 * The console refreshed it from the HR resource endpoint, which is gated on
 * `employee:VIEW` and the HRMS module, so the one list an employee is entitled
 * to see was the one their account could not fetch — and in a workspace
 * without HRMS, nobody could. `myPunches` resolves the employee from
 * `ctx.actor` and takes no target, so there is no parameter through which one
 * person could read another’s attendance.
 */
const getParamsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum(['attendance-punches']),
});

export const GET = route(
  {
    module: 'hr_self',
    action: 'VIEW',
    selfService: true,
    params: getParamsSchema,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) }),
  },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    return myPunches(ctx, query.limit);
  },
);
