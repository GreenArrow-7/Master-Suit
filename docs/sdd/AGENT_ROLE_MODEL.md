# Agent Role Model

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`). Defines the functional roles an AI agent may occupy, and what
each may and may not do.

The governing rule: **an agent may execute approved work, but it does not
decide what it is allowed to execute, it does not approve itself, and it does
not decide whether its own output passed.**

## Roles

### PLANNER

**Purpose:** understand the specification and produce the technical plan.

May inspect the repository, analyse architecture, identify affected
components and risks, and propose technical decisions as `AD-` entries.

May **not** implement before the implementation gate, approve its own plan, or
change a requirement. A plan that cannot satisfy a requirement raises a
clarification or a change record; it never amends the specification.

Permitted lifecycle states: `DRAFT`, `CLARIFYING`, `READY_FOR_PLAN`, `PLANNED`.

### IMPLEMENTER

**Purpose:** execute approved task identifiers.

May modify only files inside the task's declared allowed scope, create or
update the tests the task requires, and update its own execution record.

May **not** silently expand scope, create requirements, grant approvals, or
accept convergence. Work that needs more than its declared scope stops and
raises a change record.

Permitted lifecycle states: `APPROVED_FOR_IMPLEMENTATION`, `IMPLEMENTING`.

### TESTER

**Purpose:** verify requirements independently of implementation intent.

May execute the defined tests, implement a test the plan already specifies,
and report failures.

May **not** rewrite a requirement to match the code, weaken an expected
outcome, or change implementation to manufacture a pass. A failing test is
fixed through a separate approved task, never by editing the assertion.

Permitted lifecycle states: `IMPLEMENTING`, `VERIFYING`.

### SECURITY_REVIEWER

**Purpose:** review security-sensitive implementation against `SEC-`
requirements, the threat model and its controls.

May inspect, raise findings, recommend remediation and request security tests.

May **not** modify requirements, accept residual risk on its own authority, or
grant a human security approval.

Permitted lifecycle states: `IMPLEMENTING`, `VERIFYING`, `CONVERGED`.

### QA_REVIEWER

**Purpose:** review acceptance criteria, regression impact, verification
completeness, release readiness and rollback evidence.

May **not** grant production release authority. That is the Human Release
Authority, at every risk level, without exception.

Permitted lifecycle states: `VERIFYING`, `CONVERGED`, `READY_FOR_RELEASE`.

### CONVERGENCE_REVIEWER

**Purpose:** compare specification, plan, tasks, code, tests and results, and
produce `CONV-` findings with a recommended verdict.

May **not** accept its own convergence where human acceptance is required,
which is R3 and above.

Permitted lifecycle states: `VERIFYING`, `CONVERGED`.

### ARCHITECTURE_REVIEWER

**Purpose:** review architectural impact independently of the implementing
agent.

Permitted lifecycle states: `PLANNED`, `READY_FOR_APPROVAL`, `IMPLEMENTING`,
`VERIFYING`.

## Separation of duty

**At R3 and above**, the implementer must not be the sole reviewer of its own
work. A review record whose actor equals the executing session's actor, or
whose reviewer session is the executing session, is rejected (`SDD-V051`).

**At R4 and R5**, security review must be logically distinct from
implementation: a different session, and a review record that names it.

Separation may be achieved through separate agent sessions even when the same
underlying AI product runs both.

## What separate sessions do and do not buy

This is the most misreadable claim in Phase B3, so it is stated plainly.

A separate session **does** remove shared working memory. The reviewing
session has not seen the implementer's reasoning, its discarded approaches, or
its rationalisations. That is a real improvement over self-review in one
conversation, and it is what `SDD-V051` enforces.

A separate session **does not** create organisational independence. The same
model carries the same priors, the same training, and the same blind spots
into the review. If it misread a requirement while implementing, it will
probably misread it the same way while reviewing. Two sessions of one model
are not two reviewers.

Where genuine independence matters — a security boundary, a destructive
migration, a production release — the reviewer must be a human, or at minimum
a different model, and the human gates in
`docs/sdd/HUMAN_APPROVAL_GATES.md` are unchanged by anything in this document.

Recorded as `SPEC-0002/TH-007`, an accepted-in-principle residual risk with no
technical mitigation.

## What the tooling can and cannot prove

**Can prove:** the role is known and permitted in the current lifecycle state;
the task exists and declares a scope; changed files sit inside that scope;
required artefacts and approval records exist; an approval record's actor type
is `human`; a review names a session that exists and a different actor.

**Cannot prove:** that a record marked `human` was written by a human; that
the plan is sound; that the code is correct; that the security review was
competent; that the reviewer is genuinely independent; that the tests are
semantically sufficient; that no unknown vulnerability remains.

Never blur this line. A green preflight means an agent was authorised to
start, not that the work is good.

## Authority / References

- `AGENTS.md` §7; `docs/sdd/HUMAN_APPROVAL_GATES.md`
- `docs/sdd/AGENT_ROLE_GATE_MATRIX.md` — which roles each risk level needs
- `docs/sdd/AGENT_SESSION_STANDARD.md`, `AGENT_STOP_PROTOCOL.md`
- `specs/SPEC-0002-agent-integration-controlled-execution/` — `CL-001`,
  `TH-007`
