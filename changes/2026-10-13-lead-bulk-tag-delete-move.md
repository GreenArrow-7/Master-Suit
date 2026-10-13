# The lead grid tags, deletes with Undo and moves leads to Cold Data in bulk; its pages stay fast at 100,000 leads

**What.** Part 4E (bulk) of the Lead Eagle M4/M5/M6 build, stacked on
`feat/lead-views-kanban-calendar-search` (round 3, PR open). In every lead
module's grid (Sales, Real Estate, Lead Eagle; Smart Views too), the bulk bar
gains:

- **Add tag** (M4-35): the typed tags are added to each selected lead's own;
  none is removed.
- **Delete with Undo** (M4-36): after a bulk delete a toast says how many were
  deleted and offers Undo for 10 seconds; Undo restores each lead through the
  new `POST /api/v1/leads/{id}/restore`.
- **Move to Data** (M4-39): each selected lead becomes a contact on the day's
  "From pipeline YYYY-MM-DD" list in Cold Data (the workspace's date), still
  its owner's, and is closed out as archived, so it leaves the lead lists.

And M4-20: the lead list measured at 100,000 leads. Deep pages missed 300 ms,
so the grid now pages by keyset, and the API's keyset (and every other list
that uses `cursorWhere`) seeks to the page instead of filtering up to it.

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
  then the Undo toast (`role="status"`, `.lf-toast .lf-outbox`); `run()`
  answers the ids that went through. With no rows it renders only the toast.
- `sales/leads/page.tsx` and `sales/smart-views/page.tsx`: pass
  `canMoveToData` (`leads:CREATE` and `leads:EDIT`); the grid stays mounted
  beside the empty state, so a delete that empties the page keeps its Undo.
  The leads page reads `after`/`before` (`leadPage`) and gives the Pager the
  first and last rows' cursors.
- `src/app/api/v1/leads/[id]/route.ts`: PATCH takes `addTags` (dropped, as
  `tags` is, for a role whose tags field is read-only); DELETE answers the
  lead's id, so its `RECORD_DELETED` row names the lead.
- `src/services/leads/updateLead.ts`: `addTags` is added to the row as it
  stands, 422 past 20 tags; `restoreLead` (the delete's scope, `RECORD_RESTORED`
  in the same transaction).
- `src/app/api/v1/leads/[id]/restore/route.ts` (new): `leads:DELETE`,
  `LEAD_MODULES`.
- `src/lib/security/record-scope.ts`: `assertLeadInScope(…, { deleted: true })`
  reaches a deleted lead only.
- `src/app/api/v1/leads/[id]/move-to-data/route.ts` (new): `leads:EDIT`, and
  `leads:CREATE` checked in the handler (403). `src/services/leads/coldData.ts`:
  `moveLeadToData`. `src/services/leads/closeOut.ts`: `closeOutLead` takes the
  caller's transaction.
- `src/lib/security/audit.ts`: a `Date` or an array in an audit value is
  stored as itself; they were stored as `{}` and `{"0": …}`.
- `src/app/globals.css`: `.lf-toast__action` in `--yh-cyan`.
- `src/services/leads/leadList.ts`: `leadPageCursor`, `leadPage` (the
  predicate after or before a row, with a bound on the sort column, and the
  order to read in). `src/components/workspace/Pager.tsx`: optional `cursors`.
- `src/lib/api/pagination.ts`: `cursorWhere` adds `updatedAt <= cursor` to its
  OR (`GET` leads, accounts, contacts, opportunities, tasks, listings,
  projects).
- Tests: `tests/sales/lead-bulk-actions.spec.ts`, `tests/sales/lead-grid-pages.spec.ts`,
  `tests/e2e/lead-bulk-actions.spec.ts` (new); `tests/unit/where-merge.spec.ts`
  (2 cases).

**Behaviour.** For customers on production:

- The bulk bar has Add tag and, for roles holding `leads:CREATE` and
  `leads:EDIT`, Move to Data. Each request is one lead, re-checked in the
  caller's scope; a lead outside it answers 404 and the bar names the ones
  that failed, as it does for a stage move.
- Delete still asks first. Then a toast reads "2 leads deleted. Undo" for 10
  seconds (above the phone's tab bar at 390 px); Undo, by click or keyboard,
  restores them and says "Restored 2 leads." After 10 seconds the toast goes
  and the leads stay deleted. Restore needs `leads:DELETE` at the delete's
  scope: a lead not deleted, another workspace's or one outside that scope
  answers 404, a role without `leads:DELETE` 403. The audit log has
  `RECORD_DELETED` (now with the lead's id) and `RECORD_RESTORED` on the lead.
- Move to Data writes a Cold Data contact with the lead's name, main number,
  email, company, job title, city, country and notes, its other numbers in
  the notes ("Other numbers: +971…"), status Not contacted, owned by the
  lead's owner (unassigned if the lead was), on the list "From pipeline
  2026-10-13" (the workspace's date). The lead is archived through the
  close-out path (it stays under the Closed out chip and can be reopened);
  both in one transaction, audited on the lead (`status`, and
  `lead.moved_to_data` naming the record and the list).
- The grid's Next and Previous links carry the row they continue from
  (`?page=2&after=…`); an older `?page=N` link still opens that page.
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
    stage move, not a bulk route; the union is taken on the row in the
    transaction, case-sensitive like `parseTags`, so no tag is lost to a stale
    screen. Past 20 the lead answers 422 and keeps its tags.
  - Delete keeps its confirm and adds the Undo. Restore is audited as one
    `RECORD_RESTORED` row (field `deletedAt`, when it was deleted) in its
    transaction, with no route-level row.
  - Move to Data: cold data has no permission module of its own (it is
    `leads`), so "cold-data CREATE" is `leads:CREATE`. One record per lead;
    a record holds one number, so the others go in its notes. The lead is
    archived (`ARCHIVED`), a lead already closed out may be moved too, and the
    record keeps no link to the lead (`convertedLeadId` stays empty, so it can
    be worked and made a lead).
  - M4-20: both the grid (offset before) and the API (keyset already) are
    keyset now; Previous reads backwards from the first row. An unreadable
    cursor is ignored and the page number skips, as before.
  - The perf harness lives outside the repository
    (`C:/ymw/m456/scratch/4e1/`), as the brief allowed: CI rejects a skipped
    test, and a 100,000-lead seed is no CI step.

**Verified.** On the rig (`C:/ymw/m2`, its scratch database at 107
migrations, none added; logs `C:/ymw/logs/r4-4e1-*.log`).

- `tests/sales/lead-bulk-actions.spec.ts` (new, 10): Add tag adds to each
  lead's own and audits `tags` as lists (`["vip"]` to `["vip","investor"]`);
  404 outside the caller's scope or workspace, nothing tagged; 422 past 20; a
  read-only tags field adds nothing. Restore puts a deleted lead back in
  `GET /api/v1/leads`, with `RECORD_DELETED` and `RECORD_RESTORED` on the lead;
  404 for a lead not deleted, another workspace's or one outside the delete
  scope; 403 without `leads:DELETE`. Move to Data: the record's fields, the
  other number in its notes, the owner kept, the list named by the
  workspace's date (on a zone whose date is not UTC's); the lead archived, gone
  from the API and the grid, and on the owner's Cold Data under the list; 404
  outside scope or workspace with nothing written; 403 without `leads:CREATE`,
  and the grid offers it only with both permissions.
- `tests/sales/lead-grid-pages.spec.ts` (new, 5): for each sort (updated,
  created, score, name), 130 leads with ties walk forward through the Pager's
  links in pages of 50, 50 and 30, every lead once and in order, Next carrying
  `after`, and back through Previous to the same pages; an old `?page=2` link,
  and one with an unreadable cursor, open page 2.
- `tests/unit/where-merge.spec.ts` (2 new): `cursorWhere` bounds `updatedAt`;
  a date chip on the same column is kept.
- Fail-before, against `origin/feat/lead-views-kanban-calendar-search`
  (`apps/web/src` stashed): lead-bulk-actions 10 of 10 fail ("Unrecognized
  key(s) in object: 'addTags'", "expected 422 to be 200"; "Cannot find package
  '@/app/api/v1/leads/[id]/restore/route'", and the same for move-to-data).
  With only `audit.ts` and the DELETE's id put back, 2 fail ("expected { …(16) }
  to match object" on the tags row; "expected [ 'RECORD_UPDATED',
  'RECORD_RESTORED' ] to deeply equal ArrayContaining"). lead-grid-pages on the
  offset grid: 4 of 5 fail ("Next starts after the last row: expected
  undefined to be truthy"); the old-link case passes, a guard. where-merge with
  the base `pagination.ts`: the 2 new fail.
- Related specs (bulk-stage-move, lead-close-out, cold-data,
  cold-call-activity, lead-saved-views, lead-audit-trail, lead-record-fields,
  lead-kanban, lead-record-scope, field-security, lead-eagle-routes,
  realty-routes and the new one): 13 files, 877 of 877. After the keyset
  change, the two new specs with lead-saved-views, lead-kanban, lead-search,
  bulk-stage-move, where-merge, visibility-where-merge, lead-named-filters and
  lead-eagle-routes: 242 of 243, where-merge's source scan timing out at 30 s
  under load; alone 13 of 13.
- Broad, on the final code, with the machine at 90 to 100% CPU from four
  other rigs: permission, sales, tenant, unit and platform, 180 files, 3080
  passed, 66 skipped, 9 failed, every failure a hook or transaction timeout
  ("Hook timed out in 60000ms", "Unable to start a transaction"). The 13 files
  with a failure but retention, rerun together: 162 passed, 1 failed; that file
  (`daily-board`) and `next-follow-up` alone 4 of 4 and 47 of 47; `retention`
  alone 5 of 5. Before the keyset change the same directories gave 179 files,
  3145 passed, 2 skipped, 1 failed (`reference`, "Unable to start a
  transaction"; 11 of 11 alone). Security, integration, hr, identity and ai: 100
  files, 1254 of 1254, before and after.
- `tsc --noEmit` clean, before and after the keyset change; eslint no errors
  (two `any` warnings on lines the change re-indented); prettier clean.
- Playwright on the rig's dev server, `tests/e2e/lead-bulk-actions.spec.ts`
  (new, 7) under `/lead-eagle/leads`: Delete then Undo, at 1280 and 390 px,
  where the delete empties the list (the empty state shows and the Undo
  stays), Undo pressed with Enter, both leads back, both events audited; Add
  tag then Move to Data at both widths, the tags stored, both leads on
  "From pipeline <date>" in Cold Data and archived; past 10 s the toast is
  gone and the lead deleted; Next and Previous at 390 px, `after=` in the URL,
  53 leads in 50 and 3, no sideways scroll. With the base's `LeadGrid.tsx` and
  `page.tsx` the first case fails at "2 leads deleted."; with only the base's
  `page.tsx` (no grid on an empty page) it fails at the Undo ("element(s) not
  found"). After the keyset change: lead-bulk-actions 7, lead-views-board 5,
  admin-deletes 5 passed; lead-bulk-stage failed once at the wizard's
  "Workspace created" (60 s, load) and passed alone, 2 of 2. Before it:
  lead-bulk-actions 6 of 6; admin-deletes, lead-bulk-stage,
  lead-eagle-workspace and lead-views-board 13 of 13; lead-close-out skipped
  (demo credentials).
- Screens: the Add tag panel and the Undo toast at 390 and 1280 px, light and
  dark (the E2E's screenshots); the Undo was 2.4:1 in the dark theme before
  the colour change.

**M4-20, the measurement.**

- Machine: Windows 11 Pro, Intel Core i5-1145G7 (4 cores, 8 threads), 31.7
  GB; Postgres in Docker (WSL 2) on the same machine, the rig's database. Four
  other rigs' dev servers and test runs shared it: CPU at 90 to 100% in every
  run, and no quiet 30 s in the 90 minutes watched.
- Data: one scratch Lead Eagle workspace, 100,000 leads (99,000 not deleted,
  95,999 open), five OWN agents owning 20,000 each (19,393 open), six stages,
  dates spread over a year; seeded in 153 s; `Lead` autoanalysed after. An
  ORGANIZATION administrator and an OWN agent; the default sort.
- Method: 5 warm-ups then 50 runs, p50 and p95 in ms. In Postgres: the
  list's `SELECT` as the app role with row-level security on
  (`dbtime.mjs`; plans by `explain.mjs`). In-process: the
  `GET /api/v1/leads` handler with a real session and the `LeadsPage` server
  component (`perf-100k.spec.ts -t timing`); page 200 is the API's cursor
  after 199 pages, and the grid's `after=` for the same row.
- Commands (scripts in `C:/ymw/m456/scratch/4e1/`; the spec copied into
  `apps/web/tests/zz-perf-4e1/` only while it ran):
  `node C:/ymw/m2-run.mjs vitest <log> tests/zz-perf-4e1/perf-100k.spec.ts -t seed`,
  the same with `-t timing`, `node C:/ymw/m2-run.mjs node C:/ymw/m456/scratch/4e1/dbtime.mjs`,
  then `cleanup.mjs`: the workspace and its six identities deleted, the
  database 157 MB with it and 128 MB after.

In Postgres (last run; earlier runs agree within the load's spread):

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

In-process, the final code (the old `?page=200` link still skips):

| Request                                 | ORG p50 | ORG p95 | OWN p50 | OWN p95 |
| --------------------------------------- | ------- | ------- | ------- | ------- |
| `GET /api/v1/leads` page 1              | 300.0   | 858.8   | 254.3   | 1287.9  |
| `GET /api/v1/leads` page 200            | 169.3   | 890.5   | 344.5   | 1235.0  |
| Grid page 1                             | 244.2   | 792.3   | 381.4   | 990.0   |
| Grid page 200 (`after=`)                | 212.8   | 420.2   | 287.8   | 1564.0  |
| Grid page 200 (old `?page=200`, OFFSET) | 425.3   | 878.9   | 857.8   | 1625.9  |

Before the change the first run gave `GET` page 1 240 / 409 (ORG) and 227 /
424 (OWN), page 200 334 / 834 and 686 / 1542, grid page 200 by OFFSET 242 /
396 and 601 / 1085. Reading: the list's own query met 300 ms at page 1 and
missed it at the agent's page 200 (p95 355 to 452 over three runs); with keyset and the bound,
page 200 costs what page 1 does. End to end, p95 is over 300 ms on every page
here, page 1 included and as much as page 200: each query of a request runs in
its own transaction, and on this machine the slow-query log shows a bare
`set_config` taking up to 1.2 s and `COMMIT` up to 4.8 s. That is the
machine's load, not the list's depth; the end-to-end figure wants a re-run on
an unshared host (Left open).

**Left open**

- Owner question: a moved lead's number reads as stored to the record's owner
  on Cold Data (the M5 rule for one's own records), also where their role
  reads the lead's number masked (Telecaller).
- Owner question: Make lead on a moved contact finds the archived lead by its
  number (the intake matches closed-out leads) and adds the enquiry to it,
  which stays archived; a repeat enquiry on any archived lead does the same.
- A moved or closed-out lead's open follow-ups and tasks stay on the
  Follow-ups and Tasks lists, as for any close-out.
- Undo lives on the screen for 10 seconds; after that, or after leaving the
  screen, a deleted lead is restored only through the API.
- An OWN or TEAM list's scope (`ownerId` or `secondaryOwnerId`) cannot use the
  owner index; keyset makes depth cheap, but the first page's cost grows with
  the share of the workspace's leads that are not the caller's.
- M4-20 end to end: re-run the harness (`perf-100k.spec.ts`, `dbtime.mjs`) on
  staging or an unshared machine; here every request's p95 was over 300 ms,
  page 1 included, under 90 to 100% CPU from other rigs.
- Previous after rows were added or removed between pages can show a page
  with fewer or other rows than the one left; the page number is a label.
- The 4D bulk template send (another lane) edits the same bulk bar.
