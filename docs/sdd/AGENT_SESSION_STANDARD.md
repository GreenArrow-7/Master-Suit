# Agent Session Standard

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`).

Every material implementation session has an explicit, machine-readable input
state. Without it, "what was this agent allowed to do?" is answerable only
from a chat transcript, which is not engineering evidence.

## Location

```text
specs/SPEC-NNNN-short-slug/
└── execution/
    ├── ASES-0001.json     agent execution session
    ├── VER-0001.json      verification run
    └── REV-0001.json      independent review
```

The session file is a **control artefact, not a specification**. It records
what an agent was authorised to do. It never carries requirements, acceptance
criteria or approvals, and it carries no secret.

## Session record

```json
{
  "schemaVersion": 1,
  "sessionId": "ASES-0001",
  "specId": "SPEC-0002",
  "role": "IMPLEMENTER",
  "actorType": "ai",
  "actorId": "claude-session-a",
  "taskIds": ["TASK-007"],
  "startedFromCommit": "f16ed67…",
  "initialChangedPaths": ["apps/web/src/…"],
  "initialDigests": { "apps/web/src/…": "9f2c…" },
  "allowedPaths": ["tools/sdd/cli.mjs"],
  "prohibitedPaths": [],
  "requiredTests": ["UT-004", "UT-005"],
  "requiredApprovals": [],
  "verifiedTests": [],
  "status": "READY",
  "result": null
}
```

| Field | Meaning |
|---|---|
| `role` | One of the seven in `docs/sdd/AGENT_ROLE_MODEL.md` |
| `actorType` | `ai` or `human`. Sessions are normally `ai` |
| `actorId` | An opaque label distinguishing one actor from another. Used for separation of duty; never a credential |
| `startedFromCommit` | The commit the session began from, for drift detection |
| `initialChangedPaths` | Working-tree paths already dirty at session start, so pre-existing work is not mistaken for the agent's |
| `allowedPaths` | Derived from the task's declared scope. Exact paths and directory prefixes only |
| `requiredTests` | Test identifiers the task names |
| `status` | `READY`, `IN_PROGRESS`, `COMPLETE`, `PARTIAL`, `BLOCKED`, `FAILED` |

## Creating a session

```bash
node tools/sdd/cli.mjs agent preflight      --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
node tools/sdd/cli.mjs agent create-session --spec SPEC-NNNN --role IMPLEMENTER --task TASK-NNN
```

**Creating a session does not authorise implementation when preflight fails.**
The command refuses to write the record and says so. There is no flag to
override it, and none will be added.

## Closing a session

```bash
node tools/sdd/cli.mjs agent close-session --spec SPEC-NNNN --session ASES-NNNN
```

This records `finalChangedPaths` and `finalDigests` — the tree as it stood when
the session finished — alongside the `initialChangedPaths` and `initialDigests`
captured at the start.

**Why both ends are needed.** With only a start state, `scope-check` had to
compare a closed session's boundary against the *live* tree, which meant an
edit made later by a different authorised session was attributed to the closed
one. Three sessions were falsely failed that way in a single pass
(`SPEC-0003/CONV-009`).

| Session state | Judged against |
|---|---|
| `READY`, `IN_PROGRESS` | the live working tree |
| terminal, with end-state evidence | its own recorded end state |
| terminal, without it | nothing — `SDD-V063` reports the limitation |

**The evidence is written once.** Re-running the command on a record that
already carries it does not refresh it; a closed session must not be able to
absorb work that happened after it ended.

**Sessions closed before this existed keep their original result.** They carry
no end-state evidence, so re-evaluation attributes nothing to them and says so
rather than guessing.

## Attribution: what the session actually changed

Added by `SPEC-0002/TASK-012` after `CONV-007`. Scope is judged on the
**session-introduced delta**, never on everything currently dirty.

Subtracting `initialChangedPaths` from the current set is not sufficient, and
the reason is worth stating because the naive version looks correct. A file
that was already dirty and is then modified *again* by the session appears in
both sets, so subtraction removes it — and the agent's own change is silently
authorised. That is a guess in the permissive direction, which is the one that
must never be made.

So the session records a content digest per initially-changed path, and each
changed path is classified by comparing digests:

| Classification | When | Consequence |
|---|---|---|
| `SESSION` | not dirty at session start, or dirty but the content has since changed | judged against the declared scope |
| `PRE_EXISTING` | dirty at session start and byte-identical since | not attributed, not blamed |
| `UNATTRIBUTED` | dirty at session start with no recorded digest | `SDD-V052`, review required |

One comparison covers modification, creation and deletion: a file that existed
and no longer does moves from a digest to `null`, which differs.

**`UNATTRIBUTED` is not a pass.** A record written before digests existed, or
a file that cannot be read, produces a warning that asks a human to look. It
never produces silence, and it never produces "safe".

## Status is not completion

Three different states, deliberately not interchangeable:

| State | Meaning | Who decides |
|---|---|---|
| `IMPLEMENTATION COMPLETE` | The assigned execution scope was carried out | The implementing agent |
| `VERIFICATION PASS` | The required tests ran and passed | A tester or verification record |
| `CONVERGENCE ACCEPTED` | Specification, plan, code, tests and results agree | A human, from R3 upward |

A session's `status: "COMPLETE"` means only the first. An agent may say *task
execution complete*. It may **not** say *feature accepted* unless it is
quoting a recorded human decision.

`SDD-V057` rejects `COMPLETE` while required tests have no recorded
verification, so the first state cannot quietly borrow the second's authority.

## Records carry no output and no secrets

A verification record stores command names, exit codes and test identifiers.
It does not store full command output. A CI log is more widely readable than
the file it came from, and an artefact that copies logs will eventually copy a
credential (`SPEC-0002/SEC-006`).

## Authority / References

- `docs/sdd/AGENT_ROLE_MODEL.md`, `AGENT_EXECUTION_RECORD.md`,
  `AGENT_ROLE_GATE_MATRIX.md`, `AGENT_STOP_PROTOCOL.md`
- `docs/sdd/schemas/agent-session.schema.json` and the sibling schemas
- `specs/templates/AGENT_SESSION_TEMPLATE.json`
- `docs/sdd/VALIDATION_RULES.md` — `SDD-V042` to `SDD-V058`
