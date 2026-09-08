# Enforcement Standard

`NORMATIVE — engineering process requirement.` Introduced by Phase B2
(`SPEC-0001`). Defines what the machine checks, what stays human, and how
enforcement tightens over time.

## 1. What is mechanically validated

Structure, presence, consistency and reference integrity: directory naming,
manifest validity, risk and lifecycle values, artefact existence and
containment, agreement between `sdd.json` and `spec.md`, identifier
uniqueness and resolution, legal lifecycle transitions, the presence and actor
type of approval records, task-to-requirement citation,
requirement-to-test coverage, security-requirement verification,
acceptance-criterion mapping, traceability reference integrity, convergence
finding status and verdict validity, and document reference existence.

The full list is `docs/sdd/VALIDATION_RULES.md`.

## 2. What remains human judgement

Everything that requires knowing whether the work is *good*:

- whether a requirement is the right requirement,
- whether a plan is a sound approach,
- whether a threat model found the threats that matter,
- whether a test proves what it claims,
- whether an accepted residual risk should have been accepted,
- whether a change is safe to release.

The validator can say an R4 specification has a `threat-model.md` with a
threat, a control and a verification. It cannot say the threat model is
adequate. Anyone who reads a green validator run as "this change is safe" has
misread it.

## 3. What remains AI-assisted judgement

An AI agent may draft artefacts, propose classifications, explain findings and
recommend fixes. It may not be the validator, may not decide whether its own
work passed, and may not approve anything. This restates `AGENTS.md` §7.

## 4. Blocking rules

Every `ERROR` rule blocks. In practice this is every structural rule over
actual SDD artefacts, which are new by definition, so nothing historical is
affected.

## 5. Advisory rules

`SDD-V010` (undeclared artefact on disk), `SDD-V038` (R1 carrying heavy
artefacts) and `SDD-V041` (changed application file with no associated
specification). `--strict` promotes warnings to errors for a local run without
changing the stored severity.

## 6. Transition from ADVISORY to ENFORCED

`sdd.config.json` carries `enforcementMode`, currently `ADVISORY`.

The repository contains substantial application work that predates SDD
entirely and an uncommitted UI redesign. Making `SDD-V041` blocking today
would fail that work for existing, which the Phase B2 brief forbids and which
would discredit the system on its first day.

**Legacy versus governed work.** Work merged before the first specification is
legacy: it is never retroactively required to have one. Work begun after
adoption is governed. The boundary is a date and a decision, not a
reconstruction of history. No specification will be manufactured for existing
code.

`SDD-V041` becomes blocking only when all of these hold, and a human records
the decision:

1. A real product feature has completed the full lifecycle through the
   process, so the workflow is known to be usable rather than assumed to be.
2. The six approval roles in `docs/sdd/HUMAN_APPROVAL_GATES.md` are assigned
   to people.
3. Validator CI enforcement exists and has been green on the default branch
   for a sustained period.
4. A legacy boundary is agreed and written down, so the rule applies forward
   rather than backward.
5. Product Owner and DevOps approve the promotion, recorded as a change.

Until then the rule reports and educates. That is its whole job.

## 7. False positives

A false positive is a defect in the validator, not an inconvenience to be
worked around. The response, in order:

1. Confirm it is genuinely false by reading the rule's intent here.
2. Raise it as a defect against the validator through
   `docs/sdd/BUG_WORKFLOW.md`. The fix is a change to the rule or its
   implementation.
3. If work is genuinely blocked while that happens, use the exception process
   in `docs/sdd/VALIDATION_EXCEPTIONS.md` — scoped, expiring and recorded.

What is not acceptable: editing artefacts to placate a rule you believe is
wrong, downgrading a severity locally, or deleting a fixture. If a rule is
wrong, fix the rule.

## 8. Governance of rule changes

The rule catalogue is a control, so changing it is a governed change.

- Adding a rule, or changing a severity from WARNING to ERROR: R3, Solution
  Architect approval.
- Changing an ERROR to a WARNING, or removing a rule: R4, because it weakens a
  control. Application Security approval is required, and the reasoning is
  recorded.
- An AI agent may propose any of these and may implement an approved change.
  It may never lower a severity on its own judgement.

Both `docs/sdd/VALIDATION_RULES.md` and `tools/sdd/rules/rules.mjs` change
together; either alone is a defect.

## 9. Exceptions

`docs/sdd/VALIDATION_EXCEPTIONS.md`. Scoped, justified, expiring, approved by
a human at R4 and R5, never self-approved by an agent, and never capable of
bypassing a production release control.

## 10. Versioning and review of the validator

The manifest carries `schemaVersion`, currently `1`. A breaking change to the
contract increments it, and the validator rejects versions it does not
support rather than guessing.

The validator is repository tooling that parses attacker-controlled pull
request content. It carries a threat model
(`specs/SPEC-0001-sdd-verification-enforcement/threat-model.md`) and a
security review in its evidence package. Changes to its parsing or path
handling are security-relevant and are reviewed as such.

## The limitation that matters most

A structured approval record proves a record exists. It does not prove a human
made the decision, because anyone who can commit can write the record. Real
assurance comes from commit authorship, code review and branch protection.
Branch protection on this repository is currently
`UNKNOWN — requires runtime/infrastructure verification` (GAP-CI-01). Until
that is confirmed, treat approval records as bookkeeping that makes an
omission visible, not as proof of human agency.

## Authority / References

- `AGENTS.md` §7, §8; `docs/RISK_CLASSIFICATION.md`
- `docs/sdd/VALIDATION_RULES.md`, `MACHINE_CONTRACT.md`,
  `VALIDATION_EXCEPTIONS.md`, `CI_ENFORCEMENT.md`, `HUMAN_APPROVAL_GATES.md`
- `docs/PHASE_A_GAP_ANALYSIS.md` — GAP-CI-01
- `sdd.config.json` — `enforcementMode`

## A rule that reports an immutable fact

Added by `SPEC-0002/TASK-015`.

`SDD-V060` reports that a specification approval is dated after implementation
began. Unlike most findings, **no edit to the artefact can clear it**: the
dates are history, and changing them would be falsification.

Such a rule is still an ERROR. The alternative — a warning — would let a real
governance breach sit permanently in the noise. Where it blocks a
specification the route is a scoped, expiring entry in
`docs/sdd/VALIDATION_EXCEPTIONS.md`, approved by a human, naming one rule and
one specification.

An agent may draft such an exception. It may not approve one, and it may not
soften a rule to avoid needing one.
