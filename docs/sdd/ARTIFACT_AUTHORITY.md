# Artifact Authority

`NORMATIVE — engineering process requirement.` Defines which artefact decides
what, and what happens when two disagree.

## The authority order

```text
ENGINEERING CONSTITUTION            AGENTS.md
        ↓                           safety, security and process floor
APPROVED SPECIFICATION              spec.md — intended behaviour (WHAT / WHY)
        ↓
APPROVED CLARIFICATIONS             clarifications.md — resolved ambiguity
        ↓
TECHNICAL PLAN                      plan.md — approach (HOW)
        ↓
THREAT MODEL / TEST PLAN            threat-model.md, test-plan.md — risks and proof obligations
        ↓
TASKS                               tasks.md — bounded units of work
        ↓
IMPLEMENTATION                      code, tests, migrations, documentation
        ↓
TRACEABILITY / CONVERGENCE          traceability.md, convergence.md — proof of alignment
```

Each level is bound by every level above it. Nothing below the constitution
may relax a constitutional control, and no artefact at any level authorises an
agent to approve a production release.

## What each artefact is allowed to decide

| Artefact | Decides | Must not decide |
|---|---|---|
| `AGENTS.md` | The non-negotiable floor: security, database, testing, dependency and production rules | Feature behaviour |
| `spec.md` | What the system must do, for whom, and why; acceptance criteria | How it is built, unless a constraint is genuinely mandatory |
| `clarifications.md` | The chosen reading of an ambiguity, with its decision owner | New requirements unrelated to the ambiguity |
| `plan.md` | Approach, affected components, technical decisions (`AD-`), sequencing | The requirements themselves |
| `threat-model.md` | Threats, controls, residual risk | Whether a security requirement applies |
| `test-plan.md` | How each requirement will be proven | What correct behaviour is |
| `tasks.md` | Bounded work with an allowed scope | New scope, new requirements |
| Implementation | Nothing. It conforms | Anything |
| `traceability.md` / `convergence.md` | Whether alignment was achieved | Whether misalignment is acceptable — that is a human decision at R4/R5 |

## Rules

1. **A lower artefact never overrides a higher one.** A plan that cannot
   satisfy a requirement does not amend the requirement; it raises a change
   record.
2. **The plan may not silently modify the spec.** If planning reveals the
   requirement is wrong, impossible, or ambiguous, stop and either raise a
   clarification (`CL-`) or a change record (`CHG-`).
3. **Tasks may not expand scope.** A task must cite the requirement or the
   approved technical decision it serves. A task citing neither is treated as
   scope expansion and is rejected in review.
4. **Tests may not redefine intended behaviour.** If a test and a requirement
   disagree, the requirement wins until a change record says otherwise.
   Changing a test to match the code it is testing is prohibited by
   `AGENTS.md` §5 and by this rule.
5. **Implementation does not become the requirement merely by existing.** Code
   that does something the spec never asked for is unrequested behaviour, and
   convergence must report it.
6. **Existing production behaviour does not automatically win.** In a
   brownfield system, current behaviour is evidence of what is, not proof of
   what should be. Where an approved requirement contradicts observed
   behaviour, the contradiction is recorded and a human decides whether the
   code or the requirement changes.
7. **Approved requirements change only through change control.**
   `docs/sdd/CHANGE_CONTROL.md`.
8. **An unresolved material ambiguity blocks progression.** It is not resolved
   by the agent choosing the more convenient reading.

## When reality contradicts the specification

This is the normal brownfield case and must not be resolved silently.

```text
1. Record the contradiction. If it is a disagreement between evidence sources
   about what the system currently does, it is an evidence conflict:
   add it to docs/EVIDENCE_CONFLICTS.md with a new EVC id.
   If it is a disagreement between approved intent and observed behaviour,
   record it in the spec's clarifications or, after approval, as a CHG.
2. Classify: is the code wrong, or is the requirement wrong?
3. Decide who owns that answer (docs/sdd/HUMAN_APPROVAL_GATES.md).
4. Take the outcome through the matching process: a defect goes through
   docs/sdd/BUG_WORKFLOW.md; a requirement change goes through change control.
5. Never edit the approved requirement to match the code without a change
   record. That erases the disagreement instead of resolving it.
```

## How evidence conflicts interact with SDD artefacts

The `EVC` register (`docs/EVIDENCE_CONFLICTS.md`) records where sources
disagree about the current system. It is upstream of specifications, not part
of them.

- A specification **may cite** an EVC as motivation or as a known uncertainty.
- A specification **may not close** an EVC. Only the conflict's stated
  verification closes it, recorded in its own register.
- An open **C4 or release-blocking** EVC touching the area a specification
  changes must be listed in that specification's Risks section, and the
  approval record must show the approver saw it.
- If implementation work resolves an EVC as a side effect, convergence records
  the finding and the register is updated in its own right, preserving the
  original disagreement per the register's rules.
- Phase B1 closed no existing conflict. All fourteen remain as Phase A left
  them.


## Machine validation

Structural conformance to this authority model is checked by
`node tools/sdd/cli.mjs validate --all`. The validator confirms that the
artefacts exist, that identifiers resolve, that tasks cite requirements and
that approvals carry a human actor type. It does not judge whether an
artefact is any good, and a passing run is not a substitute for review. Rules:
`docs/sdd/VALIDATION_RULES.md`. Limits and governance:
`docs/sdd/ENFORCEMENT_STANDARD.md`.

## Precedence for current-state facts

Unchanged from Phase A and still authoritative:
direct implementation → executable configuration → automated tests →
repository documentation → structural inference. Runtime-only facts stay
`UNKNOWN — requires runtime/infrastructure verification`. An SDD artefact may
not upgrade a claim past its evidence, and a newly written process rule is
never presented as existing behaviour.

## Authority / References

- `AGENTS.md` — constitution, especially §2 (SDD direction) and §7 (production)
- `docs/RISK_CLASSIFICATION.md` — how much of this apparatus applies
- `docs/EVIDENCE_CONFLICTS.md` — the EVC register and its rules
- `docs/sdd/CHANGE_CONTROL.md`, `docs/sdd/HUMAN_APPROVAL_GATES.md`,
  `docs/sdd/SPEC_LIFECYCLE.md`
- Phase A evidence standard as recorded in
  `docs/evidence/phase-a-foundation/evidence-audit.md`
