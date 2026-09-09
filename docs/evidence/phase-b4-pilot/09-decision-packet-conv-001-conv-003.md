# Decision packet — CONV-001 and CONV-003: environment limitations

| Field | Value |
|---|---|
| Findings | `SPEC-0003/CONV-001`, `SPEC-0003/CONV-003` |
| Status | both `OPEN` — **not decided here** |
| Prepared | 2026-09-08 by AI agent |
| Blocks | `SPEC-0003` convergence acceptance |

Both were audited against the convergence standard before being left `OPEN`.
The audit, and why neither `RESOLVED` nor `NOT_APPLICABLE` is available to an
agent, is set out below.

---

## Why these are `OPEN` and not something more comfortable

`specs/templates/CONVERGENCE_TEMPLATE.md` is the authority. It permits exactly
four statuses and constrains two of them:

> A residual risk transitions `OPEN` → `ACCEPTED_RISK` **only when an
> authorised human accepts it**, with the accepting functional role and
> evidence recorded. **An AI may recommend acceptance and may never record
> it.**

and

> **`OPEN` is the canonical pre-acceptance status.** It covers a finding that
> has not yet received its required disposition, whether that is unresolved
> engineering work, pending governance action, **or a residual risk awaiting
> human acceptance**.

Applied to these two:

| Status | Available? | Why |
|---|---|---|
| `RESOLVED` | **No** | Neither is fixed. `prettier --check` still exits 1; the unit suite still reports 42 failures. Marking a still-failing check `RESOLVED` because this pilot did not cause it would be false |
| `NOT_APPLICABLE` | **No** | Both checks are applicable, both ran, and both failed. `NOT_APPLICABLE` is for a check that does not apply — `SEC-` verification on a specification with no security requirement, for instance |
| `ACCEPTED_RISK` | **Only you** | This is the correct destination for both, and only a human may record it |
| `OPEN` | **Current** | The honest pre-acceptance state |

**An agent cannot move either finding.** That is the whole point of the rule.

---

# CONV-001 — `prettier --check` fails on CRLF

## What was observed

`npx prettier --check src/components/workspace/TableSearch.tsx` exits **1**.

## Evidence that it is environmental, not a defect

1. After stripping `\r`, the file is **byte-identical** to prettier's own
   output. `diff` reports no difference at all.
2. `git config core.autocrlf` is **`true`**, so the working tree is CRLF while
   the index is LF.
3. `apps/web/src/components/workspace/WorkspaceTable.tsx` — **untouched by this
   pilot** — fails the identical check.

## Audit against EVC-014, as instructed

`EVC-014` is `PARTIALLY RESOLVED` and records: *"Unit suite fails locally on
Windows, CI status unconfirmed"* — 12 failures in three named unit files,
caused by path separators, a CRLF worktree defeating a `(.*)$` regex, and
POSIX file modes.

**`CONV-001` is a sibling, not a duplicate.** It shares the root cause —
`core.autocrlf=true` — but `EVC-014` is scoped to the *unit suite* and names
three specific spec files. It does not cover `prettier --check`, and extending
it silently to do so would be reclassifying an existing registered condition to
make a new finding disappear.

**No new evidence conflict is raised either.** This is not a disagreement
between documents; it is a workstation configuration effect. It belongs in the
convergence findings, where it is.

## Recommendation, which is not a decision

Accept as an environment limitation, owner **QA / Application Engineering**,
with the condition that it is revisited when `.gitattributes` or platform
guards are added — the fix that would close `EVC-014` and this together.

## What was deliberately not done

`prettier --write` was **not** run. It would rewrite line endings across files
this pilot does not own, converting a cosmetic local failure into a large
spurious diff in someone else's in-flight work.

---

# CONV-003 — the unit suite cannot give a regression signal

> **CORRECTED, 2026-09-08.** This section was written before the test database
> was investigated. Two things in it turned out to be wrong and are marked
> below: the attribution of all 30 failures to the database, and the statement
> that no preparation was possible. The current position is in
> `11-test-database-bootstrap.md`; this text is kept so the correction is
> visible rather than silently replaced.
>
> **What actually happened:** `master_saas_test` was one migration behind.
> Applying it fixed **18** of the 30, not all of them, taking the suite to
> **1892 passed / 24 failed**. The other 12 were never database failures and
> are now `CONV-011`. The finding stays `OPEN` because the *workflow* that
> should keep the database current still does not exist — and the comment in
> `generate-secrets.mjs` claiming `npm run setup` creates it is false.

## What was observed

`npm test` → **1874 passed, 42 failed** across 8 files, exit 1.

| Failures | Files | Cause |
|---|---|---|
| 12 | `capture-vault`, `env-example-parses`, `observability` | **exactly `EVC-014`** — same three files, same counts |
| 30 | `password-reset` (11), `assistant-guardrails` (11), `forgot-password-flow` (6), `p2-regressions` (1), `guarded-prologue` (1) | **stale test database** |

## The stale database, precisely

`The column platformUserId of relation PasswordResetToken does not exist in
the current database.`

- `.env.test` names **`master_saas_test`**.
- This pilot's Playwright run used **`leadflow`**, a different database.
- `npx prisma migrate status` → `leadflow` is current, 65 migrations.
- `npm run check:drift` → **no difference detected**.

So the schema and the migrations agree with each other. It is
`master_saas_test` that has never been brought forward.

## Why SPEC-0003 provably cannot reach these tests

1. `apps/web/vitest.config.mts` sets **no `environment`**, so there is no DOM
   and no React component can be rendered.
2. It **excludes `tests/e2e/**`**, so the pilot's own Playwright spec never
   runs under vitest.
3. **No vitest test imports `TableSearch`.** The only references anywhere are
   inside the pilot's own Playwright file.

## What was deliberately not done — superseded

> This paragraph said `master_saas_test` was not migrated because no documented
> workflow existed. The first half is no longer true: it **was** migrated on
> 2026-09-08, after the human directed that the test environment be
> investigated. The second half stands — there is still no documented
> workflow, which is why the finding remains `OPEN`.
>
> What was applied was one **existing** migration. No migration was created, no
> schema was modified, no reset was performed, and nothing outside the loopback
> container was contacted. See `11-test-database-bootstrap.md`.

**No failing test was marked `PASS`, and no count was rounded.**

## Recommendation, which is not a decision

Accept as an environment limitation for `SPEC-0003` only, owner **DevOps /
Production Engineering**, with an explicit condition:

> **A documented, deterministic `master_saas_test` preparation workflow is
> REQUIRED before pilot #2.** Until it exists, `npm test` cannot serve as a
> gate for any future pilot, because a real regression in those five files
> would be indistinguishable from this noise.

That requirement is already recorded as item 2 in
`05-pilot-retrospective.md`, classed **REQUIRED**.

---

## What is being asked

| Finding | Proposed status | Proposed owner | Condition |
|---|---|---|---|
| `CONV-001` | `ACCEPTED_RISK` | QA / Application Engineering | Revisit when `.gitattributes` or platform guards land |
| `CONV-003` | `ACCEPTED_RISK` | DevOps / Production Engineering | A documented `master_saas_test` preparation workflow before pilot #2 |

Accepting both, together with the `CONV-005` decision and the `CONV-007`
review, would leave `SPEC-0003` with **zero** `OPEN` findings and a verdict of
`PASS WITH ACCEPTED LIMITATIONS`.

Rejecting either leaves it `OPEN`, and the verdict stays `FAIL` until the
underlying condition is fixed.
