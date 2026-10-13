# The lead list gets filter chips, saved views and a board; every lead module gets the calendar; a phone in any format finds its lead

**What.** Part 4C of the Lead Eagle M4/M5/M6 build, stacked on #174
(`feat/lead-eagle-pipeline-stages`). In every lead module (Sales, Real
Estate, Lead Eagle):

- The lead list has filter chips that combine (stage, owner, source with its
  sub-sources, a created or updated date range on the workspace's clock) and a
  sort, all in the URL, and each person's own saved views of it (name, filters,
  sort, columns). M4-19.
- The same list as a board: a column per stage in the pipeline's order, the
  exits grouped after the ladder; a card moves by drag or by its Move menu, and
  a stage that asks for a reason or books a visit or meeting opens the stage
  mini-form first. M4-21.
- The calendar admits every lead module (`/realty/calendar`,
  `/lead-eagle/calendar`, a Calendar tab in both menus) and draws site visits
  beside tasks, follow-ups and calls, on the workspace's clock. M4-22.
- The lead search normalises a typed number and matches the main number and
  every other number on the lead (LeadPhone), with name, company, email and
  reference; Cmd+K (Ctrl+K) offers it in every lead module. OWN-01.2.

**Why.** Audit rows of 11 Oct (owner's brief, 12 Oct):

- M4-19: no per-user saved views and no combined filters in Lead Eagle; the
  Smart Views screen is Sales-only and has no way to save a view; columns were
  the workspace's only. Acceptance: an agent saves "My overdue Bayut leads"
  and reopens it.
- M4-21: no board anywhere. Acceptance: dragging into Dropped asks for the
  reason.
- M4-22: the calendar asserted Sales, so a Lead-Eagle-only workspace was
  refused it; it had no site visits, read the month on the server's clock, and
  placed each entry on the browser's day.
- OWN-01.2: the search matched the main number as typed (`contains`), never
  the other numbers; the list API and the CSV export searched the name only;
  Cmd+K offered "Search leads" only where the plan has Sales. Acceptance:
  "050 123 4567" finds a lead through one of its other numbers stored as
  +971501234567.

**Where** (under `apps/web/src/`)

- `services/leads/leadList.ts` (new): `leadListParams` (the URL), `leadListQuery`
  (scope, named filter, search, chips, closed-out exclusion, sort) for the
  grid, the board and the CSV export; `leadListHref`, `savedViewHref`,
  `LEAD_LIST_VIEW`. The follow-up filters moved here from the leads page.
- `services/leads/createLead.ts`: `leadSearch` (name, company, reference,
  email, numbers); `contactSearch` matches `normalizePhone(q)` against
  `phoneNormalized` and `phones.some.normalized`. Used by the leads page, Smart
  Views, `GET /api/v1/leads`, the export and the assistant.
- `app/(workspace)/[workspaceSlug]/sales/leads/`: `page.tsx` (`?layout=board`,
  the chips, the views), `LeadFilters.tsx`, `LeadViews.tsx`, `LeadBoard.tsx`
  (new), `LeadGrid.tsx` (starts from the server's sort).
- `app/api/v1/leads/views/route.ts` (POST) and `views/[id]/route.ts` (DELETE),
  new: a view is a `SmartView` row with `objectType` `LEAD_LIST`, personal.
- `app/api/v1/leads/export/route.ts`: reads the grid's URL through
  `leadListQuery`.
- `app/(workspace)/[workspaceSlug]/sales/calendar/` (`page.tsx`,
  `CalendarView.tsx`); `realty/calendar/page.tsx` and `lead-eagle/calendar/page.tsx`
  (re-exports, new); `lib/nav/realtyShared.ts` (`calendar` in both shared
  roots); `lib/nav/workspaceNav.ts` (Calendar tabs; `searchTargets`).
- `app/globals.css`: `.lf-lead-bar`, `.lf-lead-filters`, `.lf-views`,
  `.lf-board`, `.lf-cal`.

**Behaviour**

- Leads list (every lead module): a Filters panel (Stage, Owner, Source, Date
  created or updated, From, To, Sort) applies to the URL; each chip in force
  shows with a link that drops it; the named filters (Overdue, SLA breached…)
  keep the chips and the search. List / Board switch. My views: a chip per
  saved view, Save view (a name and the columns to show, the workspace's custom
  fields among them, up to 30) and Delete view on the open one. A view opens
  its own filters, sort and columns; nobody else lists, opens as theirs or
  deletes it (404), and deleting it twice answers 404. Saving and deleting are
  audited. A date that is no day ("2026-00-10", "2026-02-31") drops itself
  from the list and the board; the export answers 422.
- Board: columns in Admin → Lead Stages order, lost and junk stages in an Exits
  group after the ladder; each column shows 20 cards and its whole count, and
  "N more" opens the list of that stage with the same filters. Drag a card, or
  open its "Move to…" (a button per stage; the arrow keys on it move nothing):
  Site Visit Scheduled, Meeting Scheduled and Dropped open "Move to …" and the
  server still refuses the move without its fields (422). At 390 px the
  columns scroll sideways, the page does not.
- Search (the list's box, Cmd+K, `GET /api/v1/leads?q=`, the CSV export, the
  assistant): "050 123 4567", "+971 50 123 4567", "00971501234567" and
  "501234567" find a lead holding +971501234567 as its main or any other number.
  A role that sees numbers masked finds a lead by a whole number only and reads
  it masked. Cmd+K's "Search leads" opens Sales' list, else Real Estate's, else
  Lead Eagle's. The list's box keeps the phone redesign's (#79) placeholder,
  "Search leads", and finds names, phones in any format, emails and references.
- CSV export: answers the URL it was clicked from (the named filter, the
  search, the chips, a saved view's grid columns; not its custom-field ones,
  see Left open), in id order whatever the sort; `overdue_mine` and
  `no_next_action` used to export every lead. Its audit row records the
  filters, the sort and the columns asked for, and whether it was searched,
  never the search text.
- Calendar: Sales, Real Estate and Lead Eagle; site visits and client meetings
  (to the visit's page; not rejected or cancelled ones) beside tasks,
  follow-ups, calls and activities, each in the caller's scope; follow-ups as
  the Follow-ups list reads them (a team lead sees the team's; the caller's own
  open under Mine); events only where the plan has Sales or Real Estate, and
  not under `/lead-eagle/`, which has no Events screen for them to open. Each
  kind is read in date order, the first 300 of the month, and the page says
  so when a kind is cut. The month, each day and each time are the workspace's
  zone: an entry at 01:00 Dubai sits on its Dubai day. Seven columns at 390 px
  (a phone rule had folded the month to two). The legend names what the month
  draws. An activity with no lead no longer links to the Activity Log.

**Decisions taken**

- None by the owner beyond the rows themselves (the brief marks no DECISION
  for this part).
- Design choices, not the owner's:
  - A saved view is a `SmartView` row (`objectType` `LEAD_LIST`, `PERSONAL`):
    no migration, no sharing, no rename (save again, delete the old one).
    `leads:VIEW` is enough to keep one: it changes no lead, and its rows are
    read under the lead scope when it opens. Smart Views (Sales) are unchanged.
  - The chips: owner is the lead's owner (not the second owner), offered from
    the people whose leads the viewer reads (`assignableUsers` at `leads:VIEW`)
    plus Unassigned; a source takes its sub-sources; From and To are whole
    days in the workspace's zone, both inclusive. Sorts: last updated, newest,
    highest score, name; the grid's Follow-up column still sorts the page only.
  - The board is the list page with `?layout=board`, not a route of its own;
    "more" is the list of that stage, not a longer column. Cards show name,
    reference and owner, no number. Drag is the browser's own (no library), so
    a phone moves a card with its Move menu. The Move menu is a `<details>`
    of stage buttons that opens inside the card (a popover would be clipped
    by the board's sideways scroll), not a `<select>`, which moves on an
    arrow key.
  - Under `/lead-eagle/` the calendar leaves events out rather than linking
    them to another module's screen; `/sales/calendar` and `/realty/calendar`
    show them.
  - The calendar keeps its cap of 300 entries a kind and reads each kind in
    date order; past the cap it says so instead of paging.
  - The CSV export keeps id order whatever the grid's sort: it streams in
    keyset pages, and a walk over `updatedAt` (the default sort) would skip or
    repeat a lead edited while the file streams.
  - Cmd+K keeps its palette: "Search leads for …" opens the lead list, which
    shows the matches scoped and masked; no inline results.
  - A role that sees numbers still matches the text as typed (`contains`) as
    well as the normalised whole number.

**Verified.** On the rig's scratch database (104 migrations, none added):

- New: `tests/sales/lead-saved-views.spec.ts` (13), `lead-kanban.spec.ts` (11),
  `lead-search.spec.ts` (13), `lead-calendar.spec.ts` (4); added cases in
  `tests/permission/module-entitlement.spec.ts` (2), `tests/unit/lead-eagle-routes.spec.ts`
  and `realty-routes.spec.ts` (1 each), `workspace-nav.spec.ts` (2, and Calendar
  in Lead Eagle's menu). On the base's source 20 fail: lead-search 10 of 13,
  lead-calendar 4, module-entitlement 2, the unit cases 4. With the base's
  `leads/page.tsx`, `LeadGrid.tsx` and export route in place (this branch's new
  files present) 21 fail: lead-saved-views 12 of 13, lead-kanban 9 of 11. The
  ones that pass on the base are guards: name, email and reference already
  found a lead on the list page, a masked fragment finds nothing, nobody
  searches past their scope, the server's 422 without the mini-form's fields,
  the 404 outside scope, a view needs a name.
- The eight new and touched files together: 782 of 782. The permission, sales,
  tenant, unit and platform directories: 169 files, 3015 passed, 2 skipped, 1
  failed: `tests/unit/lead-named-filters.spec.ts` read the leads page and the
  export for `@/lib/leads/namedFilters`, which they now reach through
  `leadListQuery`; it reads `leadList.ts` for it now and checks both call
  `leadListQuery` (10 of 10). The security and integration directories: 58
  files, 729 of 729. `tsc --noEmit` clean, eslint no errors (12 warnings, all
  older lines), prettier clean.
- Playwright on the rig's dev server: `lead-views-board.spec.ts` (new, 5: drag
  into Meeting Scheduled opens the dialog, refuses empty, books the meeting at
  10:00 Dubai = 06:00 UTC; at 390 px the Move menu into Dropped asks why and
  into Pending asks nothing, no sideways scroll; Filters → URL → Save view →
  reopen → Delete view; Ctrl+K on the dashboard finds the lead by its other
  number typed as +971 …; `/lead-eagle/calendar` shows the meeting), twice,
  the second after the last edit; with `lead-stage-mini-form`, `lead-bulk-stage`, `lead-contact-masking`,
  `every-route` and `workspace-navigation` 24 of 24. `lead-eagle-workspace`
  failed once in a batch (the session was on the sign-in page at 4.8 minutes,
  at its Events plan-page step) and passed alone, 1 of 1.
  Checked by eye at 390 px (light and dark) and 1280 px: board, filters panel,
  save form, the mini-form over the board, the calendar.

**Left open**

- Cmd+K lists no leads itself; it opens the list. Inline results would need a
  search API.
- Saved views cannot be renamed or shared; the Sales Smart Views screen still
  has no way to save one.
- Drag does not work on touch screens; the Move menu does.
- The board runs a query per stage (12 in a Lead Eagle pipeline) and one count.
- A fragment of a number typed in another format than stored (a visible role,
  "050 123" against "+97150123…") finds nothing; whole numbers do.
- The calendar has no API to widen (it is a server page); the assistant's
  `getCalendar` still has no site visits.
- The CSV export has no custom-field columns (as before #172 and since): a
  saved view's `cf:` columns, and a workspace's stored ones, are left out of
  the file. Adding them means honouring each field's `includeInExport` and
  `isSensitive`.
- The owner chip offers active members only. A departed member holds no open
  lead (deactivating hands them on, `handOverOpenWork`), but their won or lost
  leads cannot be picked by owner, and an old link reads "Owner: Someone else".
- A month with more than 300 entries of a kind shows the first 300.
- PROP-02.2 (log a call from the list in three clicks) is another lane's.

**Merge-up with the base, 13 Oct.** The base branch took #172 (requirement and
interest links, custom fields, lead scoring; two migrations) while this was
built. Conflicts: the leads page keeps this change's list query, board and
views, with #172's custom-field columns applied to the grid, a saved view's
columns and the Save view picker; `PROJECT.md`'s Lead Eagle row keeps both
descriptions and the new screen counts. After the merge a saved view dropped a
custom-field column (`cf:<key>`); `POST /api/v1/leads/views` now offers the
workspace's own fields too, and a new case in `lead-saved-views.spec.ts` fails
without that (the grid showed the default columns). On the merged tree (106
migrations): `tsc --noEmit` clean; the four new specs 42 of 42; the permission,
sales, tenant, unit and platform directories 174 files, 3082 passed, 2
skipped, 1 failed on "Unable to start a transaction in the given time"
(`lead-record-scope`, 341 of 341 alone); security and integration 58 files,
729 of 729; E2E `lead-views-board`, `lead-stage-mini-form` and
`lead-bulk-stage` 9 of 9 on a fresh `.next`.

**Review round, 13 Oct.** Fixed:

- The board's Move menu was a `<select>` that moved the lead on change, and a
  closed select changes on an arrow key (Chrome, Edge and Firefox on
  Windows): looking through it moved the lead, with nothing to confirm a stage
  that asks nothing. It is now a disclosure of stage buttons. A new E2E step
  focuses it and presses ArrowDown, ArrowDown, ArrowUp: on the old board one
  PATCH went out (`expect(patches).toEqual([])` failed); now none, and Enter
  opens it and moves the card.
- The calendar drew rejected and cancelled site visits like booked ones, and
  called a client meeting a site visit; it linked events to a Lead Eagle
  Events page that does not exist; it read 300 entries a kind in no order,
  with no word when it cut. Now as in Behaviour above.
- A second DELETE of a saved view answered 200 and audited again (the
  soft-delete guard adds `deletedAt: null` to reads only); now 404.
- A saved view of more than about 400 characters of columns reopened with the
  default columns: `cols` now takes what POST accepts (30 keys of 60).
- "2026-00-10" or "0000-01-01" passed the date check and `dayBounds` threw:
  500 on the list, the board and the export. A date is now a real day.
- The export's audit row held only the named filter; it now holds what was
  asked for. This entry said the export kept the grid's sort; it keeps id
  order, by design (Decisions taken), and says so now.
- Tests that could not fail: the updated-date case passed whichever column
  was filtered (now it tells them apart; with the column forced to
  `createdAt` it fails, "expected [] to deeply equal [ Array(7) ]"); the
  masked-main-number check looked for digits the dashed number never held
  (now it fails when the row is read unmasked, "expected '055-246-5894' to
  contain '•'"). Added cases: the export with `overdue_mine` and `overdue`,
  the assistant's search by another number (both fail with the base's export
  route and assistant), follow-ups without `leads:VIEW` are the caller's own,
  a role without `leads:VIEW` keeps no view (403).

On this branch's source before the fixes 7 of the new cases fail (the no-day
date, the export's audit row, the second delete, 30 columns, cancelled visits, the
cap, events under `/lead-eagle/`). After: `lead-saved-views` 19, `lead-search`
14, `lead-calendar` 8; the nine new and touched spec files 813 of 813; the
permission, sales, tenant, unit and platform directories 174 files, 3093
passed, 2 skipped, none failed; security and integration 58 files, 729 of
729; `tsc --noEmit` clean; eslint no errors; prettier clean. E2E on a fresh
`.next`: `lead-views-board` 5 of 5; `lead-stage-mini-form`, `lead-bulk-stage`
and `every-route` 8 of 8. The board's Move list checked by eye at 390 px
(light and dark) and 1280 px; no sideways page scroll. Refuted: the owner chip
"for a departed agent's leads" (a member is not deactivated while holding open
leads; their closed ones are under Left open); the calendar case's
"Unable to start a transaction" under load (passed alone, and in every run
since).
