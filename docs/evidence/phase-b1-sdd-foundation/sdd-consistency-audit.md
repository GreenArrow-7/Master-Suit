# SDD consistency audit

The twenty checks the Phase B1 brief requires, run against the 26 B1 documents
plus `AGENTS.md` and `CLAUDE.md`.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | No lifecycle state is defined differently across documents | **PASS** | The 13 states appear in 2 to 6 documents each, all consistent with `SPEC_LIFECYCLE.md`. A scan for capitalised state-like tokens across all B1 files found no state defined outside that document |
| 2 | No risk level has conflicting requirements across files | **PASS** | See `risk-matrix-audit.md`. Every level's artefacts and gates derive from `docs/RISK_CLASSIFICATION.md` with no contradiction |
| 3 | Artifact authority is consistent everywhere | **PASS** | See `authority-audit.md`. The order appears in `ARTIFACT_AUTHORITY.md`, `SDD_WORKFLOW.md` and `AGENTS.md` §2 in the same sequence |
| 4 | Identifier formats are consistent | **PASS** | 22 prefixes used across the set, 22 defined in `IDENTIFIER_STANDARD.md`, zero used-but-undefined |
| 5 | Templates use only defined identifiers | **PASS** | Every identifier in the 11 templates resolves to the standard; `BUG-` and `EMG-` are defined there too |
| 6 | Approval requirements match the risk matrix | **PASS** | `HUMAN_APPROVAL_GATES.md` gates and `RISK_TO_PROCESS_MATRIX.md` rows agree level by level; both trace to the Phase A rigour table |
| 7 | PLAN cannot override SPEC | **PASS** | Stated in `ARTIFACT_AUTHORITY.md` rule 2, `PLAN_STANDARD.md` ("What a plan must not do"), `PLAN_TEMPLATE.md` header, `SDD_WORKFLOW.md`, `AGENTS.md` §2 |
| 8 | TASKS cannot silently add scope | **PASS** | `ARTIFACT_AUTHORITY.md` rule 3, `TASKS_TEMPLATE.md` "Allowed scope" and its three named failure modes, `TRACEABILITY_STANDARD.md` check 4 |
| 9 | Clarifications have a defined incorporation process | **PASS** | `CLARIFICATION_STANDARD.md` "The incorporation rule": INCORPORATED or formally linked; a decision living only in conversation is explicitly prohibited |
| 10 | Change control exists for approved specs | **PASS** | `CHANGE_CONTROL.md` with 7 change types and a strict test for `MINOR CLARIFICATION`; `CHANGE_RECORD_TEMPLATE.md` |
| 11 | Traceability relationships are complete | **PASS** | Requirement → plan decision → task → code → test → result, with 10 named failure checks and an explicit anti-gaming rule |
| 12 | Convergence rules refer back to authoritative artefacts | **PASS** | All 15 convergence checks reference requirements, acceptance criteria, security requirements, tasks, plan or `AGENTS.md` §8 |
| 13 | Bug workflow converges into requirements and tests | **PASS** | `BUG_WORKFLOW.md` "Affected requirement" forces one of three outcomes, including "the bug exposed a missing requirement"; a regression test that has never failed is rejected |
| 14 | Emergency workflow requires retrospective reconciliation | **PASS** | `EMERGENCY_CHANGE_WORKFLOW.md` final step is mandatory with a six-item checklist; the template cannot be closed without it |
| 15 | AI is never allowed to self-approve R4/R5 work | **PASS** | Present in 7 documents: `HUMAN_APPROVAL_GATES.md`, `SPEC_LIFECYCLE.md` ("may not enter this state on its own judgement"), `RISK_TO_PROCESS_MATRIX.md` ("Agent may execute: never; humans execute" at R5), `SDD_WORKFLOW.md`, `EMERGENCY_CHANGE_WORKFLOW.md`, `SPEC_TEMPLATE.md`, `CONVERGENCE_TEMPLATE.md` |
| 16 | Production release remains human-controlled | **PASS** | `HUMAN_APPROVAL_GATES.md` gate 7 applies at every risk level; `AGENTS.md` §7 unchanged; no B1 document creates an exception |
| 17 | Existing Phase A evidence standards are preserved | **PASS** | `SDD_WORKFLOW.md` restates the hierarchy and the UNKNOWN form; `ARTIFACT_AUTHORITY.md` repeats the precedence; `SPEC_TEMPLATE.md` requires claim classification in its Evidence section |
| 18 | Existing evidence conflicts were not silently closed | **PASS** | Register tally after B1 is identical to Phase A: 9 OPEN, 3 PARTIALLY RESOLVED, 2 ACCEPTED DIFFERENCE, 0 RESOLVED. B1 references EVC in 6 documents, always to cite or to forbid closure, never to resolve |
| 19 | Current-state facts and normative rules are clearly distinguished | **PASS** | Every `docs/sdd/` document and `specs/README.md` opens with `NORMATIVE — engineering process requirement`. Where a B1 document states a fact about the system it carries `VERIFIED`, `DOCUMENTED` or `UNKNOWN` |
| 20 | No application behaviour was modified | **PASS** | `application-change-check.md` |

## Notes on two checks worth expanding

**Check 15.** The prohibition is expressed differently in different documents,
which is intentional: a table cell at R5 reading "never; humans execute" and a
sentence reading "may not enter this state on its own judgement" both bind. A
keyword scan alone under-reports it, so each occurrence was read.

**Check 18.** "Not silently closed" is stronger than "not touched". B1
documents actively forbid a specification from closing a conflict
(`ARTIFACT_AUTHORITY.md`, `SDD_WORKFLOW.md`) and require an open C4 or
release-blocking conflict in the affected area to appear in a specification's
Risks section and be seen by the approver.

## Result

**20 of 20 checks pass.**

## Post-B1 correction pass (2026-09-07)

A follow-up review found two inconsistencies the original audit did not
catch, and both were corrected. The original findings above are preserved;
this section records what changed and re-runs the affected rules.

### Correction 1 — approval wording conflated two different things

**Found:** `AGENTS.md` §2 read "Material changes start from an approved
specification, not from code." Read literally, that blocks writing the
specification itself, since a specification cannot start from an approved
specification. It confused *specification development* with *implementation*.

**Corrected to the canonical rule**, now present with identical wording in
five documents:

> Material implementation must not begin until the specification has reached
> the approval state required by its risk level.

Each of the five also states that drafting, clarifying, planning, threat
modelling and test design happen *before* that approval and are never blocked
by the rule.

| Document | Canonical rule | Development-not-blocked clause |
|---|---|---|
| `AGENTS.md` | exact match | present |
| `CLAUDE.md` | exact match | present |
| `docs/sdd/SPEC_LIFECYCLE.md` | exact match | present |
| `docs/sdd/SDD_WORKFLOW.md` | exact match | present |
| `docs/sdd/CHANGE_WORKFLOW.md` | exact match | present |

Variant phrasings remaining: 0. **No human approval requirement was weakened.**
The R4 and R5 gates, the prohibition on self-approval and the production
release gate are all unchanged; the correction narrows what the rule blocks,
not who must approve.

### Correction 2 — R1 artefact model was ambiguous

**Found:** the matrix said an R1 change record could stand in for a
specification, while `CHANGE_RECORD_TEMPLATE.md` placed every change record
inside a `SPEC-NNNN/` directory. An R1 change therefore had no defined home,
and a `CHG-` identifier, which is unique only within its owning specification,
had no owner.

**Corrected to a single storage model:**

- **R0** — no `SPEC-NNNN` directory, no formal artefact.
- **R1** — a lightweight `SPEC-NNNN` directory. Minimum applicable
  specification and change-record information only. `plan.md`,
  `threat-model.md`, `test-plan.md`, `tasks.md`, `traceability.md` and
  `convergence.md` are not mandatory.
- **R2+** — the normal increasingly rigorous workflow per the matrix.

Escalation grows the same directory rather than moving the work, so the path
and number stay stable.

**Agreement re-checked across all nine documents that touch the question:**
`specs/README.md`, `RISK_TO_PROCESS_MATRIX.md`, `CHANGE_CONTROL.md`,
`IDENTIFIER_STANDARD.md`, `CHANGE_RECORD_TEMPLATE.md`, `SPEC_TEMPLATE.md`,
`SDD_WORKFLOW.md`, `SPEC_LIFECYCLE.md`, `CHANGE_WORKFLOW.md` — **9 of 9
agree**. Residual "change record alone" and "as the primary artefact"
phrasings: 0.

### Affected rules re-run

| Rule | Re-run result |
|---|---|
| 2 — no risk level has conflicting requirements across files | **PASS**, now including the R1 storage model |
| 4 — identifier formats consistent | **PASS** — 22 used, 22 defined; `CHG-` now has a defined owner at every level from R1 |
| 6 — approval requirements match the risk matrix | **PASS** — gates unchanged; the corrected wording does not alter any gate |
| 15 — AI never self-approves R4/R5 | **PASS** — unchanged |
| 16 — production release human-controlled | **PASS** — unchanged |
| 20 — no application behaviour modified | **PASS** — the correction pass edited 11 Markdown files and nothing else |

**Post-correction result: 20 of 20 checks pass.**

## Evidence Sources

E1: the 26 B1 documents, `AGENTS.md`, `CLAUDE.md`; keyword and pattern scans
across the set; manual reading of every flagged occurrence.
E4: `docs/RISK_CLASSIFICATION.md`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/evidence/phase-a-foundation/`.
