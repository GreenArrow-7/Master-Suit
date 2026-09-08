# Agent Role and Gate Matrix

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`).

This document governs **AI session participation only**. It does not redefine
any human approval gate. `docs/sdd/HUMAN_APPROVAL_GATES.md` and
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` remain authoritative, and where this file
appears to differ from either, they win and this file is at fault.

## Required AI roles by risk

| | R0 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| Planner session | — | — | optional | required | required | required |
| Implementer session | optional | optional | required | required | required | required |
| Tester session | — | — | optional | optional | required | required |
| Security reviewer session | — | — | — | if security-sensitive | required, distinct from implementation | required, distinct |
| Independent reviewer | — | — | optional | **required** | required | required |
| Convergence reviewer | — | — | optional | required | required | required |
| Operations / release review | — | — | — | — | — | required |

"Required" means a session and its record must exist, not that an AI must
perform it. A human doing the work satisfies the row.

## Human gates, unchanged

| Gate | Who | AI participation |
|---|---|---|
| Specification approval | Product Owner or Solution Architect by risk | May draft; may not approve |
| Architecture approval | Solution Architect | May recommend |
| Security risk acceptance | Application Security | May analyse; **may not accept** |
| Data model / destructive migration | Solution Architect, DevOps, Human Release Authority | May prepare commands only |
| Implementation readiness (R4/R5) | Human | Agent stops and asks |
| Convergence acceptance (R3+) | Reviewer, QA, or Human Release Authority by risk | May recommend a verdict |
| Production release | Human Release Authority, every level | **Never** |
| Emergency change | Human Release Authority plus one | May prepare; may not authorise |
| Accepted residual risk | Application Security, Product Owner or DevOps | May draft; may not accept |

## Separation of duty

| Risk | Rule | Enforced by |
|---|---|---|
| R0–R2 | Self-review permitted | — |
| R3+ | Implementer is not the sole reviewer of its own work | `SDD-V051` |
| R4–R5 | Security review distinct from implementation | `SDD-V051`, plus a distinct session |

Distinctness is checked structurally: the review record's actor must differ
from the executing session's actor, and the reviewing session must not be the
executing session.

Read `docs/sdd/AGENT_ROLE_MODEL.md` on what separate sessions do and do not
buy. Two sessions of one model are better than one, and are not two
reviewers.

## Preflight by role

```bash
node tools/sdd/cli.mjs agent preflight --spec SPEC-NNNN --role ROLE [--task TASK-NNN]
```

Preflight fails, and no session is authorised, when the role is unknown, the
lifecycle does not permit that role, the task is missing or withdrawn, the
task declares no scope, the task cites no requirement, the task names no
required test, a declared path is unsafe, a required implementation approval
is absent at R4 or R5, or any blocking structural validation error exists.

## Authority / References

- `docs/RISK_CLASSIFICATION.md` — **authoritative** risk model
- `docs/sdd/RISK_TO_PROCESS_MATRIX.md` — **authoritative** artefacts and gates
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — **authoritative** human gates
- `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_SESSION_STANDARD.md`
