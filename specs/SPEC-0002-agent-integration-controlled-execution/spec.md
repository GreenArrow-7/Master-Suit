# SPEC-0002 — Agent integration and controlled execution

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0002` |
| Title | Agent integration and controlled execution |
| Status | `VERIFYING` |
| Risk | `R3` |
| Owner | Solution Architect |
| Created | 2026-09-07 |
| Last updated | 2026-09-07 |
| Supersedes | none |
| Superseded by | none |

## Problem

Phase B2 made the specification artefacts machine-checkable, but nothing
constrains the agent that acts on them. An AI coding agent can today decide
for itself which task it is working on, edit any file it likes, declare its
own output correct, and write a review of its own work. Every control B1 and
B2 built sits in documents the agent is free to read and then ignore.

The failure this invites is specific: an agent that quietly widens scope,
marks itself complete, and produces a review record that looks like
independent verification.

## Goal

A small deterministic control plane that binds an agent to an approved task:
it cannot start without passing preflight, cannot edit outside declared
scope without detection, cannot satisfy a human gate, and cannot review its
own work where separation is required.

## Background and context

`SPEC-0001` delivered the validator. This specification extends the same
tooling rather than adding a parallel framework. The repository is
brownfield, with an uncommitted UI redesign in the working tree that must not
be disturbed, and B2 carries seven known limitations that B3 does not close.

## Scope

- Functional agent roles and their permissions.
- A machine-readable agent session record, plus verification and review
  records, with schemas and templates.
- Preflight, session creation, scope checking, verification checking and
  review checking, as subcommands of the existing CLI.
- Repository drift detection.
- New validation rules, allocated after the highest existing identifier.
- Synthetic fixtures and automated tests, valid and invalid.
- Standards for handoff, context loading and stopping.

## Out of scope

- Any real product feature. B3 is not a pilot.
- Any change to application source, schema, migrations, dependencies or
  runtime configuration.
- Promotion of `SDD-V041` from warning to error.
- An autonomous multi-agent platform. The deliverable is a control plane an
  agent follows, not an orchestrator.
- Modifying `.github/workflows/sdd-validate.yml` to run the new tests.
  That is R5 and the authorisation for this phase explicitly withholds
  infrastructure approval. See `CL-005`.

## Actors

| Actor | Interaction |
|---|---|
| Planner agent | Reads the specification, produces a plan |
| Implementer agent | Executes one approved task within declared scope |
| Tester agent | Runs the test plan and records results |
| Security reviewer agent | Reviews against `SEC-` requirements and the threat model |
| Independent reviewer agent | Reviews another session's output |
| Convergence reviewer agent | Compares all artefacts, recommends a verdict |
| Human | Approves, accepts convergence, authorises release. Never replaced |

## User stories

As a reviewer, I need to know an agent could not have started work without a
task that exists and a lifecycle state that permits it.

As a release authority, I need a review record written by an AI to be
structurally incapable of satisfying a gate that requires a human.

As a maintainer with uncommitted work in the tree, I need an agent session to
detect that the repository moved rather than overwrite what I was doing.

## Functional requirements

- `FR-001` — Preflight must deterministically refuse to authorise a session
  when the specification, manifest, risk, lifecycle state, task, required
  artefacts, clarifications, approvals, task linkage, declared scope or
  required tests are missing or invalid, and must exit non-zero.
- `FR-002` — Session creation must record specification, role, task
  identifiers, starting commit, allowed and prohibited paths, required tests
  and required approvals in a machine-readable file.
- `FR-003` — Session creation must not authorise implementation when
  preflight fails.
- `FR-004` — Scope checking must compare files changed against a git base to
  the task's declared allowed paths and report any file outside them.
- `FR-005` — Scope checking must reject an unsafe declared path: absolute,
  traversing, or escaping the repository by symbolic link.
- `FR-006` — Repository drift detection must compare the current state
  against the session's starting commit and report rather than overwrite.
- `FR-007` — Verification records must be validated for structure and for
  references to tests that exist in the test plan.
- `FR-008` — Review records must be validated for structure, for reference to
  an execution session that exists, and for separation of duty.
- `FR-009` — Every agent finding must carry a stable rule identifier
  allocated after the highest existing one, with no renumbering of B2 rules.
- `FR-010` — Agent commands must offer text and JSON output and use the
  existing exit-code contract: 0 clean, 1 finding, 2 tooling failure.

## Non-functional requirements

- `NFR-001` — Node standard library only. No dependency may be added.
- `NFR-002` — Identical results on Windows and POSIX path forms, including
  separator and case differences where the platform is case-insensitive.
- `NFR-003` — Deterministic output: same inputs, same findings, same order.
- `NFR-004` — The agent commands extend `tools/sdd/`; no parallel framework.

## Security requirements

- `SEC-001` — All agent records are untrusted input. No dynamic execution,
  no shell, no interpolation of record values into commands.
- `SEC-002` — A declared path that is absolute, contains a traversal segment,
  or resolves outside the repository must be rejected, not followed.
- `SEC-003` — A git reference supplied to an agent command must be validated
  before use, so it cannot be read as an option.
- `SEC-004` — A review or approval record whose actor type is `ai` must never
  satisfy a gate that requires a human.
- `SEC-005` — An execution session's own actor must not satisfy the
  independent-review requirement for its own work.
- `SEC-006` — Agent records and command output must not carry secrets, and
  must not store command output beyond what a finding needs.

## Data and privacy requirements

- `DATA-001` — Agent tooling is read-only with respect to the repository,
  except for the session, verification and review records it is explicitly
  asked to create under the owning specification.
- `DATA-002` — No agent command may read `.env` files or application data.

## Observability requirements

- `OBS-001` — Every agent finding carries a rule identifier and severity.
- `OBS-002` — A session records what was executed and what resulted, so a
  reviewer can reconstruct the work without the chat transcript.

## Failure behaviour

Preflight failure exits 1 and no session is authorised. A malformed record is
a finding, not a crash. A tooling failure exits 2 and is distinguishable from
a finding. Drift is reported as requiring review, never resolved by
overwriting.

## Edge cases

A task with no declared scope; a session naming a specification other than
its directory; a review naming a session that does not exist; a verification
citing a test absent from the test plan; a symlink inside an allowed
directory pointing outside it; a Windows-style path in a record read on
POSIX; an empty diff.

## Acceptance criteria

- `AC-001` — Preflight refuses every invalid case in the test plan and exits
  non-zero. *(covers `FR-001`, `FR-003`)*
- `AC-002` — A file changed outside declared scope produces a finding.
  *(covers `FR-004`)*
- `AC-003` — A traversing or symlink-escaping declared path is rejected.
  *(covers `FR-005`, `SEC-002`)*
- `AC-004` — An AI-authored review cannot satisfy a human-required gate.
  *(covers `SEC-004`)*
- `AC-005` — A session's own actor cannot discharge independent review of its
  own work. *(covers `SEC-005`)*
- `AC-006` — Drift against the starting commit is reported, not overwritten.
  *(covers `FR-006`)*
- `AC-007` — The B2 validator and its tests still pass unchanged.
  *(covers `NFR-004`)*
- `AC-008` — This specification validates with zero errors. *(covers all)*

## Dependencies

`SPEC-0001` and the tooling it delivered. Node ≥22.

## Assumptions

- Separate agent sessions improve independence but do not create
  organisational independence. Recorded as a limitation, not a control.
- Agents will follow `AGENTS.md`. The tooling raises the cost of not doing
  so; it cannot compel behaviour outside its own commands.

## Open questions

See `clarifications.md`. `CL-001` to `CL-005` are `INCORPORATED`.

## Risks

The central risk is overclaiming: presenting structural checks as proof of
independence or correctness. Mitigated by stating the limits in every
document that could be misread. Open evidence conflicts touching this area:
none.

## Rollback and reversibility expectations

Fully reversible. Delete `tools/sdd/lib/agent.mjs`, the agent subcommands,
the new rules, the agent documents and this specification directory. No
migration, no runtime change, no deployment.

## Implementation constraints

Node standard library only. No file under `apps/`, `.github/`,
`infrastructure/` or any manifest may be modified.

## Evidence and existing-system references

- `VERIFIED` — `tools/sdd/rules/rules.mjs` — highest existing rule is
  `SDD-V041`; new rules start at `SDD-V042`.
- `VERIFIED` — `tools/sdd/lib/markdown.mjs` — existing identifier prefixes,
  extended rather than replaced.
- `VERIFIED` — `.github/workflows/sdd-validate.yml` — runs
  `tools/sdd/tests/validator.test.mjs` only; agent tests would need a
  workflow change.
- `VERIFIED` — `git status` — 36 pre-existing application changes in the
  working tree, which drift detection must tolerate.

Every requirement adds behaviour in new files. None changes existing
application behaviour.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| 2026-09-07 | Created | Solution Architect | — |

## Approval

**Every gate that R3 requires is UNRESOLVED.** The authorisation for Phase B3
states explicitly that it does not constitute DevOps infrastructure approval,
Application Security risk acceptance, or the assignment of any person to a
functional approval role. No Product Owner or Solution Architect approval
exists for this specification.

Two entries below were corrected by `CHG-002` after the R3 approval rule was
determined. Both moved from a softer description to a stricter one.

| Gate | Role | Decision | Date | Basis |
|---|---|---|---|---|
| Specification approval | Product Owner or Solution Architect | **APPROVED** | 2026-09-08 | Gate 1 at R3, decision `D1`. Specific role not stated by the approver |
| Architecture approval | Solution Architect | **APPROVED** | 2026-09-08 | Gate 2, decision `D3` |
| Security risk acceptance | Application Security | **ACCEPTED** | 2026-09-08 | Gate 3, decision `D4`, with compensating controls recorded |
| Convergence acceptance | Reviewer | **NOT TAKEN** | — | Gate 6 at R3, `D10`, explicitly withheld |
| Accepted residual risk | by limitation type | **RECORDED** | 2026-09-08 | Gate 9, decisions `D4`, `D5`, `D7` |
| Implementation readiness | — | **not required at R3** | — | Gate 5 applies at R4 and R5 only. Confirmed, not changed |
| Data model / migration | — | not applicable | — | No schema change |
| Production release | — | not applicable | — | Nothing is released |

**What was crossed, and what was not.** R3 requires **no**
implementation-readiness approval; six sources including
`tools/sdd/lib/lifecycle.mjs` agree, and an agent is permitted to execute at
R3. That gate was not crossed because it does not exist here. This question is
unambiguous.

Whether the **specification-approval** gate was required before implementation
is a separate question and is **not** settled: `EVC-015` records two normative
statements that select different approvers at R3.

The **specification-approval** gate was crossed. This specification entered
`APPROVED_FOR_IMPLEMENTATION` with no Product Owner or Solution Architect
approval recorded, on a written requester instruction instead. That
instruction is a real human decision to do the work; it is not a
role-specific approval, and it is not recorded as one.

The deviation is tracked as `CONV-004` rather than papered over. No approval
record was fabricated: `approvals` in `sdd.json` is empty.

**`EVC-015` has since been resolved.** The Solution Architect selected Option
A (`D2`, 2026-09-08): an R3 specification requires approval by a Product Owner
or Solution Architect before implementation begins. Under that policy the gate
recorded above was required, this specification crossed it, and `D1` supplies
the approval. Six governing documents were corrected so they stop
contradicting each other. See the register and
`docs/evidence/phase-b3-agent-integration/r3-approval-rule-resolution.md`.
