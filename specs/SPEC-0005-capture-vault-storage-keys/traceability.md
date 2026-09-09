# SPEC-0005 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Last updated | 2026-09-08 |

**The Code and Result columns are empty on purpose.** No implementation exists.
An entry in either would be a fabrication, and the validator's file checks are
not a reason to invent one.

## Matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-001`, `AD-002` | `TASK-001` | — | `UT-001`, `IT-001`, `REG-001` | — |
| `FR-002` | `AD-001` | `TASK-001` | — | `UT-002` | — |
| `FR-003` | `AD-002` | `TASK-001` | — | `UT-001` | — |
| `FR-004` | `AD-005` | `TASK-001`, `TASK-003` | — | `UT-004`, `ST-001` | — |
| `FR-005` | `AD-005` | `TASK-003`, `TASK-004` | — | `UT-006`, `ST-001`, `IT-006` | — |
| `FR-006` | `AD-002` | `TASK-001` | — | `UT-003`, `ST-003` | — |
| `FR-007` | `AD-007` | `TASK-002` | — | `IT-004`, `REG-005` | — |
| `FR-008` | `AD-007` | `TASK-002` | — | `IT-004`, `REG-005` | — |
| `FR-009` | `AD-006`, `AD-007` | `TASK-002` | — | `REG-005`, `REG-006` | — |
| `FR-010` | `AD-007` | `TASK-003` | — | `ST-002` | — |
| `FR-011` | `AD-003` | `TASK-002` | — | `IT-002`, `IT-003`, `REG-002`, `REG-003`, `REG-004` | — |
| `FR-012` | `AD-003`, `AD-006` | `TASK-002` | — | `UT-005`, `REG-006` | — |
| `NFR-001` | `AD-006` | `TASK-001` | — | `npm run check:drift` | — |
| `NFR-002` | `AD-006` | `TASK-001` | — | `npm run check:drift` | — |
| `NFR-003` | — | `TASK-001` | — | dependency counts at verification | — |
| `NFR-004` | — | `TASK-001`, `TASK-002` | — | `IT-001`, `IT-005` | — |
| `NFR-005` | — | all | — | no test contacts a non-loopback host | — |
| `SEC-001` | `AD-004`, `AD-005` | `TASK-003` | — | `ST-001`, `ST-004`, `UT-006` | — |
| `SEC-002` | `AD-007` | `TASK-003` | — | `ST-002` | — |
| `SEC-003` | `AD-002` | `TASK-003` | — | `ST-003` | — |
| `SEC-004` | `AD-004` | `TASK-002`, `TASK-003` | — | `ST-001`, `ST-004` | — |
| `SEC-005` | — | `TASK-004` | — | `ST-005` | — |
| `DATA-001` | — | all | — | no case uses a real capture | — |
| `DATA-002` | `AD-006` | `TASK-002` | — | `REG-006` | — |
| `OBS-001` | — | `TASK-004` | — | `IT-006`, `ST-005` | — |

## Acceptance criteria

| Criterion | Requirements covered | Verified by | Result |
|---|---|---|---|
| `AC-001` | `FR-001`, `FR-002`, `FR-003` | `UT-001`, `UT-002` | — |
| `AC-002` | `FR-001`, `FR-007` | `IT-001` | — |
| `AC-003` | `FR-011`, `FR-012`, `DATA-002` | `IT-002`, `IT-003`, `REG-006` | — |
| `AC-004` | `FR-004`, `FR-005`, `SEC-001`, `SEC-003` | `ST-001`, `ST-003`, `ST-004` | — |
| `AC-005` | `FR-011`, `OBS-001` | `IT-003`, `IT-005`, `IT-006` | — |
| `AC-006` | `FR-001`, `FR-011` | `REG-001`–`REG-004` | **before-half recorded**: all four fail against current code, 2026-09-08 |

`AC-006` is the only row carrying a result, and it is the *failing* half. The
four cases were run against the unmodified code and failed; that is evidence
this specification is about a real defect, not evidence of progress against it.

## Security view

| Security requirement | Threat | Control | Security test | Result |
|---|---|---|---|---|
| `SEC-001` | `TH-003`, `TH-005`, `TH-006`, `TH-007`, `TH-009`, `TH-010` | refuse an absolute, traversing, drive-relative or UNC key before resolution | `ST-001`, `ST-004`, `UT-006` | — |
| `SEC-002` | `TH-003`, `TH-011` | the existing capture-root containment check, kept unchanged | `ST-002` | — |
| `SEC-003` | `TH-008` | tenant-first shard order, uncrossable by separator or encoding | `ST-003` | — |
| `SEC-004` | `TH-003`, `TH-009` | compatible reading normalises separators only, and normalises before validating | `ST-001`, `ST-004` | — |
| `SEC-005` | `TH-015` | reason logged, key never | `ST-005` | — |

Threats with no `SEC-` requirement, and why:

| Threat | Handled by |
|---|---|
| `TH-001`, `TH-002` | `FR-011` plus `OBS-001` — the functional fix and its visibility, not a security control |
| `TH-004` | `FR-001`, `FR-012` |
| `TH-012` | **unhandled by this change.** Extent is `UNKNOWN — requires runtime/infrastructure verification`; `CL-001` |
| `TH-013` | `AD-003`'s ordering — compatibility before composition |
| `TH-014` | `OBS-001` and `IT-006`; alerting is out of scope and stated as residual |

## Gap checks

| Check | Result |
|---|---|
| Every requirement has at least one task | **YES** — 25 of 25 |
| Every requirement has at least one test | **YES** |
| Every `SEC-` requirement has a security verification | **YES** — `ST-001` to `ST-005` |
| Every task cites a requirement or an approved technical rationale | **YES** |
| No implementation outside an approved task's allowed scope | **YES, trivially** — there is no implementation |
| No test asserts behaviour no requirement states | **YES** |
| Every acceptance criterion has a verification | **YES** — 6 of 6 |
| Every architecture change has an `AD-` | **YES** — `AD-001` to `AD-007` |
| Every threat is handled or explicitly carried as residual | **YES** — 15 of 15 |
| Every task is authorised to begin | **NO** — all six are `BLOCKED`; gates 1, 3 and 5 are `UNRESOLVED` and `CL-001`/`CL-002` are open |

The last row is the honest state of this specification. Everything that could
be done without a human decision has been done; nothing that needs one has been
assumed.
