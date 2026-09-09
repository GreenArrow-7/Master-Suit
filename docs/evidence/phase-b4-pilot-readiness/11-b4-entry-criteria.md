# 11 — B4 entry criteria

**Phase:** B4.0 · **Date:** 2026-09-08

Conditions that must hold before any B4 implementation work begins.

## Status

| # | Criterion | State |
|---|---|---|
| 1 | B3 formally accepted | **SATISFIED** — `D10` ACCEPTED 2026-09-08 |
| 2 | `D10` accepted | **SATISFIED** — gate 6, reviewer role, recorded in `sdd.json` |
| 3 | B3 accepted risks carried forward | **SATISFIED** — all five, in `12` |
| 4 | First pilot selected by a human | **PENDING — BLOCKING** |
| 5 | Pilot risk classification confirmed | **PENDING — BLOCKING** if `PC-01`; the R3/R4 reading is a Solution Architect decision |
| 6 | Relevant runtime unknowns identified | **SATISFIED** — `03` |
| 7 | CI local configuration verified | **SATISFIED** — `02`, twelve properties |
| 8 | GitHub runtime status known or recorded UNKNOWN | **SATISFIED** — recorded `UNKNOWN — requires runtime/infrastructure verification` |
| 9 | Rollback approach defined | **SATISFIED** — code-only for all five, `07` |
| 10 | Test strategy feasible | **SATISFIED** — `07`; `PC-01` needs no browser, database or network |
| 11 | No prohibited first-pilot domain involved | **SATISFIED** — `08`, `09` |
| 12 | Required human roles identified | **SATISFIED** — below |
| 13 | Next SPEC ID known | **SATISFIED** — `SPEC-0003`, reserved not created |
| 14 | No implementation started early | **SATISFIED** — no application file touched |

**Two blocking items, both human decisions: #4 and #5.**

## Role readiness for the recommended pilot (R3)

Derived from `docs/sdd/RISK_TO_PROCESS_MATRIX.md` and
`docs/sdd/HUMAN_APPROVAL_GATES.md` at R3. Roles only — no people assigned.

| Role | Status at R3 | Basis |
|---|---|---|
| **Product Owner or Solution Architect** | **REQUIRED** — specification approval, gate 1, before implementation begins | `EVC-015` resolved to Option A by `D2` |
| **Solution Architect** | **REQUIRED** here for the R3/R4 reading. Architecture approval, gate 2, applies at R3 only "when a new pattern is introduced" — reusing an existing library is not one, so gate 2 is likely **NOT REQUIRED** for `PC-01`; the architect confirms | |
| **Implementer** | **REQUIRED** | the agent session |
| **Tester** | **REQUIRED** | verification record |
| **Qualified Human Code Reviewer** | **REQUIRED** — R3 requires 1 human reviewer | `AGENTS.md` §8 |
| **Convergence Reviewer** | **REQUIRED** — gate 6 at R3 is "reviewer" | |
| **Application Security** | **OPTIONAL** at R3, and advisable here | R3 security review is "self-check, flag anything touching authorization". `PC-01` touches none — but it is a security fix on a PII export, so a second opinion is worth having. **REQUIRED** outright if the reading goes to R4 |
| **QA / Release Engineering** | **NOT REQUIRED** at R3 | required at R4 and R5 |
| **DevOps / Production Engineering** | **NOT REQUIRED** — no infrastructure, deployment or migration | |

## R3-specific triggers, answered

| Trigger | Answer for `PC-01` |
|---|---|
| Specification approver required | **Yes** — Product Owner or Solution Architect, before implementation |
| Architecture approval trigger | **Probably not** — no new pattern, dependency or integration. Solution Architect confirms |
| Human code reviewer | **Yes** — one |
| Convergence reviewer | **Yes** — gate 6 |
| Security involvement | **Optional at R3**, mandatory if reclassified R4 |

## CI status and what it blocks

Derived from governance, not from convenience.

| Unknown | Blocking classification |
|---|---|
| GitHub-hosted SDD CI never run | **NON-BLOCKING FOR LOCAL PILOT DEVELOPMENT.** **BLOCKING BEFORE MERGE** — `AGENTS.md` §8 requires CI gates to pass, and a gate that has never run cannot be said to |
| Branch protection unverified | **BLOCKING BEFORE MERGE** — the control exists to gate merges |
| Required status check unverified | **BLOCKING BEFORE MERGE** |
| Backup capability (`EVC-005`) | **BLOCKING BEFORE RELEASE** |
| Deployment mechanism (`EVC-003`, `EVC-012`) | **BLOCKING BEFORE RELEASE** |

None of these blocks writing and verifying the pilot locally on a branch. All
bear on merging or releasing it, and the pilot must not be planned as though
they are resolved.

## Validation-exception policy for B4

`EXC-001` is **historical evidence only**. It excepts `SDD-V060` on `SPEC-0002`
alone and is recorded non-precedential.

**It must not be reused, extended, or cited as a template for B4.**

For the pilot: a new violation fails normally; any exception must be newly and
narrowly scoped; **no exception may be created merely to make a pilot pass**;
an AI may identify the need for one and may never approve one.

`SPEC-0003` in particular must obtain its specification approval **before**
implementation, so `SDD-V060` passes on the facts rather than by exception.
That is precisely what `SPEC-0002` could not do, and the pilot is the first
opportunity to do it properly.
