# The Lead Eagle board counts what its lists show

**What.** Round 5 of the Lead Eagle build, first part (M3 Dashboard). The
board, which is the Real Estate board under `/lead-eagle/dashboard`, gains
tiles, charts and a leaderboard. Each figure is counted under the scope of
the list it opens, on the workspace's clock, and links to that list:

- Tiles: Unassigned, Untouched, Overdue, Due Today, Callbacks, Meetings
  Scheduled, Meetings Done and Conversion, beside New Leads and Total Leads.
- Charts: Leads by Stage, Leads by Source (each portal its own row), Received
  vs Worked over 14 days, and Follow-ups This Week.
- Calls (made, connected, talk time) and a Leaderboard for the last 7 days.

Branch `feat/lead-eagle-dashboard-tiles`, from `origin/main` fa01771f, with
main fe5ecc75 (#179) merged in. One additive migration,
`20261015100000_lead_dashboard` (108 in all).

**Why.** Audit rows M3-01–M3-05 and M3-09–M3-15 of 11 Oct; the owner added
M3 as round 5 on 12 Oct. Before this change:

- The board had no Unassigned, Untouched, meetings or conversion tiles, no
  funnel, no received-against-worked chart, no follow-up strip, no calls
  figures and no leaderboard.
- "Follow-ups Due" mixed overdue with today's, and "Callbacks" was every
  follow-up due today, meetings included.
- Leads by Source ranked five kinds of source, not portals, and its links
  were not read by the lead list. New Leads and the follow-up tiles opened
  unfiltered lists.
- Today was the server's day, not the workspace's.
- Total Leads counted closed-out leads, which the lead list leaves out.
- `Lead.firstContactedAt` was never written. Every lead read as never
  contacted, so "untouched" and "first contacted that day" had nothing to
  count.

**Where** (under `apps/web/`)

- `src/services/realty/dashboard.ts`: `realtyDashboard` returns each figure as
  `{ value, href }`, plus the funnel, sources, `trend`, `followUpDays`,
  `calls` and `leaderboard`.
  - The lists' scopes are resolved first: `leadScope` with the unassigned
    leads the viewer may claim, and closed-out leads left out (the lead
    list's rule); `workListScope` for follow-ups and tasks; `visibilityWhere`
    for visits and calls.
  - Every read then runs in one `withTx`, one query after another on one
    connection, not as a fan-out of pinned transactions (P2028).
- `src/lib/leads/followUpDue.ts` (new): `followUpDueWhere` reads `due`,
  `date` and `kind` on the workspace's clock. The Follow-ups page, its API
  and the board all use it. Also `isDayKey`, `shiftDay` and `onDay`.
- `src/lib/leads/callLog.ts`:
  - `FOLLOW_UP_KINDS` (Call, Meeting, Site visit, Other).
  - `CONNECTED_CALL_OUTCOMES`, the Calls list's Connected tab, now shared
    with the board.
  - `CONNECTED_LOG_OUTCOMES`, the same in the call log's words.
- `prisma/schema.prisma`, migration `20261015100000_lead_dashboard`:
  - `FollowUpTask.kind` (text, default `CALL`).
  - A backfill of `Lead.firstContactedAt` from each lead's earliest activity
    or call, where it is empty.
- `src/services/leads/touch.ts`: `touchLead` also stamps `firstContactedAt`,
  keeping the earliest touch. `api/v1/cold-data/[id]/convert` stamps it from
  the first cold call it moves onto the lead.
- `src/lib/leads/namedFilters.ts`: two named lead filters.
  - `untouched`: has an owner, never contacted, in an OPEN stage.
  - `won`: in a CONVERSION stage.
- `src/lib/security/visibility.ts`: `mayClaim`, the rule `visibilityWhere`
  already used for unassigned records, exported for the Unassigned tile.
- `sales/follow-ups/page.tsx`, `api/v1/follow-ups/route.ts`: the page and the
  API read `due` on the workspace's clock, plus `date=YYYY-MM-DD` and
  `kind=CALL|MEETING|SITE_VISIT|OTHER`.
  - The API answers 422 for a date that is not a real day.
  - POST takes `kind`. The composer (`FollowUpComposer.tsx`) has a Type select.
- `services/platform/leadEagleMove.ts`: a moved follow-up keeps its kind.
- `realty/dashboard/page.tsx`, `src/app/globals.css` (`.lf-panels`,
  `.lf-bars`, `.lf-pairs`, `.lf-legend`, `.lf-strip`, `.lf-callfigures`,
  `.lf-leaderboard`): the screen, with plain CSS bars in tokens only.
- `dashboard/page.tsx` (Workspace Summary): the Unassigned leads chip counts
  what `/sales/leads?filter=unassigned` lists, and links there.
- `sales/calls/page.tsx`: reads `CONNECTED_CALL_OUTCOMES` from `callLog.ts`.

**Behaviour.** What customers on production see:

- **The Lead Eagle and Real Estate boards.**
  - **Today**: New Leads, Overdue (due before today began), Due Today,
    Callbacks (calls due today) and Site Visits.
  - **Pipeline**: Total Leads, Unassigned (only for a role that may claim a
    lead), Untouched, Meetings Scheduled and Meetings Done (where the
    workspace has those stages), Conversion (won ÷ all), then the visit
    tiles.
  - **Charts and panels**: Leads by Stage in the workspace's order, Leads by
    Source (top 8, then "Other sources"), Received vs Worked (14 days, two
    bars a day), Follow-ups This Week (Overdue, then today and the six days
    after), Calls, and the Leaderboard (top 6).
  - Every tile, bar and day links to its list, filtered:
    - Leads: `?filter=unassigned`, `untouched` or `won`; `?stage=`,
      `?source=` and `?owner=`; and `?from=&to=` for one day. The last four
      are #179's list filters.
    - Follow-ups: `?due=overdue`, `?due=today`, `?due=today&kind=CALL` and
      `?date=`.
    - Calls: `/calls`.
  - An agent at OWN scope sees their own figures and no leaderboard.
  - Real Estate keeps Bookings, Revenue and Top Agents. Lead Eagle shows
    neither.
  - The board's counts run in one read transaction, not a dozen parallel
    ones.
- **Follow-ups (list and API).**
  - Overdue now means due before today began on the workspace's clock, and
    Today means all of today. Before, both were cut at this minute on the
    server's clock, so a 09:00 follow-up moved from Today to Overdue at 09:01.
  - `?date=` and `?kind=` filter the list, shown above it with "Show all".
  - New follow-up has a Type; existing follow-ups are calls.
- **Leads.**
  - A lead's first call, logged activity or provider call stamps when it was
    first contacted. Existing leads get it from their history.
  - So the SLA first-contact check, which until now breached every lead it
    checked, no longer breaches a lead contacted before its deadline.
  - Smart views filtering on First contacted now find leads.
- **Workspace Summary.** Unassigned leads opens the unassigned list. It counts
  what that list shows a viewer: a team role that may not claim a lead no
  longer sees a workspace-wide number.

**Decisions taken**

- DECISION (owner default, to confirm), M3-09: converted = a lead in a
  CONVERSION-category stage (Lead Eagle's Booked). Conversion = won ÷ all the
  viewer's open leads. There is no period selector yet (M3-16), so the
  figure covers all time.
- Design choices, mine, not the owner's:
  - **Callbacks**: open follow-ups of kind CALL due today, by a new
    `FollowUpTask.kind` column. A follow-up had no type, and meetings are
    Tasks. Every existing follow-up is a call reminder (the call log's
    "Follow-up call", the composer, a call's page), so CALL is the default.
  - **Meetings Scheduled and Meetings Done**: leads now in the stages keyed
    `meeting_scheduled` and `meeting_done`. Moving the lead is what agents
    do; the meeting task is rarely closed. Without those stages the tiles
    are hidden.
  - **Untouched**: has an owner, `firstContactedAt` empty, in an OPEN stage.
    `touchLead` now writes the field and the migration fills it from history.
    `lastActivityAt` was not used: it is empty for every lead last worked
    before 19 Sep. The stamp is bookkeeping like `lastActivityAt` and is not
    audited.
  - **Lead figures** count what `/leads` shows. Closed-out leads are left
    out, and unassigned leads count for roles that may claim them.
  - **Sources**: grouped by (source, catalogue entry) as the Source analysis
    report does. A sub-source counts under its top-level source, because the
    list's `source` filter includes sub-sources. A lead with no catalogue
    entry shows under its kind ("Manual") with no link, since no list
    filters on the kind.
  - **Received vs Worked**: leads created that day against leads first
    contacted that day. A day links to that day's received list; the list
    has no first-contacted filter.
  - **The activity period** is the last 7 days, today included.
  - **Calls made**: provider and dialer calls that were placed (not SCHEDULED
    or CANCELLED), plus logged calls (`call_out` and `call_in` activities:
    Log call, cold calls, moved history).
    - Connected: a completed call with an outcome on the Calls list's
      Connected tab, or a logged call whose outcome is Connected, Interested
      or Call back later.
    - Talk time: the sum of both kinds' durations.
    - Logged calls are read with the viewer's `calls` reach on their logger.
  - **The leaderboard** per person:
    - Calls made.
    - Meetings booked: meeting tasks created, not cancelled.
    - Visits completed: by `scheduledAt`.
    - Booked: leads that entered a won stage in the period.
    - Each column comes from its own register's scope, and is left out
      without that register's VIEW.
    - Ordered by calls, then meetings, visits and booked. A name opens that
      person's leads.
    - Hidden for a viewer whose `leads` scope is OWN.
  - **Overdue and Today**: Overdue is "before today began", so a tile and its
    list agree all day. The list and the API changed with the board.

**Verified.** On the ws rig's scratch database (108 migrations; logs
`C:/ymw/logs/r5-3a-*.log`).

New and touched specs:

- `tests/sales/lead-eagle-dashboard.spec.ts` (new, 19 cases).
  - At 12:00 on 15 Oct 2026 in Dubai, for a manager (ORGANIZATION) and two
    OWN agents, with rows placed either side of Dubai's, UTC's and India's
    midnight:
    - Total, New today, Unassigned (none for an agent), Untouched, Overdue,
      Due today and Callbacks (the 14:00 meeting is not one).
    - Meetings and Conversion (1 of 4 = 25% for the agent).
    - Two Bayut leads and one Property Finder lead as two named rows.
    - The funnel in stage order, the leaderboard order (4 calls before 3),
      calls 7 made / 3 connected / 220 s.
    - The 14 days and the 7-day strip.
    - The rendered board with its links, and no Revenue.
  - At the real time, every tile, bar and day opens a list with exactly its
    count, for a manager and an agent: the lead list (named filters, and
    #179's stage, source and date) and the Follow-ups list.
  - The follow-ups API agrees with the list, and a bad date answers 422.
  - POST takes a kind, CALL by default.
  - The Workspace Summary's Unassigned chip counts and opens the same list.
  - A logged call stamps first contact; an earlier one moves it back.
  - The migration's backfill, run on this spec's workspace.
- `tests/sales/cold-call-activity.spec.ts` (one assertion added): a converted
  record's lead is first contacted at its first cold call.
- `tests/tenant/realty-dashboard.spec.ts`: reads `.value`.
- `tests/e2e/lead-eagle-dashboard.spec.ts` (new), in a wizard-made Lead
  Eagle workspace:
  - At 1280 px, every tile and panel shows.
  - Callbacks opens the call due today, not the meeting.
  - At 390 px, light and dark, there is no sideways scroll.
  - Untouched opens the one uncontacted lead; Overdue in the strip opens the
    follow-up from two days ago.

Fail-before, with the new tests and schema and the base's source:

- Against fa01771f (`failbefore2`, `failbefore3`):
  - 16 of the first 17 new cases fail, for example "expected undefined to be
    '2026-10-15'", "Unrecognized key(s) in object: 'kind'", "the chip links
    the unassigned list: expected undefined to be defined".
  - The backfill case passes: it runs the migration, not the source.
  - The cold-call assertion fails: "expected undefined to be 1791893895105".
  - `realty-dashboard` fails on the new shape.
- Against main fe5ecc75, with #179 (`failbefore4`): all 8 cases of the
  drill-down block fail, the two on #179's filters among them ("Cannot read
  properties of undefined (reading 'map')").

After:

- The 7 new, touched and related files (`final`): 92 of 92.
- `tests/permission` and `tests/sales` (`wide1`): 1,727 passed, 2 skipped
  and 4 failed, on "Unable to start a transaction", hook timeouts and a 500.
  The 4 files alone pass, 365 of 365 (`wide1b`).
- `tests/tenant`, `unit` and `platform` without the retention specs
  (`wide2`): 88 files, 1,480 passed, 2 skipped. Retention alone: 5 and 7.
- `tests/security`, `integration` and `identity` (`wide3`): 730 passed, 47
  skipped. 6 files failed: 5 cases, plus hook timeouts and an expired
  transaction under load. Alone, all pass but
  `service-identity-browser`: 5 cases refused as another origin. It fails the
  same 5 on main's source (`sib-base`): the rig's environment.
- `tsc --noEmit` clean on the merged tree (`tsc4`).
- eslint: no errors. Two `no-explicit-any` warnings, both on lines this change
  did not touch.
- prettier clean.

E2E on a fresh `.next`:

- `lead-eagle-dashboard`, `lead-eagle-workspace` and `follow-up-mobile`: 6 of 6
  (`e2e2`).
- `workspace-summary-sample`, three runs:
  - "each attention row opens the view it names" (the chip's new link) and
    "values, sections, links and rows" passed.
  - Each run had one failure outside this change. Twice it was the Workspace
    Summary's own P2028, in its calls and its people counts. Once the page
    met the sign-in page under load.
  - Run 3: 13 of 14.

Screens at 1280 px, and at 390 px in light and dark, were checked by eye.

Fixed after the first look: the week strip took eight columns by the
screen's width and overflowed its panel at 1280 px. It now fits the panel.

**Left open**

- M3-16 to M3-19 (filters, their memory, drill-down for the remaining
  tiles, pre-aggregation) are the second part of round 5.
- The calls list has no date filter and does not list logged calls, so the
  Calls panel opens the whole Calls list. The visit tiles still open the
  unfiltered register (M3-18).
- Leads whose source has no catalogue entry (before #169) cannot be filtered
  by source; their row has no link.
- `firstResponseMins` (the reports' average first response) is still never
  written.
- The SLA check now sees first contact. A lead that was breached wrongly
  stays breached.
- Per-request counting holds until about 250k leads in a workspace (M3-19).
