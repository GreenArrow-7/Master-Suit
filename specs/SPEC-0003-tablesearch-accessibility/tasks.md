# SPEC-0003 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Date | 2026-09-08 |

**Creating these tasks authorises nothing.** No task may be executed until the
specification approval in `spec.md` is recorded and preflight passes.

**Specification approval was recorded on 2026-09-08** (Product Owner, human).
Four tasks are executable: `TASK-001`, `TASK-003`, `TASK-004`, `TASK-005`.
`TASK-002` is `WITHDRAWN` and must not be executed.

Required-test identifiers are enumerated explicitly. Ranges and prose are not
used — that was `SPEC-0002/CONV-008`, and `tasks.md` there now forbids them.

## Task list

Five tasks, each defined in full below. Statuses: `TODO`, `IN_PROGRESS`,
`BLOCKED`, `DONE`, `DEFERRED`, `WITHDRAWN`.

---

## TASK-001

**Purpose:** Render the status region unconditionally and move the no-match
message inside it, so an assistive technology observes the region before its
content changes.
**Requirements:** `ACC-003`, `ACC-004`, `NFR-003`, decisions `AD-002`, `AD-003`,
`AD-006`.
**Acceptance criteria:** `AC-005`.
**Allowed scope:** `apps/web/src/components/workspace/TableSearch.tsx`.
**Prohibited paths:** `apps/web/src/app/`, `apps/web/src/components/ui/`,
`apps/web/package.json`, `apps/web/tests/`.
**Required tests:** `E2E-005`.
**Security implications:** none; presentational markup only.
**Definition of Done:** the region exists at first render and is empty with no
query; the count and the no-match message both render inside that one region;
the region uses the existing `.lf-visually-hidden` class so nothing moves on
screen; the two visible elements keep their positions and are `aria-hidden` so
the text is not presented twice; filtering behaviour is untouched; **no
`keydown` handler is added** (`FR-006`).
**Completion evidence:** `E2E-005` passing, recorded in a `VER-` record.

## TASK-002

**Status: `WITHDRAWN`** — `CL-001` resolved to option (c), Product Owner,
2026-09-08. New `Escape` behaviour is out of scope, so this task has no work.

Withdrawn with it: `FR-003`, `FR-004`, `AC-004`, `E2E-004`, `AD-004`.

The task is kept rather than deleted so the record shows it existed, was
blocked on a clarification, and was closed by the decision rather than by
being quietly dropped. **It must not be executed.** Its original definition is
preserved in git history and in `clarifications.md`.

## TASK-003

**Purpose:** Add the Playwright spec covering keyboard, focus, semantics and
regression.
**Requirements:** `FR-001`, `FR-002`, `FR-005`, `ACC-001`, `ACC-002`,
`ACC-005`, `ACC-006`.
**Acceptance criteria:** `AC-001`, `AC-002`, `AC-003`, `AC-006`, `AC-007`.
**Allowed scope:** a new Playwright spec under `apps/web/tests/e2e/`, named
`tablesearch-a11y` — the file does not exist yet and is created by this task.
**Prohibited paths:** `apps/web/src/`, `apps/web/package.json`, and the
Playwright and Vitest configuration files.
**Required tests:** `E2E-001`, `E2E-002`, `E2E-003`, `E2E-006`, `REG-001`,
`REG-002`.
**Security implications:** none. Synthetic interaction against seeded data; no
real personal data, no secret in the spec file.
**Definition of Done:** every listed case present and passing; the source file
is a prohibited path, so the tests cannot be made to pass by editing the
component.
**Completion evidence:** suite output recorded in a `VER-` record.

## TASK-004

**Purpose:** Run the verification stack and record what actually happened.
**Requirements:** `NFR-005`.
**Acceptance criteria:** none directly; this proves the others.
**Allowed scope:**
`specs/SPEC-0003-tablesearch-accessibility/`.
**Prohibited paths:** `apps/web/src/`, `apps/web/tests/`.
**Required tests:** `E2E-001`, `E2E-002`, `E2E-003`, `E2E-005`, `E2E-006`,
`REG-001`, `REG-002`.
**Security implications:** none.
**Definition of Done:** `npm run typecheck`, `npm run lint` and the Playwright
spec are run and their real results recorded, including failures and anything
environmental. **If the E2E harness cannot start, that is recorded as a
verification prerequisite and no `PASS` is claimed.**
**Completion evidence:** a `VER-` record naming commands and exit codes only.

## TASK-005

**Purpose:** Assemble the human code review and the convergence report.
**Requirements:** `NFR-002`, `NFR-004`, `DATA-001`, `FR-006` — each verified by
inspection of the diff and reported to the human reviewer.
**Acceptance criteria:** none directly.
**Allowed scope:**
`specs/SPEC-0003-tablesearch-accessibility/`.
**Prohibited paths:** `apps/web/`.
**Required tests:** none; this task delivers no code.
**Security implications:** none.
**Definition of Done:** a `REV-` record with `actorType: "human"` exists —
R2 requires 1 reviewer — and the convergence report is written with a
recommended verdict, using the template in `specs/templates/CONVERGENCE_TEMPLATE.md`. **An agent may recommend; it may not accept.**
**Completion evidence:** a `REV-` record and the convergence report.

---

## Scope discipline

Every task names a prohibited set as well as an allowed one, and the two are
chosen so no task can grade itself:

- Writing the tests (`TASK-003`) excludes the component under test.
- Changing the component (`TASK-001`, `TASK-002`) excludes the tests.
- Verification and review (`TASK-004`, `TASK-005`) touch neither.

Work that needs a file outside its allowed scope **stops and raises a change
record**. It does not widen the task. That is `SPEC-0002/CONV-012`, accepted as
a historical deviation on the explicit condition that it is not normalised.

## Test identifiers are enumerated, never abbreviated

Every `Required tests` line lists identifiers explicitly. No ranges, no prose —
the parser reads a range as its two endpoints and prose as nothing at all.

---

## TASK-006

**Purpose:** Make `E2E-006` establish the row count it needs instead of
depending on accumulated data, so `AC-007` is verified deterministically.

**Requirements:** `ACC-002`, decision `AD-001`.

**Allowed scope:** `apps/web/tests/e2e/tablesearch-a11y.spec.ts`.

**Prohibited paths:** `apps/web/src/`, `apps/web/package.json`,
`apps/web/playwright.config.ts`, `apps/web/vitest.config.mts`,
`apps/web/tests/e2e/helpers.ts`.

**Required tests:** `E2E-006`.

**Security implications:** none. The test creates synthetic departments in a
workspace it created itself, through an endpoint the product already exposes
and already permission-checks. No test-only route, no fixture file, no
elevated credential.

**Definition of Done:** `E2E-006` creates exactly `SEARCHABLE_FROM` rows
through an existing product endpoint, names that constant rather than
hard-coding an unexplained eight, and passes without depending on any row it
did not create; `TableSearch.tsx` is untouched.

**Completion evidence:** the Playwright suite re-run in full.

**Status:** `TODO`
