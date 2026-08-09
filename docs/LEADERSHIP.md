# M10 — Team & Leadership

## What this module is, and is not

M10 asks for eight things. Seven of them are arithmetic over data other modules
already record, and building new tables for them would have created a second
copy of numbers that must agree with the first.

| M10 asks for | Built from |
|---|---|
| Funnel | `LeadStage` + `LeadStageHistory` (M2) |
| Conversion rates | Leads → opportunities → bookings (M2, M9) |
| Activity compliance | `EmployeeTarget` + `TargetProgress` (existing) |
| Team summary | The subtree helper the permission system already uses |
| Top/bottom performer boards | Bookings, leads, activities |
| Team interaction feed | `Activity` (M2) |
| Missed-interaction chasing queue | `Lead.nextFollowUpAt` + `slaState` |
| Target setting and tracking | `EmployeeTarget` — already had schema and a route |
| P&L rollups by team and region | Bookings + commissions (M9) + payroll (HR) |

**Performance reviews were deliberately not built.** HR already has
`HrReviewCycle`, `HrReview`, `HrReviewCompetencyScore`, `HrGoal` and `HrPip`. A
second review system living in Sales is precisely the duplicate the spec's §39
exists to prevent, and two review records for one person is worse than one in a
slightly inconvenient place.

So the whole module is **one schema change, two services, one route, one page**.

## The one schema change

`Booking` gained `teamId`, `branchId` and `regionId`, copied from the agent's
record when the sale is **confirmed**.

Reading the agent's *current* team instead would mean that the moment somebody
transfers, last quarter's revenue moves to a team that did not earn it — a
closed period silently restated. That is the same failure the frozen commission
slab prevents in M9, and it is pinned by a test that moves an agent between
teams and asserts the revenue stays put.

The columns are nullable and **not** backfilled from current placement, because
guessing is the failure being prevented. Bookings confirmed before this
migration report as `Unassigned`, and the P&L says so out loud rather than
quietly attributing them.

No new permission module: a leader reading their own subtree is `reports:VIEW`,
which already exists and already carries the scope saying how far down the tree
they see.

## Scoping

`subtree(ctx)` reads the scope off `reports:VIEW` and returns the user ids the
caller may be shown. **An empty list means the whole workspace**, not nobody —
that is what ORGANIZATION scope resolves to.

Every rollup takes that list explicitly rather than taking a `Ctx` and
re-deriving it, so the decision is made once and is visible at each call site.
The route and the page each resolve it a single time and hand the same list to
every panel, so two panels cannot end up describing different teams — or, since
the date range is passed the same way, different fortnights.

## Things that deliberately answer "unknown"

- **A rate with no denominator is `null`, not `0%`.** A team given no leads did
  not fail at anything, and `0%` on a dashboard reads as failure.
- **A margin missing a cost line is `null`, not a number.** Agency fee minus
  commission looks like profit right up until you remember nobody paid the staff
  out of it. When payroll is unavailable — HRMS not entitled, or no run for the
  period — margin is `null` and the reason is listed in `caveats`.
- **A second currency is excluded, not converted.** Adding dirhams to rupees
  produces a margin that describes nothing. The minority currency is dropped and
  named in `caveats`.
- Bookings with no agency fee, and bookings with no recorded placement, are both
  counted and named. An unexplained margin is worse than a missing one.

## Two bugs the live data found

**"Qualified" was measuring the wrong thing.** The rate was computed as "stage
category is not OPEN", which counts `TERMINAL_NEGATIVE` and `TERMINAL_JUNK` —
so every junked lead flattered the funnel. It now counts `CONVERSION` only.

**And then the name was wrong.** In a real workspace the stage *named* Qualified
is categorised `OPEN`; only Converted carries `CONVERSION`. A field called
`leadToQualified` reading the conversion category is a metric that lies, so it
is `leadToConverted`.

## The funnel reports both directions

`open` is a snapshot — what is sitting at each stage now. `entered` counts
arrivals during the period, from `LeadStageHistory`. Reporting only the snapshot
is how a team with a large stalled pipeline looks busy: nothing moved, but
nothing left either.

## The chasing queue

Built from the follow-up date rather than from a task list. A lead with no task
at all is the one most likely to be forgotten, and a queue that only shows
overdue *tasks* cannot see it. Restricted to `OPEN` stages — chasing a converted
client is noise — and sorted oldest first, because the point of a queue is that
somebody works down it.

## Checks

`tests/sales/leadership.spec.ts` (16): the funnel's two directions, a rate with
no denominator, a cancelled sale not counting as a conversion, the same person
not appearing top and bottom of a one-person board, revenue and volume ranking
differently, subtree restriction, target attainment, the chasing queue's order
and its exclusion of converted leads, the placement freeze surviving a transfer,
clawbacks netting off commission cost, margin reported as unknown, caveats
naming what was excluded, currency exclusion, group names resolved, and tenant
isolation.

```
npx vitest run tests/sales/leadership.spec.ts
```

## Not built

- **A Playwright happy path.** §7 asks for one per module; this module has none
  yet.
- **CSV export of the leadership rollups.** §4 wants every list exportable. The
  `/api/v1/leadership` route returns JSON only. The report menu *does* export —
  see below.

## The report menu

`/sales/reports` was a menu of ten cards linking to `?report=…` with nothing
handling the parameter, and to a path missing the workspace slug — so it
advertised ten reports and delivered a 404 twice over. All ten are now answered
from data these modules already record, in `src/services/leadership/reports.ts`,
and exported as CSV from `/api/v1/reports?format=csv`.

Every report returns the same `{ columns, rows }` shape deliberately: ten
bespoke renderers is ten places to get alignment, empty states and CSV escaping
subtly different.
- **Region and branch P&L are implemented but unexercised** — the demo workspace
  has no regions or branches configured, so only the team grouping has been run
  against real data.
