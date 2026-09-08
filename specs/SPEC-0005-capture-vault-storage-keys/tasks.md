# SPEC-0005 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Date | 2026-09-08 |

**Every task is `BLOCKED`.** Not `TODO`: `TODO` would mean the work is
available to pick up. At `R4` no implementation task may begin until gate 1
(Product Owner **and** Solution Architect), gate 3 (Application Security) and
gate 5 (implementation readiness) are all discharged, and `CL-001` and `CL-002`
are closed. None of that has happened.

## Task list

| Task | Purpose | Blocked on |
|---|---|---|
| `TASK-001` | Canonical composition in `pathFor` | gates 1, 3, 5 |
| `TASK-002` | Backward-compatible normalisation for reads and deletes | gates 1, 3, 5; `CL-001` |
| `TASK-003` | Refusal of malformed and hostile keys | gates 1, 3, 5 |
| `TASK-004` | Make an unresolvable delete visible instead of silent | gates 1, 3, 5 |
| `TASK-005` | Security tests | `TASK-001`–`TASK-004` |
| `TASK-006` | Traceability and verification | all above |

**Ordering is not arbitrary.** `TASK-002` lands before `TASK-001` in execution
order even though it is numbered after it: compatibility must exist before
composition changes, or a capture written by the old code and read by the new
becomes unreachable. `AD-003`.

---

## TASK-001

**Purpose:** compose the persisted capture key with a canonical `/` on every
platform.

**Requirements:** `FR-001`, `FR-002`, `FR-003`, `FR-004`, `FR-006`. Decisions
`AD-001`, `AD-002`.

**Dependencies:** `TASK-002` must be complete first.

**Allowed scope:** `apps/web/src/services/hr/captureVault.ts`

**Prohibited paths:** `apps/web/src/services/hr/attendance.ts`,
`apps/web/src/lib/jobs/retention.ts`, `apps/web/prisma/`,
`apps/web/src/lib/storage.ts`

**Expected files and components:** `pathFor`; the comment above it stating why
a persisted identifier is not composed with `path.join`.

**Required tests:** `UT-001`, `UT-002`, `UT-003`, `UT-004`, `REG-001`

**Security implications:** none directly. The key becomes more predictable
across platforms, which is the point; it carries no secret and no new
information.

**Data and migration implications:** none. `capturePath` is `String?` and no
row is rewritten.

**Definition of Done:** `REG-001` passes and is shown to have failed before;
the composed key is byte-identical on both platform shapes; the six correct
`path` uses in the file are untouched.

**Status:** `BLOCKED`

---

## TASK-002

**Purpose:** resolve an existing backslash key correctly for read and delete,
without rewriting the stored value.

**Requirements:** `FR-011`, `FR-012`, `SEC-004`, `DATA-002`. Decision `AD-003`.

**Dependencies:** none. **This is the first task to execute.**

**Allowed scope:** `apps/web/src/services/hr/captureVault.ts`

**Prohibited paths:** `apps/web/src/services/hr/attendance.ts`,
`apps/web/src/lib/jobs/retention.ts`, `apps/web/prisma/`,
`apps/web/src/lib/storage.ts`

**Expected files and components:** a normaliser used by `objectKey` and by the
legacy-vault resolution in `loadCapture` and `deleteCapture`.

**Required tests:** `UT-005`, `IT-002`, `IT-003`, `IT-004`, `REG-002`,
`REG-003`, `REG-004`, `REG-006`

**Security implications:** **the highest of any task here.** This is the only
place that takes a value out of the database and normalises it before use, so
it is where a traversal would be introduced. It must normalise separators
only — never resolve `..`, never percent-decode — and it must run **before**
validation, never after (`AD-004`, `TH-009`).

**Data and migration implications:** none, and this is load-bearing: the
normalisation is for resolution only. If a stored value changes, the task has
failed (`REG-006`).

**Definition of Done:** a capture whose row holds backslashes is read and
deleted correctly; the row is byte-identical afterwards; `REG-002`–`REG-004`
pass and are shown to have failed before.

**Status:** `BLOCKED`

---

## TASK-003

**Purpose:** refuse a key that is absolute, traversing, drive-relative, UNC, or
carries an empty or `.`/`..` segment.

**Requirements:** `FR-005`, `SEC-001`, `SEC-003`. Decision `AD-005`.

**Dependencies:** `TASK-002`.

**Allowed scope:** `apps/web/src/services/hr/captureVault.ts`

**Prohibited paths:** `apps/web/src/services/hr/attendance.ts`,
`apps/web/src/lib/jobs/retention.ts`, `apps/web/prisma/`,
`apps/web/src/lib/storage.ts`

**Required tests:** `UT-006`, `ST-001`, `ST-003`, `ST-004`

**Security implications:** refuse, do not repair. Collapsing or stripping
segments guesses which file was meant; on biometric data a wrong guess deletes
somebody else's evidence. The existing containment check stays as the backstop
and is **not** replaced by this (`ST-002`).

**Data and migration implications:** none.

**Definition of Done:** every form in `ST-001` is refused, each asserted
separately so a failure names the form that got through; the containment check
is unchanged.

**Status:** `BLOCKED`

---

## TASK-004

**Purpose:** make a capture deletion that resolved nothing distinguishable from
one that deleted something.

**Requirements:** `FR-005`, `OBS-001`. Threats `TH-001`, `TH-014`.

**Dependencies:** `TASK-002`, `TASK-003`.

**Allowed scope:** `apps/web/src/services/hr/captureVault.ts`

**Prohibited paths:** `apps/web/src/lib/jobs/retention.ts`,
`apps/web/src/services/hr/attendance.ts`, `apps/web/prisma/`,
`apps/web/src/lib/storage.ts`

**Required tests:** `IT-006`, `ST-005`

**Security implications:** the reason may be logged; the key may not
(`SEC-005`). A key carries a tenant id and an employee id.

**Data and migration implications:** none.

**Why the retention job is prohibited for this task.** The silence has two
halves: `deleteCapture` returns normally when it resolved nothing, and the
retention job deletes the row regardless. This task fixes only the first.
Changing when the retention sweep deletes a row is a change to a
data-destroying job and is a **separate decision for a human**, not something
to slip in behind a path-formatting fix. That is why the job is on the
prohibited list above rather than merely left alone.

**Definition of Done:** an unresolvable key produces a countable, logged
refusal carrying no key material; the caller can tell nothing was deleted; the
retention job is unmodified.

**Status:** `BLOCKED`

---

## TASK-005

**Purpose:** the security tests for this change.

**Requirements:** `SEC-001` to `SEC-005`.

**Dependencies:** `TASK-001` to `TASK-004`.

**Allowed scope:** `apps/web/tests/unit/capture-vault.spec.ts`,
`apps/web/tests/security/`

**Prohibited paths:** `apps/web/src/`

**Required tests:** `ST-001`, `ST-002`, `ST-003`, `ST-004`, `ST-005`,
`REG-005`

**Security implications:** `ST-002` proves a control that already exists was
not weakened. It must be written so that it fails if the containment check is
removed — a test that passes either way proves nothing.

**Data and migration implications:** none. Fixtures are synthetic bytes; no
real capture is used.

**Definition of Done:** every `SEC-` requirement has a test that fails when its
control is removed.

**Status:** `BLOCKED`

---

## TASK-006

**Purpose:** traceability, verification record and convergence.

**Requirements:** every `FR-`, `NFR-`, `SEC-`, `DATA-` and `OBS-` requirement
in the specification — this task records the evidence for all of them.
Specifically `FR-001` to `FR-012`, `NFR-001` to `NFR-005`, `SEC-001` to
`SEC-005`, `DATA-001`, `DATA-002` and `OBS-001`. Decisions `AD-001` to
`AD-007`.

**Dependencies:** `TASK-001` to `TASK-005`.

**Allowed scope:** `specs/SPEC-0005-capture-vault-storage-keys/`

**Prohibited paths:** `apps/web/`

**Required tests:** none — this task records results, it does not produce them.

**Security implications:** the verification record carries command names and
exit codes only. No captured output, no key, no capture content.

**Definition of Done:** every requirement traces to a task, a code location and
a test result; `node tools/sdd/cli.mjs validate --all` reports no blocking
error; convergence recommends a verdict and stops.

**Status:** `BLOCKED`

---

## Scope discipline

**No task may touch `apps/web/prisma/`.** There is no schema change here, and a
task that finds itself needing one has misunderstood the change.

**No task may touch `apps/web/src/lib/jobs/retention.ts`.** Its `deleteCapture`
call site is a caller, and the point of fixing this at the vault is that the
caller does not change. `TASK-004` explains why the row-deletion ordering
question is separated out for a human.

**No task may rewrite an existing row.** `DATA-002`. Not as a migration, not as
a repair-on-read, not as a helper script.

**No task may contact a deployed system.** `NFR-005`. The count-only assessment
in `clarifications.md` is prepared for a human to run under their own
authorisation, and is not part of any task here.
