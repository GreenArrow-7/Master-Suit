# SPEC-0007 — Convergence

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Prepared by | AI agent, CONVERGENCE_REVIEWER role |
| Date | 2026-09-08; re-converged 2026-09-09 |
| Recommended verdict (superseded) | `PASS WITH ACCEPTED LIMITATIONS` |
| Accepted by | 2026-09-08 acceptance recorded below. **Re-convergence of 2026-09-09 is NOT accepted.** |

An agent prepared this report and recommended a verdict. The gate 6 acceptance
recorded at the end is a human's, transcribed by an agent.

> **Superseded, pending re-convergence.** `SPEC-0007` was reopened to
> `IMPLEMENTING` under `CHG-003` after this was accepted. This report remains
> the record of what was accepted on 2026-09-08 and is not rewritten; it does
> not describe the current state. Two of its statements have since been
> falsified — see the note on `CONV-001` and `CONV-003`.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Every requirement is implemented | **PASS** — FR-001 to FR-016, NFR-001 to NFR-004, SEC-001 to SEC-007, DATA-001 to DATA-005, OBS-001 to OBS-002. FR-002 and FR-011 as amended by `CHG-001` and `CHG-002` |
| 2 | Every acceptance criterion is verified | **PASS** — AC-001 to AC-015 map to passing cases in `traceability.md` |
| 3 | Every security requirement is verified by a security test | **PASS** — `SDD-V028` enforces it; SEC-001 to SEC-007 each carry an `ST-` case |
| 4 | All required tests pass; failures are explained | **PASS WITH LIMITATION** — 447 vitest + 5 Playwright pass. 24 broader-suite failures are pre-existing, reproduced identically at `f16ed67`. See `CONV-001` |
| 5 | No task left without a decision | **PASS** — all eight `COMPLETE`, each with a session, a verification record and a clean scope-check |
| 6 | No behaviour implemented that no requirement asked for | **PASS WITH LIMITATION** — two pre-existing seed defects were fixed inside this change. See `CONV-002` |
| 7 | No undocumented architecture change | **PASS** — `AD-001` to `AD-009` recorded; `AD-005` and `AD-007` restated by `CHG-002` |
| 8 | No undocumented dependency change | **PASS** — no dependency added. Playwright Chromium installed at the pinned version; `apps/web/package.json` and the lockfile are untouched |
| 9 | Migration matches the plan; no unplanned schema divergence | **PASS** — plan said none, `check:drift` reports *No difference detected*, `apps/web/prisma/schema.prisma` and `migrations/` untouched |
| 10 | Documentation updated where this change made it untrue | **PASS** — `docs/DEMO.md` carries the runbook, personas, exclusions and troubleshooting; `UT-011` asserts it |
| 11 | No new evidence conflict introduced, or it is registered | **PASS** — none introduced. `EVC-004` cited, unmodified. `CL-007` resolved rather than left as a conflict |
| 12 | Known limitations recorded with owners | **PASS** — `CONV-001` to `CONV-003` below |
| 13 | Residual risk recorded and accepted by the right role | **PASS** — `CONV-001` to `CONV-003` accepted at gate 6 by a human reviewer, 2026-09-08 |
| 14 | Rollback is written down and feasible | **PASS** — `plan.md` §9. Revert the commit; no schema to reverse; the database is disposable |
| 15 | The applicable items of `AGENTS.md` §8 hold | **PASS** — failures reported with their output, skipped steps named, nothing described as verified that was not run |

## Findings

### CONV-001

**Status:** `ACCEPTED_RISK` · **Severity:** low · **Owner:** Application Engineering

Twenty-four tests fail in the broader suite, across five files:
`assistant-guardrails`, `guarded-prologue`, `capture-vault`,
`env-example-parses`, `observability`.

A controlled comparison ran the identical command — same Node, same linked
`node_modules`, same `.env.test`, same database, same `--no-file-parallelism` —
against a temporary worktree at `f16ed67`, the commit before this work.

| | A · SPEC-0007 | B · baseline |
|---|---|---|
| Tests | 24 failed / 1939 passed / 1963 | 24 failed / 1891 passed / 1915 |
| Files | 5 failed / 157 | 5 failed / 152 |

The failure set is identical. SPEC-0007 adds exactly 5 files and 48 tests, and
all 48 pass. Classification: `INTRODUCED_BY_SPEC_0007` **0**,
`PRE_EXISTING_BASELINE` **24**, `FLAKY` **0**, `UNKNOWN` **0**. A further ~16–21
failures seen earlier were `ENVIRONMENTAL` and are resolved: they needed
`.env.test` with `RLS_DATABASE_URL` and a matching `APP_URL`.

None of the 24 is a security or tenant-isolation failure. Fixing them is outside
this specification's scope and belongs to their own workstreams —
`capture-vault` is `SPEC-0005`'s live subject.

> **Falsified on 2026-09-09.** The `FLAKY` count of **0** was wrong. A later
> full-suite run failed the fresh-versus-top-up case in
> `apps/web/tests/hr/demo-reset.spec.ts`, which
> then passed on re-run. Root cause: that suite spawned the seed with
> `{ ...process.env }`, so a subprocess gated entirely on environment variables
> inherited whatever earlier files had left in the shared environment. Fixed by
> giving the child a hermetic environment. Re-convergence must restate this
> count from a stable run.

### CONV-002

**Status:** `ACCEPTED_RISK` · **Severity:** low · **Owner:** the reviewer of `REV-0001`

Two pre-existing seed defects were repaired inside this change rather than split
into their own specifications:

1. **Suspended user, active profile.** The seed suspends a rep after writing
   employee profiles and updated only the `User`, so a fresh seed and a top-up
   disagreed on the active-employee count.
2. **Non-idempotent account book.** The spotlight handed the account manager
   eight *more* accounts per seed until she owned all twelve, emptying the Sales
   persona's accounts screen.

Both were exposed by this specification's own requirements — per-employee HR
coverage and `FR-013` idempotence — and neither could be left in place without
`FR-002`, `FR-008` or `FR-013` being unsatisfiable. Both touch `apps/web/prisma/seed/crm.ts` and
`apps/web/prisma/seed/index.ts` beyond the HR dataset, which is why this is recorded rather than
assumed. `REV-0001` saw both and approved.

### CONV-003

**Status:** `ACCEPTED_RISK` · **Severity:** low · **Owner:** DevOps / Production Engineering

The seed prints a generated password once to the operator's terminal. Correct
for a local developer run and never written to a file. `SPEC-0008` must ensure
that path never executes inside a CI or deployment log before any deployed
demonstration is considered ready.

> **Addressed on 2026-09-09**, ahead of `SPEC-0008`. The seed now withholds a
> generated password unless stdout is an interactive terminal and `CI` is
> unset, and never reprints a supplied one. Proven under both piped stdout and
> `CI=true`. This finding closes at re-convergence.

## Unrequested behaviour

None beyond `CONV-002`. Every other change traces to a requirement in
`traceability.md`.

## Process deviations

1. `TASK-002` to `TASK-005` executed under `ASES-0001`, the session opened for
   `TASK-001`, rather than one session each. Later work used bounded sessions.
2. `TASK-008`'s allowed scope was widened to hold `UT-011`, because `SDD-V057`
   correctly refuses a session for a task with no required test.
3. `ST-002` is narrower than the test plan first described, and `ST-010` asserts
   configuration rather than exercising the login throttle. Both reasoned in
   `VER-0002`.

Preserved rather than tidied away.

## Why the verdict is not plain `PASS`

Because three limitations are real and one of them — `CONV-001` — leaves 24
tests failing in this repository. They are demonstrably not this change's, and
the evidence is reproducible, but "everything is green" would be untrue and a
reader deserves to know before accepting.

## Acceptance

| Field | Value |
|---|---|
| Recommended verdict (superseded) | `PASS WITH ACCEPTED LIMITATIONS` |
| Decision | **ACCEPTED** |
| Accepting role | reviewer, gate 6 at R3 |
| Actor type | human |
| Date | 2026-09-08 |

**What was accepted.** The verdict `PASS WITH ACCEPTED LIMITATIONS`, and with
it `CONV-001` (24 pre-existing baseline failures, reproduced identically at
`f16ed67` and outside this specification's scope), `CONV-002` (two pre-existing
seed defects repaired inside this change) and `CONV-003` (the seed printing a
generated password to the operator's terminal, which `SPEC-0008` must keep out
of any CI or deployment log).

Decision supplied explicitly in session by the human requester and transcribed
by an agent. The agent did not make it and does not hold it.

`AGENTS.md`: *an agent produces the convergence report and a recommended
verdict; a human accepts it at R3 and above.* The report was prepared by an
agent; the acceptance above is the human's.


---

# Re-convergence — 2026-09-09

`SPEC-0007` was reopened under `CHG-003` (approved, Product Owner, 2026-09-09)
to designate a single client-facing login. This section is the convergence of
that amendment. Everything above is the 2026-09-08 record and stands as
written.

## What changed since acceptance

| Change | Evidence |
|---|---|
| `FR-017` added, `TASK-009` executed | `ASES-0005`, `VER-0005` |
| One client login proven | `E2E-006`: one session, Sales then HRMS, session cookie unchanged, platform console refused |
| `CONV-003` closed | seed withholds a generated password unless stdout is a TTY and `CI` is unset; proven under piped stdout and `CI=true` |
| `CONV-001` `FLAKY` restated | **2 found and fixed, 0 remaining** — see below |
| Documentation | `docs/DEMO.md` names one client login; the other two are marked internal security fixtures |

## Verification, 2026-09-09

| Check | Result |
|---|---|
| SPEC-0007 vitest suites | **447 passed / 28 files** |
| Playwright `demo-walkthrough` | **6 passed** (E2E-001 to E2E-006) |
| Full suite, run A (pristine fixture) | 24 failed / 1939 passed / 1963 — **no SPEC-0007 file** |
| Full suite, run B (no reseed, state left by A) | **identical** — no SPEC-0007 file |
| `tsc --noEmit` / `eslint` | 0 errors each |
| `check:drift` / `check:test-data` | clean |
| B2 / B3 | 93/93 · 70/70 |
| `validate --all` / SPEC-0007 | PASS · PASS, 0 warnings |
| scope-checks ×5 · `verify-session` | PASS |

## Findings

### CONV-004

**Status:** `CLOSED` 2026-09-09 — see "Closing the parallelism finding" in the
second re-verification below. Retained as first written; superseded, not rewritten.

*Status when raised:* `OPEN` · **Severity:** medium · **Owner:** DevOps / Production Engineering

**This specification's suites require `--no-file-parallelism`, and CI does not
pass it.**

`apps/web/tests/hr/demo-reset.spec.ts` mutates the shared demo workspace; the dataset
and persona suites read it. Vitest runs files in parallel by default, and
the CI workflow runs plain `npx vitest run --reporter=default`. In
CI these suites would race each other and fail intermittently.

Three flakiness sources were found and fixed inside this specification —
inherited `process.env`, an ambient database baseline, and a cold-server login
race. This fourth one cannot be fixed from inside it: the remedy is either a
flag on the CI test step or a vitest project that runs these files serially,
and `.github/workflows/*` is **R5** under `docs/RISK_CLASSIFICATION.md`. That
is outside an R3 specification's authority.

Not a defect in the tests. A defect in how they will be run.

### CONV-005

**Status:** `CLOSED` 2026-09-09 — see "Closing the release blocker" in the second
re-verification below. Retained as first written; superseded, not rewritten.

*Status when raised:* `OPEN` · **Severity:** high · **Release impact:** **BLOCKING for deployment**
**Owner:** Application Engineering

**GitHub CI will fail on this commit, and the deployment workflow refuses to
deploy a commit whose CI is not green.**

- the CI workflow "Test" step: `set -o pipefail; npx vitest run`. Vitest exits non-zero
  on any failure, so the `verify` job fails on the 24 pre-existing failures.
- the deploy workflow preflight reads the `verify` check-run conclusion for the exact
  SHA and refuses anything that is not `success`.

None of the 24 belongs to `SPEC-0007` — proven by a baseline run at `f16ed67`
with an identical failure set. But they block the pipeline all the same, and
fixing them is other specifications' work. **No deployment can proceed until
they are green**, and bypassing CI is not on the table.

## Recommended verdict

`PASS WITH ACCEPTED LIMITATIONS` for the specification's own scope, with
`CONV-004` and `CONV-005` **OPEN**.

`CONV-005` is release-blocking. `SPEC-0007` is technically complete and its
demonstration works locally; it cannot reach a server until CI is green.

## Acceptance

| Field | Value |
|---|---|
| Recommended verdict (superseded) | `PASS WITH ACCEPTED LIMITATIONS` |
| Decision | *not recorded* |
| Accepting role | reviewer, gate 6 at R3 |
| Date | — |

Two findings are `OPEN`. `SDD-V032` blocks `CONVERGED` while that is true, and
it is right to: an open release-blocking finding is not convergence.


---

# Re-verification, 2026-09-09 (second) — release-blocker reconciliation and the client login

## What changed since the last report

Two things, in this order.

**1. The 24 failures were reconciled, not re-fixed.** The previous report
carried `CONV-004` and `CONV-005` as open, both rooted in 24 test failures that
`SPEC-0007` did not introduce. Before writing any remediation, ownership was
checked against the rest of the corpus, and all 24 turned out to be already
fixed in committed work:

| Suite | Failures | Owner | Owner status | Fixing commit |
|---|---|---|---|---|
| `apps/web/tests/security/assistant-guardrails.spec.ts` | 11 | `SPEC-0004` | `CONVERGED`, R2 | `f1c4d4b` |
| `apps/web/tests/unit/env-example-parses.spec.ts` | 5 | `SPEC-0004` | `CONVERGED`, R2 | `f1c4d4b` |
| `apps/web/tests/unit/observability.spec.ts` | 3 | `SPEC-0004` | `CONVERGED`, R2 | `f1c4d4b` |
| `apps/web/tests/security/guarded-prologue.spec.ts` | 1 | `SPEC-0004` | `CONVERGED`, R2 | `f1c4d4b` |
| `apps/web/tests/unit/capture-vault.spec.ts` | 4 | `SPEC-0005` | `CONVERGED`, R4 | `1f46c78` |

`GENUINELY UNOWNED = 0`. Ownership is evidenced rather than inferred:
`SPEC-0004`'s own traceability matrix names all four suites with these exact
per-file failure counts. Nothing was reimplemented.

The branch was simply based on `f16ed67`, four commits behind. Integration
removed 369 hand-copied governance files that upstream now tracks — 364
byte-identical to upstream, 5 stale snapshots upstream strictly supersedes, and
0 carrying any content of their own — and then fast-forwarded to `a04c7e3`.

**2. `CHG-004` and the client login.** The authoritative client-facing login
became `demo@youhan.in`, which conflicts with `DATA-005`. `TASK-010` provisioned
it; `CHG-004` records the conflict and is **not approved**.

## Findings

### Closing the parallelism finding

**Status:** `CLOSED` · resolved by integration, not by a workflow change.

The suite passes at **default file parallelism**, which is exactly how
`.github/workflows/ci.yml` invokes it (`npx vitest run --reporter=default`).
Two consecutive full runs, 157 of 157 files, 0 unexpected failures. The
`--no-file-parallelism` requirement was an artefact of the pre-merge state.

This is the outcome the instruction preferred — proper test isolation over
globally serialising the suite — reached by fixing the branch's base rather
than by writing any isolation code. No R5 workflow change is needed, so the
finding does not carry into `SPEC-0008`.

### Closing the release blocker

**Status:** `CLOSED` · the blocking condition no longer exists.

CI's Test step fails on any failing test, and the deployment preflight refuses a
commit whose `verify` check-run is not `success`. Both are unchanged and both
are correct. What changed is the input: there are no failing tests.

Final run, CI-equivalent invocation: **157 files, 1987 passed, 2 skipped, 0
failed.**

The 2 skips are `apps/web/tests/unit/observability.spec.ts`'s POSIX file-mode assertions, gated on
`process.platform !== 'win32'`. CI runs Linux, so they execute there and the
skip-rejection gate does not fire. Windows-only, and not a suppression.

### CONV-006 — the client login is on a non-reserved domain

**Status:** `RESOLVED` · 2026-09-09 · **Change record:** `CHG-004`, **approved**
by the Product Owner.

The conflict is settled the way it was raised: `DATA-005` is amended to exempt
exactly one named address, and `demo@youhan.in` is that address. The exception
is explicitly not broadened to any other demonstration identity, and `UT-013`
now enforces that by asserting the seed writes exactly one non-reserved
address — so widening it fails a test rather than passing review.

Original finding, retained:

`demo@youhan.in` contradicts `DATA-005` as approved. `CHG-004` proposes a narrow
amendment and is **not approved**, so the requirement text stands and the
conflict stands with it.

The residual risk is small and stated plainly in `CHG-004`: the demo
environment selects the mock mail provider, the workspace holds no integration
connection, and `ST-008` and `ST-009` assert both — so nothing is dispatched.
The exposure is that a misdirected message would reach a mailbox the
organisation owns rather than one that discards it, which is the better of the
two failure modes `DATA-005` was written about, but is not what it says.

This is `OPEN` because an agent may not close it. It is not release-blocking for
anything that has been authorised, because nothing has been authorised to
deploy.

### CONV-007 — a top-up seed defect, found and fixed inside this task

**Status:** `CLOSED` · fixed in `TASK-010`, regression-verified.

The client persona was first inserted mid-list in the seed's persona table.
`employeeCode` is positional, and the upsert's `update` branch deliberately
preserves an existing code — so every persona after the insertion point kept its
old code while the newcomer took one already in use, and the next **top-up**
seed died on `P2002` against `EmployeeProfile.employeeNumber`.

Worth recording for how it was found rather than for what it was. The fresh path
(`--reset`) was green throughout and would have shipped it. It surfaced only
through `apps/web/scripts/prepare-test-db.mjs`, which seeds *without* `--reset` —
a path nothing in this specification's test plan exercised.

Fixed by appending the persona last, which renumbers nobody, and verified by
reset-then-top-up on both databases.

### CONV-008 — the test-database script hides the seed's error

**Status:** `RESOLVED` 2026-09-09 — fixed under `TASK-012`, verified by `UT-015`.

*Status when raised:* `OPEN` · **Severity:** low

`apps/web/scripts/prepare-test-db.mjs` captures the seed's output and discards
it, reporting only that the seed failed with exit 1. The reason is sound and
documented — the seed's banner can carry a credential. But it cost real time
here: the actual cause was a `P2002` with the model name in it, and none of that
reached the operator.

Raised, not fixed: the script is outside `TASK-010`'s scope, and the fix is a
judgement about credential handling rather than a mechanical change.

### CONV-009 — the application URL pins the end-to-end gate to another port

**Status:** `RESOLVED` 2026-09-09 — fixed under `TASK-012`; the end-to-end
harness now gates on the server it starts.

*Status when raised:* `OPEN` · **Severity:** informational

`APP_URL` is set to port 3005 in the local environment file, so
`apps/web/playwright.config.ts` gates on that port while its own dev command
binds 3000. The gate can never see the server it just started, and fails after
180 seconds with a message that names neither port.

Recorded rather than worked around. The run used the repository's own
`web-dev-3005` launch configuration and the committed configuration unmodified.

## Verification

| Check | Result |
|---|---|
| `npx vitest run --reporter=default` | **157 files, 1987 passed, 2 skipped, 0 failed** |
| `npx playwright test demo-walkthrough` | **6 passed**, `E2E-006` on `demo@youhan.in` |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 131 warnings, all pre-existing |
| `npm run check:drift` | no schema change |
| `npm run check:test-data` | clean |
| `npm run db:test:reset` then `npm run db:test:prepare` | both exit 0 — fresh and top-up |
| `node tools/sdd/cli.mjs validate --all` | PASS, 0 errors, 7 warnings, none here |
| `agent scope-check ASES-0006 --base a04c7e3` | PASS, 2 `SDD-V052` warnings |
| `agent verify-session ASES-0006` | PASS |

## Recommended verdict

`PASS WITH ACCEPTED LIMITATIONS`, with `CONV-006`, `CONV-008` and `CONV-009`
**OPEN** and `CONV-004`, `CONV-005`, `CONV-007` **CLOSED**.

The release blocker is gone. `CONV-006` is the one finding that matters to a
human: it is a requirement conflict created by an authoritative business
decision, and only the Product Owner can settle it.

## Acceptance

| Field | Value |
|---|---|
| Recommended verdict (superseded) | `PASS WITH ACCEPTED LIMITATIONS` |
| Decision | *not recorded* |
| Accepting role | reviewer, gate 6 at R3 |
| Date | — |

Not accepted. `CONV-006` is `OPEN` and `SDD-V032` blocks `CONVERGED` while it
is, which is correct: an unresolved conflict with an approved requirement is not
convergence. An agent recommends; a human accepts.


---

# Re-verification, 2026-09-09 (third) — CHG-004 approved, and what its guard test found

`CHG-004` was approved by the Product Owner. The approval carried an explicit
limit: the exception is one identity, and *"all other generated/demo identities
should continue following `DATA-005` and `CL-007` reserved-domain
requirements."* `TASK-011` applied the amendment and wrote `UT-013` to enforce
that limit. The test failed on its first run, against data that predates this
specification.

## Findings

### CONV-010 — `CL-007` was recorded as resolved, and most of the data was never moved

**Status:** `RESOLVED` · fixed in `TASK-011`, regression-guarded by `UT-013`.

`CL-007` asked whether the demonstration's addresses sat on reserved domains,
and its recorded resolution was Option A: move them. `review-packet.md` states
*"All demo addresses moved to reserved domains."* That was true of the ten
persona logins and of nothing else.

Measured against a freshly seeded workspace:

| Generated data | Domain shape | Reserved? |
|---|---|---|
| 25 contact addresses | `<accountname>.ae` | **No** |
| Account `mainEmail` | `info@<accountname>.ae` | **No** |
| Account `website` | `https://<accountname>.ae` | **No** |
| Second workspace admin | `admin@leadersfort.com` | **No** |

The account names are plausible UAE company names, so these are not merely
unreserved — several are or could become **real domains belonging to real
companies**, which is the exact mailbox `DATA-005` exists to keep a misdirected
message away from. The `website` values are the same mistake over a different
protocol: a demonstration that links a prospect out to a real company's site.

**Why it went unnoticed.** `CL-007`'s evidence table counted *persona login*
addresses — 31 on `example.com`, 10 not — and the fix was applied to exactly
what the table measured. The contact and account books were never in the count,
so moving the logins made the table read clean while most of the addresses in
the database had not moved. A clarification closed against a partial
measurement.

**Repair.** `apps/web/prisma/seed/crm.ts` now builds account and contact domains
through a single `demoDomain()` helper returning `<name>.example.com`, which
RFC 2606 reserves along with its parent. The second workspace administrator
moves to `admin@leadersfort.example.com`. Realism is preserved — the address
still reads as that company's own domain on screen — which was the stated cost
of Option A in the `CL-007` discussion and is now not paid.

**Guard.** `UT-013` asserts across **every** tenant that exactly one address is
off a reserved domain and that it is the client login, and separately that no
generated contact, lead, account address or account website is. Scoping it to
one tenant would have reproduced precisely the narrowness that let this through.

### CONV-011 — the reset covers only the primary demo tenant

**Status:** `RESOLVED` 2026-09-09 — fixed under `TASK-012`; the reset covers
every seeded workspace.

*Status when raised:* `OPEN` · **Severity:** low

The seed creates two workspaces — `manath-homes` and the HRMS-only
`leadersfort` — and `--reset` removes only the first. The second survives every
reset, so it cannot be rebuilt from a changed definition.

Found the hard way: moving the second workspace's administrator to a reserved
domain created a *second* administrator beside the surviving one, and the new
row collided on `EmployeeProfile.employeeNumber` — the same `P2002` shape as
`CONV-007`, from an unrelated cause. A one-off deletion of the stale tenant
cleared it, on a local disposable database.

Not fixed here. `FR-011` and `FR-012` are written about the demo tenant, so
extending the reset is a requirement question rather than a code tidy, and the
condition only bites when the second workspace's definition changes — which is
rare, and now guarded by `UT-013` failing loudly if the rename is half-applied.

## Verification

| Check | Result |
|---|---|
| `npx vitest run --reporter=default` | **157 files, 1988 passed, 2 skipped, 0 failed** |
| `UT-013` | **PASS** — one exempt address across all tenants |
| `npm run typecheck` | clean |
| `node tools/sdd/cli.mjs validate --all` | PASS, 0 errors, 7 warnings, none here |
| `agent scope-check ASES-0007 --base a04c7e3` | PASS, 2 `SDD-V052` warnings |

## Recommended verdict

`PASS WITH ACCEPTED LIMITATIONS`, with `CONV-008`, `CONV-009` and `CONV-011`
**OPEN** — all low or informational — and `CONV-004` to `CONV-007` and
`CONV-010` **CLOSED** or **RESOLVED**.

`CONV-006` is resolved by the `CHG-004` approval. `CONV-010` is the finding
worth a human's attention: not because it is unfixed, but because a
clarification was closed against a measurement narrower than the requirement it
claimed to satisfy, and that is a process failure rather than a coding one.

## Acceptance

| Field | Value |
|---|---|
| Recommended verdict (superseded) | `PASS WITH ACCEPTED LIMITATIONS` |
| Decision | *not recorded* |
| Accepting role | reviewer, gate 6 at R3 |
| Date | — |

Accepted. The decision was supplied explicitly in session by the human
requester acting as Qualified Human Reviewer and transcribed by an agent; the
agent did not make it and does not hold it. `SPEC-0007` is `CONVERGED`.

`CONVERGED` is not `RELEASED`. Nothing is committed, pushed, merged or
deployed by this acceptance.


---

# Re-verification, 2026-09-09 (fourth) — client-facing rebrand

`CHG-005` renamed the demonstration workspace from Manath Homes to
**YOUHAN ONE Demo**, including the slug, because the slug is in the path of
every page a client sees.

## Findings

### CONV-012 — a customer's name hardcoded in a page every tenant renders

**Status:** `RESOLVED` · fixed in `CHG-005`.

`apps/web/src/app/(workspace)/[workspaceSlug]/profile/role/page.tsx` contained
`ORGANIZATION: 'all of Manath Homes'` and
`'Run the Manath Homes workspace end to end'` as static copy. The page is
reached from Administration in every workspace, so **every tenant** read one
customer's company name as their own.

Not a demo-data problem. It was found only because the rebrand made the string
searchable, which is worth noting: the defect had been shipping to every tenant
and nothing tested for it.

Fixed **generically** — "every record in your organisation", "Run the workspace
end to end" — rather than by substituting `YOUHAN ONE Demo`, which would have
been the same defect with a new name.

### CONV-013 — the call-coaching script named one tenant for all of them

**Status:** `RESOLVED` · fixed in `CHG-005`.

`apps/web/src/lib/ai/liveCoach.ts`'s `demoScript()` scripted the agent as
"calling from Manath Homes" for every tenant. Fixed by taking the company as a
parameter; the caller now passes the workspace's own display name and the
default is neutral.

### CONV-014 — database assertions did not catch the client-visible leftovers

**Status:** `RESOLVED` · guard added.

`UT-014` was written to assert the rebrand, and it passed while three of the old
brand's occurrences were still on screen: two seeded **person names**
("Manath Demo", "Manath Admin") which are legitimate data values, and the role
page above, which lives in source rather than in the database.

The finding is about method, not about the strings. A database-shaped assertion
cannot see rendered copy, and the rebrand was only actually confirmed by opening
the pages in a browser through the live tunnel and reading them. `UT-014` now
covers the seeded values; the rendered surfaces are covered by the walkthrough.

Recorded because "the tests passed" was, for about ten minutes, a true statement
about a demonstration that still said Manath Homes on three screens.

## Verification

| Check | Result |
|---|---|
| `npx vitest run --reporter=default` | **157 files, 1989 passed, 2 skipped, 0 failed** |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 131 warnings, all pre-existing |
| reset → top-up → reset | all exit 0 |
| `node tools/sdd/cli.mjs validate --all` | PASS, 0 errors |
| Authenticated smoke through the live tunnel | 16/16 |

## Recommended verdict

`PASS WITH ACCEPTED LIMITATIONS`. `CONV-008`, `CONV-009` and `CONV-011` remain
`OPEN`, all low or informational. Acceptance is a human gate and is not
recorded.


---

# Convergence disposition, 2026-09-09 (final)

Every finding raised against this specification now carries a disposition.

| Status | Count | Findings |
|---|---|---|
| `RESOLVED` | 8 | `CONV-006`, `CONV-007`, `CONV-008`, `CONV-009`, `CONV-010`, `CONV-011`, `CONV-012`, `CONV-013`, `CONV-014` |
| `CLOSED` | 5 | `CONV-001`, `CONV-002`, `CONV-003`, `CONV-004`, `CONV-005` |
| `ACCEPTED_RISK` | 0 | — |
| `NOT_APPLICABLE` | 0 | — |
| **`OPEN`** | **0** | — |

*(`RESOLVED` counts nine entries against eight rows because `CONV-014` is a
method finding recorded alongside `CONV-012` and `CONV-013`.)*

## What is verified

| Check | Result |
|---|---|
| `npx vitest run` | **157 files, 1992 passed, 2 skipped, 0 failed** |
| `npx playwright test demo-walkthrough` through the live HTTPS tunnel | **6 passed** |
| Authenticated smoke through the tunnel | **16/16** |
| Client-visible branding, nine screens in a real browser | **0 old-brand occurrences** |
| reset → top-up → reset → top-up | all exit 0; no duplicate tenant, user, membership, employee number or email |
| `npm run typecheck` · `npm run lint` | clean · 0 errors |
| `validate --all` · `verify-session` · `scope-check` | PASS · PASS · PASS |
| B2 / B3 | 91/93 · 69/70 — the `EVC-020` Windows CRLF failures in `tools/`, untouched by this work |

## Recommended verdict

**`PASS`.**

Not `PASS WITH ACCEPTED LIMITATIONS`: there are no accepted limitations left.
The two earlier release blockers were closed by integration rather than
waived, and the three findings that stood open at the last report have been
fixed and tested rather than dispositioned away.

Two things a reviewer should weigh rather than take on trust:

1. **`B2`/`B3` are not green on this machine.** Three failures in
   `tools/sdd/tests/` are Windows line-ending defects in the tooling's own
   fixtures, registered as `EVC-020`. They are outside this specification, in a
   directory it has never modified, and they pass on CI's Linux. They are
   reported rather than netted out.
2. **`CONV-014` is a finding about method.** A database-shaped assertion
   reported the rebrand as complete while three occurrences were still on
   screen. What caught it was opening the pages in a browser. Convergence here
   rests on that browser evidence, not on the unit suite alone.

## Acceptance

| Field | Value |
|---|---|
| Recommended verdict | `PASS` |
| Decision | **ACCEPTED** |
| Accepting role | Qualified Human Reviewer, gate 6 at R3 |
| Date | 2026-09-09 |

Not accepted. An agent recommends; a human accepts.


---

# Post-acceptance finding, 2026-09-09

Recorded after gate 6 acceptance and after commit `c4c0631`. It is reported
rather than quietly repaired because it changes what the accepted evidence
means.

### CONV-015 — the reset fix destabilised a suite that shares its database

**Status:** `OPEN` · **Severity:** medium · **Owner:** the demo suites' owner ·
**Release impact:** **BLOCKING for push**

**What happens.** `apps/web/tests/security/demo-personas.spec.ts` fails intermittently in
a full run — roughly one run in three — with `401` where `200` is expected, and
occasionally a Prisma request error. It passes when run alone, and it passes
when run beside `apps/web/tests/hr/demo-reset.spec.ts` alone.

**Cause, and it is mine.** `CONV-011` widened the reset so it drops *every*
seeded workspace rather than only the primary one. That is correct product
behaviour and it is what was asked for. But `apps/web/tests/hr/demo-reset.spec.ts` exercises that
reset against the same database `apps/web/tests/security/demo-personas.spec.ts` reads, and files run in
parallel — so the second workspace is now briefly absent, and, worse, the
personas are deleted and recreated with **new ids**, invalidating any session
token minted earlier in the file.

Before `CONV-011` the secondary workspace was never dropped, so the window was
narrow enough never to be observed. Several consecutive full runs were green
before that change and are not reliably green after it.

**Two fixes attempted, both insufficient, both kept because they are
improvements:**

1. `beforeAll` now waits, bounded, for the fixture to reappear. It removes the
   "fixture is present" failure and nothing else — the fixture was there; its
   contents had changed.
2. Personas are re-resolved before every case rather than once per file. This
   removes the stale-token failures at case *start* and cannot help a rebuild
   that lands mid-case.

**Why it is not fixed here.** The remaining failure mode is genuine shared-state
coupling between two files, and closing it properly means isolation rather than
another guard: either the destructive suite gets its own database, or the two
files are placed in a Vitest project that does not run them in parallel with
each other. Both are design changes with CI consequences, and `CONV-004`'s
recorded preference — proper isolation over globally serialising the suite —
points at the project-scoped option rather than at `--no-file-parallelism`.

**What this means for the gate 6 acceptance.** The acceptance was recorded
against evidence that was green when it was taken, and the specification's own
behaviour is not in question: every requirement still holds, and the
demonstration works. What is now known is that the *suite* is not reliably
green, and CI would fail intermittently. The verdict is not withdrawn by an
agent, but a reviewer should know that the "0 failed" line supporting it does
not reproduce on every run.

**Recommendation:** do not push until this is closed. A branch whose CI fails
one run in three is worse than one that fails every time, because it teaches
people to re-run.
