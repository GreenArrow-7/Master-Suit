# One-step call log from the lead list; the lead's whole timeline, its done follow-ups and its matching stock

**What.** Lead Eagle part 4D, first half, for every lead module. It is
stacked on #172 (lead requirement, interest links, custom fields, scoring).

- **Call log.** Each lead-list row, its phone card and the lead page have
  Log call, wherever the viewer may edit that lead. One dialog takes what the call found, a note, the minutes and
  the next follow-up, and sends them as one POST. The follow-up defaults to
  10:00 tomorrow on the workspace's clock.
  - Each row with a visible number also has Call (`tel:`). Back from the
    call, the dialog opens for that lead, here and from Phone or another of
    its numbers on the lead page.
  - From the list, a logged call with a due follow-up takes three clicks:
    Log call, the outcome, Log call.
- **Timeline.** The lead's Timeline is one feed, newest first, 30 at a time
  with Show older. It holds logged activity, stage moves, field edits from
  the audit log, assignments, calls placed through the workspace's provider,
  and messages, those of a thread from before it was linked to the lead
  included. Each entry is typed, names who did it, and is dated on the
  workspace's clock.
- **Done follow-ups.** The Tasks tab lists the lead's open follow-ups beside
  its open tasks. Under them, Done lists the last 10 of either that were
  completed, with when.
- **Matching stock.** The Overview has a Matching stock card under the
  Requirement card. It lists the live listings the open requirement matches
  and links to the requirement's match list.

No migration. No row is rewritten.

**Why.** The Lead Eagle gap audit of 11 Oct, rows PROP-02.2, M4-27, M4-12,
M4-46, M4-47 and M4-48, part of the owner's brief "Build to completion: Lead
Eagle M4 Leads, M5 Cold data, M6 Lead intake". Before this change:

- Logging a call and booking the next follow-up took six clicks or more, on
  two tabs of the lead page. Nothing asked for the outcome after a `tel:`
  call.
- The timeline showed logged activity and stage moves only. Field edits,
  assignments, calls and messages were not on it (four of the owner's seven
  kinds), and it read the browser's clock.
- A completed task left the lead page. A follow-up never showed on it, open
  or done, except as the next follow-up date.
- Listings matching the lead were one screen away, on the requirement's page.

**Where** (under `apps/web/`)

- `src/app/api/v1/leads/[id]/call-log/route.ts` (new): `POST`.
  - `leads:EDIT`, `LEAD_MODULES`; `assertLeadInScope` answers 404 outside the caller's scope.
  - One `withTx` writes an outbound-call Activity (the `call_out` type, upserted as the cold-call log does) with the outcome, note, minutes and `occurredAt`.
  - It moves the score as #172's activity path does (`scoreActivity`).
  - When given, it writes the caller's FollowUpTask, "Follow-up call", through `withRecompute`, so the lead's next follow-up date moves with it.
  - An audit row for each, in the transaction.
  - `followUpAt` is `YYYY-MM-DDTHH:mm` on the workspace's clock (`dayBounds` plus the time).
  - `requestKey` replays a repeated send rather than doubling it (`findReplay`, `recordOutcome`). The dialog makes one key when it opens, so pressing Log call again after an error replays.
- `src/lib/leads/callLog.ts` (new): the eight outcomes, the follow-up's title, and `tomorrowAtTen`.
- `src/app/(workspace)/[workspaceSlug]/sales/leads/CallLogDialog.tsx` (new):
  - The dialog, a native modal `<dialog>`, sent through `sendOrQueue`, so it waits for a connection as the timeline's own log does.
  - `useAfterDial` opens it on `visibilitychange` back to the page after a `tel:` link.
- `sales/leads/LeadGrid.tsx`:
  - A last cell per row with Call (only where `dialable` takes the number, so never a masked one) and Log call (the row's `canLog`).
  - It is sticky at the right of a wide grid, and full width at the foot of the phone card.
  - `sales/leads/page.tsx` and `sales/smart-views/page.tsx` pass the workspace's time zone, and each row's `canLog` from `leadReach(ctx, 'EDIT')`; the second owner's id is read for it and not sent.
- `src/lib/security/record-scope.ts`: `leadReach(ctx, action)`, whether `assertLeadInScope` takes a lead: `ownerReach` on the owner or the second owner, or an unassigned lead.
- `src/services/leads/timeline.ts` (new): `leadTimeline(ctx, leadId, { cursor, limit })`. It merges six sources, each read `limit + 1` newest first:
  - Activity, LeadStageHistory and LeadAssignmentHistory.
  - AuditLog rows on the lead whose `fieldKey` names a field a person edits (`FIELD_LABELS`; not `phoneNormalized`, `updatedAt`, `stageId`, `ownerId`, `score` and the like). Custom-data edits name only the workspace's active fields, as the lead page shows them; an archived field's values stay out.
  - An assignment entry carries its history row's note, or else its reason: a code (`REASSIGNED`) as words, the recycle sweep's sentence as written.
  - Call rows under `callScope(ctx, 'VIEW')`.
  - Communication rows on the lead or on a conversation linked to it (a thread's first messages from an unknown number carry no lead of their own), only those the inbox shows the viewer (`inboxReach`): a threaded message by its conversation's owner, as `api/v1/conversations` lists and opens threads (`visibilityWhere(ctx, 'communications', 'VIEW', { includeUnassigned: true })`); one outside any thread by its own owner. Without `communications:VIEW`, none.
  - The cursor is `<at>~<kind>~<id>`. At one instant the order is kind, then the source's own id order, so entries sharing a timestamp page once each.
  - A field's before and after go through `applyFieldSecurity`: masked where masked, left out where hidden. A user id reads as the person's name, a source id as its label.
  - `onClock` formats an instant on the workspace's clock ("02 Oct 2026, 00:30").
- `src/app/api/v1/leads/[id]/timeline/route.ts` (new): `GET ?cursor=&limit=`, `leads:VIEW`, `LEAD_MODULES`. The lead is read under the lead page's `leadScope`, 404 outside it; a cursor that is not one answers 422.
- `sales/leads/[id]/page.tsx`:
  - The timeline's first page replaces the 50 activities and 50 stage moves.
  - The open follow-ups under the Follow-ups list's rule (`workListScope`), with Complete where `ownerReach(leads, EDIT)` reaches their owner.
  - The last 10 done tasks (`tasks` scope) and follow-ups, by `completedAt`.
  - Matching stock: `matchesForRequirement` on the open requirement, only for a viewer with `listings:VIEW`, lapsed mandates left out, the first 5 of up to 25; `more` when the 25 are reached, and the link then reads "All matches" rather than a count.
  - `canLog` for the lead page, from `leadReach`.
- `sales/leads/[id]/LeadDetail.tsx`:
  - Log call beside Phone, and the return from Phone or from another number's `tel:` link opening it, where `canLog`.
  - The Timeline tab renders the feed, with Show older.
  - The Tasks tab lists the open follow-ups and Done.
  - The Matching stock card on the Overview.
- `src/app/globals.css`: `.lf-calllog` and the sticky `.lf-grid__actions` cell, tokens only. The backdrop is the sheets' scrim.

**Behaviour.** What customers on production see:

- **Lead lists** (Leads and smart views, in Sales, Real Estate and Lead
  Eagle):
  - A role that edits leads sees Log call on every row and phone card of a
    lead it may edit: its own, its team's as its edit scope reaches them,
    one it is second owner of, or an unassigned one. A role that reads
    further than it edits no longer meets "Lead not found" after filling in
    the dialog.
  - Call shows where the number is visible to the role; a masked number has
    none.
  - On a wide grid both stay at the right edge.
- **Lead page.**
  - Log call sits beside Phone. After Phone, coming back to the app opens
    the call log.
  - A call logged here, or from a list, is an "Outbound call" on the
    timeline. It moves the score by that type's points (+3 where
    provisioned), and books a follow-up the agent sees on Follow-ups and on
    the lead.
- **Timeline.**
  - It now also shows field edits, from every edit already in the audit log
    (an existing lead shows its history at once), and assignments.
  - It shows calls placed through the provider, to roles whose `calls`
    reach includes the caller, and WhatsApp, email and SMS messages, to
    roles whose inbox shows the thread. A thread's messages from before it
    was linked to the lead show too. A role without the inbox sees no
    message entries.
  - A role that sees a number masked sees its change masked.
  - Times are the workspace's, not the browser's.
  - The first 30 show, with "Show older"; the tab's count reads "30+" when
    there are more.
- **Tasks tab.** It lists the lead's open follow-ups, with Complete where
  the viewer may complete them. Done lists the last 10 completed tasks and
  follow-ups with when, on the workspace's clock. The Open tasks count
  includes follow-ups.
- **Overview.** Roles that see listings get Matching stock under the
  Requirement card. It asks for a requirement when there is none, and links
  to the full match list where the viewer may open the requirement ("All
  matches" past 25). Other roles see no change.

**Decisions taken.** The brief marks no DECISION in these rows. These are design choices (mine, not the owner's):

- The follow-up is a FollowUpTask, not a Task: it is what the Follow-ups list
  and its API read under `leads`, so an agent finds it there. Hence the lead
  page shows follow-ups too.
- The outcome is one of eight fixed words, stored as the activity's outcome:
  Connected, Interested, Not interested, Call back later, No answer, Busy,
  Switched off, Wrong number. Minutes are optional.
- The follow-up is on by default, at 10:00 tomorrow on the workspace's clock.
  Its title is "Follow-up call" and the note is its description. A follow-up
  in the past is accepted (shown overdue), as the follow-ups API accepts one,
  so a call logged offline and sent late is not refused.
- After `tel:`, the dialog opens when the page becomes visible again. Where
  dialling does not leave the page (a desktop with no phone app), it does not
  open; Log call is beside it.
- A message is on the timeline only for a viewer whose inbox shows it, as a
  call is only within the viewer's `calls` reach: the conversation's owner
  decides, as in the inbox, and a message outside any thread goes by its own
  owner. A role without the inbox does not learn when the client wrote or
  who replied. Numbers and addresses are never on the timeline.
- Log call is offered where its route takes the lead (`leadReach`), not on
  every row a role with `leads:EDIT` can see.
- The lead page's other edit controls keep `can(leads, EDIT)` as before;
  only Log call moved to the lead's reach.
- Matching stock reads lapsed mandates as off the market without writing,
  where the requirement page runs the sweep first.
- The new dates are formatted on the server on the workspace's clock. The
  rest of the page still formats in the browser.

**Verified.** On the rig's scratch database (106 migrations; logs `C:/ymw/logs/r3-4d1-*.log`).

New and touched specs, all green on the final code (`new4`):

- `tests/sales/lead-call-log.spec.ts` (new, 9 cases):
  - One POST writes the call (outcome, note, 240 s, owner, type `call_out`
    worth 3), the follow-up due `2027-01-10T06:00:00.000Z` for 10:00 in
    Dubai, the score 10 to 13 with its history row, the next follow-up date,
    and both audit rows.
  - No follow-up when none is asked for.
  - An unknown outcome, "tomorrow", 30 February, −1 minutes, a call an hour
    ahead and one 8 days ago answer 422, writing nothing.
  - A repeated request key is one call.
  - Another's lead and another workspace's lead answer 404, a view-only role
    403, and nothing is written; an OWN agent logs on its own lead.
  - A masked role logs a call, the response carries no number, and its list
    shows the number masked.
  - A role with `leads:VIEW` everywhere and `leads:EDIT` at OWN gets
    `canLog` on its own, its second-owned and an unassigned lead, not on
    another's, on the list and the lead page, and no second owner's id in
    the rows; the route agrees (200, 404).
  - Done: 12 completed (11 tasks and the logged follow-up) show the newest
    10 with their Dubai times, and the open task and follow-up are listed.
  - An OWN agent's lead page lists its own done follow-up and none of a
    colleague's open or done follow-ups or done tasks on that lead.
- `tests/sales/lead-timeline.spec.ts` (new, 9 cases):
  - A phone edit ("+971501234567 → +971509876543", by name, once), a second
    owner by name, the stage move, the reassignment, the logged call, a
    provider call dated "02 Oct 2026, 00:30" for 20:30 UTC, and a WhatsApp
    message, newest first, with no user id anywhere; the reassignment reads
    "from … · Reassigned".
  - Paging by 2 returns every entry once in the same order, three edits at
    one instant included.
  - A bad cursor answers 422.
  - Another agent's or workspace's lead answers 404.
  - A masked role sees the phone change masked, a hidden field's change
    with no values, no call it does not reach, and no message; the
    administrator, with the inbox, sees the text and the values.
  - A thread linked to the lead after its first message: that message (no
    lead of its own) is on the timeline. An agent whose inbox is OWN sees
    its own thread's message with its text, and not one it sent in a thread
    now someone else's, nor one outside any thread it does not own.
  - A custom-data edit names only the active field that changed; an
    archived field's edit, a system-only change and the bookkeeping columns
    give no entry.
  - An unassignment by the recycle sweep reads "from Second Agent ·
    Recycled to the pool after 30 days without activity".
  - The lead page carries the first page.
- `tests/sales/lead-requirement.spec.ts` (1 case added): with no
  requirement the card asks for one. With a BUY requirement it lists the
  matching villa (reference, "AED 4,500,000", 5 bed) and not the rented,
  pricier, lapsed or sold ones, and links to the match list. A role without
  `listings:VIEW` gets none. Past 25 matches it reports `more` and 25
  rather than giving the cap as the count.
- `tests/e2e/lead-call-log.spec.ts` (new, 1 passed, Lead-Eagle-only
  workspace):
  - Three counted clicks give a logged call with a follow-up due 10:00
    tomorrow in Dubai: on the desktop grid, then on a 390 px phone card
    with no sideways scroll.
  - A `tel:` link followed by the page hiding and showing again opens the
    dialog for that lead.
  - Log call pressed again after the first send was saved but its answer
    lost (a 500) logs one call and one follow-up.
  - At 390 px the lead page opens the dialog from its Log call and back from
    dialling another of its numbers; its timeline shows the call, and with
    35 older edits, Show older brings the oldest once; the follow-up is
    under Tasks, and completed, it stays under Done after a reload.
- `tests/e2e/lead-contact-masking.spec.ts` (one step added): the
  telecaller's lead list offers Log call on the masked lead and has no
  `tel:` link.

Fail-before, against `origin/feat/lead-requirement-interest-fields`:

- With the base source alone (`failbefore-A`, `e2e-failbefore`):
  - The two new specs cannot load (no `/leads/[id]/call-log` or `/timeline` route).
  - The matching-stock case fails "expected undefined to deeply equal { hasRequirement: false, …(2) }".
  - The E2E times out waiting for the button "Log call for Desk Caller …".
- With only the new files added (`failbefore-B`), 3 cases fail:
  - "expected '…' to contain '01 Mar 2027, 15:00'" (no follow-ups on the lead page).
  - "… to contain 'Phone changed'" (the page's timeline).
  - The matching-stock case, as above.

Review round (13 Oct), fail-before against the branch's own first commit
`024c690d` (the review fixes' source swapped back, tests kept, then
restored; the diff's hash checked identical):

- vitest (`rv-failbefore`): 7 cases fail. The `canLog` case "expected
  [ undefined, undefined, …(2) ] to deeply equal [ true, true, true, false
  ]"; matching stock "expected { hasRequirement: false, …(2) } to deeply
  equal { …(3) }" (no `more`); and in the timeline the reassignment's
  reason, a masked role's message entry ("expected [ { …(8) } ] to deeply
  equal []"), the thread's first message, the archived field's values and
  the recycle reason. The OWN-agent done follow-ups case and the
  `occurredAt` bounds pass there: coverage only, the code was right.
- E2E `rv-e2e-failbefore-A` (all of `024c690d`'s source): the retry step
  fails with two calls logged ("Received + 3" at
  `expect(activities).toEqual([{ outcome: 'Busy' }])`).
- E2E `rv-e2e-failbefore-B` (`024c690d` with only the dialog's fix, and
  the grid's guard mutated to `row.phone &&`): the lead page's other
  number does not open the dialog (`expect(dialog).toBeVisible()`, line
  210), and the masked list has a `tel:` link ("Expected: 0, Received: 1").
- On the fixed code: the three vitest specs 31 of 31 (`rv-after2`);
  `lead-call-log` and `lead-contact-masking` 4 of 4 (`rv-e2e-after1`);
  `crm-lifecycle`, `lead-requirement-interest`, `lead-eagle-workspace`,
  `lead-bulk-stage` 6 passed and `lead-close-out` skipped
  (`rv-e2e-after2`), where one `crm-lifecycle` step met the sign-in page
  after a reload under load; alone, `crm-lifecycle` 6 of 6
  (`rv-e2e-after3`).
- `tests/permission` and `tests/sales` (`rv-wide1`): 80 of 82 files,
  1,548 passed, 1 failed and 15 skipped; the two files (`cold-data`,
  `lead-source-intake`) failed on "Unable to start a transaction" and
  pass alone, 32 of 32 (`rv-wide1b`).
- `tests/tenant`, `unit` and `platform` without the retention specs
  (`rv-wide2`): 87 files, 1,451 passed, 2 skipped. Retention alone: 4 and 7.
- `tests/security`, `integration`, `identity`, `hr`, `diagnostic` and
  `ai` (`rv-wide3`): 96 of 100 files; the 4 failed under load (Prisma
  transaction errors) and pass alone, 54 of 54 (`rv-wide3b`).
- `tsc` clean (`rv-tsc`); eslint no errors, the same 9 `no-explicit-any`
  warnings; prettier clean; `check-raw-sql-scope` and `check-test-data`
  clean.

Before the review (first commit):

- The new and touched specs with `lead-eagle-routes`, `lead-task-scope` and
  `lead-eagle-move` (`new4`): 6 files, 186 tests, all green.
- `tests/permission` and `tests/sales` (`wide1`): 82 files.
  - 52 passed. 30 failed under load: 1,223 tests passed, 8 failed and 328
    skipped. The errors were "Unable to start a transaction in the given
    time", connection timeouts and 60 s hook timeouts.
  - The 30 run again in two batches pass: 578 of 578 (`wide1b`) and 152 of
    152 (`wide1c`).
- `tests/tenant`, `unit` and `platform`, without the two retention specs
  (`wide2`): 87 files, 1,450 passed and 2 skipped.
  - `pooling` failed with "Unable to start a transaction", and
    `ai-usage-console` with an expired transaction in its `afterAll`.
  - Run alone, both pass, 23 of 23 (`wide2b`).
  - The retention specs alone: 4 and 7.
- `tests/security`, `integration`, `identity`, `hr`, `diagnostic` and
  `ai` (`wide3`): 100 files, 1,254 tests, all green.
- `tsc` is clean (`tsc1`, and `tsc2` on the final code).
- eslint: no errors. Its 9 warnings are `no-explicit-any`, as many in each
  file as on the base.
- prettier is clean.
- `check-raw-sql-scope` is clean: 35 raw statements, all inside a tenant
  transaction. No schema change.
- E2E:
  - `lead-call-log` passed three times (`e2e2`, `e2e3`, and `e2e5` on a
    fresh `.next`).
  - `crm-lifecycle` (6), `lead-bulk-stage` (2), `lead-contact-masking` (3)
    and `lead-eagle-workspace` (1) passed (`e2e3`).
  - `lead-requirement-interest` failed once there. The interests route,
    compiled for the first time on that `.next`, answered in 19.1 s, past
    the 20 s wait for the page to refresh. It passed on its rerun (`e2e4`).
  - `lead-close-out` skips without the demo workspace's settings.

Screens, captured at 390 and 1280 px in light and dark: the lead list with
Call and Log call, the dialog, the Overview with Matching stock, the
Timeline, and Tasks with Done. None scrolls sideways at 390 px; tokens only.

**Left open.**

- A call logged here, like any logged activity, does not count toward the
  daily calling target or the check-out gate. The daily board counts calls
  placed through the provider and cold calls only
  (`services/targets/dailyBoard.ts`). Counting logged lead calls there is a
  change to the board's arithmetic for every workspace.
- The timeline does not show interest links, requirement edits, enquiries
  received again, documents or score moves. Their audit rows exist
  (`metadata.action`, `fieldKey: score`).
- Task completion is on the Tasks tab (Done), not on the timeline.
- Matching keys on micromarkets, as before; areas typed on the requirement
  are not matched (#172).
- The rest of the lead page (Overview dates, the side panel) still formats
  dates in the browser's time zone.
- The lead page's other edit controls (Edit details, close-out, notes,
  numbers, interests, the requirement) and the grid's bulk actions still
  show on `can(leads, EDIT)`. A role whose `leads` VIEW reaches further
  than its EDIT sees them on leads it cannot edit, and they answer 404 as
  before this change.
