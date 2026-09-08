# SPEC-0004 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0004` |
| Risk | `R2` |
| Date | 2026-09-08 |

Runner: `npm test` (vitest) in `apps/web`, plus the two new bootstrap commands.

## The primary evidence is the existing suite

**Twenty tests currently fail and must pass while asserting exactly what they
assert today.** They are the acceptance evidence, so no new test is written to
replace them. Writing a fresh test that passes would prove nothing about the
twenty.

| Test ID | Type | Requirements | Purpose |
|---|---|---|---|
| `REG-001` | REG | `FR-001` | The 5 `env-example-parses` cases pass; every example file still parses against the schema and still declares every required variable |
| `REG-002` | REG | `FR-001`, `SEC-002` | The 11 `assistant-guardrails` cases pass, and each tool's model list is derived from its **own body** |
| `REG-003` | REG | `FR-001` | The `observability` byte-identical comparison passes |
| `REG-004` | REG | `FR-002` | `guarded-prologue` recognises both exempt routes and reports no hand-rolled prologue |
| `REG-005` | REG | `FR-003`, `SEC-001` | The two POSIX-mode assertions are skipped with a stated reason on Windows and unchanged elsewhere |
| `ST-001` | ST | `SEC-001` | Every assertion in the two touched security test files still proves the same invariant: the tool-permission check and the hand-rolled-prologue check both fail when their condition is violated |
| `ST-002` | ST | `SEC-002` | `bodyOf()` returns a bounded body, not the rest of the file: the extracted length is far below the file length, and `searchLeads` resolves to exactly `['lead']` |
| `IT-001` | IT | `FR-004` | `db:test:prepare` on an unprepared local database leaves it existing with migrations applied |
| `IT-002` | IT | `FR-005` | `db:test:prepare` run a second time succeeds and the database stays usable |
| `IT-003` | IT | `FR-006` | `db:test:prepare` performs no destructive action; reset is a separate named command |
| `IT-004` | IT | `FR-007` | No repository statement claims `npm run setup` prepares `master_saas_test` |
| `IT-006` | IT | `FR-004` | The full suite against a freshly reset database reports the same counts as against a warm one, apart from the four `RC-4` failures |
| `IT-005` | IT | `FR-008`, `NFR-006` | Five consecutive Playwright runs pass, and the remedy is a readiness condition rather than a retry, sleep or raised timeout |

`ST-002` is the guard that matters. Without it, a future regression in the
delimiter would silently restore the vacuous behaviour — the 11 cases would
pass again for the wrong reason, because a body containing everything satisfies
nothing.

## Requirements verified without an automated test

| Requirement | Verification method | Owner |
|---|---|---|
| `NFR-001` | No new entry in the manifest or lockfile | `TASK-007` |
| `NFR-002` | Diff review: no file under `apps/web/src/` changed | `TASK-007` |
| `NFR-003` | `npm run check:drift`; no new migration directory | `TASK-007` |
| `NFR-004` | Diff review and command log: loopback hosts only | `TASK-007` |
| `NFR-005` | Documentation secret scan | `TASK-007` |

| `DATA-001` | Diff review: no product code, no schema | `TASK-007` |

## What a passing run must not mean

A green suite obtained by loosening an assertion is a failure of this
specification, not a success. `SEC-001` and the `TASK-007` review exist to
check that specifically: every modified assertion is compared against its
original and must still prove the same property.

## Environment prerequisites

| Requirement | Evidence level |
|---|---|
| Local PostgreSQL on loopback | **VERIFIED** — every compose port binds `127.0.0.1` |
| `.env.test` with a migration role | **VERIFIED** — read 2026-09-08 |
| Existing migrations present | **VERIFIED** — 65 in `prisma/migrations` |

**No secret value is read, printed or referenced anywhere in this
specification.** `.env.test` is named as a requirement only.

## Out of scope for testing

The four `capture-vault` failures. They are a product defect classified `R4`
and are not remediated here.
