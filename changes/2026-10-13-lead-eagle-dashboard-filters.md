# The Lead Eagle board filters by period, person, team, source and project, and every figure opens its list

**What.** Round 5 of the Lead Eagle build, second part (M3 Dashboard): audit
rows M3-16, M3-17, M3-18 and M3-19.

- A filter bar at the top of the board: a period (today, the last 7, 30 or 90
  days, or two dates), a person or a team, a source and a project. Every
  figure narrows, the choice is in the URL, and it is remembered per user.
- Every figure under the filters opens a list of exactly what it counted,
  the Calls panel and each leaderboard cell included.
- The board at 100,000 leads, measured: one fix (a date formatter built per
  row), no rollup needed.

Branch `feat/lead-eagle-dashboard-filters`, from `origin/main` 10c585cc
(#185). **Three additive migrations, `20261016120000_call_visit_lead`,
`20261016120100_call_visit_lead_index` and `20261016120200_booking_lead`
(111 in all).**

**Why.** The owner added M3 as round 5 on 12 Oct. Before this change:

- The board had no filters (M3-16, M3-17).
- The Calls panel opened the whole Calls list, which had no date or caller
  filter and no logged calls, so no list showed what "made" counted. A
  leaderboard cell opened nothing; its name opened the person's leads. The
  visit tiles opened the unfiltered register (M3-18).
- At 100,000 leads a manager's board took 3.7 to 6.5 s and could outlast its
  5 s read transaction (M3-19).

**Where** (under `apps/web/`)

- `src/lib/leads/boardFilter.ts` (new): the filters, in one place for the
  board and its lists.
  - `cleanBoardFilter` reads `range`, `from`/`to` (both or neither), `owner`,
    `team`, `source`, `project` from a URL.
  - `scopeBoardFilter` drops a person outside the viewer's `leads` reach
    (`ownerReach`), a team with no one in it, and a source or project the
    workspace does not hold, or a project when the viewer may not read
    projects.
  - `boardWhere` is one register's `where` for the filter (lead, follow-up,
    call, logged call, task, visit, booking). It only narrows, so callers
    merge it with the viewer's scope; `boardListWhere` the same from a list's
    URL.
  - `CALL_TABS`: the Calls list's tabs, each with the logged calls it counts.
  - `rememberedBoardFilter`: the per-user memory.
- `src/services/realty/dashboard.ts`: `realtyDashboard(ctx, now, filter)`
  counts under the filter and returns `filter` (what it applied). Each visit
  tile is a `Tile` with its link. `calls` has `connectedHref`. A leaderboard
  row has `links` (calls, meetings, visits, booked).
- `realty/dashboard/page.tsx`: the filter bar (a GET form folded behind a
  summary line). Its options are only what the viewer may see: the people in
  their reach, teams with one of them in it, top-level sources, and projects
  where they may read projects. Also the redirect to the remembered choice,
  and links on the visit tiles, the Calls figures and the leaderboard cells.
- Lists that now read the board's parameters:
  - `sales/calls/page.tsx`: Placed and Completed tabs (reached from the board)
    and `from`, `to`, `owner`, `team`, `source`, `project`. With `logged=1`,
    a Logged calls table (the latest 100) and an "N placed and M logged"
    line whose M is the full count.
  - `sales/tasks/page.tsx`: `type` and the board's filters.
  - `sales/site-visits/page.tsx`: `status` and the board's filters.
  - `sales/follow-ups/page.tsx`: person, team, source, project.
  - `services/leads/leadList.ts` and `LeadFilters.tsx`: `team`, `project`
    and `date=won` (moved into a won stage in the range), with chips.
- `prisma/schema.prisma`, migrations `20261016120000_call_visit_lead` and
  `20261016120100_call_visit_lead_index`:
  `Call.lead` and `SiteVisit.lead` relations, so the board can filter calls
  and visits by their lead's source and project. The foreign keys are
  not validated against history (`NOT VALID`: new rows are checked) and set
  the lead to null if it is deleted (`ON DELETE SET NULL`). An index on
  each `leadId` serves that lookup: without one, deleting the test
  workspace of 100,000 leads in one statement ran 25 minutes and was rolled
  back. `20261016120200_booking_lead` gives `Booking.lead` the same way
  (its `leadId` index already existed), so bookings follow their lead's
  source.
- `src/services/targets/dailyBoard.ts`: `todayKey` keeps one
  `Intl.DateTimeFormat` per time zone (M3-19, below).
- `src/app/globals.css`: `.lf-boardfilter*`, and links in `.lf-callfigures`
  and the leaderboard.

**Behaviour.** What customers on production see:

- **The Lead Eagle and Real Estate boards.**
  - A Filters line at the top. It reads "All time, everyone" until a filter
    is set, then names what is applied. It opens to Period, From, To,
    Person, Team, Source, Project, Apply and Clear.
  - A period narrows the pipeline tiles, the funnel and the sources to leads
    received in it. It also narrows the visit tiles, the Calls panel and the
    leaderboard (which otherwise cover the last 7 days), and Received vs
    Worked (up to its last 14 days).
  - Today's tiles and the follow-up week keep their own days, and narrow by
    person, team, source and project.
  - The filters stay in the URL. Opened with no filters in the URL, the
    board goes to the last ones this person chose, on any device. Clear
    forgets them.
  - Calls: "made" and "talk time" open the Calls list's Placed tab, and
    "connected" its Connected tab, with the logged calls listed beneath.
  - Leaderboard: each cell opens what it counted. Calls open the Completed
    tab with logged calls; meetings open Tasks (meetings booked, cancelled
    ones left out); visits open the completed site visits; booked opens the
    leads won in the period.
  - The visit tiles open the register filtered: today's, approved or
    completed.
  - An agent at OWN scope sees Period, Source and Project only.
  - Real Estate board only: Bookings, Confirmed Bookings and Top agents
    narrow by person, team, source, project (the booking's) and period
    (booking date); Revenue 7 Days reads the period; Revenue Today stays
    today. Their tiles still open the unfiltered Collections screen.
- **Calls list.** The Placed and Completed tabs exist (not on the tab bar).
  A filtered list keeps its filters across tabs and pages.
- **Lead list.** Team, Project and Won-in-period chips when a board link
  sets them.
- **Every screen that puts a date on the workspace's day** (follow-ups,
  boards, targets) does it faster: the formatter is built once per time
  zone, not once per row.

**Decisions taken.**

- DECISION (owner, 12 Oct): M3 as round 5. M3-19: no rollup when the board's
  p95 is under 1 s at 100,000 leads. Measured below; none built.

Design choices (mine, not the owner's):

- The choice is kept in `User.uiPreferences`, a per-user JSON column the
  schema already had and nothing used, so no new table. The URL is the
  source while it carries filters.
- A period is relative (`range=7d`) when picked from the list, so a
  remembered "last 7 days" moves with the calendar.
- Out-of-reach filters are dropped silently, not refused. The board then
  shows what it would show without them, and its links carry only what it
  applied.
- Project means a lead the project interests (`LeadProject`). Records hung
  on a lead follow that lead, and a site visit counts by its own
  `projectId`. A requirement has no project, so it is not read.
- Calls and site visits gained relations to their lead (with a migration)
  rather than looking up lead ids per filter: at 100,000 leads one source
  is tens of thousands of ids.
- The filter bar is folded at every width, one line naming what is applied,
  rather than open on a desktop and folded on a phone.

**Verified.**

- `tests/sales/lead-eagle-dashboard-filters.spec.ts` (new), 9 cases:
  - A period with a team, and one person, narrow every figure.
  - A source, and a project, narrow every figure.
  - The booking and revenue figures narrow under each filter (review fix).
  - A project is dropped for a viewer who may not read projects (review
    fix).
  - A person or team out of reach, or unknown, is ignored.
  - For a manager and a team lead, under four filter sets, every figure (lead
    tiles, funnel, follow-ups, Calls made and connected, visit tiles, each
    leaderboard cell) equals the rows its linked page renders, and each
    filter set counts something (no 0 = 0 pass).
  - The choice is remembered per user, put in the URL, and cleared.
  - The board fits the connection pool (#180's measure).
- Fail-before, on the base's source: 6 of 7 fail. Examples:
  - "expected 4 to be 1" (the team filter ignored).
  - "Cannot read properties of undefined (reading 'owner')" (no applied
    filter).
  - "expected null to be '/filters-…/lead-eagle/dashboard?range=7d&team=…'"
    (nothing remembered).
  - The connections case passes on both: it is a guard.
  - The two review-fix cases fail on the first commit's source: "expected
    [ 3, 2, 100, 2 ] to deeply equal [ 1, 1, 100, 1 ]" and "expected
    '…' to be undefined".
- `tests/unit/today-key-formatter.spec.ts` (new): `todayKey` builds one
  formatter per time zone; on the base it built 1,001 ("expected 1001 to be
  less than or equal to 1").
- `tests/sales/lead-eagle-dashboard.spec.ts` updated for the new shapes
  (`links`, `connectedHref`, the calls links). It passes with
  `tests/tenant/realty-dashboard.spec.ts` (unchanged) and
  `tests/unit/lead-eagle-routes.spec.ts`: 188 of 188.
- E2E `tests/e2e/lead-eagle-dashboard-filters.spec.ts`, at 1280 and 390 px,
  light and dark:
  - A manager sets the last 7 days, a team and a project, and comes back to
    the same choice.
  - Calls made opens the one logged call it counted.
  - A leaderboard cell opens its calls.
  - Clear forgets the choice.
- **M3-19, measured.** Scratch tenant on this rig's DB, since deleted:
  99,000 live leads (1,000 deleted), 100,000 calls, 50,000 logged calls,
  50,000 follow-ups, 10,000 meetings and 5,000 visits. Machine: i5-1145G7,
  8 threads, shared with two other lanes' E2E runs (CPU 35–97% during the
  runs).
  - Before the fix, a manager's board alone: 3.7–6.5 s. One run outlasted
    the 5 s transaction. About 3 s of each was `todayKey` building an
    `Intl.DateTimeFormat` for each of about 16,000 rows.
  - After it, 5 warm-up runs then 30 timed, p50 / p95 in ms:

    | Viewer               | Board alone | Page, no filter | Page, 7 days + source | Page, 30 days + team + source + project |
    | -------------------- | ----------- | --------------- | --------------------- | --------------------------------------- |
    | ORGANIZATION manager | 576 / 739   | 617 / 771       | 531 / 719             | 429 / 507                               |
    | OWN agent            | 202 / 297   | 249 / 332       | 249 / 337             | 292 / 425                               |

  - A run two minutes earlier, during a load spike, had a manager's board
    alone at p95 1,668 ms. The page measures in that run stayed under 800.
  - The harness is not in the repo: `C:/ymw/m456/scratch/3b/perf-board.spec.ts`
    and `dbtime.mjs`, results in `perf-board-results.json` (the M4-20
    method). The unit check above guards the formatter fix.
  - Every p95 is under 1 s, so M3-19 is met by measurement and no rollup was
    built.
  - When to add one: a manager's unfiltered page grows with the workspace's
    open leads (about 0.6 s p50 at 100,000). Its p95 would pass 1 s at about
    130,000 to 150,000 leads on this machine. Past that, roll up the lead
    counts (total, stages, sources, unassigned, untouched) per owner, stage
    and source, refreshed by the maintenance worker, with live deltas since
    the last refresh.

**Left open.**

- No screen makes teams yet (the E2E seeds one). The Team filter lists the
  teams that exist.
- The Calls list's own tiles (Today's Calls, Total Calls) stay unfiltered.
  The logged-calls table lists the latest 100 (its count is the full
  number); it has no paging.
- The booking and revenue tiles (Real Estate board) narrow but open the
  unfiltered Collections screen: Collections has no filters to receive.
- Saving the remembered choice happens when the board opens with filters in
  its URL, so a shared link replaces the opener's remembered choice (it
  only ever narrows what they see).
- A site visit's project, not its lead's interest, decides the project
  filter for visits.
