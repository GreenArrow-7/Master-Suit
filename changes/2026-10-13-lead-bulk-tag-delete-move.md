# The lead grid tags, deletes with Undo and moves leads to Cold Data in bulk; it pages by keyset, measured at 100,000 leads

**What.** Part 4E (bulk) of the Lead Eagle M4/M5/M6 build, built on
`feat/lead-views-kanban-calendar-search` (since merged as #179) and merged
with main after it and #178's Call / Log call cell. In every lead
module's grid (Sales, Real Estate, Lead Eagle; Smart Views too), the bulk bar
gains:

- **Add tag** (M4-35): the typed tags are added to each selected lead's own;
  none is removed.
- **Delete with Undo** (M4-36): after a bulk delete a toast says how many were
  deleted and offers Undo, focused, for 10 seconds; Undo restores each lead
  through the new `POST /api/v1/leads/{id}/restore`.
- **Move to Data** (M4-39): each selected lead becomes a contact on the day's
  "From pipeline YYYY-MM-DD" list in Cold Data (the workspace's date), still
  its owner's; the lead is closed out as archived and its open follow-ups and
  tasks are cancelled, so it leaves every working list.

And M4-20: the lead list measured at 100,000 leads. Deep pages missed 300 ms
in Postgres, so the grid now pages by keyset, and the API's keyset (and every
other list that uses `cursorWhere`) seeks to the page instead of filtering up
to it. With the harness now in the repository, page 1 and page 200 measured
end to end under 300 ms at p95 in 23 of the 24 figures the screens and the API
use, on a machine still shared with other rigs (the measurement below).

**Why.** Audit rows of 11 Oct (owner's brief, 12 Oct):

- M4-35: no way to tag selected leads. M4-36: the soft delete existed with no
  toast, no Undo and no restore. M4-39: no way to send leads back to cold
  calling. Acceptance: moved contacts appear in Cold Data and leave every
  working list; a bulk delete can be undone and the audit log shows both
  events.
- M4-20: no measurement of the lead list at 100k leads per workspace;
  acceptance p95 under 300 ms on page 1 and page 200, keyset if not.

**Where** (under `apps/web/`)

- `src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx`: Add tag (a
  comma-separated field, `parseTags`), Move to Data (`canMoveToData`), Delete
  then the Undo toast: a `role="status"` region mounted empty, the toast put
  into it, focus moved to Undo, its 10 seconds counted while neither focus nor
  the pointer is on it; `run()` answers the ids that went through. With no
  rows it renders only the toast.
- `sales/leads/page.tsx` and `sales/smart-views/page.tsx`: pass
  `canMoveToData` (`mayMoveToData`); the grid stays mounted beside the empty
  state, so a delete that empties the page keeps its Undo. The leads page
  reads `after`/`before` (`leadPage`) and gives the Pager the first and last
  rows' ids. Smart Views leaves closed-out leads out (`OPEN_LEADS_WHERE`), as
  the leads list does.
- `src/app/api/v1/leads/[id]/route.ts`: PATCH takes `addTags`, refused (403)
  for a role whose tags field is read-only; DELETE answers the lead's id, so
  its `RECORD_DELETED` row names the lead.
- `src/services/leads/updateLead.ts`: `addTags` is added to the row as it
  stands, the row locked first (`lockLeads`), 422 past 20 tags; `restoreLead`
  (the delete's scope, 409 when another lead took its number or email,
  `RECORD_RESTORED` in the same transaction).
- `src/app/api/v1/leads/[id]/restore/route.ts` (new): `leads:DELETE`,
  `LEAD_MODULES`.
- `src/lib/security/record-scope.ts`: `assertLeadInScope(…, { deleted: true })`
  reaches a deleted lead only.
- `src/app/api/v1/leads/[id]/move-to-data/route.ts` (new): `leads:EDIT`, and
  `mayMoveToData` in the handler (403). `src/services/leads/coldData.ts`:
  `mayMoveToData`, `moveLeadToData`. `src/services/leads/closeOut.ts`:
  `closeOutLead` takes the caller's transaction.
- `sales/cold-data/page.tsx`: a number in a record's notes reads as its phone
  does to the viewer. `src/app/api/v1/cold-data/[id]/convert/route.ts`: Make
  lead reopens the lead it matches when that lead is archived or invalid.
  `sales/calendar/page.tsx`: cancelled tasks and follow-ups are left off, as
  cancelled visits were.
- `src/lib/security/audit.ts`: a `Date` or an array in an audit value is
  stored as itself; they were stored as `{}` and `{"0": …}`.
- `src/app/globals.css`: `.lf-toast__action` in `--yh-cyan`.
- `src/services/leads/leadList.ts`: `leadPage` (the boundary lead's sort value
  read in the list itself, the predicate after or before it with a bound on
  the sort column, and the order to read in).
  `src/components/workspace/Pager.tsx`: optional `cursors`.
- `src/lib/api/pagination.ts`: `cursorWhere` adds `updatedAt <= cursor` to its
  OR (`GET` leads, accounts, contacts, opportunities, tasks, listings,
  projects).
- Tests: `tests/sales/lead-bulk-actions.spec.ts`, `tests/sales/lead-grid-pages.spec.ts`,
  `tests/e2e/lead-bulk-actions.spec.ts` (new); `tests/unit/where-merge.spec.ts`
  (2 cases). The M4-20 harness: `tests/perf/lead-list-100k.spec.ts` with its
  own config `vitest.perf.mts`; `vitest.config.mts` excludes `tests/perf`.

**Behaviour.** For customers on production:

- The bulk bar has Add tag and, for roles that hold `leads:CREATE` and
  `leads:EDIT` and read lead numbers in full, Move to Data. Each request is
  one lead, re-checked in the caller's scope; a lead outside it answers 404
  and the bar names the ones that failed, as it does for a stage move. A role
  whose tags field is read-only is refused Add tag (403), and the lead is
  counted as not done.
- Delete still asks first. Then a toast reads "2 leads deleted. Undo" (above
  the phone's tab bar at 390 px), and focus is on Undo; Enter or a click
  restores them and says "Restored 2 leads.", or "1 of 2 could not be
  restored." when the server refuses one. The 10 seconds run once focus and
  the pointer have left the toast; then it goes and the leads stay deleted.
  Restore needs `leads:DELETE` at the delete's scope: a lead not deleted,
  another workspace's or one outside that scope answers 404, a role without
  `leads:DELETE` 403, and a lead whose number or email another lead took
  since 409, as adding it again would. The audit log has `RECORD_DELETED`
  (now with the lead's id) and `RECORD_RESTORED` on the lead.
- Move to Data writes a Cold Data contact with the lead's name, main number
  (its first other number when it has none), email, company, job title, city,
  country and notes, its other numbers in the notes ("Other numbers: +971…"),
  status Not contacted, owned by the lead's owner (unassigned if the lead
  was), on the list "From pipeline 2026-10-13" (the workspace's date). In the
  same transaction the lead is archived through the close-out path (it stays
  under the Closed out chip and can be reopened), its open follow-ups and
  tasks are cancelled and its next follow-up cleared; audited on the lead
  (`status`, and `lead.moved_to_data` naming the record, the list and the
  cancelled follow-ups and tasks). It leaves the lead list, Smart Views,
  Follow-ups, the calendar and the Tasks page's Open and Overdue tabs (All
  lists the task as cancelled). Refused with 409: a lead already closed
  out (a second move, or a duplicate, which keeps its link), and a lead whose
  owner reads lead numbers masked, whose own cold record would show them in
  full ("reassign it first").
- On Cold Data, a number in a record's notes reads as the record's phone does
  to the viewer: masked to a role that reads lead numbers masked, unless the
  record is their own.
- Make lead on a moved contact reopens the lead it was (archived, or marked
  invalid), audited, and the enquiry lands on it; a duplicate stays one.
- Smart Views no longer list closed-out leads (invalid, duplicate, archived);
  no view there can ask for them. The leads list's Closed out chip still does.
- The calendar no longer shows cancelled tasks and follow-ups.
- The grid's Next and Previous links carry the lead they continue from, by id
  (`?page=2&after=<lead id>`); an older `?page=N` link, or one naming a lead
  no longer in the list, still opens that page by number.
- Audit rows that change a date (a delete's `deletedAt`, a follow-up date) or a
  list (tags) now hold the value; they held `{}` and `{"0": "vip"}`.
- The toasts' action links (Undo, Send now, the bulk bar's Clear) are the
  cyan accent in both themes: in the dark one they were dark blue on midnight
  (2.4:1); in the light one they were pale blue.

**Decisions taken**

- None by the owner: the brief marks no DECISION for M4-20, M4-35, M4-36 or
  M4-39.
- Design choices, not the owner's:
  - Add tag is `addTags` on the existing PATCH, one request per lead like the
    stage move, not a bulk route; the union is taken on the locked row in the
    transaction, case-sensitive like `parseTags`, so no tag is lost to a stale
    screen or a second add at once. Past 20 the lead answers 422 and keeps its
    tags.
  - Delete keeps its confirm and adds the Undo. Restore is audited as one
    `RECORD_RESTORED` row (field `deletedAt`, when it was deleted) in its
    transaction, with no route-level row, and follows `createLead`'s
    duplicate rule.
  - Move to Data: cold data has no permission module of its own (it is
    `leads`), so "cold-data CREATE" is `leads:CREATE`, not `leads:IMPORT`
    (the import's): the move brings no outside list in, only leads the mover
    can already read in full. Until the owner decides otherwise (Left open),
    the safe default for masked numbers: the mover must read lead numbers in
    full, and a lead whose owner reads them masked is refused rather than
    handed to them unmasked. One record per lead; a record holds one number,
    so the others go in its notes. The record keeps no link to the lead
    (`convertedLeadId` stays empty, so it can be worked and made a lead); a
    closed-out lead is not moved again.
  - The Undo's 10 seconds wait while it has focus or the pointer (focus goes
    to it after a delete), so a keyboard or screen-reader user is not timed
    out.
  - M4-20: both the grid (offset before) and the API (keyset already) are
    keyset now; Previous reads backwards from the first row. The grid's link
    names the boundary lead by id and its sort value is read on the server: a
    name or a score in the URL would land in logs and history. An unreadable
    cursor, or a lead no longer in the list, is ignored and the page number
    skips, as before.
  - The perf harness is in the repository but never in CI: `tests/perf` is
    excluded from the unit config, has its own (`vitest.perf.mts`), and runs
    only with `PERF_100K=yes`.

**Verified.** On the rig (`C:/ymw/m2`, its scratch database at 107
migrations, none added; logs `C:/ymw/logs/r4-4e1-*.log`).

- `tests/sales/lead-bulk-actions.spec.ts` (new, 17): Add tag adds to each
  lead's own and audits `tags` as lists (`["vip"]` to `["vip","investor"]`);
  404 outside the caller's scope or workspace, nothing tagged; 422 past 20; a
  read-only tags field answers 403 and leaves the lead untouched; six adds at
  once all land. Restore puts a deleted lead back in `GET /api/v1/leads`, with
  `RECORD_DELETED` and `RECORD_RESTORED` on the lead; 404 for a lead not
  deleted, another workspace's or one outside the delete scope; 403 without
  `leads:DELETE`; 404 for a role that reads every lead but deletes only its
  own; 409 when another lead took the number. Move to Data: the record's
  fields, the other number in its notes, the owner kept, the list named by the
  workspace's date (on a zone whose date is not UTC's); the lead archived, its
  follow-up and task cancelled and its next follow-up cleared, gone from the
  API, the grid, Smart Views, Follow-ups and the calendar; on the owner's Cold
  Data with every number, and on a masked viewer's with the notes' number
  masked; Make lead on it reopens the lead. 404 outside scope or workspace
  with nothing written; 403 without `leads:CREATE` or without `leads:EDIT`,
  and the grid offers it only with both; a Telecaller's role 403, and a
  Telecaller's lead 409, nothing written; a second move and a duplicate 409;
  a failing write after the close-out leaves the lead open, its follow-up
  open and no record; a lead with no main number gets its first other one,
  an unassigned lead an unassigned record.
- `tests/sales/lead-grid-pages.spec.ts` (new, 6): for each sort (updated,
  created, score, name), 130 leads with ties walk forward through the Pager's
  links in pages of 50, 50 and 30, every lead once and in order, each link
  naming its row by id alone, and back through Previous to the same pages; an
  OWN agent's 86 walk the same with a date chip on `updatedAt`, and by name;
  an old `?page=2` link, one with an unreadable cursor and one naming another
  workspace's lead open page 2.
- `tests/unit/where-merge.spec.ts` (2 new): `cursorWhere` bounds `updatedAt`;
  a date chip on the same column is kept.
- Fail-before, against `origin/feat/lead-views-kanban-calendar-search`
  (`apps/web/src` stashed): lead-bulk-actions fails on every case ("Unrecognized
  key(s) in object: 'addTags'", "expected 422 to be 200"; "Cannot find package
  '@/app/api/v1/leads/[id]/restore/route'", and the same for move-to-data).
  With only `audit.ts` and the DELETE's id put back, 2 fail ("expected { …(16) }
  to match object" on the tags row; "expected [ 'RECORD_UPDATED',
  'RECORD_RESTORED' ] to deeply equal ArrayContaining"). lead-grid-pages on the
  offset grid: every walk fails ("Next starts after the last row: expected
  undefined to be truthy"); the old-link case passes, a guard. where-merge with
  the base `pagination.ts`: the 2 new fail.
- Review round, against this branch's first version (`apps/web/src` stashed,
  log `r4-4e1-fix-bulk-before.log`): 7 of the 17 fail: read-only tags
  "expected 200 to be 403"; six adds at once "expected [ 'a6', 'vip' ] to
  deeply equal [ 'a1', …(6) ]"; restore over a taken number "expected 200 to
  be 409"; the Move to Data walk "expected { …(72) } to match object {
  status: 'ARCHIVED', …(2) }" (the next follow-up kept); the Telecaller
  "expected 200 to be 403"; the second move "expected 200 to be 409"; no main
  number "expected { …(19) } to match object { phone: '050 333 4455', …(2) }".
  The three guards were proven on mutants (`r4-4e1-fix-bulk-mutants.log`):
  the close-out outside the move's transaction fails "expected 'ARCHIVED' to
  be null"; the route asking `CREATE` instead of `EDIT` fails "expected 404 to
  be 403"; restore at the view's scope fails "expected 200 to be 404".
  lead-grid-pages on the first version: 5 of 6 fail, "Next names the last row
  by its id: expected 'WyJQYWdlciAwNTQiLCJjbXY2ajVnbTMwMDRzZ…' to be
  'cmv6j5gm3004sg0lyhaajnfwa'" (the token held the lead's name).
- Related specs (the two new ones, bulk-stage-move, lead-close-out, cold-data,
  cold-call-activity, lead-saved-views, lead-audit-trail, lead-kanban,
  lead-search, lead-calendar, next-follow-up, custom-fields,
  lead-record-fields, lead-record-scope, field-security,
  visibility-where-merge, where-merge, lead-eagle-routes, realty-routes): 20
  files, 993 of 993.
- Broad, on the final code: permission, sales, tenant, unit and platform, 184
  files, 3211 passed, 2 skipped, 1 failed: lead-bulk-actions' Move to Data
  walk, "expected 'From pipeline 2026-10-13' not to be 'From pipeline
  2026-10-13'". Its zone pick (Kiritimati from 12:00 UTC, else Pago Pago) gave
  UTC's own date from 11:00 to 11:59 UTC, when the run reached it; the pick
  now changes at 11:00, and the spec passed 17 of 17 at 11:04 UTC. Security,
  integration, hr, identity and ai: 100 files, 1254 of 1254.
- `tsc --noEmit` clean; eslint no errors (two `any` warnings on lines the
  change re-indented); prettier clean.
- Playwright on the rig's dev server, `tests/e2e/lead-bulk-actions.spec.ts`
  (new, 8 of 8) under `/lead-eagle/leads`: Delete then Undo, at 390 px where
  the delete empties the list (the empty state shows and the Undo stays) and
  at 1280 px with a third lead listed and not selected, which stays; focus on
  Undo after the delete, Enter restores both, both events audited; Add tag
  then Move to Data at both widths, the tags stored, both leads on
  "From pipeline <date>" in Cold Data and archived; the Undo still there 11 s
  later while focused, gone within 12 s of leaving it, the lead deleted; a
  refused restore read as "1 of 2 could not be restored.", that lead still
  deleted; Next and Previous at 390 px, `after=` in the URL, 53 leads in 50
  and 3, no sideways scroll. With this branch's first `LeadGrid.tsx` the
  1280 px Delete case fails at `expect(locator).toBeFocused()`; with the
  base's `LeadGrid.tsx` and `page.tsx` it failed at "2 leads deleted.".
  Related, on the final code: admin-deletes 5, follow-up-mobile 4,
  lead-bulk-stage 2, lead-eagle-workspace 1, lead-views-board 5 passed;
  cold-data-assign skipped (demo credentials).
- Screens: the Add tag panel and the Undo toast at 390 and 1280 px, light and
  dark (the E2E's screenshots); the Undo was 2.4:1 in the dark theme before
  the colour change.

**M4-20, the measurement.**

- Machine: Windows 11 Pro, Intel Core i5-1145G7 (4 cores, 8 threads), 31.7
  GB; Postgres in Docker (WSL 2) on the same machine, the rig's database,
  shared with four other rigs' dev servers and test runs. First round: CPU at
  90 to 100% in every run, no quiet 30 s in the 90 minutes watched. Review
  round: CPU at 30 to 65% (sampled before and between runs).
- Data: one scratch Lead Eagle workspace, 100,000 leads (99,000 not deleted,
  95,999 open), five OWN agents owning 20,000 each (19,393 open), six stages,
  dates spread over a year; seeded in 153 s (first round) and 68 s (review
  round). An ORGANIZATION administrator and an OWN agent; the default sort.
- Method: 5 warm-ups then 50 runs, p50 and p95 in ms. In Postgres: the
  list's `SELECT` as the app role with row-level security on. In-process: the
  `GET /api/v1/leads` handler with a real session and the `LeadsPage` server
  component; page 200 is the API's cursor after 199 pages, and the grid's
  `after=` naming the same row.
- Commands, from `apps/web` on a scratch database:
  `PERF_100K=yes npx vitest run --config vitest.perf.mts -t seed`, then
  `-t timing` (in-process), `-t sql` (Postgres) and `-t cleanup` (every
  `perf100k-*` workspace and its identities deleted). The review round ran
  exactly these on the rig, through its runner, logs `r4-4e1-fix-perf-*.log`:
  timing three times, sql twice. The first round ran the same cases from
  `C:/ymw/m456/scratch/4e1/`. The database was 157 MB with the workspace and
  128 to 131 MB after.

Review round, the final code, end to end, p95 of three runs (p50 48 to 180):

| Request                                 | ORG p95             | OWN p95             |
| --------------------------------------- | ------------------- | ------------------- |
| `GET /api/v1/leads` page 1              | 74.0, 113.4, 109.2  | 59.8, 62.4, 167.2   |
| `GET /api/v1/leads` page 200            | 60.8, 87.5, 96.6    | 99.3, 59.8, 300.2   |
| Grid page 1                             | 116.3, 79.8, 107.1  | 94.7, 121.7, 186.7  |
| Grid page 200 (`after=`)                | 126.0, 158.9, 116.9 | 278.0, 100.8, 205.3 |
| Grid page 200 (old `?page=200`, OFFSET) | 193.4, 222.3, 166.6 | 280.7, 263.3, 314.2 |

Review round, in Postgres, p50 / p95 of two runs:

| Query                      | Run 1        | Run 2        |
| -------------------------- | ------------ | ------------ |
| ORG page 1                 | 3.7 / 5.6    | 3.5 / 4.9    |
| ORG page 200, keyset (now) | 3.0 / 4.0    | 3.7 / 5.4    |
| ORG page 200, OFFSET 9950  | 20.2 / 26.2  | 27.5 / 51.5  |
| OWN page 1                 | 3.1 / 4.1    | 3.6 / 5.5    |
| OWN page 200, keyset (now) | 3.7 / 5.5    | 4.5 / 6.7    |
| OWN page 200, OFFSET 9950  | 76.5 / 168.2 | 93.5 / 193.2 |

First round, in Postgres (last run; earlier runs agree within the load's spread):

| Query                                         | p50   | p95   |
| --------------------------------------------- | ----- | ----- |
| ORG page 1                                    | 10.2  | 20.1  |
| ORG page 200, keyset as it was (the OR alone) | 71.0  | 144.7 |
| ORG page 200, keyset with the bound (now)     | 9.0   | 27.8  |
| ORG page 200, OFFSET 9950 (the grid before)   | 76.9  | 147.1 |
| OWN page 1                                    | 11.6  | 60.2  |
| OWN page 200, keyset as it was                | 265.8 | 452.0 |
| OWN page 200, keyset with the bound (now)     | 8.6   | 12.6  |
| OWN page 200, OFFSET 9950 (the grid before)   | 256.1 | 397.5 |

Every plan is an index scan on `(tenantId, updatedAt desc, id desc)`. Page 1
reads 57 buffers (0.3 ms in EXPLAIN ANALYZE); the agent's page 200 read 52,977, walking
the other agents' rows from the top, by OFFSET or by the unbounded OR alike.

First round, in-process, at 90 to 100% CPU, the first version's code:

| Request                                 | ORG p50 | ORG p95 | OWN p50 | OWN p95 |
| --------------------------------------- | ------- | ------- | ------- | ------- |
| `GET /api/v1/leads` page 1              | 300.0   | 858.8   | 254.3   | 1287.9  |
| `GET /api/v1/leads` page 200            | 169.3   | 890.5   | 344.5   | 1235.0  |
| Grid page 1                             | 244.2   | 792.3   | 381.4   | 990.0   |
| Grid page 200 (`after=`)                | 212.8   | 420.2   | 287.8   | 1564.0  |
| Grid page 200 (old `?page=200`, OFFSET) | 425.3   | 878.9   | 857.8   | 1625.9  |

Before the change the first run gave `GET` page 1 240 / 409 (ORG) and 227 /
424 (OWN), page 200 334 / 834 and 686 / 1542, grid page 200 by OFFSET 242 /
396 and 601 / 1085.

Reading: the list's own query missed 300 ms at the agent's page 200 by OFFSET
and by the unbounded keyset alike (p95 355 to 452 at full load); with keyset
and the bound, page 200 costs what page 1 does, 4 to 7 ms at p95. End to end,
with the machine at 30 to 65%, 23 of the 24 p95 figures for what the screens
and the API use (the first four rows) are under 300 ms; the one over is the
agent's `GET` page 200 in the third run, 300.2 ms (p50 109.8, max 487), as the
load rose, where the other two runs gave 99.3 and 59.8. The old `?page=200`
link, which no screen makes any more, reached 314.2 once. At 90 to 100% (the
first round) every end-to-end p95 was over 300 ms, page 1 included: each query
of a request runs in its own transaction, and the slow-query log showed a bare
`set_config` taking up to 1.2 s and `COMMIT` up to 4.8 s.

**Left open**

- M4-20 on an unshared host: one confirming run of the same four cases on
  staging would replace a shared laptop's figures; here one p95 of 24 sat at
  300.2 ms under load. The grid's id cursor costs one indexed lookup per page
  more than the first version's token (in the figures above).
- Owner question: should a moved lead's number be readable to a record owner
  whose role reads lead numbers masked (the Telecaller)? Until answered, Move
  to Data refuses that (403 for such a mover, 409 for such an owner). An
  administrator can still hand a moved record to a Telecaller on Cold Data,
  where their own records read as stored (the M5 rule).
- Owner question: should a repeat enquiry (a form, a portal, WhatsApp, a call)
  on an archived lead reopen it? Today it is added to the lead, which stays
  archived; only Make lead on a cold contact reopens it.
- Reopening a moved lead from Closed out leaves its cold record on the list
  (they are not linked); a call and Make lead there land on the reopened lead.
- An ordinary close-out (Close out in the bulk bar or on the lead) still
  leaves the lead's open follow-ups and tasks on Follow-ups and Tasks; only
  Move to Data cancels them.
- Undo lives on the screen; after the toast goes, or after leaving the screen,
  a deleted lead is restored only through the API.
- An OWN or TEAM list's scope (`ownerId` or `secondaryOwnerId`) cannot use the
  owner index; keyset makes depth cheap, but the first page's cost grows with
  the share of the workspace's leads that are not the caller's.
- Previous after rows were added or removed between pages can show a page
  with fewer or other rows than the one left; the page number is a label.
- Not covered by a test: Smart Views' Undo on a page the delete emptied (the
  grid stays mounted there as on the leads list), and a TEAM-scope mover.
- The 4D bulk template send (another lane) edits the same bulk bar.
