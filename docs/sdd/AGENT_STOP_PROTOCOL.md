# Agent Stop Protocol

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`).

Stopping is a successful outcome. An agent that stops at a boundary and
reports has done its job. An agent that continues on an assumption has not,
however good the resulting code looks.

## Mandatory stop conditions

Work stops immediately when any of these holds:

1. **Preflight failed.** No session is authorised. There is no override.
2. **A required approval is missing** for the risk level.
3. **A material requirement is ambiguous.** Raise a `CL-`; do not pick the
   convenient reading.
4. **A requirement and the implementation conflict.** Record it; a human
   decides which is wrong.
5. **The work needs scope the task does not declare.** Raise a change record.
   Do not widen `allowedPaths` and continue.
6. **A destructive operation is required** and is not authorised.
7. **Production access is required.** Prepare commands for a human instead.
8. **A security boundary is unclear** — which actor, which scope, which
   tenant.
9. **A required verification fails** and no approved fix task exists.
10. **A secret may have been exposed.** Stop before writing anything further.
11. **An evidence conflict affects the task** and the approver has not seen
    it.
12. **The repository state materially differs** from the session's start.

## Report format

```text
Reason:
Blocking rule:
Affected task:
Evidence:
Required next action:
```

One paragraph is enough. Name the rule identifier where one applies, so the
reader can check the decision rather than trust it.

## What stopping is not

Stopping is not asking permission to do the obvious. A reversible change that
follows from the approved task does not need a check-in, and an agent that
stops constantly is as unusable as one that never stops.

The test is whether proceeding would commit somebody else to something: an
unapproved scope, an unverified assumption, an irreversible action, or a
decision that is a human's to make.

## What must never happen instead of stopping

- Widening a task's declared scope to cover what was actually changed.
- Editing an assertion so a failing test passes.
- Writing an approval record to clear a gate.
- Downgrading a rule severity to turn an error into a warning.
- Recording `COMPLETE` with required tests unverified.
- Reverting or overwriting a concurrent change to remove drift.

Each of these turns a stop into a silent policy change made by the agent. All
six are forbidden by `AGENTS.md`, and the first, third, fourth and sixth are
also caught mechanically by `SDD-V046`, `SDD-V053`, the rule-governance
process and `SDD-V057`.

## After stopping

Leave the repository in a state a human can read: artefacts written, findings
recorded, nothing half-applied. Then report and wait. Do not begin adjacent
work to stay busy.

## Authority / References

- `AGENTS.md` §7; `docs/sdd/CHANGE_WORKFLOW.md` STOP conditions
- `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_SESSION_STANDARD.md`,
  `AGENT_EXECUTION_RECORD.md`
- `docs/sdd/VALIDATION_EXCEPTIONS.md` — the only sanctioned route around a
  rule, and it needs a human
