# Spec-Driven Development — operating guide

`NORMATIVE — engineering process requirement.` This is the entry point for
engineers and AI agents working on YOUHAN ONE. It describes the process
introduced in Phase B1. It makes no claim about existing application
behaviour; current-state facts live in the Phase A documentation it cites.

Governing principle: **intent becomes an explicit specification before
implementation, implementation stays bounded by approved artefacts, and
completion is proven through traceability and convergence rather than declared
by whoever wrote the code.**

## Is SDD required for this request?

Classify first, with `docs/RISK_CLASSIFICATION.md`.

| The request is | Handling |
|---|---|
| A question, an explanation, a code reading | No SDD. Answer it |
| An experiment that will never merge (R0) | No SDD. Notes only |
| A cosmetic or docs-only change (R1) | A lightweight `SPEC-NNNN/` directory: short `spec.md`, plus `change-record.md` if anything moves later. No plan, threat model or full test plan |
| A normal application change (R2) | Short specification, plan, tasks, tests, light traceability |
| Backend or business logic (R3) | Full specification, plan, test plan, traceability, review, and **specification approval by a Product Owner or Solution Architect before implementation begins**. No separate implementation-readiness approval |
| Security or data-sensitive (R4) | Everything at R3 plus a threat model, security tests, and **human approval before implementation** |
| Production-critical, destructive or infrastructure (R5) | Everything at R4 plus an operational plan, rollback and recovery, production-readiness verification, and human execution |
| A defect | `docs/sdd/BUG_WORKFLOW.md` |
| A live incident | `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md` |

The exact artefacts and gates per level are in
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`.

## The sequence

```text
REQUEST → RISK → SPEC → CLARIFY → PLAN → SECURITY/TEST DESIGN → TASKS
→ TRACEABILITY → VALIDATE SDD ARTEFACTS → APPROVAL → IMPLEMENT → VERIFY
→ CONVERGE → VALIDATE AGAIN → RELEASE GATES
```

Detail and STOP conditions: `docs/sdd/CHANGE_WORKFLOW.md`.

**Where approval sits in that sequence.** Material implementation must not
begin until the specification has reached the approval state required by its
risk level. Everything to the left of `APPROVAL` — writing the specification,
clarifying it, planning, threat modelling, test design, task breakdown,
traceability — happens before approval exists and is never blocked by this
rule. An agent may do all of it unprompted. What it may not do is start
implementing ahead of the gate, or grant the gate itself.

## Machine validation

```bash
node tools/sdd/cli.mjs validate --all
```

Run it three times: before requesting approval, after implementation, and
before claiming convergence. A blocking finding stops the work until it is
fixed; it is never edited away, downgraded or excepted without the process in
`docs/sdd/VALIDATION_EXCEPTIONS.md`.

The validator checks structure, not quality. It can tell you an R4
specification has no threat model. It cannot tell you the threat model is
good. Rules: `docs/sdd/VALIDATION_RULES.md`. Limits:
`docs/sdd/ENFORCEMENT_STANDARD.md`.

## Running an agent session

Introduced by Phase B3 (`SPEC-0002`). Any material change executed by an AI
agent runs inside a session.

```bash
node tools/sdd/cli.mjs agent preflight      --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
node tools/sdd/cli.mjs agent create-session --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
node tools/sdd/cli.mjs agent scope-check    --spec SPEC-NNNN --session ASES-NNNN
node tools/sdd/cli.mjs agent verify-session --spec SPEC-NNNN --session ASES-NNNN
node tools/sdd/cli.mjs agent review-check   --spec SPEC-NNNN
```

Preflight decides whether the role may act at all: the role must be known, the
lifecycle must permit it, the task must exist and declare a safe scope, and no
blocking validation error may be outstanding. **When preflight fails, no
session is authorised and `create-session` refuses to write one.** There is no
override flag.

The agent works, then records what happened: an `ASES` session record, a
`VER` verification record for the tests, and at R3 and above a `REV` review
record written by a different actor. Scope, drift, verification and separation
are then checked mechanically by `SDD-V042` to `SDD-V058`.

Three claims stay distinct throughout, and the tooling refuses to merge them:

| Claim | Who makes it |
|---|---|
| The assigned scope was executed | The implementing agent |
| The required tests ran and passed | A verification record |
| The work is accepted | A human, from R3 upward |

Standards: `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_SESSION_STANDARD.md`,
`AGENT_EXECUTION_RECORD.md`, `AGENT_ROLE_GATE_MATRIX.md`,
`AGENT_HANDOFF_STANDARD.md`, `AGENT_CONTEXT_STANDARD.md`,
`AGENT_STOP_PROTOCOL.md`.

## Where things live

`specs/SPEC-NNNN-short-slug/` holds one specification and its artefacts:
`spec.md`, `clarifications.md`, `plan.md`, `threat-model.md`, `test-plan.md`,
`tasks.md`, `traceability.md`, `convergence.md`, `change-record.md`, and
`sdd.json` carrying machine-readable process metadata.
Agent execution records live under `execution/` in the same directory, one
JSON file per `ASES`, `VER` or `REV` identifier.
The directory never moves; status lives inside the file. Templates are in
`specs/templates/`. Conventions: `specs/README.md`.

## Which artefact decides what

`AGENTS.md` → specification → clarifications → plan → threat model and test
plan → tasks → implementation → traceability and convergence. Lower never
overrides higher. The plan cannot amend the spec, tasks cannot add scope,
tests cannot redefine behaviour, and code does not become the requirement by
existing. Full rules: `docs/sdd/ARTIFACT_AUTHORITY.md`.

## Lifecycle

`DRAFT → CLARIFYING → READY_FOR_PLAN → PLANNED → READY_FOR_APPROVAL →
APPROVED_FOR_IMPLEMENTATION → IMPLEMENTING → VERIFYING → CONVERGED →
READY_FOR_RELEASE → RELEASED`, plus `ON_HOLD`, `CANCELLED`, `SUPERSEDED`.
Entry and exit criteria: `docs/sdd/SPEC_LIFECYCLE.md`.

## Identifiers

`SPEC-0001`; inside it `FR-`, `NFR-`, `SEC-`, `DATA-`, `OBS-`, `AC-`, `CL-`,
`AD-`, `TH-`, `CTRL-`, `UT-`, `IT-`, `E2E-`, `ST-`, `PT-`, `REG-`, `TASK-`,
`CHG-`, `CONV-`. Outside the owning spec use `SPEC-0001/SEC-003`. Never
renumber, never reuse. Full rules and the collision hazard with the existing
`SEC-OBS-` register: `docs/sdd/IDENTIFIER_STANDARD.md`.

## Human approval

An agent may analyse, prepare, validate, recommend and generate commands. It
may never grant itself an approval, and it may never authorise or perform a
production release. Nine gates, by risk level:
`docs/sdd/HUMAN_APPROVAL_GATES.md`.

## Change control

After approval, requirements change only through a `CHG-` record.
Seven change types, from `MINOR CLARIFICATION` to `BREAKING CHANGE`.
Historical approved intent is never erased; a redesign supersedes rather than
overwrites. `docs/sdd/CHANGE_CONTROL.md`.

## Traceability and convergence

Requirement → plan decision → task → code → test → result. The matrix must be
able to fail: a requirement with no test, a security requirement with no
security verification, a task with no requirement, implementation outside
approved scope. `docs/sdd/TRACEABILITY_STANDARD.md`.

Convergence then asks whether specification, plan, implementation and
verification actually agree, and produces `PASS`, `PASS WITH ACCEPTED
LIMITATIONS` or `FAIL`. Passing tests alone are not completion.
`specs/templates/CONVERGENCE_TEMPLATE.md`.

## Brownfield rules

This is a production system with substantial existing behaviour.

1. Read the existing implementation before specifying a change to it, and
   cite it in the specification's Evidence section.
2. State for each requirement whether it preserves, changes or replaces
   current behaviour.
3. Existing behaviour is evidence of what is, not proof of what should be.
   Where an approved requirement and observed behaviour disagree, record the
   contradiction and let a human decide which changes.
4. Where two sources disagree about what the system currently does, that is an
   evidence conflict: register it in `docs/EVIDENCE_CONFLICTS.md`. A
   specification may cite an `EVC` but may not close one.
5. Existing platform guarantees are cited, not restated. Tenant isolation,
   permission scope and audit are documented in
   `docs/security/AUTHORIZATION.md`, `docs/security/SECURITY_MODEL.md` and
   `docs/architecture/DATABASE.md`.
6. Fourteen evidence conflicts are open, one of them `C4` and one
   release-blocking. Phase B1 closed none of them. A specification touching an
   affected area lists the relevant conflict in its Risks section.

## Evidence standards inside specifications

The Phase A evidence hierarchy applies to every current-state claim an SDD
artefact makes: direct implementation, then executable configuration, then
automated tests, then repository documentation, then structural inference.
Runtime-only facts are marked
`UNKNOWN — requires runtime/infrastructure verification`. A claim is never
written stronger than its evidence, and a newly written process rule is never
presented as existing behaviour.

Where an artefact states a rule this process introduces, label it
`NORMATIVE — engineering process requirement`. Where it states a fact about
the system, label it `VERIFIED`, `TESTED`, `DOCUMENTED`, `INFERRED` or
`UNKNOWN`.

## Worked example, deliberately not a real feature

A request arrives: "let account managers see the calls their team made."

1. **Risk.** Touches visibility scope, so `src/lib/security/*` is in play.
   R4, not R2.
2. **Specification.** `FR-` for the listing behaviour; `SEC-` stating which
   scope value governs and that no cross-tenant row is reachable; `DATA-` for
   what a call record exposes; `AC-` a manager sees exactly their team's
   calls and nothing else.
3. **Clarification.** `CL-001` does "team" mean the existing `TEAM` scope or
   reporting line. `CL-002` what about a manager of two teams. `CL-003` what
   about calls made before the manager joined. Each with a decision owner.
4. **Plan.** `AD-001` reuse `visibilityWhere` rather than a bespoke filter,
   citing the requirement it serves.
5. **Threat model.** `TH-001` a manager escalates by editing team membership;
   `CTRL-001` the existing permission check on membership changes, verified by
   `ST-001`.
6. **Test plan.** Happy path, the negative case of another team's calls, a
   cross-tenant case, an empty-team case.
7. **Tasks.** Small, each citing its requirement.
8. **Approval.** R4, so a human approves before implementation starts.
9. **Implement, verify, converge**, then release through the existing path,
   authorised by a human.

No specification directory is created for this example. Phase B1 creates no
`SPEC-0001`.

## Authority / References

- `AGENTS.md` — engineering constitution, and the source of every prohibition
  restated here
- `docs/RISK_CLASSIFICATION.md` — authoritative risk model
- All documents under `docs/sdd/`, and `specs/README.md`
- `docs/sdd/AGENT_ROLE_MODEL.md` and the sibling agent standards — how an AI
  agent participates
- Phase A documentation: `docs/SYSTEM_INVENTORY.md`, `docs/architecture/`,
  `docs/security/`, `docs/operations/`, `docs/standards/`
- `docs/EVIDENCE_CONFLICTS.md`, `docs/PHASE_A_GAP_ANALYSIS.md`
- `docs/evidence/phase-a-foundation/` — the accepted Phase A baseline
