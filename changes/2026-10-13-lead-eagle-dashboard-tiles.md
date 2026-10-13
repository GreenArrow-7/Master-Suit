# The Lead Eagle board counts what its lists show

**What.** Round 5 of the Lead Eagle build, first part (M3 Dashboard). The
board, which is the Real Estate board under `/lead-eagle/dashboard`, gains
tiles, charts and a leaderboard. Each figure is counted under the scope of
the list it opens, on the workspace's clock:

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
- Portal leads from before the source catalogue (12 Oct) named their portal
  only in `sourceDetail`, so no catalogue grouping or source filter found
  them.

**Where** (under `apps/web/`)

- `src/services/realty/dashboard.ts`: `realtyDashboard` returns each figure as
  `{ value, href }`, plus the funnel, sources, `trend` (each day with a
  received and a worked list), `followUpDays`, `calls` and `leaderboard`.
  - The lists' scopes are resolved first: `leadScope` with the unassigned
    leads the viewer may claim, and closed-out leads left out (the lead
    list's rule); `workListScope` for follow-ups and tasks; `visibilityWhere`
    for visits and calls.
  - Every read then runs in one `withTx`, one query after another on one
    connection, not as a fan-out of pinned transactions (P2028).
- `src/lib/leads/followUpDue.ts` (new): `followUpDueWhere` reads `due`,
  `date` and `kind` on the workspace's clock. The Follow-ups page, its API,
  the board, the Sales home and the assistant's follow-up tools all use it.
  Also `isDayKey`, `shiftDay` and `onDay`.
- `src/lib/leads/callLog.ts`:
  - `FOLLOW_UP_KINDS` (Call, Meeting, Site visit, Other).
  - `CONNECTED_CALL_OUTCOMES`, the Calls list's Connected tab, now shared
    with the board.
  - `CONNECTED_LOG_OUTCOMES`, the same in the call log's words.
- `prisma/schema.prisma`, migration `20261015100000_lead_dashboard`:
  - `FollowUpTask.kind` (text, default `CALL`).
  - A backfill of `Lead.firstContactedAt`, where it is empty, from each
    lead's earliest contact: an activity that is not a note, or a call we
    placed or that was answered. Intake's and imports' notes, booked and
    cancelled calls, and missed calls from the lead do not count.
  - A backfill of `Lead.sourceId`, where it is empty, from the key at the
    front of `sourceDetail` (`bayut:…`, `facebook:…` → Meta), except for
    referrals and hand-made leads.
- `src/services/leads/touch.ts`: `touchLead` stamps `firstContactedAt`, the
  earliest contact winning, only when the touch `contacted` the lead.
  `reachedOut(call)` and `NOTE_ACTIVITY` say which calls and activities do.
  - `api/v1/activities`: a note is not contact.
  - `api/v1/calls` (POST): a booked call is not contact.
  - `api/v1/calls/[id]` (PATCH): contact once the call was placed or
    answered, not while booked or when cancelled.
  - The call log and a provider's completed call are contact, as before.
  - `api/v1/cold-data/[id]/convert` stamps it from the first cold call it
    moves onto the lead.
- `src/lib/leads/namedFilters.ts`: two named lead filters.
  - `untouched`: has an owner, never contacted, in an OPEN stage.
  - `won`: in a CONVERSION stage.
- `sales/leads/page.tsx`, `LeadFilters.tsx`, `services/leads/leadList.ts`:
  the Untouched and Won chips; a date range on First contacted
  (`?date=contacted`), which the Worked bars open.
- `src/lib/security/visibility.ts`: `mayClaim`, the rule `visibilityWhere`
  already used for unassigned records, exported for the Unassigned tile.
- `sales/follow-ups/page.tsx`, `api/v1/follow-ups/route.ts`: the page and the
  API read `due` on the workspace's clock, plus `date=YYYY-MM-DD` and
  `kind=CALL|MEETING|SITE_VISIT|OTHER`.
  - The API answers 422 for a date that is not a real day.
  - POST takes `kind`. The composer (`FollowUpComposer.tsx`) has a Type select.
- `sales/page.tsx` (Sales home) and `lib/ai/assistant/tools.ts`
  (`getMyDay`, `getFollowUps`): overdue and today's follow-ups counted
  through `followUpDueWhere`, as the list they link reads them.
- `services/platform/leadEagleMove.ts`: a moved follow-up keeps its kind; a
  moved lead takes the catalogue entry its source names ("Portal / Bayut" is
  Bayut) and is first contacted at its earliest moved call, email or meeting.
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
    workspace has those stages), Conversion, then the visit tiles.
  - **Charts and panels**: Leads by Stage in the workspace's order, Leads by
    Source (top 8, then "Other sources"), Received vs Worked (14 days, two
    bars a day), Follow-ups This Week (Overdue, then today and the six days
    after), Calls, and the Leaderboard (top 6).
  - Each tile, bar and day opens its list, filtered:
    - Leads: `?filter=unassigned`, `untouched` or `won`; `?stage=` and
      `?source=`; `?from=&to=` for a day's received leads and
      `?date=contacted&from=&to=` for its worked ones.
    - Follow-ups: `?due=overdue`, `?due=today`, `?due=today&kind=CALL` and
      `?date=`.
  - Not filtered yet (M3-18): the Calls panel opens the whole Calls list,
    which has no date filter and does not list logged calls; a leaderboard
    name opens that person's leads, not the calls or visits counted.
  - An agent at OWN scope sees their own figures and no leaderboard.
  - Real Estate keeps Bookings, Revenue and Top Agents. Lead Eagle shows
    neither.
  - The board's counts run in one read transaction, not a dozen parallel
    ones.
- **Follow-ups (list and API).**
  - Overdue now means due before today began on the workspace's clock, and
    Today means all of today. Before, both were cut at this minute on the
    server's clock, so a 09:00 follow-up moved from Today to Overdue at 09:01.
  - The Sales home's "overdue" and "due today" figures and the assistant's
    overdue and today's follow-ups count the same way, so each figure
    matches the list it opens.
  - `?date=` and `?kind=` filter the list, shown above it with "Show all".
  - New follow-up has a Type; existing follow-ups are calls.
- **Leads.**
  - A lead is first contacted when a call to it is placed (or a call from it
    answered), a call is logged, or an activity other than a note is logged.
    Booking a call, cancelling it, writing a note and an enquiry's own note
    are not contact. Existing leads get it from that history.
  - So the SLA first-contact check, which until now breached every lead it
    checked, no longer breaches a lead contacted before its deadline; a lead
    with only a call booked still breaches.
  - Smart views filtering on First contacted now find leads, and the lead
    list filters a date range on it.
  - The lead list has Untouched and Won chips.
  - A portal lead from before 12 Oct now carries its portal's catalogue
    entry, so the source filter and the board find it. A lead moved from the
    standalone shows its catalogue source (Bayut) rather than the
    standalone's text ("Portal / Bayut"); the text stays in `sourceDetail`.
- **Workspace Summary.** Unassigned leads opens the unassigned list. It counts
  what that list shows a viewer: closed-out leads are left out, and a team
  role that may not claim a lead no longer sees a workspace-wide number.

**Decisions taken**

- DECISION (owner default, to confirm), M3-09: converted = a lead in a
  CONVERSION-category stage (Lead Eagle's Booked). Conversion = won ÷ every
  lead in the viewer's scope except closed-out ones (invalid, duplicate,
  archived); lost leads are in the denominator. The owner's default said
  "for the period": there is no period selector until M3-16, so the figure
  covers all time. Both parts are for the owner to confirm.
- Design choices, mine, not the owner's:
  - **Callbacks**: open follow-ups of kind CALL due today, by a new
    `FollowUpTask.kind` column. A follow-up had no type, and meetings are
    Tasks. Every existing follow-up is a call reminder (the call log's
    "Follow-up call", the composer, a call's page), so CALL is the default.
  - **Meetings Scheduled and Meetings Done**: leads now in the stages keyed
    `meeting_scheduled` and `meeting_done`. Moving the lead is what agents
    do; the meeting task is rarely closed. Without those stages the tiles
    are hidden.
  - **First contact**: a call placed by us (any status but booked or
    cancelled: a no-answer dial is an attempt), a call from the lead that
    was answered, a logged call, or any other activity that is not a note
    (an email, a meeting). Notes record, they contact nobody. Contact made
    before the lead was entered (a cold call, a call logged for last week)
    keeps its own time.
  - **Untouched**: has an owner, `firstContactedAt` empty, in an OPEN stage.
    `lastActivityAt` was not used: it is empty for every lead last worked
    before 19 Sep. The stamp is bookkeeping like `lastActivityAt` and is not
    audited.
  - **Lead figures** count what `/leads` shows. Closed-out leads are left
    out, and unassigned leads count for roles that may claim them.
  - **Sources**: grouped by (source, catalogue entry) as the Source analysis
    report does. A sub-source counts under its top-level source, because the
    list's `source` filter includes sub-sources. Leads that name their portal
    only in `sourceDetail` get its entry from the migration, so the board and
    the filter agree. A lead with no catalogue entry shows under its kind
    ("Manual") with no link, since no list filters on the kind.
  - **Received vs Worked**: leads created that day against leads first
    contacted that day; each bar opens its own day's list.
  - **The activity period** is the last 7 days, today included.
  - **Calls**:
    - Made: provider and dialer calls that were placed (not SCHEDULED or
      CANCELLED), in either direction, plus logged calls (`call_out` and
      `call_in` activities: Log call, cold calls, moved history). An
      inbound call taken counts as a call made.
    - Connected: a completed call with an outcome on the Calls list's
      Connected tab, or a logged call whose outcome is Connected, Interested
      or Call back later. A logged "Not interested" is not connected, as
      NOT_INTERESTED is not on the Calls list's Connected tab.
    - Talk time: the sum of both kinds' durations.
    - Logged calls are read with the viewer's `calls` reach on their logger.
  - **The leaderboard** per person:
    - Calls: completed calls and logged calls (the row's "completed/logged");
      a missed or failed dial is not one.
    - Meetings booked: meeting tasks created, not cancelled.
    - Visits completed: by `scheduledAt`.
    - Booked: leads that entered a won stage in the period.
    - Each column comes from its own register's scope, and is withheld
      (not zero) without that register's VIEW.
    - Ordered by calls, then meetings, visits and booked; the top 6. A name
      opens that person's leads.
    - Hidden for a viewer whose `leads` scope is OWN.
  - **Overdue and Today**: Overdue is "before today began", so a tile and its
    list agree all day. The list, the API, the Sales home and the assistant
    changed with the board.

**Verified.** On the ws rig's scratch database (108 migrations; logs
`C:/ymw/logs/r5-3a-*.log` and, after review, `r5-3b-*.log`).

New and touched specs:

- `tests/sales/lead-eagle-dashboard.spec.ts` (new, 24 cases).
  - At 12:00 on 15 Oct 2026 in Dubai, for a manager (ORGANIZATION), two OWN
    agents and a lead-only viewer, with rows placed either side of Dubai's,
    UTC's and India's midnight:
    - Total, New today, Unassigned (none for an agent), Untouched, Overdue,
      Due today and Callbacks (the 14:00 meeting is not one).
    - Meetings and Conversion (1 of 4 = 25% for the agent).
    - Two Bayut leads and one Property Finder lead as two named rows.
    - The funnel in stage order (stages created out of order), the
      leaderboard (4 calls before 2; Amal's missed dial not counted; columns
      withheld without calls, tasks or visits), calls 7 made / 3 connected /
      220 s.
    - The 14 days and the 7-day strip.
    - The rendered board with its links, and no Revenue.
  - At the real time, for a manager, an OWN agent and a TEAM lead who may not
    claim: every tile, bar and day (received and worked) opens a list with
    exactly its count; the Untouched and Won chips are lit; the leaderboard
    ranks only the viewer's reach.
  - The follow-ups API agrees with the list, and a bad date answers 422.
  - POST takes a kind, CALL by default.
  - The Workspace Summary's Unassigned chip counts and opens the same list,
    leaves out an unassigned duplicate, and is absent for the TEAM lead.
  - The Sales home's overdue and today figures equal the lists they open.
  - A logged call stamps first contact; an earlier one moves it back.
    Booking a call, a note and cancelling the call leave the lead untouched;
    completing a call stamps it; a lead with only a call booked breaches its
    SLA.
  - The migration's backfills, run on this spec's workspace: first contact
    from an outbound dial, not from notes (an intake lead's own and an
    import's), a booked, a cancelled or a missed inbound call; portal keys
    to catalogue entries, not referrals or hand-made leads; the board then
    names them.
  - The leaderboard keeps the top six of seven.
- `tests/platform/lead-eagle-move.spec.ts`: a moved lead's catalogue entry,
  first contact and follow-up kinds; its page shows Bayut and the campaign.
- `tests/sales/cold-call-activity.spec.ts` (one assertion added): a converted
  record's lead is first contacted at its first cold call.
- `tests/tenant/realty-dashboard.spec.ts`: reads `.value`.
- `tests/e2e/lead-eagle-dashboard.spec.ts` (new), in a wizard-made Lead
  Eagle workspace:
  - At 1280 px, every tile and panel shows.
  - Unassigned opens the one unowned lead.
  - Callbacks opens the call due today, not the meeting.
  - At 390 px, light and dark, there is no sideways scroll.
  - Untouched opens the one uncontacted lead with its chip lit; Overdue in
    the strip opens the follow-up from two days ago.

Fail-before, with the new tests and schema and the base's source:

- Against fa01771f (`failbefore2`, `failbefore3`):
  - 16 of the first 17 new cases fail, for example "expected undefined to be
    '2026-10-15'", "Unrecognized key(s) in object: 'kind'", "the chip links
    the unassigned list: expected undefined to be defined".
  - The cold-call assertion fails: "expected undefined to be 1791893895105".
  - `realty-dashboard` fails on the new shape.
- Against main fe5ecc75, with #179 (`failbefore4`): all 8 cases of the
  drill-down block fail, the two on #179's filters among them ("Cannot read
  properties of undefined (reading 'map')").
- After review, against this branch before the fixes (014a4a20's source,
  `r5-3b-failbefore1`): 14 cases fail on their own assertions, for example
  the backfill "expected '2026-09-20T08:00:00.000Z' to be
  '2026-09-28T08:00:00.000Z'", booking a call "expected
  '2026-10-13T14:43:48.576Z' to be null", the Sales home
  "/follow-ups?view=mine&due=overdue: expected 2 to be 1", the chip
  "expected 'List' to be 'Untouched'", the leaderboard (Amal 3 for 2), the
  Worked links ("expected 7 to be +0"), and the move tool's missing
  catalogue entry.
- The Workspace Summary chip on fe5ecc75's counting (`r5-3b-failbefore3`):
  "expected 2 to be 1".

After (final tree, `r5-3b-*`):

- The new, touched and related files (`related`): 14 files, 138 of 138 —
  the board, move, realty-dashboard, cold-call, lead-touch, activity-replay,
  audit-trail, import, timeline, unknown-caller, named-filters, saved-views,
  call-log and activity-scope specs.
- `tests/permission` and `tests/sales` (`wide1`): 95 files, 1,734 passed, 4
  skipped. One file, `daily-board`, timed out in its setup hook under load;
  alone it passes, 4 of 4 (`wide1b`).
- `tests/tenant`, `unit` and `platform` without the retention specs
  (`wide2`): 88 files, 1,480 passed, 2 skipped. Retention alone: 5 of 5 and 7
  of 7 (`ret1`, `ret2`).
- `tests/security`, `integration` and `identity` (`wide3`): 777 passed, 5
  failed, all five in `service-identity-browser` ("request came from another
  origin"), which fails the same 5 on main's source (`r5-3a-sib-base`): the
  rig's environment.
- `tsc --noEmit` clean (`r5-3b-tsc`, EXIT=0).
- eslint: no errors. Five `no-explicit-any` warnings, all on lines this
  change did not touch.
- prettier clean, this entry included.

E2E on a fresh `.next` (dev server on 3400, stopped afterwards):

- `lead-eagle-dashboard`, `lead-eagle-workspace`, `follow-up-mobile` and
  `lead-views-board` (`r5-3b-e2e1`): 10 passed, 1 failed, the new chip
  assertion, whose locator also matched the lit List layout chip. Scoped to
  the Saved views chips, `lead-eagle-dashboard` passes (`r5-3b-e2e2`).
- Before review (`r5-3a-e2e3`–`e2e5`): `workspace-summary-sample`, three
  runs, each with one failure outside this change (its own P2028 twice, the
  sign-in page under load once); run 3, 13 of 14.

Screens at 1280 px, and at 390 px in light and dark, were checked by eye,
with each Received vs Worked bar its own link.

Fixed after the first look: the week strip took eight columns by the
screen's width and overflowed its panel at 1280 px. It now fits the panel.

**Left open**

- M3-16 to M3-19 (filters, their memory, drill-down for the remaining
  tiles, pre-aggregation) are the second part of round 5. In particular
  (M3-18): the Calls list has no date filter and does not list logged calls,
  so the Calls panel opens the whole Calls list; a leaderboard cell opens no
  list of what it counted; the visit tiles open the unfiltered register.
- Leads with no catalogue entry and no portal key in `sourceDetail` cannot
  be filtered by source; their row has no link. Cold-data conversions carry
  no catalogue entry (`data:` detail) and show as "Import".
- The Follow-ups list shows the first 100 rows (its header says "First
  100"), so a tile above 100 opens a capped list.
- `firstResponseMins` (the reports' average first response) is still never
  written.
- The SLA check now sees first contact. A lead that was breached wrongly
  stays breached.
- Per-request counting holds until about 250k leads in a workspace (M3-19).
