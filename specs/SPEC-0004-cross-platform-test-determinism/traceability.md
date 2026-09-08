# SPEC-0004 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0004` |
| Risk | `R2` |
| Date | 2026-09-08 |

R2 asks for light traceability: every requirement reaches a task and a test,
every acceptance criterion reaches a verification path.

## Requirement → acceptance criterion → test → task

| Requirement | Acceptance criterion | Test | Task | Result |
|---|---|---|---|---|
| `FR-001` | `AC-001` | `REG-001`, `REG-002`, `REG-003`, `ST-002` | `TASK-001` | pass 2026-09-08 |
| `FR-002` | `AC-002` | `REG-004` | `TASK-002` | pass 2026-09-08 |
| `FR-003` | `AC-003` | `REG-005` | `TASK-003` | pass 2026-09-08 (POSIX half skipped on Windows — `CONV-002`) |
| `FR-004` | `AC-004` | `IT-001`, `IT-006` | `TASK-004` | pass 2026-09-08, re-verified after seed parity |
| `FR-004` | `AC-004` | `IT-006` | `TASK-009` | pass 2026-09-08, empty catalogue re-proved |
| `FR-005` | `AC-005` | `IT-002` | `TASK-004` | pass 2026-09-08 — second run applies no migration, seed idempotent |
| `FR-006` | `AC-005` | `IT-003` | `TASK-004` | pass 2026-09-08 |
| `FR-007` | `AC-006` | `IT-004` | `TASK-005` | pass 2026-09-08 |
| `FR-008` | `AC-007` | `IT-005` | `TASK-008` | **pass 2026-09-08 — 5 of 5, three cold starts** |
| `NFR-006` | `AC-007` | `IT-005` | `TASK-008` | pass 2026-09-08 — no retry, sleep or raised timeout |
| `SEC-001` | `AC-003` | `ST-001`, `REG-005` | `TASK-003`, `TASK-007` | pass 2026-09-08 |
| `SEC-002` | `AC-001` | `ST-002` | `TASK-001`, `TASK-007` | pass 2026-09-08 |
| `NFR-001` | — | none — inspection of the manifest and lockfile | `TASK-006` | pass — 19 + 18, lockfile untouched |
| `NFR-002` | — | none — inspection of the diff | `TASK-007` | pass — no file under `apps/web/src/` |
| `NFR-003` | — | none — `check:drift` and the migrations directory | `TASK-007` | pass — no new migration |
| `NFR-004` | — | none — inspection of the diff and the command log | `TASK-007` | pass — loopback only |
| `NFR-005` | — | none — documentation secret scan | `TASK-007` | pass — scan clean |
| `DATA-001` | — | none — inspection of the diff | `TASK-007` | pass |

## Acceptance criterion → verification path

| Criterion | Verified by |
|---|---|
| `AC-001` | `REG-001`, `REG-002`, `REG-003`, `ST-002` |
| `AC-002` | `REG-004` |
| `AC-003` | `REG-005`, plus diff review that the assertion text is unchanged |
| `AC-004` | `IT-001` |
| `AC-005` | `IT-002`, `IT-003` |
| `AC-006` | `IT-004` |

## Failure → root cause → task

The 24 reproduced failures, and where each one goes.

| Failures | File | Root cause | Task |
|---|---|---|---|
| 5 | `apps/web/tests/unit/env-example-parses.spec.ts` | RC-1, CRLF | `TASK-001` |
| 11 | `apps/web/tests/security/assistant-guardrails.spec.ts` | RC-1, CRLF | `TASK-001` |
| 1 | `apps/web/tests/unit/observability.spec.ts` | RC-1, CRLF | `TASK-001` |
| 1 | `apps/web/tests/security/guarded-prologue.spec.ts` | RC-2, path separator | `TASK-002` |
| 2 | `apps/web/tests/unit/observability.spec.ts` | RC-3, POSIX file mode | `TASK-003` |
| **4** | `apps/web/tests/unit/capture-vault.spec.ts` | **RC-4, product defect** | **none — out of scope, `R4`** |

**20 of 24 are addressed here. The other 4 are deliberately not.**

## Gap checks

| Check | Result |
|---|---|
| Every requirement has a task | yes, 15 of 15 |
| Every task carries a status set from its own evidence | yes, 9 of 9 — all `DONE`; see the task-state history in `tasks.md` |
| No task claims `DONE` without a recorded result | yes — each `DONE` names its `VER-` record |
| Every requirement has a test or a stated inspection path | yes |
| Every acceptance criterion has a verification path | yes, 6 of 6 |
| Every security requirement has a security verification | yes — `SEC-001` by `ST-001`, `SEC-002` by `ST-002` |
| No orphan requirement or criterion | yes |
| Every task cites a requirement | yes, 9 of 9 |
| No test asserts behaviour no requirement states | yes |

## Where a test is deliberately absent

Six requirements state what the change **does not** do — no dependency, no
product file, no schema, no non-loopback contact, no secret, no data change.
Each is verified by inspecting the diff and is named here so it reaches the
reviewer rather than being quietly unverified.

## Correction carried from SPEC-0003

`SPEC-0003/CONV-011` recorded the 11 `assistant-guardrails` failures as drift
between the AI assistant's declared tool permissions and the models its tools
read. **Measurement here shows that was wrong**: with the correct delimiter
`searchLeads` reads exactly `prisma.lead`, and the broken extraction was
returning 39,757 characters of the file instead of a 2,752-character body.

The accepted risk on the closed pilot is **not** rewritten. The corrected root
cause is recorded here and in the readiness evidence as post-pilot remediation.
