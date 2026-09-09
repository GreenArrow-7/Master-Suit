# B4 pilot #1 — Retrospective

| Field | Value |
|---|---|
| Pilot | `PC-02` / `SPEC-0003` — TableSearch accessibility |
| Risk | `R2` |
| Date | 2026-09-08 |
| Outcome | Implemented and verified in a real browser; convergence recommends `FAIL` pending six human dispositions |
| Prepared by | AI agent |

The first time the SDD framework was driven end to end on **product** code
rather than on the framework itself. That is what makes this worth writing
down: the failure modes here are different from the ones B1–B3 surfaced.

---

## What worked

**Disjoint task scopes did real work.** `TASK-001` declared `apps/web/tests/`
prohibited and `TASK-003` declared `apps/web/src/` prohibited. That meant the
session which wrote the tests *could not* have made them pass by editing the
component, and the session which changed the component *could not* have written
itself a lenient test. This is the single most valuable property the framework
demonstrated, and it cost nothing to set up.

**Digest attribution was clean and quiet.** With 34 pre-existing modified files
in the tree, both scope-checks reported exactly `session 1` and attributed
everything else correctly. The B3 remediation of `CONV-007` paid off here: the
14 `UNATTRIBUTED` warnings were all untracked *directories*, flagged for review
rather than silently assumed safe, which is the behaviour that was asked for.

**The lifecycle refused to let a reviewer act too early.** `QA_REVIEWER`
preflight failed with `SDD-V043` while the specification was still
`APPROVED_FOR_IMPLEMENTATION`. That is the control working — it forced the
lifecycle forward through `IMPLEMENTING` and `VERIFYING` before a review could
be recorded, which is the correct order.

**The stop-before-implementing rule held under pressure.** The pilot stopped at
`CLARIFYING` with two open clarifications, and two plausible ways around the
stop were available and declined. The human's answer then changed the design
materially — option (c), descope `Escape` — which is exactly the outcome that
justifies stopping rather than guessing. Had the agent guessed, it would have
guessed **(b)**, and built a feature the Product Owner did not want.

**Evidence-grounded requirements survived contact.** Seven of nine
clarifications were resolvable from the repository and were resolved there
rather than put to a human. Only the two genuine product questions were
escalated. That ratio feels right.

**The E2E harness ran.** The pre-implementation check predicted
`UNKNOWN — requires runtime/infrastructure verification`; the documented local
workflow turned out to be sufficient, and all seven cases executed in Chromium.
Recording the pessimistic prediction in advance and then beating it is better
than the reverse.

## What failed

**Nothing in the implementation.** No required test failed, no check failed
materially, and no scope boundary was crossed.

**The unit suite could not give a regression signal.** 42 of 1916 vitest tests
fail. 12 are the registered `EVC-014` Windows class. The other 30 trace to
`master_saas_test` — the database `.env.test` names — missing
`PasswordResetToken.platformUserId`. That database has never been brought
forward, and **there is no documented script to prepare it**. A contributor
running `npm test` on a fresh machine cannot tell a real regression from this.

## What was awkward

**The R2 author-approval row assumes a human author.** `R2` places
specification approval with "the author"; the author was an AI, which
`AGENTS.md` forbids from self-approving. The gate could only be discharged by a
human stepping in. This will recur for **every** AI-authored `R1` or `R2`
specification and is currently resolved ad hoc each time.

**Convergence has no vocabulary for "done, awaiting sign-off".** Six findings
are `OPEN` purely because only a human may disposition them. The rules then
force `FAIL`, which reads as "the engineering failed" when it means "nobody has
signed this off yet". The report needed a paragraph of prose at the top to stop
the verdict being misread — a sign the vocabulary, not the report, is short.

**Two approved statements conflicted.** `AD-003` read literally would have
violated `NFR-003`. Both were approved in the same breath. Resolving it needed
a new decision (`AD-006`) recorded mid-implementation, which is the right
mechanism but meant the approved plan was not implementable exactly as written.

**Prose scope lines are not machine-readable.** See below.

## Framework defects discovered

| # | Defect | Evidence | Severity |
|---|---|---|---|
| 1 | The allowed-scope parser extracts backticked tokens from prose and cannot tell a path from a filename fragment. `TASK-003`'s scope became `['apps/web/tests/e2e/', 'tablesearch-a11y']`. Its prohibited list silently dropped "the Playwright and Vitest configuration files", which were described in prose. | `ASES-0002.json` | **REQUIRED** |
| 2 | `SDD-V040` resolves every backticked path-shaped token from the repository root, so writing `` `tests/unit/foo.spec.ts` `` in a document about `apps/web` is an ERROR. Correct, but it silently pushes authors toward long paths or toward not naming files at all. | `convergence.md` validation | RECOMMENDED |
| 3 | No lifecycle state or finding status expresses "complete, awaiting human disposition". `OPEN` conflates it with unresolved engineering work, and the verdict rules then force `FAIL`. | `convergence.md` verdict section | RECOMMENDED |
| 4 | The `R2` specification-approval row names "the author" with no provision for an AI author. | `spec.md` Approval section | RECOMMENDED |

**Defect 1 is `REQUIRED`** because it is the only one that could produce a
*wrong* result rather than an awkward one: a task whose scope is stated in
prose would receive an empty or partial boundary, and the scope-check would
then pass a change it should have caught.

## Test-environment problems

| Problem | Impact | Status |
|---|---|---|
| `master_saas_test` schema is stale; no documented preparation script exists | 30 vitest failures; unit suite unusable as a regression gate | `CONV-003`, OPEN |
| `core.autocrlf=true` makes `prettier --check` fail on correctly formatted files | `format:check` cannot go green locally | `CONV-001`, OPEN |
| The same setting causes 12 unit failures | Registered | `EVC-014`, PARTIALLY RESOLVED |
| The seed refuses to run without `ALLOW_DEMO_SEED=yes` | Correct and welcome — it made the agent verify the target was disposable before seeding | working as designed |
| `E2E-006` depends on `/platform/audit` holding ≥8 rows | Case could fail on a reset database | `CONV-006`, OPEN |
| `rtk` is referenced by the global instructions but is not installed | Commands fell back to plain `npm`; no impact beyond token cost | noted |

## Governance ambiguities

1. **Who approves an AI-authored R2 specification?** Resolved ad hoc by a human
   approving. Recurs every time. Candidate for an `EVC-`.
2. **Does "a material clarification is OPEN" bind the specification or the
   task?** Read as specification-level here, deliberately and conservatively.
   Worth stating explicitly, because the narrower reading is available and
   tempting.
3. **`EVC-016` remains OPEN** and still blocks `PC-01`. Untouched, as
   instructed.

## What must change before pilot #2

| # | Change | Class | Why |
|---|---|---|---|
| 1 | Make task scope lines machine-readable, or make the parser reject a non-path token | **REQUIRED** | Framework defect 1 — the only one that can produce a wrong verdict |
| 2 | Migrate `master_saas_test` and add a documented script to prepare it | **REQUIRED** | Without it, `npm test` cannot be used as a gate for any future pilot |
| 3 | Decide who approves an AI-authored R1/R2 specification, once, in writing | **RECOMMENDED** | Removes an ad hoc human step from every future pilot |
| 4 | Give convergence a way to say "complete, awaiting disposition" | **RECOMMENDED** | Stops `FAIL` being the honest-but-misleading answer |
| 5 | Add `.gitattributes` or platform guards for the CRLF class | **RECOMMENDED** | Closes `EVC-014` and `CONV-001` together |
| 6 | Seed the rows `E2E-006` needs, or retarget it at an unconditional consumer | **RECOMMENDED** | `CONV-006` |
| 7 | Consider whether a live region should announce on every keystroke | **OPTIONAL** | `CONV-005`; needs a Product Owner view, not a framework change |
| 8 | Install `rtk` or drop it from the global instructions | **OPTIONAL** | Cosmetic |

**None of these was implemented.** Framework changes are not this pilot's
scope, and items 1 and 2 in particular deserve their own specifications rather
than a drive-by fix.

## The honest summary

The framework did its job: it stopped the agent from guessing a product
decision, it prevented a session from grading its own homework, it caught a
plan that could not be implemented as written, and it refused to let a
reviewer act out of order. The pilot produced a small, correct, fully traced
change with real browser evidence behind it.

What it could not do is tell the difference between "this work is finished" and
"a human has not yet looked at it". Both come out as `FAIL`. That is the main
thing to fix before pilot #2, and it is a vocabulary problem rather than a
control problem.

---

## Addendum — remediation pass, 2026-09-08

Written after the human declined to close the pilot on the first convergence
and directed that the two technical findings be fixed rather than accepted.
That was the right call, and this section records what it changed.

### What the remediation actually found

**The scope-parser defect was worse than the pilot case that exposed it.**
`CONV-008` was raised because `SPEC-0003/TASK-003` produced
`['apps/web/tests/e2e/', 'tablesearch-a11y']`. Fixing it properly surfaced two
things nobody had looked for:

- `SPEC-0001/TASK-012` was returning **`CHG-001` as an allowed path** — an
  identifier cited in prose, admitted as a filesystem boundary.
- `SPEC-0001/TASK-009` declares `tools/sdd/tests/**`, a **glob**, which
  `CL-002` explicitly forbids and the parser silently accepted.

Neither would have been found by accepting the finding and moving on.

**A third defect appeared during the pass itself.** `CONV-009`: re-running
`scope-check` on a *completed* session evaluates the live working tree, so a
file changed later by a different authorised session reports as a violation of
a session that never touched it. It hit `ASES-0001`, `ASES-0003` and
`ASES-0008` in turn. Every one of those sessions passed its scope check when
it ran.

### Status of the items this retrospective raised

| # | Item | Class | Status |
|---|---|---|---|
| 1 | Machine-readable task scope | **REQUIRED** | **DONE** — `SPEC-0002/CHG-007`, `TASK-018`, `SDD-V062`, ten tests `UT-046`–`UT-055` |
| 2 | `master_saas_test` preparation workflow | **REQUIRED** | **still open** — `CONV-003`, awaiting human acceptance and a documented script |
| 3 | Who approves an AI-authored R1/R2 specification | RECOMMENDED | still open |
| 4 | Vocabulary for "complete, awaiting disposition" | RECOMMENDED | still open — and it bit again: five `OPEN` findings force `FAIL` on work that is finished |
| 5 | `.gitattributes` or platform guards for CRLF | RECOMMENDED | still open — `CONV-001` |
| 6 | `E2E-006` determinism | RECOMMENDED | **DONE** — `SPEC-0003/CHG-001`, `TASK-006`; the test now creates its own eight rows |
| 7 | Live-region announcement policy | OPTIONAL | escalated to a Product Owner decision — `CONV-005` |
| 8 | `rtk` installed or dropped | OPTIONAL | still open |

### New item

| # | Change | Class | Why |
|---|---|---|---|
| 9 | `scope-check` should refuse a `COMPLETE` session, or evaluate against the tree as of session end | **REQUIRED** | `CONV-009`. It produced three false failures in one pass. A genuine violation in a completed session is currently indistinguishable from this noise |
| 10 | Task scope should include the specification's own governance artefacts | RECOMMENDED | `ASES-0008` had to edit `test-plan.md` to register its own tests and could not do so within its declared scope. Every task will hit this |

### The honest summary, revised

The framework caught more when it was made to fix rather than accept. Two
findings closed, two latent defects found in older specifications, one new
control-plane defect surfaced — all from declining to accept a finding that
had already been written up as low-impact.

What has not changed is the vocabulary problem. `SPEC-0003` is finished work
with real browser evidence behind it, and its verdict is `FAIL`, because five
findings await a human and there is no status that says so. That remains the
single most misleading thing about the system.

---

## Addendum 2 — technical closure pass, 2026-09-08

The human declined to close the pilot a second time, directing that `CONV-009`
be fixed rather than accepted, that the `ASES-0008` deviation be separated from
it, that the meta-artefact gap be investigated, that the repository-wide
validation gap be closed, and that the test database be properly investigated.

Every one of those turned up something the previous pass had missed.

### The count went up, and that is the finding

| Pass | Closed by remediation | Added |
|---|---|---|
| 1 | — | `CONV-001` … `CONV-008` |
| 2 | `CONV-006`, `CONV-008` | `CONV-009` |
| 3 | `CONV-009` | `CONV-010`, `CONV-011` |

Three passes, five findings closed **by fixing them**, three new ones found by
the act of fixing. A report whose count only ever goes down is not being
written honestly.

### Two of my own statements were wrong and are corrected in place

1. **`ASES-0010`'s notes claimed nothing was changed in that session.** False —
   it had implemented `validate.mjs` and `rules.mjs`; timestamps prove it. The
   note now says so and says it is a correction.
2. **`CONV-003` attributed 30 test failures to the stale database.** Only 18
   were. The other 12 are static-analysis assertions that never touched a
   database, now `CONV-011`.

Neither was caught by tooling. Both were caught by re-reading evidence after
the state changed, which is an argument for re-deriving conclusions rather than
carrying them forward.

### What the fixes found that nobody was looking for

- **`SPEC-0001/TASK-012` was returning `CHG-001` — an identifier — as an
  allowed path.** Found by fixing the parser, not by suspecting it.
- **`SPEC-0001/TASK-008` declares a glob** that `CL-002` forbids, so its
  effective allowed set was empty and the session that delivered the test suite
  was measured against nothing.
- **The control plane had the meta-artefact gap silently.** `create-session`
  writes a session record into a directory almost no task declares, and never
  checked itself. `ASES-0008` only made it visible.
- **`generate-secrets.mjs` documents a workflow that does not exist.** It says
  `master_saas_test` is created by `npm run setup`; `setup` migrates `leadflow`
  and compose creates only `leadflow`. That false comment is why the drift ran
  undetected.

### What worked

**Stopping at boundaries, four times in one task.** `TASK-020` took four
sessions: `ASES-0010` blocked on a duplicate test-identifier declaration,
`ASES-0011` stopped at the fixture boundary, `ASES-0012` stopped before the
test plan, `ASES-0013` finished it. Each stop was a control firing, and each
scope amendment was recorded **before** the files were touched.

**The new rule caught its own change record.** An explanatory note placed
inside a scope declaration was read as prose. The note was moved; the rule was
not weakened.

**`UT-058` is the test that matters most.** It proves the `CONV-009` fix did
not over-correct: a session that genuinely crossed its own boundary still
fails, both while open and after closing. Without it, "stop blaming closed
sessions" could have quietly become "stop checking closed sessions".

### Status of the items this retrospective raised

| # | Item | Class | Status |
|---|---|---|---|
| 1 | Machine-readable task scope | REQUIRED | **DONE** — `CHG-007`, and `CHG-008`/`TASK-020` closed the repository-wide half |
| 2 | `master_saas_test` preparation workflow | **REQUIRED** | **partially** — the database is current and the procedure is proven, but no documented workflow exists. Still `REQUIRED` before pilot #2 |
| 3 | Who approves an AI-authored R1/R2 specification | RECOMMENDED | still open |
| 4 | Vocabulary for "complete, awaiting disposition" | RECOMMENDED | still open, and it bit a third time |
| 5 | `.gitattributes` or platform guards for CRLF | RECOMMENDED | still open — `CONV-001`, 12 failures |
| 6 | `E2E-006` determinism | RECOMMENDED | **DONE** — `CHG-001` |
| 7 | Live-region announcement policy | OPTIONAL | escalated — `CONV-005` |
| 8 | `rtk` installed or dropped | OPTIONAL | still open |
| 9 | `scope-check` on a `COMPLETE` session | REQUIRED | **DONE** — `CHG-008`/`TASK-019` |
| 10 | Task scope should include its own governance artefacts | RECOMMENDED | **DONE** — `CHG-008`/`TASK-021`, deliberately excluding `test-plan.md` |

### New items

| # | Change | Class | Why |
|---|---|---|---|
| 11 | Enforce that a required-test identifier is claimed by only one task | RECOMMENDED | `TASK-020` claimed `UT-046`–`UT-049`, which `TASK-018` already owned. Only a manual read caught it. `SDD-V054` checks existence, not ownership |
| 12 | Correct or remove the `master_saas_test` claim in `generate-secrets.mjs` | **REQUIRED** | A comment describing a workflow that does not exist is worse than no comment; it is why nobody checked |
| 13 | Decide what to do about two orphaned migrations in `master_saas_test` | RECOMMENDED | Its schema describes things the repository has removed |
| 14 | Raise the assistant tool-permission drift as its own specification | RECOMMENDED | `CONV-011`; plausibly `R4`, since it concerns what an AI tool may read |

### The honest summary, third revision

The framework keeps earning its cost by refusing to let a finding be argued
away. Each time a finding was fixed instead of accepted, the fix exposed
something older and worse than the finding itself.

The vocabulary problem is now the clearest thing in this document. `SPEC-0003`
is finished, verified product work whose verdict is `FAIL`, for the third
consecutive pass, because findings await humans and no status says so. Every
report has needed a paragraph at the top explaining that `FAIL` does not mean
what it says. That is the single change most worth making before pilot #2.

---

## Addendum 3 — closure, 2026-09-08

Seven human dispositions recorded (`D-B4-01` … `D-B4-07`). `OPEN` reached 0 and
the verdict became `PASS WITH ACCEPTED LIMITATIONS`.

**Five accepted limitations remain real and are not fixed.** `prettier --check`
still exits 1, `master_saas_test` still has no documented bootstrap, the
`ASES-0008` `test-plan.md` deviation is still a deviation, and the product suite
still reports **1892 passed / 24 failed**. None is recorded as `RESOLVED`.

### Conditions the approvers attached

1. **`CONV-003`** — a deterministic documented `master_saas_test` bootstrap is
   **REQUIRED before pilot #2 begins**; the acceptance does not authorise
   pilot #2 without it.
2. **`CONV-012`** — the harness instability must stay visible here, and must be
   investigated rather than re-accepted if it becomes reproducible or worsens.
3. **`CONV-005`** — approves behaviour for `SPEC-0003` only; it does **not**
   set a universal accessibility policy for other search components.
4. **`CONV-010`** — historical and non-precedential; authorises no future
   scope violation, retroactive expansion or governance-file editing.
5. **`CONV-011`** — bounded to `SPEC-0003` convergence; those failures are
   **not** harmless globally and must not be shown as passing.

### REQUIRED before pilot #2

| # | Action | Source |
|---|---|---|
| 1 | Deterministic documented `master_saas_test` bootstrap | `CONV-003` acceptance condition |
| 2 | Review or correction strategy for the 7 `SDD-V064` historical declarations | `10-historical-scope-declarations.md` |
| 3 | Follow up the test-harness instability if it recurs | `CONV-012` acceptance condition |
| 4 | Correct the false `npm run setup` claim in `generate-secrets.mjs` | `11-test-database-bootstrap.md` |
| 5 | Retain the corrected historical-session scope mechanism | `CHG-008` / `TASK-019` |

`EVC-016` remains separate and `OPEN`. `PC-01` is untouched.

### The one thing that did not get fixed across four passes

There is still no status meaning *"complete, awaiting human disposition"*.
`SPEC-0003` sat at `FAIL` for three consecutive passes while being finished,
verified product work — and every report needed a paragraph explaining that
`FAIL` did not mean what it said. It only became `PASS WITH ACCEPTED
LIMITATIONS` when humans signed, which is correct, but the intervening state
was persistently misleading. **That remains the single most valuable change
before pilot #2**, and it is a vocabulary change, not a control change.

---

## B4 PILOT #1 — FORMALLY CLOSED

**PASS WITH ACCEPTED LIMITATIONS**, 2026-09-08.

| Criterion | State |
|---|---|
| Human code review | `REV-0002`, APPROVE, `actorType: "human"` |
| OPEN convergence findings | **0** |
| Final verdict | `PASS WITH ACCEPTED LIMITATIONS`, document and machine identical |
| Convergence acceptance | Qualified Human Reviewer, ACCEPT |
| Lifecycle | `VERIFYING` → `CONVERGED`, a legal transition |
| Retrospective | this document |
| Before-pilot-#2 actions | recorded below, none waived |

**Not all limitations are resolved.** Five remain accepted risks and the
conditions behind them are unchanged: `prettier --check` still exits 1,
`master_saas_test` still has no documented bootstrap, the `ASES-0008`
`test-plan.md` deviation is still a deviation, the product suite still reports
**1892 passed / 24 failed**, and the harness flake is still uninvestigated.

**One governance gap was closed on the way out.** `EVC-017` — gate 6 named the
*author* as the R0–R2 convergence acceptor while `AGENTS.md` forbids an AI
author from discharging any gate, leaving the gate with no eligible actor. The
Solution Architect resolved it: an AI-authored R0–R2 specification is accepted
by a **Qualified Human Reviewer**. Gate 6 and the risk matrix were corrected;
`AGENTS.md` was not touched and no rule was relaxed.

That is the second time this pilot hit the same class of gap — `EVC-015` was
the first, at gate 1. Both are now written down rather than worked around.

**What the pilot cost, and what it caught.** Four convergence passes. Twelve
findings, five closed by remediation, two by human decision, five accepted.
Along the way it found a scope parser admitting identifiers as filesystem
paths, a completed session being blamed for a later session's edits, a task
model with no lawful way to record its own evidence, a test database a
migration behind, and a code comment describing a setup workflow that does not
exist. None of those was the defect the pilot set out to fix.

**Not authorised by this closure:** pilot #2, staging, production, release,
deployment, migration, commit, push, merge, `PC-01`, or resolution of
`EVC-016`.

### Pilot #2 remains NOT AUTHORIZED

| # | Mandatory prerequisite | Source |
|---|---|---|
| 1 | Deterministic documented `master_saas_test` bootstrap | `CONV-003` acceptance condition |
| 2 | Review or correction strategy for the 7 `SDD-V064` historical declarations | `10-historical-scope-declarations.md` |
| 3 | `CONV-012` harness-instability follow-up if it recurs | `CONV-012` acceptance condition |
| 4 | Correct the false `npm run setup` claim in `generate-secrets.mjs` | `11-test-database-bootstrap.md` |
| 5 | Retain the corrected historical-session scope mechanism | `CHG-008` / `TASK-019` |

Pilot #2 additionally requires a **separate human pilot-selection decision**.
`EVC-016` stays `OPEN` and `PC-01` stays unselected.
