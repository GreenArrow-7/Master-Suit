# Phase B4.1 — Summary

> **SUPERSEDED, 2026-09-08.** This document records the state at the end of
> B4.1, when the pilot was **blocked** at the clarification gate and no
> application code had been changed. The human answered `CL-001`, `CL-002` and
> the specification approval later the same day, and the pilot then ran to
> verification.
>
> **For the current state read
> `06-pilot-execution-record.md`.** This file is kept unedited below because it
> is the honest record of the stop — including the two ways around it that were
> available and declined.

| Field | Value |
|---|---|
| Phase | B4.1 — First controlled product pilot specification |
| Pilot | `PC-02`, human-selected in B4.0 |
| Specification | `SPEC-0003` — TableSearch keyboard and screen-reader accessibility |
| Date | 2026-09-08 |
| Outcome | **Specification complete. Implementation blocked at a human gate.** |
| Application code changed | **None** |

---

## What was produced

`specs/SPEC-0003-tablesearch-accessibility/` — seven artefacts, validating
clean:

| Artefact | Content |
|---|---|
| `spec.md` | 17 requirements (`FR-001..005`, `NFR-001..005`, `DATA-001`, `ACC-001..006`), 7 acceptance criteria |
| `clarifications.md` | 7 questions resolved from repository evidence, 2 left open as product decisions |
| `plan.md` | 5 technical decisions, `AD-001..005` |
| `test-plan.md` | 8 cases — `E2E-001..006`, `REG-001..002` — plus 5 requirements named as verified without an automated test |
| `tasks.md` | 5 tasks with disjoint allowed and prohibited scopes |
| `traceability.md` | requirement to task to test |
| `sdd.json` | manifest, `R2`, status `CLARIFYING`, `approvals` empty |

`threat-model.md`, `convergence.md` and `change-record.md` were deliberately
**not** created. The `R2` row of `docs/sdd/RISK_TO_PROCESS_MATRIX.md` requires
the first only if security-sensitive (it is not), and the other two only later
in the lifecycle. Creating them early to look complete would be artefact
theatre.

**`SPEC-0003` has no validation exception.** Verified explicitly:
`docs/sdd/validation-exceptions.json` holds only `EXC-001`, scoped to
`SDD-V060` on `SPEC-0002`.

## What was not done, and why

**No application code was changed. No test was written. No session was
opened. Preflight was not run.**

Implementation is blocked — and not by an approval gate. `R2` requires no
separate implementation-readiness approval, which was the first thing checked.

The blocker is that `CL-001` and `CL-002` are `OPEN` and both are material.
Three governing documents independently forbid implementing in that state:

- `docs/sdd/CHANGE_WORKFLOW.md`, STOP condition 1
- `AGENTS.md` — "Stop before implementing ... when a material clarification is open"
- `docs/sdd/SPEC_LIFECYCLE.md` — entry to `APPROVED_FOR_IMPLEMENTATION` requires material clarifications resolved

Full analysis, including the two narrower readings that would have permitted
proceeding and why each was rejected:
`01-pre-implementation-stop-check.md`.

### The two readings that were rejected

1. **"`TASK-001` isn't blocked, only `TASK-002` is."** True at task level, but
   the rule is written at specification level. Reading a task-level qualifier
   into it, precisely where it bites, to unblock myself, is rule-weakening by
   interpretation.

2. **"Descope `Escape` and `CL-001` dissolves."** Possibly the right
   engineering answer — which is why it is offered to the Product Owner as an
   option. An agent taking it unilaterally to unblock itself is the same
   defect in different clothing.

## One correction made

`SPEC-0003` was recorded as `READY_FOR_APPROVAL`. It has been corrected
**down** to `CLARIFYING`.

`docs/sdd/SPEC_LIFECYCLE.md` gives `READY_FOR_APPROVAL` the entry criterion
"Open questions that are material are closed", and two material questions are
open. `CLARIFYING` is the honest position; `tools/sdd/lib/lifecycle.mjs`
permits the transition. This is a downgrade and cannot be read as progress.

## Verification actually run

| Check | Result |
|---|---|
| B2 validator suite | **89 / 89 PASS** |
| B3 agent suite | **48 / 48 PASS** |
| `validate --all` | **PASS** — 0 errors, 0 warnings |
| `SPEC-0001` / `SPEC-0002` / `SPEC-0003` | **PASS** |

`npm run typecheck`, `npm run lint` and the Playwright suite were **not** run.
No application code changed, so there was nothing for them to verify.

## Environment finding, recorded in advance

Docker is installed but **no container is running**, and the application is not
running. The Playwright harness needs both, plus a seeded database, and runs
`workers: 1` against one shared database.

**When the pilot does proceed, its E2E cases can be written but not run until
that harness is started, and must be recorded as `UNKNOWN — requires
runtime/infrastructure verification`.** Stated now so it is not later mistaken
for a pilot failure. No suite was run and no result is claimed.

## Repository safety

| Constraint | Status |
|---|---|
| Application code | unchanged |
| Pre-existing user work (34 modified files) | **untouched** — not stashed, reset, reverted or edited |
| Commits, pushes, merges, tags, releases | none |
| Dependencies, lockfiles, CI | unchanged |
| Prisma schema, migrations, database | untouched |
| Production, staging | not accessed |
| `.env` | present, **never read, printed or referenced by value** |
| `PC-01` CSV code | not touched |
| `EVC-016` | not resolved |

## What is waiting for a human

**Three decisions, one sitting** —
`02-decision-packet-spec-0003.md`:

| # | Decision | Owner |
|---|---|---|
| 1 | `CL-001` — what should `Escape` do? | Product Owner |
| 2 | `CL-002` — add a visible clear button? | Product Owner |
| 3 | Gate 1 specification approval, given the author is an AI | any competent human |

**Separately, not blocking this pilot** —
`03-decision-packet-evc-016.md`: whether export formatting of
already-authorised PII is an `R4` trigger. Solution Architect, with
Application Security consulted. Decides `PC-01`.

Once decisions 1 to 3 are recorded, the pilot runs to convergence with two
further human touchpoints that cannot be delegated: **human code review**
(`R2` requires 1 reviewer; an AI review will be labelled an AI review) and
**convergence acceptance**.

## Single next action

Read `02-decision-packet-spec-0003.md` and answer `CL-001` and `CL-002`.
