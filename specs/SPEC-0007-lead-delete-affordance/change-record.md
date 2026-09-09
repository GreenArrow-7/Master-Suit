# SPEC-0007 — Change record

## CHG-001 — A delete affordance on the leads grid

**Reason:** `BUG-006`. `leads:DELETE` was granted, enforced and unreachable
from the screen the operation belongs on.

**Change:** `LeadGrid` takes a required `canDelete` prop and, when it is true,
renders a Delete button in the bulk bar that confirms and then issues
`DELETE /api/v1/leads/{id}` for each selected lead through the existing
`run()` helper. Both callers — `sales/leads/page.tsx` and
`sales/smart-views/page.tsx` — pass `can(ctx, 'leads', 'DELETE')`.

**Why the prop is required rather than optional:** an optional one would let
the next caller ship without a delete and nobody would hear about it. Making it
required is what surfaced the second caller — the compiler named
`smart-views/page.tsx` on the first build, and an administrator working from a
saved view had exactly the same missing control.

**Also:** the shared bulk-failure message read "N of M could not be updated",
which is wrong for an action that is not an update. One word.

**Not changed:** the endpoint, the service, the soft-delete contract, the
permission model, the detail page's control, or anything under `lib/auth/` or
`lib/security/`.

## CHG-002 — Rejections from workspace provisioning are recorded

**Reason:** `BUG-007`. The provisioning route is the one mutation path outside
the API kernel, so a `403`, `409` or `422` was written nowhere at all — which
is why the reported symptom could not be diagnosed from three days of retained
production logs.

**Change:** `problem()` in `apps/web/src/app/api/v1/platform/workspaces/route.ts` emits one
`logger.warn` for the `AppError` branch (request id, status, error code) and
one for the `ZodError` branch (request id, status, failing field **names**).
The `500` branch is unchanged.

**Field names, never values.** The request body carries the new
administrator's password. `Object.keys(fieldErrors)` is the whole of what is
logged from it.

## CHG-003 — The wizard names the field a `422` rejected

**Reason:** `BUG-007`. A `422` from this route carries `errors.fieldErrors` and
no `detail`; the form read `detail ?? title`, so five steps of typing were
answered with the two words "Validation failed".

**Change:** when the response carries `errors.fieldErrors`, the wizard lists
those field names. Otherwise the previous message is used unchanged.

**Verified:** the same rejection now reads `Validation failed: check
enabledModules.` where it previously read `Validation failed`.

## CHG-004 — `REG-001`

**Reason:** `BUG-006` needs a test that fails without the fix. It has to be
asserted on the list rather than against the endpoint, because the endpoint
passed the whole time.

**Change:** `apps/web/tests/e2e/crm-lifecycle.spec.ts` gains "an administrator
deletes a lead from the list": creates a throwaway lead, finds it in the list,
selects it, accepts the confirmation, and asserts it is gone and stays gone
after a reload.
