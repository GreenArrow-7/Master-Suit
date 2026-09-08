# Change Control

`NORMATIVE — engineering process requirement.`

Once a specification reaches `APPROVED_FOR_IMPLEMENTATION`, its requirements
are a record of what a human agreed to. They are not edited in place. Every
subsequent change is a `CHG-` entry in the specification's
`change-record.md`, and historical approved intent is never erased.

**Where a change record lives.** Always inside a `specs/SPEC-NNNN-short-slug/`
directory, at every risk level from R1 upward. A change record is never a
free-standing file, because a `CHG-` identifier is only unique within its
owning specification (`docs/sdd/IDENTIFIER_STANDARD.md`). At R1 the
specification directory is lightweight and the change record may carry most of
the substance, but it still has a `SPEC-NNNN` to belong to. R0 work produces
no change record at all.

## Record format

```text
CHG-001

Change:
Reason:
Requested by:
Change type:
Affected requirements:
Affected plan:
Affected tests:
Security impact:
Migration impact:
Compatibility impact:
Risk change:
Approval required:
Approval status:
Date:
```

`Affected requirements` names identifiers. If the change withdraws a
requirement, the requirement stays in `spec.md` marked `WITHDRAWN` with a
pointer to this `CHG-`; its identifier is never reused
(`docs/sdd/IDENTIFIER_STANDARD.md`).

## Change types

| Type | What it covers | Approval |
|---|---|---|
| `MINOR CLARIFICATION` | Wording, typo, formatting, added example. **Meaning unchanged** | Author records it; no separate approval |
| `REQUIREMENT CHANGE` | A requirement's meaning changes, or one is added or withdrawn | The original spec approver for that risk level |
| `SCOPE CHANGE` | Scope or out-of-scope moves | Product Owner, plus Solution Architect at R3+ |
| `ARCHITECTURE CHANGE` | A different approach, a new pattern, a new dependency | Solution Architect |
| `SECURITY CHANGE` | Any `SEC-` requirement, threat, control, permission, tenant boundary, audit or retention behaviour | Application Security, mandatory at R4/R5 |
| `DATA MODEL CHANGE` | Schema, migration strategy, data ownership or retention | Solution Architect; plus DevOps and Human Release Authority when destructive |
| `BREAKING CHANGE` | Existing API consumers, stored data, sessions, queued jobs or the mobile shell must adapt | Product Owner **and** Solution Architect; Human Release Authority for release |

The test for `MINOR CLARIFICATION` is strict: if a reasonable engineer could
build something different after the edit than before it, the change is not
minor. When unsure, it is not minor.

## Rules

1. **No silent edits.** An approved requirement changes only through a `CHG-`.
2. **Risk is re-evaluated.** Every change record states whether the risk level
   moved. An increase pulls in the artefacts and gates of the new level
   (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`) before work continues.
3. **Downstream artefacts follow.** A requirement change that leaves the plan,
   tests or traceability untouched is incomplete. The record names what else
   must change.
4. **R4 and R5 security changes need human approval** before implementation
   resumes. An agent may prepare the record and must then stop.
5. **A major behavioural redesign gets a new specification.** When the change
   would rewrite the problem rather than refine the solution, open a new
   `SPEC-NNNN`, mark the old one `SUPERSEDED`, and set `Supersedes` /
   `Superseded by` on both. Do not overwrite the original.
6. **Never erase.** Withdrawn requirements, rejected changes and superseded
   specifications stay in the repository. The history of what was agreed is
   part of the evidence.
7. **Evidence conflicts are not change records.** A disagreement about what
   the system currently does belongs in `docs/EVIDENCE_CONFLICTS.md`. A change
   to what it should do belongs here. A change record may cite an `EVC`.

## Before approval

A specification in `DRAFT`, `CLARIFYING`, `READY_FOR_PLAN` or `PLANNED` is
still being written. Edits need no change record; the revision history in the
specification carries them. Change control begins at the first approval.

## Authority / References

- `AGENTS.md` §1 (backward compatibility), §4 (database), §7 (production)
- `docs/RISK_CLASSIFICATION.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — the approving roles
- `docs/sdd/IDENTIFIER_STANDARD.md` — withdrawal and reservation
- `specs/templates/CHANGE_RECORD_TEMPLATE.md`
