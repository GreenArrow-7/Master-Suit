# Release assessment — YOUHAN ONE / Master Suite

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
| Employee self-service | Service-verified (13 persona tests) | **Browser journey not exercised** (§3.3) | — | **Included**, with manual smoke test 12 |
| Attendance: punch, register | Service-verified — 25 + 10 tests | **Browser journey not exercised** | — | **Included**, with manual smoke test 15 |
| Leave: apply, approve | Service-verified for authority and scope | **Browser journey not exercised**; workflow coverage is thinner than attendance or payroll | — | **Included**, with manual smoke tests 13–14 |
| Overtime: request, decide | Service-verified — 34 tests | **Browser journey not exercised** | — | **Included** |
| Payroll: run to paid | Service-verified — 32 tests | **Browser journey not exercised** | — | **Included** |
| Roster, performance, recruitment, reports | Service-verified — 98 tests | Browser: routes render only | — | **Included** |
| HR privacy boundary | Service-verified — leave reasons and employment status cannot reach Sales | — | — | **Included** |

**307 HR tests** pass against a real database. What is missing is the
*browser-level* end-to-end HR journey — see §3.3 for exactly why and what it
costs.

### 2.3 Financial workflows

| Client workflow | Status | In release |
| --- | --- | --- |
| Commission calculation and slabs | Service-verified; slab frozen at sale | **Included** |
| Commission clawback on cancellation | Service-verified — a cancellation is refused while live commissions exceed reversals | **Included** |
| P&L by team / region / branch | Service-verified — see §2.4 | **Included** |
| **Booking: confirm** | **BLOCKING DEFECT — see §2.4** | **Proposed for deferral** |
| **Agency fee collection** | **Incomplete — see §2.4** | **Proposed for deferral** |
| Payouts (maker-checker) | Service-verified | **Included** |

### 2.4 The three previously documented concerns, revisited

**Booking atomicity — STILL OPEN. This is the one blocking defect in the
release.**

Confirmed by reading `src/app/api/v1/bookings/route.ts` today, not by repeating
the earlier note:

- Confirmation reads the booking with `findFirst` and then updates it. **There is
  no row lock.** Under `READ COMMITTED` two concurrent confirmations can both
  observe `status = 'DRAFT'` and both succeed.
- **The confirmation never touches inventory.** `moveUnit` — which exists and is
  row-locked — is not called. Confirming a booking does not reserve or move the
  unit.
- **There is no database constraint.** The only unique index on `Booking` is
  `(tenantId, reference)`. Nothing prevents two `CONFIRMED` bookings against one
  listing.

Consequence in plain terms: **the same unit can be sold twice**, and the system
will not notice. There is also no booking UI at all, so today this is reachable
only through the API.

**P&L accuracy — FIXED.** `services/leadership/pl.ts` groups by the placement
frozen onto the booking at confirmation rather than the agent's current team, so
a transfer no longer moves last quarter's revenue. Reversals are netted off
commission cost. **Margin is `null` whenever a component is unknown rather than
falling back to a guess**, and the gaps are named in the report instead of being
rolled into a total. Covered by a test that fails if the grouping regresses.

**Collection and commission — PARTIALLY.** The commission side is sound: slabs
are frozen at the sale and cancellation is refused while live commissions exceed
reversals. **The collection side is not.** `action: 'COLLECT'` records only
`collectedAt` — no amount, no evidence, no second pair of eyes — and needs only
`bookings:EDIT`. The maker-checker pattern already implemented in `payouts.ts`
is not applied to it. Collecting an agency fee correctly does **not** change the
unit's status, which is right.

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
| 12 | Unit suite | **PASS — 2,136 / 2,136, 160 / 160 files, 0 skipped** |
| 13 | Integration (server) | **PASS — 6 / 6.** Run on **Windows**, not Linux: the suite deletes Redis keys by pattern and its isolation guard requires a loopback Redis, which a container reaching the host cannot present. The guard was satisfied, not overridden. |
| 14 | E2E (browser) | **40 passed / 5 failed / 0 skipped** — §3.3 |
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
| **Passed** | **40** |
| **Failed** | **5** |
| **Skipped** | **0** |

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

**What this costs, stated plainly:** the browser-level end-to-end HR journey —
hire, leave, overtime, attendance, payroll — sits downstream of the blocked hire
step and therefore **did not run**. Those workflows have 307 passing service
tests behind them and their routes render, but no browser evidence from this
round. Smoke tests 12–15 in the runbook exist to close that gap by hand before
the deployment is declared good.

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

| Proposal | Why | If the owner declines |
| --- | --- | --- |
| **Defer booking confirmation and agency fee collection** | Two concurrent confirmations can both succeed and the same unit can be sold twice; collection records no amount or evidence. There is no booking UI, so no client user loses a screen they currently have. | The defect must be fixed before handover: a row lock plus `moveUnit` in one transaction and a partial unique index. That is not achievable before 12 September with the verification it would need. |
| **Restrict `bookings:*` permissions** so the API cannot be reached while deferred | The API is live even without a UI. | Leave it open and accept the double-sell risk. |

---

## 6. Deadline assessment

### 6.1 Completed

Release defects closed and tested; 16 gates run on the deployment OS; the
browser suite run against the real release artifact over verified TLS with real
login; mail, worker and notification recovery verified directly; migration
rehearsed against manufactured damage; read-only production preflight written;
runbook written; handover materials written.

### 6.2 Remaining blockers, ranked by client impact

| # | Blocker | Impact | Owner |
| --- | --- | --- | --- |
| 1 | **Booking atomicity** | Same unit sold twice; irreversible commercially | Client owner — approve deferral, or accept a slipped date |
| 2 | **Browser-level HR journey not exercised** | Leave/attendance/payroll have no browser evidence this round | Mitigated by runbook smoke tests 12–15, run by a real client user |
| 3 | **Required password change not exercised** | A new client account's first login is the least-tested path | One manual check before handover |
| 4 | **Deployed version unconfirmed** | The migration inventory assumes at or after `main` | Production operator — `scripts/release.sh status` |
| 5 | Task PATCH visibility check (§4.7) | A user with `leads:EDIT` can patch any task in the workspace | Schedule immediately after handover |

### 6.3 Dependent on production access or a business decision

- Confirming the currently deployed version, table sizes, orphan counts and
  automation rules — **all require running the preflight against production**,
  which this work has no access to. The script is written and the expected
  outputs are documented.
- Deferring booking/collection — **a business decision**, not a technical one.
- Whether partial-day leave should block a whole day — a policy question.

### 6.4 Realistic completion estimate

With booking/collection deferred, the remaining work is the manual smoke tests
and the operator's preflight: **about 3 hours of operator and client time**,
comfortably inside the window to 09:00 on 12 September.

**If the owner declines the deferral,** booking atomicity needs a locked
confirmation, an inventory move in the same transaction, a partial unique index,
concurrency tests and a browser check. That is **two to three days**, and the
12 September handover would not be met. **Flagging that now rather than at 09:00
tomorrow.**

### 6.5 Recommendation

> **CONDITIONAL GO**, for an explicitly limited scope: **the Sales CRM and the
> HRMS workflows listed in §2.1 and §2.2, with booking confirmation and agency
> fee collection deferred and their permissions restricted.**

Conditional on all four:

1. The client owner approves the §5 deferral in writing.
2. The operator runs §2 of the runbook against production and none of its stop
   conditions fires.
3. Runbook smoke tests 12–15 pass, performed by a real client employee and
   manager on their own accounts.
4. The required-password-change path is checked once by hand.

**This is not a GO.** Passing unit tests are not a deployment decision, and two
of the four conditions above depend on evidence nobody has yet — production data
and a human walking the HR journey. If condition 1 is declined, the
recommendation becomes **NO-GO for 12 September**.

---

## 7. First things after handover

1. Fix the browser suite's mail steps to read the capture service instead of the
   production-disabled dev route, so the five specs can run against a release
   artifact.
2. Booking atomicity and the collection event (§2.4), if deferred.
3. The Task PATCH visibility check (§4.7).
4. `update_field` allow-list widened to the remaining worker-maintained columns
   (§4.4).
5. Partial-day leave and leave-date timezone semantics (§4.3).
