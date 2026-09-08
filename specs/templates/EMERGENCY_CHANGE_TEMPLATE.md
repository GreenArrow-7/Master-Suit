# EMG-NNNN — <title>

> Workflow: `docs/sdd/EMERGENCY_CHANGE_WORKFLOW.md`.
> Emergency means a smaller process executed deliberately, not no process.
> **Human authorisation is required before anything is applied.** An AI agent
> may prepare every field below and the exact commands; it may not authorise
> and may not execute a production change (`AGENTS.md` §7).

| Field | Value |
|---|---|
| Emergency ID | `EMG-NNNN` |
| Title | |
| Incident start | YYYY-MM-DD HH:MM TZ |
| Detected by | |
| Prepared by | |
| Status | `ASSESSING` / `AWAITING_AUTHORIZATION` / `APPLIED` / `VALIDATED` / `RECONCILED` |

## Incident

What is happening, since when, how it was detected.

## Impact

Who and what is affected, and the consequence of doing nothing for an hour.
This is what justifies bypassing the normal workflow, so state it plainly. If
it does not justify a bypass, use `docs/sdd/CHANGE_WORKFLOW.md` instead.

## Why the normal process cannot be followed

One or two sentences. "Faster" is not a reason; "customers are losing data
every minute this continues" is.

## Minimum safe change

The smallest change that stops the harm. Not the correct long-term fix if the
correct fix is larger.

**Deliberately left undone:** what this change does not address, and what
must follow later.

## Blast radius

What this touches. What could break. Which tenants, which data, which
services.

## Rollback

Exact steps and how long they take. If the change is not reversible — a
migration, a destructive data operation, a rotated secret — say so explicitly
here, because that changes who must authorise it
(`docs/operations/ROLLBACK.md`).

## Monitoring

What will be watched during and after: metric, log, alert, customer signal.
**Trigger to roll back:** the specific observation that would cause a revert.

## Data modification

- [ ] No data is modified
- [ ] Data is modified and the modification is reversible — describe how
- [ ] Data is modified irreversibly — requires gate 4 approvals

## Authorization

Required before the change is applied: the Human Release Authority, plus one
role appropriate to the change (Application Security for a security incident,
DevOps / Production Engineering for infrastructure, Solution Architect for a
data or schema action).

| Role | Decision | Time | Scope authorised |
|---|---|---|---|
| Human Release Authority | | | |
| | | | |

## Focused verification

The specific checks that prove the harm stopped and the adjacent path still
works. Record what was run and what was skipped.

| Check | Result |
|---|---|

## Controlled release

How it was applied, and any part of the normal release path that was
bypassed, named explicitly.

## Post-change validation

Confirmation from outside the system that the incident is over: the symptom,
the metric, the customer report. Watch for a secondary failure introduced by
the fix.

## Retrospective

Held: YYYY-MM-DD. No blame; the output is engineering work.

- What happened
- Why the normal process could not be followed
- What the emergency change actually did
- What was left undone
- What would prevent a recurrence

## Reconciliation — mandatory to close

The emergency is not over until engineering truth is restored.

- [ ] Behaviour described in a specification, new or amended under change control
- [ ] Regression test exists and fails against the pre-fix code
- [ ] Temporary fix made permanent through the normal workflow, or replaced
- [ ] Documentation the change made untrue is corrected
- [ ] Any evidence conflict revealed is registered in `docs/EVIDENCE_CONFLICTS.md`
- [ ] Accepted residual risk has a named owner

**Status:** `ASSESSING`
