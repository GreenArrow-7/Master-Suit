# Cross-reference audit

## Path references

Every repository path referenced from a B1 document, `AGENTS.md` or
`CLAUDE.md` was extracted and checked for existence.

| Metric | Value |
|---|---|
| Distinct document paths referenced | 56 |
| Broken references | **0** |

Re-run after the 2026-09-07 correction pass, with the evidence package itself
included in the scan scope. The earlier figure of 35 covered the B1 documents
and the two governance files only; widening the scope to the evidence package
added 21 further distinct paths and found no broken reference.

The set includes all 14 `docs/sdd/` documents, all 11 `specs/templates/`
files, `specs/README.md`, the Phase A documents under `docs/`,
`docs/architecture/`, `docs/security/`, `docs/operations/` and
`docs/standards/`, and the two root governance files.

## Identifier references

| Check | Result |
|---|---|
| Identifier prefixes used across B1 | 22 |
| Prefixes defined in `IDENTIFIER_STANDARD.md` | 22 |
| Used but undefined | **0** |
| Defined but unused | 0 |

Prefixes: `SPEC`, `FR`, `NFR`, `SEC`, `DATA`, `OBS`, `AC`, `CL`, `AD`, `TH`,
`CTRL`, `UT`, `IT`, `E2E`, `ST`, `PT`, `REG`, `TASK`, `CHG`, `CONV`, `BUG`,
`EMG`.

## References into pre-existing registers

B1 documents cite five identifier registers they do not own. Each citation was
checked to confirm it references rather than modifies:

| Register | Cited in | Modified by B1 |
|---|---|---|
| `EVC-NNN` — `docs/EVIDENCE_CONFLICTS.md` | 6 B1 documents, 14 occurrences | **No.** Status tally identical to Phase A |
| `SEC-OBS-NNN` — `docs/security/SECURITY_OBSERVATIONS.md` | `IDENTIFIER_STANDARD.md`, `BUG_WORKFLOW.md` | No |
| `GAP-<AREA>-NN` — `docs/PHASE_A_GAP_ANALYSIS.md` | `known-limitations.md`, `infrastructure-change-check.md` | No |
| `F-NN` — `security/SECURITY_FINDINGS.md` | `IDENTIFIER_STANDARD.md` | No |
| `R0`–`R5` — `docs/RISK_CLASSIFICATION.md` | 16 B1 documents | No |

The EVC citations are all of one of three kinds: listing the register in a
table of pre-existing schemes, instructing that a specification may cite but
not close a conflict, or naming a specific conflict as an unknown
(EVC-003 in `CHANGE_WORKFLOW.md`, alongside U-09 and U-10 from the Phase A
unknowns snapshot). None closes or edits a conflict.

## Identifier collision hazard

`IDENTIFIER_STANDARD.md` names one real collision risk: a specification's
`SEC-001` is a security *requirement*, while `SEC-OBS-001` is a security
*observation* about the existing system. The standard requires `SEC-OBS-` to
be written in full and requires a specification's `SEC-` to be qualified as
`SPEC-NNNN/SEC-001` outside its own file. **VERIFIED — every B1 occurrence
follows this.**

## Two-way consistency

Where one document defines and another applies, both were read:

| Definition | Application | Consistent |
|---|---|---|
| `SPEC_LIFECYCLE.md` states | `SPEC_TEMPLATE.md` metadata, `SDD_WORKFLOW.md` summary | yes |
| `CLARIFICATION_STANDARD.md` statuses | `CLARIFICATION_TEMPLATE.md` | yes |
| `CHANGE_CONTROL.md` change types | `CHANGE_RECORD_TEMPLATE.md` | yes |
| `TRACEABILITY_STANDARD.md` checks | `TRACEABILITY_TEMPLATE.md` gap checks | yes |
| `HUMAN_APPROVAL_GATES.md` roles | `SPEC_TEMPLATE.md` approval table, `THREAT_MODEL_TEMPLATE.md`, `EMERGENCY_CHANGE_TEMPLATE.md` | yes |
| `RISK_TO_PROCESS_MATRIX.md` levels | every template header | yes |
| `PLAN_STANDARD.md` sections | `PLAN_TEMPLATE.md` | yes, all 25 |

## Authority sections

All 14 `docs/sdd/` documents carry an `## Authority / References` section
naming the governing artefacts they derive from. `specs/README.md` carries an
equivalent section. The 11 templates carry a header block pointing at their
governing standard instead, which is the appropriate form for a fill-in
artefact.

## Result

**PASS.** No broken path, no undefined identifier, no register modified by
reference, no definition contradicted by its application.

## Evidence Sources

E1: path extraction and existence check across the B1 set plus `AGENTS.md`
and `CLAUDE.md`; identifier extraction; manual reading of all 14 EVC
citations.
E4: `docs/EVIDENCE_CONFLICTS.md`, `docs/security/SECURITY_OBSERVATIONS.md`,
`docs/PHASE_A_GAP_ANALYSIS.md`, `docs/RISK_CLASSIFICATION.md`.
