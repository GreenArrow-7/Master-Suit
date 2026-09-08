# SPEC-0002 — Traceability

| Field | Value |
|---|---|
| Specification | `SPEC-0002` |
| Risk | `R3` |
| Last updated | 2026-09-07 |

## Matrix

| Requirement | Plan decision | Task | Code | Test | Result |
|---|---|---|---|---|---|
| `FR-001` | `AD-001` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `UT-001`, `IT-001` | pass 2026-09-07 |
| `FR-002` | `AD-002` | `TASK-002` | `tools/sdd/lib/agent.mjs` | `UT-002`, `IT-002` | pass 2026-09-07 |
| `FR-003` | `AD-001` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `UT-003` | pass 2026-09-07 |
| `FR-004` | `AD-003` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `IT-005`, `ST-001` | pass 2026-09-07 |
| `FR-005` | `AD-003` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `ST-002`, `ST-003` | pass 2026-09-07 |
| `FR-006` | `AD-004` | `TASK-006` | `tools/sdd/lib/agent.mjs` | `ST-006` | pass 2026-09-07 |
| `FR-007` | `AD-002` | `TASK-005` | `tools/sdd/lib/agent.mjs` | `IT-006` | pass 2026-09-07 |
| `FR-008` | `AD-005` | `TASK-005` | `tools/sdd/lib/agent.mjs` | `IT-003`, `IT-007` | pass 2026-09-07 |
| `FR-009` | `AD-006` | `TASK-003` | `tools/sdd/rules/rules.mjs` | `UT-006` | pass 2026-09-07 |
| `FR-010` | `AD-001` | `TASK-007` | `tools/sdd/cli.mjs` | `UT-004` | pass 2026-09-07 |
| `NFR-001` | `AD-001` | `TASK-007` | `tools/sdd/` | dependency check | pass 2026-09-07 |
| `NFR-002` | `AD-003` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `UT-007` | pass 2026-09-07 |
| `NFR-003` | `AD-001` | `TASK-007` | `tools/sdd/cli.mjs` | `UT-005` | pass 2026-09-07 |
| `NFR-004` | `AD-001` | `TASK-007` | `tools/sdd/cli.mjs` | `IT-008` | pass 2026-09-07 |
| `SEC-001` | `AD-007` | `TASK-006` | `tools/sdd/lib/agent.mjs` | `ST-007` | pass 2026-09-07 |
| `SEC-002` | `AD-003` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `ST-002`, `ST-003` | pass 2026-09-07 |
| `SEC-003` | `AD-007` | `TASK-006` | `tools/sdd/lib/agent.mjs` | `ST-007` | pass 2026-09-07 |
| `SEC-004` | `AD-005` | `TASK-005` | `tools/sdd/lib/agent.mjs` | `ST-004`, `IT-004` | pass 2026-09-07 |
| `SEC-005` | `AD-005` | `TASK-005` | `tools/sdd/lib/agent.mjs` | `ST-005`, `ST-001` | pass 2026-09-07 |
| `SEC-006` | `AD-002` | `TASK-005` | `tools/sdd/lib/agent.mjs` | `ST-008` | pass 2026-09-07 |
| `DATA-001` | `AD-002` | `TASK-007` | `tools/sdd/` | `REG-001` | pass 2026-09-07 |
| `DATA-002` | `AD-003` | `TASK-004` | `tools/sdd/lib/agent.mjs` | `ST-008` | pass 2026-09-07 |
| `OBS-001` | `AD-006` | `TASK-003` | `tools/sdd/rules/rules.mjs` | `UT-006` | pass 2026-09-07 |
| `OBS-002` | `AD-002` | `TASK-002` | `tools/sdd/lib/agent.mjs` | `IT-002` | pass 2026-09-07 |

## Acceptance criteria

| Criterion | Requirements covered | Verified by | Result |
|---|---|---|---|
| `AC-001` | `FR-001`, `FR-003` | `UT-001`, `UT-003`, invalid-fixture matrix | pass |
| `AC-002` | `FR-004` | `ST-001` | pass |
| `AC-003` | `FR-005`, `SEC-002` | `ST-002`, `ST-003` | pass |
| `AC-004` | `SEC-004` | `ST-004` | pass |
| `AC-005` | `SEC-005` | `ST-005` | pass |
| `AC-006` | `FR-006` | `ST-006` | pass |
| `AC-007` | `NFR-004` | `IT-008` | pass |
| `AC-008` | all | `validate --spec SPEC-0002` | pass |

## Security view

| Security requirement | Threat | Control | Security test | Result |
|---|---|---|---|---|
| `SEC-001` | `TH-005` | `CTRL-005` | `ST-007` | pass |
| `SEC-002` | `TH-002` | `CTRL-002` | `ST-002`, `ST-003` | pass |
| `SEC-003` | `TH-005` | `CTRL-005` | `ST-007` | pass |
| `SEC-004` | `TH-003` | `CTRL-003` | `ST-004` | pass, residual risk open |
| `SEC-005` | `TH-001`, `TH-007` | `CTRL-001`, `CTRL-007` | `ST-001`, `ST-005` | pass, residual risk open |
| `SEC-006` | `TH-004`, `TH-006` | `CTRL-004`, `CTRL-006` | `ST-006`, `ST-008` | pass |

## Remediation trace (CHG-001)

Each finding is traced from where it was found to where it was closed. The
original finding is never edited away; it is marked resolved and keeps its
history.

| Finding | Found by | Task | Session | Verification | Independent review | Status |
|---|---|---|---|---|---|---|
| `CONV-006` | `ASES-0001` | `TASK-011` | `ASES-0002` | `VER-0002` | `REV-0002` | RESOLVED |
| `CONV-007` | `ASES-0001` | `TASK-012` | `ASES-0003` | `VER-0003` | `REV-0003` | RESOLVED |
| `CONV-008` | `ASES-0003` | `CHG-003` | — | `taskScope` re-parse, all 12 tasks | `REV-0003` | RESOLVED |
| `CONV-009` | `ASES-0003` | — | — | — | `REV-0003` | OPEN, awaiting risk acceptance |
| `CONV-010` | governance closure | `D8` Option A | — | `specs/templates/CONVERGENCE_TEMPLATE.md` documents the interpretation | — | RESOLVED |

## Human governance decisions (2026-09-08)

| Decision | Role | Outcome | Finding closed | Evidence |
|---|---|---|---|---|
| `D1` | Product Owner or Solution Architect | APPROVE | `CONV-004` RESOLVED | `sdd.json` gate `specification` |
| `D2` | Solution Architect | Option A | see the register for `EVC-015` | six normative documents corrected |
| `D3` | Solution Architect | APPROVE | — | `sdd.json` gate `architecture` |
| `D4` | Application Security | ACCEPT | `CONV-001` ACCEPTED_RISK | `sdd.json` gate `security` |
| `D5` | Product Owner | ACCEPT | `CONV-003` ACCEPTED_RISK | `sdd.json` gate `residualRisk` |
| `D6` | DevOps / Production Engineering | REQUIRE REMEDIATION | `CONV-005` RESOLVED | `CHG-004`, `TASK-013`, `ASES-0004`, `VER-0004`, `REV-0005` |
| `D7` | Product Owner | ACCEPT | `CONV-009` ACCEPTED_RISK | `sdd.json` gate `residualRisk` |
| `D8` | QA / Release Engineering | Option A | `CONV-010` RESOLVED | `specs/templates/CONVERGENCE_TEMPLATE.md` |
| `D9` | Qualified Human Code Reviewer | APPROVE | — | `REV-0004`, actorType human |
| `D10` | reviewer | **not taken** | — | withheld by the decider |

| Requirement | Task | Test | Result |
|---|---|---|---|
| `OBS-001`, `NFR-004` | `TASK-013` | `IT-008` | pass |

| Requirement | Task | Test | Result |
|---|---|---|---|
| `SEC-001`, `SEC-003` | `TASK-011` | `ST-002`, `ST-009` | pass |
| `FR-004`, `FR-006`, `NFR-002` | `TASK-012` | `UT-008` to `UT-017` | pass |

Independent review separation holds across all three sessions: the
implementers are `b3-implementer-session`, `b3-remediation-allowlist` and
`b3-remediation-attribution`; verification is `b3-remediation-tester`; review
is `b3-independent-reviewer`. No actor reviewed its own work
(`SDD-V051`).

## Gap checks

| Check | Result |
|---|---|
| Every requirement has at least one task | yes, 24 of 24 |
| Every added test has a result | yes, `ST-009` and `UT-008` to `UT-017` all pass |
| Every requirement has at least one test | yes |
| Every `SEC-` requirement has a security verification | yes, six of six |
| Every task cites a requirement or an approved decision | yes, thirteen of thirteen |
| No implementation outside an approved task's allowed scope | `TASK-007` onward machine-checked; `TASK-001`–`TASK-006` predate the checker, see the bootstrap note |
| Every convergence finding has a disposition | yes: four resolved, six `OPEN` each naming the role that must decide. **No finding is `ACCEPTED_RISK`**, because no human has accepted one |
| Every required test identifier resolves deterministically | yes, all twelve tasks re-parsed after `CHG-003` |
| No test asserts behaviour no requirement states | yes |
| Every acceptance criterion has a verification | yes, eight of eight |
| Every architecture change has an `AD-` | yes, seven decisions |
| Every threat has a control, or an accepted residual risk with an owner | every threat has a control; **three residual risks have no accepted owner** because the Application Security gate is unresolved |
| Every clarification decision reached the specification | yes, `CL-001` to `CL-005` all `INCORPORATED` |

## Notes

Two gap checks are deliberately not clean, and neither is papered over.

The scope check cannot cover `TASK-001` to `TASK-006`, because those tasks
built the checker. Their declarations are honest records, not enforced ones.

Three residual security risks are recorded with no accepting owner, because no
Application Security approval exists for this phase. They are carried as open
rather than self-accepted.

`CHG-001` added `TASK-011` and `TASK-012` after `ASES-0001` found two defects
it was not authorised to fix. Both are now closed, each through its own task,
its own session, its own verification and an independent review by a distinct
actor. `ASES-0001` was not reopened and its `PARTIAL` result stands: it is the
record of what that session actually produced, and rewriting it would destroy
the evidence that the control worked.
