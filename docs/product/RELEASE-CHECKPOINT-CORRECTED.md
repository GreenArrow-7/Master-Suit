# Corrected release checkpoint

Supersedes the gate totals and the browser-coverage section of
[`RELEASE-ASSESSMENT.md`](RELEASE-ASSESSMENT.md). Everything else in that
document stands; where the two disagree, this one is right.

Nothing merged, deployed, or run against production.

---

## 1. The gate reconciliation, and what I got wrong

### 1.1 The contradiction

I reported "16/16 gates pass" in the same summary as "5 E2E specs fail", with
E2E listed as gate 14. Both cannot be true. **The summary was wrong**, in two
compounding ways:

1. **The gate script did not run gates 13 and 14.** `rc-gates.sh` ran gates
   1–12, 15 and 16 — fourteen — and printed `GATE_FAIL=0`. I read that `0` as
   "everything passed" when it covered fourteen of sixteen.
2. **I treated the E2E failures as explained rather than as a gate result.**
   Having a reason for a failure is not the same as the gate passing. `npx
   playwright test` **exited 1**. The command reported the failure correctly;
   the summary did not.

The correct statement at the time was: **15 of 16 gates passed; gate 14
failed.** Not 16/16.

### 1.2 What the failure actually was

Also wrong. I wrote that the suite "cannot run its mail steps against a release
artifact as written". It can. `tests/e2e/helpers.ts` `lastMailTo()` has taken
`E2E_MAILPIT_URL` since before this work began — it is in the tree at the
session's starting commit and documented in `FOUNDATION-CLOSEOUT.md`. **I never
set the variable.** The five failures were my configuration error, and the
conclusion I drew from them — that the suite needed changing — was wrong.

Setting `E2E_MAILPIT_URL=http://127.0.0.1:8025` takes the same suite, against
the same artifact, with `NODE_ENV=production` unchanged and
`/api/v1/dev/outbox` still returning **404**, from 30 passed / 5 failed to
**43 passed / 0 failed**.

### 1.3 The gate table

Artifact under test: **`master-suite/web`, digest
`sha256:45d6a416e5b8cc14cd598b17c49edaafbdec4c496cd0146be15cb017cc0b75b5`**,
built from `c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2`, running
`node server.js` under `NODE_ENV=production` behind a TLS terminator.

Source revision for source-level gates: **`308a74cab78272dc31666ae737d638d2e83ee642`**.

| # | Gate | Exact command | Environment | Exit | Counts | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Schema drift | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Linux `node:24`, `master_suite_ci` | 0 | — | `validation-evidence/release-candidate/gates-linux.log` |
| 2 | Tenant isolation | `node scripts/check-rls.mjs` | as above | 0 | 184 tables forced + policied, 7 bootstrap exempt | as above |
| 3 | Raw SQL scope | `node scripts/check-raw-sql-scope.mjs` | as above | 0 | 35 raw statements, all in a tenant transaction | as above |
| 4 | Typecheck | `npx tsc --noEmit` | as above | 0 | — | as above |
| 5 | Lint | `npm run lint` | as above | 0 | 0 errors, 131 warnings | as above |
| 6 | Format check | `npm run format:check` | as above | 0 | — | as above |
| 7 | README schema counts | `node scripts/schema-stats.mjs --check` | as above | 0 | 204 models, 108 enums, 446 indexes | as above |
| 8 | Observability drift | `npm run check:observability` | as above | 0 | 12 alert rules, 9 queues watched | as above |
| 9 | Redis auth | `npm run check:redis-auth` | as above | 0 | 8 compose files require a password | as above |
| 10 | Face token gate | `python3 ../face/test_tokens.py` | as above | 0 | all checks passed | as above |
| 11 | Backup round trip | `scripts/test-backup-roundtrip.sh` | as above | 0 | 11 checks passed | `validation-evidence/release-candidate/backup-restore.log` |
| 12 | Unit suite | `npx vitest run` | as above | 0 | **2,137 passed / 0 failed / 0 skipped**, 160 files | `gates-linux.log` |
| 13 | Integration (server) | `npm run test:server` | **Windows**, loopback Postgres + Redis | 0 | **6 passed / 0 failed** | see §1.4 |
| 14 | **E2E (browser)** | `npx playwright test` | **Windows Chromium → the release image over TLS** | **0** | **47 passed / 0 failed / 0 skipped / 0 unexecuted** | `validation-evidence/release-candidate/e2e-gate14-47-passed.log` |
| 15 | Build | `npm run build` | Linux `node:24` | 0 | — | `gates-linux.log` |
| 16 | Audit | `npm audit --omit=dev --audit-level=high` | as above | 0 | 0 vulnerabilities | `gates-linux.log` |

**16 of 16 pass — and this time gate 14's own exit code is the evidence, not my
summary of it.**

> **One aborted run, recorded so the logs are not misread.** An earlier attempt
> at gates 12 and 15 on this revision reported *91 files failed, 1,252 skipped*.
> That was not a regression: I deleted `apps/web/.env.test.local` — the
> container's database configuration, read through a bind mount — while the run
> was in progress, so the suite lost its connection mid-flight. Re-run without
> interference: **2,137 passed, 0 failed, 0 skipped**, build PASS
> (`gates-unit-build-308a74c.log`). The aborted output is left in
> `gates-linux.log` rather than deleted; this note is why it is there.

### 1.4 Two gates that are not run on Linux, and why

Neither is a weakened check; both are environment facts, recorded rather than
worked around.

- **Gate 13 (Integration)** runs on Windows. Its isolation guard requires a
  **loopback** Redis because the suite deletes keys by pattern, and a container
  reaching the host Redis presents it as `host.docker.internal`. The guard
  refused, correctly. The escape (`E2E_ALLOW_UNMARKED_DATABASE=yes`) exists and
  was **not** used; a correctly-named database (`master_suite_ci`) was created
  instead.
- **Gate 14 (E2E)** drives Chromium from Windows against the Linux release
  image. The application under test is the Linux artifact; only the browser is
  on Windows.

---

## 2. Browser functionality coverage — closed

`NODE_ENV=production` throughout. `/api/v1/dev/outbox` returns **404**
throughout — verified immediately before the run. Mail is read from Mailpit's
own API, outside the application, over a listener configured with
`MP_SMTP_REQUIRE_STARTTLS=true`, so a message arriving is itself proof the
application negotiated STARTTLS and verified the certificate.

**47 passed, 0 failed, 0 skipped, exit 0.** The previously blocked journeys, all
through real login against the release image:

| Journey | Result |
| --- | --- |
| `hr-modules` — hire → department → **leave apply and approve** → **overtime request and decide** → **attendance record and register** → **payroll run to paid** → remaining people pages | **PASS** (45.8s) |
| `acceptance` — one workspace, two modules, one tenant, isolated from the next | **PASS** |
| `invitation` — one email sent, link sets a password, account signs in, link cannot be reused | **PASS** (3 tests) |
| `password-reset` — unknown address answered identically, real address receives a link, link sets a password and the old one stops working, link cannot be redeemed twice | **PASS** (4 tests) |
| `ui-states` — a refused page says it is a permission, not a fault | **PASS** |

So the HR journey is **executed browser evidence**, not service tests and not a
planned manual smoke test. The claim in the previous assessment that leave,
attendance and payroll had "no browser evidence this round" is withdrawn.

### 2.1 Mobile: display versus actions

The distinction was fair. Previous mobile evidence was **display** — a
screenshot with no sideways scroll. A control that renders at 390px and one that
cannot be tapped at 390px look identical in a screenshot.

Four new tests (`tests/e2e/follow-up-mobile.spec.ts`), on a **Pixel 7 device
profile** (touch input, mobile user agent, so a hover-only control fails):

| Test | What it proves |
| --- | --- |
| An agent reschedules and completes a follow-up at 390px | Both controls are reachable **and tappable**; the PATCH is awaited and asserted `< 300`; the result is re-read after a reload, so it is the persisted outcome |
| The lead list on a phone shows the follow-up state | The column reaches the phone at all — it was `hideMobile` before this package |
| No horizontal scrolling during the work | Checked while working the list, not only on arrival |
| Dashboard overdue count equals the rows its link returns | Screen rows and the API's answer for the same filter agree |

One honest note on that first test: it failed twice before passing, and neither
failure was the application. The first was my test driving the controls in the
wrong order; the second was the reload racing the PATCH, which surfaced as "the
row is still there" — the same symptom a refused write would produce. Awaiting
the response made it deterministic.

### 2.2 Authorized consistency: dates, filters, counts, sorting, drilldowns

| Dimension | Evidence | Status |
| --- | --- | --- |
| Dates | `scopedNextFollowUp` is the only source; no surface reads the stored column | **Verified** (66 unit tests) |
| Filters | `obligationWhere` — one predicate for the list, the count and the page query | **Verified** |
| Counts | Dashboard count and the leads list use the same predicate at the same reach | **Verified** (unit + the browser drilldown test) |
| Drilldown | Overdue list rows == API rows for the same filter, same session | **Verified** (browser) |
| Sorting | `byScopedFollowUp` — unscheduled last in both directions, ties on id | **Verified** (unit) — **but page-local**: it sorts the 50 rows on screen, as it did before this package. Recorded as a limitation, not as consistency. |

---

## 3. Booking and collection — the release decision

### 3.1 What the code does today

Every booking write is in one file, `src/app/api/v1/bookings/route.ts`
(four `tx.booking.*` calls). Confirmation:

- Reads with `tx.booking.findFirst` — **no row lock** — checks `status ===
  'DRAFT'`, then updates. Under `READ COMMITTED` two concurrent confirmations
  both observe DRAFT and both succeed.
- **Never calls `moveUnit`.** The unit is not reserved, moved or even read.
- **No database constraint.** The only unique index on `Booking` is
  `(tenantId, reference)`.

### 3.2 Exposure — narrower than I implied

`bookings` permissions are held by exactly three role keys, all at
ORGANIZATION scope: **`company_admin`, `org_admin`, `super_admin`**. No agent,
team-manager or HR role holds them, and **there is no booking UI at all**. The
automation engine cannot reach bookings either — `services/automation/records.ts`
restricts dynamic model access to LEAD, OPPORTUNITY, ACCOUNT and CONTACT.

So the double-sale path is reachable **only by a workspace administrator making
direct API calls**. That is a real risk and it is not an agent-facing one.

### 3.3 The sellable entity — corrected

**I had this wrong.** I described the link as
`Booking.listingId → Listing.unitInventoryId`. `Booking` carries
**`unitInventoryId` directly** (`prisma/schema.prisma`), and the create schema
accepts both it and `listingId`, each optional. The direct column is the one
that matters, and it is the one the repository's own backlog already names.

`UnitInventory.status` is the `UnitStatus` that `moveUnit` locks and transitions
(`AVAILABLE → HELD | BOOKED | BLOCKED`, `BOOKED → SOLD | AVAILABLE`, nothing
returns from `SOLD`).

**What the existing evidence says about intent** — checked rather than inferred
from nullability:

| Source | What it shows |
| --- | --- |
| `docs/product/IMPLEMENTATION-BACKLOG.md` | Already specifies the fix: *"Partial unique index on `Booking(unitInventoryId)` where `status = 'CONFIRMED' AND deletedAt IS NULL`"*, plus the files, the backfill risk and six acceptance tests. The invariant is keyed on the **unit**. |
| `docs/product/WORKFLOW-BLUEPRINT.md` §H | *"Confirmation must, in one transaction: verify the unit is reservable by this agent, move it, and write the booking."* Presupposes a unit. |
| `docs/product/CURRENT-CODE-MAP.md` | Records the defect as **reproduced**, not merely inspected: *"two concurrent confirms both returned 200 **[R]**"*, and *"**no** unique index on `unitInventoryId`"*. |
| Representative fixture (isolated database) | 1 booking: `unitInventoryId` set, `listingId` null, `CONFIRMED`. **0 confirmed bookings without a unit.** |

So every artefact that expresses intent assumes a unit, and the seeded data
matches. **None of them states whether a booking *without* a unit may be
confirmed** — off-plan, a block deal, a plot sale. Nullability alone does not
establish that it is supported, and one fixture row does not establish that it
is forbidden.

> ### The business question this checkpoint needs answered
>
> **Must every confirmed booking identify one specific inventory unit, or must
> confirmation also support bookings without a unit? If the latter, which
> booking types?**
>
> Option A's invariant differs by the answer: a unique index alone is enough if
> a unit is mandatory; if not, the index must be partial on
> `unitInventoryId IS NOT NULL` and the unitless path needs its own rule — and
> what stops *that* being double-sold is then an open question rather than a
> detail. I am not inventing either policy.

### 3.4 Option A — fix and verify

**Design.**

1. Lock the unit, not the booking. Two *different* draft bookings on one unit is
   the case a booking-level lock misses:
   `SELECT … FROM "UnitInventory" WHERE id = $1 AND "tenantId" = $2 FOR UPDATE`.
2. Re-read the booking **inside** that lock and re-check `status = 'DRAFT'`.
3. Move the unit in the **same transaction**. `moveUnit` currently opens its own
   `withTx`, so it needs a variant taking an existing `tx` — otherwise the unit
   move and the booking update commit independently, which is the present bug
   with extra steps.
4. **Database invariant**, the backstop for any path that forgets the lock —
   the same shape as `LeadTriageEntry_one_open_per_lead` already in the schema:

   ```sql
   CREATE UNIQUE INDEX "Booking_one_confirmed_per_unit"
     ON "Booking" ("tenantId", "unitInventoryId")
     WHERE "status" = 'CONFIRMED' AND "deletedAt" IS NULL
       AND "unitInventoryId" IS NOT NULL;
   ```

   Keyed on `unitInventoryId`, matching the backlog. The
   `unitInventoryId IS NOT NULL` clause is **only correct if unitless
   confirmation is permitted** — if it is not, drop that clause and make the
   column required at confirmation instead. That is the business question in
   §3.3, and the index cannot be written until it is answered.
5. **Lock order, added to the two already documented** (`User → Lead` for
   assignment; `Lead → obligations` for follow-ups): **`UnitInventory → Booking`**.

**Verification required** — none of it optional:

- Two concurrent confirmations of the **same** booking, separate connections →
  one succeeds, one refused with a reason.
- Two concurrent confirmations of **different** bookings on **one unit** → one
  succeeds, one refused. This is the case the partial index exists for.
- `moveUnit` throwing (unit already `SOLD`) → the booking is **not** confirmed;
  full rollback.
- Cancellation → unit returns to market, commissions clawed back first (the
  existing guard).
- Reservation expiry → `HELD` releases.
- Retry of a lost response → the original result, via `services/idempotency.ts`
  (already built, already used by the assignment endpoint).
- All four write paths in the route file.
- A browser check, once a UI exists — there is none today.

**Effort, from the actual work:** the lock and the in-transaction `moveUnit`
variant are perhaps half a day. The migration plus backfilling any existing
duplicate confirmations is a day, because **the index cannot be created while a
duplicate exists** and production may hold some — that has to be measured and
resolved first. Concurrency tests across separate connections, the rollback case
and the cancellation path are a day. **Two to three days, and it cannot be
compressed by testing less.** The 12 September handover is not met on this path.

### 3.5 Option B — limited release, with the workflow restricted

**Exact restriction.** Remove the `bookings` module permissions from the three
role keys that hold them, in every workspace:

```sql
-- Read first; apply only with owner approval.
SELECT r.key, p.action, rp.scope
  FROM "RolePermission" rp
  JOIN "Permission" p ON p.id = rp."permissionId"
  JOIN "Role" r       ON r.id = rp."roleId"
 WHERE p.module = 'bookings';
```

Entry points that must deny afterwards:

| Entry point | Gate |
| --- | --- |
| `GET /api/v1/bookings` | `bookings:VIEW` |
| `POST /api/v1/bookings` (create) | `bookings:CREATE` |
| `POST /api/v1/bookings` (`CONFIRM`, `COLLECT`, `CANCEL`) | `bookings:EDIT` |
| Any UI route | none exists |
| Automation | already unreachable — `records.ts` allows only LEAD/OPPORTUNITY/ACCOUNT/CONTACT |
| Platform/super admin | **`super_admin` holds it and must be included**; a restriction that exempts the most privileged role restricts nothing |

**Dependencies.** Commission and payout records reference `bookingId`. Removing
the *permission* does not remove existing bookings or commissions, so P&L,
commission and payout reads over historical bookings keep working — they are
governed by their own modules. Confirm before applying that no included workflow
calls a booking endpoint on a user's behalf.

**Denial-test matrix.** Every cell must be asserted; a restriction tested only
against an ordinary user proves nothing, because the roles that hold the grant
are the privileged ones.

| Entry point | Method | Guard | `company_admin` | `org_admin` | `super_admin` | Unprivileged (`leads:*` only) |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/bookings` | `GET` | `bookings:VIEW` | 403 | 403 | 403 | 403 |
| `/api/v1/bookings` | `POST` (create) | `bookings:CREATE` | 403 | 403 | 403 | 403 |
| `/api/v1/bookings` | `POST` `action: CONFIRM` | `bookings:EDIT` | 403 | 403 | 403 | 403 |
| `/api/v1/bookings` | `POST` `action: COLLECT` | `bookings:EDIT` | 403 | 403 | 403 | 403 |
| `/api/v1/bookings` | `POST` `action: CANCEL` | `bookings:EDIT` | 403 | 403 | 403 | 403 |

Plus three negative controls, so the restriction is proved to be *narrow*:

| Must still work after the restriction | Why |
| --- | --- |
| Commission reads over historical bookings | Governed by its own module; removing `bookings` must not break finance reporting |
| Payout maker-checker | Same |
| P&L by team | Reads bookings directly, not through the API |

**Not applied.** This is a business-scope exclusion and needs the owner's
decision. Effort once approved: roughly half a day, including the rollout SQL,
its rehearsal on an isolated database, and the matrix above.

**This is a business-scope exclusion and is not applied.** It needs the owner's
decision.

### 3.5b P&L — I over-claimed, and here is the correction

I reported **"P&L accuracy — FIXED"**. That is wrong. One of four things is
fixed; three defects are live in current code, and this is a financial report
the client will read.

| | State | Evidence |
| --- | --- | --- |
| Booking revenue grouped by the placement **frozen on the booking** | **Fixed** | `pl.ts` selects `booking.teamId / regionId / branchId`, written at confirmation. A transfer no longer moves booking revenue. |
| **Draft bookings counted as revenue** | **OPEN** | `pl.ts:76` filters `status: { not: 'CANCELLED' }`, which **includes `DRAFT`**. A draft is not a sale. |
| **Payroll cost includes unapproved runs** | **OPEN** | `pl.ts:227` selects payslips by period only — **no run-status filter**. A draft payroll run counts as cost. |
| **Payroll cost attributed to the employee's *current* team** | **OPEN** | `pl.ts:236` reads `salesUser.branchId / regionId / teams` live. A transfer restates historical payroll cost — exactly the failure the booking side was fixed to avoid. |

`docs/product/CURRENT-CODE-MAP.md` already listed all three as **open** with
these line references. I read the booking-side fix, saw the careful header
comment about frozen placement, and generalised from it. **Checking the other
half would have taken two minutes.**

**Consequence for the release:** margin and cost figures in the P&L are not
trustworthy for any workspace where bookings sit in `DRAFT` or employees have
changed team within the reporting period. The revenue-by-team split is sound;
the cost side and the draft-inclusion are not.

**This is not fixed here.** It is a financial-correctness change needing its own
verification, and it is out of scope for a release-candidate package. It is
added to the blocker list at §7.

### 3.6 Collections — what is and is not recorded

Stated exactly, because a timestamp is not money:

| The workflow records | The workflow cannot support |
| --- | --- |
| `collectedAt` — a single timestamp | **Any amount.** There is no field for one. |
| Set by `action: 'COLLECT'`, guarded to `CONFIRMED` bookings | **Partial receipts.** One timestamp cannot express two payments. |
| Refused if already collected | **Evidence** — no reference, no document, no payment method |
| Requires `bookings:EDIT` | **Separation of duties.** The same person who confirms can mark collected; the maker-checker pattern in `payouts.ts` is not applied. |
| | **Currency, date of receipt distinct from date of entry, or reversal** |

> **`collectedAt` must not be read as "the agency fee was received."** It records
> that somebody with `bookings:EDIT` pressed a button. Any report that treats it
> as evidence of an amount collected is overstating what the data holds.

No collection policy — partial receipts, currency, who may confirm receipt — is
invented here. Those are business decisions.

---

## 4. Candidate and evidence traceability

| | |
| --- | --- |
| Source revision (gates 1–12, 15, 16) | `308a74cab78272dc31666ae737d638d2e83ee642` |
| Image build source | `c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2` |
| Web image digest | `sha256:45d6a416e5b8cc14cd598b17c49edaafbdec4c496cd0146be15cb017cc0b75b5` |
| Worker image digest | `sha256:b8168ab848f2da481842a6cf094e010b5877199492562cf791372882110b5f95` (rebuilt at `c09cb43`; the earlier `a032de1` worker is superseded) |
| Running container reports | `BUILD_COMMIT=c09cb43e6058e6d9244e8ddb4e5afdad87bfd3b2` — read from inside the container |

### 4.1 `c09cb43` versus the source revision

`git diff --name-only c09cb43 308a74c` is:

```
apps/web/tests/e2e/follow-up-mobile.spec.ts     (new)
docs/product/HANDOVER-GUIDE.md
docs/product/RELEASE-ASSESSMENT.md
docs/product/RELEASE-CHECKPOINT-CORRECTED.md
validation-evidence/...                         (logs and screenshots)
```

**No application code, no Docker configuration, no dependency changed.** The one
non-documentation file is a Playwright spec.

**Why the image is still valid.** The Dockerfile's `production` stage copies
only `.next/standalone`, `.next/static`, `public` and `prisma` out of the build
stage. Tests are not among them and `next build` does not compile them, so a
spec file cannot change the runtime image. Gates 1–12, 15 and 16 were
nevertheless re-run on `308a74c` rather than assumed — §1.3 reports that run.

---

## 5. Operational readiness — what is actually evidenced

| Item | Status | Evidence, or what is missing |
| --- | --- | --- |
| Migration inventory since the deployed version | **Verified, with one assumption** | Four migrations vs `main`. Runbook §0/§3. **The deployed version itself is assumed** — the operator must confirm with `scripts/release.sh status`. |
| FollowUpTask→Lead orphan check | **Verified** | `rc-preflight.mjs` §3. 0 orphans on the validation database; the check is written for production. |
| Tenant-consistency check | **Verified as a check; not exercised on data** | The preflight reports cross-workspace references (0 here). The migration rehearsal reports **SKIP**, not PASS, because the seeded dataset has leads in only one workspace. |
| FK deletion behaviour | **Verified** | `ON DELETE CASCADE`, matching `Task.leadId`. Rehearsal proves a lead deletion removes its follow-ups. |
| Migration locking implications | **Verified by design and measured** | FK split `NOT VALID` + `VALIDATE` so validation does not block writes. Measured 39–171 ms and 9–40 ms on seeded data. **The two `CREATE INDEX` statements take a `SHARE` lock**; sized from the preflight's row counts. |
| Representative-data rehearsal | **Verified** | `rc-rehearse-migration.mjs`: 7 orphans **detached not deleted**, row count unchanged 88→88, constraint validated, cascade proven. |
| Backfill rehearsal | **Verified** | Planted 37 leads across five drift categories; measured 7 missing / 9 stale / 5 unexpected exactly as planted; dry run repaired 0; apply repaired 21; rerun considered 0. |
| **Backup restoration** | **Partially verified** | Transport and refusals: 11/11 checks (`backup-restore.log`). **A real database restore was rehearsed directly** — `pg_dump -Fc` of the validation database into a scratch database: exit 0, counts identical (Lead 506, Task 300, FollowUpTask 60, Tenant 2), **FK present and validated, 184 RLS-forced tables, 69 migrations** (`restore-rehearsal.txt`). **Not verified:** the product's own `backup.sh`/`restore-verify.sh` pipeline, which requires the production compose topology (`.env.production`) this environment does not have. **Pending operator execution.** |
| Application rollback compatibility | **Verified by inspection, not executed** | Three new tables, one column on a new table, two indexes, one FK — all additive. `Lead.nextFollowUpAt` is read and never written by the previous version. **No schema change prevents restarting the older application.** Not executed: no previous-version image was run against the new schema. |
| Database recovery | **Procedure written; restore mechanics verified as above** | Runbook §9.2, including that a pre-migration restore requires rolling the application back too, and that `FIELD_ENCRYPTION_KEY` lives outside the database. |
| Web/worker startup order | **Verified** | Both images run. Worker registers 9 queues and 5 schedulers including the report-only drift canary. |
| Provider checks | **Verified for SMTP and antivirus; asserted for WhatsApp** | Production refuses `mock`; SMTP proven end to end over STARTTLS. `WHATSAPP_PROVIDER=meta` is configured **without credentials**, so a real send fails loudly — it was never exercised. |
| Notification recovery | **Verified** | A `PENDING` outbox row — the state a crash leaves — delivered by the scheduled worker unprompted, exactly one notification. |
| Monitoring | **Partially verified** | The worker arms 5 schedulers including the report-only drift canary, and `check-observability` passes (12 alert rules, 9 consumed queues watched). **Not verified:** no Prometheus/Alertmanager instance was run, so no alert has ever fired end to end. **Pending operator execution.** |
| Outstanding production-operator checks | **Pending, by design** | Preflight §2 of the runbook: deployed version, table sizes, orphan and cross-workspace counts, automation rules writing `nextFollowUpAt`, saved views on the withdrawn filter. **None can be answered without production access.** |
| Individual account preparation | **Written, not executed** | Handover guide §1. **Not verified:** no client accounts have been created. |
| Support ownership, first-day monitoring | **Written, not executed** | Handover guide §6–§8. |

---

## 6. Package 1 — all six requirements

Not accepted on the strength of four highlighted fixes; mapped individually.

| # | Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Prevent automation and generic field-update paths overwriting derived `nextFollowUpAt` | `services/automation/writableFields.ts`; asserted in `updateRecordField`, the only generic write path. REST PATCH, CSV import and `createLead` already use strict allow-lists. | 8 tests: permitted fields still write, `nextFollowUpAt` refused with nothing written, identity/audit refused on all four object types | **Complete** |
| 2 | Remove disclosure of hidden tasks; "No action assigned to you" without consulting unauthorized obligations | `othersPending` deleted from every surface; `emptyFollowUpLabel` reads only the viewer's resolved reach | 5 tests incl. one asserting **no label can imply work exists elsewhere**; browser screenshots show the agent seeing "No action assigned to you" where the manager sees "06 Sept (overdue)" | **Complete** |
| 3 | Follow-up dates, states and actions visible **and usable** on mobile | `hideMobile` removed; four-state cell | **Browser, Pixel 7 profile:** reschedule and complete through the controls, persisted result re-read after reload; 0px overflow while working | **Complete** |
| 4 | Saved filters on the withdrawn field must not crash or silently broaden | Legacy "overdue" shape translated to the scoped predicate; anything else listed unfiltered **behind an explicit notice**; API returns a `withdrawn-field` error naming where to go | 5 tests | **Complete** |
| 5 | Dates, filters, counts, sorting, drilldowns use consistent authorized scopes | One `obligationWhere` predicate; one `scopedNextFollowUp`; `byScopedFollowUp` | Unit tests for each; **browser drilldown test** comparing list rows to the API for the same filter | **Complete**, with sorting **page-local** — a stated limitation, not consistency |
| 6 | Task/FollowUpTask union remains intact | Derivation reads both stores; nothing narrowed | Tests: a lead whose only obligation is a `FollowUpTask` still has a date; both stores counted separately in the drift report | **Complete** |

**Also required and delivered:** the 13-versus-14 reconciliation (§1) and all
repository gates plus browser regression (§1.3).

**Found and fixed while doing it,** outside the six: `public/` was never copied
into any release image, so `sw.js`, `offline.html` and both PWA icons 404'd in
production — the service worker could not register and "add to home screen" had
no icon.

---

## 7. Remaining blockers, ranked

| # | Blocker | Impact | Owner | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Booking double-sale** | Same unit sold twice; commercially irreversible. Reachable only by workspace administrators via API; no UI. | Client owner: option A or B (§3) | A: 2–3 days. B: ~half a day |
| 2 | **§3.3 unanswered** — may a booking be confirmed without a unit? | Blocks specifying option A's invariant | Client owner | Decision only |
| 3 | **Deployed version unconfirmed** | Migration inventory assumes at or after `main` | Production operator | Minutes |
| 4 | **Production preflight not run** | Table sizes, orphans, automation rules, saved views all unknown for production | Production operator | ~15 minutes |
| 5 | **Backup pipeline not rehearsed end to end** | Direct restore proven; the product's ship/restore scripts need the production topology | Production operator | ~1 hour |
| 6 | Task PATCH lacks `assertRecordVisible` | A user with `leads:EDIT` can patch any task in the workspace by id | Schedule post-handover | ~half a day |
| 7 | Collections record no amount (§3.6) | Any report treating `collectedAt` as money is wrong | Client owner | Deferred with booking |
| 8 | **P&L counts DRAFT bookings as revenue** (§3.5b) | Revenue overstated wherever drafts exist | Client owner + engineering | ~half a day incl. tests |
| 9 | **P&L includes unapproved payroll runs as cost** (§3.5b) | Margin wrong wherever a run is not yet approved | as above | included above |
| 10 | **P&L attributes payroll to the employee's current team** (§3.5b) | A transfer restates a closed period's cost | as above | ~half a day |

---

## 8. Recommendation

> **CONDITIONAL GO** for the Sales CRM and the HRMS workflows in
> `RELEASE-ASSESSMENT.md` §2.1–§2.2, **with booking confirmation and agency fee
> collection excluded and their permissions restricted per §3.5**, and **with the
> P&L report's cost side and draft-inclusion flagged to the client as
> untrustworthy until §3.5b is fixed.**
>
> **Neither exclusion is applied.** The owner has not selected an option and has
> not approved excluding anything; §3.5 is a prepared plan, not a change.

Conditional on:

1. The client owner choosing **option A or option B** (§3), in writing. **If
   option A is chosen, 12 September is not met** — say so now, not at 09:00
   tomorrow.
2. The operator running the runbook §2 preflight with no stop condition firing.
3. The operator confirming the currently deployed version.

**What changed since the previous assessment, in the release's favour:** gate 14
now passes with 47 tests; the HR journey is executed browser evidence rather
than a planned manual smoke test; mobile actions are tested, not just displayed;
and a real database restore has been rehearsed.

**What has not changed:** booking double-sale is still the blocker, and it is
still a business decision rather than a technical one.

This remains **not a GO**. Two of the three conditions depend on evidence nobody
has yet, and both require production access this work does not have.

### 8.1 Handover expectation

On **option B**, the 09:00 decision and 12:00 handover on 12 September remain
achievable: the remaining work is the operator's preflight and the permission
restriction with its denial test, roughly half a day of combined operator and
engineering time.

On **option A**, they are not. The honest revision is **15 September** for a
verified booking fix, or handover on 12 September with bookings excluded and the
fix following. I am not able to compress option A by testing it less.
