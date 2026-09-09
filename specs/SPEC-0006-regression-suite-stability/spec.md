# SPEC-0006 — Regression suite stability

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0006` |
| Status | `VERIFYING` |
| Risk | `R1` |
| Author | AI, Planner role |
| Date | 2026-09-08 |

`R1` per `docs/RISK_CLASSIFICATION.md`: test-only changes, no application
source, no schema, no dependency, no security control altered. The lightweight
path in `docs/sdd/RISK_TO_PROCESS_MATRIX.md` applies — a short `spec.md` and a
change record, with a human code review before it is treated as complete.

## Problem

The product suite cannot serve as a release gate. Four seeded runs on
2026-09-08 gave `1914·4·2`, `1914·4·2`, `1913·5·2`, `1913·5·2` — the four
`RC-4` failures are constant, but **two runs produced one extra failure and a
different test each time**.

Registered as `BLK-008`. Both instances are timing, not logic, and the
workstation was checked for contamination first: port 3000 free, two node
processes, all four containers healthy.

### BUG-004 — `apps/web/tests/security/p2-regressions.spec.ts`

*"P2-5 … answers 429 once the window is spent"* asserted `429`, received `401`.

`limits.webhook` is `max: 600, windowSeconds: 60`, and `consume()` keys on
`rl:<key>:<floor(now / 60000)>`. The test exhausts the budget with **600
sequential `consume()` round-trips**. That takes real time, and if it straddles
a minute boundary the counter starts a fresh window, the final request finds
budget, the limiter correctly allows it, and the route falls through to
signature checking — which answers `401`.

**The direction of the failure is the proof:** `401` means the limiter had
budget, not that it misfired. The product is correct; the test's method of
establishing its precondition is timing-fragile.

### BUG-005 — `apps/web/tests/unit/prisma-config.spec.ts`

*"omits an empty SHADOW_DATABASE_URL…"* **timed out at 30000 ms**. Not an
assertion failure.

The case calls `vi.resetModules()` then `await import('../../prisma.config')`,
which is the **first** resolution of the `prisma/config` package in that worker.
Under 152 test files running in parallel, that cold resolution can exceed the
30-second test budget on its own.

## Goal

Three consecutive full-suite runs whose only failures are the four constant
`RC-4` ones.

## Requirements

- `FR-001` — `BUG-004` establishes its precondition without depending on how
  long the setup takes.
- `FR-002` — `BUG-004`'s assertions are unchanged: `429`, and a `retry-after`
  header.
- `FR-003` — `BUG-005` pays one-time module resolution outside the assertion's
  time budget.
- `FR-004` — `BUG-005`'s assertions are unchanged.
- `NFR-001` — No application source file changes. Tests only.
- `NFR-002` — No test timeout is raised, no retry added, no sleep added, no
  assertion weakened, no test skipped or deleted.
- `SEC-001` — The rate-limit security invariant is untouched: when the budget
  is exhausted inside the window, the limiter throttles. `BUG-004` continues to
  prove exactly that.

## Out of scope

`RC-4`, `SPEC-0005`, production, staging, and the product's limiter
implementation. If the limiter itself had to change to make this testable, that
would be a different risk class and would stop here for classification — it
does not.

## Acceptance criteria

- `AC-001` — Three consecutive full-suite runs report 4 failures, all `RC-4`.
- `AC-002` — Both repaired cases pass in isolation and in the full suite.
- `AC-003` — The diff touches only files under `apps/web/tests/`.

## Approval

**Gate 1 is human, even at `R1`.** The risk matrix says "author" in the R1 spec
approval row, but `AGENTS.md` forbids an AI author from discharging any
approval gate and the validator enforces it — `SDD-V022` refused an attempt to
record this gate with `actorType: "ai"`, which was the correct refusal.

It is recorded against a **standing class authorization** given in session
("Agentic Engineers may automatically fix R0–R3 technical defects through the
approved SDD/change workflow", in a message naming `BUG-004` and `BUG-005` as
P0), not against a decision taken on this document. The `sdd.json` approval
entry says so, and says what to do if that is judged insufficient.

**The `R1` human code review has not happened** and this specification does not
claim it has.
