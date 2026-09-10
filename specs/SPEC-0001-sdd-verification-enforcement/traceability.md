# SPEC-0001 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Risk | `R3` |
| Last updated | 2026-09-07 |

## Matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-004` | `TASK-002` | `tools/sdd/lib/discover.mjs` | `UT-001`, `IT-001` | pass 2026-09-07 |
| `FR-002` | `AD-001` | `TASK-002` | `tools/sdd/lib/manifest.mjs` | `UT-002` | pass 2026-09-07 |
| `FR-003` | `AD-003` | `TASK-004` | `tools/sdd/lib/validate.mjs` | `IT-001`, `IT-002`, `IT-003`, `IT-006` | pass 2026-09-07 |
| `FR-004` | none | `TASK-004` | `tools/sdd/cli.mjs` | `IT-005`, `UT-003` | pass 2026-09-07 |
| `FR-005` | none | `TASK-004` | `tools/sdd/cli.mjs` | `UT-004`, `UT-005`, `UT-006` | pass 2026-09-07 |
| `FR-006` | `AD-006` | `TASK-004` | `tools/sdd/lib/validate.mjs` | `UT-003` | pass 2026-09-07 |
| `FR-007` | `AD-005` | `TASK-007` | `tools/sdd/lib/diff.mjs` | `IT-004` | pass 2026-09-07 |
| `FR-008` | none | `TASK-004` | `tools/sdd/cli.mjs` | `UT-007` | pass 2026-09-07 |
| `NFR-001` | `AD-002` | `TASK-002` | `tools/sdd/` | `AC-007` | pass 2026-09-07 |
| `NFR-002` | `AD-003` | `TASK-003` | `tools/sdd/lib/markdown.mjs` | full suite on Windows | pass 2026-09-07 |
| `NFR-003` | `AD-006` | `TASK-004` | `tools/sdd/lib/validate.mjs` | `UT-003` | pass 2026-09-07 |
| `NFR-004` | none | `TASK-011` | `tools/sdd/` | performance measurement | recorded 2026-09-07 |
| `SEC-001` | `AD-002` | `TASK-002` | `tools/sdd/lib/manifest.mjs` | `ST-002` | pass 2026-09-07 |
| `SEC-002` | `AD-004` | `TASK-002` | `tools/sdd/lib/discover.mjs` | `ST-001` | pass 2026-09-07 |
| `SEC-003` | none | `TASK-004` | `tools/sdd/lib/validate.mjs` | `ST-004` | pass 2026-09-07 |
| `SEC-004` | `AD-007` | `TASK-005` | `tools/sdd/lib/approvals.mjs` | `ST-005`, `ST-006` | pass 2026-09-07 |
| `SEC-005` | `AD-003` | `TASK-003` | `tools/sdd/lib/markdown.mjs` | `ST-003` | pass 2026-09-07 |
| `DATA-001` | none | `TASK-004` | `tools/sdd/` | `REG-001` | pass 2026-09-07 |
| `DATA-002` | `AD-004` | `TASK-002` | `tools/sdd/lib/discover.mjs` | `ST-001` | pass 2026-09-07 |
| `OBS-001` | none | `TASK-004` | `tools/sdd/rules/rules.mjs` | `UT-007` | pass 2026-09-07 |
| `OBS-002` | none | `TASK-004` | `tools/sdd/cli.mjs` | `UT-004`, `UT-005` | pass 2026-09-07 |

## Acceptance criteria

| Criterion | Requirements covered | Verified by | Result |
|---|---|---|---|
| `AC-001` | `FR-001`, `FR-002`, `FR-003` | `IT-001`, `IT-002`, `IT-003` | pass |
| `AC-002` | `FR-003`, `OBS-001` | invalid-fixture matrix | pass |
| `AC-003` | `SEC-004` | `ST-005` | pass |
| `AC-004` | `FR-005` | `UT-004`, `UT-005`, `UT-006` | pass |
| `AC-005` | `FR-006`, `NFR-003` | `UT-003` | pass |
| `AC-006` | all | `IT-005` | pass |
| `AC-007` | `NFR-001` | dependency check | pass |

## Security view

| Security requirement | Threat | Control | Security test | Result |
|---|---|---|---|---|
| `SEC-001` | `TH-002` | `CTRL-002` | `ST-002` | pass |
| `SEC-002` | `TH-001`, `TH-006` | `CTRL-001` | `ST-001` | pass |
| `SEC-003` | `TH-004` | `CTRL-004` | `ST-004` | pass |
| `SEC-004` | `TH-005` | `CTRL-005` | `ST-005`, `ST-006` | pass, residual risk accepted |
| `SEC-005` | `TH-003` | `CTRL-003` | `ST-003` | pass |

## Gap checks

| Check | Result |
|---|---|
| Every requirement has at least one task | yes |
| Every requirement has at least one test | yes |
| Every `SEC-` requirement has a security verification | yes, five of five |
| Every task cites a requirement or an approved technical rationale | yes, twelve of twelve |
| No implementation outside an approved task's allowed scope | yes; `.github/` was excluded by every task and remains untouched |
| No test asserts behaviour no requirement states | yes |
| Every acceptance criterion has a verification | yes, seven of seven |
| Every architecture change has an `AD-` | yes, eight decisions |
| Every threat has a control, or an accepted residual risk with an owner | yes; `TH-005` is accepted residual risk owned by Application Security |
| Every clarification decision reached the specification | yes, `CL-001` to `CL-005` all `INCORPORATED` |

## Notes

`NFR-004` has no pass or fail because `CL-004` decided against an invented
threshold. Its row records a measurement instead, which is the honest form.

`TASK-012` produced a CI workflow proposal rather than a workflow file, per
`CL-005`. The gate is named and open, not assumed.
