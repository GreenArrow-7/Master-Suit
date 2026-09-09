# SPEC-0005 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | **R4** |
| Prepared by | AI agent, CONVERGENCE_REVIEWER perspective |
| Date | 2026-09-08 |
| Recommended verdict | **`PASS WITH ACCEPTED LIMITATIONS`** |
| Accepted by | **Application Security and QA / Release Engineering, gate 6, 2026-09-08** |

**The engineering is complete and the defect is fixed.** All four `RC-4`
failures pass, the product suite is at **zero failures across three consecutive
runs**, and no security control was weakened.

**All four `R4` human gates are now discharged**: two code reviews
(`REV-0002`, `REV-0003`), the `CONV-003` residual-risk acceptance, and gate-6
convergence acceptance by both required roles.

**One accepted limitation stands**, and it is deliberately not called resolved:
`CONV-003`, the residual orphan-on-storage-failure path, is `ACCEPTED_RISK`
with a named human owner. The condition still exists; what changed is that the
system no longer reports success when it happens.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | **PASS** — `FR-001`–`FR-012`, `NFR-001`–`005`, `SEC-001`–`005`, `DATA-001`/`002`, `OBS-001` |
| 2 | Every acceptance criterion is verified | **PASS** — `AC-001` to `AC-006` |
| 3 | Every security requirement is verified by a security test | **PASS** — `ST-001`, `ST-002`, `ST-003`, `ST-005` |
| 4 | All required tests pass; failures are explained | **PASS** — 22 of 22; product suite 0 failed ×3 |
| 5 | No task left `TODO`, `IN_PROGRESS` or `BLOCKED` without a decision | **PASS** — see task states below |
| 6 | No behaviour was implemented that no requirement asked for | **PASS** |
| 7 | No undocumented architecture change | **PASS** — the architecture is the one gate 2 approved |
| 8 | No undocumented dependency change | **PASS** — none added |
| 9 | Migration matches the plan; no unplanned schema divergence | **PASS** — no migration, no schema change, re-verified after implementation |
| 10 | Documentation updated where this change made it untrue | **PASS** — the file's own contract comment now matches what it does |
| 11 | No new evidence conflict introduced, or it is registered | **PASS** — `EVC-016` untouched; `CL-003` raised |
| 12 | Known limitations recorded with owners | **PASS** — `CL-001` deferred, `CL-003` deferred, both with owners |
| 13 | Residual risk recorded and accepted by the right role | **PASS** — `CONV-003` `ACCEPTED_RISK`, accepted by Application Security; gate 6 accepted by AppSec and QA / Release |
| 14 | Rollback is written down and feasible | **PASS** — code-only revert; no unreadable state left behind |
| 15 | The applicable items of `AGENTS.md` §8 hold | **PASS** — two human code reviews recorded, `REV-0002` and `REV-0003` |

## Findings

### CONV-001

**Check:** 15
**Finding:** `R4` requires **two human code reviewers, one security-literate**.
Neither has reviewed this.
**Evidence:** `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, R4 row. `REV-0001` is an AI
review and carries `satisfiesHumanGate: false`.
**Resolution, 2026-09-08:** both reviews performed and recorded.

| Record | Role | Decision | Gate |
|---|---|---|---|
| `REV-0002` | Qualified Human Code Reviewer | `APPROVE` | `actorType: human`, `satisfiesHumanGate: true` |
| `REV-0003` | Security-Literate Qualified Human Code Reviewer | `APPROVE` | `actorType: human`, `satisfiesHumanGate: true` |

`REV-0003` examined `CONV-003` explicitly, as the security-literate slot
requires.

**One thing a later auditor should see rather than discover.** Both reviews
carry the same `actorId`. R4 asks for two reviewers, one security-literate;
whether one person may hold both slots is a question for the standard, and it
is recorded here plainly instead of being smoothed over.

**Status:** `RESOLVED` · **Owner:** —

### CONV-002

**Check:** 13
**Finding:** `R4` convergence acceptance requires **Application Security for
every security finding, plus QA / Release Engineering**. Not done.
**Evidence:** `docs/sdd/HUMAN_APPROVAL_GATES.md`, gate 6, R4 row.
**Resolution, 2026-09-08:** both acceptances given.

| Role | Decision |
|---|---|
| Application Security | **`ACCEPT`** |
| QA / Release Engineering | **`ACCEPT`** |

**Accepted verdict:** `PASS WITH ACCEPTED LIMITATIONS`.

**What was acknowledged in accepting:** RC-4 implementation complete;
capture-vault 28 of 28; three consecutive full-suite runs with zero failures;
the two Windows POSIX skips separately proved passing on Linux; two human code
reviews approved; `CONV-003` accepted as a residual risk; schema unchanged; no
migration; **and no production deployment included in this acceptance**.

**Status:** `RESOLVED` · **Owner:** —

### CONV-003

**Check:** 12
**Finding:** orphan prevention is improved but not complete.
`deleteCapture` no longer reports a storage failure as a completed cleanup, so
the caller can tell. `apps/web/src/lib/jobs/retention.ts` still deletes the
punch row in its catch block, so a permanently unreachable object still ends
with the row gone — now with an error logged where there was previously
silence.
**Does it violate an approved `SPEC-0005` requirement? NO.** Checked against
the requirement set rather than asserted:

| Requirement | Covers the caller's row deletion? |
|---|---|
| `FR-001`–`FR-012` | no — key composition, resolution, refusal, and not rewriting rows |
| `SEC-001`–`SEC-005` | no |
| `DATA-001`, `DATA-002` | no |
| `OBS-001` | **satisfied** — the refusal is logged and carries no key material |
| `AC-005` | **satisfied** — the sweep resolves the same captures plus backslash keys |
| `TASK-004` Definition of Done | **satisfied on all three clauses**: a countable logged refusal carrying no key material, a caller that can tell nothing was deleted, and the retention job unmodified |

The gate-3 invariant reads *"must not silently result in the system
representing retention cleanup as successful **where the approved product
contract requires successful deletion**"*. At the vault layer that contract is
met — the failure is no longer silent. What the *caller* then does with the row
is not a contract `SPEC-0005` defines.

**No additional code fix is required for this specification.**

**Why it is still a finding.** `TH-001` and `TH-002` are this specification's
own threats, and this change mitigates them substantially without eliminating
the orphan-on-storage-failure path. That is a residual risk of this change, so
it takes the canonical pre-acceptance status and waits for the role authorised
to accept it — **not** `NOT_APPLICABLE`, which would claim it falls outside
this convergence, and **not** `ACCEPTED_RISK`, which would claim someone has
already accepted it.

**Why it is not fixed here:** `apps/web/src/lib/jobs/retention.ts` is a
prohibited path for every task in this specification, deliberately. Changing
when a data-destroying sweep deletes a row is a different decision from fixing
how a key is composed, and it is carried as `CL-003`.
**DECISION — ACCEPT RISK.** Application Security, 2026-09-08.

**Rationale as given:** the vault layer now reports storage deletion failures
correctly. The remaining concern is caller behaviour after receiving a
vault-layer failure, which is outside the approved `SPEC-0005` behavioural
contract and violates no existing `FR-`, `NFR-`, `SEC-` or `AC-` requirement.

**Residual condition, acknowledged rather than dissolved:** a permanently
unreachable object still ends with the punch row deleted — now with an error
logged where there was previously silence. The encrypted capture can still be
orphaned; what changed is that the system no longer claims otherwise.

**Release impact:** none on this specification's convergence. This acceptance
explicitly does **not** waive production backup and restore, production RLS
verification, staging, rollback, or the final production deployment approval.

**Scope of acceptance:** the residual cross-system consistency risk between
`deleteCapture` and its callers. It does not extend to any other finding, and
`CL-003` remains the open question about whether the retention sweep should
keep the row.

**Not labelled `RESOLVED`**, because the residual condition still exists.

**Status:** `ACCEPTED_RISK`
**Owner:** Application Security (human, decision transcribed by an agent)

### CONV-004

**Check:** 5
**Finding:** one scope deviation. `apps/web/tests/unit/capture-vault.spec.ts`
was edited during `ASES-0001`, whose task (`TASK-002`) allows the source file
only.
**Evidence:** `SDD-V046` reported it; `ASES-0001` is marked `PARTIAL` and its
notes record it.
**Impact:** none on correctness — the file is `TASK-005` scope and `TASK-005`
now owns it. The boundary was crossed while getting the source change green.
**Does it block the human code review? NO.** Nothing in
`docs/sdd/CHANGE_WORKFLOW.md`'s STOP conditions, `docs/sdd/TRACEABILITY_STANDARD.md`
or the R4 row of `docs/sdd/RISK_TO_PROCESS_MATRIX.md` makes a declared and
attributed scope deviation a bar to review. The relevant STOP condition is
*"scope has expanded beyond the approved tasks **without a change record**"* —
it did not: both files are inside `SPEC-0005`'s approved scope, one was simply
edited under the wrong task's session, and the deviation is on the record in
`ASES-0001`.
**History is preserved:** `ASES-0001` stays `PARTIAL` and its notes stay as
written. Nothing is rewritten to make this look tidier than it was.
**Status:** `RESOLVED` — declared, attributed, not absorbed
**Owner:** —

## Task states

| Task | Status | Evidence |
|---|---|---|
| `TASK-001` canonical composition | `DONE` | `UT-001`–`UT-004`, `REG-001` |
| `TASK-002` backward-compatible reading | `DONE` | `UT-005`, `IT-002`–`IT-004`, `REG-002`–`REG-004`, `REG-006` |
| `TASK-003` refusal of malformed keys | `DONE` | `UT-006`, `ST-001`, `ST-003` |
| `TASK-004` deletion visibility | `DONE` | `IT-006`, `ST-005` |
| `TASK-005` security tests | `DONE` | `ST-001`–`ST-005`, `REG-005` |
| `TASK-006` traceability and verification | `DONE` | `VER-0001`, this report |

## What actually changed

Two files. Nothing else.

| File | Change |
|---|---|
| `apps/web/src/services/hr/captureVault.ts` | `pathFor` composes with `/`; `toLogicalKey` normalises a stored key for resolution only; `assertSafeKey` refuses malformed keys; `filesystemPathFor` is the single logical→physical boundary; `deleteCapture` no longer swallows a storage failure |
| `apps/web/tests/unit/capture-vault.spec.ts` | 12 cases → 27 |

**`path.join` was not globally replaced.** All seven compositions were
classified before any edit; six are physical-path composition and are unchanged.

## Verification summary

| Check | Result |
|---|---|
| Capture-vault targeted, before | **4 failed · 8 passed** of 12 |
| Capture-vault targeted, after | **27 passed** of 27 |
| Product suite ×3 | **1935 total · 1933 passed · 0 failed · 2 skipped**, three times |
| Types / lint | clean |
| B2 / B3 | 93/93 · 70/70 |
| `validate --all` | 0 errors, 7 historical warnings |
| Schema / migration | **none**, re-verified after implementation |

The two skips are the Windows POSIX file-mode assertions. Their Linux execution
and pass is proved in `docs/evidence/phase-b4-pilot2-readiness/23-suite-stability-and-posix-proof.md`.

## Verdict

**`FAIL`** — recommended, not accepted.

**No finding is `OPEN`.**

| Finding | Status | Closed by |
|---|---|---|
| `CONV-001` two human code reviews | **`RESOLVED`** | `REV-0002`, `REV-0003` — both human `APPROVE` |
| `CONV-002` gate-6 acceptance | **`RESOLVED`** | Application Security **and** QA / Release Engineering, both `ACCEPT` |
| `CONV-003` residual orphan risk | **`ACCEPTED_RISK`** | Application Security, with rationale, residual condition and scope recorded |
| `CONV-004` scope deviation | **`RESOLVED`** | declared, attributed, history preserved |

**The one accepted limitation carries a named human owner**, which
`docs/sdd/SPEC_LIFECYCLE.md` requires before `CONVERGED`: Application Security.

`PASS WITH ACCEPTED LIMITATIONS` is the correct verdict because exactly one
finding is `ACCEPTED_RISK` and none is `OPEN` — the definition in
`specs/templates/CONVERGENCE_TEMPLATE.md`. It was not forced: `CONV-003` was
tested against every `FR-`, `SEC-`, `DATA-` and `OBS-` requirement and against
`TASK-004`'s Definition of Done before it was put to Application Security, and
violates none of them.

## What this convergence does not say

It is **not** production approval, staging approval, deployment approval, or a
release decision. `SPEC-0005` advances to `CONVERGED` and stops there — **not**
`READY_FOR_RELEASE`, **not** `RELEASED`.

The gate-6 acceptance explicitly acknowledged that no production deployment is
included in it, and the `CONV-003` acceptance explicitly did not waive
production backup and restore, production RLS verification, staging, rollback,
or the final production deployment approval.

An agent produced this report and recommended this verdict. Humans accepted it
at gate 6 on 2026-09-08.

An agent produced this report and recommends this verdict. It has not marked
itself converged, and it has not advanced the specification beyond `VERIFYING`.
