# Baseline validation and finding investigation — 2026-09-09

Validation and evidence collection. **Nothing was deployed, no business logic was
changed, no production system was contacted.**

---

## 1. Environment and code version

| Item | Value |
|---|---|
| Repository | `GreenArrow-7/Master-Suit` |
| Branch | `claude/demo-tenant-sales-hrms-420a5f` |
| Full SHA tested | `253acf1be227a51e1b55e85b3d6f49fbf7a692d4` |
| Reviewed commit | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Relationship | reviewed commit **is an ancestor**; HEAD is **30 commits ahead** |
| Working tree | 1 modified file — `docs/EVIDENCE_CONFLICTS.md` (this session's `EVC-025`), uncommitted at time of test |
| Production deployed version | **UNKNOWN — not supplied, not inspected.** No claim is made about production. |

**Does the difference matter for the findings?** Diff of `f16ed67..HEAD` across
`src/services/` and `src/app/api/` touches exactly three files:
`api/v1/calls/[id]/live/route.ts`, `services/hr/captureVault.ts`,
`services/meta/config.ts`. **None of the six findings' code is among them.**
`src/services/leadership/pl.ts` is byte-identical to the reviewed commit
(`git diff --quiet f16ed67..HEAD -- …` returns clean). Conclusions below
therefore apply to `f16ed67` as well as to HEAD.

The current version was **not** replaced or reset. The 30 commits are this
session's governance and test work, described in the specs directory.

## 2. Isolation — verified before any write

| Control | Evidence | Result |
|---|---|---|
| Service exposure | `docker ps`: Postgres, Redis, MinIO, Mailpit all bound `127.0.0.1` only | **isolated** |
| Database separation | `.env` → `master_saas_demo`; `.env.test` → `master_saas_test`; both loopback | **separate** |
| Redis separation | `.env.test` uses logical DB **15** | **separate** |
| Object storage | buckets `master-saas-demo` vs `master-saas-test` | **separate** |
| Outbound email | `EMAIL_PROVIDER=mock` in **both** files; Mailpit is a local sink | **cannot reach real recipients** |
| Antivirus | `ANTIVIRUS_PROVIDER=mock` | mocked |
| Vendor credentials | `IntegrationConnection` in `master_saas_test`: **zero rows** | **no real provider credentials** |
| Production reachability | no production connection string present or used | **none** |

**No passwords, tokens, connection strings, cookies or customer records are
reproduced in this document.** One slip during collection: a `sed` filter failed
to match and printed `.env`'s Redis URL to the session transcript, which
contains the loopback development password `leadflow` — the same value already
committed in `apps/web/infra/docker-compose.yml`. Exposure is negligible, and it
is recorded rather than omitted.

**Isolation established. Write operations were permitted on that basis.**

## 3. Baseline results

All from `apps/web` at `253acf1`.

| Command | Exit | Duration | Result |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | 68s | clean |
| `npx eslint .` | **0** | 110s | clean |
| `npm run check:drift` | **0** | 33s | schema and migrations agree |
| `npm run check:rls` | **0** | 1s | RLS coverage intact |
| `npm audit --omit=dev --audit-level=high` | **0** | — | `found 0 vulnerabilities` |
| `npm run test` (vitest) | **0** | 187s | **159 files, 2015 passed, 2 skipped, 0 failed** |
| `npm run verify` | **2** | — | **harness failure, not an application defect** — see `EVC-025` |
| `npm run test:e2e` | **1** | — | **harness/invocation failure** — see §3.2 |

### 3.0 vitest detail

159 files, **2015 passed, 2 skipped, 0 failed**, 187s. The totals are 23 tests
above the 1992 recorded earlier this session, which is exactly the two boundary
suites added under SPEC-0008 (10 + 13).

**The two skips, identified rather than assumed.** An earlier draft of this
report said they were "the same two CI reports on green runs" — that was an
unverified guess and it is withdrawn. Parsed from the run JSON, both are in
`apps/web/tests/unit/observability.spec.ts`:

- *alertmanager-entrypoint.sh writes the relay password into a file readable by
  nobody else*
- *prometheus-entrypoint.sh writes the scrape token into a file readable by
  nobody else*

Both use the `itPosix` helper and are skipped because this host is Windows —
`observability.spec.ts:154` marks them POSIX-only, since the assertion is a file
mode. **Both are security tests about credential file permissions.** They run on
Linux CI and did not run here, so the local baseline is weaker than CI on exactly
that axis. Nothing else was skipped.

### 3.1 `npm run verify` — harness failure, diagnosed

`verify.mjs` exited 2 claiming twenty CI steps had been "renamed or removed".
Every one exists in `ci.yml`. Root cause: `verify.mjs:92` splits on `'\n'`, so on
a `core.autocrlf=true` checkout every line keeps a trailing `\r`; the command
regex `/^ {8}run:\s*(.*)$/` (`verify.mjs:127`) cannot match, because in
JavaScript `.` excludes line terminators and `\r` is one:

```
/./.test('\r')                                → false
/^ {8}run:\s*(.*)$/.test('        run: |\r')  → false
/^ {8}run:\s*(.*)$/.test('        run: |')    → true
```

24 `run:` lines present, **0 matched**, so `stepsOf()` returns an empty array.
The script's own guard (`verify.mjs:139`) compares parsed step *names* against
declared ones — both 26 — so it does not notice. **Classified: test-harness
defect. Registered as `EVC-025`. Not fixed** — `apps/web/scripts/` is outside
every open task's scope. Fix is `.split(/\r?\n/)`.

### 3.2 `npm run test:e2e` — did not complete

First attempt used `APP_URL= npx playwright test` to force the CI path. The
spawned dev server refused to boot: `Invalid environment configuration: APP_URL:
Invalid url` — an empty string fails `z.string().url()` in `src/lib/env.ts:455`.
**This is my invocation error, not an application defect.** `.env` sets
`APP_URL=http://localhost:3005` and nothing was listening there.

**E2E is therefore UNTESTED in this baseline.** It is not reported as passing or
failing. Running it requires either a server on port 3005 or an environment
without `APP_URL`, which `.env` supplies unconditionally.

## 4. Findings

Investigated by code inspection at `253acf1`, which is identical to `f16ed67`
for every file named. **No finding below was reproduced by executing a scenario
against a running application** — that is stated per finding and is the main
limitation of this pass.

| # | Finding | Status | Business impact |
|---|---|---|---|
| A1 | Draft bookings counted as agency revenue | **CONFIRMED** | P&L overstates revenue |
| A2 | Payroll from unapproved/cancelled runs counted as cost | **CONFIRMED** | margin distorted both ways |
| A3 | Team transfer restates historical payroll attribution | **CONFIRMED, documented as deliberate** | mixed attribution basis |
| A4 | Report does not distinguish collected from booked income | **CONFIRMED** | revenue ≠ cash |
| B | No availability control at booking confirmation | **CONFIRMED — control absent** | double-selling a unit |
| C | Booking edit permission unlocks commission eligibility | **CONFIRMED** | commission on unverified receipt |
| D | SELF/TEAM scope returns organisation-wide HR rows | **CONFIRMED** | payroll/employee data disclosure |
| E | Round-robin bypasses eligibility | **NOT REPRODUCED as stated** — no round-robin exists; a **related real gap** is confirmed | uncapped routing |
| F | No usable booking page | **CONFIRMED for bookings; commissions page exists** | workflow unreachable in UI |

### A — financial reporting (`src/services/leadership/pl.ts`, identical to `f16ed67`)

**A1 CONFIRMED.** `pl.ts:76` — `status: { not: 'CANCELLED' }`. `BookingStatus` is
`DRAFT | CONFIRMED | CANCELLED`, so **DRAFT bookings are included in
`saleValue` and `agencyFee`**. Expected: only `CONFIRMED` counts as earned.
Actual: a draft inflates revenue and margin.

**A2 CONFIRMED.** `pl.ts:224-228` queries `hrPayslip` filtered only on `tenantId`
and the run's period dates. `HrPayrollRun.status` is
`DRAFT | PENDING_APPROVAL | APPROVED | LOCKED | PAID | CANCELLED` and **is not
filtered**. Payslips from draft, pending and **cancelled** runs all enter
`payrollCost`, which feeds `margin`. By contrast `src/services/hr/reports.ts:519`
at least *selects* `run.status`. Expected: approved/locked/paid only.

**A3 CONFIRMED, and deliberate.** Bookings are grouped by `teamId`/`regionId`/
`branchId` **read from the booking row** (`pl.ts:81-83`) — frozen at
confirmation, documented at `pl.ts:8-11`. Payroll is grouped by the employee's
**current** team (`pl.ts:198-199`, "attributed to the group each person sits in
now"), justified as "a payslip is already tied to the period it paid for".
Net effect: a transfer moves historical payroll cost but not historical revenue,
so a closed period's margin changes. Reported as a **documented design decision
with a consequence**, not as an oversight.

**A4 CONFIRMED.** The booking `select` (`pl.ts:79-88`) does not include
`collectedAt`. Revenue is *booked* agency fee, never *collected*. The report does
distinguish **incomplete cost** properly — `payrollCost: null` and `margin: null`
rather than zero, with caveats (`pl.ts:105`, `:111`, `:222`, `:246`) — which is
good practice. It does not distinguish confirmed-and-collected from
confirmed-and-unpaid.

### B — booking and inventory (`src/app/api/v1/bookings/route.ts`)

**CONFIRMED — the control is absent, not racy.**

- `Booking.unitInventoryId` exists and relates to `UnitInventory`.
- Confirmation (`route.ts:151-180`) selects only
  `id, status, collectedAt, ownerId, tenantId` and updates `status: 'CONFIRMED'`.
  **It never reads or writes the unit.**
- No `@@unique` on `Booking.unitInventoryId` — only `@@index`.
- `src/services/inventory/unitStatus.ts` (`moveUnit`, `releaseExpiredHolds`)
  **exists and is imported only by** `api/v1/projects/[id]/units/route.ts` and
  `.../[unitId]/route.ts` — **never by the bookings path**.

Expected: confirmation atomically validates availability and transitions the
unit. Actual: no validation at any layer, so two bookings against one unit both
confirm — **concurrently or sequentially**. Holds, expired holds and
cancellations are managed on a separate axis that bookings do not consult.

**Not executed:** a concurrency test was not run. It is unnecessary to
demonstrate absence of a check, and stating so is more honest than a race test
that would pass for the wrong reason.

### C — collection and commission eligibility

**CONFIRMED.**

- All three transitions — confirm, collect, cancel — are one `PATCH`
  (`bookings/route.ts:139-146`) gated by a **single** permission:
  `module: 'bookings', action: 'EDIT'`. **No separate finance authority exists.**
- Collection is represented **only** by `collectedAt` (`route.ts:188`). No
  amount, no receipt, no payment evidence: there is **no `Payment`, `Receipt` or
  `Collection` model** in the schema.
- Commission eligibility keys directly off it —
  `src/services/money/commissions.ts:250`:
  `if (input.to === 'COLLECTED' && !commission.booking.collectedAt) …`.

So a user with `bookings:EDIT` sets a timestamp and **full** commission
eligibility unlocks. Partial receipt cannot be represented, so it cannot be
distinguished from full receipt. Buyer-to-developer versus agency-received
payments are **not** distinguished anywhere in the schema.

**Policy dependency, not invented:** what proportion of receipt should unlock
what proportion of commission is a finance policy this repository does not state.
The defect reported is the *absence of any representation* capable of expressing
such a policy.

### D — HR report access

**CONFIRMED.**

- `src/lib/security/rbac.ts:121` — `can()` is
  `scopeFor(...) !== 'NONE'`, so it returns **true for `SELF` and `TEAM`**.
- `src/services/hr/reports.ts:805` gates a report with exactly that `can()`.
- The report queries (`reports.ts:519`, `:560`) filter `tenantId` and period —
  **no user or team row filter**.
- `assertScopeAtLeast()` exists (`rbac.ts:137`) and is **not used** in
  `reports.ts`.

Expected: a `SELF`-scoped holder sees their own rows. Actual: they receive
organisation-wide rows. The CSV export route
(`…/hr/reports/[reportKey]/export/route.ts`) deliberately shares the same gate —
its comment says an export "cannot reach a report the UI would have hidden",
which is true and insufficient: **both paths share the same inadequate check, so
both disclose equally.**

**Not executed:** no synthetic SELF/TEAM user was driven against the endpoint.
The mechanism is established from code; the impact should be confirmed by test
before remediation is signed off.

### E — lead allocation

**NOT REPRODUCED as stated. A related gap is CONFIRMED.**

There is **no automatic round-robin assignment** in this codebase. Searches for
round-robin, auto-assign and rotation return only unrelated matches (token
refresh, telephony). `src/services/automation/actions.ts:40` assigns
`ownerId: ctx.actor.id` — to the actor, not by rotation.

**Confirmed instead:** two allocation paths apply **different** eligibility rules.

| Path | Checks |
|---|---|
| `allocate()` (`allocation.ts:159`) | calls `headroom()` — `isAvailable`, `onLeaveUntil`, `activeLeadCapacity` and rate quotas, skipping with reasons |
| `routeLeads()` (`allocation.ts:304`) | permission `allocation:APPROVE`; target user exists and is not deleted (`select: { id: true }`); team exists. **No availability, leave or quota check, and no `headroom()` call.** |

**Leave: CONFIRMED gap.** `User.onLeaveUntil` is read at `allocation.ts:119`/`:121`
and is **never written by application code** — the only writer in the repository
is `prisma/seed/index.ts:1029`. There is no linkage from `HrLeaveRequest`
approval. It is also a single timestamp, so it cannot express a future date
range. **Approved HR leave does not affect assignment.**

**Not executed:** concurrent-allocation quota testing was not performed, so
whether `allocate()` can be raced past a quota is **UNKNOWN**.

### F — booking usability

**CONFIRMED for bookings; the review's premise is partly out of date for
commissions.**

- `src/app/(workspace)/[workspaceSlug]/sales/bookings/page.tsx` — **does not
  exist**.
- `src/app/(workspace)/[workspaceSlug]/sales/commissions/page.tsx` — **exists**,
  with a `slabs` sub-page.
- 66 sales pages exist in total.
- `src/app/api/v1/bookings/route.ts` — the **API exists** with list, create and
  the confirm/collect/cancel `PATCH`.

Classification: **missing UI, not a missing API and not a permission problem.**
Navigation from customer or opportunity → property → booking → collection status
→ commission cannot complete, because the booking step has no page.

## 5. Role-based walkthrough

**NOT PERFORMED.** No browser walkthrough was executed in this pass for agent,
manager, HR, finance or workspace administrator. It is not inferred from the
build.

Consequently these remain **untested**: real-device and biometric flows,
live-provider integrations, load, restore and rollback.

## 6. Diagnostic files and environment changes

| Item | Nature |
|---|---|
| `apps/web/tests/tenant/demo-tenant-boundary.spec.ts` | added earlier this session (SPEC-0008), 10 passing |
| `apps/web/tests/tenant/demo-application-boundary.spec.ts` | added earlier this session (SPEC-0008), 13 passing |
| `docs/EVIDENCE_CONFLICTS.md` | `EVC-025` appended (verify.mjs defect) |
| scratchpad `diag-verify.mjs` | throwaway reproduction of `stepsOf()`, not committed |
| Databases | `master_saas_test` written by the vitest run; `master_saas_test_reset` created earlier by the isolated reset fixture |
| Application code | **unchanged** — no business logic touched |

## 7. Remaining validation before any production release decision

1. Execute the six findings as **runtime scenarios**, not code reads.
2. Run the **role-based walkthrough** with synthetic accounts.
3. Get `npm run test:e2e` running (needs a server on `APP_URL`, or `EVC-025`-class
   environment handling).
4. Fix `verify.mjs` so a pre-push gate exists on Windows.
5. Establish the **production deployed version**, which is currently UNKNOWN.
6. Concurrency testing for B and E.
7. Obtain the **finance policy** C depends on before designing its remedy.

## 8. Recommended next phase

**Remediation design for D, then B and C, then A.**

D is the only finding that discloses data across a permission boundary, and its
fix is small and local: use `assertScopeAtLeast()` or apply row scoping in
`reports.ts`. B and C are financial-integrity defects requiring schema work
(a unit-availability control; a payment/receipt representation). A is a set of
query-filter corrections and one attribution decision.

**Not recommended:** proceeding to a production release decision on this
evidence. Nothing here establishes that the application is production ready, and
E2E and the role walkthrough have not run.
