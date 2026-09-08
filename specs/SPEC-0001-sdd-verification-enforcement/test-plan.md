# SPEC-0001 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Author | Solution Architect |
| Date | 2026-09-07 |

Runner: `node --test tools/sdd/tests/` — Node's built-in test runner, no new
dependency. Fixtures are synthetic and contain no real data.

## Cases

| Test ID | Type | Requirements | Purpose | Expected outcome |
|---|---|---|---|---|
| `UT-001` | UT | `FR-001` | Discovery finds every fixture specification directory and ignores non-spec directories | Correct set discovered |
| `UT-002` | UT | `FR-002` | Manifest parsing accepts a valid manifest | Parsed object |
| `UT-003` | UT | `FR-006`, `NFR-003` | Two consecutive JSON runs are byte-identical | Identical output |
| `UT-004` | UT | `FR-005` | Exit code 0 on clean input | 0 |
| `UT-005` | UT | `FR-005` | Exit code 1 when an ERROR finding exists | 1 |
| `UT-006` | UT | `FR-005` | Exit code 2 on a missing specs root | 2 |
| `UT-007` | UT | `OBS-001` | Every finding carries a known rule identifier | No bare strings |
| `IT-001` | IT | `FR-001`, `FR-003` | Valid R1 lightweight fixture validates clean | 0 errors |
| `IT-002` | IT | `FR-003` | Valid R2 fixture validates clean | 0 errors |
| `IT-003` | IT | `FR-003` | Valid R4 fixture with threat model, human approval and security tests validates clean | 0 errors |
| `IT-004` | IT | `FR-007` | Diff-aware mode reports association or UNKNOWN, never a guess | Warning, not error |
| `IT-005` | IT | `AC-006` | This specification validates clean | 0 errors |
| `IT-006` | IT | `FR-003` | The repository's real SDD artefacts validate clean | 0 errors |
| `ST-001` | ST | `SEC-002` | A manifest artefact path escaping the directory is rejected | `SDD-V008` ERROR, no read outside root |
| `ST-002` | ST | `SEC-001` | The tool contains no dynamic execution construct | Static scan finds none |
| `ST-003` | ST | `SEC-005` | A pathological line does not cause catastrophic backtracking | Completes promptly |
| `ST-004` | ST | `SEC-003` | A fixture containing a synthetic secret-shaped string does not have it echoed into findings | String absent from output |
| `ST-005` | ST | `SEC-004` | An R4 approval with `actorType: "ai"` fails | `SDD-V022` ERROR |
| `ST-006` | ST | `SEC-004` | An R4 specification with no implementation approval fails | `SDD-V020` ERROR |
| `REG-001` | REG | `DATA-001` | The validator writes nothing: repository file set and hashes unchanged after a run | No modification |

## Invalid-fixture matrix

Each fixture is built to trigger one specific rule. The test asserts the run
fails **and** that the expected rule identifier is present.

| Fixture | Expected rule |
|---|---|
| `bad-directory-name` | `SDD-V001` |
| `id-mismatch` | `SDD-V002` |
| `duplicate-spec-id` | `SDD-V003` |
| `malformed-manifest` | `SDD-V004` |
| `unsupported-schema-version` | `SDD-V005` |
| `unknown-risk` | `SDD-V006` |
| `unknown-status` | `SDD-V007` |
| `missing-artifact-file` | `SDD-V008` |
| `path-traversal-artifact` | `SDD-V008` |
| `missing-required-artifact-r3` | `SDD-V009` |
| `spec-manifest-id-disagree` | `SDD-V011` |
| `spec-manifest-risk-disagree` | `SDD-V012` |
| `spec-manifest-status-disagree` | `SDD-V013` |
| `duplicate-requirement-id` | `SDD-V014` |
| `broken-qualified-reference` | `SDD-V016` |
| `open-clarification-while-implementing` | `SDD-V017` |
| `illegal-lifecycle-transition` | `SDD-V018` |
| `status-history-mismatch` | `SDD-V019` |
| `r4-missing-implementation-approval` | `SDD-V020` |
| `r4-ai-approval` | `SDD-V022` |
| `r4-missing-threat-model` | `SDD-V023` |
| `missing-test-plan` | `SDD-V024` |
| `task-without-requirement` | `SDD-V026` |
| `requirement-without-test` | `SDD-V027` |
| `security-requirement-without-security-test` | `SDD-V028` |
| `traceability-phantom-reference` | `SDD-V030` |
| `converged-with-open-finding` | `SDD-V032` |
| `invalid-convergence-verdict` | `SDD-V033` |
| `released-without-approval` | `SDD-V034` |
| `invalid-evc-reference` | `SDD-V035` |
| `duplicate-change-record-id` | `SDD-V037` |
| `r0-with-spec-directory` | `SDD-V039` |

## Coverage sections

**Happy paths** — `IT-001` through `IT-003`, one per representative risk
level.

**Negative behaviour** — the invalid-fixture matrix, 32 cases.

**Authorization** — not applicable; the validator has no actors or
permissions. It validates *records about* approval, covered by `ST-005` and
`ST-006`.

**Tenant isolation** — not applicable; no tenant data is involved.

**Failure paths** — `UT-006` for a missing root, malformed manifest for a
parse failure that must be a finding rather than a crash.

**Malformed input** — `malformed-manifest`, `ST-003` for a pathological line.

**Boundary conditions** — an empty specs root, a directory that is not a
specification, a manifest with unknown extra fields.

**Concurrency** — not applicable; single process, read-only.

**Retries and idempotency** — `UT-003` and `REG-001` together establish that
repeated runs are identical and side-effect free.

**External dependency failure** — not applicable; no network, no service.

**Regression coverage** — `REG-001`, pinning the read-only property, which is
the behaviour most damaging to lose silently.

## Requirement coverage

| Requirement | Tests |
|---|---|
| `FR-001` | `UT-001`, `IT-001` |
| `FR-002` | `UT-002`, invalid manifest fixtures |
| `FR-003` | `IT-001`–`IT-003`, `IT-006`, invalid-fixture matrix |
| `FR-004` | `IT-005`, `UT-003` |
| `FR-005` | `UT-004`, `UT-005`, `UT-006` |
| `FR-006` | `UT-003` |
| `FR-007` | `IT-004` |
| `FR-008` | `UT-007` |
| `NFR-001` | `AC-007`, verified by dependency check |
| `NFR-002` | Full suite run on Windows; CI would run it on Linux |
| `NFR-003` | `UT-003` |
| `NFR-004` | Performance measurement, recorded not asserted |
| `SEC-001` | `ST-002` |
| `SEC-002` | `ST-001` |
| `SEC-003` | `ST-004` |
| `SEC-004` | `ST-005`, `ST-006` |
| `SEC-005` | `ST-003` |
| `DATA-001` | `REG-001` |
| `DATA-002` | `ST-001` |
| `OBS-001` | `UT-007` |
| `OBS-002` | `UT-004`, `UT-005` |

Every requirement has at least one test. Every `SEC-` requirement has a `ST-`
security test, as `docs/sdd/TRACEABILITY_STANDARD.md` requires.

## Execution record

Filled in during `VERIFYING`; results are recorded in
`docs/evidence/phase-b2-sdd-verification-enforcement/validator-test-results.md`.
