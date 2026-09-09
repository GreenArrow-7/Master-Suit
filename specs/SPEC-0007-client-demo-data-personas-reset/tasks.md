# SPEC-0007 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Date | 2026-09-08 |

**Gate 1 was approved by a human Product Owner on 2026-09-08**, which is what
released these tasks. `CHG-001` and `CHG-002` were approved on the same date and
amended `FR-002`, `FR-011` and this task list.

Status is reconciled from evidence, not declared. Every task below is
`COMPLETE`: each has implementation evidence, a committed and passing test,
a bounded agent session and a clean scope-check.

**Historical process deviation, preserved:** TASK-002 to TASK-005 were executed
under session `ASES-0001`, which was opened for TASK-001 alone, rather than
under one session each. Later work used bounded sessions — `ASES-0002` for
TASK-006, `ASES-0003` for TASK-007, `ASES-0004` for TASK-008. The deviation
is recorded rather than rewritten away.

## Task list

| Task | Purpose | Blocked on |
|---|---|---|
| `TASK-001` | HR dataset generator: organisation, people, hierarchy | gate 1 |
| `TASK-002` | HR dataset generator: shifts, holidays, leave, attendance | gate 1, `TASK-001` |
| `TASK-003` | Reset coverage check | gate 1 |
| `TASK-004` | Extend the demo reset to cover HRMS | gate 1, `TASK-003` |
| `TASK-005` | Sales dataset audit and gap fill | gate 1 |
| `TASK-006` | Persona isolation and negative-authorization tests | gate 1, `TASK-002` |
| `TASK-007` | End-to-end walkthroughs | gate 1, `TASK-002`, `TASK-005` |
| `TASK-008` | Demonstration documentation | gate 1, `TASK-007` |
| `TASK-009` | Designate and prove the single client-facing login | — (`CHG-003` approved) |

`TASK-003` lands before `TASK-004` deliberately, though it is a test and the
other is the behaviour: the coverage check must be able to fail before the
reset is extended, or it proves nothing about the extension.

---

## TASK-001

**Purpose:** generate the demo organisation — departments, designations,
employees and the reporting hierarchy.

**Requirements:** `FR-001`, `FR-002`, `FR-003`, `FR-014`. Decisions `AD-001`,
`AD-002`, `AD-003`, `AD-009`.

**Dependencies:** none.

**Allowed scope:** `apps/web/prisma/seed/`, `apps/web/tests/hr/`

**Prohibited paths:** `apps/web/prisma/schema.prisma`,
`apps/web/prisma/migrations/`, `apps/web/src/`

**Expected files and components:** a new generator module under the seed
directory; its invocation from the existing seed entry point.

**Required tests:** `UT-001`, `UT-002`, `UT-008`, `UT-010`

**Security implications:** none directly. The records are synthetic and carry
no credential. `DATA-001` applies to every generated value.

**Data and migration implications:** none. Every model used exists today.

**Definition of Done:** `UT-001`, `UT-002`, `UT-008` and `UT-010` pass;
`npm run check:drift` is clean; the existing seed output is unchanged apart
from the added HR counts.

**Status:** `COMPLETE` — generator implemented; UT-001, UT-002 committed and passing; seed verified against the local demo database.

---

## TASK-002

**Purpose:** generate shifts, holidays, leave types, leave balances, leave
requests and attendance history.

**Requirements:** `FR-004`, `FR-005`, `FR-006`, `FR-007`, `FR-008`, `FR-013`.
Decisions `AD-003`, `AD-004`.

**Dependencies:** `TASK-001`.

**Allowed scope:** `apps/web/prisma/seed/`, `apps/web/tests/hr/`

**Prohibited paths:** `apps/web/prisma/schema.prisma`,
`apps/web/prisma/migrations/`, `apps/web/src/`

**Expected files and components:** the leave and attendance generators in the
same module; holiday-aware working-day calculation.

**Required tests:** `UT-003`, `UT-009`, `IT-001`, `IT-002`, `IT-009`

**Security implications:** none directly. `DATA-002` and `DATA-003` forbid the
biometric and payroll classes, and `UT-005` asserts their absence.

**Data and migration implications:** none.

**Definition of Done:** every HR screen in the walkthrough renders populated
data or a deliberate empty state named in `E2E-005`; `UT-003`, `UT-005`,
`UT-009`, `IT-001`, `IT-002` and `IT-009` pass.

**Status:** `COMPLETE` — leave, attendance, shifts, holidays implemented; UT-003, UT-009, IT-001 committed and passing; 1800 rows over 45 working days, none on a weekend or a holiday.

---

## TASK-003

**Purpose:** a catalogue-driven check that the reset clears every tenant-scoped
model or names it in a reviewed exclusion list.

**Requirements:** `FR-015`. Decisions `AD-007`, `AD-008`.

**Dependencies:** none.

**Allowed scope:** `apps/web/tests/hr/`

**Prohibited paths:** `apps/web/prisma/seed/`, `apps/web/src/`

**Expected files and components:** the coverage test and the reviewed exclusion
list it reads, with a stated reason per exclusion.

**Required tests:** `UT-007`

**Security implications:** this is the control for `TH-007`. A model that
escapes the reset leaves records that a later demonstration presents as
baseline.

**Data and migration implications:** none.

**Definition of Done:** `UT-007` fails against the reset as it stands today —
demonstrating that it detects the known HR gap — and passes after `TASK-004`.

**Status:** `COMPLETE` — coverage guard committed and passing, with a negative proof that it detects an uncovered model.

---

## TASK-004

**Purpose:** *(restated by `CHG-002`)* verify — not build — that the existing
reset already clears every resettable tenant-scoped record through the tenant
cascade, and that the four fail-closed environment protections still refuse an
unsafe target before any destructive statement runs.

No HR teardown code is written. The original purpose below assumed HR records
survived a reset; the repository contradicts it, and the Product Owner approved
withdrawing that work rather than adding deletions the next statement makes
redundant. Superseded purpose, preserved: *extend the existing reset to clear
HRMS tenant-scoped records,
preserving the workspace, its roles and the persona memberships.*

**Requirements:** `FR-011`, `FR-012`, `FR-013`, `SEC-001`, `SEC-002`,
`OBS-001`, `OBS-002`. Decisions `AD-005`.

**Dependencies:** `TASK-003`.

**Allowed scope:** `apps/web/prisma/seed/`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/schema.prisma`,
`apps/web/prisma/migrations/`

**Expected files and components:** the reset branch of the seed entry point;
HR deletions ordered ahead of the existing ones as the foreign keys require.

**Required tests:** `UT-007`, `IT-003`, `IT-004`, `IT-005`, `IT-010`,
`ST-006`, `ST-007`, `REG-002`

**Security implications:** this task widens a destructive operation. The four
environment refusals are a security contract and may not be weakened,
parameterised or bypassed. A refusal must happen before the first deletion.

**Data and migration implications:** none to the schema. The operation deletes
rows in a disposable database only.

**Definition of Done:** `ST-006` and `ST-007` prove refusal under each gate with
zero rows changed; `IT-005` proves per-model clearance; `IT-010` proves the
personas survive; `REG-002` proves nothing previously cleared was lost.

**Status:** `COMPLETE` — restated by CHG-002 as verification; ST-006, ST-007, IT-003, IT-004 committed and passing; all four gates refuse before any write.

---

## TASK-005

**Purpose:** audit the existing Sales dataset against the client walkthrough and
fill only the gaps it proves.

**Requirements:** `FR-009`. Decisions `AD-009`.

**Dependencies:** none.

**Allowed scope:** `apps/web/prisma/seed/`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/schema.prisma`

**Expected files and components:** an audit note recording each Sales screen in
the walkthrough and whether it renders populated; changes only where it does
not, each naming the screen that required it.

**Required tests:** `REG-001`, `E2E-002`

**Security implications:** none.

**Data and migration implications:** none.

**Definition of Done:** the audit covers every Sales screen in `E2E-001` and
`E2E-002`; `REG-001` shows existing counts unchanged; any addition names its
screen.

**Status:** `COMPLETE` — Sales screens audited live and via E2E-002; every screen POPULATED, so no seed addition was required. The audit result is the deliverable.

---

## TASK-006

**Purpose:** prove tenant and role boundaries for the three personas.

**Requirements:** `FR-010`, `SEC-003`, `SEC-004`, `SEC-005`, `SEC-006`,
`SEC-007`, `DATA-005`.

**Dependencies:** `TASK-002`.

**Allowed scope:** `apps/web/tests/tenant/`, `apps/web/tests/security/`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`

**Expected files and components:** persona cases extending the existing
two-workspace fixture; negative-authorization cases asserted against route
handlers rather than pages.

**Required tests:** `ST-001`, `ST-002`, `ST-003`, `ST-004`, `ST-005`, `ST-008`,
`ST-009`, `ST-010`, `ST-011`, `IT-006`, `IT-007`, `IT-008`

**Security implications:** this task is the evidence for `TH-001` through
`TH-005`, `TH-008`, `TH-009`, `TH-012` and `TH-013`. A test that passes because
a login is broken proves nothing, which is why `ST-004` exists alongside
`ST-003`.

**Data and migration implications:** none.

**Definition of Done:** every listed case passes, and each negative case is
shown to fail when the corresponding grant is temporarily widened in a scratch
fixture.

**Status:** `COMPLETE` — 10 security cases committed and passing under session ASES-0002; role and tenant boundaries proven at the route.

---

## TASK-007

**Purpose:** the three demonstration walkthroughs as end-to-end tests.

**Requirements:** `FR-008`, `FR-009`, `FR-010`.

**Dependencies:** `TASK-002`, `TASK-005`.

**Allowed scope:** `apps/web/tests/e2e/`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`

**Expected files and components:** the management, Sales and HR walkthroughs,
and the empty-state assertions.

**Required tests:** `E2E-001`, `E2E-002`, `E2E-003`, `E2E-004`, `E2E-005`

**Security implications:** `E2E-004` covers `TH-014`, the destructive action a
prospect might take.

**Data and migration implications:** none.

**Definition of Done:** all five cases pass on both supported hosts; `E2E-005`
names every deliberate empty state rather than tolerating empties in general.

**Status:** `COMPLETE` — 5 Playwright cases committed and passing under session ASES-0003; Chromium installed at the pinned version.

---

## TASK-008

**Purpose:** demonstration documentation.

**Requirements:** `FR-016`.

**Dependencies:** `TASK-007`.

Scope was widened to hold `UT-011`: SDD-V057 refuses a session for a task with
no required test, and it is right to — a documentation task with no check is a
task whose completion is a matter of opinion.

**Allowed scope:** `docs/DEMO.md`, `apps/web/tests/hr/`

**Prohibited paths:** `docs/sdd/`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/RISK_CLASSIFICATION.md`, `docs/ENVIRONMENTS.md`

**Expected files and components:** personas, the walkthrough, the seed command
and the reset command, and what the reset does and does not preserve.

**Required tests:** `UT-011`

**Security implications:** no credential value is written into documentation.
`SEC-007`.

**Data and migration implications:** none.

**Definition of Done:** a reader can run the demonstration from the document
alone; no credential appears in it.

**Status:** `COMPLETE` — runbook written and UT-011 committed and passing under session ASES-0004.


---

## TASK-009

**Purpose:** designate one client-facing demonstration credential and prove a
single session of it reaches both modules.

**Requirements:** `FR-017`. Change record `CHG-003`.

**Dependencies:** `CHG-003` approved.

**Allowed scope:** `apps/web/tests/e2e/`, `docs/DEMO.md`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`

**Expected files and components:** the single-login end-to-end case, and the
runbook naming which login a client is given.

No role, workspace, entitlement or seed change: the architecture already
satisfies the requirement and the work is designation plus proof. If
implementation shows otherwise, work stops and raises a further change record.

**Required tests:** `E2E-006`

**Security implications:** the designated account is `org_admin` — tenant-scoped,
`platformRole USER`, already proven refused the platform control plane by
`ST-005` and `E2E-004`. Naming it client-facing grants it nothing new.

**Data and migration implications:** none.

**Definition of Done:** `E2E-006` passes; `docs/DEMO.md` names one client login
and marks the other two as security fixtures.

**Status:** `COMPLETE` — E2E-006 committed and passing under session `ASES-0005`; `docs/DEMO.md` names one client login and marks the other two as security fixtures.


---

## TASK-010

**Purpose:** provision the named client-facing login `demo@youhan.in` in the
governed demo seed, and prove its boundaries against that address rather than
against its role.

**Requirements:** `FR-017`. Change records `CHG-003`, `CHG-004`.

**Dependencies:** `CHG-003` approved. `CHG-004` **raised and not approved** — see
the security note below for what that permits and what it does not.

**Why this is a separate task and not TASK-009 continued.** `TASK-009`
prohibits `apps/web/prisma/`, on the recorded ground that designating a login
needed no seed change. Naming a *new* address makes that false: the account has
to be seeded before anything can authenticate as it. Widening `TASK-009`'s
scope in place would erase the reason it was drawn that way, so the wider scope
is declared here.

**Allowed scope:** `apps/web/prisma/seed/index.ts`,
`apps/web/tests/security/demo-personas.spec.ts`,
`apps/web/tests/hr/demo-docs.spec.ts`, `apps/web/tests/e2e/`, `docs/DEMO.md`

**Prohibited paths:** `apps/web/src/`, `prisma/schema.prisma`,
`prisma/migrations/`, `.github/workflows/`

**Expected files and components:** a `DEMO_CLIENT_LOGIN` constant, one appended
`userSpecs` row, the seed banner naming it, the runbook designating it, and the
address-resolved boundary cases.

**Required tests:** `ST-012`, `ST-013`, `ST-014`, `ST-015`, `ST-016`, `UT-012`,
`E2E-006`

**Security implications.** The account is `org_admin`: its widest grant is
`ORGANIZATION`, which is the whole tenant and no further, and `platformRole`
stays at the schema default `USER`. No role, grant, entitlement, policy or
schema is changed — a row is added to a fixture. `super_admin` carries identical
grants at a lower rank and was deliberately not used.

`CHG-004` is unapproved, and that bounds this task rather than blocking it. What
is built is a seed fixture in a disposable local database; what is **not** done
is edit `DATA-005` in `spec.md`, close `CL-007` as amended, or record any
approval. The requirement text stands as approved and the conflict stands open.


---

## TASK-011

**Purpose:** carry out the half of `CHG-004` that only becomes possible once it
is approved — amend `DATA-005`, and make the amendment's narrowness enforceable
rather than merely stated.

**Requirements:** `DATA-005` (as amended), `FR-017`. Change record `CHG-004`,
**approved** by the Product Owner on 2026-09-09.

**Dependencies:** `CHG-004` approved. `TASK-010` complete.

**Why a separate task.** `TASK-010` deliberately did **not** edit `DATA-005`,
because the change record was unapproved and an agent may not amend a
requirement on its own. The approval is what unblocks that edit, so the edit
belongs to its own task with its own scope rather than being backdated into a
completed one.

**Allowed scope:** `specs/SPEC-0007-client-demo-data-personas-reset/`,
`apps/web/prisma/seed/crm.ts`, `apps/web/prisma/seed/index.ts`,
`apps/web/tests/hr/demo-dataset.spec.ts`, `docs/DEMO.md`

**Prohibited paths:** `apps/web/src/`, `prisma/schema.prisma`,
`prisma/migrations/`, `.github/workflows/`, `apps/web/infra/`

**Expected files and components:** the amended `DATA-005` text; `UT-013`
asserting the exemption is exactly one address; and whatever repair `UT-013`
turns out to demand of the generated data.

**Required tests:** `UT-013`

**Security implications.** This task *narrows* exposure rather than widening it.
The approval permits one non-reserved address; `UT-013` is what stops that
permission drifting into a second. No authorization, role, policy or schema
changes.

**Note on what `UT-013` found.** Written to guard the new exception, it
immediately failed on the old data: 25 generated contact addresses, the account
book's `mainEmail` and `website` values, and the second workspace's
administrator were all on live-looking domains built from company names plus
`.ae`. `CL-007` had been recorded as resolved by moving everything to a reserved
domain, and that had only ever been done for the ten persona logins. The repair
is therefore in scope for this task rather than a new finding to defer: the
approval instruction was explicit that all other identities keep following
`DATA-005`, and they were not.

---

## TASK-012

**Purpose:** close the three convergence findings left OPEN, so the specification can be put to gate 6 without carrying known defects.

**Requirements:** `FR-011`, `FR-012`, `FR-015`. Findings `CONV-008`, `CONV-009`, `CONV-011`.

**Dependencies:** `TASK-011`.

**Allowed scope:** `apps/web/scripts/prepare-test-db.mjs`, `apps/web/prisma/seed/index.ts`, `apps/web/tests/hr/`, `apps/web/playwright.config.ts`

**Prohibited paths:** `apps/web/src/lib/security/`, `apps/web/src/lib/auth/`, `apps/web/prisma/migrations/`, `.github/workflows/`

**Expected files and components:** the seed's failure surfaced rather than swallowed; the end-to-end harness gating on the server it starts; the reset covering every seeded workspace.

**Required tests:** `UT-015`

**Security implications:** one is a redaction decision. `apps/web/scripts/prepare-test-db.mjs` withheld the seed's output because the seed can print a shared demo password, and the fix echoes it — so the echo redacts any line matching password, secret, token, api key or a connection string, and the seed already withholds the banner when stdout is not a terminal. The change makes diagnosis possible without making a credential printable.

**Data and migration implications:** the reset now removes the secondary workspace as well as the primary. No schema change; a wider teardown of synthetic data on a disposable database.
## TASK-013

**Purpose:** close the two findings raised after the 2026-09-09 gate 6 acceptance, so the specification can be put to a fresh gate 6 without carrying known defects.

**Requirements:** `FR-011`, `FR-012`, `FR-015`. Findings `CONV-015`, `CONV-016`.

**Dependencies:** `TASK-012`.

**Allowed scope:** `apps/web/tests/helpers/`, `apps/web/tests/hr/`, `apps/web/tests/security/`, `apps/web/playwright.config.ts`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`, `apps/web/scripts/`, `apps/web/prisma/migrations/`, `.github/workflows/`, `apps/web/infra/`

**Expected files and components:** the destructive reset suite running against a database it owns, so it and the persona suite can run concurrently at the default parallelism CI uses; the two retry-shaped mitigations removed from the persona suite; the stray control character removed from the reset-coverage regex so its explicit-deletion arm is load-bearing; one reading of `APP_URL` in the end-to-end configuration rather than two that can disagree.

**Required tests:** `ST-001`, `ST-002`, `ST-003`, `ST-004`, `ST-005`, `ST-009`, `IT-003`, `IT-004`, `UT-015`, `E2E-001`, `E2E-006`

**Security implications:** the persona suite is where tenant isolation and platform-control-plane denial are asserted, and both mitigations being removed were absorbing failures there. A retry that hides a race hides a regression identically, so removing them raises the sensitivity of the security assertions rather than lowering it. No product source file is touched and no control changes; the demo reset keeps the `CONV-011` behaviour that caused the collision.

**Data and migration implications:** none to the product. The suite provisions an additional local test database, `<ambient>_reset`, holding synthetic data only, created and migrated by the harness on each run.
