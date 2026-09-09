# Invalid fixture results

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

Each case copies the valid tree, introduces **one** defect, and asserts the
expected rule fires. Seventeen negative cases cover the seventeen rules
`SDD-V042` to `SDD-V058`.

## Coverage

| Rule | Defect introduced | Test | Expected | Observed |
|---|---|---|---|---|
| `SDD-V042` | role `ARCHITECT_OF_DESTINY` | `UT-111` | refuse | refused, exit 1 |
| `SDD-V043` | `PLANNER` while `IMPLEMENTING` | `UT-112` | refuse | refused, exit 1 |
| `SDD-V044` | task `TASK-987` does not exist | `UT-113` | refuse | refused, exit 1 |
| `SDD-V045` | allowed-scope line removed from the task | `UT-114` | refuse | refused, exit 1 |
| `SDD-V046` | change to a path outside the declared scope | `UT-115` | report | reported |
| `SDD-V047` | session schema version set to 99 | `UT-116` | refuse | refused, exit 1 |
| `SDD-V048` | session claims a different specification | `UT-117` | refuse | refused, exit 1 |
| `SDD-V049` | verification result set to an invented value | `UT-118` | refuse | refused, exit 1 |
| `SDD-V050` | review decision set to an invented value | `UT-119` | refuse | refused, exit 1 |
| `SDD-V051` | review actor equals the executing actor | `UT-120` | refuse | refused, exit 1 |
| `SDD-V051` | reviewing session equals the reviewed session | `UT-121` | refuse | refused |
| `SDD-V052` | session started from a commit the repository never had | `UT-122` | warn | warned, severity `WARNING` |
| `SDD-V053` | AI review claims to satisfy a human gate | `UT-123` | refuse | refused, exit 1 |
| `SDD-V054` | verification cites an unplanned test identifier | `UT-124` | refuse | refused, exit 1 |
| `SDD-V055` | review cites a session that does not exist | `UT-125` | refuse | refused, exit 1 |
| `SDD-V056` | declared scope escapes the repository | `UT-126` | refuse | refused |
| `SDD-V057` | `COMPLETE` with one required test unverified | `UT-127` | refuse | refused, exit 1 |
| `SDD-V058` | change to a prohibited path inside an allowed prefix | `UT-128` | refuse | refused |

Every rule introduced by `SPEC-0002` has at least one dedicated negative
fixture. `SDD-V051` has two, because it enforces two distinct comparisons and
one passing does not imply the other.

## Two cases that check a refusal rather than a finding

**`UT-131`** asserts that a failing `create-session` writes no file. It counts
the session records before and after. A finding that is emitted while the
record is written anyway would be a message, not a control.

**`UT-132`** introduces a defect unrelated to the agent layer (a requirement
identifier that no longer resolves) and confirms that `preflight`,
`verify-session` and `review-check` all refuse, each carrying the note that no
agent action is authorised. Structural correctness gates the whole control
plane, not just the command that noticed it.

## What is asserted, and what is not

Each test asserts that the expected rule appears in the finding set, and where
relevant that the exit code is 1. `UT-128` additionally asserts that
`SDD-V046` is **absent**, because a prohibited path must be reported once.

No test asserts an exhaustive finding set. That would make every case brittle
against an unrelated rule addition, and brittle tests get relaxed rather than
fixed.
