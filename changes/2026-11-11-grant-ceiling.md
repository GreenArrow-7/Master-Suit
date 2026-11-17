# Nobody hands out authority they do not hold

## What

A **per-permission** ceiling on granting a role: the conferred scope may not be
wider than the assigner's own for that same `module:ACTION`, **and** a named
branch, team or region must sit inside the assigner's own **by id**.

`assertMayGrantRole` already capped a role's **rank**. This caps its **reach**,
which is a different thing and was unchecked.

## Why

A rank-60 "Sales Agent" role can carry ORGANIZATION-scoped permission rows. So
a branch manager could assign it and confer a workspace-wide read they did not
have — rank said yes because the role is junior, and nothing asked about reach.

`tests/permission/grant-ceiling.spec.ts` recorded that as characterisation
before this change, and one of its cases is the reason the fix is shaped this
way: **closing the omitted-scope path alone would have changed nothing**,
because naming `ORGANIZATION` explicitly produced exactly the same result. The
compatibility default was never the hole. The missing ceiling was.

**Ordering is not containment.** `BRANCH` is not wider than `BRANCH`, so a rank
comparison lets a Marina manager grant authority over Downtown. The check
resolves the named place up the hierarchy — Region ← Branch ← Team — and
compares ids against the assigner's own `branchId`, `regionId`, `teamIds`,
`grantedBranchIds` and `grantedRegionIds`. A place that resolves to nothing is
**not** covered: "I cannot tell where this is" is not permission to grant it.

It reads the assigner's authority from `ctx.actor.permissions`, the map the
session resolver already built. There is one permission engine and this is not
a second one.

## Where

- `apps/web/src/lib/security/grantCeiling.ts` — **new**. `ceilingBreaches`
  returns the list (a preview needs the list, not an exception);
  `assertWithinGrantCeiling` refuses on the first.
- `apps/web/src/services/identity/roles.ts` — `assignRole` calls it after the
  scope is known, because the ceiling depends on where the assignment applies.
- `apps/web/tests/permission/grant-ceiling.spec.ts` — characterisation
  converted to regression.

## Behaviour

| Assigner                   | Grant                                                 | Before  | After       |
| -------------------------- | ----------------------------------------------------- | ------- | ----------- |
| `leads:VIEW` at BRANCH     | role with `leads:VIEW` at ORGANIZATION, scope omitted | allowed | **refused** |
| same                       | the same, naming `ORGANIZATION`                       | allowed | **refused** |
| same                       | the same, scoped to **their** branch                  | allowed | allowed     |
| same                       | the same, scoped to **another** branch                | allowed | **refused** |
| no `payroll:APPROVE`       | role carrying `payroll:APPROVE`                       | allowed | **refused** |
| ORGANIZATION administrator | anything at or below their rank                       | allowed | allowed     |

The message names the permission that exceeded: _"it would grant leads:VIEW at
ORGANIZATION and you hold BRANCH"_, or _"you do not hold payroll:APPROVE"_.

Rank restrictions are untouched and still apply first.

## Verified

8 cases. **Five fail without the ceiling**, confirmed by disabling the call and
re-running:

```
× refuses an ORGANIZATION grant from a branch-scoped administrator — omitted (was the escalation)
× refuses it when named explicitly, too (was the escalation)
× names the permission that exceeded the assigner
× refuses another branch, which outranks nothing but is somewhere else
× refuses a permission the assigner does not hold at all
  Tests  5 failed | 3 passed (8)
```

The three that pass either way are the rank check and **both allowed-delegation
cases** — a branch manager granting within their own branch, and an
organisation administrator granting as before. A ceiling that blocked those
would be a worse defect than the one it fixes.

`npx tsc --noEmit` clean.

## Left open

This covers **`assignRole` only**. The same ceiling has to reach
`changeUserRole`, invitations, account creation and permission-matrix edits —
each is a separate path with its own authorisation, and bolting one check onto
four call sites without reading each would be how a ceiling gets a hole in it.
They are next, not forgotten.

`createWorkspace` has no actor at all, so there is nothing to compare against;
making bootstrap a narrowly authorised provisioning path rather than an
actorless one is its own change.
