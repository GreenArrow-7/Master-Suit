# Master Suite — baseline validation and evidence collection

**Scope.** Validation and evidence collection only. No application business logic
was changed, nothing was deployed, nothing was merged, no test was weakened or
removed. The only files added are diagnostic tests and this evidence directory,
all untracked.

**Date:** 2026-09-10 · **Commit:** `f16ed677516fb07f31832a5d725e13efb477c34d`

---

## 1. Environment and code version

| Item | Value |
| --- | --- |
| Repository | `https://github.com/GreenArrow-7/Master-Suit.git` |
| Branch | `claude/master-suite-baseline-validation-7c75ce` |
| Commit under test | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Reviewed commit | `f16ed677516fb07f31832a5d725e13efb477c34d` — **identical** |
| Working tree at start | clean (`git status --porcelain` empty) |
| Checkout | isolated git worktree; the developer's main checkout was never modified |
| Host | Windows 11 Pro 10.0.26200 |
| Node / npm | v24.18.0 / 11.16.0 (CI pins Node 24) |
| Docker | 29.5.3 |
| Install | `npm ci` from the committed `package-lock.json` — no package upgraded |

The code under test is byte-for-byte the commit the static review examined, so no
"what changed since" analysis is required.

### Working-tree state at the end

`git status` shows only untracked additions:

```
?? apps/web/tests/diagnostic/       (3 diagnostic specs)
?? apps/web/vitest.diagnostic.mts   (their runner config)
?? validation-evidence/             (this report, logs, screenshots)
```

Plus two untracked, gitignored env files (`apps/web/.env`, `apps/web/.env.test`)
generated for this run. **No tracked file was modified.**

### Running build identity

| Purpose | Command | Build output | Runtime `NODE_ENV` | Port |
| --- | --- | --- | --- | --- |
| CI Build gate | `npm run build` | `.next`, production | production (build only) | — |
| Browser / API walkthrough | `npm run start:local -- --build` | `.next-prod`, production | **development** | 3210 |

**Server identity was verified, not assumed.** A pre-existing `next start -p 3100`
process (PID 31676, started 2026-09-09 20:53, not ours) was already holding port
3100. The launcher refused to bind it (`EADDRINUSE`) rather than silently reusing
it. The validation server was moved to port 3210 and its identity proved by
credential probe:

| Request | Port 3210 (ours) | Port 3100 (stale, third-party) |
| --- | --- | --- |
| login as `v.agent@validation.invalid` (exists only in `master_suite_val`) | **200** | **401** |

The stale process was left running and untouched.

**Caveat on the production build.** `scripts/start-local-prod.mjs` builds as
production but serves with `NODE_ENV=development`, because `lib/startup-check.ts`
correctly refuses to boot a production process configured with mock providers. So
the walkthrough exercises the production *build* (compiled routes, prerendered
pages, production React) but **not** the production *boot-time guards*:
`assertProductionConfiguration`, the mock-provider refusal, the proxy-CIDR check
and the runtime RLS assertion did not run. Additionally `next start` warned
`"next start" does not work with "output: standalone" configuration` — the
deployed serving path (`node .next/standalone/server.js`) is **not** what was
exercised here.

### Production

**Production's deployed version is UNKNOWN.** No production endpoint, image
digest, or deployment record was supplied and none was discovered. Nothing in this
report describes production, and no statement here should be read as production
having been validated.

---

## 2. Environment isolation

**Result: isolated. No blockers. No planned operation was withheld.**

Every dependency is a local container published on loopback only
(`infra/docker-compose.yml` binds `127.0.0.1:` on every port; verified against the
running containers).

| Dependency | Developer's existing environment | This validation | Separated |
| --- | --- | --- | --- |
| PostgreSQL | `leadflow` (dev), `master_saas_test` (test) | **`master_suite_val`** (+ shadow), newly created | yes |
| Redis | db 0 (dev), db 15 (test) | **db 13** | yes |
| Object storage | MinIO bucket `leadflow-documents` | MinIO bucket **`master-suite-val`** | yes |
| Secrets | developer's `.env` | freshly generated 32-byte values in this worktree | yes |
| Records | developer's data | demo seed + `@validation.invalid` accounts | yes |

New databases were created rather than reusing the developer's. `@validation.invalid`
is a reserved TLD that cannot resolve, so even a misconfigured mailer could not
reach a real inbox.

### Outbound integrations — verified from configuration and the code that reads it

No credentials, connection strings or environment files are reproduced here.

| Channel | Setting | Can it reach a real recipient? |
| --- | --- | --- |
| Email | `EMAIL_PROVIDER=mock`, `SMTP_HOST` empty | No — `lib/mailer.ts:48` appends to an in-memory outbox and returns before any transport is constructed |
| WhatsApp | `WHATSAPP_PROVIDER=mock` | No |
| SMS / telephony | no vendor credentials; `IntegrationConnection` empty | No — `integrations/telephony/resolve.ts` requires a connected vendor row |
| Push (FCM / APNs) | all `FCM_*` / `APNS_*` empty | No — `push/send.ts:71,167` gate on all keys and return `{sent:0}` |
| Meta / social | `META_APP_ID`, `META_APP_SECRET` empty | No |
| AI (Gemini) | `GEMINI_API_KEY` empty | No |
| Antivirus | `ANTIVIRUS_PROVIDER=mock` | No external call |
| Scheduled jobs | worker process (`PROCESS_ROLE=worker`) **never started** | No repeatable job ran |
| Financial actions | commissions/payouts are rows; no payment rail integration exists | No real money movement is reachable |

### One isolation leak, found and disclosed

`tests/server/session-lifecycle.spec.ts:18` and `tests/server/unified-saas.spec.ts:20`
hardcode a fallback connection when `E2E_DATABASE_URL` is unset:

```
process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:<pw>@localhost:5432/leadflow?schema=public'
```

That is the **developer's primary database**, not a test one. During the first two
integration-gate runs these specs consequently created and then deleted fixture
rows in `leadflow`, and cleared `rl:*` rate-limit counters in the developer's Redis
db 0 (`tests/server/*.spec.ts:84,36`).

**Verified afterwards: zero residue.** `leadflow` contains 0 `PlatformUser` rows
matching the test patterns, 0 rows created in the last 3 hours, and 0 test tenants.
The specs' own `afterAll` cleanup ran. The Redis keys touched are ephemeral,
TTL-bearing counters. No customer-shaped data was read, written or exposed.

This is nevertheless a **real test-isolation defect** — see finding G2.

---

## 3. Baseline command results

### 3.1 `npm run verify` — first attempt failed for a host reason

| Command | Exit | Duration |
| --- | --- | --- |
| `node scripts/verify.mjs` | **2** | 2s |

It reported *"This script and ci.yml disagree about which gates exist"* and listed
all 24 gates as removed from `ci.yml`. All 24 are present. Root cause:

- `apps/web/scripts/verify.mjs:127` — `/^ {8}run:\s*(.*)$/`
- JavaScript's `.` excludes `\r`, and the regex has no `m` flag, so `$` must be
  end-of-input. On a CRLF checkout (Windows with `core.autocrlf=true`, the default
  here) **no `run:` line ever matches**; every step parses with `command: null` and
  `stepsOf` filters them all away.
- The parser's own guard cannot catch it: `steps.length !== declared` at line 141
  runs **before** the `command !== null` filter at line 150, so the count matches
  (26 = 26), the honest error never fires, and the misleading one does.

### 3.2 Baseline run 1 — CI gates run individually, CRLF checkout

Gates executed in `ci.yml` order, each run to completion rather than stopping at
the first failure. Evidence: `validation-evidence/baseline-run1/`

| Gate | Exit | Duration | Classification |
| --- | --- | --- | --- |
| Schema drift | 0 | 5s | pass |
| Tenant isolation (`check-rls.mjs`) | 0 | 1s | pass |
| Raw SQL scope | 0 | 0s | pass |
| Typecheck | 0 | 70s | pass |
| Lint | 0 | 183s | pass (0 errors, 131 warnings) |
| Format check | **1** | 21s | host artefact — 903 files |
| README schema counts | **1** | 1s | host artefact |
| Observability drift | **1** | 1s | host artefact |
| Redis auth | **1** | 2s | host artefact |
| Face token gate | 0 | 1s | pass |
| Backup round trip | 0 | 5s | pass |
| Test (vitest) | **1** | 188s | 25 failed / 1849 passed / 26 skipped |
| Integration (server) | **1** | 77s | missing prerequisite |
| Build | 0 | 136s | pass |
| Audit | **1** | 19s | **genuine defect** |

### 3.3 The host adjustment, and the proof it was justified

Line endings were normalised to LF (`git config core.autocrlf false`, then
re-checkout of tracked files). **Tracked content is unchanged** — `git status`
stayed clean apart from the untracked files this exercise added.

After that single change and no other edit, `scripts/verify.mjs` parsed all 24
gates correctly and every "host artefact" gate above passed:

| Gate | CRLF checkout | LF checkout |
| --- | --- | --- |
| Format check | fail — 903 files | **pass** |
| README schema counts | fail | **pass** |
| Observability drift | fail — "no prometheus service" | **pass** |
| Redis auth | fail — "no Compose file defines a redis service" | **pass** |
| `scripts/verify.mjs --list` | exit 2, 24 phantom gates | **exit 0, correct plan** |

That is the evidence these were line-ending artefacts, not defects in the
application or its configuration. CI runs on Linux and never sees them.

`.env.test` was additionally pointed at the same database as `.env`, reproducing
CI's single-database arrangement — see 3.6.

### 3.4 `npm run verify` — completed run (LF)

| Gate | Exit | Duration |
| --- | --- | --- |
| Schema drift | 0 | 5.5s |
| Tenant isolation | 0 | 0.5s |
| Raw SQL scope | 0 | 0.9s |
| Typecheck | 0 | 35.6s |
| Lint | 0 | 114.4s |
| Format check | 0 | 20.6s |
| README schema counts | 0 | 0.2s |
| Observability drift | 0 | 1.2s |
| Redis auth | 0 | 1.3s |
| Face token gate | 0 | 1.2s |
| Backup round trip | 0 | 4.3s |
| **Test** | **1** | 180.1s |
| Integration (server) | not reached | — |
| Build | not reached | — |
| Audit | not reached | — |
| **`npm run verify` overall** | **1** | **367s** |

`verify` stops at the first failing gate by design, so the last three were run
separately (3.6, 3.7).

### 3.5 Unit suite (`npx vitest run`) — final, LF

```
Test Files   3 failed | 149 passed (152)
     Tests   7 failed | 1908 passed | 0 skipped (1915)
  Duration   174.2s
```

**All 7 remaining failures are Windows host incompatibilities**, in three files
that assert POSIX-only behaviour:

| File | Count | Why it cannot pass on Windows |
| --- | --- | --- |
| `tests/unit/capture-vault.spec.ts` | 4 | asserts POSIX relative-path shape; Windows yields `\` separators |
| `tests/unit/observability.spec.ts` | 2 | asserts `0600` file modes, which Windows does not implement |
| `tests/security/guarded-prologue.spec.ts` | 1 | `EXEMPT` (line 31) holds forward-slash paths; `globSync` returns `integrations\meta\callback\route.ts`. The two files it flags are exactly the two in `EXEMPT` |

**No application defect is implicated by any of these.** On a Linux runner — which
is where CI runs them — the suite would be expected green.

Everything that failed in run 1 and is *not* in the table above was resolved by
the LF normalisation or by correcting my own harness configuration:

| Run-1 failure | Cause | Status on LF |
| --- | --- | --- |
| `assistant-guardrails` (11) | CRLF: `bodyOf()` at line 73 does `source.indexOf('\n  },\n')`, which returns `-1` on CRLF, so `slice(start,-1)` returned the rest of the file and every tool "read" every model | **passes** |
| `env-example-parses` (5) | CRLF env-file parsing | **passes** |
| `tests/tenant/rls.spec.ts` | my runner exported `RLS_DATABASE_URL` from `.env` while vitest read `.env.test`; the suite correctly refused to run rather than prove nothing | **passes (15 tests)** |
| `tests/tenant/pooling.spec.ts` (1) | same env mismatch | **passes (4 tests)** |
| `tests/sales/dialer.spec.ts` (26 skipped) | transient: `prisma.permission.upsert()` unique-constraint race on the global `Permission` table under vitest file parallelism | **passes** |

**Skipped tests: 0.** CI rejects any skipped test; this run satisfies that.

### 3.6 Integration (server) gate

Three attempts; the first two failed for configuration reasons that are themselves
findings.

| Attempt | Config | Result |
| --- | --- | --- |
| 1 (run 1) | as CI | 6 failed — fixtures written to a different database than the server read |
| 2 | `E2E_DATABASE_URL` = app-role URL | 1 failed, 5 skipped — `Role.findFirst` returned null: the app role is `NOBYPASSRLS`, so RLS matched nothing |
| 3 | `E2E_DATABASE_URL` = owner-role URL, `E2E_REDIS_URL` set | **exit 0 — 6 passed, 37s** |

These specs require a **BYPASSRLS** connection to the same database the server
uses. On CI that is automatic (one database, one role). On any other layout it
must be supplied explicitly, and `scripts/verify.mjs` lists `Integration (server)`
as `{ run: true }` with no caveat — so `npm run verify` on a standard developer
setup fails this gate for environmental reasons. See finding G2.

### 3.7 Build and dependency audit

| Gate | Exit | Duration | Note |
| --- | --- | --- | --- |
| Build (`npm run build` → `.next`) | 0 | 136s | pass |
| Production build (`--build` → `.next-prod`) | 0 | ~150s | pass; 86 static pages generated |
| **Audit (`npm audit --omit=dev --audit-level=high`)** | **1** | 7s | **genuine defect, platform-independent** |

```
3 vulnerabilities (2 high, 1 critical)
```

| Package | Severity | Advisory |
| --- | --- | --- |
| `next` 16.2.12 | **critical** | GHSA-p293-qw3h-jr36 — unauthenticated RCE on **Windows-hosted** servers; GHSA-2xp9-vwfh-vxw4 — unauthenticated RCE in the Image Optimization API via AVIF |
| `nodemailer` ≤9.1.0 | high | `resolveContent()` file/URL-access bypass; IDN/punycode allow-list bypass; O(n²) address-parsing DoS; RFC 5322 comment mis-parsing |
| `sharp` <0.35.4 | high | GHSA-rgj7-g3m4-5g8c (libheif) |

`next@16.3.4` resolves the critical pair but sits outside the declared range.

### 3.8 E2E (`npm run test:e2e`) against the production build

Run separately from `npm run verify`, with `APP_URL=http://127.0.0.1:3210` so
Playwright attached to the verified production-build server instead of spawning a
dev server of its own.

| Attempt | Configuration | Result |
| --- | --- | --- |
| 1 | `.env` `APP_URL` still `http://localhost:3000` | 32 passed, **5 failed** — every failure `ERR_CONNECTION_REFUSED at http://localhost:3000/...`. The application correctly builds invitation and password-reset links from `env.APP_URL`; my server was on 3210. **My configuration error, not a product defect.** |
| 2 | `APP_URL=http://127.0.0.1:3210`, server restarted, identity re-verified | **42 passed, 1 failed**, 287s |

The five attempt-1 failures (invitation acceptance, password reset, acceptance,
hr-modules, ui-states) all passed in attempt 2, confirming the diagnosis.

**The single remaining failure is a genuine defect — see finding G7.**

```
1) modules.spec.ts:55 › Each module opens and does its job
   › a fresh workspace can reach and use every sales module
   › M11 — somebody posts to the feed and reacts to it

   expect(locator).toHaveAttribute('aria-pressed', 'true') failed
   Locator: getByRole('button', { name: 'celebrate' }).first()
   Expected: "true"   Received: "false"
   43 × locator resolved to <button aria-pressed="false" aria-label="celebrate">🎉 0</button>
```

Artifacts (screenshot, trace, error context) in
`validation-evidence/e2e-artifacts/`.

### 3.9 Reruns, and why each was justified

The initial baseline (run 1) is preserved verbatim in
`validation-evidence/baseline-run1/`. Every rerun is accounted for:

1. **LF normalisation** — a host-configuration change, made only after run 1 was
   captured, to separate line-ending artefacts from defects. Proof in 3.3.
2. **Lint rerun** — run 3's Lint failed on *one error in my own diagnostic file*
   (`'ruleId' is assigned a value but never used`). I removed the variable. The
   repository's own code produced 0 errors in every run.
3. **Format check rerun** — run 3's Format check failed on *my own two diagnostic
   files*. I ran Prettier on them only. On the repository's tracked files the gate
   had already passed.
4. **Integration reruns** — configuration corrections described in 3.6.

No assertion was weakened, no security control disabled, no test removed or
skipped, and nothing was retried in the hope of a different result.

---

## 4. Findings

| # | Finding | Status | Business impact |
| --- | --- | --- | --- |
| **A** | P&L counts draft bookings, mis-costs payroll, restates history | **CONFIRMED** (3 of 4; 4th partial) | Leadership margin is wrong in three independent directions |
| **B** | Booking confirmation never touches unit availability | **CONFIRMED** | The same unit can be sold twice |
| **C** | Collection needs no finance authority and records no amount | **CONFIRMED** | Full commission can be unlocked on unverified receipt |
| **D** | Self-scoped user can export the whole workspace's payroll | **CONFIRMED** | Every employee can read every colleague's salary |
| **E** | Automatic lead assignment enforces no eligibility at all | **CONFIRMED** | Leads go to suspended, absent and over-quota agents |
| **F** | No booking page exists | **CONFIRMED** | Booking is unreachable outside the API |

Plus five further findings surfaced during the mandated walkthrough (§4.7).

Diagnostic evidence: `apps/web/tests/diagnostic/*.diag.ts`, run with
`npx vitest run --config vitest.diagnostic.mts`. **18 of 20 assertions fail; the
2 that pass are the deliberate controls.** Log: `validation-evidence/logs/diagnostics.log`.

---

### A — Financial reporting · **CONFIRMED**

**A1. Draft bookings counted as agency revenue — CONFIRMED.**
`src/services/leadership/pl.ts:76` filters `status: { not: 'CANCELLED' }`.
`BookingStatus` is `DRAFT | CONFIRMED | CANCELLED` (`prisma/schema.prisma:6654`)
and `Booking.status` defaults to `DRAFT` (`:6729`). Every draft contributes its
`saleValue`, `agencyFee` and booking count. The booking route's own POST handler
documents drafts as accruing nothing (`api/v1/bookings/route.ts:80-82`).

- *Expected:* a draft contributes nothing.
- *Actual:* `expected '100000' to be '0'` — the draft's full agency fee is revenue.
- *Control:* a CONFIRMED booking of the same value is counted correctly (passes).

**A2. Payroll aggregation includes inappropriate run statuses — CONFIRMED.**
`pl.ts:224-228` selects payslips by period only, with no filter on `run.status`.
`HrPayrollStatus` is `DRAFT | PENDING_APPROVAL | APPROVED | LOCKED | PAID |
CANCELLED` (`schema.prisma:2457`).

- *Expected:* a **CANCELLED** run — money never paid — costs nothing.
- *Actual:* `expected '40000' to be '0'`. Same for a **DRAFT** run.

**A3. Moving an employee restates historical payroll — CONFIRMED.**
`pl.ts:236` reads `teams: { select: { teamId: true }, take: 1 }` — the user's
*current* team — and `:264` buckets the payslip by it. `take: 1` has no `orderBy`,
so a multi-team user is bucketed non-deterministically. The module's own docstring
(`:198-205`) claims payroll is "tied to the period it paid for"; the query does not
implement that.

- *Expected:* after a transfer, August payroll stays with Team Alpha.
- *Actual:* `expected undefined to be '40000'` — the cost moved to Team Beta.

The asymmetry is the sharp edge: **revenue** is frozen onto the booking at
confirmation (`schema.prisma:6718-6727`, proven by the existing
`tests/sales/leadership.spec.ts:294`), while **payroll cost** follows the person.
One transfer moves the cost line out from under the revenue it was earned against,
so team margin becomes wrong on *both* teams.

**A4. Confirmed vs collected vs incomplete — PARTIAL.**
- *Incomplete cost information:* handled well. `payrollCost` and `margin` are
  `null` rather than `0` when payroll is unknown (`pl.ts:150-152`) and every gap is
  named in `caveats`. This part of the design is sound.
- *Confirmed business:* not distinguished (A1).
- *Collected agency income:* not represented at all. `pl.ts` never reads
  `Booking.collectedAt`; `agencyFee` is the contracted fee presented as "what the
  agency earned" (`:25`), with no caveat that it is billed rather than banked.

**Recommended correction.** Filter bookings to `status: 'CONFIRMED'`; filter
payslips to `APPROVED | LOCKED | PAID`; snapshot the team onto `HrPayslip` at
calculation time exactly as `Booking.teamId` is frozen at confirmation; add either
a collected-revenue column or an explicit caveat.

---

### B — Booking and inventory consistency · **CONFIRMED**

**B1. Confirmation neither validates nor updates unit availability — CONFIRMED.**
`api/v1/bookings/route.ts` never references `UnitInventory`. POST (`:100-113`)
writes `...body`, accepting any `unitInventoryId` with no availability check. PATCH
`CONFIRM` (`:158-181`) sets status and copies placement, and touches no unit.

The service that would do it exists and is well built:
`services/inventory/unitStatus.ts:62-67` takes `SELECT … FOR UPDATE`, enforces a
transition table, and recalculates rollups in the same transaction. It has exactly
one production caller — `api/v1/projects/[id]/units/[unitId]/route.ts:35` — whose
docstring says (`:21-23`) *"a second caller is coming: M9's booking flow moves a
unit to BOOKED as part of creating the booking."* **That caller was never written.**

- *Reproduction (service level):* create a DRAFT booking against an AVAILABLE unit,
  confirm it. *Actual:* `expected 'AVAILABLE' not to be 'AVAILABLE'`.
- *Reproduction (over HTTP, production build):* workspace admin created and
  confirmed a booking against unit `A-101`. Unit status **before: AVAILABLE →
  after: AVAILABLE** (`validation-evidence/logs/walkthrough.json`).

**B2. Two concurrent requests can confirm separate bookings on one unit —
CONFIRMED.** Checked at all three layers as required:

| Layer | Protection |
| --- | --- |
| API | none — no unit read on the confirm path |
| Service | `moveUnit`'s row lock exists but the booking flow never calls it |
| Database | **none** — verified live: `Booking_unitInventoryId_idx` is a plain btree, not unique; check constraints are only `agency_fee`, `buyer`, `cancel`, `sale_value`, `subject`; the database has **0** non-internal triggers; no exclusion constraint exists in `prisma/migrations` |

- *Expected:* one of two concurrent confirmations wins.
- *Actual:* `expected 2 to be 1` — **both returned 200.** Two confirmed bookings on
  one unit.

**B3. Hold / expiry / unavailable / cancellation — inconsistent.**
Inside `moveUnit` these are mostly handled: expired holds are swept by
`releaseExpiredHolds`, called by the units GET route and the project page before
anything is read. Two gaps:

- *Another agent's hold:* `unitStatus.ts:87-94` refuses only `HELD → AVAILABLE` by
  a non-holder. `HELD → BOOKED` by a different agent is permitted — the stronger
  action is the unguarded one. Confirmed: a booking was confirmed against a unit
  held by another agent with a live `heldUntil` (`expected 200 to be ≥ 400`).
- *Already-sold units:* a booking was confirmed against a unit already `SOLD`
  (`expected 200 to be ≥ 400`).
- *Cancellation:* booking `CANCEL` (`route.ts:204-210`) does not release a unit,
  because the booking flow never reserved one.

**Business impact.** Two agents can sell the same flat; project availability
rollups do not reflect sold inventory. Currently capped in practice by Finding F
(no UI) and by bookings being an admin-only permission (G5) — but the API is fully
reachable and both caps are incidental, not controls.

**Recommended correction.** Route booking confirmation through `moveUnit` in the
same transaction (`AVAILABLE|HELD → BOOKED`, `→ SOLD` on collection); add a partial
unique index on `unitInventoryId` where `status = 'CONFIRMED' AND deletedAt IS NULL`
as the database backstop; extend the holder check at `unitStatus.ts:87` to cover
`HELD → BOOKED`.

---

### C — Collection and commission eligibility · **CONFIRMED**

**C1. Booking-edit permission alone marks a booking collected — CONFIRMED.**
`api/v1/bookings/route.ts:139-146` declares the whole PATCH handler as
`module: 'bookings', action: 'EDIT'`. The `COLLECT` branch (`:183-191`) adds no
further check. `bookings:EDIT` and any finance permission are distinct keys
(`lib/security/rbac.ts:115`).

- *Expected:* 403 — recording that money arrived is a finance act.
- *Actual:* `expected 200 to be 403`. A role holding only
  `bookings:VIEW/CREATE/EDIT` set `collectedAt`.

The contrast is inside the same codebase: commission `CONFIRMED` requires
`commissions:APPROVE` (`services/money/commissions.ts:242`); payout approval
requires `payouts:APPROVE` **and** a maker-checker rule refusing the creator
(`services/money/payouts.ts:168,174`). Booking collection — the fact both of those
rest on — has neither.

*Exposure today:* in the seeded default catalogue `bookings:EDIT` is held only by
`super_admin` and `org_admin` (see G5), so the missing separation currently reduces
to "an administrator can do everything". It becomes live the moment an
administrator grants `bookings:EDIT` to a sales or operations role — which the
product invites, since booking is a sales activity.

**C2. Collection is a bare timestamp — CONFIRMED.**
`Booking.collectedAt DateTime?` (`schema.prisma:6742`) is the entire
representation. There is **no** `Payment`, `Receipt`, `Invoice` or ledger model
anywhere in the 201-model schema; `collectedAt` appears exactly twice, on `Booking`
and on `Commission`. No amount, no receipt reference, no payment evidence, no
partial receipt, no currency of receipt. (`expected false to be true` — no field
matching `collectedAmount|amountCollected|receipt|paymentRef` exists.)

**C3. Buyer→developer and developer→agency money are not distinguished —
CONFIRMED.** `Booking` carries `saleValue` ("what the client pays") and `agencyFee`
("what the developer or landlord pays the agency" — `schema.prisma:6731-6735`). One
flag, `collectedAt`, is documented as "when the client's money actually arrived"
(`:6740`), and `commissions.ts:246-247` reads it as "the client's money is in".
Those are different payments, from different payers, on different schedules.
Commission eligibility is gated on the wrong one.

**C4. A flag unlocks full commission after unverified receipt — CONFIRMED.**
`commissions.ts:250` gates `→ COLLECTED` on `collectedAt` being non-null. Because
no amount is recorded, a booking marked collected after a 5% token payment makes
**every** commission on that booking eligible for its **full** amount. `COLLECTED`
is the gate before payout (`schema.prisma:6685`).

*What does work:* the walkthrough confirmed the gate fires correctly in the
negative direction — with `collectedAt` unset, `finance_admin` was refused
`→ COLLECTED` with `not_collected`: *"The booking has no collection date."*

**Policy dependency — stated, not invented.** Whether the *selling agent* may
record collection, and whether partial receipt should pro-rate or block commission,
are finance-policy decisions this repository does not state. What is objectively
determinable is narrower and firmer: the system **cannot express** either policy,
because it records no amount and no separate authority. The gap is
representational, not configurational.

**Recommended correction.** Introduce a receipt record (amount, currency, date,
payer side, reference, recorded-by) and derive `collectedAt` from it; gate the write
on a finance permission using the maker-checker rule `payouts.ts` already
implements; make commission eligibility a function of the agency fee actually
received.

---

### D — HR report access · **CONFIRMED** · highest severity

**A user with SELF (OWN) viewing scope can read and export the entire workspace's
payroll register.**

Two facts combine:

1. `services/hr/reports.ts:805` authorises with
   `can(ctx, report.permission[0], report.permission[1])`, and `can` is
   `scopeFor(...) !== 'NONE'` (`lib/security/rbac.ts:121-123`). **The granted scope
   is checked for existence and then discarded.**
2. Every report body queries `where: { tenantId: ctx.tenantId, … }` and nothing else
   — e.g. `payroll-register` at `reports.ts:520`. No `ownerId`, no `employeeId`, no
   `managedUserIds`, no branch/region narrowing.

The seeded default catalogue makes this immediately exploitable
(`prisma/seed/roles.ts:504-525`, confirmed against the live database):

| Role | Grant | Scope |
| --- | --- | --- |
| `employee` | `payroll:VIEW`, `employee:VIEW`, `attendance:VIEW`, `performance:VIEW` | **OWN** |
| `dept_manager` | `employee:VIEW`, `leave:APPROVE` | **TEAM** ("Approves for their own people only. **The scope is the whole point.**" — `roles.ts:403`) |
| `site_manager` | `employee:VIEW` | BRANCH |

#### Reproduction — direct API, production build, synthetic accounts

`GET /api/v1/workspaces/manath-homes/hr/reports/payroll-register/export?from=2026-01-01&to=2026-12-31`

| Caller | Scope | Reports offered by the list endpoint | Export status | `x-row-count` | Distinct employees in CSV |
| --- | --- | --- | --- | --- | --- |
| `employee` | **OWN** | **10** (incl. payroll register, salary cost) | **200** | **9** | **9** |
| `payroll_officer` | ORGANIZATION | 7 | 200 | 9 | 9 |
| `dept_manager` | TEAM | 11 | 403 on payroll; **200 on headcount** (workspace-wide) | — | — |
| employee of **another workspace** | OWN | — | **404 Workspace not found** | — | — |

**The OWN-scoped employee received byte-identical payroll data to the payroll
officer** — every payslip in the workspace: period, employee number, department,
basic, gross, deductions, net, run status.

#### Reproduction — page visibility

Both consumers call the same `resolve()`, so the UI is not a mitigation. Logged in
as the `employee`-role account, `/manath-homes/people/reports` renders a **Payroll**
section containing *Payroll register* and *Salary cost by department*
(`validation-evidence/screenshots/employee-people-reports-payroll-offered.png`).

The page's own explanatory copy states the guarantee the implementation fails to
provide:

> *"Each report carries the permission for the data behind it, not for reporting —
> so someone who can read headcount cannot export salary cost. You are shown 10 of
> the reports that exist; the rest need permissions your role does not have."*

**Permitted same-team, denied other-team, denied other-workspace:**

- *Same-team access:* permitted (correct).
- *Other-team access within the workspace:* **not denied** — this is the defect.
  A TEAM-scoped `dept_manager` receives workspace-wide headcount; an OWN-scoped
  employee receives workspace-wide payroll.
- *Other-workspace access:* **correctly denied** (404). Queries are tenant-scoped
  and PostgreSQL RLS is forced on the tenant tables — the `Tenant isolation` gate
  passes. **The failure is horizontal, inside a workspace, not across workspaces.**

Some reports are correctly out of reach because their permission tuple is one the
role does not hold at all — the expiring-documents report needs
`hr_documents:VIEW_SENSITIVE_FIELDS`; payroll reports are correctly refused to
`dept_manager`, `team_manager`, `sales_rep` and `finance_admin`.

**Recommended correction.** Make scope load-bearing: resolve `scopeFor(...)` and
pass it into each report's `run`, narrowing the `where` by owner / team / branch /
region — or, where a report is only meaningful workspace-wide, require
`ORGANIZATION` explicitly via `assertScopeAtLeast`, which already exists at
`rbac.ts:137`.

---

### E — Lead allocation · **CONFIRMED**

**E1. The two paths enforce different rules — CONFIRMED.**

| Check | `allocate()` (bulk, leader) | `assignLead()` (automatic round-robin) | `nextDistributionOwner()` (social) |
| --- | --- | --- | --- |
| daily / weekly / monthly quota | yes (`allocation.ts:109-111`) | **no** | **no** |
| active-lead capacity | yes (`:114`) | **no** | **no** |
| `isAvailable` | yes (`:118`) | **no** | **no** |
| `onLeaveUntil` | yes (`:119`) | **no** | **no** |
| `status = ACTIVE` | **no** | **no** | yes (`assignLead.ts:71`) |
| `deletedAt IS NULL` | yes (`:48`) | **no** | yes (`:71`) |
| permission gate | `allocation:APPROVE` (`:161`) | n/a (worker) | n/a |

`assignLead` (`services/distribution/assignLead.ts:11-36`) reads the rule's
`candidatePool`, takes the next id positionally, and assigns. It performs **no
eligibility check of any kind** — not even the `status: 'ACTIVE'` check its own
sibling function three lines below performs.

This is the **default inbound path**: `services/leads/createLead.ts:134` enqueues
`assign-lead` for every lead created without an explicit owner — public forms,
landing pages, imports, API and webhook leads.

Reproduced, each `expected '<userId>' to be null`:

| Case | Result |
| --- | --- |
| agent's daily quota already spent (verified `headroom.available === 0`) | lead assigned anyway |
| agent `isAvailable = false` | lead assigned anyway |
| agent `onLeaveUntil` 7 days in the future | lead assigned anyway |
| agent `status = SUSPENDED` | lead assigned anyway |

**E2. Approved HR leave has no effect on assignment — CONFIRMED.**
`headroom()` reads `User.isAvailable` and `User.onLeaveUntil`. Those two fields are
written by **nothing** in `src/` — the only writer in the repository is the demo
seed (`prisma/seed/index.ts:909`). `services/hr/leave.ts:378-425` (`decideLeave`)
writes the `HrLeaveRequest` row and notifies; it never touches user availability.
So even the path that *does* check leave cannot see an approved absence.

Separately, `onLeaveUntil` is a single "until" scalar with no start date, so it
cannot represent leave beginning in the future: it would block from the moment it
is set rather than for the actual leave dates.

**E3. Inactive / exited / unavailable / overloaded — partially.**
Neither path checks `User.status` (`INVITED | ACTIVE | SUSPENDED | DEACTIVATED`).
A **SUSPENDED** agent received a bulk allocation (`expected 1 to be 0`) as well as
an automatic one. Bulk allocation does honour `deletedAt`, `isAvailable` and every
quota; automatic assignment honours none. Employment exit lives on
`EmployeeProfile.employmentStatus` and is consulted by neither.

**E4. Concurrency — CONFIRMED empirically.**

- **Quota exceeded.** `allocate()` computes `headroom` once at `:169`, outside any
  transaction, then claims inside per-user transactions. Two concurrent
  allocations for an agent with a daily quota of 2 delivered **4 leads**
  (`expected 4 to be less than or equal to 2`). `FOR UPDATE SKIP LOCKED` (`:242`)
  prevents the *same lead* going to two people; it does not bound per-agent totals.
- **Rotation mis-advanced.** `assignLead()` reads the rule and computes
  `nextUserId` at `:12-22`, **outside** the transaction opened at `:24`. Two leads
  processed concurrently against a two-agent pool both went to the same agent
  (`expected 1 to be 2` distinct owners) and the pointer advanced once.

**Recommended correction.** Give `assignLead` the same `headroom` gate `allocate`
uses, walking the pool for the first eligible member as `nextDistributionOwner`
already does; add `status: 'ACTIVE'` to both; derive availability from approved
`HrLeaveRequest` date ranges rather than the never-written `onLeaveUntil`; move the
rule read and pointer advance inside the transaction under a row lock; re-check
headroom inside `claimForUser`.

---

### F — Booking usability · **CONFIRMED** — missing UI, not a permission or link defect

**There is no booking page.**

| Evidence | Result |
| --- | --- |
| Route directory | `src/app/(workspace)/[workspaceSlug]/sales/` holds 40 directories; `bookings` is not among them |
| Navigation | `src/lib/nav/workspaceNav.ts` has no bookings item |
| Client code | `grep -rn "api/v1/bookings" src/` returns **nothing** |
| The repository's own note | `sales/commissions/page.tsx:229`: *"No bookings page yet, so the reference stays text rather than a link into a 404."* |
| E2E route inventory | `tests/e2e/every-route.spec.ts:53` lists every sales route the suite opens; `bookings` is absent, and no E2E spec mentions bookings |
| Live check, production build | `GET /manath-homes/sales/bookings` → **HTTP 404**, heading *"We couldn't find that"*, for both a sales agent **and the workspace administrator** |
| Demo data | the seeded `manath-homes` workspace contains **0 bookings** |

**Classification.** Missing **UI**. Distinguished from the alternatives:
- *not a missing API* — `/api/v1/bookings` GET/POST/PATCH exists and works; the
  walkthrough drove the full create → confirm → accrue → approve chain through it;
- *not a permission issue* — a permission refusal renders "You do not have access
  to this page" with HTTP 200; this is a hard 404 for an org administrator holding
  every bookings grant;
- *not a broken link* — no link was ever rendered.

**Navigation chain, per the review's question:**

| Hop | Reachable in the UI? |
| --- | --- |
| customer / lead → opportunity | yes |
| opportunity → account | yes (`opportunities/[id]/page.tsx:66`) |
| lead / opportunity → property (project, unit, listing) | no direct link; projects and listings are reachable only from the nav |
| anything → **booking** | **no** |
| booking → **collection status** | **no** — collection exists only as `PATCH /api/v1/bookings` |
| commission record | yes — nav → Management → Commissions, gated on `commissions:VIEW` |
| commission → its booking | **no** — plain text, by design |

---

### 4.7 Further findings surfaced during validation

| # | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| **G1** | **`scripts/verify.mjs:127` cannot parse a CRLF checkout.** `.` excludes `\r` and there is no `m` flag, so no `run:` line matches; every gate parses with a null command and the script exits 2 with a false "the plan and CI disagree" naming all 24 gates as deleted. The guard that would catch it (line 141) runs before the filter that causes it (line 150). | Medium — the "is this pushable" tool is unusable on Windows and fails misleadingly | §3.1 |
| **G2** | **Server integration specs default to the developer's primary database.** `tests/server/session-lifecycle.spec.ts:18` and `unified-saas.spec.ts:20` fall back to `postgresql://leadflow:<pw>@localhost:5432/leadflow` when `E2E_DATABASE_URL` is unset; `:84`/`:36` do the same for Redis db 0. They therefore write to, and delete from, whatever `leadflow` is on that machine. They also require a BYPASSRLS role, which `verify.mjs` does not mention. | **High for test isolation** — a test suite must not be able to touch the developer's live database | §2, §3.6 |
| **G3** | **`finance_admin` — the role the seed designates as the payroll approver — cannot approve a payroll run.** `POST /hr/actions/[action]` declares a hard outer gate of `module: 'employee', action: 'VIEW'` (route.ts:288-290), enforced by the API kernel before `ACTION_PERMISSION['payroll-run-decide'] = ['payroll','APPROVE']` is ever consulted. `finance_admin` holds `payroll:APPROVE` at ORGANIZATION but not `employee:VIEW`. Observed: **403 "Your role does not allow view on employee."** | **High** — payroll maker-checker collapses onto `org_admin`, the only role that can both prepare and approve | §5.2 |
| **G4** | **`scripts/seed-realestate-demo.mjs:15` hardcodes `C:/Users/admin/Downloads/Master App/master-saas/apps/web`** as the env-file root, and skips silently when absent (`if (!existsSync(file)) continue`). On any other machine it runs with no `DATABASE_URL`. | Low | source |
| **G5** | **Booking permissions are seeded only to `super_admin` and `org_admin`.** No sales role — not `sales_director`, `branch_manager` or `sales_rep` — holds `bookings:VIEW`. The entire booking and commission-origination flow is administrator-only by default. | Medium — likely a provisioning gap rather than a decision; also the reason Finding C's exposure is currently limited | live permission dump |
| **G6** | `next start` warns *"does not work with `output: standalone` configuration"*. The local production runner does not exercise the deployed serving path (`node .next/standalone/server.js`). | Low, but it means "production build verified" here has a narrower meaning than it appears | §1 |
| **G7** | **Team-feed reactions do not update on a production build.** `POST /api/v1/posts` then `PATCH /api/v1/posts` both return < 300, but the 🎉 button stays `aria-pressed="false"` with count `0` for 20 s (43 polls). The reaction is accepted and never reflected. **CI cannot catch this:** `playwright.config.ts:93` sets `command: 'npm run dev'` and `:102` sets `reuseExistingServer: !process.env.CI`, so the E2E gate always spawns a *development* server. On the evidence available this is the first time the suite has run against a production build. | Medium — a user on the deployed build clicks and nothing happens; the class of defect (dev-vs-prod caching/revalidation) may affect other interactive surfaces | §3.8, `validation-evidence/e2e-artifacts/` |

**Not classified.** Nothing remains unclassified. The 11
`assistant-guardrails` failures from run 1 — initially set aside — were traced to
the same CRLF class (`bodyOf()` at line 73 uses `source.indexOf('\n  },\n')`, which
returns `-1` on CRLF so `slice(start, -1)` returns the remainder of the file) and
pass on LF.

---

## 5. Role-based walkthrough

Synthetic accounts, all `@validation.invalid`, in the seeded demo workspace on the
isolated database, driven against the **production build** on port 3210.

### 5.1 API walkthrough

| Role | Step | Result |
| --- | --- | --- |
| agent (`sales_rep`) | login → lead create → lead list → lead view | 200 / 200 / 200 / 200 |
| agent | follow-up create | 422 (my request body was wrong — harness, not product) |
| agent | bulk allocation | **403** — correctly refused |
| agent | booking COLLECT | **403** — `sales_rep` holds no bookings grant (G5) |
| agent | HR payroll report | **403** — correctly refused |
| workspace admin | projects list → units list → booking create (DRAFT) → CONFIRM | 200 / 200 / 200 / 200 |
| workspace admin | **unit status after CONFIRM** | **AVAILABLE → AVAILABLE** — Finding B |
| finance | commission accrue → list → `→ CONFIRMED` | 200 / 200 / 200 |
| finance | commission `→ COLLECTED` with no collection date | **422 `not_collected`** — gate works |
| finance | HR payroll report | **403** — correctly refused |
| employee | leave types → leave apply | 200 / 200 |
| employee | **HR payroll report / CSV export** | **200 / 200 — 9 payslips, 9 employees** — Finding D |
| HR admin | leave approve | 200 |
| HR admin | payroll run create | 403 — `hr_admin` holds no `payroll:CREATE` (correct split) |
| payroll officer | run create → calculate → submit | 200 / 200 / 200 |
| payroll officer | **approve own run** | **403** — maker-checker works |
| finance admin | **approve the run (designated approver)** | **403 "does not allow view on employee"** — G3 |
| team manager | leads list (team scope) | 200 |
| other-workspace employee | any HR report in `manath-homes` | **404** — correctly denied |

### 5.2 Coverage against the requested list

| Requested | Exercised | Result |
| --- | --- | --- |
| Lead creation, assignment, follow-up, viewing | yes | creation/viewing pass; assignment eligibility is Finding E; follow-up body shape was my error |
| Booking and inventory transitions | yes | booking transitions work; **inventory does not move** — Finding B |
| Commission accrual, approval, collection eligibility, payout recording | yes | accrual/approval/eligibility gate all correct; payout **listing** exercised, **payout approval not executed** (no eligible commission reached COLLECTED, because collection was correctly refused) |
| Leave request and approval | yes | pass |
| Payroll preparation and separate approval | yes | preparation passes; self-approval correctly refused; **approval by the designated approver is blocked** — G3 |
| Restricted reports and exports | yes | Finding D |

### 5.3 Browser walkthrough by role

Production build, Chromium, screenshots in `validation-evidence/screenshots/`.

| Role | Page | HTTP | Heading | Refused | Screenshot |
| --- | --- | --- | --- | --- | --- |
| agent | `/sales/leads` | 200 | Leads | no | `agent-sales-leads.png` |
| agent | `/sales/follow-ups` | 200 | Follow-ups | no | `agent-sales-followups.png` |
| agent | `/sales/bookings` | **404** | We couldn't find that | no | `agent-bookings-missing.png` |
| manager | `/sales/leads` | 200 | Leads | no | `manager-sales-leads.png` |
| manager | `/sales/leadership` | 200 | Leadership | no | `manager-leadership.png` |
| HR | `/people/employees` | 200 | Employees | no | `hr-people-employees.png` |
| HR | `/people/leave` | 200 | Leave | no | `hr-people-leave.png` |
| HR | `/people/reports` | 200 | Reports | no | `hr-people-reports.png` |
| finance | `/sales/commissions` | 200 | Commissions | no | `finance-commissions.png` |
| finance | `/sales/commissions/slabs` | 200 | Commission slabs | no | `finance-commission-slabs.png` |
| **employee** | `/people/reports` | **200** | Reports | no | `employee-people-reports-payroll-offered.png` — **payroll register offered** |
| workspace admin | `/sales/leadership?view=pl` | 200 | Leadership | no | `wsadmin-leadership-pl.png` |
| workspace admin | `/sales/projects` | 200 | Projects | no | `wsadmin-projects.png` |
| workspace admin | `/sales/bookings` | **404** | We couldn't find that | no | `wsadmin-bookings-missing.png` |

All six roles signed in successfully and landed on `/manath-homes/dashboard`.

### 5.4 Playwright E2E suite

`npx playwright test` with `APP_URL=http://127.0.0.1:3210`, attached to the
verified production-build server rather than spawning a dev server.

**42 passed · 1 failed · 0 skipped · 287s** (`validation-evidence/logs/e2e.log`)

Passing coverage included: sign-in and two-factor enrolment (including recovery
codes), CRM lifecycle (lead → activity/task/follow-up → opportunity → closed won),
CSP in a real browser, entity navigation, **every sales/people/workspace/platform
route rendering for an entitled viewer**, HR modules end to end, invitation
acceptance, password reset, mobile viewport, platform workspace editing, the
request budget, and refusal/empty/search states.

The one failure is G7 (team-feed reaction not reflected on a production build).

---

## 6. Diagnostic files and environment changes made

**Files added (all untracked):**

| Path | Purpose |
| --- | --- |
| `apps/web/tests/diagnostic/finding-a-pl.diag.ts` | Finding A |
| `apps/web/tests/diagnostic/finding-bc-booking.diag.ts` | Findings B and C |
| `apps/web/tests/diagnostic/finding-e-allocation.diag.ts` | Finding E |
| `apps/web/vitest.diagnostic.mts` | their runner |
| `validation-evidence/` | this report, sanitized logs, screenshots |

They are named `*.diag.ts`, not `*.spec.ts`, specifically so the default vitest
include cannot pick them up: **the baseline `npm test` result is exactly what it
would have been without this branch.** They assert the behaviour a reviewer would
expect, so a failing assertion is the evidence.

**Environment changes:**

1. Created databases `master_suite_val`, `master_suite_val_shadow`,
   `master_suite_val_unit`, `master_suite_val_unit_shadow` (the last two became
   unused after 3.6). Applied `prisma migrate deploy`; seeded demo data with
   `ALLOW_DEMO_SEED=yes NODE_ENV=development`.
2. Generated `apps/web/.env` and `apps/web/.env.test` (both gitignored) pointing at
   those databases, Redis db 13, and MinIO bucket `master-suite-val`.
3. Set `core.autocrlf=false` / `core.eol=lf` **in this worktree only** and
   re-checked-out tracked files. Tracked content unchanged.
4. Created 10 synthetic accounts (`@validation.invalid`) plus fixtures the base
   seed omits: 2 leave types, 1 approved commission slab, 1 project with 12 units.
5. Started a production-build server on port 3210. **Still running** — stop with
   `taskkill /pid <pid> /t /f` or leave it; it holds no lock.

**Not changed:** the developer's `leadflow` and `master_saas_test` databases, their
`.env` files, their main checkout, and the third-party server on port 3100.

---

## 7. What remains untested

Marked untested because they were **not performed**, not because they are believed
to work.

| Area | Status |
| --- | --- |
| **Production** | **Version unknown; nothing validated** |
| Production boot-time guards (`assertProductionConfiguration`, mock-provider refusal, proxy-CIDR check, runtime RLS assertion) | untested — the local runner serves with `NODE_ENV=development` |
| Deployed serving path (`output: standalone`) | untested — `next start` warned it does not apply |
| Real email, WhatsApp, SMS, telephony delivery | untested — all providers mocked or unconfigured |
| Real push delivery (FCM / APNs) | untested — no credentials |
| Real-device and biometric check-in (face service) | untested — the face container was not started |
| Live provider integrations (Meta, Gemini, transcription) | untested — no credentials |
| Background workers and scheduled jobs | untested — the worker process was never started |
| Load, performance, capacity | untested |
| Backup restore and rollback against a real remote | untested — only the `local` transport is covered by CI's round-trip gate; s3/rclone/rsync are not |
| Payout approval and payment recording | **not executed** — no commission legitimately reached COLLECTED |
| Multi-currency P&L beyond the exclusion caveat | untested |
| The 7 POSIX-only unit tests | untestable on this host; expected to pass on Linux, but **not verified on Linux** |
| Whether these findings reproduce on a Linux runner | not verified — all findings above were reproduced on Windows against a production build |

Nothing here was inferred from a successful build.

---

## 8. Recommended next phase

Do **not** treat this as a release gate pass. Recommended order:

1. **Fix D first.** It is the only finding that discloses personal data —
   every employee can export every colleague's salary — and the fix is contained:
   make `scopeFor` load-bearing in `services/hr/reports.ts`. Add a regression test
   per scope level.
2. **Fix G3 alongside it.** Payroll cannot complete through its intended separation
   of duties today; the fix is the same file family and the same afternoon.
3. **Fix B and C together.** They are one transaction boundary: confirmation should
   move the unit and collection should carry a receipt. Add the database backstop
   (partial unique index) in the same change, so the control does not depend solely
   on application code.
4. **Fix E's automatic path** to share `headroom` with the bulk path, and decide
   explicitly whether approved HR leave should feed allocation (it currently cannot).
5. **Fix A's four queries** — they are small, and the report is what leadership acts on.
6. **Upgrade `next`, `nodemailer` and `sharp`** — the audit gate is red on a
   critical unauthenticated-RCE advisory and will stay red.
7. **Fix G2 before any of the above is tested by others** — a test suite that
   writes to the developer's primary database will eventually cost someone real data.
8. **Then re-run this baseline on a Linux runner**, where the 7 POSIX-only failures
   should clear and the result is directly comparable to CI.
9. **Only then** consider a staging deployment, with the untested list in §7 as the
   agenda for that phase — particularly the production boot guards, the standalone
   serving path, real provider delivery, the worker process, and backup restore.

---

## 9. Evidence index

| Path | Contents |
| --- | --- |
| `validation-evidence/baseline-run1/` | The original, unmodified baseline: per-gate logs and `gate-results.tsv` |
| `validation-evidence/logs/verify-run1-crlf-failure.log` | The `verify.mjs` CRLF failure |
| `validation-evidence/logs/verify-run4.log` | The completed `npm run verify` run |
| `validation-evidence/logs/unit-suite-lf.log` | Full vitest output, LF |
| `validation-evidence/logs/integration-passing.log` | Integration gate, 6/6 |
| `validation-evidence/logs/diagnostics.log` | The 20 diagnostic assertions |
| `validation-evidence/logs/walkthrough.txt` / `.json` | API walkthrough by role |
| `validation-evidence/logs/payroll-and-d.txt` / `.json` | Payroll separation + Finding D access matrix |
| `validation-evidence/logs/audit-run4.log` | Dependency audit |
| `validation-evidence/logs/e2e.log` | Playwright against the production build |
| `validation-evidence/screenshots/` | 14 per-role screenshots + `walkthrough-results.json` |
| `apps/web/tests/diagnostic/` | The diagnostic specs themselves |

All logs are sanitized: connection strings, passwords and tokens are replaced with
`<redacted>`. No customer data, employee records or environment files are reproduced.
---

## 10. Summary

**Environment.** Fully isolated: dedicated PostgreSQL database (`master_suite_val`),
Redis db 13, MinIO bucket `master-suite-val`, freshly generated secrets, synthetic
`@validation.invalid` accounts. All infrastructure is loopback-bound containers.
Email, WhatsApp, SMS/telephony, push, Meta and AI providers are all mocked or
unconfigured and were verified in code to be unable to reach a real recipient. The
worker process was never started, so no scheduled job ran. No real financial action
is reachable — the product integrates with no payment rail. **One leak found and
disclosed:** two server-integration specs hardcode the developer's `leadflow`
database as a fallback and briefly created and deleted fixture rows there; verified
zero residue afterwards.

**Code version.** Commit `f16ed677516fb07f31832a5d725e13efb477c34d`, identical to
the reviewed commit, in an isolated worktree with a clean tree. Nothing tracked was
modified. **Production's deployed version is unknown and production was not
validated.**

**Baseline.** `npm run verify` initially exited 2 for a host reason
(`scripts/verify.mjs:127` cannot parse CRLF line endings and reports a false "the
plan and CI disagree"). After normalising the checkout to LF — tracked content
unchanged — 11 of 15 gates pass. Final results: typecheck, lint, format, schema
drift, tenant isolation (RLS), raw-SQL scope, README counts, observability, Redis
auth, face token, backup round-trip and build all **pass**. Unit suite: **7 failed
/ 1908 passed / 0 skipped**, and all 7 failures are POSIX-only assertions (file
modes, path separators) that cannot pass on Windows and are expected green on the
Linux CI runner. Server integration: **6/6 pass** once pointed at the right
database. E2E against a production build: **42 passed, 1 failed** (the failure is a genuine defect — see below). **`npm audit --omit=dev` fails
with 1 critical and 2 high advisories** — that one is a genuine, platform-independent
defect (`next` 16.2.12 unauthenticated RCE, `nodemailer`, `sharp`).

**Findings — all six CONFIRMED.**

- **A — P&L (`services/leadership/pl.ts`).** Draft bookings count as agency revenue
  (`:76` excludes only CANCELLED). Payroll aggregation has no run-status filter
  (`:224`), so **cancelled** and draft runs are costed. Payroll is attributed to the
  employee's *current* team (`:236,:264`), so a transfer restates a closed period —
  while revenue is correctly frozen on the booking, making team margin wrong on both
  teams. Collected income is not distinguished from contracted fee; incomplete cost
  information *is* handled well (null margin plus caveats).
- **B — Booking/inventory.** Booking confirmation never reads or writes
  `UnitInventory`. The correct locking service exists (`unitStatus.ts`) but the
  booking flow was never wired to it — the units route's own comment says that
  caller "is coming". Verified at all three layers: no API check, no service call,
  and **no database constraint** (plain index, no unique, zero triggers). Two
  concurrent confirmations against one unit **both returned 200**. Bookings also
  succeed against `SOLD` units and over another agent's live hold.
- **C — Collection.** `PATCH /api/v1/bookings` action `COLLECT` requires only
  `bookings:EDIT` — no finance authority — while the same codebase requires
  `payouts:APPROVE` plus maker-checker for payouts. A role holding only booking
  permissions set `collectedAt` (**200, expected 403**). Collection is a bare
  timestamp: no `Payment`/`Receipt`/`Invoice` model exists in the 201-model schema,
  so no amount, receipt or evidence is recorded, and buyer→developer money is not
  distinguished from developer→agency money. A partial receipt therefore unlocks
  **full** commission. Whether the seller may certify collection is an unstated
  finance policy — but the system cannot express *any* such policy.
- **D — HR reports (highest severity).** `services/hr/reports.ts:805` authorises
  with `can()`, which checks that a scope exists and then discards it; every report
  query is `where: { tenantId }` only. The seeded `employee` role holds
  `payroll:VIEW` at **OWN** scope. Result, proven over HTTP against the production
  build: an ordinary employee is offered 10 reports including the payroll register
  and exported **9 payslips for 9 employees — byte-identical to what the payroll
  officer receives**. The page even tells them "someone who can read headcount
  cannot export salary cost". Cross-**workspace** access is correctly denied (404,
  RLS holds); the failure is horizontal, inside a workspace.
- **E — Lead allocation.** `assignLead()` — the automatic round-robin behind every
  form, landing-page, import and API lead — performs **no** eligibility check:
  leads were assigned to agents who were over quota, marked unavailable, on leave
  and **SUSPENDED**. Bulk `allocate()` checks quotas and availability but not
  `status`, and a suspended agent still received work. Approved HR leave has no
  effect at all: `decideLeave` never writes `User.isAvailable`/`onLeaveUntil`, and
  nothing else in `src/` does either. Concurrency: two simultaneous allocations
  delivered **4 leads against a quota of 2**, and two concurrent automatic
  assignments both went to the same agent while the rotation advanced once.
- **F — Booking usability.** There is **no booking page**. No route, no navigation
  entry, no client code calling `/api/v1/bookings`, and the commissions page
  explicitly renders the booking reference as text "so the reference stays text
  rather than a link into a 404". `/sales/bookings` returns a hard **404 even for
  the workspace administrator** — a missing UI, not a permission refusal (which
  renders 200) and not a broken link. The API works and was driven end to end.

**Five further findings** surfaced during the mandated walkthrough, one of them
significant: **`finance_admin`, the role the seed designates as the payroll
approver, cannot approve a payroll run** — the HR actions route has a hard outer
gate of `employee:VIEW` that `finance_admin` does not hold, so approval 403s and
maker-checker collapses onto `org_admin`. Also: `verify.mjs` unusable on CRLF
checkouts; server-integration specs defaulting to the developer's live database;
a hardcoded absolute path in `seed-realestate-demo.mjs`; and booking permissions
seeded only to administrators.

**Not tested.** Production (version unknown), production boot-time guards, the
`output: standalone` serving path, real email/WhatsApp/SMS/telephony/push delivery,
real-device and biometric check-in, live provider integrations, background workers
and scheduled jobs, load and performance, backup restore/rollback against a real
remote, payout approval and payment recording, and whether these findings reproduce
on Linux. None of this was inferred from a successful build.

**Recommended next phase.** Fix D first (only finding that discloses personal data,
and the fix is contained), then the payroll-approver blocker, then B and C together
as one transaction boundary with a database backstop, then E's automatic path, then
A's four queries, then the dependency upgrades. Fix the test-suite database
fallback before anyone else runs the suite. Then re-run this baseline on a Linux
runner for a like-for-like comparison with CI, and only then consider a staging
deployment with the untested list as its agenda.

**This is not a production-readiness sign-off.** No claim of "production ready",
"fully secure" or "all passed" is made or supported by this evidence.
