# Preflight audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

Preflight is the decision point. Everything else in the control plane reports;
preflight is what says *no*.

## Conditions that refuse authorisation

| Condition | Rule |
|---|---|
| The role is not one of the seven | `SDD-V042` |
| The lifecycle state does not permit that role | `SDD-V043` |
| The named task does not exist, or is `WITHDRAWN` / `CANCELLED` | `SDD-V044` |
| An implementer names no task at all | `SDD-V044` |
| An implementer's task declares no allowed scope | `SDD-V045` |
| A declared scope path is unsafe | `SDD-V056` |
| The task cites neither a requirement nor an approved decision | `SDD-V026` |
| The task names no required test | `SDD-V057` |
| R4 or R5 with no recorded human implementation approval | `SDD-V020` |
| Any blocking structural validation error exists | the rule that fired |

The last row is the broad one. Before preflight evaluates a single role
question, the full validator runs against the specification, and every `ERROR`
it produces is carried into the preflight result with the note *"no agent
action is authorised until they are fixed."* `UT-132` asserts this for
`preflight`, `verify-session` and `review-check` together, by introducing one
unrelated structural defect and confirming all three refuse.

## Creating a session cannot bypass it

`create-session` runs the same preflight. When any `ERROR` remains it writes
the note *"Session NOT created: preflight failed. Creating a session never
authorises implementation."* and returns exit 1.

`UT-131` counts the session records before and after a failing
`create-session` and asserts the count is unchanged. The refusal is a
filesystem fact, not a message.

There is no `--force`, no `--skip-preflight` and no environment variable that
changes this. `AGENTS.md` and `docs/sdd/AGENT_SESSION_STANDARD.md` both state
that none will be added.

## Observed

```text
$ node tools/sdd/cli.mjs agent preflight --spec SPEC-0001 \
      --role IMPLEMENTER --task TASK-001 --root tools/sdd/tests/fixtures/agent
No findings.
result=PASS  errors=0  warnings=0            exit 0

$ ... --role PLANNER
ERROR   SDD-V043  SPEC-0001 · sdd.json
        Role PLANNER may not act while the specification is IMPLEMENTING
result=FAIL  errors=1  warnings=0            exit 1
```

**Result:** preflight refuses on every documented condition, and the refusal
is enforced by not writing a file rather than by asking the agent to behave.
