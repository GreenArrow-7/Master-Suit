# SPEC-0007 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

**Code and Result are filled in from evidence.** They were deliberately empty
while nothing was built; leaving them empty now would be the opposite error.
`Result` records the outcome of the named test on the run of 2026-09-09.

`FR-017` is carried by `TASK-009` (`CHG-003`, approved) and `TASK-010`
(`CHG-004`, **raised and not approved**). Its tests pass, and that is a
statement about the code, not about the requirement conflict: `CHG-004`
recorded that the address contradicted `DATA-005` as originally approved.
The Product Owner approved `CHG-004` on 2026-09-09, `DATA-005` is amended to
exempt exactly that one address, and `UT-013` enforces the narrowness of the
exemption so it cannot widen without failing a test.

## Requirement matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-001`, `AD-002` | `TASK-001` | seed/hr.ts | `UT-001` | PASS |
| `FR-002` | `AD-002`, `AD-009` | `TASK-001` | seed/hr.ts | `UT-001` | PASS |
| `FR-003` | `AD-009` | `TASK-001` | seed/hr.ts | `UT-002` | PASS |
| `FR-004` | `AD-004` | `TASK-002` | seed/hr.ts | `UT-009`, `IT-001` | PASS |
| `FR-005` | `AD-004` | `TASK-002` | seed/hr.ts | `IT-001` | PASS |
| `FR-006` | `AD-004` | `TASK-002` | seed/hr.ts | `UT-003`, `IT-007` | PASS |
| `FR-007` | `AD-004` | `TASK-002` | seed/hr.ts | `UT-003`, `UT-009` | PASS |
| `FR-008` | `AD-004` | `TASK-002` | seed/hr.ts | `IT-007`, `E2E-005` | PASS |
| `FR-009` | `AD-009` | `TASK-005` | audit only — no change | `REG-001`, `E2E-002` | PASS |
| `FR-010` | `AD-009` | `TASK-006` | seed/index.ts | `IT-006`, `IT-007`, `IT-008` | PASS |
| `FR-011` | `AD-005` | `TASK-004`, `TASK-012` | seed/index.ts | `IT-005`, `REG-002`, `UT-015` | PASS |
| `FR-012` | `AD-005` | `TASK-004`, `TASK-012` | seed/index.ts | `IT-003`, `IT-010`, `UT-015` | PASS |
| `FR-013` | `AD-004`, `AD-005` | `TASK-002`, `TASK-004` | seed/hr.ts, seed/crm.ts | `IT-002`, `IT-004` | PASS |
| `FR-014` | `AD-003` | `TASK-001` | seed/hr.ts | `UT-008` | PASS |
| `FR-015` | `AD-007`, `AD-008` | `TASK-003` | tests/hr/demo-reset-coverage.spec.ts | `UT-007` | PASS |
| `FR-016` | — | `TASK-008`, `TASK-011` | docs/DEMO.md, seed/index.ts | `UT-011`, `UT-014` | PASS |
| `FR-017` | — | `TASK-009`, `TASK-010` | seed/index.ts, docs/DEMO.md | `E2E-006`, `ST-012`, `ST-013`, `ST-014`, `ST-015`, `ST-016`, `UT-012` | PASS |
| `NFR-001` | `AD-002` | `TASK-001` | seed/hr.ts | dependency count at verification | PASS |
| `NFR-002` | `AD-003` | `TASK-007` | seed/hr.ts | `E2E-001` on both supported hosts | PASS |
| `NFR-003` | — | `TASK-002` | seed/hr.ts | `IT-001` reports duration; threshold deferred by `CL-005` | PASS |
| `NFR-004` | `AD-004` | `TASK-002` | seed/hr.ts | `IT-001` | PASS |
| `SEC-001` | `AD-005` | `TASK-004` | seed/index.ts (unchanged) | `ST-006` | PASS |
| `SEC-002` | `AD-005` | `TASK-004` | seed/index.ts (unchanged) | `ST-007` | PASS |
| `SEC-003` | `AD-009` | `TASK-006` | unchanged controls | `ST-003`, `ST-005` | PASS |
| `SEC-004` | — | `TASK-006` | unchanged controls | `ST-001`, `ST-002` | PASS |
| `SEC-005` | — | `TASK-006` | unchanged controls | `ST-003`, `ST-004` | PASS |
| `SEC-006` | `AD-006` | `TASK-006` | environment config | `ST-008`, `ST-009` | PASS |
| `SEC-007` | — | `TASK-006`, `TASK-008` | seed/index.ts | `ST-011` | PASS |
| `DATA-001` | `AD-006` | `TASK-001` | seed/hr.ts | `UT-004` | PASS |
| `DATA-002` | — | `TASK-002` | seed/hr.ts | `UT-005` | PASS |
| `DATA-003` | — | `TASK-002` | seed/hr.ts | `UT-005` | PASS |
| `DATA-004` | — | `TASK-001` | seed/hr.ts | `UT-006` | PASS |
| `DATA-005` | `AD-006` | `TASK-006`, `TASK-011` | seed/index.ts, seed/crm.ts | `UT-004`, `ST-008`, `UT-013` | PASS |
| `OBS-001` | — | `TASK-004` | seed/hr.ts | `IT-001` | PASS |
| `OBS-002` | `AD-005` | `TASK-004` | seed/index.ts | `ST-006`, `ST-007` | PASS |

## Acceptance-criterion matrix

| Criterion | Requirements covered | Verified by |
|---|---|---|
| `AC-001` | `FR-001` to `FR-008` | `UT-001`, `UT-002`, `UT-003`, `IT-007`, `E2E-003`, `E2E-005` |
| `AC-002` | `FR-009` | `REG-001`, `E2E-002` |
| `AC-003` | `FR-010`, `SEC-003` | `IT-006`, `IT-007`, `IT-008`, `ST-004` |
| `AC-004` | `FR-011`, `FR-012`, `FR-013` | `IT-003`, `IT-005`, `IT-010`, `E2E-004` |
| `AC-005` | `FR-014` | `UT-008` |
| `AC-006` | `FR-015` | `UT-007` |
| `AC-007` | `SEC-001`, `SEC-002` | `ST-006`, `ST-007` |
| `AC-008` | `SEC-004` | `ST-001`, `ST-002` |
| `AC-009` | `SEC-005` | `ST-003`, `ST-004` |
| `AC-010` | `SEC-006` | `ST-008`, `ST-009` |
| `AC-011` | `DATA-001` to `DATA-005` | `UT-004`, `UT-005`, `UT-006` |
| `AC-012` | `SEC-007` | `ST-011` |
| `AC-013` | `OBS-001`, `OBS-002` | `IT-001`, `ST-006`, `ST-007` |
| `AC-014` | `NFR-001` to `NFR-004` | `IT-001`, `E2E-001` on both hosts, dependency count |
| `AC-015` | `FR-016` | `UT-011` |

## Threat matrix

| Threat | Control | Task | Test | Result |
|---|---|---|---|---|
| `TH-001` | `CTRL-001` | `TASK-006` | `ST-001`, `ST-002` | — |
| `TH-002` | `CTRL-001` | `TASK-006` | `ST-001` | — |
| `TH-003` | `CTRL-002` | `TASK-006` | `ST-003`, `ST-004` | — |
| `TH-004` | `CTRL-002` | `TASK-006` | `ST-003` | — |
| `TH-005` | `CTRL-003` | `TASK-006` | `ST-005` | — |
| `TH-006` | `CTRL-004` | `TASK-004` | `ST-006`, `ST-007` | — |
| `TH-007` | `CTRL-005` | `TASK-003` | `UT-007` | — |
| `TH-008` | `CTRL-006`, `CTRL-007` | `TASK-006` | `ST-008` | — |
| `TH-009` | `CTRL-007` | `TASK-006` | `ST-009` | — |
| `TH-010` | `CTRL-008`, `CTRL-009` | `TASK-001` | `UT-004`, `UT-006` | — |
| `TH-011` | `CTRL-008` | `TASK-002` | `UT-005` | — |
| `TH-012` | `CTRL-010`, `CTRL-011` | `TASK-006` | `ST-010` | — |
| `TH-013` | `CTRL-011` | `TASK-006` | `ST-011` | — |
| `TH-014` | `CTRL-002` | `TASK-007` | `E2E-004` | — |
| `TH-015` | `CTRL-012` | — | accepted residual; carried to `SPEC-0008` | — |

## Clarification disposition

| Clarification | State | Where its answer lands |
|---|---|---|
| `CL-001` | resolved | `FR-010`, `SEC-003` |
| `CL-002` | resolved | `FR-009`, `TASK-005` |
| `CL-003` | resolved | `FR-011`, `FR-015`, `AD-005`, `AD-007` |
| `CL-004` | resolved | payroll excluded by Product Owner decision; recorded in the walkthrough |
| `CL-005` | resolved | 45 working days; model-supported attendance statuses only |
| `CL-006` | resolved | `DATA-005`, `AD-006` |
