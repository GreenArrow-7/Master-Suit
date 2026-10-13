# The lead page no longer asks for more database connections than the pool holds

**What.** The lead page reads the workspace's lists (stages, activity and task
types, sources, custom fields, the project and listing pickers) through one
tenant transaction. It does the same for its follow-ups and done tasks. The
lead timeline (`leadTimeline`) reads its six feeds through one tenant
transaction too. Branch `fix/lead-page-transaction-pressure`.

**Why.** Main at fa01771f (#178) went red: CI run 38360538740,
`tests/e2e/lead-requirement-interest.spec.ts:47`. The lead page read
"Something went wrong on our side" because of Prisma P2028, "Unable to start a
transaction in the given time", at `sales/leads/[id]/page.tsx:141`. On the ev
rig the same error came from `services/leads/timeline.ts:178` and
`services/leads/nextFollowUp.ts:353`. Every tenant query outside `withTx` is a
batched transaction on a pooled connection of its own (`runPinned`,
`src/lib/db.ts`), so a `Promise.all` of N reads asks the pool for N
connections at once.

The pool holds 10 connections. That is node-postgres' default: the pg adapter
does not read the `connection_limit=20` in `DATABASE_URL`. Before #178 the page
already asked for 11 at once. #178 added a second burst that peaked at 12 (the
timeline's eight reads beside six more loaders) and took a view from 20
checkouts to 34. A request that asks for more connections than the pool has
waits behind itself. When other work slows the queue, the wait passes Prisma's
2 s `maxWait`. #178's own head passed CI on the same tree, so the failure
depends on load.

**Where** (under `apps/web/src/`)

- `app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx`: seven list
  reads go into one `withTx(tenantId, (tx) => Promise.all([...]))`, and so do
  the three follow-up and task reads. Lead Eagle and Real Estate re-export this
  page.
- `services/leads/timeline.ts`: the call and inbox scopes, the workspace clock
  and the field rules are read first. Then one `withTx` reads activities, stage
  moves, field edits, assignments, calls and messages. The lead page and
  `GET /api/v1/leads/{id}/timeline` share this.

This is the codebase's existing pattern (`app/(platform)/platform/page.tsx`,
`withPlatformTx((tx) => Promise.all([...]))`). Inside the callback only `tx`
is used: through the global client a query would run on another connection
with no tenant set. The scope reads stay outside the transaction for the same
reason.

**Behaviour.** The page shows the same thing under the same scope and masking
rules. With every card on, one view asks for at most 5 connections at once for
an administrator (main asks for 12) and 8 for a TEAM-scoped viewer (main asks
for 14). It checks out 21 connections instead of 34. The timeline route asks
for 2 or 4 instead of 8, and checks out 6 instead of 11. The timeline's six
reads now run one after another on one connection rather than side by side.

**Verified.**

- New `tests/sales/lead-page-connections.spec.ts`. It wraps pg-pool's
  `connect` and records demand at every checkout (checked out plus waiting),
  so the result does not depend on timing. It renders the lead page as an
  administrator and as a TEAM-scoped viewer, with every card on, and asserts
  the peak is no larger than the pool. It does the same for the timeline route.
  On main it fails with _peak 12 of a pool of 10: expected 12 to be less than
  or equal to 10_. With the page from before #178 the peak is 11.
- On the branch: the new spec passes 2/2. `lead-timeline`, `lead-call-log`,
  `lead-requirement`, `stage-mini-form` and `forms-lead-eagle` pass with it,
  65/65. The permission specs `lead-record-scope`, `lead-task-scope` and
  `field-security` pass 385/386. The one failure was a test fixture's own
  `prisma.call.create` hitting P2028 while the machine was loaded; those cases
  pass 7/7 when re-run alone.
- `tests/sales` and `tests/permission` together pass 1658/1660. The two
  failures were a P2028 in a booking's audit write under load and a
  `seedHierarchy` timeout. Neither file touches this code, and both pass
  63/63 when re-run alone.
- E2E `lead-requirement-interest.spec.ts` passes 5/5. Each run starts from a
  deleted `.next` and a fresh dev server. `lead-call-log.spec.ts` passes 1/1
  the same way. The dev logs from these runs contain no P2028.
- tsc is clean. eslint reports nothing new: the two warnings are the existing
  `as any` casts for StageRail. prettier is clean on the changed files.

**Left open.**

- Other code fans out by the same mechanism and is untouched:
  `services/targets/dailyBoard.ts:137` (11 direct reads) and
  `sales/dashboards/page.tsx:56` (9). There are also eight-read blocks in
  `services/leadership/rollups.ts:609` and `services/meta/config.ts:58`.
- `connection_limit=20` in `DATABASE_URL` (`.env.example`, CI) has no effect
  under the pg adapter, so the pool is 10 everywhere. Setting `max` on
  `PrismaPg` is a sizing decision and is not made here.
