# The grant ceiling cannot be applied to role binding as written

## What

An attempt to put the per-permission grant ceiling on `changeUserRole` and
`inviteUser`, **withdrawn**. What ships on `auth/grant-ceilings` is the test
race fix below. `assignRole` keeps the ceiling it has had since `59c20bbe`;
nothing about its behaviour changed.

## Why it was withdrawn

The rule as stated is that an assigner must not grant an action they lack. On
`assignRole` that holds: the caller names a scope, and the question "may you
confer this reach" has an answer.

On the role-binding paths it does not hold, and CI proved it twice.

**`tests/security/hr-employee-escalation.spec.ts`** — an HR administrator
inviting a new starter into a role that does not exist yet, which the endpoint
creates at the lowest rank with the employee baseline. That baseline carries
`leads:VIEW` at OWN; HR holds no lead permissions. Refused.

**`tests/e2e/acceptance-five-user-journey.spec.ts`** — a workspace
administrator creating a Sales Manager role, granting it
`targets:VIEW`/`VIEW_REPORTS`/`reports:VIEW` at ORGANIZATION, and inviting
someone into it. Refused:

```
You cannot grant more than you hold: you do not hold targets:VIEW.
(3 permissions in this role exceed your authority.)
```

That is not an edge case. **In this product an administrator composes roles
they do not personally hold** — that is what administering roles means here. A
ceiling that compares a role's permissions against the administrator's own
makes role administration impossible unless every administrator is a superset
of every role they can hand out.

A first attempt exempted OWN-scoped grants, which cleared the HR case and left
the five-user journey failing, because that role is ORGANIZATION-scoped. There
is no narrowing of "an action they lack" that keeps both the rule and the
product. The two are in genuine conflict and the conflict is a design question,
not a bug to patch around.

## The decision this needs

One of:

1. **Rank and scope only on these paths.** Binding a person to an _existing_
   role is not inventing authority; what an assigner must not do is confer more
   _reach_ on a permission than they hold. Refuses a branch manager making
   somebody organization-wide; permits an administrator handing out a role
   whose contents they do not personally hold. Leaves a real gap: a role
   already carrying `payroll:APPROVE` can be handed to anyone by whoever may
   administer that rank.
2. **Gate the ceiling on who may define roles**, not on who may bind them —
   the escalation lives in `updatePermissionMatrix`, which is where a role's
   contents are chosen.
3. **Keep the rule literally** and accept that administrators must hold every
   permission they can delegate, which means redesigning the default roles.

This belongs with the six-role work, which the owner asked to keep separate
from the blank-screen fix, so it is written down and left.

## What does ship: a parallel-execution race

`tests/permission/engagement-modules.spec.ts` asserts an invariant over seeded
roles, but `tenantIds()` read **every** tenant in the database. The suite runs
files in parallel against one database, and a spec building fixtures grants
permissions in several statements — so for a moment its role holds an
engagement permission and not yet the matching leads one. The catalogue spec
read that half-built role and failed an invariant the role was never subject
to.

It now reads only tenants created before the run began
(`TEST_RUN_STARTED_AT`, set in `tests/globalSetup.ts`). CI runs
`npx vitest run` with default parallelism, so this was an intermittent red
waiting to happen; it surfaced here because three extra tests shifted the
timing.

`tests/security/assistant-guardrails.spec.ts` has the same race — "no seeded
role holds `leads:VIEW` without `events:VIEW`" scanned every role in the
database and could read one between its two grants. Same fix. It passed alone
and under `--no-file-parallelism` and failed only in parallel, which is how it
was told apart from a real breach of the invariant.

Three parallel runs of `tests/permission tests/security tests/identity
tests/unit` green afterwards: 171 files, 2987 tests.

## Verified

- `tests/permission tests/security tests/identity tests/unit` green.
- `eslint` 0 errors (exit 0), `tsc` clean, `prettier` clean.
