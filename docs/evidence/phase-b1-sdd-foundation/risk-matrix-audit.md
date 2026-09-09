# Risk matrix audit

Verifies that `docs/sdd/RISK_TO_PROCESS_MATRIX.md` operationalises
`docs/RISK_CLASSIFICATION.md` without redefining it.

## The baseline is unchanged

`docs/RISK_CLASSIFICATION.md` was **not modified** by Phase B1.
`git status --porcelain -- docs/RISK_CLASSIFICATION.md` shows it exactly as
Phase A left it. Its six levels, its examples and its rigour table are the
authority; the B1 matrix states this explicitly and adds: "Where the two
appear to differ, `docs/RISK_CLASSIFICATION.md` wins and the difference is a
defect in this file."

## Row-by-row agreement

Phase A's rigour table has seven rows. Each is carried into the B1 matrix
without alteration:

| Phase A row | Carried into B1 as | Agreement |
|---|---|---|
| Spec depth (none → one line → short → full → full → full) | Artefact table, `spec.md` row | **matches** |
| Clarification step (no, no, if ambiguous, yes, yes, yes) | Artefact table, `clarifications.md` row | **matches** |
| Tests (none → visual → unit+regression → +tenant/permission → +security test → +staging rehearsal) | Artefact table, `test-plan.md` row, and the R4/R5 level notes | **matches** |
| Security review (no, no, self-check, self-check+flag, mandatory human, mandatory human) | Gate table, "Security review" row | **matches** |
| Human code review (optional, 1, 1, 1, 2 incl. security-literate, 2 + operator) | Gate table, "Human code review" row | **matches** |
| CI gates (—, verify, verify, +check:drift, +check:rls +check:raw-sql, +staging-first) | Gate table, "CI gates" row | **matches** |
| Production approval (n/a, normal, normal, normal, named approver, named approver + window) | Gate table, "Production release approval" row | **matches** |
| Rollback plan (n/a, implicit, implicit, written, tested in staging, rehearsed + restore path) | Artefact table, "Rollback plan" row | **matches** |

## What B1 adds, and whether it conflicts

B1 adds rows the Phase A table did not have. Each is an operational
consequence of an existing rule, not a new obligation invented at B1:

| Added row | Derived from |
|---|---|
| `plan.md`, `tasks.md`, `traceability.md`, `convergence.md`, `change-record.md` per level | `AGENTS.md` §2 and §8, which already required a written plan and proven completion |
| `threat-model.md` per level | Phase A's "explicit threat/abuse cases" at R4 |
| Production-readiness verification at R5 | Phase A's "runbook + blast radius + rehearsal plan" at R5 |
| "Approval before implementation may start" at R4/R5 | Phase A note: "R4 requires a human to accept the plan before implementation" |
| "Agent may execute" per level | Phase A note: "An AI agent may prepare any level, and may execute R0–R3 locally… R5 execution is human-only" |
| "Convergence verdict accepted by" per level | `AGENTS.md` §8, human review at the level the risk model requires |

**No added row contradicts the baseline.** Each was checked against the Phase A
notes section, which is where the three agent-execution rules already lived.

## Escalation triggers

B1 adds seven named triggers for mid-flight re-classification: touching
`src/lib/auth/*` or `src/lib/security/*`, moving tenant or permission scope, a
migration turning out destructive or long-locking, a new environment variable
in a deployed environment, a new outbound data flow, changes to retention,
audit or biometric handling, and blast radius ceasing to be obvious.

These operationalise the existing Phase A note that a change is classified by
the highest level any part of it touches. Escalation is recorded as a change
record, which prevents the failure mode of quietly staying at the original
level.

## Anti-gaming

`HUMAN_APPROVAL_GATES.md` states that reclassifying risk downward to avoid a
gate is a process violation, and `RISK_TO_PROCESS_MATRIX.md` opens with "do not
inflate", so the pressure is named in both directions. Over-classification
makes the process unusable; under-classification defeats it.

## Usability check

The B1 brief requires that trivial changes do not become bureaucratic. R0
requires no specification. R1 is normally a change record alone, with no
threat model unless the change is security-sensitive. R2 uses "short"
artefacts, defined as the mandatory sections existing at a line or two each.
`specs/README.md` states that artefacts a risk level does not require are
simply absent rather than created empty.

## Post-B1 correction pass (2026-09-07)

The R1 row was ambiguous: it allowed a change record to stand in for a
specification while every change record was defined as living inside a
`SPEC-NNNN/` directory. An R1 change therefore had no defined home.

Corrected to a single storage model, which adds a `SPEC-NNNN/ directory` row
to the artefact table:

| Level | Directory | Artefacts |
|---|---|---|
| R0 | none | notes only |
| R1 | required, lightweight | minimum applicable `spec.md`, plus `change-record.md` if anything moves later. No plan, threat model, test plan, tasks, traceability or convergence |
| R2+ | required | per the matrix, increasing with risk |

**This does not change the Phase A baseline.** `docs/RISK_CLASSIFICATION.md`
never specified where an artefact is stored; it specified how much rigour each
level needs. R1 rigour is unchanged: spec depth still "one line in the PR"
equivalent, no clarification step, no mandatory tests beyond a visual check,
no threat model unless security-sensitive, one reviewer. Only the storage
question, which the baseline left open, is now answered.

Escalation was clarified in the same pass: a change that turns out riskier
grows the same directory rather than restarting elsewhere, so the path and
number stay stable for traceability.

## Result

**PASS.** The matrix operationalises the baseline faithfully, adds only
derived obligations, and redefines nothing.

## Evidence Sources

E1: `docs/RISK_CLASSIFICATION.md` (unmodified), `docs/sdd/RISK_TO_PROCESS_MATRIX.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md`, `docs/sdd/SPEC_LIFECYCLE.md`,
`specs/README.md`; `git status` for the unmodified baseline.
E2: `apps/web/package.json`, `.github/workflows/ci.yml` for the CI gate names.
E4: `AGENTS.md` §2, §7, §8.
