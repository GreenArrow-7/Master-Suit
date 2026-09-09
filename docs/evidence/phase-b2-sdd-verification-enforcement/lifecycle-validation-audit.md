# Lifecycle validation audit

## What is enforced

`tools/sdd/lib/lifecycle.mjs` encodes the states and transitions that
`docs/sdd/SPEC_LIFECYCLE.md` defines. It is an encoding, not a second policy:
a change in one without the other is a defect, and the module says so.

| Rule | Enforces | Test |
|---|---|---|
| `SDD-V007` | `status` is one of the 14 defined states | passes |
| `SDD-V018` | Every consecutive pair in `statusHistory` is a legal transition | passes |
| `SDD-V019` | `status` equals the final history entry, and history is not empty | passes |
| `SDD-V013` | `status` agrees with `spec.md` | passes |
| `SDD-V017` | No clarification is OPEN at an implementation state | passes |

## States and transitions

Fourteen states: the eleven-step main path plus `ON_HOLD`, `CANCELLED` and
`SUPERSEDED`. Backward transitions are permitted where the lifecycle document
allows them — `VERIFYING` back to `IMPLEMENTING`, `CONVERGED` back to
`IMPLEMENTING` — because work that fails verification must be able to return.
`CANCELLED` and `SUPERSEDED` are terminal. `ON_HOLD` returns to any pausable
state.

## Status-aware artefact requirements

The design decision worth recording: artefact requirements depend on **both**
risk and status, not risk alone. A convergence report is not demanded of a
draft, and a plan is not demanded before `PLANNED`. Requiring every artefact
at every status would have produced false failures on every new specification,
which is the fastest way to make a validator ignored.

| Artefact | Required from | At risk |
|---|---|---|
| `spec.md` | always | R1+ |
| `plan.md`, `test-plan.md` | `PLANNED` | R2+ |
| `clarifications.md` | `PLANNED` | R3+ |
| `threat-model.md` | `PLANNED` | R4+ |
| `tasks.md`, `traceability.md` | `READY_FOR_APPROVAL` | R2+ |
| `convergence.md` | `CONVERGED` | R2+ |

## Evidence Sources

E1: `tools/sdd/lib/lifecycle.mjs`, `tools/sdd/lib/validate.mjs`.
E3: the `SDD-V007`, `SDD-V009`, `SDD-V013`, `SDD-V017`, `SDD-V018`,
`SDD-V019` tests.
E4: `docs/sdd/SPEC_LIFECYCLE.md`, `docs/sdd/RISK_TO_PROCESS_MATRIX.md`.
