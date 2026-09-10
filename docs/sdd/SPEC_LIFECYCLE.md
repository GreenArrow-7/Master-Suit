# Specification Lifecycle

`NORMATIVE — engineering process requirement.`

A specification carries exactly one `Status` value at a time, recorded in its
metadata block. The status lives in the file; the file never moves. Directory
paths stay stable so that references from tests, commits and other
specifications remain valid for the life of the repository.

## States

```text
DRAFT
  ↓
CLARIFYING
  ↓
READY_FOR_PLAN
  ↓
PLANNED
  ↓
READY_FOR_APPROVAL
  ↓
APPROVED_FOR_IMPLEMENTATION
  ↓
IMPLEMENTING
  ↓
VERIFYING
  ↓
CONVERGED
  ↓
READY_FOR_RELEASE
  ↓
RELEASED
```

Terminal or alternate: `CANCELLED`, `SUPERSEDED`, `ON_HOLD`.

## Entry and exit criteria

**DRAFT** — a specification exists with an id, a title, a problem statement and
a provisional risk level.
*Exit:* the problem, goal, scope and out-of-scope are written, and requirements
are drafted with identifiers.

**CLARIFYING** — material ambiguities are being resolved.
*Entry:* at least one `CL-` is OPEN, or the author has not yet run the
clarification checklist in `docs/sdd/CLARIFICATION_STANDARD.md`.
*Exit:* every clarification is ANSWERED, INCORPORATED, DEFERRED with a reason,
or NOT APPLICABLE. No material ambiguity is left OPEN.
For R0 and R1 this state is normally skipped.

**READY_FOR_PLAN** — the specification is complete enough to plan against.
*Exit criteria:* all mandatory spec sections present for the risk level; every
requirement is atomic and testable; every acceptance criterion maps to at
least one requirement; risk level confirmed, not provisional.

**PLANNED** — a plan exists that covers every requirement.
*Exit criteria:* `plan.md` complete for the risk level; every material
technical decision carries an `AD-` and traces to a requirement or a stated
engineering constraint; a threat model exists where the risk matrix requires
one; a test plan exists where the risk matrix requires one.

**READY_FOR_APPROVAL** — the artefact set is complete and internally
consistent; nothing is left for the approver to guess.
*Entry criteria:* traceability shows no requirement without a task, no
requirement without a test, and no security requirement without a security
verification. Open questions that are material are closed.
*Exit:* the approvals the risk level requires are recorded in the spec's
Approval section, with role, decision, date and scope of what was approved.

**APPROVED_FOR_IMPLEMENTATION** — implementation may begin.

> **The governing rule.** Material implementation must not begin until the
> specification has reached the approval state required by its risk level.
> Every state before this one — drafting, clarifying, planning, threat
> modelling, test design — happens *without* that approval and must never be
> blocked by this rule. Those states are how a specification earns approval.

Entry requires **all** of:

- the specification is sufficiently complete for its risk level,
- material clarifications are resolved,
- an appropriate plan exists,
- the required threat analysis exists,
- the required test plan exists,
- the risk classification is complete and agreed,
- human approval is recorded where the risk level requires it.

For R3, R4 and R5 an AI agent may not enter this state on its own judgement.
The approval record must name a human role: at R3 the gate 1 specification
approval by a Product Owner or Solution Architect; at R4 and R5 that plus the
gate 5 implementation-readiness approval. An agent that believes a
specification is ready says so and stops. (`EVC-015`, decision `D2`.)

**IMPLEMENTING** — only tasks listed in `tasks.md` are executed, each within
its declared allowed scope.
*Exit:* every task is DONE, WITHDRAWN or explicitly DEFERRED with a reason.

**VERIFYING** — the test plan is executed and results recorded.
*Exit:* every planned test has a result; failures are either fixed or recorded
as findings.

**CONVERGED** — `convergence.md` is complete with a verdict of PASS or PASS
WITH ACCEPTED LIMITATIONS, every accepted limitation has a named human owner,
and no `CONV-` finding is OPEN. A FAIL verdict returns the specification to
IMPLEMENTING or, if a requirement was wrong, to change control.

**READY_FOR_RELEASE** — convergence passed, deployment impact and rollback are
written down, and the release approvals the risk level requires are recorded.
An agent never sets this state for R4 or R5 without the recorded human
approval.

**RELEASED** — the change is in production. The record captures what was
released, when, by whom, and the observed post-release state. An agent may
prepare this record; a human confirms it.

**ON_HOLD** — paused deliberately. Records why, who paused it, and what would
resume it. Distinct from a specification that is merely inactive.

**CANCELLED** — will not be built. Records why. Identifiers stay reserved.

**SUPERSEDED** — replaced by another specification. Both files record the
relationship in `Supersedes` / `Superseded by`. The old specification is not
deleted or emptied; historical approved intent is never erased.

## Status transitions that require a change record

Once a specification has reached APPROVED_FOR_IMPLEMENTATION, any edit to an
approved requirement, acceptance criterion or scope statement requires a
`CHG-` entry. Returning to CLARIFYING or READY_FOR_PLAN after approval is
itself a change and is recorded.


## Machine-readable status

The status in `spec.md` is mirrored in `sdd.json` together with the full
`statusHistory`. The validator checks that the two agree (`SDD-V013`), that
every recorded transition is legal (`SDD-V018`), and that the current status
equals the last history entry (`SDD-V019`).

## Lightweight paths

R0 work needs no specification and no `SPEC-NNNN` directory. R1 work uses a
lightweight `SPEC-NNNN` directory: the applicable minimum, typically a short
`spec.md` and a `change-record.md`, with the heavy artefacts absent. It still
carries a `Status`, and it still moves through the lifecycle — most R1 changes
pass straight from `DRAFT` to `APPROVED_FOR_IMPLEMENTATION` with the author as
approver. Both levels obey the constitution. See
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` for exactly which artefacts each risk
level requires; that matrix is authoritative where this document is general.

## Authority / References

- `AGENTS.md` §2, §7, §8
- `docs/RISK_CLASSIFICATION.md` — authoritative risk model
- `docs/sdd/RISK_TO_PROCESS_MATRIX.md` — required artefacts per level
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — who approves what
- `docs/sdd/CHANGE_CONTROL.md`, `docs/sdd/ARTIFACT_AUTHORITY.md`
