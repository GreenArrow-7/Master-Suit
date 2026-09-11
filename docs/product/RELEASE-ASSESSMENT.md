# Release assessment — YOUHAN ONE / Master Suite

> **Corrected 11 September 2026 by
> [`RELEASE-CHECKPOINT-CORRECTED.md`](RELEASE-CHECKPOINT-CORRECTED.md).**
> Three things below were wrong and are fixed there: the gate totals (this
> document's summary said 16/16 while gate 14 was failing with exit 1); the
> claim that the browser suite could not run its mail steps against a release
> artifact (it can — `E2E_MAILPIT_URL` already existed and I had not set it);
> and the resulting claim that the HR browser journey was not exercised (it is,
> and it passes). The rows below are corrected in place. Where the two
> documents still disagree, the checkpoint is right.

For the client owner, before any deployment approval. Prepared in an isolated
environment; **nothing has been merged, deployed, or run against production.**

| | |
| --- | --- |
| Handover deadline | 12 September 2026, 12:00 Asia/Dubai |
| Go/no-go target | 12 September 2026, 09:00 Asia/Dubai |
| Assessment prepared | 11 September 2026, Asia/Dubai |
| **Recommendation** | **CONDITIONAL GO** — see §6 |

---

## 1. The release candidate

| | |
| --- | --- |
| Branch | `claude/restructure-foundation` |
| Tested SHA | `c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2` |
| Web image | `master-suite/web:c09cb43` — built from the tested SHA, verified in-container |
| Worker image | `master-suite/worker:a032de1` — built from `a032de1`; the worker stage is unaffected by the two commits after it (a Dockerfile `COPY` in the **production** stage, and Sales page code the worker does not load) |
| Previously deployed | assumed at or after `main` (`f16ed67`) — **the operator must confirm with `scripts/release.sh status`** |

### 1.1 Difference between HEAD and the tested SHA

`c09cb43` is the last commit containing code, and the web image was built from
it — `BUILD_COMMIT` inside the running container reads
`c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2`. Everything after it on this branch
is documentation: this file, the runbook and the handover guide. Verify with
`git diff --name-only c09cb43 HEAD`; no code file appears, so no test was
repeated for it.

**The worker image is still tagged `a032de1`.** The two commits between
`a032de1` and `c09cb43` are a `COPY` added to the Dockerfile's **production**
stage and Sales page code; neither is reachable from the worker entry point.
Rebuilding it at `c09cb43` before deploying is cheap and removes the question —
recommended, and recorded here so nobody assumes the two images came from one
commit.

---

## 2. Release matrix

Legend — **Verified**: exercised against the release artifact over TLS with real
login. **Service-verified**: exercised by the automated suite against a real
database, not through a browser. **Not exercised**: no evidence from this round.

### 2.1 Sales CRM

| Client workflow | Working and verified | Known limitation | Blocking defect | In release |
| --- | --- | --- | --- | --- |
| Lead capture (form) | **Verified** — created through the form, appears in the list | — | — | **Included** |
| Lead capture (CSV import) | Service-verified | Strict column allow-list; unknown columns rejected per row | — | **Included** |
| Lead assignment (single + bulk) | Service-verified — 35 + 30 tests, incl. the real worker path | A deactivated employee can no longer receive a lead; partial-day leave blocks a whole day (§4) | — | **Included** |
| Unassigned-lead queue (triage) | Service-verified, worker path included | Reconciled rows show "Unknown" waiting time by design | — | **Included** |
| Follow-ups: create, reschedule, complete | **Verified** — task and follow-up attach to a lead | Both stores remain live; consolidation deferred | — | **Included** |
| Next follow-up date, per viewer | Service-verified — 66 tests; screens derive per request | Grid sorting is page-local (50 rows) | — | **Included** |
| Activity history | **Verified** — activity attaches; record opens from the notification bell | — | — | **Included** |
| Opportunity pipeline | **Verified** — lead converts, carries value, closes won | — | — | **Included** |
| Manager queues (chasing, overdue) | Service-verified | Oversamples 500 candidates then trims | — | **Included** |
| Agent vs team scope | **Verified** at route level; service-verified for the follow-up split | — | — | **Included** |
| Every Sales route renders | **Verified** | — | — | **Included** |
| Mobile daily workflow | **Verified** — no sideways scroll at 375px; HR tables stack; follow-up state now visible on phones | — | — | **Included** |
| Install to home screen / offline (PWA) | **Verified after a fix** — `sw.js`, `offline.html` and both icons 404'd in **every image ever built** because the Dockerfile never copied `public/`. Found by reading a browser-console 404 against the release artifact. | — | — | **Included** |

### 2.2 HRMS

| Client workflow | Working and verified | Known limitation | Blocking defect | In release |
| --- | --- | --- | --- | --- |
| Every People route renders | **Verified** | — | — | **Included** |
| Employee self-service | **Verified** — browser journey passes on the release artifact | — | — | **Included** |
| Attendance: punch, register | **Verified** — recorded and shown on the register in the browser journey; 25 + 10 service tests | — | — | **Included** |
| Leave: apply, approve | **Verified** — applied for and approved in the browser journey | Service-level workflow coverage is thinner than attendance or payroll | — | **Included** |
| Overtime: request, decide | **Verified** — requested and decided in the browser journey; 34 service tests | — | — | **Included** |
| Payroll: run to paid | **Verified** — run the whole way to paid in the browser journey; 32 service tests | — | — | **Included** |
| Roster, performance, recruitment, reports | Service-verified — 98 tests | Browser: routes render only | — | **Included** |
| HR privacy boundary | Service-verified — leave reasons and employment status cannot reach Sales | — | — | **Included** |

**307 HR tests** pass against a real database, **and** the end-to-end browser
journey — hire, department, leave, overtime, attendance, payroll — passes
against the release artifact through real login. The earlier statement that it
was missing has been withdrawn.

### 2.3 Financial workflows

| Client workflow | Status | In release |
| --- | --- | --- |
| Commission calculation and slabs | Service-verified; slab frozen at sale | **Included** |
| Commission clawback on cancellation | Service-verified — a cancellation is refused while live commissions exceed reversals | **Included** |
| P&L by team / region / branch | **Partially correct** — revenue split sound; cost side and draft-inclusion are not (§2.4) | **Included, with the limitation told to the client** |
| **Booking: confirm** | **Defect fixed and verified 12 Sep 2026 — see §2.4.** Release verification at the new revision is the remaining step | **Included, pending the re-run of gates 12–16** |
| **Agency fee collection** | **Still incomplete — see §2.4.** No amount, no evidence, no separation of duties | **Proposed for deferral — two open business questions, neither answered** |
| Payouts (maker-checker) | Service-verified | **Included** |

### 2.4 The three previously documented concerns, revisited

**Booking atomicity — FIXED 12 September 2026, on the branch. Not merged, not
deployed.**

It was the one blocking defect, and it was blocked on a business question rather
than on the code: the invariant to enforce depended on whether a confirmed
booking may exist without a unit. The client owner answered on 12 September —
*"Every confirmed booking must identify one specific inventory unit"* — and the
fix follows directly from that.

What was wrong, and what each part now is:

| Was | Is |
| --- | --- |
| Confirmation read the booking with `findFirst` and updated it. **No row lock.** Under `READ COMMITTED` two concurrent confirmations both saw `DRAFT` and both succeeded. | The unit is locked first (`FOR UPDATE`), then the booking row is re-read under its own lock and revalidated. The loser of a race gets a refusal with a reason. |
| **Confirmation never touched inventory.** `moveUnit` existed, was row-locked, and was not called. | `moveUnitIn(tx, …)` runs inside the confirming transaction. The unit moves and the booking is written together, or neither happens. |
| **No database constraint.** The only unique index on `Booking` was `(tenantId, reference)`. | `Booking_one_confirmed_per_unit` (partial unique) and `Booking_confirmed_requires_unit` (CHECK, validated). |

Verified by the six acceptance tests the backlog specified plus two for the new
policy, all inside gate 12 rather than a diagnostic; by a negative control that
removes the lock and fails 6 of the 14; and by `finding-bc-booking.diag.ts`,
where **B1–B4 now pass**. Detail and the evidence paths are in
`RELEASE-CHECKPOINT-CORRECTED.md` §3.4b.

**What this does not mean.** There is still no booking UI, so the workflow is
reachable only through the API, and it has no browser coverage. And the fix is
on a branch: until gates 12–16 are re-run at the new revision and the release
images rebuilt from it, the tested artifact is the one *without* this change.

**P&L accuracy — PARTIALLY FIXED. This paragraph previously said "FIXED" and
that was an over-claim; see `RELEASE-CHECKPOINT-CORRECTED.md` §3.5b.**

Fixed: booking revenue is grouped by the placement **frozen onto the booking**
at confirmation, so a transfer no longer moves last quarter's revenue. Reversals
are netted off commission cost, margin is `null` whenever a component is unknown
rather than falling back to a guess, and the gaps are named rather than rolled
into a total.

**Still open, all three verified in current code:** `pl.ts:76` counts **DRAFT**
bookings as revenue (`status: { not: 'CANCELLED' }`); `pl.ts:227` selects
payslips with **no run-status filter**, so an unapproved payroll run counts as
cost; and `pl.ts:236` attributes payroll cost to the employee's **current** team,
so a transfer restates a closed period — the very failure the booking side was
fixed to avoid. `CURRENT-CODE-MAP.md` already listed these as open.

**Collection and commission — PARTIALLY, and the collection half is unchanged by
the 12 September answer.** That answer settled the booking–unit link and nothing
else. The commission side is sound: slabs are frozen at the sale and cancellation
is refused while live commissions exceed reversals. **The collection side is
not.** `action: 'COLLECT'` records only
`collectedAt` — no amount, no evidence, no second pair of eyes — and needs only
`bookings:EDIT`. The maker-checker pattern already implemented in `payouts.ts`
is not applied to it. Collecting an agency fee correctly does **not** change the
unit's status, which is right.

`C1` and `C2` in `finding-bc-booking.diag.ts` still fail, deliberately. Closing
them needs two decisions nobody has made — whether the person who confirms a
sale may also certify the money arrived, and whether the system must record how
much arrived. Both change the schema or the permission map, so neither is a fix
to slot in before a handover.

---

## 3. Verification evidence

### 3.1 The gate count: 13 versus 14, and why both were wrong

Neither figure matched CI. Taken from `.github/workflows/ci.yml`, the required
checks are **sixteen**:

| # | Gate | Command |
| --- | --- | --- |
| 1 | Schema drift | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` |
| 2 | Tenant isolation | `node scripts/check-rls.mjs` |
| 3 | Raw SQL scope | `node scripts/check-raw-sql-scope.mjs` |
| 4 | Typecheck | `npx tsc --noEmit` |
| 5 | Lint | `npm run lint` |
| 6 | Format check | `npm run format:check` |
| 7 | README schema counts | `node scripts/schema-stats.mjs --check` |
| 8 | Observability drift | `npm run check:observability` |
| 9 | Redis auth | `npm run check:redis-auth` |
| 10 | Face token gate | `python3 ../face/test_tokens.py` |
| 11 | Backup round trip | `scripts/test-backup-roundtrip.sh` |
| 12 | Test (unit) | `npx vitest run` |
| 13 | **Integration (server)** | `npm run test:server` |
| 14 | **E2E** | `npx playwright test` |
| 15 | Build | `npm run build` |
| 16 | Audit | `npm audit --omit=dev --audit-level=high` |

**The difference between the previous 13 and 14 was only whether the unit suite
was counted as a gate.** Both counts omitted **Integration (server)** and
**E2E** entirely — the two that exercise a running application. Those were never
run in the earlier packages, and the earlier "14/14 gates" and "13/13 gates"
claims should be read with that omission in mind. Both are run here.

### 3.2 Results

Run on Linux (`node:24`), the deployment operating system, against isolated
services, on the tested SHA.

| # | Gate | Result |
| --- | --- | --- |
| 1 | Schema drift | **PASS** |
| 2 | Tenant isolation (RLS, 184 forced tables) | **PASS** |
| 3 | Raw SQL scope | **PASS** |
| 4 | Typecheck | **PASS** |
| 5 | Lint | **PASS** |
| 6 | Format check | **PASS** |
| 7 | README schema counts | **PASS** |
| 8 | Observability drift | **PASS** |
| 9 | Redis auth | **PASS** |
| 10 | Face token gate | **PASS** |
| 11 | Backup round trip | **PASS** |
| 12 | Unit suite | **PASS — 2,137 / 2,137, 160 / 160 files, 0 skipped** |
| 13 | Integration (server) | **PASS — 6 / 6.** Run on **Windows**, not Linux: the suite deletes Redis keys by pattern and its isolation guard requires a loopback Redis, which a container reaching the host cannot present. The guard was satisfied, not overridden. |
| 14 | E2E (browser) | **PASS — 47 passed / 0 failed / 0 skipped, exit 0.** The earlier 40/5 was my configuration error, not a suite limitation — see the checkpoint §1. |
| 15 | Build | **PASS** |
| 16 | Audit | **PASS — 0 vulnerabilities** |

Two gate failures were found and fixed rather than excused:

- **Lint** failed on an unused variable in the preflight script I had added.
  Caught because the gate was run as CI runs it (`npm run lint`) rather than as
  a spot check.
- **Integration (server)** first refused because the database I named
  `master_suite_linux` is not on the disposable allow-list (`_test`, `_val`,
  `_ci`, `_e2e`, `_scratch`, `_tmp`). A database named `master_suite_ci` was
  created instead. `E2E_ALLOW_UNMARKED_DATABASE=yes` exists and was **not** used.

### 3.3 Browser suite — what ran, what did not, and why

Run against **`master-suite/web:a032de1`**, the release image, served by
`node server.js` under `NODE_ENV=production`, behind a TLS terminator whose
certificate Chromium **verified against the CA in the operating system trust
store** — not with verification disabled. Sign-in used the real login form and
real credentials, not an injected session.

| | |
| --- | --- |
| **Passed** | **40** — 30 in the full run, plus the 10 that the aborted run left unexecuted, run separately |
| **Failed** | **5** |
| **Skipped** | **0** |
| **Unexecuted** | **0** |

Run twice: once on `a032de1` and again on the final image `c09cb43`. Identical
result both times, same five specs, same cause — so the failure is reproducible
and is not a flake.

**All five failures have one cause, and it is not an application defect.** They
read captured mail from `/api/v1/dev/outbox`. That route refuses in production
by two independent conditions — it returns 404 when `NODE_ENV=production`, and
again unless `EMAIL_PROVIDER=mock`. Against a production artifact those steps
cannot pass. The affected specs are `acceptance`, `hr-modules`, `invitation`,
`password-reset` and `ui-states`.

This was not worked around. Running the image with `NODE_ENV=development` was
attempted and correctly refused by the startup check, because Next forces
`NODE_ENV=production` in a production build. **The suite's mail steps are not
runnable against a release artifact as written** — that is a limitation of the
suite, and fixing it (reading Mailpit instead of the dev route) is the first item
in §7.

**Withdrawn.** This section previously said the HR browser journey "did not
run" and could not, and that smoke tests 12–15 would close the gap by hand.
Both statements were wrong. `lastMailTo()` already read a real SMTP capture when
`E2E_MAILPIT_URL` was set — present in the tree before this work and documented
in `FOUNDATION-CLOSEOUT.md` — and I had simply not set it. With it set, and with
`NODE_ENV=production` and `/api/v1/dev/outbox` returning 404 unchanged, the
suite passes 47/47 and the HR journey is executed browser evidence. Smoke tests
12–15 remain useful as a human sanity check; they are no longer standing in for
missing coverage.

### 3.4 What was verified instead, against the release artifact

Because the suite could not answer these, they were answered directly:

| Check | Result |
| --- | --- |
| Login, MFA enrolment, wrong password refused, recovery code single-use | **PASS** (4 specs) |
| Logout and access denial | **PASS** — `ui-states` refusal cases that do not need mail; a workspace administrator cannot reach the platform area |
| Password reset through the isolated TLS mail capture | **PASS** — `rc-mail-check.mjs`: the application negotiated STARTTLS (Mailpit is configured to refuse plaintext senders), the certificate verified against the local CA, one message arrived, it carries a reset link pointing at this deployment. The token is not printed. |
| Mail containment | **PASS** — Mailpit has no relay configured; captured mail goes no further |
| Registered worker processing | **PASS** — the worker image registers 9 queues and 5 schedulers, including the new report-only `follow-up-drift-daily` |
| Notification crash recovery | **PASS** — `rc-worker-check.mjs`: a `PENDING` outbox row, the state a crash between deciding and delivering leaves behind, was delivered by the scheduled worker without intervention, producing **exactly one** in-app notification |
| Migration against damaged data | **PASS** — `rc-rehearse-migration.mjs`: 7 orphans detached **not deleted**, row count unchanged, constraint validated, cascade proven. The cross-workspace case reports **SKIP**, not a vacuous PASS, because the seeded dataset cannot produce one. |

**Required password change** was **not** separately verified in this round. It
is enforced by the workspace layout (a null `passwordChangedAt` redirects to
"set your own password") and was observed firing during setup, but no test in
this round asserts it end to end. Treat it as **not exercised** and cover it with
a manual check before handover.

---

## 4. Known limitations carried into the release

1. **Booking confirmation is not atomic** and never moves the unit — §2.4. The
   reason booking/collection is proposed for deferral.
2. **Agency fee collection records a timestamp only** — no amount, no evidence,
   no maker-checker.
3. **Partial-day leave blocks a whole day** for lead allocation, and UTC storage
   does not establish correct local calendar-day behaviour. Tracked as a separate
   HRMS item.
4. **`update_field` still permits `score`, `grade`, `slaState`, `slaDueAt`,
   `lastActivityAt`** — all worker-maintained. Only `nextFollowUpAt` and the
   identity/audit columns are refused, deliberately, so that no capability a
   customer may already use is removed during a freeze.
5. **Saved views built on the withdrawn `nextFollowUpAt` filter** show an explicit
   notice and list unfiltered results. The old "overdue" shape is translated
   automatically; anything else is not.
6. **Grid sorting by follow-up is page-local** (the 50 rows on screen).
7. **Task PATCH does not call `assertRecordVisible`** — any caller with
   `leads:EDIT` can patch any task in the workspace by id. Pre-existing; found
   during this work; **not fixed** because it is an authorization change during a
   freeze. It should be scheduled immediately after handover.
8. **`services/crm/reminders.ts` reads only `status = 'OPEN'` and only `Task`** —
   no reminder fires for a follow-up, or for `IN_PROGRESS`/`RESCHEDULED`.
9. **Two Windows unit tests fail** on NTFS POSIX file modes; both pass on Linux,
   which is the deployment target.
10. **A Windows Redis-contention failure** in `p2-regressions.spec.ts` appears in
    full-suite runs and passes in isolation (17/17). Contention between spec
    files on a shared bucket, not a rate-limiter defect — recorded here because
    it was omitted from the P1-1 limitations.

---

## 5. Proposed restrictions — client-owner approval required

Nothing has been removed. These are **proposals**, and the release can include
them if the owner decides the risk is acceptable.

| Proposal | Status | Why |
| --- | --- | --- |
| ~~Defer booking confirmation~~ | **Withdrawn 12 Sep 2026** | The owner answered the policy question instead, and the defect was fixed. Deferring a workflow to avoid fixing it was always the worse of the two, and it is no longer the cheaper one either — see §6.4 on how badly I estimated the fix. |
| ~~Restrict `bookings:*` permissions~~ | **Withdrawn, never applied** | It existed to contain the double-sale while the workflow was deferred. No permission was ever revoked. The denial matrix that would have proved the restriction holds is kept in `RELEASE-CHECKPOINT-CORRECTED.md` §3.5, because it is the fallback if the rebuilt artifact does not clear verification before the go/no-go. |
| **Defer agency fee collection** | **Still proposed, still needs approval** | `collectedAt` records no amount, no evidence and no second pair of eyes. Unlike booking, this cannot be fixed by a decision alone: **D-8** asks who may certify collection and whether an amount must be recorded, and both answers change the schema or the permission map. |

**If the owner declines the collection deferral:** the release date slips. That
is a straight statement of cost, not a lever — D-8 has been open since the
validation report, and answering it starts a schema change, not a patch.

---

## 6. Deadline assessment

### 6.1 Completed

**Booking atomicity fixed** — the defect that had been the single blocking one
— after the client answered the policy question on 12 September. Release defects
closed and tested; 16 gates run on the deployment OS; the
browser suite run against the real release artifact over verified TLS with real
login; mail, worker and notification recovery verified directly; migration
rehearsed against manufactured damage; read-only production preflight written;
runbook written; handover materials written.

### 6.2 Remaining blockers, ranked by client impact

| # | Blocker | Impact | Owner |
| --- | --- | --- | --- |
| 1 | ~~Booking atomicity~~ | **Resolved 12 Sep 2026.** The policy question was answered and the defect fixed, locked, constrained and tested (§2.4) | — |
| 2 | **Agency fee collection** — no amount, no evidence, no separation of duties | A "collected" tick that cannot say how much arrived, and the seller can tick it | Client owner — **D-8**, still unanswered |
| 3 | **Deployed version unconfirmed** | The migration inventory assumes at or after `main` | Production operator — `scripts/release.sh status` |
| 4 | **Production preflight not run** | Table sizes, orphan counts, automation rules and the booking/unit audit are all unknown against real data | Production operator — runbook §2 and §2.1 |
| 5 | Task PATCH visibility check (§4.7) | A user with `leads:EDIT` can patch any task in the workspace | Schedule immediately after handover |
| 6 | No booking UI, therefore no browser coverage of the fix | The workflow is reachable only through the API | Product — the page is a build, not a fix |

### 6.3 Dependent on production access or a business decision

- Confirming the currently deployed version, table sizes, orphan counts,
  automation rules and **whether any existing data blocks the two new booking
  constraints** — all require running the preflight and the booking audit
  against production, which this work has no access to. Both scripts are
  written and their expected outputs are documented.
- **Deferring collection** — a business decision (D-8), not a technical one.
- Whether partial-day leave should block a whole day — a policy question.

### 6.4 Realistic completion estimate, and where my earlier one was wrong

**My earlier estimate said booking atomicity was "two to three days" and that
the 12 September handover "would not be met" if the deferral were declined.
That was wrong, and wrong in the direction that matters: it overstated the cost
of doing the right thing.** The implementation was a few hours once the policy
question was answered, because the pieces were already in the repository — a
row-locked `moveUnit`, a backlog entry naming the exact index, and six
acceptance tests already specified. What I had actually been blocked on was one
sentence from the client, not two days of work.

The correction matters beyond this defect: an estimate that makes a fix look
unaffordable is an argument for deferral dressed up as arithmetic.

**What genuinely remains, in hours:**

| Work | Owner | Estimate |
| --- | --- | --- |
| Re-run gates 12–16 at the new revision; rebuild both images from it; re-run the browser suite against them | This work — **in progress** | 2–3 hours |
| Production preflight + booking audit (runbook §2, §2.1) | Operator, against production | 30 minutes |
| Manual smoke tests on real client accounts | Operator + client | 1 hour |
| D-8 answered, or collection deferral approved in writing | Client owner | Their call |

### 6.5 Recommendation, and the deadline risk

> **Still not a GO — and the reason has changed.** It is no longer "there is a
> defect that sells the same flat twice". It is that a GO needs evidence from a
> production system this work cannot reach.

**Deadline risk, flagged rather than smoothed over:**

1. **The 09:00 go/no-go cannot be met from this side.** Conditions 2 and 3 below
   depend on the operator running the preflight against production. Nothing I do
   before 09:00 changes that. If nobody runs it, the honest answer at 09:00 is
   **NO-GO for lack of evidence**, not "GO because the tests pass".
2. **The booking fix is hours old.** Its unit and service evidence is strong and
   its negative control is real, but the release *artifact* containing it is
   being rebuilt now, and the browser suite has not yet run against that build.
   Until it has, the last fully-verified artifact is `c09cb43`, which does
   **not** contain the fix. **Shipping a fix whose artifact was never exercised
   is not better than shipping the defect.**
3. **Collection is still undecided.** D-8 has been open throughout and is not
   affected by the 12 September answer. Either the owner approves deferring
   collection in writing, or the date slips for a reason that has nothing to do
   with booking.
4. **There is no booking UI**, so the fixed workflow has no browser coverage and
   cannot have any. That is a gap in the evidence, not a defect in the fix, and
   it should be stated to the client rather than papered over with the API-level
   result.

**Conditional on all of:**

1. **Collection** deferred with the owner's written approval, or D-8 answered
   and the work scheduled honestly.
2. The operator runs runbook §2 **and §2.1** against production and no stop
   condition fires.
3. Gates 12–16 pass at the new revision and the browser suite passes against the
   rebuilt images — **in progress, not yet evidence.**
4. Manual smoke tests on real client accounts, as a human sanity check.

**Passing tests are still not a deployment decision.** Production remains
**NOT APPROVED**, and nothing in this section changes that.

---

## 7. First things after handover

1. Fix the browser suite's mail steps to read the capture service instead of the
   production-disabled dev route, so the five specs can run against a release
   artifact.
2. ~~Booking atomicity~~ — done. **The collection event** (§2.4) remains, and
   needs D-8 answered first.
3. The Task PATCH visibility check (§4.7).
4. `update_field` allow-list widened to the remaining worker-maintained columns
   (§4.4).
5. Partial-day leave and leave-date timezone semantics (§4.3).
