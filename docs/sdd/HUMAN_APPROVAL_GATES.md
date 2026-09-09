# Human Approval Gates

`NORMATIVE — engineering process requirement.`

## The governing rule

An AI agent may analyse, prepare, validate, recommend and generate commands
for human review. An agent may **not** grant itself an approval, record an
approval on a human's behalf, or treat its own confidence as a gate having
been passed. This restates `AGENTS.md` §7 and does not soften it.

Where this document says a role approves, the approval is recorded in the
specification's Approval section or in the change record, naming the role, the
decision, the date, and exactly what was approved.

## Roles

These are functional roles, not people. One person may hold several; at R4 and
R5 the approver of the work must not be its sole author.

| Role | Owns |
|---|---|
| Product Owner | Whether the requirement is the right requirement; scope |
| Solution Architect | Approach, patterns, architecture and data model |
| Application Security | Threat model, security requirements, security residual risk |
| QA / Release Engineering | Test adequacy, convergence verdict, release readiness |
| DevOps / Production Engineering | Deployment, migration execution, infrastructure, rollback feasibility |
| Human Release Authority | The decision to release to production |

## Gates

**1. Specification approval** — that the requirements are correct and
complete enough to build.
R0/R1: author. R2: author. R3: Product Owner or Solution Architect.
R4/R5: Product Owner **and** Solution Architect.

**2. Architecture approval** — that the approach fits the system.
Required at R3 when a new pattern, new dependency or new integration is
introduced; always at R4 and R5. Approver: Solution Architect.

**3. Security risk acceptance** — that the threat model is adequate and any
residual risk is accepted knowingly.
Required whenever a threat model is required, and for any `SECURITY CHANGE`
record. Approver: Application Security. An agent may draft the analysis; it
may not accept the risk.

**4. Data model and destructive migration approval** — that the schema change
is sound and the data operation is safe.
Additive migration at R3: Solution Architect. Destructive, backfilling or
long-locking migration at R5: Solution Architect **and** DevOps **and** Human
Release Authority, with the rollback and restore path written down first.
`AGENTS.md` §4 forbids an agent from executing these against production in any
case.

**5. Implementation readiness** — a *separate* permission to start writing
code, additional to gate 1. Approver: **Solution Architect**.
Required at R4 and R5. The specification may not enter
`APPROVED_FOR_IMPLEMENTATION` without it. At R0–R2 the author proceeds once
the artefacts the risk matrix requires exist. **At R3 no separate
implementation-readiness approval is required, but the gate 1 specification
approval by a Product Owner or Solution Architect must be recorded before
implementation begins.**

The Solution Architect confirms that the approved specification is technically
ready to enter implementation, once the other pre-implementation gates
applicable to the risk level are satisfied: implementation plan, architecture,
task decomposition, dependencies, migration and data impact, security
prerequisites, rollback approach, verification strategy, and operational
implications.

It replaces nothing. Product Owner approval, architecture approval where
separately required, Application Security approval, code review, convergence
acceptance, staging approval and production approval all stand alongside it.
An AI agent may not exercise it.

*Resolved by `EVC-018`, governance-owner decision, 2026-09-08. Gate 5 named no
role, while `docs/sdd/SPEC_LIFECYCLE.md` requires the approval record to name
one — so a conforming record could not be written without inventing an actor.
Naming the approver removes the gap; the R4/R5 requirement itself is
unchanged.*

*Resolved by `EVC-015`, Solution Architect decision `D2` (Option A),
2026-09-08. The previous wording read "At R0–R3 the author proceeds", which
contradicted gate 1's R3 row.*

**6. Convergence acceptance** — that the work is genuinely complete.
R0–R2: author. R3: reviewer. R4: Application Security for every security
finding, plus QA / Release Engineering. R5: QA / Release Engineering and
Human Release Authority. An agent produces the convergence report and a
recommended verdict; a human accepts it at R3 and above.

**When the author of an R0–R2 specification is an AI agent, the author's
convergence-acceptance authority is exercised by a Qualified Human Reviewer.**
The substitution exists only because an AI author is prohibited from
self-approving; it does not change the R0–R2 rule for human-authored work,
where the author still accepts.

| Author | R0–R2 convergence accepted by |
|---|---|
| human | the author |
| AI agent | a Qualified Human Reviewer |

The Qualified Human Reviewer must be a real human, must review the final
convergence evidence, must understand the verdict and every `ACCEPTED_RISK`
finding, and must explicitly ACCEPT or REJECT. **An AI review does not satisfy
this role.**

The convergence decision stays separate from specification approval,
architecture approval, code review, security risk acceptance, and release,
staging or production approval. One human may perform both the code review and
the convergence acceptance where the risk matrix permits, but **the two
decisions are recorded separately**.

*Resolved by `EVC-017`, Solution Architect decision, 2026-09-08. Gate 6
previously named only "author" at R0–R2, which `AGENTS.md` forbids an AI author
from discharging, leaving the gate with no eligible actor.*

**7. Production release** — the decision to expose the change to customers.
Human Release Authority, always, at every risk level. At R4 and R5 this is a
named approver and, at R5, a scheduled window. No agent may perform or
authorise a production deployment.

**8. Emergency change** — see `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`.
Requires the Human Release Authority plus one other role appropriate to the
change, before the change is applied. Emergency reduces the number of gates,
never to zero.

**9. Accepted residual risk** — a known limitation shipped deliberately.
Security residual risk: Application Security. Functional or scope limitation:
Product Owner. Operational limitation: DevOps / Production Engineering. Every
accepted limitation names its owner and, where relevant, the condition under
which it must be revisited.


## Machine-checkable approval records

Approvals are recorded in `sdd.json` as structured entries carrying a gate, a
role, an `actorType` and a decision. The validator refuses a human-required
gate satisfied by `actorType: "ai"` (`SDD-V022`) and reports a missing
implementation or release approval (`SDD-V020`, `SDD-V034`).

**What that proves, and what it does not.** It proves a record exists. It does
not prove a human made the decision, because anyone who can commit can write
the record. Real assurance comes from commit authorship, review and branch
protection. Treat the check as making an omission visible, not as evidence of
human agency.

## What an agent does at a gate

1. Assemble the artefacts the gate requires.
2. State plainly what is being asked for, and what the approver is accepting.
3. Surface anything that argues against approval: open clarifications, open
   `EVC` conflicts in the affected area, unproven assumptions, known
   limitations.
4. Stop. Do not begin the work the gate protects.
5. When the decision arrives, record it verbatim with its role and date.

An agent that cannot obtain an approval reports the block. It does not
proceed under an assumed approval, and it does not downgrade the risk level to
avoid the gate. Reclassifying risk downward to skip a gate is a process
violation.

## Authority / References

- `AGENTS.md` §7 (what AI may never authorise), §8 (definition of done)
- `docs/RISK_CLASSIFICATION.md` — production approval column
- `docs/sdd/RISK_TO_PROCESS_MATRIX.md` — which gates apply per level
- `docs/sdd/SPEC_LIFECYCLE.md`, `docs/sdd/CHANGE_CONTROL.md`,
  `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`
- `docs/operations/DEPLOYMENT.md` — the existing deploy workflow's own
  `environment:` protection, `VERIFIED` from `.github/workflows/deploy.yml`
