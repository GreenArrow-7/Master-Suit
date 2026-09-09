# Identifier Standard

`NORMATIVE — engineering process requirement.` This document defines
identifiers for Spec-Driven Development artefacts. It describes rules that
apply from Phase B1 onward; it makes no claim about existing application
behaviour.

## Why stable identifiers

A requirement is referenced by its plan, its tasks, its tests, its
traceability matrix and, later, its change records. If identifiers move, every
one of those references silently rots. Identifiers are therefore permanent
labels, not positions in a list.

## Specification identifier

`SPEC-NNNN` — four digits, zero-padded, allocated sequentially from
`SPEC-0001`. The number never changes, including when a specification is
superseded.

Directory name: `specs/SPEC-NNNN-short-slug/`. The slug is lower-case,
hyphenated, and descriptive. The slug may be corrected for a typo; the number
may not change.

A `SPEC-NNNN` is allocated for **every change from R1 upward**, including
cosmetic ones. At R1 the directory is lightweight and may hold little more
than a short `spec.md` and a `change-record.md`, but the identifier exists so
that the change is referenceable and so that in-spec identifiers such as
`CHG-001` have an owner. R0 experiments are not allocated a number.

## Identifiers inside a specification

| Prefix | Meaning | Lives in |
|---|---|---|
| `FR-001` | Functional requirement | `spec.md` |
| `NFR-001` | Non-functional requirement | `spec.md` |
| `SEC-001` | Security requirement | `spec.md` |
| `DATA-001` | Data or privacy requirement | `spec.md` |
| `OBS-001` | Observability requirement | `spec.md` |
| `AC-001` | Acceptance criterion | `spec.md` |
| `CL-001` | Clarification | `clarifications.md` |
| `AD-001` | Architecture or technical decision | `plan.md` |
| `TH-001` | Threat | `threat-model.md` |
| `CTRL-001` | Security control | `threat-model.md` |
| `UT-001` | Unit test | `test-plan.md` |
| `IT-001` | Integration test | `test-plan.md` |
| `E2E-001` | End-to-end test | `test-plan.md` |
| `ST-001` | Security test | `test-plan.md` |
| `PT-001` | Performance test | `test-plan.md` |
| `REG-001` | Regression test | `test-plan.md` |
| `TASK-001` | Implementation task | `tasks.md` |
| `CHG-001` | Change record | `change-record.md` |
| `CONV-001` | Convergence finding | `convergence.md` |

## Execution records

Introduced by Phase B3 (`SPEC-0002`). These are four-digit and live in
`execution/`, one record per file, named for the identifier.

| Prefix | Meaning | Lives in |
|---|---|---|
| `ASES-0001` | Agent execution session | `execution/ASES-0001.json` |
| `VER-0001` | Verification run | `execution/VER-0001.json` |
| `REV-0001` | Independent review | `execution/REV-0001.json` |

They are numbered per specification and allocated in order, like every other
identifier here. They are **control artefacts, not specification content**:
they record what an agent was authorised to do and what happened, and they
never carry requirements, acceptance criteria, approvals or secrets.

Four digits rather than three because a long-running specification accumulates
sessions far faster than it accumulates requirements.

All in-spec identifiers are three digits, zero-padded, allocated sequentially
within their own prefix and within their own specification. `FR-001` in
`SPEC-0002` is a different requirement from `FR-001` in `SPEC-0007`.

## Qualified references

Inside the owning specification, the short form is enough: `SEC-003`.

Anywhere else — another specification, a commit message, a test name, a code
comment, a review remark — use the fully-qualified form:

```text
SPEC-0001/SEC-003
SPEC-0001/TASK-006
SPEC-0001/ST-004
```

A bare `SEC-003` outside its own specification is ambiguous and is treated as
a defect in the referring artefact.


Every specification directory also carries `sdd.json` declaring its
`specId`, which the validator checks against the directory name
(`SDD-V002`). See `docs/sdd/MACHINE_CONTRACT.md`.

## Rules

1. **Never renumber.** Approved identifiers are permanent, including across
   wording revisions, reordering of sections, and rewrites of the surrounding
   prose.
2. **Never reuse.** A deleted or withdrawn identifier stays reserved forever.
   Mark it `WITHDRAWN` with a one-line reason and the change record that
   withdrew it, and leave it in place.
3. **New requirement, new identifier.** If the behaviour changes rather than
   the wording, allocate a new identifier and withdraw the old one under
   change control (`docs/sdd/CHANGE_CONTROL.md`). Editing an approved
   requirement's meaning while keeping its number is prohibited.
4. **Wording may be revised** under a `MINOR CLARIFICATION` change record when
   the meaning is unchanged; the identifier stays.
5. **Gaps are acceptable.** A sequence that runs 001, 002, 004 because 003 was
   withdrawn is correct. Do not close the gap.
6. **One identifier, one statement.** A requirement carrying two testable
   obligations is split into two identifiers before approval, not after.

## Relationship to identifiers that already exist

These schemes are already in use and are unchanged by Phase B1:

| Existing scheme | Meaning | Owner document |
|---|---|---|
| `EVC-NNN` | Evidence conflict | `docs/EVIDENCE_CONFLICTS.md` |
| `SEC-OBS-NNN` | Security observation | `docs/security/SECURITY_OBSERVATIONS.md` |
| `GAP-<AREA>-NN` | Phase A gap | `docs/PHASE_A_GAP_ANALYSIS.md` |
| `F-NN` | Historical security finding | `security/SECURITY_FINDINGS.md` |
| `R0`–`R5` | Risk level | `docs/RISK_CLASSIFICATION.md` |
| ADR numbering | Architecture decision record | `docs/adr/`, `docs/ADRs/` |

Note the collision hazard: `SEC-001` inside a specification is a security
*requirement*, while `SEC-OBS-001` is a security *observation* about the
existing system. They are different registers. Always write `SEC-OBS-` in
full, and always qualify a specification's `SEC-` with its `SPEC-NNNN/`
prefix outside the spec.

A specification may cite an `EVC`, `SEC-OBS`, `GAP` or `F` identifier as
evidence or as motivation. It may not renumber, close or edit them; those
registers have their own owners and processes.

## Authority / References

- `AGENTS.md` — engineering constitution
- `docs/RISK_CLASSIFICATION.md` — risk levels referenced above
- `docs/EVIDENCE_CONFLICTS.md`, `docs/security/SECURITY_OBSERVATIONS.md`,
  `docs/PHASE_A_GAP_ANALYSIS.md` — pre-existing identifier registers
- `docs/sdd/CHANGE_CONTROL.md` — the process for withdrawing an identifier
- `docs/sdd/AGENT_SESSION_STANDARD.md` — the `ASES`, `VER` and `REV` records
