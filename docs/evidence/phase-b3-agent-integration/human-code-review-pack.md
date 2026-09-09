# Human code review pack — `D9`

**Prepared for:** any qualified human reviewer who is not the author
**Date:** 2026-09-07 · **Prepared by:** AI

## Why this gate exists and is unsatisfied

R3 requires **1 human reviewer** (`docs/RISK_CLASSIFICATION.md`,
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`), and `AGENTS.md` §8 makes "human review
completed at the level required" part of Done.

**No human has read this code.** Every record under `execution/` carries
`actorType: "ai"`, and all three review records set
`satisfiesHumanGate: false`.

`REV-0002` and `REV-0003` are AI reviews under an actor label distinct from
the implementing sessions. They satisfy the `SDD-V051` separation check. They
do **not** satisfy this gate, and were never recorded as doing so. An AI
review, a second Claude session, and a different model are all equally
insufficient here.

## What to read, and what to look for

**Start here — the two files that carry the risk.**

| File | Lines | What to check |
|---|---|---|
| `tools/sdd/lib/agent.mjs` | 598 | The whole control plane. Attribution logic, path safety, git invocation, record validation |
| `tools/sdd/cli.mjs` | 389 | Whether `create-session` can ever write when preflight failed; whether `scope-check` judges the right file set |

**Then the tests that are supposed to catch regressions.**

| File | What to check |
|---|---|
| `tools/sdd/tests/agent.test.mjs` | 48 tests. Do the assertions actually bite, or would they pass on broken code? |
| `tools/sdd/tests/validator.test.mjs` | `ST-002` and `ST-009` were rewritten by `TASK-011`. Is the allowlist genuinely stricter? |

**Then the pre-existing modules, changed or depended on.**

`tools/sdd/lib/validate.mjs` (the `--spec` filtering fix),
`tools/sdd/lib/approvals.mjs`, `tools/sdd/lib/diff.mjs`,
`tools/sdd/lib/discover.mjs`, `tools/sdd/lib/lifecycle.mjs`,
`tools/sdd/lib/traceability.mjs`, `tools/sdd/rules/rules.mjs`.

**Then the schemas.** `docs/sdd/schemas/agent-session.schema.json`,
`verification-record.schema.json`, `review-record.schema.json`.

## Specific questions worth answering

Ordered by how much damage a wrong answer causes.

1. **Can `create-session` write a record when preflight produced an error?**
   The claim is no, with no override flag. `UT-131` asserts the record count
   is unchanged. Read `runAgent` in `cli.mjs` and judge for yourself.
2. **Can an agent widen its own scope?** Scope comes from `taskScope` reading
   the approved task. Is there any path where the session's `allowedPaths`
   could be set from something the agent controls?
3. **Is the attribution logic right?** `attribute()` in `agent.mjs`. The case
   that matters: a file already dirty *and* modified again by the session must
   be attributed to the session. `UT-011` and `UT-012` cover it. Naive path
   subtraction gets this wrong.
4. **Does anything reach a shell?** Two `execFileSync` sites, fixed argument
   arrays, `shell: false`, literal `'git'`. `isSafeRef` screens refs before
   use.
5. **Path traversal and symlinks.** `unsafeScopeReason` rejects absolute
   paths, drive letters, traversal segments, null bytes, over-long paths, and
   symlinks whose real path escapes. `lstat` is used, not `stat`.
6. **Windows and POSIX normalisation.** `normalisePath`. `UT-016` and
   `UT-143` cover the edges; `src/exports/` must not match `src/export/`.
7. **Is any JSON parsed unsafely?** Records are bounded at 128 KiB, must be
   regular files, must parse to an object, and a failure is reported rather
   than treated as empty.
8. **Can a record forge authority?** `satisfiesHumanGate: true` with
   `actorType: "ai"` is refused by `SDD-V053`. `actorId` is an opaque
   self-declared label with no cryptographic binding — see the known
   limitation below.
9. **Repository drift.** `SDD-V052` is a `WARNING` and the tool never
   reverts, stashes or overwrites.

## Known limitations the reviewer should weigh, not rediscover

Recorded in `security-re-review.md` and not hidden:

- **A session record is only as trustworthy as the commit containing it.** An
  agent that can write code can write its own `initialDigests`.
- The security checks in `ST-002`/`ST-009` are **textual, not semantic**.
- Attribution compares two moments; anything between them is invisible
  (TOCTOU).
- `git` resolves through `PATH` and inherits `GIT_*` variables.

## What is out of scope for this review

No application code changed. `apps/web/src` carries 34 pre-existing modified
files from redesign work that predates every SDD phase and was untouched
throughout. No schema, migration, dependency or infrastructure change.

## Allowed decisions

| Decision | What happens next |
|---|---|
| APPROVE | A review record with `actorType: "human"` is added under `execution/`; convergence check 15 can pass; `D9` closes |
| REQUEST_CHANGES | A `CHG-` record, a scoped task, a new session, and re-review. `D10` stays ineligible |
| BLOCKED | `D9` stays open; the blocker is recorded as a convergence finding |

## How to record it

Record only what the reviewer actually says. If the statement is *"I reviewed
the listed B3 code and approve it"*, that is what the record carries — no
invented findings, no elaborated rationale.

The record needs: reviewing role, scope reviewed, decision, date, evidence
reference.
