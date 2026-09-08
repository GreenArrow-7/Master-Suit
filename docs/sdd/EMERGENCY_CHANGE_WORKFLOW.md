# Emergency Change Workflow

`NORMATIVE — engineering process requirement.`

Emergency does not mean process-free. It means a smaller process, executed
deliberately, with the remainder completed afterwards rather than skipped.

## When this applies

Customer-affecting production impact that cannot wait for the normal change
workflow: an outage, active data loss, an exploited security weakness, a
failing critical path. Urgency alone does not qualify. "The demo is tomorrow"
is not an incident.

If the normal path could be followed in the available time, it must be.

## The path

```text
INCIDENT
  ↓
IMPACT
  ↓
MINIMUM SAFE CHANGE
  ↓
HUMAN AUTHORIZATION          ← mandatory, before anything is applied
  ↓
FOCUSED VERIFICATION
  ↓
CONTROLLED RELEASE
  ↓
POST-CHANGE VALIDATION
  ↓
RETROSPECTIVE
  ↓
FORMAL SPEC / TEST / DOCUMENTATION UPDATE
```

## What each step must produce

**Incident.** What is happening, since when, how it was detected, who is
affected. Recorded as it is understood, corrected as understanding improves.

**Impact.** Who and what is affected, and the consequence of doing nothing
for an hour. This is what justifies bypassing the normal path, so it is
stated explicitly rather than assumed.

**Minimum safe change.** The smallest change that stops the harm. Not the
correct long-term fix, if the correct fix is larger. The record states what is
deliberately being left undone.

**Required before authorisation:**

- the reason the normal process cannot be followed, in one or two sentences;
- the blast radius — what this touches and what it could break;
- the rollback: exact steps, and how long they take;
- what will be monitored during and after, and what would trigger the
  rollback;
- whether data is modified, and whether that modification is reversible.

**Human authorization.** The Human Release Authority, plus one role
appropriate to the change: Application Security for a security incident,
DevOps / Production Engineering for infrastructure, Solution Architect for a
data or schema action. Recorded with role, name of the decision, time.

An AI agent may prepare every artefact above and the exact commands. An agent
may not authorise, and may not execute, a production emergency change. This is
`AGENTS.md` §7 and it does not relax under time pressure. Time pressure is
precisely when it matters.

**Focused verification.** Not the full suite, but not nothing: the specific
checks that prove the harm has stopped and that the change did not break the
adjacent path. Recorded, including anything skipped.

**Controlled release.** Through the existing release path where possible.
Where the emergency requires bypassing part of it, the bypass is named in the
record.

**Post-change validation.** Confirm the incident is over from the outside:
the symptom, the metric, the customer report. Watch for the secondary failure
the fix might have introduced.

**Retrospective.** Within a defined window after the incident closes. What
happened, why the normal process could not be followed, what the emergency
change actually did, what was left undone, and what would prevent a recurrence.
No blame; the output is engineering work, not attribution.

**Formal reconciliation — mandatory.** The emergency ends only when
engineering truth is restored:

- the behaviour is described in a specification, new or amended under change
  control;
- a regression test exists that fails against the pre-fix code;
- the temporary or partial fix is either made permanent through the normal
  workflow or explicitly replaced;
- documentation that the change made untrue is corrected;
- any evidence conflict the incident revealed is registered in
  `docs/EVIDENCE_CONFLICTS.md`;
- any accepted residual risk has a named owner.

An emergency change that is never reconciled becomes undocumented behaviour,
which is how the next incident is built.

## What is still forbidden

- An agent executing production commands, migrations, restarts, secret
  rotation or infrastructure changes.
- Destructive data operations without the approvals in
  `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 4.
- Disabling a security control, a test or a CI gate to ship the fix.
- Skipping the retrospective and the reconciliation.

## Authority / References

- `AGENTS.md` §4, §7, §8
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — gate 8
- `docs/operations/ROLLBACK.md` — what rollback can and cannot do here; note
  that database migrations have no down path
- `docs/operations/DEPLOYMENT.md` — the existing release and rollback commands
- `specs/templates/EMERGENCY_CHANGE_TEMPLATE.md`
