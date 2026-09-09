# Clarification Standard

`NORMATIVE — engineering process requirement.`

An ambiguity that an agent resolves quietly becomes a requirement nobody
agreed to. Clarification is the mechanism that turns a guess into a recorded
decision with an owner.

## The rule

An AI agent must not silently resolve material ambiguity. Where a request
admits more than one reasonable reading and the readings lead to materially
different work, the agent raises a `CL-` entry and either waits, or proceeds
under an explicitly stated assumption where the risk level allows it.

Material means: different readings produce different behaviour, different data
handling, different permissions, different failure modes, or different blast
radius. A wording preference is not material.

## What to interrogate

Run this checklist against every specification at R2 and above. Each line is a
question that has silently broken production systems before.

- **Actors** — who performs this, and who else can. Platform roles as well as
  workspace roles.
- **Permissions** — which module and action, at which scope. Does an existing
  permission cover it, or is a new one implied.
- **Tenant boundary** — whose data is in scope, and what happens on a
  cross-tenant reference.
- **Failure behaviour** — what the caller sees when a dependency is down,
  when validation fails, when the record is gone.
- **Lifecycle** — creation, update, soft delete, hard delete, restore,
  archive, suspension. What each means for this object.
- **Data ownership** — who owns the row, what happens when that owner leaves,
  is reassigned, or is deactivated.
- **Concurrency** — two callers at once, two tabs, a retried webhook.
- **Retry and idempotency** — is the operation safe to repeat, and what makes
  it safe.
- **Deletion and retention** — how long, deleted by what, and what a deletion
  request must reach.
- **Audit** — what must be recorded, with which before and after values.
- **External dependency failure** — the provider is slow, rate-limited, or
  returns a partial result.
- **Security boundary** — what an authenticated but unauthorised caller sees;
  what an anonymous caller sees.
- **Backward compatibility** — existing API consumers, existing rows, existing
  queued jobs, existing sessions.
- **Migration behaviour** — what happens to data that predates this change.
- **Performance expectations** — the workload this must hold, and the
  threshold that counts as too slow.
- **Operational implications** — new environment variable, new queue, new
  alert, new runbook step.

## Record format

Each clarification is a `CL-NNN` entry in the specification's
`clarifications.md`, with these fields:

```text
CL-001

Question:
Why it matters:
Possible interpretations:
Recommended interpretation:
Decision:
Decision owner:
Status:
Affected requirements:
```

`Recommended interpretation` is the agent's analysis and carries no authority.
`Decision` is the answer, and it is authoritative once the decision owner is
recorded.

## Statuses

| Status | Meaning |
|---|---|
| `OPEN` | Asked, unanswered. Blocks progression where material |
| `ANSWERED` | Decided, with an owner recorded, not yet folded into the spec |
| `INCORPORATED` | The decision now lives in the specification text, with the affected requirement ids named |
| `DEFERRED` | Deliberately postponed, with a reason and the condition that would reopen it |
| `NOT APPLICABLE` | Asked and found irrelevant, with the reason kept |

## The incorporation rule

An `ANSWERED` clarification must reach one of two end states:

1. **INCORPORATED** — the decision is written into the specification, the
   affected requirements are updated or added, and `Affected requirements`
   names their identifiers. This is the default.
2. **Formally linked** — the decision stays in `clarifications.md` and the
   affected requirement cites `CL-NNN` in its text. Use this when the decision
   is context rather than an obligation.

What is prohibited is the third outcome: important behaviour that exists only
in conversation. If a decision was made in chat and appears nowhere in the
specification, it did not happen.

After a specification is approved, incorporating a clarification that changes
meaning requires a change record; incorporating one that only records what was
already approved does not.

## Blocking

A material `OPEN` clarification blocks the transition to READY_FOR_PLAN and
therefore blocks implementation. At R4 and R5 it also blocks approval, without
exception. At R2 an agent may proceed under a stated assumption if the
assumption is written into the specification's Assumptions section and the
clarification remains OPEN and visible.

## Authority / References

- `AGENTS.md` §1 (do not guess requirements; identify ambiguity)
- `docs/sdd/SPEC_LIFECYCLE.md` — where clarification gates the lifecycle
- `docs/sdd/RISK_TO_PROCESS_MATRIX.md` — when clarification is mandatory
- `docs/sdd/CHANGE_CONTROL.md` — clarifying after approval
- `specs/templates/CLARIFICATION_TEMPLATE.md`
