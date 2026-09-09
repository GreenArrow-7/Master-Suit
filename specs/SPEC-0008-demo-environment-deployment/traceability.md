# SPEC-0008 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Last updated | 2026-09-08 |

**The Code and Result columns are empty on purpose.** Nothing is built, nothing
is provisioned, and no gate is discharged. An entry in either column would be a
fabrication.

## Requirement matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-001`, `AD-002` | `TASK-001` | — | `IT-001`, `E2E-001` | — |
| `FR-002` | `AD-002` | `TASK-001` | — | `IT-001`, `IT-002` | — |
| `FR-003` | `AD-001` | `TASK-001` | — | `IT-003` | — |
| `FR-004` | `AD-003` | `TASK-003` | — | `UT-001`, `REG-001` | — |
| `FR-005` | `AD-007` | `TASK-004` | — | `ST-003` | — |
| `FR-006` | `AD-004` | `TASK-004` | — | `ST-006`, `E2E-001` | — |
| `FR-007` | `AD-001` | `TASK-002` | — | `IT-007`, `ST-009` | — |
| `FR-008` | `AD-006` | `TASK-005` | — | `IT-006` | — |
| `FR-009` | `AD-009` | `TASK-006` | — | `IT-001`, `IT-005` | — |
| `FR-010` | `AD-009` | `TASK-006` | — | `IT-005` | — |
| `FR-011` | `AD-005`, `AD-009` | `TASK-003` | — | `IT-004` | — |
| `FR-012` | `AD-007` | `TASK-004` | — | `ST-008` | — |
| `FR-013` | `AD-011`, `AD-017` | `TASK-009` | — | `UT-004` | — |
| `FR-014` | `AD-010`, `AD-011` | `TASK-009` | — | `REG-002`, `OPS-012` | — |
| `FR-015` | `AD-013` | `TASK-010` | — | `OPS-010`, `OPS-011` | — |
| `FR-016` | `AD-012`, `AD-014` | `TASK-010` | — | `UT-002`, `UT-003` | — |
| `FR-017` | `AD-011` | `TASK-011` | — | `UT-005`, `OPS-013` | — |
| `FR-018` | `AD-015` | `TASK-012` | — | `OPS-014` | — |
| `FR-019` | `AD-018` | `TASK-013` | — | `UT-006` | — |
| `FR-020` | `AD-017` | `TASK-013` | — | `ST-017` | — |
| `DATA-004` | `AD-016`, `AD-018` | `TASK-012` | — | `ST-014`, `ST-016` | — |
| `DATA-005` | `AD-015` | `TASK-012` | — | `ST-015` | — |
| `SEC-009` | `AD-016` | `TASK-011` | — | `ST-013` | — |
| `OBS-004` | `AD-013`, `AD-014` | `TASK-010` | — | `OPS-010` | — |
| `OBS-005` | `AD-014` | `TASK-010` | — | `OPS-015` | — |
| `FR-021` | `AD-022` | `TASK-014` | — | `OPS-016`, `OPS-017` | — |
| `FR-022` | `AD-023` | `TASK-015` | — | `OPS-018` | — |
| `FR-023` | `AD-024` | `TASK-015` | — | `OPS-019`, `ST-018` | — |
| `NFR-001` | `AD-001` | `TASK-001` | — | `IT-003` | — |
| `NFR-002` | `AD-009` | `TASK-006` | — | `IT-001`, `IT-005`; threshold deferred by `CL-003` | — |
| `NFR-003` | `AD-008` | `TASK-006` | — | `IT-007`, `ST-011` | — |
| `NFR-004` | — | `TASK-005` | — | `IT-007` | — |
| `SEC-001` | `AD-007` | `TASK-004` | — | `ST-003` | — |
| `SEC-002` | `AD-001` | `TASK-001` | — | `ST-001`, `ST-002`, `ST-005` | — |
| `SEC-003` | `AD-002` | `TASK-001` | — | `IT-002`, `ST-002` | — |
| `SEC-004` | `AD-004` | `TASK-004` | — | `ST-006` | — |
| `SEC-005` | `AD-003` | `TASK-003` | — | `ST-004`, `REG-001` | — |
| `SEC-006` | `AD-001` | `TASK-002` | — | `ST-009` | — |
| `SEC-007` | `AD-007` | `TASK-004` | — | `ST-008` | — |
| `SEC-008` | `AD-001` | `TASK-002` | — | `ST-005` | — |
| `DATA-001` | `AD-004` | `TASK-004` | — | `ST-007` | — |
| `DATA-002` | `AD-005` | `TASK-006` | — | `ST-007`, `ST-010` | — |
| `DATA-003` | `AD-009` | `TASK-006` | — | `IT-005` | — |
| `OBS-001` | `AD-006` | `TASK-005` | — | `IT-006`, `ST-012` | — |
| `OBS-002` | `AD-003` | `TASK-003` | — | `IT-004` | — |
| `OBS-003` | `AD-002` | `TASK-001` | — | `IT-002` | — |

## Acceptance-criterion matrix

| Criterion | Requirements covered | Verified by |
|---|---|---|
| `AC-001` | `FR-001`, `FR-002`, `FR-007` | `IT-001`, `IT-007`, `ST-009` |
| `AC-002` | `FR-003`, `FR-005`, `NFR-001`, `SEC-001`, `SEC-002` | `IT-003`, `ST-001`, `ST-003`, `ST-005` |
| `AC-003` | `FR-004`, `FR-011`, `SEC-005`, `OBS-002` | `UT-001`, `REG-001`, `IT-004`, `ST-004` |
| `AC-004` | `FR-006`, `SEC-004` | `ST-006`, `E2E-001` |
| `AC-005` | `SEC-003`, `OBS-003` | `IT-002`, `ST-002` |
| `AC-006` | `FR-008`, `OBS-001` | `IT-006`, `ST-012` |
| `AC-007` | `FR-009`, `FR-010`, `DATA-003`, `NFR-002` | `IT-001`, `IT-005` |
| `AC-008` | `DATA-001`, `DATA-002` | `ST-007`, `ST-010` |
| `AC-009` | `FR-012`, `SEC-007` | `ST-008` |
| `AC-010` | `NFR-003`, `NFR-004`, `SEC-006`, `SEC-008` | `IT-007`, `ST-009`, `ST-011`, `ST-005` |
| `AC-011` | `FR-015`, `OBS-004` | `OPS-010`, `OPS-011` |
| `AC-012` | `FR-016` | `UT-002`, `UT-003` |
| `AC-013` | `FR-014` | `OPS-012`, `REG-002` |
| `AC-014` | `FR-017` | `OPS-013`, `UT-005` |
| `AC-015` | `DATA-005` | `ST-015` |
| `AC-016` | `FR-018` | `OPS-014` |
| `AC-017` | `SEC-009` | `ST-013`, `UT-005` |
| `AC-018` | `DATA-004` | `ST-016`, `ST-014` |
| `AC-019` | `FR-016` | `UT-007`, `UT-008` |
| `AC-020` | `FR-021` | `OPS-016` |
| `AC-021` | `FR-022` | `OPS-018` |
| `AC-022` | `FR-023` | `OPS-019`, `ST-018` |

## Threat matrix

| Threat | Control | Task | Test | Result |
|---|---|---|---|---|
| `TH-001` | `CTRL-001`, `CTRL-002` | `TASK-001` | `ST-001`, `ST-002` | — |
| `TH-002` | `CTRL-003` | `TASK-004` | `ST-003` | — |
| `TH-003` | `CTRL-004`, `CTRL-005` | `TASK-003` | `ST-004`, `REG-001` | — |
| `TH-004` | `CTRL-002` | `TASK-001` | `ST-005` | — |
| `TH-005` | `CTRL-006`, `CTRL-007` | `TASK-004` | `ST-006`, `E2E-001` | — |
| `TH-006` | `CTRL-008` | `TASK-006` | `ST-007` | — |
| `TH-007` | `CTRL-002`, `CTRL-009` | `TASK-002` | `ST-005` | — |
| `TH-008` | `CTRL-010` | `TASK-004` | `ST-008` | — |
| `TH-009` | `CTRL-011` | `TASK-002` | `ST-009` | — |
| `TH-010` | `CTRL-012` | `TASK-006` | `ST-010` | — |
| `TH-011` | `CTRL-013` | `TASK-006` | `ST-011` | — |
| `TH-012` | `CTRL-014` | — | verified in `SPEC-0007`, not duplicated | — |
| `TH-013` | `CTRL-015` | `TASK-005` | `ST-012` | — |

## Clarification disposition

| Clarification | State | Where its answer lands |
|---|---|---|
| `CL-001` | open, blocks provisioning | `TASK-001` |
| `CL-002` | open, blocks provisioning | `TASK-002`, `SEC-008` |
| `CL-003` | open, default recorded | `NFR-002` |
| `CL-004` | resolved | `AD-005`, `DATA-002` |
| `CL-005` | resolved — Option C | `SEC-009`, `AD-016`, `TASK-011` |
| `CL-006` | open | `OBS-005`, `AD-014` |


## Cross-specification dependency

| Direction | Reference | Nature |
|---|---|---|
| depends on | `SPEC-0007` | supplies the data and personas this environment exists to demonstrate; `TASK-008` requires it converged |
| does not depend on | `SPEC-0007` | provisioning and every security case here are independent of it |
