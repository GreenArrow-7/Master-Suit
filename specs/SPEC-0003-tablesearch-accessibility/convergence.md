# SPEC-0003 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0003` |
| Risk | `R2` |
| Prepared by | AI agent, CONVERGENCE_REVIEWER perspective |
| Date | 2026-09-08 |
| Recommended verdict | `PASS WITH ACCEPTED LIMITATIONS` |
| Accepted by | **Qualified Human Reviewer, 2026-09-08 — ACCEPT** |

**No finding is `OPEN`.** Seven are `RESOLVED` and five are
`ACCEPTED_RISK`, each accepted by a named human role on 2026-09-08 with a
recorded scope. The verdict is `PASS WITH ACCEPTED LIMITATIONS` rather than
`PASS` because those five limitations are real and still present.

**Four passes. The finding count rose before it closed, and that is the report
working.** Findings that closed were **fixed**, not reclassified; findings
found were **added**, not absorbed.

| Pass | Closed by remediation | Added |
|---|---|---|
| Second | `CONV-006` row-count precondition, `CONV-008` scope parser | `CONV-009` historical re-validation |
| Third | `CONV-009` | `CONV-010` real scope deviation, `CONV-011` misattributed failures, `CONV-012` an observed E2E flake |
| Fourth | — closure only; no engineering change | — |

**Two corrections to earlier statements in this report are recorded in place**
rather than silently edited: `CONV-003` attributed 30 test failures to the
test database when only 18 were, and `CONV-010` separates a genuine scope
deviation that had been described inside a `RESOLVED` finding.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | **PASS** — 16 active requirements; `FR-003`/`FR-004` withdrawn under `CL-001` |
| 2 | Every acceptance criterion is verified | **PASS** — 6 of 6 active; `AC-004` withdrawn |
| 3 | Every security requirement is verified by a security test | **NOT APPLICABLE** — no `SEC-` requirement is declared |
| 4 | All required tests pass; failures are explained | **PASS** — 7 of 7 Playwright cases pass, and `E2E-006` now establishes its own state. Unrelated suite failures explained in `CONV-002` and `CONV-003` |
| 5 | No task left `TODO`, `IN_PROGRESS` or `BLOCKED` without a decision | **PASS** — `TASK-002` `WITHDRAWN` by decision, not abandoned |
| 6 | No behaviour was implemented that no requirement asked for | **PASS** — see *Unrequested behaviour* |
| 7 | No undocumented architecture change | **PASS** — `AD-006` records the one deviation (`CONV-004`) |
| 8 | No undocumented dependency change | **PASS** — the `apps/web` manifest and lockfile untouched |
| 9 | Migration matches the plan; no unplanned schema divergence | **NOT APPLICABLE** — no schema change. `check:drift` reports no difference |
| 10 | Documentation updated where this change made it untrue | **PASS** — spec, plan, test plan, tasks and traceability all updated for the decisions |
| 11 | No new evidence conflict introduced, or it is registered | **PASS** — none introduced. `CONV-003` is an environment defect, not a documentary conflict |
| 12 | Known limitations recorded with owners | **PASS** — five accepted limitations, each with a named human owner and a recorded scope |
| 13 | Residual risk recorded and accepted by the right role | **PASS** — five accepted 2026-09-08 by DevOps / Production Engineering, Product Owner and QA / Release Engineering, per gate 9 |
| 14 | Rollback is written down and feasible | **PASS** — revert two files; no state, schema or flag |
| 15 | The applicable items of `AGENTS.md` §8 hold | **PASS** — the R2 human code review is recorded as `REV-0002`, `actorType: "human"`, and every finding is dispositioned |

## Findings

### CONV-001

**Check:** 4
**Finding:** `npx prettier --check src/components/workspace/TableSearch.tsx`
exits 1.
**Evidence:** after stripping `\r`, the file is byte-identical to prettier's
own output — `diff` reports no difference. `git config core.autocrlf` is
`true`, and the **untouched** `WorkspaceTable.tsx` fails the identical check.
**Impact:** `npm run format:check` cannot go green on this workstation, for
this file or for files this change never touched.
**Recommendation:** accept as the known Windows line-ending class, sibling to
`EVC-014`. `prettier --write` was deliberately **not** run: it would rewrite
line endings across files this work does not own.

**Disposition `D-B4-03`, DevOps / Production Engineering, human, 2026-09-08:**
ACCEPT RISK. The approver acknowledged that the condition also occurs on
untouched files, that no behavioural defect is attributed to it, and that
destructive normalisation during this pilot would create unrelated churn. The
formatting baseline is to be handled separately.
**Scope of acceptance:** `SPEC-0003` pilot #1 only.
**Status:** `ACCEPTED_RISK`
**Owner:** DevOps / Production Engineering

### CONV-002

**Check:** 4
**Finding:** 12 vitest failures in `apps/web/tests/unit/capture-vault.spec.ts` (4),
`apps/web/tests/unit/env-example-parses.spec.ts` (5) and
`apps/web/tests/unit/observability.spec.ts` (3).
**Evidence:** exactly the three files, and the same failure count, that
`EVC-014` already records — path separator `\` vs `/`, a CRLF worktree
defeating a `(.*)$` line regex, and POSIX file mode `0600`. One observed
assertion: `expected 't-t1\emp-emp1\…' to be 't-t1/emp-emp1/…'`.
**Impact:** none on this change.
**Recommendation:** none here. This is registered under `EVC-014`
(`PARTIALLY RESOLVED`) and is not this pilot's to close.
**Status:** `RESOLVED` — resolved *as a question about this change*. vitest
sets no DOM environment, excludes `tests/e2e/**`, and no vitest test imports
`TableSearch`, so this change provably cannot reach these tests. `EVC-014`
itself remains open on its own terms.
**Owner:** QA / Application Engineering

### CONV-003

**Check:** 4
**Finding:** a further 30 vitest failures — `password-reset` (11),
`assistant-guardrails` (11), `forgot-password-flow` (6), `p2-regressions` (1),
`guarded-prologue` (1) — caused by a **stale test database**.
**Evidence:** `The column platformUserId of relation PasswordResetToken does
not exist in the current database`. `.env.test` names `master_saas_test`,
a **different** database from the `leadflow` one this pilot used.
`npx prisma migrate status` and `npm run check:drift` both report `leadflow`
current and drift-free, so the schema and the migrations agree; it is
`master_saas_test` that has not been brought forward.
**Impact:** the unit suite cannot give a trustworthy regression signal until
the test database is current. A real regression in these areas would be
indistinguishable from this noise.

### Correction to this finding

**The original attribution was wrong for 12 of the 30.** Applying the missing
migration fixed **18** — `password-reset` (11), `forgot-password-flow` (6) and
`p2-regressions` (1), which no longer appear as failing files at all. The
remaining 12 were never database failures and are re-recorded as `CONV-011`.

The suite went from **1874 passed / 42 failed** to **1892 passed / 24 failed**.

### What was actually wrong

`master_saas_test` existed but was **one migration behind**:
`20260904080000_platform_scoped_password_reset`, the migration that adds
`PasswordResetToken.platformUserId`. It also carries two migrations no longer
present in the repository — `20260901120000_live_ai_call_assist` and
`20260901120500_live_assist_audit_events` — so its schema describes things the
repository no longer does.

`npx prisma migrate deploy` against `.env.test` applied the one missing
migration. **No migration was created, no schema was modified, no reset was
performed, and nothing outside the loopback container was touched.**

### Why this stays `OPEN`

The database on this workstation is now current. **The workflow that should
have kept it current does not exist**, so a fresh machine hits this again.

`apps/web/scripts/generate-secrets.mjs` states that `master_saas_test` is *"a
separate database that a developer creates with `npm run setup`"*. It is not:
`npm run setup` runs `prisma migrate deploy` against `.env`, which resolves to
`leadflow`, and `apps/web/infra/docker-compose.yml` creates only `POSTGRES_DB: leadflow`.
Nothing in the repository creates or migrates `master_saas_test`.

That is a documented-workflow claim contradicted by the code, and it is the
reason the drift went unnoticed.

**Remaining work:** a documented, deterministic preparation workflow. The exact
commands are proven and recorded in
`docs/evidence/phase-b4-pilot/11-test-database-bootstrap.md`; turning them into
a script touches `apps/web/package.json` and the `apps/web` setup guide, which is outside both
this specification and `SPEC-0002` and needs its own authorisation.

**Disposition `D-B4-04`, DevOps / Production Engineering, human, 2026-09-08:**
ACCEPT RISK for pilot #1, with a **mandatory follow-up**.

> A deterministic documented `master_saas_test` bootstrap and preparation
> workflow is **REQUIRED before pilot #2 begins**. This acceptance does not
> authorise pilot #2 to start without that work.

**Status:** `ACCEPTED_RISK`
**Owner:** DevOps / Production Engineering
**Required before pilot #2:** YES

### CONV-004

**Check:** 7
**Finding:** the implementation deviates from `AD-003` as literally worded.
**Evidence:** `AD-003` says the no-match message "moves inside the same status
region". Implemented literally, the message would relocate from below the table
to beside the search input, which `NFR-003` forbids. `AD-006` records the
resolution: one live region carrying both texts, rendered with the existing
`.lf-visually-hidden` class, with the two visible elements `aria-hidden`.
**Impact:** none unaddressed. Two approved statements conflicted; the conflict
was recorded and resolved in favour of the one that preserves user-visible
behaviour.
**Recommendation:** confirm `AD-006` at human code review.
**Status:** `RESOLVED`
**Owner:** —

### CONV-005

**Check:** 6
**Finding:** the live region updates on every keystroke and, at zero matches,
appends the full sentence "Nothing on this page matches. Clear the box to see
every row again."
**Evidence:** `TableSearch.tsx` line 73; typing three non-matching characters
produces three announcements each ending in that sentence.
**Impact:** this is **louder** than the previous behaviour, which never
announced the message at all. It is a direct consequence of fixing `ACC-004`,
not a defect against any requirement — but it is a real change in what a
screen-reader user hears, and no automated test can judge whether it is
welcome.
**Decision `D-B4-01`, Product Owner, human, 2026-09-08: APPROVE CURRENT
BEHAVIOUR.** The existing search behaviour is unchanged, the input is not
debounced, the polite live region may update as the search and result state
change, and the no-results state may be announced through that same region.

**For `SPEC-0003` pilot #1 this is the intended product behaviour**, and no
further product-code change is required.

**Bounded as stated by the approver:** this does *not* establish a universal
accessibility policy for every search component in YOUHAN ONE.
**Status:** `RESOLVED`
**Owner:** —

### CONV-006

**Check:** 4
**Finding:** `E2E-006` depended on `/platform/audit` holding at least eight
rows.
**Evidence:** `WorkspaceTable` renders no search box below
`SEARCHABLE_FROM = 8`. The case passed, but that row count came from
accumulated audit data rather than from anything the suite established.
**Impact:** the case could have failed on a freshly reset database, and would
have read as a component defect rather than a missing precondition.

**Remediated, not accepted**, under `CHG-001` / `TASK-006` / `ASES-0004` /
`VER-0002`. `E2E-006` now creates exactly `SEARCHABLE_FROM` departments
through the existing `POST /api/v1/workspaces/{slug}/hr/departments` endpoint,
asserts the table holds exactly that many, and only then looks for the search
box. It depends on no row it did not create.

Every other `WorkspaceTable` consumer was checked for a guaranteed count
first: `/platform/settings` renders five rows and six, `/platform/system-health`
renders four, and no page passes `searchable={true}`. Establishing the rows was
the only deterministic route that adds no dependency.

No dependency was added, no fixture file created, no test-only route
introduced, and `TableSearch.tsx` — a prohibited path for `TASK-006` — was not
touched, so the test could not be made to pass by changing the component.

**Residual:** `SEARCHABLE_FROM` is now stated in both `WorkspaceTable.tsx` and
the spec file. A change to the component threshold makes the test fail loudly
rather than pass silently, which is the safe direction, but the duplication is
real.
**Status:** `RESOLVED`
**Owner:** —

### CONV-007

**Check:** 15
**Finding:** the R2 human code review has not happened.
**Evidence:** `docs/sdd/RISK_TO_PROCESS_MATRIX.md` requires **1 reviewer** at
R2, and the row is titled *Human* code review. `REV-0001` exists but carries
`actorType: "ai"` and `satisfiesHumanGate: false`.
**Impact:** the work cannot be accepted as complete.
**Decision `D-B4-02`, Qualified Human Code Reviewer, human, 2026-09-08:
APPROVE.** Recorded as `REV-0002` with `actorType: "human"` and
`satisfiesHumanGate: true`. The reviewer found no issue in the reviewed
two-file diff requiring a block.

`REV-0001` remains the separate AI review, still carrying
`satisfiesHumanGate: false`. It was not rewritten or superseded.

**Bounded as stated by the reviewer:** a human code-review decision only — not
staging approval, not production approval, not final convergence acceptance,
and not acceptance of unrelated repository findings.
**Status:** `RESOLVED`
**Owner:** —

### CONV-008

**Check:** 15
**Finding:** the agent control plane's allowed-scope parser read `TASK-003`'s
prose scope line as two entries — `apps/web/tests/e2e/` and
`tablesearch-a11y` — the second of which is not a path. The prohibited list
similarly dropped "the Playwright and Vitest configuration files", which were
described in prose rather than as backticked paths.
**Evidence:** `execution/ASES-0002.json`, `allowedPaths` and `prohibitedPaths`.
**Impact:** none here — the real path matched the first entry and the
scope-check verdict was correct. But a prohibited path lost to prose
under-restricts a session, and the scope check then passes the change it
exists to catch.

**Remediated, not accepted**, under `SPEC-0002/CHG-007` and its `TASK-018`,
`ASES-0008`, `VER-0008` and `REV-0010`. `taskScope()` now classifies every
backticked token in a scope declaration as a path, a known identifier or
malformed, applies the `CL-002` grammar — exact paths and directory prefixes,
no globs — excludes non-path tokens rather than admitting them, and reports a
declaration that still contains prose. `SDD-V062`, an ERROR, blocks preflight
for the task being acted on.

Ten tests, `UT-046` to `UT-055`, cover multiple allowed paths, multiple
prohibited paths, prose containing path-like text, markdown list boundaries, a
prohibited path following explanatory prose, absent and wholly-prose
declarations, globs, partial-list truncation, and existing specification
compatibility. `UT-046` and `UT-047` **fail against the pre-fix parser** and
pass after it; the demonstration re-implements the old `collect()` verbatim
rather than reverting the file.

**The remediation found a second instance nobody had looked for:**
`SPEC-0001` `TASK-012` cited `CHG-001` in prose and the parser was returning it
as an *allowed path*. It no longer does.

**Residual, disclosed:** `ASES-0008` itself deviated from `TASK-018`'s declared
scope by editing that specification's `test-plan.md` and `change-record.md`,
which the task did not list. Recorded in `ASES-0008`, `VER-0008` and
`REV-0010`; the task was **not** widened retroactively. It exposes a real gap —
every task must update its own traceability artefacts and none can currently do
so within scope — carried to the retrospective.
**Status:** `RESOLVED`
**Owner:** —

### CONV-009

**Check:** 15
**Finding:** re-running `scope-check` on a **completed** session evaluates the
current working tree against that session's boundary, so a file changed later
by a different authorised session is reported as a violation of a session that
never touched it.
**Evidence:** at the end of this remediation pass,
`scope-check --session ASES-0003` and `--session ASES-0008` both return
`SDD-V058` on `apps/web/tests/e2e/tablesearch-a11y.spec.ts`. Neither session
touched that file; `ASES-0004` did, under `CHG-001`, and it is inside
`ASES-0004`'s allowed scope. The same thing happened earlier to `ASES-0001`
once `ASES-0002` created the file.

Each of these sessions **passed its scope check when it ran**. The failures
appear only on re-execution after later work.
**Impact:** the evidence is misleading rather than wrong. A reader re-running
the checks today sees `FAIL` on two sessions that were clean, and a genuine
violation in a completed session would look identical to this noise.
**Root cause:** a session record captured where it **started** —
`initialChangedPaths` and `initialDigests` — and nothing about where it
**ended**. `sessionDelta()` therefore read the live working tree and compared
each file's current digest against the start state, so "changed by this
session" and "changed after this session ended" were indistinguishable on any
later run.

**Remediated, not accepted**, under `SPEC-0002/CHG-008` and its `TASK-019`,
`ASES-0009`, `VER-0009` and `REV-0011`. A session now records
`finalChangedPaths` and `finalDigests` at close, via a new `close-session`
command, and evaluation branches on status:

| Session state | Judged against |
|---|---|
| `READY`, `IN_PROGRESS` | the live tree — **unchanged** |
| terminal, with end-state evidence | its own recorded end state |
| terminal, without it | nothing; `SDD-V063` reports the limitation |

The third row is what fixes the sessions that already exist. Rather than fall
back to the live tree and guess, evaluation attributes **nothing** and says
why. All three false failures — `ASES-0001`, `ASES-0003` and
`SPEC-0002/ASES-0008` — now return `PASS` with one honest warning.

Eight tests cover it, `UT-056` to `UT-063`. **`UT-058` is the guard against
over-correcting:** a session that genuinely crossed its own boundary still
fails, both while open and after closing. `UT-061` proves active enforcement is
untouched.

**Residual, disclosed:** every session closed before this change carries no
end-state evidence and can never be re-evaluated. `SDD-V063` reports that
permanently rather than hiding it.
**Status:** `RESOLVED`
**Owner:** —

*Discovered by the previous remediation pass, and not present in the first
convergence: it only becomes visible once more than one session has touched
the same area.*

### CONV-010

**Check:** 15
**Finding:** `SPEC-0002/ASES-0008` edited two files that `TASK-018` did not
declare in its allowed scope: that specification's `test-plan.md` and
`change-record.md`.

**This is a real scope deviation and is deliberately kept separate from
`CONV-009`.** `CONV-009` is a *temporal* defect — a completed session blamed
for a later session's edit, where no boundary was actually crossed. This is the
opposite: a boundary genuinely was crossed, by the session itself, while it was
open. Merging the two would let a real deviation hide inside a tooling bug.

**Evidence:** `TASK-018` declares four allowed paths — `tools/sdd/lib/agent.mjs`,
`tools/sdd/rules/rules.mjs`, `tools/sdd/tests/agent.test.mjs`,
`docs/sdd/VALIDATION_RULES.md`. Neither edited file is among them, and neither
is in the prohibited list either. File timestamps place both edits inside the
session window.

**Why the scope check did not catch it:** `git` collapses the untracked
`specs/` directory into a single entry, so attribution reported
`session 0 · unattributed 14` and could not see either file. The deviation was
found by direct inspection and recorded, not by the control plane.

**Impact:** the edits were themselves legitimate work — registering the ten
tests the task was told to write, and amending the change record before
implementation. Neither touched another specification, altered a requirement,
or widened `TASK-018`. The defect is that the task had no lawful way to record
the evidence of its own execution.

**What was deliberately not done:** `TASK-018`'s allowed scope was **not**
edited to cover the files after the fact. That would be retroactive widening,
which `docs/sdd/AGENT_STOP_PROTOCOL.md` forbids and which would have erased the
evidence that the gap exists.

**Preserved unchanged:** `TASK-018`'s original scope declaration,
`ASES-0008`'s recorded `allowedPaths` and `prohibitedPaths`, its `PARTIAL`
result, its original scope-check output, and the disclosure in `VER-0008` and
`REV-0010`.

**Remediation of the underlying model, not of this instance:** `CHG-008` /
`TASK-021` adds an enumerated meta-artefact allowance so that a task may record
its own execution evidence — `execution/*.json`, `traceability.md` and
`change-record.md` — within scope. **`test-plan.md` is deliberately excluded**
from that allowance, because a test plan states what *should* be verified
rather than recording what happened.

**So this deviation remains a deviation even after the model is fixed.** Half
of it becomes lawful; the `test-plan.md` half does not.

**Disposition `D-B4-05`, Product Owner, human, 2026-09-08: ACCEPT RISK** as a
historical, non-precedential scope risk. The approver acknowledged that the
original scope was not widened retroactively, that the deviation stays visible
in the historical evidence, that the later meta-artefact model does not rewrite
the historical event, and that the `test-plan.md` portion remains a genuine
deviation.

**Explicitly not authorised by this acceptance:** future task-scope violations,
retroactive scope expansion, arbitrary governance-file modification, or
bypassing current scope enforcement.
**Scope of acceptance:** the historical `ASES-0008` deviation only.
**Status:** `ACCEPTED_RISK`
**Owner:** Product Owner

### CONV-011

**Check:** 4
**Finding:** 12 vitest failures that `CONV-003` originally attributed to the
stale test database and which were **not** database failures:
`apps/web/tests/security/assistant-guardrails.spec.ts` (11) and
`apps/web/tests/security/guarded-prologue.spec.ts` (1).

**This finding exists because the earlier attribution was wrong.** It is
recorded as a correction rather than folded quietly into `CONV-003`.

**Evidence:** after `master_saas_test` was brought current, `password-reset`,
`forgot-password-flow` and `p2-regressions` stopped failing entirely while
these 12 did not move. Their assertions are static analysis of source text,
not database queries — for example *"searchLeads reads `prisma.account`
(module accounts) but neither requires it nor is listed in ALLOWED"*, and
*"is not re-implemented outside the two routes that must"*.

**Impact:** pre-existing drift between the AI assistant's declared tool
permissions and the models its tools actually read. It is a real finding about
the product, unrelated to this pilot and unrelated to the test environment.

**Why this pilot cannot close it:** `SPEC-0003` changed one presentational
component and one Playwright spec. vitest sets no DOM environment, excludes
`tests/e2e/**`, and no vitest test imports `TableSearch`, so this change
provably cannot reach these tests. Fixing assistant tool permissions is
product work in `src/lib/ai/` with its own risk classification — plausibly
`R4`, since it concerns what an AI tool may read.

**Classification, final — evidence only, no repairs attempted:**

| Check | Result |
|---|---|
| Import `TableSearch`? | **No** — zero references in either file |
| Reference `components/workspace`? | **No** — zero |
| Exercise the new spec file? | **No** — vitest excludes `tests/e2e/**` |
| What they read | the AI assistant tool and service modules under `apps/web/src/lib/ai/assistant/`, plus the events API route |
| Caused by `SPEC-0003`? | **No** — it changed two files, neither of which these suites touch |

**Demonstrably unrelated to `SPEC-0003`.**

**Disposition `D-B4-06`, QA / Release Engineering, human, 2026-09-08: ACCEPT
RISK** as an unrelated, pre-existing baseline limitation for `SPEC-0003`
pilot #1.

**Bounded as stated by the approver:** this does **not** classify those
failures as harmless globally. They remain separate repository quality debt
and **must not be represented as passing tests**. The recorded product-suite
result stays `1892 passed / 24 failed`.
**Scope of acceptance:** `SPEC-0003` convergence only.
**Status:** `ACCEPTED_RISK`
**Owner:** QA / Release Engineering

### CONV-012

**Check:** 4
**Finding:** the Playwright suite failed once, in `beforeAll`, on a run that
changed nothing. Re-running it immediately passed 7 of 7.

**This is recorded rather than discarded because the harness forbids
discarding it.** `apps/web/playwright.config.ts` sets `retries: 0` and says
why: *"A retry turns an intermittent failure into a green run with a note
nobody reads. If a spec here is flaky, that is a defect in the spec or in the
app, and it should stay visible."* Re-running by hand and keeping the pass
would be the same evasion the configuration exists to prevent.

**Evidence:** the failure was in the shared helper, not in this pilot's spec.

```
Locator: getByLabel('Authentication code')
Error: element(s) not found
  at helpers.ts:170   (loginPlatformOwner)
POST /api/v1/auth/login 404
```

At the time, the platform owner's row read `mfaEnabled: false` and
the operator authenticator backup file was absent. `loginPlatformOwner` calls
`ensureOwnerAuthenticator` to borrow the account's authenticator and expects the
MFA step to follow; with MFA not enabled, the code field never appears and the
wait times out. The accompanying `404` on the login route suggests the request
reached a route the dev server had not finished compiling.

**Impact on this pilot: none of the seven cases is implicated.** The failure
occurred before any of them ran, in a helper five other spec files share. Three
runs of this suite were made in total on unchanged code: 7 passed, 7 passed,
`beforeAll` failed, 7 passed.

**Why it is not attributed to this pass:** the helper, the component and the
spec were all unchanged between the passing and failing runs. The one thing
that did change in between was the `master_saas_test` migration under
`CONV-003` — a **different database** from the `leadflow` one Playwright uses,
so it is not a plausible cause, only an honest coincidence to note.

**Three-run characterisation, 2026-09-08, no code changed between runs:**

| Run | Result |
|---|---|
| 1 | **7 passed** (1.1m), exit 0 |
| 2 | **7 passed** (1.1m), exit 0 |
| 3 | **7 passed** (1.1m), exit 0 |

Five consecutive clean runs of this suite in total, against one observed
failure in `beforeAll`. The failure is characterised as an **intermittent
environment / harness condition in the shared login helper**, not a defect in
this pilot.

**Recommendation:** accept for pilot #1 and backlog the harness flake.
`ensureOwnerAuthenticator` appears able to return without leaving MFA enabled,
after which the caller waits 60 seconds for a field that will never appear.
That belongs to the E2E harness, not to this pilot, and is not remediated here
under the closure freeze.

**Disposition `D-B4-07`, QA / Release Engineering, human, 2026-09-08: ACCEPT
RISK** for pilot #1, on the three-run characterisation above.

**Condition attached by the approver:** the instability must remain visible in
the pilot retrospective, and **if it becomes reproducible or materially
worsens it must be investigated rather than continually accepted**.
**Status:** `ACCEPTED_RISK`
**Owner:** QA / Release Engineering

## Unrequested behaviour

**One item, and it is declared rather than smuggled.** The two visible
elements — the count `<span>` and the no-match `<p>` — gained
`aria-hidden="true"`. No requirement asked for that attribute in those words.

It is the necessary consequence of `AD-006`: without it the same text would be
presented twice to assistive technology, once from the live region and once
from the visible element. It is recorded in `AD-006`, in `TASK-001`'s
definition of done, and in `REV-0001`. Nothing else in the diff is
unrequested.

## Verification summary

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | **not run** — no route, layout or server code changed; `typecheck` covers the compile surface of a client component |
| Types | `npm run typecheck` | **PASS** — exit 0, whole app |
| Lint | `npm run lint` | **PASS** — exit 0; 0 errors, 122 warnings, all pre-existing `no-explicit-any` in services, none in either changed file |
| Format | `npx prettier --check` | **FAIL** — exit 1, CRLF only. `CONV-001` |
| Tests — required | `npx playwright test tests/e2e/tablesearch-a11y.spec.ts` | **PASS** — 7 passed, exit 0, chromium, `workers: 1`. Re-run after `CHG-001`: 7 passed in 1.2m |
| Tests — full unit suite | `npm test` | **1874 passed, 42 failed** across 8 files, exit 1. `CONV-002` (12) and `CONV-003` (30) |
| B3 suite after `CHG-007` | `node tools/sdd/tests/agent.test.mjs` | **PASS** — 58 of 58, grown from 48 by `UT-046`–`UT-055` |
| Schema drift | `npm run check:drift` | **PASS** — no difference detected |
| RLS | `npm run check:rls` | **not run** — no tenant table touched |
| Raw SQL scope | `npm run check:raw-sql` | **not run** — no raw SQL touched |
| Validator | `node tools/sdd/cli.mjs validate --all` | **PASS** — 0 errors, 0 warnings |
| B2 suite | `node tools/sdd/tests/validator.test.mjs` | **PASS** — 89 of 89 |
| B3 suite | `node tools/sdd/tests/agent.test.mjs` | **PASS** — 48 of 48 |

**The E2E environment was real.** Loopback Docker services (every port bound to
`127.0.0.1`), schema already current, demo seed applied to a database that had
zero users. No production or staging system was contacted; `DATABASE_URL`,
`REDIS_URL` and `S3_ENDPOINT` were confirmed to resolve to `127.0.0.1` by
hostname only, and no secret value was read, printed or referenced.

**No real screen reader was exercised, and none is claimed anywhere.** The
accessibility evidence is the browser accessibility tree as Playwright reads
it — role, accessible name, and live-region content.

## Verdict

**`PASS WITH ACCEPTED LIMITATIONS`** — recommended, **not accepted**.

**No finding is `OPEN`.** Seven are `RESOLVED`; five are `ACCEPTED_RISK`, each
with a named human owner and a recorded scope of acceptance.

| Status | Findings |
|---|---|
| `RESOLVED` | `CONV-002`, `CONV-004`, `CONV-005`, `CONV-006`, `CONV-007`, `CONV-008`, `CONV-009` |
| `ACCEPTED_RISK` | `CONV-001`, `CONV-003`, `CONV-010`, `CONV-011`, `CONV-012` |

Five of the seven `RESOLVED` findings were closed by **remediation** —
`CONV-006` and `CONV-008` in the second pass, `CONV-009` in the third — and two
by explicit human decision, `CONV-005` and `CONV-007`.

**Every accepted risk stays an accepted risk.** None was converted to
`RESOLVED`, and the underlying conditions all still exist: `prettier --check`
still exits 1, `master_saas_test` still has no documented bootstrap, the
`ASES-0008` `test-plan.md` deviation is still a deviation, and the product suite
still reports **1892 passed / 24 failed**. Nothing here represents a failing
test as passing.

### The dispositions, and what each is bounded to

| Finding | Decision | Role | Bounded to |
|---|---|---|---|
| `CONV-001` | `ACCEPT RISK` | DevOps / Production Engineering | `SPEC-0003` pilot #1 only |
| `CONV-003` | `ACCEPT RISK` | DevOps / Production Engineering | pilot #1, **with a required pre-pilot-#2 action** |
| `CONV-005` | `APPROVE CURRENT BEHAVIOUR` | Product Owner | `SPEC-0003` only — **not** a universal accessibility policy |
| `CONV-007` | `APPROVE` | Qualified Human Code Reviewer | code review only — not staging, production or convergence acceptance |
| `CONV-010` | `ACCEPT RISK` | Product Owner | the historical `ASES-0008` deviation only, non-precedential |
| `CONV-011` | `ACCEPT RISK` | QA / Release Engineering | `SPEC-0003` convergence only — **not** a global judgement |
| `CONV-012` | `ACCEPT RISK` | QA / Release Engineering | pilot #1, on the 3-of-3 clean characterisation |

Roles were checked against `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 9, which
assigns security residual risk to Application Security, functional or scope
limitations to the Product Owner, and operational limitations to DevOps /
Production Engineering. `CONV-011` and `CONV-012` are test-adequacy matters,
which the roles table places with QA / Release Engineering. `CONV-007` is the
`R2` human code review from `docs/sdd/RISK_TO_PROCESS_MATRIX.md`, not a gate 9
acceptance.

### Conditions carried forward

Two acceptances came with conditions, and both are binding:

1. **`CONV-003`** — a deterministic documented `master_saas_test` bootstrap is
   **REQUIRED before pilot #2 begins**. The acceptance explicitly does not
   authorise pilot #2 to start without it.
2. **`CONV-012`** — the harness instability must stay visible in the
   retrospective, and must be investigated rather than re-accepted if it
   becomes reproducible or materially worsens.

### Final convergence acceptance — recorded

**ACCEPTED, 2026-09-08, by a Qualified Human Reviewer.**

That role exists because of `EVC-017`, resolved the same day by the Solution
Architect. Gate 6 named the **author** as the R0–R2 acceptor, `AGENTS.md`
forbids an AI author from discharging any gate, and no document named a
substitute — so the gate had no eligible actor. The policy now states that for
an AI-authored R0–R2 specification the authority is exercised by a Qualified
Human Reviewer, and `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 6 and
`docs/sdd/RISK_TO_PROCESS_MATRIX.md` were corrected to say so.

**The reviewer accepted `PASS WITH ACCEPTED LIMITATIONS`** and acknowledged
that `CONV-001`, `CONV-003`, `CONV-010`, `CONV-011` and `CONV-012` remain
**accepted risks, not resolved findings**, with their owners, scopes,
rationales and follow-up requirements intact.

Recorded separately from the code review `REV-0002`, as the `EVC-017`
separation rule requires.

**What this acceptance does not authorise**, in the reviewer's own terms:
pilot #2, staging, production, release, deployment, migration, commit, push or
merge, `PC-01`, resolution of `EVC-016`, or any waiver of the required
before-pilot-#2 actions.

**Lifecycle:** `VERIFYING` to `CONVERGED`. Not advanced to
`READY_FOR_RELEASE` or `RELEASED` — no release authorisation exists.

An agent produced this report and recommended the verdict. A human accepted it.
