# M7 tail — lead allocation, requests and cross-segment routing

The three items left over from M7. Almost no new schema: leads already have an
owner, `LeadAssignmentHistory` already records who moved what and why, and
`User` already carries `dailyLeadQuota`, `weeklyLeadQuota`, `monthlyLeadQuota`
and `activeLeadCapacity`.

**Those four columns had never been read by anything.** `DistributionRule`
advertises `respectQuotas` and `respectCapacity`, and `assignLead` ignored both,
so a workspace could configure a limit and watch it do nothing. The work here is
enforcement. The only new table is an agent asking for more.

## Headroom

`headroom()` answers "how much more can this person be given". Four limits, and
the smallest wins — three are about how fast leads arrive, `activeLeadCapacity`
is about how many they can hold at once.

**No quota set means no limit, not zero.** Defaulting an unset quota to zero
would stop every allocation in a workspace that never configured one, so
`available` is `null` and the caller treats that as unbounded.

Being marked unavailable or on leave zeroes it. That is not a quota, but handing
somebody work while they are away is the same mistake with a friendlier name.

## Allocation

`allocate()` fills people in the order given, each up to their own headroom,
until the requested count or the pool runs out.

It returns **what actually happened** rather than a boolean, because "you asked
for 200 and got 60" is the interesting case:

```ts
{ allocated: [{ userId, leadIds }], total, skipped: [{ userId, reason }], poolExhausted }
```

An allocation that quietly does less than asked looks like an empty pool when it
was really a quota, so the difference is always named.

### The claim is raw SQL, deliberately

```sql
WITH picked AS (
  SELECT l."id" FROM "Lead" l JOIN "LeadStage" s ON s."id" = l."stageId"
  WHERE … ORDER BY l."score" DESC, l."createdAt" ASC
  LIMIT $take FOR UPDATE OF l SKIP LOCKED
)
UPDATE "Lead" SET "ownerId" = $user … WHERE "id" IN (SELECT "id" FROM picked)
RETURNING "id"
```

The select and the update are one statement so nothing can happen between them.
`SKIP LOCKED` means two simultaneous allocations **split** the pool rather than
one blocking and then handing out leads the other already gave away — the same
pattern the dialer uses to claim a contact, and what M2's acceptance criterion
demands of claiming.

There is a test that runs two allocations concurrently and asserts no lead
appears in both results.

Best leads first: `score DESC, createdAt ASC`. A pool ordered only by age hands
out the stalest leads first, which is how the good ones rot at the bottom.

## Requests

An agent asks, a leader decides. **Approving allocates there and then** and
records how many actually moved — a request reading `APPROVED` with nothing
attached is indistinguishable from one nobody has looked at, which the database
refuses:

```sql
CHECK (("status" = 'APPROVED') = ("allocatedCount" IS NOT NULL))
```

- **One open request per person**, by partial unique index. A queue of five
  "I need more leads" from the same agent is noise a leader has to triage, and
  approving two of them allocates twice.
- Only the asker may withdraw their own.
- Turning one down needs a reason.
- Deciding is a **compare-and-swap on PENDING**, so two leaders approving at the
  same moment cannot both hand leads over; the loser is told to reload.
- The pending queue carries each asker's headroom, because approving 200 for
  somebody who can take 3 and then wondering why is the thing it prevents.

Note that `allocate` cannot run inside the request's transaction — it opens its
own per-user transactions to take the SKIP LOCKED claim, and nesting would hold
one connection while asking for another.

**There is no four-eyes control here**, unlike payouts. It is not the same risk:
a leader who can approve can already allocate directly, so self-approval is a
roundabout way of doing what they may do anyway — and the quota still caps them.
The quota is the control, not the approval.

## Cross-segment routing

A segment here is a **team**. There is no product or segment table — `Lead`
carries a dangling `productInterestId` with nothing behind it — so the
organisational boundary is the real one.

`routeLeads()` always carries a reason and always writes a history row naming
who moved it, because crossing a team boundary is not the same as reassigning
inside one.

**Routing to a team clears the owner**, putting the lead back in that team's
pool for their next allocation. Picking somebody in the destination team would
be guessing at their workload from outside it.

## Permissions

One module, `allocation`. `VIEW` and `CREATE` are derived from `leads:VIEW` —
anybody who works leads may ask for more. `APPROVE` is derived from
`leads:ASSIGN`, so handing work out follows already being allowed to hand work
out.

## Checks

`tests/sales/allocation.spec.ts` (23): unset quota meaning unbounded, the
smallest limit winning, quotas counting down as leads move, unavailability
zeroing headroom, permission gates on allocating and routing, history rows for
every lead moved, stopping at a quota and naming it, reporting an exhausted
pool, spilling to the next person, **two concurrent allocations never sharing a
lead**, tenant isolation, one open request at a time, withdrawal by the asker
only, allocating on approval, recording the shortfall, requiring a rejection
reason, refusing a second decision, and routing clearing the owner.

```
npx vitest run tests/sales/allocation.spec.ts
```

## Not built

- **Scheduled or automatic allocation.** This is a leader pressing a button.
  Wiring it to a BullMQ repeatable job is easy once somebody wants it.
- **The other `DistributionMethod` values.** `assignLead` still implements only
  `ROUND_ROBIN`; that comment and that gap are unchanged. Bulk allocation does
  not go through `DistributionRule` at all — it is manual by definition, and
  records `MANAGER_SELECTED`.
- **Reallocating already-owned leads in bulk.** `routeLeads` moves specific
  leads by id; there is no "take 50 back off whoever is sitting on them".
- **A UI for allocating and deciding.** The page shows the pool, the queue and
  everybody's headroom; the actions are API-only so far.
