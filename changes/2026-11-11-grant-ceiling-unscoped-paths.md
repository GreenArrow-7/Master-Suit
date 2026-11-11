# The grant ceiling, where no scope is named

## What

`changeUserRole` and `inviteUser` now apply the per-permission grant ceiling.
Branch `auth/grant-ceilings`, cut from `59c20bbe`.

## Why

`assignRole` has had the ceiling since `59c20bbe`. The other two paths that bind
a person to a role checked **rank** only — the same gap, one function along. The
owner's rule is that explicit and omitted scopes obey the same ceiling; without
this, the way around the ceiling was simply to use a path that names no scope.

## Where

- `src/services/identity/accounts.ts` — `changeUserRole`, after the rank cap.
- `src/services/identity/invitations.ts` — `inviteUser`, after
  `assertMayAdministerRole`. An invitation is a role grant with a delay: it
  confers on acceptance, when the inviter is no longer looking.
- `tests/permission/grant-ceiling.spec.ts` — three cases.
- `tests/globalSetup.ts`, `tests/permission/engagement-modules.spec.ts` — a
  parallel-execution race, below.

Both call the existing resolver at the role's own `defaultScope`. No second
permission engine.

## Behaviour

A branch-scoped administrator can no longer change somebody into, or invite
somebody into, a role carrying permissions wider than their own — the refusal
names the permission that exceeded them. A workspace-wide administrator is
unaffected.

## Verified

- `tests/permission/grant-ceiling.spec.ts` — 11 cases. The two new refusals
  **fail on the old code** (checked by removing the two calls: 2 failed, 9
  passed) and pass with it.
- `tests/permission tests/identity tests/unit` — 118 files, 2318 passed.
- `eslint`, `tsc`, `prettier` clean.

### A race this change exposed, and did not cause

With the three extra cases the suite went red in
`tests/permission/engagement-modules.spec.ts`. It was not a logic break: the
same code passed with `--no-file-parallelism`, and the base passed in parallel.

`tenantIds()` there reads **every** tenant in the database. The suite runs files
in parallel against one database, and a spec building fixtures grants
permissions in several statements — so for a moment its role holds an
engagement permission and not yet the matching leads one. The catalogue spec
read that half-built role and failed an invariant the role was never subject
to. The timing shift from three extra tests was enough to surface it.

It now reads only tenants created before the run began
(`TEST_RUN_STARTED_AT`, set in `tests/globalSetup.ts`), which is what the
assertion was always about. Two parallel runs green.

CI runs `npx vitest run` with default parallelism, so this would have been an
intermittent red there.

## Left open

Two of the four paths the owner listed:

- **account creation** — no `POST /api/v1/platform/users` exists; the account
  path needs locating before a ceiling can be put on it.
- **permission-matrix edits** (`updatePermissionMatrix`, `roles.ts:314`) — a
  different question from the other three. It changes what a *role* carries
  rather than who holds it, so the ceiling has to be evaluated per changed
  permission against the editor's own, not against a role-plus-scope pair.
