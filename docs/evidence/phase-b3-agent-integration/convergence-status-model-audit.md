# Convergence status model audit — `D8` / `CONV-010`

**Prepared for:** QA / Release Engineering · **Date:** 2026-09-07
**Prepared by:** AI. This is an analysis, not a decision.

## The question

Does the convergence standard need a distinct status for *"a limitation that
is recorded, has a recommended disposition, and is waiting on a human
signature"*?

## Current vocabulary

`specs/templates/CONVERGENCE_TEMPLATE.md` defines exactly four:

```text
OPEN / RESOLVED / ACCEPTED_RISK / NOT_APPLICABLE
Owner: functional role — required for ACCEPTED_RISK
```

The owner requirement is the constraint that produced this finding.

## What went wrong, concretely

Four findings in `SPEC-0002` were recorded as `ACCEPTED_RISK` with the owner
written as "UNRESOLVED". That combination is not permitted by the standard and
it **overstated their status**: nothing had been accepted by anyone. All four
are now `OPEN`.

That correction is right, and it loses information. `CONV-004` needs a
specification approval; `CONV-001` needs only a signature on a limitation
already analysed. Both now read `OPEN`. The distinction survives in each
finding's **Awaiting** line, which is prose no validator can check.

## Option A — confirm `OPEN` is the canonical pre-acceptance status

Document that `OPEN` covers unresolved engineering work, unresolved governance
action, and pending human risk acceptance alike, with the reason and owner
fields carrying the distinction.

| | |
|---|---|
| Vocabulary change | none |
| Validator change | none |
| Effect on `SDD-V032` | unchanged: no `OPEN` finding while `CONVERGED` or beyond |
| Cost | the difference between "needs work" and "needs a signature" stays unenforceable. A reviewer scanning statuses cannot tell them apart without reading prose |
| Benefit | no governance change, nothing to keep in sync, no risk of a new status being used to park findings indefinitely |
| `CONV-010` becomes | `RESOLVED`, by documenting the intent |

## Option B — add `PENDING_RISK_ACCEPTANCE`

Add a fifth status, permitted only where a recommended disposition **and** a
required accepting role are both named.

| | |
|---|---|
| Vocabulary change | `specs/templates/CONVERGENCE_TEMPLATE.md`, under a `CHG-` record |
| Validator change | likely a rule asserting the two required fields, and a decision on whether `SDD-V032` treats it as blocking |
| Cost | a normative B1 artefact changes; every existing specification's convergence section becomes reviewable against a vocabulary it predates; a status that means "waiting" can become a place findings go to rest |
| Benefit | the machine can distinguish "engineering incomplete" from "awaiting a signature", which is the actual state of five findings here |
| `CONV-010` becomes | `RESOLVED` once the change is made and validated |

## What is not a reason to choose either

Convenience. Option A closes `CONV-010` today with no work, and that is not an
argument for it. Option B makes `SPEC-0002`'s status table read better, and
that is not an argument for it either.

**B3 must not silently alter B1's convergence model for its own benefit.**
That is why neither option was implemented, and why this finding is a decision
rather than a fix.

## Relevant fact, offered without conclusion

If Option B had existed during this phase, five of the six currently `OPEN`
findings would carry it — `CONV-001`, `CONV-003`, `CONV-005`, `CONV-009` and
`CONV-010` itself. Only `CONV-004` would remain plainly `OPEN`.

Whether that is evidence the status is needed, or evidence that one phase's
shape should not drive a standard, is the decision.

## Allowed decisions

| Decision | What changes |
|---|---|
| Option A — confirm `OPEN` | `CONV-010` moves to `RESOLVED`; the intent is documented in the convergence standard; no vocabulary change |
| Option B — add the status | A `CHG-` record against `specs/templates/CONVERGENCE_TEMPLATE.md`, a possible validator rule, then `CONV-010` moves to `RESOLVED` |

## A note on ownership

`docs/sdd/` does not explicitly name an owner for amending its own templates.
QA / Release Engineering is the closest fit, since the role table in
`docs/sdd/HUMAN_APPROVAL_GATES.md` gives it "convergence verdict". Confirming
who owns SDD template changes is worth doing and is not resolved here.
