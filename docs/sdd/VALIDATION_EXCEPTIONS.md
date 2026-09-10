# Validation Exceptions

`NORMATIVE — engineering process requirement.` Introduced by Phase B2
(`SPEC-0001`).

There is no `skip SDD check` flag, and none will be added. An undocumented
escape hatch becomes the normal path within a quarter. Where an exception is
genuinely required, it is recorded here, scoped, and given an expiry.

## Register

One exception is in force.

| ID | Rule | Specification | Status | Expiry |
|---|---|---|---|---|
| `EXC-001` | `SDD-V060` | `SPEC-0002` | APPROVED | condition, not a date — see below |

Machine-readable mirror: `docs/sdd/validation-exceptions.json`. This document
is the authority; the JSON is what the validator checks. Same split as
`spec.md` and `sdd.json`.

### EXC-001 — SPEC-0002 historical late specification approval

```text
Exception ID:          EXC-001
Rule ID:               SDD-V060
Specification:         SPEC-0002 only
Status:                APPROVED
Decision:              approved
Approving role:        Solution Architect
actorType:             human
Requested by:          AI, Convergence Reviewer role — drafted, never approved by an agent
Effective date:        2026-09-08
Risk:                  R3
```

**Reason.** `SPEC-0002` entered `APPROVED_FOR_IMPLEMENTATION` on 2026-09-07,
before `EVC-015` was resolved and before `SDD-V060` existed. `D2` later
settled the policy in favour of mandatory R3 specification approval by a
Product Owner or Solution Architect, and `D1` supplied that approval on
2026-09-08.

Both dates are truthful. Neither may be altered, and neither was.

**Historical context, in order.**

```text
historical deviation      SPEC-0002 implemented before its specification was approved
        ↓
policy clarified          D2 resolves EVC-015 in favour of Option A
        ↓
approval later recorded   D1, Product Owner, 2026-09-08 — genuinely late
        ↓
machine rule added        SDD-V059 and SDD-V060, TASK-015
        ↓
rule catches its author   SDD-V060 fires on SPEC-0002; CONV-011 raised
        ↓
historical exception      EXC-001, scoped to this one immutable fact
        ↓
recurrence prevented      SDD-V060 stays fully active everywhere else
```

**Scope.** The single historical implementation transition of `SPEC-0002` that
occurred before `EVC-015` was resolved and before `SDD-V060` machine
enforcement existed. Nothing else.

**Non-precedential. Does not authorize any future R3 implementation transition
without timely specification approval.**

**Expiry.** A condition, not a date. Rule 2 of this document permits "a date or
a condition that ends it", and a condition is the only honest representation
here: the exempted fact is an immutable historical date, so any calendar
expiry would make the repository fail again for something nobody could act on.

The condition: this exception ends if `SPEC-0002` becomes `SUPERSEDED` or
`CANCELLED`, or if its `statusHistory` or its specification approval date is
ever amended. Any of those means the fact being exempted has changed, and the
exception must be reconsidered rather than inherited.

**Compensating control.** The deviation stays visible in five places and is
not hidden by this exception:

1. `CONV-004` — the original gate crossing.
2. `CONV-011` — the machine finding.
3. The manifest `statusHistory` note at the point of transition.
4. `spec.md`'s approval section.
5. The validator itself, which continues to emit the finding at `INFO` with
   the text `EXCEPTED under EXC-001`. The condition is downgraded, never
   deleted.

`SDD-V060` remains fully active for every other specification, and a synthetic
future-R3 fixture proves a late approval still fails.

**What this exception does not do.** It does not weaken `SDD-V060` globally,
apply to another specification, authorise future late approval, permit AI
self-approval, satisfy any production or release gate, alter the `D2` policy,
alter `D1`'s true date, or hide `CONV-004`.

**Evidence.** `docs/evidence/phase-b3-agent-integration/historical-exception-audit.md`,
`CONV-011`, `D1`, `D2`.

## Record format

```text
Exception ID:      EXC-001
Rule ID:           SDD-VNNN
Specification:     SPEC-NNNN, or "repository" for a global exception
Reason:            why the rule cannot be satisfied, specifically
Scope:             exactly what is exempted; never "all findings"
Risk:              R0-R5 of the work the exception unblocks
Requested by:      functional role
Human approver:    functional role, required at R4 and R5
Expiry:            a date, or the named condition that ends it
Compensating control: what covers the gap meanwhile
Status:            PROPOSED | ACTIVE | EXPIRED | WITHDRAWN
```

## Rules

1. **Scoped.** An exception names one rule and one specification, or one rule
   and an explicitly enumerated set of paths. A blanket exemption is not an
   exception, it is an abandonment of the control.
2. **Expiring where practical.** An exception carries a date or a condition
   that ends it. An exception without an end is a rule change in disguise, and
   rule changes go through the governance in
   `docs/sdd/ENFORCEMENT_STANDARD.md` §8.
3. **Justified.** "The validator is annoying" is not a reason. If the rule is
   wrong, fix the rule.
4. **Approved by a human at R4 and R5.** Application Security for a security
   rule, Solution Architect otherwise.
5. **Never self-approved by an AI agent.** An agent may draft an exception
   record and must then stop. `actorType: "ai"` cannot approve anything.
6. **Never a bypass of a release control.** An exception may relax a
   structural validator rule. It may not substitute for a release approval, a
   destructive-migration approval, or any gate in
   `docs/sdd/HUMAN_APPROVAL_GATES.md`. Those are not validator rules and are
   not the validator's to waive.
7. **Compensating control stated.** What covers the gap while the exception
   is active — a manual review, an additional test, a monitoring check.
8. **Reviewed on expiry.** An expired exception is either renewed with fresh
   justification or removed. Silently lapsing is not an outcome.

## What an exception is not for

- Hiding a validator finding an agent produced and would rather not fix.
- Getting a change through a gate faster.
- Working around a false positive. That is a validator defect, and
  `docs/sdd/BUG_WORKFLOW.md` is the route.

## Authority / References

- `AGENTS.md` §7 — what an agent may never authorise
- `docs/sdd/ENFORCEMENT_STANDARD.md` — §7 false positives, §8 rule governance
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — the gates an exception can never waive
- `docs/sdd/VALIDATION_RULES.md`
