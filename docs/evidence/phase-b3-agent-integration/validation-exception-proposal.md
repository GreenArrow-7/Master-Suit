# Validation exception — proposal for a human

**Status: PROPOSAL. Not an exception.** Nothing here is in force.

This is a draft, held in the evidence package rather than in
`docs/sdd/VALIDATION_EXCEPTIONS.md`. It reaches the register only when a human
decides to put it there. **No agent may approve a validation exception**, and
writing it into the register would be recording a decision nobody made.

## What it would cover

```text
Exception ID:          EXC-001
Rule ID:               SDD-V060
Specification:         SPEC-0002 only
Reason:                The specification approval (D1, 2026-09-08) is dated
                       after the transition into APPROVED_FOR_IMPLEMENTATION
                       (2026-09-07). The dates are history; no edit can make
                       the approval earlier without falsifying the record.
Scope:                 SDD-V060 on SPEC-0002 and nothing else. Every other
                       rule, and this rule on every other specification,
                       remains in force.
Risk:                  R3
Requested by:          AI, Convergence Reviewer role — drafted, not approved
Human approver:        REQUIRED — Solution Architect, as the role that selected
                       the EVC-015 Option A policy in D2
Expiry:                Permanent for SPEC-0002, because the fact is immutable.
                       It does not extend to any future specification.
Compensating control:  The deviation is recorded four times over and is not
                       hidden by the exception: CONV-004 (the original gate
                       crossing), CONV-011 (the machine finding), the manifest
                       statusHistory note at the point of transition, and
                       spec.md's approval section. SDD-V060 remains fully
                       active for every other specification, so the next R3
                       change cannot repeat this silently.
Status:                PROPOSED
```

## Why an exception rather than a fix

`SDD-V060` reports something true. `SPEC-0002` was implemented before its
specification was approved — that is exactly the deviation `CONV-004` has
recorded from the start, and `D1` supplied the missing approval afterwards
rather than retroactively.

There are only four ways this finding can go away:

| Route | Verdict |
|---|---|
| Edit the approval date | **Falsification.** Forbidden |
| Edit the statusHistory date | **Falsification.** Forbidden |
| Soften or narrow `SDD-V060` | **Defeats the rule this phase just built.** Forbidden |
| A scoped, human-approved exception | The sanctioned route |

`docs/sdd/VALIDATION_EXCEPTIONS.md` exists for precisely this: a rule that
cannot be satisfied, exempted narrowly, with the reason written down.

## The alternative, which is equally legitimate

A human may decline the exception and simply **accept the failing validation
state**, taking `D10` with `validate --all` returning one error and the reason
recorded. That is a defensible choice: it keeps the red visible permanently,
which is arguably a more honest memorial to a governance breach than an
exception that makes it quiet.

Declining and treating the breach as disqualifying is also available.

This document does not recommend between the three. All are the decider's.

## What must not happen

The exception must not be widened to `SPEC-0002` generally, to `SDD-V060`
generally, or to "the B3 findings". A blanket exemption is not an exception;
it is the control being abandoned with paperwork.
