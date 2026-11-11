# Delegation policy

Written 11 November 2026. **Specification only — not implemented.** The gaps it
closes are `docs/security/OPEN-AUTHORIZATION-GAPS.md` G1 and G2.

## The problem it solves

A company administrator must be able to hand out a Finance Officer role without
being a finance officer. A branch administrator must not be able to hand out
anything reaching past their branch. The ceiling attempted in `cf1ac987` could
not tell those two apart, because it asked one question — _do you personally
hold every permission in this role?_ — and that question is wrong for the first
and right for the second.

The fix is to stop asking it, and ask two different ones.

## The two questions

**1. May you delegate this role at all?** — a question about the _role_, answered
by an explicit grant, not by the assigner's own permissions.

**2. How far may what you delegate reach?** — a question about _scope_, answered
by the assigner's own reach, exactly as `assignRole` already answers it.

A delegation is permitted only when both pass.

## Question 1: approved roles

Introduce a **delegable set**: the roles a given role may hand out.

    model RoleDelegation {
      tenantId       String
      delegatorRoleId String   // the role doing the handing out
      delegateRoleId  String   // the role it may hand out
      maxScope        Scope    // the widest reach it may confer, see below
      @@unique([tenantId, delegatorRoleId, delegateRoleId])
    }

- A company administrator is seeded with every non-administrator role in its
  delegable set, at `ORGANIZATION`. This is what makes "assign approved roles
  without personal access to every module" true, and it is an explicit,
  auditable decision rather than a side effect of how permissions happen to be
  arranged.
- A branch or team administrator is seeded with the operational roles only, at
  `BRANCH` / `TEAM`.
- **Empty set means no delegation.** Fails closed, like `scopeCapFor`.
- A role is never implicitly in its own delegable set: handing out your own
  role is a decision somebody has to make.

Rank caps stay exactly as they are and are checked first. The delegable set
narrows what rank already allows; it never widens it.

## Question 2: reach

Unchanged from `lib/security/grantCeiling.ts`, which already does this
correctly and must be reused rather than reimplemented:

- the conferred scope may not exceed the assigner's own for the same
  `module:ACTION`;
- a named branch, team or region must sit **inside** the assigner's own by id —
  ordering is not containment, Marina does not contain Downtown;
- an omitted scope is resolved to the role's `defaultScope` first and then
  judged identically, so leaving the scope out is not a way round;
- additionally, the conferred scope may not exceed the `maxScope` recorded for
  that delegation.

The one change: the arm that refuses a permission the assigner **does not hold
at all** no longer applies to role binding, because question 1 has already
answered whether this role may be delegated. It continues to apply to matrix
editing, below, where no approved-role decision exists to lean on.

## Where it is enforced

Both, and every path into both. Enforcing only at matrix editing leaves every
role that is already powerful assignable through the binding paths; enforcing
only at binding lets somebody edit a role into power and then hand it out.

| Point      | Path                              | Check                                                                                                                                 |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Binding    | `assignRole`                      | rank → delegable set → reach (incl. `maxScope`)                                                                                       |
| Binding    | `changeUserRole`                  | same, at the role's `defaultScope`                                                                                                    |
| Binding    | `inviteUser`                      | same; an invitation is a delayed grant, so it is checked when written, not when accepted                                              |
| Binding    | account creation (`hr/employees`) | same; when it auto-creates a starter role, that role is created in the creator's delegable set at `OWN` and permitted by construction |
| Definition | `updatePermissionMatrix`          | per changed permission: the editor must hold it, at a scope at least as wide as the one being set                                     |

`updatePermissionMatrix` keeps the strict rule — **you may not add to a role a
permission you do not hold** — because that is where authority is manufactured.
An administrator who may hand out a Finance Officer role still may not add
`payroll:APPROVE` to it unless they hold `payroll:APPROVE` themselves.

That asymmetry is the whole policy: **composing** authority requires holding it;
**delegating** already-approved authority does not.

## What it must not break

These exist today and are the acceptance bar for any implementation:

- `tests/security/hr-employee-escalation.spec.ts` — HR onboards a new starter
  into the auto-created baseline while holding no lead permissions.
- `tests/e2e/acceptance-five-user-journey.spec.ts` — an administrator creates
  five roles including an ORGANIZATION-scoped Sales Manager and invites five
  people into them.
- `tests/permission/grant-ceiling.spec.ts` — a branch-scoped administrator is
  refused an ORGANIZATION grant, explicit or omitted, and refused another
  branch by id.

## What it must newly refuse

Each needs a test that fails before the change:

1. A branch administrator binding a role outside their delegable set — even at
   their own rank and own branch.
2. A branch administrator binding a delegable role at `ORGANIZATION`, or at a
   branch that is not theirs by id.
3. A branch administrator binding at a scope wider than that delegation's
   `maxScope`, even where their own reach would allow it.
4. An editor adding `payroll:APPROVE` to any role while not holding it.
5. An editor widening a permission on a role from `TEAM` to `ORGANIZATION`
   while holding it only at `TEAM`.
6. Each of 1–3 through `changeUserRole`, `inviteUser` and account creation, not
   only `assignRole` — one case per path, because the gap being closed is
   precisely that these paths were not all covered.

## Migration

The delegable set is empty until seeded, and empty refuses everything, so it
must be seeded in the same change that begins enforcing it. The seed is derived
from the six-role model and wants the owner's sign-off on one table: which roles
each of the six may hand out, and how far. Until that table is approved the
policy cannot be switched on, and until it is switched on G1 and G2 stay open.
