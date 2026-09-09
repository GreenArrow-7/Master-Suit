# Convergence validation audit

## What is enforced

| Rule | Enforces | Test |
|---|---|---|
| `SDD-V031` | A convergence artefact exists once the lifecycle reaches `CONVERGED` | indirect, shares the required-artefact path |
| `SDD-V032` | No `CONV-` finding is OPEN while `CONVERGED` or beyond | passes |
| `SDD-V033` | The verdict is one of the three permitted values | passes |

## Permitted verdicts

`PASS`, `PASS WITH ACCEPTED LIMITATIONS`, `FAIL`. Anything else is a finding.
A specification cannot invent a fourth verdict such as "mostly fine" to
describe work that did not converge.

## The rule that matters

`SDD-V032` closes the most tempting shortcut in the whole process: declaring
convergence while findings remain open. A `CONV-` finding whose status line
reads OPEN blocks the `CONVERGED` state mechanically. The route forward is to
resolve it, or to mark it `ACCEPTED_RISK` with a named human owner, which is
a decision somebody signs rather than a status nobody notices.

## Applied to this phase

`SPEC-0001` reached `CONVERGED` with three findings, none OPEN: `CONV-001`
the deferred CI gate, `ACCEPTED_RISK` owned by DevOps; `CONV-002` the
`SDD-V030` validator defect, `RESOLVED`; `CONV-003` the artefact defects in
this specification, `RESOLVED`. The verdict is PASS WITH ACCEPTED
LIMITATIONS, and it awaits a reviewer, because at R3 an agent recommends and
a human accepts.

## What is not enforced

Whether the convergence report is honest. A specification can pass every
structural check with a report that overlooks something. The validator checks
that findings are closed, not that the right findings were raised.

## Evidence Sources

E1: `tools/sdd/lib/traceability.mjs`, `tools/sdd/lib/validate.mjs`.
E3: the `SDD-V032` and `SDD-V033` tests.
E4: `specs/SPEC-0001-sdd-verification-enforcement/convergence.md`.
