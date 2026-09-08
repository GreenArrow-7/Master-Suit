# Scope attribution remediation

**Task:** `TASK-012` · **Session:** `ASES-0003` · **Date:** 2026-09-07
**Resolves:** `CONV-007` · **Raised under:** `CHG-001`

## What was wrong

`scope-check` judged every currently dirty file against the session's scope.
On this repository that meant 34 pre-existing interface files, none of which
any agent had touched, were reported as scope violations. The command was
unusable on a dirty tree, and it contradicted the documented intent that
pre-existing work is never attributed to the agent.

## Why the obvious fix was rejected

`CONV-007` recommended subtracting `initialChangedPaths` from the current set,
mirroring what drift detection already did. **That was implemented as a
recommendation and rejected during the work as unsafe.**

A file that was already dirty and is then modified *again* by the session
appears in both sets. Subtraction removes it. The agent's own change is
silently authorised — a guess in the permissive direction, on exactly the case
an attacker or a careless agent would produce.

`UT-011` and `UT-012` are that case. Under path subtraction both would pass;
under the implemented model `UT-012` correctly fails.

## The model

The session records a SHA-256 for each initially-changed path. Attribution
compares content, not path membership.

```text
path not in initialChangedPaths                     → SESSION
path in initialChangedPaths, digest recorded:
    current content differs from recorded           → SESSION
    current content identical                       → PRE_EXISTING
    path is a directory                             → UNATTRIBUTED
path in initialChangedPaths, no digest recorded     → UNATTRIBUTED

scope is judged on SESSION only
UNATTRIBUTED raises SDD-V052, review required
```

One comparison covers modification, creation and deletion: a file that existed
and no longer does moves from a digest to `null`, which differs.

**Every ambiguous case resolves to review required, never to safe.**

## The directory case, found during the work

git collapses an untracked directory into a single status entry. A change to a
file beneath it does not alter that entry.

Digesting a directory originally returned `null`, which compared equal to the
recorded `null` and classified the whole tree as `PRE_EXISTING` — a silent
pass over arbitrary content. This repository has twelve such entries, so it
was not hypothetical.

A directory now returns an explicit marker and classifies as `UNATTRIBUTED`.
Found, fixed inside the task, and covered by `UT-017`.

## Results

| Case | Test | Result |
|---|---|---|
| Pre-existing dirty, untouched → not blamed | `UT-008` | pass |
| Clean file modified in scope | `UT-009` | pass |
| Clean file modified out of scope → fails | `UT-010` | pass |
| Pre-existing dirty, modified again, in scope | `UT-011` | pass |
| Pre-existing dirty, modified again, out of scope → fails | `UT-012` | pass |
| File created during the session | `UT-013` | pass |
| File deleted during the session | `UT-014` | pass |
| Rename, both paths attributed | `UT-015` | pass |
| Windows and POSIX separators agree | `UT-016` | pass |
| No digest → review required, not safe | `UT-017` | pass |
| Concurrent unrelated change after session start | `UT-017` | pass |
| Collapsed untracked directory never declared unchanged | `UT-017` | pass |

Twelve tests for ten required cases. Each runs against a **real throwaway git
repository** — `git init`, a base commit, real edits, real renames, real
deletions — because attribution depends on what git actually reports, and a
stub would only prove the stub agrees with itself.

## The real scenario

```text
node tools/sdd/cli.mjs agent scope-check --spec SPEC-0002 --session ASES-0001

before:  34 × SDD-V046 ERROR   "Changed file is outside the approved task scope"
after:    0 errors, 25 × SDD-V052 WARNING
          "Changed before this session with no recorded digest;
           attribution is unproven, review rather than assume"
```

The pre-existing interface work is no longer attributed to any session.
`ASES-0001` predates digest capture, so its paths are unproven rather than
proven-clean — the conservative answer, and the correct one.

**The 34 interface files were not touched, moved, reverted or reformatted at
any point.** `git status` reports them exactly as it did before this pass.

## Scope discipline

`ASES-0003` declared `tools/sdd/tests/validator.test.mjs` as a **prohibited**
path. The session correcting the scope checker could not edit the security
test that judges it, so it could not make its own work pass by relaxing a
check. `ASES-0002` had the mirror-image constraint.

## Limitations

- **`ASES-0002` and `ASES-0003` carry no digests themselves**, having been
  created before this task implemented them. Their scope checks report review
  warnings rather than a clean result. Recorded as `CONV-009` and accepted, not
  backfilled: writing digests into an existing record would fabricate evidence
  about a past moment nobody can verify.
- **A session record is only as trustworthy as the commit containing it.** An
  agent that can write code can write the record, and a fabricated
  `initialDigests` entry would make its own change look pre-existing. See
  `docs/evidence/phase-b3-agent-integration/security-re-review.md` §8.
- **Digest cost on a very large dirty tree is unmeasured.** Fifty-five paths
  here is not a benchmark.
- **A path containing the literal `" -> "` would be split by the rename
  parser** into two paths. This over-reports rather than under-reports, so it
  fails in the safe direction.
