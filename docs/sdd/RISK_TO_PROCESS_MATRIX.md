# Risk-to-Process Matrix

`NORMATIVE — engineering process requirement.`

`docs/RISK_CLASSIFICATION.md` is the authoritative risk model and is **not**
redefined here. It defines the levels R0–R5, what belongs at each, and the
required rigour for spec depth, clarification, tests, security review, human
code review, CI gates, production approval and rollback. This document
operationalises that table into named SDD artefacts and gates.

Where the two appear to differ, `docs/RISK_CLASSIFICATION.md` wins and the
difference is a defect in this file.

## Classify first

Risk is determined before any implementation, by the highest level any part of
the change touches. A change that is R2 in application code but adds an
environment variable to a deployed environment is R5 for that part; split the
change or take the higher level. Do not inflate: most work is R1–R3.

## Required artefacts

**One storage model.** From R1 upward every change lives in its own
`specs/SPEC-NNNN-short-slug/` directory. R1 uses a *lightweight* one: only the
applicable minimum is written, and the heavy artefacts are simply absent. R0
needs no directory at all. There is no second place a change can live, and no
artefact is orphaned outside a specification.

| Artefact | R0 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| `SPEC-NNNN/` directory | — | required (lightweight) | required | required | required | required |
| `spec.md` | — | minimum applicable sections | short | full | full | full |
| `clarifications.md` | — | — | if ambiguous | required | required | required |
| `plan.md` | — | — | short | full | full | full + operational plan |
| `threat-model.md` | — | only if security-sensitive | if security-sensitive | if security-sensitive | required | required |
| `test-plan.md` | — | — | required | required | required, including security tests | required, including a staging rehearsal |
| `tasks.md` | — | optional | required | required | required | required |
| `traceability.md` | — | — | light | required | required | required |
| `convergence.md` | — | — | short | required | required | required |
| `change-record.md` | — | may carry the whole change | after approval | after approval | after approval | after approval |
| Rollback plan | — | implicit | implicit | written | written and tested in staging | written, rehearsed, with a data-restore path |
| Production-readiness verification | — | — | — | — | — | required |

"Short" means the mandatory sections exist and are a line or two each. "Full"
means the sections in `docs/sdd/REQUIREMENT_STANDARD.md` are genuinely
answered.

## Required gates

| Gate | R0 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| Spec approval | — | author | author | Product Owner or Solution Architect | Product Owner **and** Solution Architect | Product Owner **and** Solution Architect |
| Architecture approval | — | — | — | if a new pattern is introduced | Solution Architect | Solution Architect |
| Security review | — | — | self-check | self-check, flag anything touching authorization | Application Security, mandatory | Application Security, mandatory |
| Separate implementation-readiness approval | — | — | — | — | Solution Architect | Solution Architect |
| Human code review | optional | 1 reviewer | 1 reviewer | 1 reviewer | 2 reviewers, one security-literate | 2 reviewers plus the operator who will run it |
| CI gates | — | full `verify` | full `verify` | full `verify` + `check:drift` | full `verify` + `check:rls` + `check:raw-sql` | full `verify` + staging-first migration gate |
| Convergence verdict accepted by | author | author | author (see note) | reviewer | Application Security for security findings | Human Release Authority |
| Production release approval | n/a | normal release | normal release | normal release | named approver | named approver **and** a scheduled window |
| Agent may execute | yes, locally | yes | yes | yes | only after recorded human approval of the plan | never; humans execute |

**Reading the two approval rows.** "Spec approval" is gate 1 and, at R3, must
be recorded **before implementation begins** (`EVC-015`, decision `D2`,
Option A). "Separate implementation-readiness approval" is gate 5, an
*additional* permission required only at R4 and R5. A dash at R3 in the gate 5
row means no second approval is needed, not that implementation may begin
without gate 1.

The CI gate names refer to the existing pipeline
(`.github/workflows/ci.yml`, `apps/web/package.json`). `VERIFIED — those
scripts exist`; whether a given run passed is a runtime fact and is not
asserted here.

## Level notes

**R0 — Experiment.** No production impact and never merged. Lightweight notes
only; no `SPEC-NNNN/` directory and no formal artefact. If an experiment
becomes a real change, it starts the process from the top and gets its own
specification directory rather than being retro-fitted.

**R1 — Cosmetic / very low risk.** A lightweight `SPEC-NNNN/` directory, which
in practice is often a short `spec.md` stating the problem, the scope and how
the change will be checked, plus a `change-record.md` if anything moves after
that. `plan.md`, `threat-model.md`, `test-plan.md`, `tasks.md`,
`traceability.md` and `convergence.md` are **not** mandatory and are omitted
rather than created empty. No threat model unless the change is
security-sensitive; a copy edit inside an authentication screen can still be
security-sensitive, so the question is asked, not assumed. If an escalation
trigger fires, the same directory grows the artefacts of its new level — the
specification is never restarted somewhere else.

**R2 — Normal application change.** Specification, clarification where
genuinely ambiguous, plan, tasks, tests, light traceability, one reviewer.
The point of "short" here is that the process must stay usable; a new grid
column does not need a threat model.

**R3 — Backend / business logic.** Full specification and plan, a test plan,
real traceability, explicit review, and security analysis wherever
authorization, tenant scope or audit is touched. Additive migrations sit here
and require `check:drift` to pass.

**R4 — Security / data-sensitive.** Everything in R3 plus a threat model,
security tests that prove the boundary, mandatory Application Security review,
and **human approval before implementation begins**. An agent may prepare
every artefact and must then stop.

**R5 — Production-critical / destructive / infrastructure.** Everything in R4
plus an operational plan, a rollback and recovery plan, production-readiness
verification, and explicit human authorisation for execution. An AI agent may
not execute destructive or production operations at this level under any
circumstance; it prepares the commands and a human runs them.

## Escalation triggers

Re-classify upward, mid-flight, when any of these appears. Escalation is
recorded as a change record because it changes the required artefacts.

- The change begins to touch `src/lib/auth/*` or `src/lib/security/*`.
- Tenant scoping, permission scope, visibility or field rules move.
- A migration turns out to be destructive, or to hold a long lock.
- An environment variable must exist in a deployed environment.
- A new outbound data flow appears, including a new third-party call.
- Retention, audit or biometric handling changes.
- The blast radius stops being obvious.

## Authority / References

- `docs/RISK_CLASSIFICATION.md` — **authoritative**; this file operationalises it
- `AGENTS.md` §3, §4, §7, §8
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — the roles named above
- `docs/sdd/SPEC_LIFECYCLE.md`, `docs/sdd/CHANGE_CONTROL.md`
- `.github/workflows/ci.yml`, `apps/web/package.json` — the CI gate names

## Convergence acceptance when the author is an AI

The "Convergence verdict accepted by" row above names the **author** at R0, R1
and R2. `AGENTS.md` forbids an AI agent from discharging any approval gate at
any risk level, so when the author is an AI that row has no eligible actor.

**For an AI-authored R0–R2 specification the author's convergence-acceptance
authority is exercised by a Qualified Human Reviewer.** The rule for
human-authored work is unchanged: the author accepts. R3 and above are
unchanged.

Full statement of the role and its obligations: `docs/sdd/HUMAN_APPROVAL_GATES.md`
gate 6. Resolved by `EVC-017`, Solution Architect decision, 2026-09-08.
