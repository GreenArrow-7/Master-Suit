# SDD-V064 — historical scope declarations, review and strategy

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Warnings | **7**, across 5 tasks in 2 specifications |
| Classification | **7 HISTORICAL_RECORD · 0 ACTIVE_DEFECT · 0 REQUIRES_CORRECTION · 0 OBSOLETE** |
| Blocking pilot #2 | **No** |
| Records rewritten | **none** |

---

## The seven

| Specification | Task | Task status | Spec status | Warnings | Declaration |
|---|---|---|---|---|---|
| `SPEC-0001` | `TASK-008` | `DONE` | `CONVERGED` | 1 | a glob, `tools/sdd/tests/**` |
| `SPEC-0001` | `TASK-010` | `DONE` | `CONVERGED` | 1 | a brace expansion |
| `SPEC-0001` | `TASK-011` | `DONE` | `CONVERGED` | 1 | wholly prose |
| `SPEC-0001` | `TASK-012` | `DONE` | `CONVERGED` | 1 | prose citing `CHG-001` |
| `SPEC-0003` | `TASK-003` | — | `CONVERGED` | 3 | prose plus a non-path token, and a prose prohibition |

## Can any of them authorise new work? — measured, not assumed

The question that matters is not how many warnings there are. It is whether any
of these declarations could still let a session start. Preflight was run against
each:

| Task | Preflight | Blocking rules |
|---|---|---|
| `SPEC-0001/TASK-008` | **FAIL** | `SDD-V043`, `SDD-V045`, `SDD-V057`, `SDD-V062` |
| `SPEC-0001/TASK-010` | **FAIL** | `SDD-V043`, `SDD-V057`, `SDD-V062` |
| `SPEC-0001/TASK-011` | **FAIL** | `SDD-V043`, `SDD-V045`, `SDD-V057`, `SDD-V062` |
| `SPEC-0001/TASK-012` | **FAIL** | `SDD-V043`, `SDD-V057`, `SDD-V062` |
| `SPEC-0003/TASK-003` | **FAIL** | `SDD-V043`, `SDD-V062` |

**Every one is blocked by at least two independent controls:**

- `SDD-V043` — both specifications are `CONVERGED`, and `IMPLEMENTER` may act
  only at `APPROVED_FOR_IMPLEMENTATION` or `IMPLEMENTING`.
- `SDD-V062` — the malformed declaration itself refuses preflight.

So no malformed declaration can authorise new execution, and that is enforced
by the tooling rather than by anyone remembering.

## Classification

All seven are **`HISTORICAL_RECORD`**.

**None is `ACTIVE_DEFECT`**, on the measured ground above: the defect cannot
authorise work.

**None is `OBSOLETE`** — each task really ran, and its declaration is live
evidence of what was authorised at the time.

**None `REQUIRES_CORRECTION`.** Correcting them would state, retroactively, a
boundary that was never enforced. `SPEC-0001/TASK-008` is the clearest case:
its glob matched nothing, so its effective allowed set was **empty** and the
session that delivered the test suite was measured against nothing. Writing
`tools/sdd/tests/` there now would assert a control that did not exist.

`SPEC-0003/TASK-003` is `DONE` and its session `ASES-0002` recorded
`allowedPaths: ['apps/web/tests/e2e/', 'tablesearch-a11y']` at creation.
Rewriting the task would put it out of step with the record that measured it.

Full per-task reasoning: `docs/evidence/phase-b4-pilot/10-historical-scope-declarations.md`.

## Why no validation exception was raised

An approved exception downgrades a finding to `INFO` with an
`EXCEPTED under EXC-NNN` prefix — **less visible than a standing `WARNING`**.
There is nothing here expected to change, so there would be no expiry to review
either. Manufacturing exceptions to reach zero warnings would reduce visibility
while pretending to improve it.

`SDD-V064` is `WARNING` for the same reason.

## Strategy so pilot #2 does not inherit this

1. **New tasks cannot repeat it.** `SDD-V062` is an `ERROR` at preflight, so a
   malformed declaration blocks its own session before any work begins. This is
   already proven in practice — it caught `SPEC-0004/TASK-004`'s first draft
   during this very pass, and the declaration was restructured rather than the
   rule softened.
2. **The seven stay visible.** They appear on every `validate --all` run and
   are not suppressed.
3. **Reopening carries a condition.** If any of these five tasks is ever
   reopened, its declaration must be corrected *before* a session is created —
   and preflight enforces that automatically rather than relying on anyone
   remembering.
4. **The grammar is documented** in `docs/sdd/VALIDATION_RULES.md`, so an
   author writing a new task knows what a scope declaration must look like:
   backticked paths or directory prefixes, no globs, no prose.

## Bearing on pilot #2

**Not blocking.** The prerequisite was a *"review/correction strategy"*, and
this is it: reviewed, classified, measured against the actual authorisation
path, with a documented strategy and an enforced control. Nothing was rewritten
and nothing was suppressed.
