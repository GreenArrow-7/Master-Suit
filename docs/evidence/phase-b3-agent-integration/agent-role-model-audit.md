# Agent role model audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07
**Method:** read `docs/sdd/AGENT_ROLE_MODEL.md` and `tools/sdd/lib/agent.mjs`,
then execute each role through the command line against the synthetic fixture.

## Roles declared

Seven, and the document and the code agree on all seven. `UT-145` asserts the
count and that every role has a non-empty set of permitted lifecycle states.

| Role | Permitted lifecycle states |
|---|---|
| `PLANNER` | `DRAFT`, `CLARIFYING`, `READY_FOR_PLAN`, `PLANNED` |
| `IMPLEMENTER` | `APPROVED_FOR_IMPLEMENTATION`, `IMPLEMENTING` |
| `TESTER` | `IMPLEMENTING`, `VERIFYING` |
| `SECURITY_REVIEWER` | `IMPLEMENTING`, `VERIFYING`, `CONVERGED` |
| `QA_REVIEWER` | `VERIFYING`, `CONVERGED`, `READY_FOR_RELEASE` |
| `CONVERGENCE_REVIEWER` | `VERIFYING`, `CONVERGED` |
| `ARCHITECTURE_REVIEWER` | `PLANNED`, `READY_FOR_APPROVAL`, `IMPLEMENTING`, `VERIFYING` |

## The two boundaries that matter

`IMPLEMENTER` is absent from `DRAFT` and from `READY_FOR_APPROVAL`. Those two
absences are what stop implementation beginning before its gate, and `UT-145`
asserts both directly rather than inferring them from the table.

## Observed behaviour

| Command | Result |
|---|---|
| `agent preflight --role IMPLEMENTER --task TASK-001` (state `IMPLEMENTING`) | authorised, exit 0 |
| `agent preflight --role SECURITY_REVIEWER` (state `IMPLEMENTING`) | authorised, exit 0 |
| `agent preflight --role PLANNER` (state `IMPLEMENTING`) | `SDD-V043`, exit 1 |
| `agent preflight --role ARCHITECT_OF_DESTINY` | `SDD-V042`, exit 1 |

An unknown role returns immediately without evaluating anything further, so an
invented role cannot inherit another role's permissions by accident.

## What this audit does not establish

The role model constrains **what an agent may do**. It does not make an AI a
qualified reviewer. `docs/sdd/AGENT_ROLE_MODEL.md` says so in its own words,
and the limitation is carried into `known-limitations.md`.

**Result:** the documented role model and the implemented one agree.
