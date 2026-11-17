# A misspelt scope granted the whole workspace; now it grants nothing

## What

`MembershipRole.scopeType` decides where an additional role assignment applies.
It is a `String` column, the API validated it as `z.string().max(40)`, and the
resolver mapped anything it did not recognise to `ORGANIZATION`.

So `BRACNH` was accepted, stored, and conferred the role's permissions
**unnarrowed at workspace level**. A typo widened access and said nothing.

Three changes, so the rule holds wherever an assignment is written or read:

- **The API** takes an enum, not free text.
- **`assignRole`** validates the scope, requires a record id for the scopes that
  name one, and checks that record belongs to **this** workspace.
- **The resolver** grants **nothing** from an assignment whose scope it cannot
  read, and logs it.

A second defect in the same function, found while fixing the first: re-assigning
a previously revoked role set the status and the dates and **left the old scope
in place**, so a role revoked at BRANCH and re-granted at TEAM stayed at BRANCH.

## Why

The old resolver comment explained itself: _"Unknown values cap at ORGANIZATION
because that is the column default the assign flow writes."_ The reasoning is
inverted. The column's default being `ORGANIZATION` says what an **omitted**
scope means; it says nothing about a value somebody got wrong. `BRACNH` is not
a slightly-wrong `BRANCH` — it is a value nobody wrote on purpose, and the safe
reading of "I do not know where this applies" is **nowhere**.

Omitted still means `ORGANIZATION`, and that was checked rather than assumed:
the three other writers of this column — `accounts.ts:915`,
`invitations.ts:278`, `createWorkspace.ts:241` — all omit it deliberately for a
workspace-wide primary assignment. Failing closed on an omitted scope would have
broken account creation, invitations and workspace provisioning.

`BRANCH` with no branch is refused for the same reason it reads wrong: the
resolver pools branch ids from assignments that carry one, so such a row caps at
BRANCH while naming no branch. That is "applies to no branch", which is not what
anyone picks `BRANCH` for.

## Where

- `apps/web/src/lib/security/assignmentScope.ts` — **new**. The valid values,
  what each caps at, which need an id, and `scopeCapFor` returning `null` for
  anything else. One definition, read by all three layers, so they cannot drift.
- `apps/web/src/lib/auth/session.ts` — the local cap map moved out; an
  unrecognised scope now `continue`s with a warning instead of capping at
  ORGANIZATION.
- `apps/web/src/services/identity/roles.ts` — validation, the required record id
  and its workspace check, and the update branch now writes the scope.
- `.../roles/[action]/route.ts` — `z.enum(ASSIGNMENT_SCOPES)`.
- `apps/web/tests/permission/assignment-scope.spec.ts` — **new**, 10 cases.
- `docs/roles/INVALID-SCOPE-INVENTORY.md` — **new**: find the affected rows
  **before** releasing.

## Behaviour

- Assigning with a scope that is not a scope is refused — `422`, naming
  `scopeType` and listing the accepted values.
- `BRANCH`, `REGION`, `TEAM` or `DEPARTMENT` require a record, and that record
  must be this workspace's. Another workspace's id is a `404`.
- A record id on `ORGANIZATION` or `OWN` is refused rather than stored and
  ignored.
- Re-assigning a revoked role takes the scope you give it.
- **An assignment already stored with an unreadable scope now grants nothing.**
  That is a real access change for anyone holding one, which is why the
  inventory exists and why it is run first.

## Verified

`tests/permission/assignment-scope.spec.ts` — **10 passed**. Six of them
**fail on the old code**, confirmed by reverting `session.ts` and `roles.ts` to
`HEAD` and re-running:

```
× refuses a misspelt scope instead of reading it as ORGANIZATION
× refuses a lower-case scope, which is a different string
× refuses BRANCH with no branch
× refuses another workspace's branch
× refuses a record id on a scope that names none
× does not keep the scope it had before
  Tests  6 failed | 4 passed (10)
```

The four that pass either way assert **preserved** behaviour — an omitted scope
still defaults to `ORGANIZATION`, documented scopes are still accepted — which
is the half a security fix most easily breaks.

`npx tsc --noEmit` clean.

## Left open

- **The inventory has not been run**; it needs the production database. Until it
  has, the size of the access change at deployment is unknown. It may well be
  zero.
- **Branch and region grants still pool across assignments** — two branch-scoped
  roles mean either branch at any BRANCH-scoped permission. Unchanged here, and
  recorded in `docs/roles/ROLE-INVENTORY.md`.
- **`scopeType` is still a `String` in the schema.** A check constraint or an
  enum would make this impossible rather than merely refused; that is a
  migration, and this change deliberately carries none.
