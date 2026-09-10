# SPEC-NNNN — <title>

> Copy to `specs/SPEC-NNNN-short-slug/spec.md` and fill in. This specification
> states **what** and **why**. How it is built belongs in `plan.md`.
> Keep sections that do not apply, marked "Not applicable" with a reason, so a
> reader can tell "considered and irrelevant" from "forgotten".
> Depth scales with risk: `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.
>
> **At R1** this template still lives in a `SPEC-NNNN` directory, used in
> lightweight form: fill in Metadata, Problem, Goal, Scope, Out of scope,
> Acceptance criteria and Evidence, and delete the rest rather than filling
> twenty-five sections for a copy edit. The directory is what keeps an R1
> change referenceable. R0 experiments get no `SPEC-NNNN` directory and use no
> specification at all.

## Metadata

> The directory also needs `sdd.json`, copied from
> `specs/templates/SDD_MANIFEST_TEMPLATE.json`. The identifier, risk and status
> below must match it; the validator checks all three.

| Field | Value |
|---|---|
| Specification ID | `SPEC-NNNN` |
| Title | |
| Status | `DRAFT` (see `docs/sdd/SPEC_LIFECYCLE.md`) |
| Risk | `R?` (see `docs/RISK_CLASSIFICATION.md`) |
| Owner | functional role, not a personal name |
| Created | YYYY-MM-DD |
| Last updated | YYYY-MM-DD |
| Supersedes | `SPEC-NNNN` or none |
| Superseded by | `SPEC-NNNN` or none |

## Problem

What is wrong or missing today, from the user's or operator's point of view.
No solution language.

## Goal

What is true when this is done. One or two sentences.

## Background and context

What a reader needs to understand the problem. For brownfield work, describe
the behaviour that exists today and cite where it lives.

## Scope

What this specification covers.

## Out of scope

What it deliberately does not cover. This section prevents more argument than
any other; be specific.

## Actors

Who or what interacts with this. Include platform roles, workspace roles,
API-key integrators, service identities, background workers and external
callers where relevant.

## User stories

Where applicable. `As <actor>, I need <capability>, so that <outcome>.`

## Functional requirements

> Atomic, testable, unambiguous, implementation-neutral. One obligation per
> identifier. See `docs/sdd/REQUIREMENT_STANDARD.md`.

- `FR-001` —
- `FR-002` —

## Non-functional requirements

> Performance, capacity, availability, compatibility, accessibility. Do not
> invent a numeric threshold nobody approved; raise a clarification instead.

- `NFR-001` —

## Security requirements

> Authentication, authorization scope, tenant isolation, input handling,
> secrets, abuse resistance. Cite existing platform guarantees rather than
> restating them; state only what this change adds or must preserve.

- `SEC-001` —

## Data and privacy requirements

> What is stored, who may read it, how long it lives, what deletion must
> reach, what leaves the system.

- `DATA-001` —

## Observability requirements

> What must be visible when this runs, and when it fails: logs, metrics,
> audit entries, alerts.

- `OBS-001` —

## Failure behaviour

What the actor sees, and what the system does, when this fails: validation
failure, missing record, permission denied, dependency unavailable, timeout,
partial success.

## Edge cases

The cases that are easy to miss: empty sets, first run, concurrent callers,
retries, data that predates this change, a deactivated owner.

## Acceptance criteria

> Each criterion names the requirements it covers.

- `AC-001` — … *(covers `FR-001`, `SEC-001`)*

## Dependencies

Other specifications, existing components, third-party services, other teams.

## Assumptions

Stated explicitly so they can be challenged. An assumption that turns out to
be wrong is a change record, not a surprise.

## Open questions

Unresolved material questions block progression to `READY_FOR_PLAN`. Link the
clarification: `CL-001`.

## Risks

What could go wrong with this change, and any open evidence conflict touching
this area (`docs/EVIDENCE_CONFLICTS.md`). An open `C4` or release-blocking
conflict in the affected area must be listed here.

## Rollback and reversibility expectations

Where applicable. What undoing this means, and what cannot be undone —
migrations in this repository have no down path
(`docs/operations/ROLLBACK.md`).

## Implementation constraints

> **Only** constraints that are genuinely mandatory: an existing contract, a
> platform limitation, a regulatory requirement, an approved architectural
> decision. Preferences belong in `plan.md`. Leave empty rather than filling
> it with design opinions.

## Evidence and existing-system references

For brownfield work. Cite the files that establish current behaviour, with the
evidence level and claim classification the Phase A standard uses.

- `VERIFIED` — `path/to/file.ts` — `symbolName()` — what it currently does
- `DOCUMENTED` — `docs/...` — what the documentation states
- `UNKNOWN — requires runtime/infrastructure verification` — what could not be
  established

State for each requirement that touches existing behaviour whether it
**preserves**, **changes** or **replaces** it.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| YYYY-MM-DD | Created | role | — |

## Approval

> Required approvals depend on risk: `docs/sdd/HUMAN_APPROVAL_GATES.md`.
> An AI agent may prepare this section. It may not record an approval on a
> human's behalf, and may not approve its own work at R4 or R5.

| Gate | Role | Decision | Date | Scope of what was approved |
|---|---|---|---|---|
| Specification approval | | | | |
| Architecture approval | | | | |
| Security risk acceptance | | | | |
| Implementation readiness | | | | |
