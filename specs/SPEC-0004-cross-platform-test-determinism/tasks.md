# SPEC-0004 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0004` |
| Risk | `R2` |
| Date | 2026-09-08 |

**Creating these tasks authorises nothing.** No task may be executed until the
specification approval in `spec.md` is recorded and preflight passes.

Scope declarations are structured lists of paths, per `SPEC-0002/CL-002` and
the `SDD-V062` grammar. No prose, no globs.

---

## TASK-001

**Purpose:** Make text scanning in the three affected test files tolerate CRLF,
so they parse the same content on either line ending.

**Requirements:** `FR-001`, decisions `AD-001`, `AD-002`.

**Allowed scope:** `apps/web/tests/unit/env-example-parses.spec.ts`,
`apps/web/tests/security/assistant-guardrails.spec.ts`,
`apps/web/tests/unit/observability.spec.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/package.json`,
`apps/web/prisma/`, `apps/web/tests/security/guarded-prologue.spec.ts`.

**Required tests:** `REG-001`, `REG-002`, `REG-003`, `ST-002`.

**Security implications:** touches a security test. `SEC-001` requires every
assertion to keep proving the same invariant; `SEC-002` requires the
tool-permission check to end stricter. Nothing is skipped or loosened here.

**Definition of Done:** the 17 failures pass; each assertion is unchanged in
what it proves; `ST-002` pins the extraction so a future regression cannot make
the check vacuous again.

**Completion evidence:** the vitest run, recorded in a `VER-` record.

**Evidence:** `REG-001`, `REG-002`, `REG-003` and `ST-002` PASS (`VER-0001`). Session `ASES-0001`.

**Status:** `DONE`

## TASK-002

**Purpose:** Normalise path separators before the exemption-set membership test
so the two exempt routes are recognised on any platform.

**Requirements:** `FR-002`, decision `AD-003`.

**Allowed scope:** `apps/web/tests/security/guarded-prologue.spec.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/package.json`,
`apps/web/tests/unit/`.

**Required tests:** `REG-004`.

**Security implications:** this test guards against hand-rolled security
prologues. The fix must make it detect the same condition, not fewer: only the
exemption comparison changes.

**Definition of Done:** both exempt routes are recognised, no hand-rolled
prologue is reported, and the detection pattern is untouched.

**Completion evidence:** `REG-004` passing.

**Evidence:** `REG-004` PASS (`VER-0001`). Session `ASES-0002`.

**Status:** `DONE`

## TASK-003

**Purpose:** Guard the two POSIX file-mode assertions on the platform so they
run and must pass where the platform supports them.

**Requirements:** `FR-003`, `SEC-001`, decision `AD-004`.

**Allowed scope:** `apps/web/tests/unit/observability.spec.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/scripts/`,
`apps/web/package.json`.

**Required tests:** `REG-005`, `ST-001`.

**Security implications:** the assertion proves a secrets file is unreadable by
others. **It is not removed and not weakened.** The guard is on
`process.platform` alone and never inspects the observed mode.

**Definition of Done:** on Windows the two assertions are skipped with a stated
reason; on POSIX they are byte-identical to today and still enforced.

**Completion evidence:** `REG-005`, plus the diff showing the assertion text
unchanged.

**Evidence:** `REG-005` and `ST-001` PASS (`VER-0001`). The assertion text is byte-identical; only `process.platform` gates it. The separate question of whether that limitation is acceptable is `CONV-002`, a human disposition, not outstanding task work.

**Status:** `DONE`

## TASK-004

**Purpose:** Add a deterministic, idempotent, local-only preparation command
for `master_saas_test`, with a separately named destructive reset.

**Requirements:** `FR-004`, `FR-005`, `FR-006`, `NFR-003`, `NFR-004`, decision
`AD-005`.

**Allowed scope:** `apps/web/scripts/`, `apps/web/package.json`,
`apps/web/SETUP.md`.

**Scope note:** the directory prefix is declared because the new script does not
exist yet. `TASK-005` owns the secrets-generation script and runs in its own
session.

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`,
`apps/web/infra/`, `apps/web/tests/`.

**Required tests:** `IT-001`, `IT-002`, `IT-003`.

**Security implications:** the script must refuse any non-loopback host, create
no migration, change no schema, and print no secret value. It reads `.env.test`
for connection details and must never echo them.

**Definition of Done:** preparation creates the database if absent, applies
existing migrations, succeeds a second time without destroying data, and reset
is a separate command that says what it does.

**Completion evidence:** both runs recorded in a `VER-` record, commands and
exit codes only.

**Evidence:** `IT-001`, `IT-002`, `IT-003` PASS (`VER-0001`), plus the seed-parity rework in `ASES-0011` and `VER-0003`: `db:test:reset` rebuilds from empty in 25s (65 migrations, then seed), a second `db:test:prepare` applies no migration and re-seeds idempotently in 8s, and the full suite from that baseline runs the test that previously skipped.

**Status:** `DONE`

## TASK-005

**Purpose:** Correct every repository statement that claims `npm run setup`
prepares `master_saas_test`.

**Requirements:** `FR-007`, decision `AD-006`.

**Allowed scope:** `apps/web/scripts/generate-secrets.mjs`.

**Prohibited paths:** `apps/web/src/`, `apps/web/tests/`,
`apps/web/prisma/`.

**Required tests:** `IT-004`.

**Security implications:** none. Comment text only; no behaviour changes.

**Definition of Done:** no statement claims a behaviour the command does not
have, and the corrected text points at `db:test:prepare`. **`npm run setup` is
not widened to make the old sentence true.**

**Completion evidence:** `IT-004` and the diff.

**Evidence:** `IT-004` PASS (`VER-0001`). Session `ASES-0005`.

**Status:** `DONE`

## TASK-006

**Purpose:** Run the verification stack and record what actually happened.

**Requirements:** `NFR-001`.

**Allowed scope:** `specs/SPEC-0004-cross-platform-test-determinism/`.

**Prohibited paths:** `apps/web/`.

**Required tests:** `REG-001`, `REG-002`, `REG-003`, `REG-004`, `REG-005`,
`ST-001`, `ST-002`, `IT-001`, `IT-002`, `IT-003`, `IT-004`.

**Security implications:** none; this task delivers no code.

**Definition of Done:** the full product suite, B2, B3 and `validate --all` are
run and their real results recorded, including any failure.

**Completion evidence:** a `VER-` record naming commands and exit codes only.

**Evidence:** `VER-0001` recorded the first pass; `VER-0002` recorded the Playwright recurrence; `VER-0003` records the rework. The task-state reconciliation, the traceability result column and the third revision of `convergence.md` are complete.

**Status:** `DONE`

## TASK-007

**Purpose:** Security review of the diff, and the convergence report (created by this task).

**Requirements:** `SEC-001`, `SEC-002`, `NFR-002`, `NFR-005`, `DATA-001`.

**Allowed scope:** `specs/SPEC-0004-cross-platform-test-determinism/`.

**Prohibited paths:** `apps/web/`.

**Required tests:** none; this task delivers no code.

**Security implications:** the review is the deliverable. Every modified
assertion is compared against its original and must still prove the same
property.

**Definition of Done:** a `REV-` record exists, every changed assertion is
accounted for, and the convergence report carries a recommended verdict.

**Completion evidence:** a `REV-` record and the convergence report.

**Evidence:** `REV-0001` (original diff) and `REV-0002` (the rework delta) exist, and `convergence.md` carries a recommended verdict. Both review records are `actorType: "ai"` with `satisfiesHumanGate: false`; the human code review is `CONV-001` and is a separate gate, not this task.

**Status:** `DONE`

---

## Task-state history

**These statuses were all `TODO` until 2026-09-08, after seven of the nine
tasks had been executed.** The task artefact and the execution records
disagreed, and `convergence.md` check 5 reported `PASS` against that
disagreement. Both were wrong; the finding is `CONV-005` and the incorrect
prior state is recorded here rather than quietly overwritten.

Each status above was set from its own evidence, individually. `TASK-008` was
not simply marked `DONE`: it was reopened, its defect fixed under `CONV-004`,
and re-verified from three cold starts before the status moved. `TASK-004` was
likewise re-verified after the seed-parity change rather than inheriting its
earlier result.

Statuses come from the vocabulary in `specs/templates/TASKS_TEMPLATE.md`:
`TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`, `WITHDRAWN`. There is
no `PARTIAL` in that list, so none is used.

## Scope discipline

`TASK-001` and `TASK-002` exclude each other's file, and both exclude
`apps/web/src/`. `TASK-006` and `TASK-007` touch no product file at all, so
neither the tester nor the reviewer can adjust what they measure.

**No task may touch `apps/web/src/`.** The four `capture-vault` failures are a
product defect classified `R4` and are handled separately.

---

## TASK-008

**Purpose:** Find and fix the cause of the intermittent Playwright `beforeAll`
failures, which are `404` responses from the development server on API routes
that exist.

**Requirements:** `FR-008`, `NFR-006`.

**Allowed scope:** `apps/web/playwright.config.ts`,
`apps/web/tests/e2e/helpers.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/package.json`,
`apps/web/prisma/`, `apps/web/tests/unit/`, `apps/web/tests/security/`.

**Required tests:** `IT-005`.

**Security implications:** the failing calls are authentication and
password-change requests. **No authentication product behaviour may change.**
`apps/web/src/` is prohibited for this task precisely so a harness fix cannot
reach the auth implementation.

**Definition of Done:** the root cause is evidenced rather than assumed; the
fix is a deterministic readiness condition, not a blind retry, sleep or raised
global timeout; five consecutive runs pass.

**Completion evidence:** five consecutive runs recorded in a `VER-` record.

**Evidence:** `VER-0003`. **5 of 5**, three of them from a genuinely cold dev server with port 3000 confirmed free beforehand. `VER-0002` records the 4-of-5 result that reopened this task; it is not withdrawn.

**Status:** `DONE`

---

## TASK-009

**Purpose:** Make the fixture permission-catalogue creation safe against the
concurrent insert several suites perform when the catalogue is empty.

**Requirements:** `FR-004`, decision `AD-005`.

**Allowed scope:** `apps/web/tests/helpers/fixtures.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`,
`apps/web/scripts/`, `apps/web/package.json`.

**Required tests:** `IT-006`.

**Security implications:** the catalogue is the permission set the RBAC tests
build their actors from. The fix must create exactly the same rows it creates
today — it may not widen a permission, skip one, or grant a role anything it
was not already granted.

**Definition of Done:** a suite that loses the race re-reads the existing row
rather than failing; the full suite against a freshly reset database reports
the same counts as against a warm one, apart from the four `RC-4` failures.

**Completion evidence:** the full suite after `db:test:reset`, recorded in a
`VER-` record.

**Evidence:** `IT-006` PASS (`VER-0001`), 1830 → 1913 passing. Session `ASES-0008`.

**Status:** `DONE`
