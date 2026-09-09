# SPEC-NNNN — Change record

> Copy to `specs/SPEC-NNNN-short-slug/change-record.md`. A change record
> always lives inside a specification directory, at every risk level from R1
> upward, because a `CHG-` identifier is unique only within its owning
> specification. At R1 that directory is lightweight and this file may carry
> most of the substance of the change; it still belongs to a `SPEC-NNNN`.
> R0 work produces no change record.
> Change control begins at the first approval. Before that, edits are captured
> by the specification's revision history.
> Rules and change types: `docs/sdd/CHANGE_CONTROL.md`.
> Historical approved intent is never erased.

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Current risk | `R?` |

## Log

| ID | Change type | Summary | Risk change | Approval status | Date |
|---|---|---|---|---|---|
| `CHG-001` | | | none | | |

---

## CHG-001

**Change:** what is changing, precisely.

**Reason:** why. A reason that amounts to "the implementation turned out
differently" means the code is wrong, not the requirement — check
`docs/sdd/ARTIFACT_AUTHORITY.md` before proceeding.

**Requested by:** functional role.

**Change type:** one of `MINOR CLARIFICATION`, `REQUIREMENT CHANGE`,
`SCOPE CHANGE`, `ARCHITECTURE CHANGE`, `SECURITY CHANGE`,
`DATA MODEL CHANGE`, `BREAKING CHANGE`.

> `MINOR CLARIFICATION` is strict: if a reasonable engineer could build
> something different after the edit than before it, it is not minor.

**Affected requirements:** identifiers. A withdrawn requirement stays in
`spec.md` marked `WITHDRAWN` pointing here; its identifier is never reused.

**Affected plan:** which `AD-` decisions change or are invalidated.

**Affected tests:** which cases change, are added, or are withdrawn.

**Security impact:** none, or what changes about authentication,
authorization, tenant isolation, secrets, audit or data exposure.

**Migration impact:** none, or the schema and data consequence.

**Compatibility impact:** existing API consumers, stored data, sessions,
queued jobs, the mobile shell.

**Risk change:** none, or `R? → R?`. An increase pulls in the artefacts and
gates of the new level before work resumes.

**Approval required:** which gate and which role
(`docs/sdd/HUMAN_APPROVAL_GATES.md`).

**Approval status:** `PENDING` / `APPROVED` / `REJECTED`, with the role and
date. An AI agent may prepare this record. It may not record an approval on a
human's behalf.

**Date:** YYYY-MM-DD

---

## When this is the wrong artefact

- The change would rewrite the problem rather than refine the solution: open a
  new `SPEC-NNNN`, mark this one `SUPERSEDED`, and set `Supersedes` /
  `Superseded by` on both.
- Two sources disagree about what the system currently *does*: that is an
  evidence conflict for `docs/EVIDENCE_CONFLICTS.md`, not a change record.
- The specification is still pre-approval: use the revision history instead.
