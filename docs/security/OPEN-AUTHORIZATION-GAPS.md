# Open authorization gaps

Written 11 November 2026. **Nothing here is fixed.** This exists because a
security requirement was attempted, withdrawn, and must not be mistaken for
done on the strength of a green CI run.

## G1 — Role binding has no grant ceiling · OPEN

**Paths:** `changeUserRole` (`services/identity/accounts.ts`),
`inviteUser` (`services/identity/invitations.ts`), account creation via
`POST /api/v1/workspaces/:slug/hr/employees`.

**What is not enforced.** Nothing stops somebody who may administer a role from
binding a person to a role whose permissions exceed the binder's own — at any
scope. A branch-scoped administrator who may administer rank 60 can hand out a
rank 60 role carrying ORGANIZATION-wide permissions they do not hold.

**What _is_ enforced** on those paths, and was never removed: the rank cap
(`assertMayAdministerRole` — you may not bind a role at or above your own
level), the target-authority check (`assertMayAdminister`), and the last-active
administrator guard.

**Why it is open rather than fixed.** The ceiling was implemented and withdrawn
in `cf1ac987`. It refused two legitimate journeys that CI proved are the
product working as designed:

- an HR administrator inviting a new starter into the auto-created employee
  baseline, which carries `leads:VIEW` while HR holds no lead permissions;
- a workspace administrator creating a Sales Manager role with
  `targets:VIEW` at ORGANIZATION and inviting somebody into it —
  _"you do not hold targets:VIEW. (3 permissions in this role exceed your
  authority.)"_

In this product an administrator composes roles they do not personally hold.
A ceiling that compares a role's contents against the binder's own permissions
makes role administration impossible unless every administrator is a superset
of every role they can hand out. See
`docs/security/DELEGATION-POLICY.md` for the policy that resolves this, which
is specified and **not yet implemented**.

## G2 — Permission-matrix editing has no ceiling · OPEN

**Path:** `updatePermissionMatrix` (`services/identity/roles.ts:314`).

Nothing stops an editor adding a permission to a role that the editor does not
hold, or widening a permission's scope beyond their own. This is where a role's
contents are chosen, so it is the stronger of the two gaps: G1 lets an existing
powerful role be handed out, G2 lets one be manufactured.

## G3 — Commission approval has no self-approval guard · OPEN

`services/.../commissions.ts` has no creator/beneficiary check, while
`collections.ts:456`, `payouts.ts:191`, `feeAmendments.ts:354` and
`recoveryCases.ts:279` all have one.

## What is enforced today, and must not be lost

- `assignRole` carries the per-permission grant ceiling
  (`lib/security/grantCeiling.ts`, shipped `59c20bbe`): a conferred scope may
  not exceed the assigner's own for the same `module:ACTION`, and a named
  branch, team or region must sit inside the assigner's own **by id**, because
  ordering is not containment.
- Scope resolution fails closed: an unrecognised `scopeType` grants nothing
  (`lib/auth/session.ts`), and `scopeCapFor` returns null rather than guessing.
- Rank caps and target-authority checks on every binding path.
- Monitoring sessions are read-only; no self-approval on the four money paths
  listed above.
