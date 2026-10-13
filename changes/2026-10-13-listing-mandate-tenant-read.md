# A listing with a live mandate can be published again; three more reads inside a transaction found nothing

**What.** Four helpers called inside a `withTx` read through the global
Prisma client. They now read through the transaction's `tx` or run after the
commit. Branch `fix/listing-mandate-tenant-read`.

**Why.** The evidence check found that `PATCH /api/v1/listings/{id}`
`{status: 'ACTIVE'}` answered 422 `no_mandate` even when the listing had an
ACTIVE mandate that had not expired. `assertMarketable` read the mandate
through the global client inside the route's `withTx`. Inside a tenant
transaction `runPinned` does nothing, so that read ran on another pooled
connection with no `app.tenant_id`, and forced RLS hid the mandate. An AST
sweep of `apps/web/src` for the same mistake (a helper called inside a
`withTx`/`withPlatformTx` callback that reaches the global client, directly or
through other helpers) found three more.

**Where** (under `apps/web/`)

- `src/services/inventory/mandates.ts`, `src/app/api/v1/listings/[id]/route.ts`:
  `assertMarketable(tx, tenantId, listingId)` takes the route's `tx`.
- `src/services/idempotency.ts`, `src/services/money/collections.ts`:
  `findReplay(req, db = prisma)`, and `reverseReceipt` passes its `tx`.
- `src/services/hr/lifecycle.ts`, `src/services/hr/leave.ts`,
  `src/services/hr/dashboard.ts`: `lifecycleDashboard`, `expiringDocuments`
  and `employeeRecordScope` take an optional `db`, and the HR and IT admin
  dashboards pass theirs.
- `src/app/api/v1/follow-ups/[id]/route.ts`: `recordTargetProgress` runs after
  the commit, as it already does in every other caller. It never throws, so
  inside the transaction it failed silently.

**Behaviour**

- Publishing (ACTIVE or UNDER_OFFER) a listing with a live mandate succeeds. A
  listing with no live mandate is still refused with 422 `no_mandate`.
- Retrying a receipt reversal with the same request key now returns the first
  reversal (`replayed: true`). It used to answer 409 "already being processed".
- The HR administrator's dashboard now counts joiners, overdue checklist tasks
  and expiring or expired documents, which all showed 0. The IT administrator's
  "Joiners to provision" was also 0 and now counts them too.
- Completing a follow-up now counts toward its owner's FOLLOWUPS_COMPLETED
  target. Before, it was never counted.

**Verified.** Each of these new tests fails on main:

- `tests/sales/listings.spec.ts` (+2): publishing over HTTP returns 200, and
  with no mandate it still returns 422 `no_mandate`. On main the first fails
  with _expected 422 to be 200_.
- `tests/sales/collections.spec.ts` (+1): a reversal retried with its key
  replays. On main it fails with _AppError: That request is already being
  processed._
- `tests/hr/dashboard-manager.spec.ts` (+1): the HR admin "Joining" stat is 1.
  On main it fails with _expected +0 to be 1_.
- `tests/sales/next-follow-up.spec.ts` (+1): completing a follow-up twice
  counts 1 toward the target. On main it fails with _expected +0 to be 1_.

On the branch, `tests/sales`, `tests/hr` and `tests/permission` ran as 119
files with 2085 passed and 17 skipped. `stage-mini-form` failed its
`beforeAll` once with "Unable to start a transaction in the given time" from
pool pressure during the wide run, and passed 17/17 when run alone.
`tsc --noEmit` is clean. eslint reports no new findings and prettier is clean
on the changed files.

**Sweep, left as is**

- `hr/dashboard.ts` → `expiringDocuments` → `getHrPolicy` (global client).
  This is reached only when `withinDays` is omitted, and `lifecycleDashboard`
  always passes 60.
- Batched `prisma.$transaction([...])` in `social/replyToComment.ts:141`,
  `calls/[id]/temperature/route.ts:40` and
  `workspaces/[workspaceSlug]/hr/[resource]/route.ts:377` is a different
  form. It sets no `inTenantTx`, so the guard's pinning still applies. Not
  examined further.
- No helper opens a nested `withTx` inside another transaction.
- Local closures called inside transactions (`bookings/route.ts` `lockBooking`,
  `leadEagleMove.ts` `tally`/`owned`/`typeId`, `intake.ts` `timeline`,
  `payroll.ts` `placementOf`) use `tx` or no database at all.

**Left open**

- Nothing stops this mistake at runtime. The tenant guard cannot tell a
  query on `tx` from one on the global client, since both pass through the
  same extension. A guard that throws inside `withTx` for the global client
  needs a way to make that distinction and is worth a spike. The lead-page
  transaction-pressure fix (`fix/lead-page-transaction-pressure`) says to read
  a page's lists in one `withTx`, which will put more code inside
  transactions.
- PROJECT.md's tenancy rule already says "inside `withTx`, query through its
  `tx` only", so it is unchanged.
