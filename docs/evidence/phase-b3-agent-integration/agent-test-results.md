# Agent test results

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07
**Runner:** Node built-in test runner, Node v24.18.0, Windows 11
**Command:** `node --test tools/sdd/tests/agent.test.mjs`

No test framework, no fixture library, no dependency. The agent tests use only
the Node standard library, matching the constraint `SPEC-0001` set for the
validator suite.

## Summary

| | |
|---|---|
| Tests | 48 |
| Passed | 48 |
| Failed | 0 |
| Skipped | 0 |
| Duration | 3.5 s |

## Full result

```text
✔ UT-101 the agent fixture validates with no findings
✔ UT-102 preflight authorises an implementer on an approved task
✔ UT-103 preflight authorises a reviewing role with no task
✔ UT-104 a well-formed session record produces no findings
✔ UT-105 a well-formed verification record produces no findings
✔ UT-106 an independent review by a different actor produces no findings
✔ UT-107 changed files inside the declared scope raise nothing
✔ UT-111 SDD-V042 an unknown role is refused
✔ UT-112 SDD-V043 a role may not act outside its lifecycle states
✔ UT-113 SDD-V044 a task that does not exist is refused
✔ UT-114 SDD-V045 a task declaring no scope cannot be implemented
✔ UT-115 SDD-V046 a changed file outside the approved scope is reported
✔ UT-116 SDD-V047 a malformed session record is rejected
✔ UT-117 SDD-V048 a session claiming another specification is rejected
✔ UT-118 SDD-V049 a malformed verification record is rejected
✔ UT-119 SDD-V050 a malformed review record is rejected
✔ UT-120 SDD-V051 a session may not review its own work
✔ UT-121 SDD-V051 a review whose reviewing session is the reviewed session is rejected
✔ UT-122 SDD-V052 repository drift is a warning, not silence and not a revert
✔ UT-123 SDD-V053 an AI review cannot satisfy a human-required gate
✔ UT-124 SDD-V054 a verification cannot cite a test the plan does not contain
✔ UT-125 SDD-V055 a review cannot cite a session that does not exist
✔ UT-126 SDD-V056 an escaping scope path is refused
✔ UT-127 SDD-V057 COMPLETE is refused while a required test is unverified
✔ UT-128 SDD-V058 a prohibited path takes precedence over an allowed prefix
✔ UT-131 create-session refuses to write a record when preflight fails
✔ UT-132 a blocking structural error blocks every agent action
✔ UT-141 task scope reads exact paths and directory prefixes only
✔ UT-142 unsafe scope paths are named, not silently dropped
✔ UT-143 scope matching is prefix-based and does not match a sibling by name
✔ UT-144 a git ref that could become an option is refused
✔ UT-145 every role has a declared set of permitted lifecycle states
✔ UT-146 an unreadable or non-object record is reported, never assumed empty
✔ UT-147 path normalisation is stable across separators
✔ UT-148 every agent rule is declared in the shared catalogue
✔ REG-101 no agent read command writes to the fixture tree

ℹ tests 36
ℹ pass 36
ℹ fail 0
```

## Mapping to the test plan

The identifiers above are the runner's own labels. Their mapping to the
`SPEC-0002` test plan identifiers is recorded in `traceability.md` in the
specification directory, not restated here, so there is one authority for it.

## Second suite

The `SPEC-0001` validator suite was run alongside:

```bash
node --test tools/sdd/tests/validator.test.mjs
```

Result after the convergence pass: **56 of 56 pass.** The suite grew from 54
by the two `ST-009` tests added by `TASK-011`.

It was 53 of 54 during the first pass. `ST-002` failed then, for a real
reason:

`ST-002` scans the tool directory for dynamic execution constructs and permits
`child_process` only in `tools/sdd/lib/diff.mjs` and the validator test. B3
added a second legitimate git caller, `tools/sdd/lib/agent.mjs`, and its test
file. Both fall outside that allowlist, so the test is red.

The code is not unsafe. Both new files use `execFileSync` with a fixed
argument array and no shell, the same reviewed pattern the allowed file uses,
and the universal checks for `eval`, `new Function`, `execSync` and an
enabled shell still pass everywhere.

**`ASES-0001` did not fix it.** The validator test file was outside that
task's declared scope, and an agent adding its own new file to a security
allowlist without approval is exactly the failure mode this phase exists to
prevent.

It was remediated in a second pass under `CHG-001` by `TASK-011` and
`ASES-0002`, a session whose declared scope was the test alone and for which
the caller files were **prohibited**. `CONV-006` is `RESOLVED`. See
`docs/evidence/phase-b3-agent-integration/allowlist-security-review.md`.

A separate failure earlier in the phase, the repository self-check
`IT-005/006`, is resolved. It failed while `SPEC-0002` cited documents that
had not been written yet, and cleared as they were written.

## What these tests do not prove

They prove the control plane behaves as specified on synthetic input. They do
not prove an AI agent produces good engineering, that a review was thoughtful,
or that the process improves outcomes on a real feature. `SPEC-0002` has not
been exercised on a product change, and that limitation is carried forward.
