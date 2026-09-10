# Bootstrap session audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## The problem, stated plainly

`SPEC-0002` builds the machinery that governs agent sessions. That machinery
did not exist while most of `SPEC-0002` was being built. A phase cannot be
fully governed by the control it is creating.

This is the bootstrap boundary. It is recorded as `CONV-003` and it is not
disguised anywhere in this package.

## Where the boundary falls

| Work | Governed by a session |
|---|---|
| `TASK-001` agent role model and standards | **no** — the tooling did not exist |
| `TASK-002` session, scope, drift primitives | **no** |
| `TASK-003` rule catalogue extension | **no** |
| `TASK-004` to `TASK-006` control plane library | **no** |
| `TASK-007` command line integration | **no** |
| `TASK-008` fixtures and tests | **no** — this is what made governance possible |
| `TASK-009` documentation integration | **no** |
| `TASK-010` earlier part: security review, most of the evidence package | **no** |
| `TASK-010` tail: the remaining evidence work | **yes — `ASES-0001`** |

One session out of ten tasks. That is the honest count.

## What `ASES-0001` actually demonstrates

It is a real session, not a hand-written illustration. It was produced by
running the shipped command:

```bash
node tools/sdd/cli.mjs agent preflight \
  --spec SPEC-0002 --role IMPLEMENTER --task TASK-010
node tools/sdd/cli.mjs agent create-session \
  --spec SPEC-0002 --role IMPLEMENTER --task TASK-010 --actor <label>
```

The record's scope, required tests, starting commit and initial changed paths
were derived by the tool from the approved task, not typed in. That is the
part worth demonstrating: the agent did not choose its own boundaries.

`VER-0001` records the test run. `REV-0001` records an independent review
under a different actor label, which is what makes `SDD-V051` meaningful here
rather than vacuous.

## What it does not demonstrate

- It does not make `TASK-001` to `TASK-009` governed retrospectively. They
  were not.
- It does not prove the control plane works on a product feature. Nothing here
  touched application code.
- The independent review is a second AI session. Per `CONV-001`, that proves
  two records differ, not that two minds looked.

## A real ordering constraint found while doing this

Preflight refuses while any blocking validation error exists. `SPEC-0002`
cited evidence documents that had not been written yet, which is `SDD-V040`,
which is a blocking error, which meant no session could be opened until those
documents existed.

So part of the evidence package had to be written **before** the session that
would have governed writing it. That is a genuine constraint of a first
implementation, not a workaround: the alternative would have been to suppress
`SDD-V040`, and suppressing a rule to make its own phase pass is exactly what
this system exists to prevent.

The count of blocking errors as the phase progressed was 22, then 5, then 2,
then 0. Each drop is a document that was written, not a rule that was relaxed.

## What the session actually caught

The session was not a formality. Running the tooling on its own tail surfaced
two defects that had not been noticed while building it:

- `CONV-006` — a `SPEC-0001` security test went red because its
  `child_process` allowlist did not anticipate a second legitimate git
  caller.
- `CONV-007` — `scope-check` attributes pre-existing dirty working-tree
  files to the session, because the scope check does not subtract the initial
  changed paths the way drift detection does.

**Neither was fixed.** Both fixes need files outside `TASK-010`'s declared
scope, and the stop protocol forbids widening a task to cover what the agent
wanted to change. The verification record therefore says `PARTIAL`, not
`PASS`, and the review says `REQUEST_CHANGES`, not `APPROVE`.

An agent that had quietly added itself to the security allowlist would have
produced a cleaner-looking phase and a worse one.

## The honest summary

The tooling works, and this phase proves it on its own tail. The first
specification governed by a session from its first task will be the next one,
not this one.
