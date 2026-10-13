# Lead Eagle evidence fixes: chips at 390 px, the Calls clock and Today count, the pinned Call cell, Ctrl K, the calendar

**What.** Seven defects the owner's evidence passes found on Lead Eagle
screens, each fixed where its screens share the code. Branch
`fix/lead-eagle-evidence-defects`, from main at 6ced63d9.

1. **Filter chips at 390 px (M4-19).** With four chips in force (Stage,
   Owner, Source, Created) the leads page was 473 px wide and scrolled
   sideways.
2. **Calls.** Times printed on the server's clock. "Today's Calls" read 0
   after two missed calls that day. An inbound call's Number was the
   workspace's own line, not the caller.
3. **Portal emails.** The phone's top bar read "Inbound email".
4. **The pinned Call cell.** At 1280 and 1440 px the pinned Call / Log call
   cell covered the grid's last columns while their headers ran on beside it.
5. **Call with AI assistance.** A view-only role was offered it, and the Calls
   list's New Call; `/calls/new` refuses that role.
6. **Ctrl K.** The search box and the palette showed the Mac ⌘K on Windows
   and Linux.
7. **Calendar.** A site visit read only "Site visit · project". A busy day drew
   one dot per entry. On `/lead-eagle/calendar` the menu marked Leads.

**Why.** The owner's evidence passes over the tracker rows on a local rig at
main. M4-19 stays Partial until its defect is fixed. The others are defects in
screens the brief's rows touch.

**Where** (under `apps/web/src/`)

- `app/globals.css`: `.lf-visually-hidden` is pinned to its containing block's
  corner (`top: 0; left: 0`). Each chip's hidden "(remove)" sat where it fell,
  past the end of the phone's chip scroller. That scroller is not positioned,
  so it did not clip the text, and the page widened. The fix covers every
  scroller that holds hidden text. The grid's pinned Call header
  (`th.lf-grid__actions`) is pinned with its cells. Both pinned headers
  (Reference and Call) paint above the headers that scroll under them: at
  z-index 1, Reference went under Name.
- `app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx`: the Call header
  carries `lf-grid__actions`.
- `components/workspace/ConfigurableGrid.tsx`, `gridCells.tsx`: every
  configurable list (Calls, Activities, Follow-ups, Accounts and the rest) now
  formats its dates and times in the workspace's time zone
  (`workspaceTimezone(requestCtx())`); before, they used the server's. A
  call's Number and Call button take the other party: the caller on an
  inbound call.
- `app/(workspace)/[workspaceSlug]/sales/calls/page.tsx` (re-exported under
  `/lead-eagle/` and `/realty/`): "Today's Calls" counts the workspace's day
  (`dayBounds(todayKey(zone))`). It counts every call that rang, answered,
  missed or failed, as the daily board counts them; a call that is only booked
  is not counted. Connected stays a completed call with a connected outcome.
  Numbers go through `maskCallNumbers`, which masks the lead's side of the
  call. The page used to mask `recipientNumber`, which on an inbound call is
  the workspace's line. New Call shows only with `calls:CREATE`.
- `app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx`, `LeadDetail.tsx`:
  `canCall` (`calls:CREATE`, which `/calls/new` asks for) gates "Call with AI
  assistance". Phone and Log call are unchanged.
- `lib/usePaletteKey.ts` (new), `components/nav/TopBar.tsx`,
  `CommandPalette.tsx`: the label shows ⌘K on a Mac, iPhone or iPad and Ctrl K
  anywhere else. It uses `useSyncExternalStore`: the server and the hydration
  pass render Ctrl K, then a Mac switches to ⌘K, with no hydration mismatch.
- `lib/integrations/leadSourceLabels.ts` (new), `leadSources.ts`, `TopBar.tsx`:
  the lead sources' names are kept in a client-safe map that
  `LEAD_SOURCES` reads. The top bar's `pageTitle` names
  `/admin/lead-sources/{key}` from that map.
- `app/(workspace)/[workspaceSlug]/sales/calendar/page.tsx`, `CalendarView.tsx`:
  a site visit or meeting names its lead. The name reads as the lead list shows
  it to the role (`applyFieldSecurity`: masked, or left out). A day's cell draws
  at most three dots of a kind, then "+N" for the rest.
- `lib/nav/workspaceNav.ts`: Calendar is its own menu entry in Lead Eagle
  (`le-calendar`) and Real Estate (`realty-calendar`), next after Leads.

**Behaviour.** What customers see differently:

- The leads page at 390 px stays 390 px wide with any number of chips.
- Calls (Sales, Real Estate, Lead Eagle) and the other configurable lists read
  dates and times in the workspace's zone.
- "Today's Calls" includes missed and failed calls and turns over at the
  workspace's midnight, so Connect Rate counts missed calls against it.
- An inbound call shows, and calls back, the caller's number. A role without
  the lead's sensitive fields sees that number masked.
- A role without `calls:CREATE` no longer sees "Call with AI assistance" on a
  lead or New Call on Calls.
- The search box and the palette footer read Ctrl K off a Mac.
- The Portal emails page's phone title reads "Portal emails". Google Ads and
  Property Finder are named as their cards name them.
- The lead grid's pinned Call column has its header pinned above it, and the
  pinned Reference header no longer slides under Name.
- Calendar lines name the visit's lead, and a busy day shows a short row of
  dots plus "+N".
- In the menu, Lead Eagle and Real Estate show Calendar as its own entry. The
  Leads tab row no longer lists it.

**Decisions taken**

- None by the owner: the brief marks no DECISION for these defects.
- Design choices, not the owner's:
  - "Today's Calls" counts COMPLETED, MISSED and FAILED calls (the daily
    board's set for leads called), not SCHEDULED, RINGING or CANCELLED.
  - The workspace zone is applied in the shared grid (`ConfigurableGrid`
    reads it), so all fourteen configurable lists changed, not Calls alone.
  - Calendar becomes its own menu entry, not a tab under Leads. Both Lead
    Eagle and Real Estate change; Sales keeps it under Activities.
  - Call with AI assistance is hidden, not disabled, for a role without
    `calls:CREATE`, as Log call is hidden without `leads:EDIT`.
  - The dot cap is three per kind, with one "+N" for everything not drawn.
  - The Reference header's z-order is fixed with the Call header's. Both are
    the same defect: a pinned body cell whose header did not stay with it.
- Item 8 of the brief (a reopen racing a completion) is not built. When this
  branch started, #184 (`fix/listing-mandate-tenant-read`) was not on main
  (main was 6ced63d9). It merged afterwards as bab4f408.

**Verified.** Every new or changed case below fails on the branch's base
(the source files swapped back to 6ced63d9) and passes on the branch.

- New `tests/sales/lead-eagle-evidence-defects.spec.ts`, 7 cases. The server
  runs on New York's clock and the workspace on Dubai's. On the base all 7
  fail: the Calls time _expected [ …(2) ] to include '10 Mar, 16:30'_ (it read
  08:30); Today's Calls _expected 1 to be 4_; the inbound Number _expected
  [ '+97144000000' ] to deeply equal [ '+971501234567' ]_; the AI call's
  `canCall` _expected undefined to be true_; New Call for the Viewer _expected
  true to be false_ (its `/calls/new` refusal passes on both); the dot cap _to
  have a length of 7 but got 16_; the top-bar title _pageTitle is not a
  function_. On the branch the spec passes 7/7.
- `tests/sales/lead-calendar.spec.ts` (two cases changed, one new): on the
  base, _expected 'Meeting' to be 'Meeting · Calendar lead'_, and the masked
  name is missing. 9/9 on the branch.
- `tests/unit/workspace-nav.spec.ts` (two cases changed): on the base,
  _expected 'realty-clients / Calendar' to be 'realty-calendar / Calendar'_.
  With `lead-calendar`, 344/344 on the branch.
- E2E `tests/e2e/lead-views-board.spec.ts`, 3 new tests. Each failed on the
  base: the four chips _Expected: <= 390, Received: 473_; the pinned header
  _1280: header at 1448.6875, cell at 1039.296875_; Ctrl K _Expected: "Ctrl K",
  Received: "⌘K"_. The pinned-Reference z-order check failed before its CSS
  line: _1280: the Reference header is under another_. With a fresh `.next`
  and a fresh dev server, the touched E2E specs pass 12/12:
  `lead-views-board` 8/8, `lead-call-log` 1/1 and `lead-contact-masking` 3/3.
  `assisted-call` skips without the demo-workspace variables.
- Broad run (`tests/permission`, `tests/sales`, `tests/tenant`, `tests/unit`,
  `tests/security`): 3893/3897 pass, with 2 skipped and 2 failed. Both failures
  were P2028 ("Unable to start a transaction in the given time") under load,
  in `sales/custom-webhook` and `security/platform-user-recovery`; the two
  files pass 28/28 re-run alone. The touched specs, `field-security`,
  `monitoring-conversation-scope`, `css-tokens`, `grid-cells` and the route
  guards pass 828/828 on the final code.
- tsc is clean. eslint reports no errors; its warnings are the `any` casts the
  files already had. prettier is clean on the changed files.
  `changes/PROJECT.md` was already unformatted at the base, in a block this
  change does not touch.
- Seen in the browser at 1440 px and 390 px, light and dark: the chip row
  scrolls inside a 390 px page; the grid's pinned header sits over its cells,
  and scrolled to the end, Follow-up reads whole; Calls shows a missed call in
  Today's Calls on Dubai's clock; the calendar draws three task dots, the two
  visits and "+37", and names both visits' leads; the menu marks Calendar. No
  hydration warnings.

**Left open.**

- Item 8: a follow-up reopen that races a completion still reads `completedAt`
  outside a lock. #184 is on main now (bab4f408), so it can follow the same
  pattern (a conditional update inside the transaction).
- The calendar names a visit's lead, not a contact (`contactId`).
- A date stored as midnight UTC (a date-only value typed into a form) reads a
  day earlier in a workspace west of UTC. No such workspace exists today.
- Other screens that print dates on the server without a zone stay as they
  were: call audits, coaching, an event's meetings.
- While the grid scrolls, the pinned columns cover the columns scrolling
  under them, marked by a 1 px edge. Scrolled to the end, every column is
  whole.
