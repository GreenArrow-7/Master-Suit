# Two leads merge into one; a lead import can update the leads it matches, be checked first, and hand back its refused rows

**What.** Part 4E (merge and import) of the owner's brief "Build to completion:
Lead Eagle M4 Leads, M5 Cold data, M6 Lead intake", rows M4-31, M4-41, M4-42
and M4-43, for every lead module. Branch `feat/lead-merge-import`, from `main`
at f3d78ad9.

- **Merge two leads (M4-31).** A lead's page names any lead the duplicate rules
  match it with ("May be the same person as LD-000124 · Sara (same number).
  Compare and merge"), and the lead grid offers Merge when exactly two leads
  are selected. The compare screen (`/leads/{id}/merge?with={other}`) shows both
  leads' values side by side; wherever they differ, the person picks the one
  that stays. Merging moves everything the other lead holds to the kept one in
  one transaction. The other lead stays as a merged record, and its page reads
  "LD-000124 was merged into LD-000123 · Sara", linking the kept lead.
- **Update the leads an import matches (M4-41).** A third choice for rows that
  match a lead already in the workspace: "Update that lead". The row's
  filled-in columns replace the lead's; its empty ones change nothing. The dead
  `MERGE` value is gone.
- **Check first (M4-42).** The import runs the same rows and options as a dry
  run, in a transaction that is always rolled back, and shows the report the
  import will give: created, updated, refused, and how many of those a lead
  already had.
- **Download rejected rows (M4-43).** The check and the report offer a CSV of
  the refused rows: the line, the reason, then the file's own columns as they
  were.

**No migration** (107 in all, as on `main`). `Lead.isMerged` and
`Lead.duplicateOfId` were already in the schema, and `findDuplicates` already
skipped merged leads. `MERGE` was a zod value, not a Postgres enum value.

**Why.** The Lead Eagle gap audit of 11 Oct:

- M4-31: no merge in either build.
- M4-41: no update strategy, and `onDuplicate: MERGE` was accepted by
  `POST /api/v1/leads` and did what WARN does.
- M4-42: no server-side dry run.
- M4-43: no error file.

**Where** (under `apps/web/src/`)

- `services/leads/merge.ts` (new): `mergeLeads` and `MERGE_FIELDS`, the fields
  the compare screen offers.
- `app/api/v1/leads/[id]/merge/route.ts` (new): `POST`, `leads:EDIT`,
  `productModule: LEAD_MODULES`. A field this role may not write, or sees
  masked, is dropped from `take`.
- `app/(workspace)/[workspaceSlug]/sales/leads/[id]/merge/` (new): `page.tsx`
  (both leads in the viewer's EDIT scope, else not found) and `MergeForm.tsx`.
  Re-exported under `realty/leads/[id]/merge/` and `lead-eagle/leads/[id]/merge/`;
  `tests/unit/realty-routes.spec.ts` and `lead-eagle-routes.spec.ts` cover them.
- `sales/leads/[id]/page.tsx`: the duplicate notice (`mergeable`: the
  `findDuplicates` matches in the viewer's EDIT scope, shown to roles with
  `leads:EDIT`), and a merged lead's page (`mergedInto`).
- `sales/leads/LeadGrid.tsx`: Merge in the bulk bar with two leads selected.
- `app/api/v1/leads/import/route.ts`: `onDuplicate` takes `UPDATE`, the body
  takes `dryRun`, and the answer adds `dryRun`, `updated` and `duplicates` to
  `created` and `failed`. Its `IMPORT_STARTED` audit row moved into the handler,
  so a dry run writes none, and it now carries the counts.
- `services/leads/createLead.ts` and `updateLead.ts`: `opts.dryRun`, the
  caller's transaction. Every read goes through it, `createLead` takes a
  stand-in reference instead of the next number, and nothing runs after commit.
  `refuseDuplicate` and `findDuplicates` take the client to read through.
- `lib/db.ts`: `withTx` takes Prisma's `timeout`; the dry run allows 120 s.
- `app/api/v1/leads/route.ts`: `onDuplicate` is `BLOCK` or `WARN`.
- `sales/leads/LeadImport.tsx`: the duplicate select, Check first, the update
  count and Download rejected rows.
- `lib/leads/importMapping.ts`: `rejectedRowsCsv`.
- `lib/csvCell.ts` (new): `csvCell` moved out of `lib/csv.ts`, which re-exports
  it, so the browser can build a CSV (`lib/csv.ts` reads server settings).

**Behaviour.** For customers on production:

- **Lead page.** A role with `leads:EDIT` sees a notice above a lead that the
  duplicate rules match with another lead it may edit, with "Compare and
  merge". A merged-away lead's address shows where it went, to whoever could
  open it before.
- **Merging.** The kept lead takes:
  - everything on the other lead: timeline activities, tasks, follow-ups,
    documents, stage, assignment and score history, calls, messages and
    conversations, requirements and the client profile, site visits,
    bookings, opportunities, tickets, form submissions, campaign queue
    entries, proposals, testimonials, referrals, detected requirements,
    reserved units and field visits;
  - its other numbers, project and listing interests, event invitations and
    custom values, each unless the kept lead has that one already;
  - the values picked on the compare screen, and the other's columns where its
    own are empty;
  - both leads' tags, the higher of the two scores (with a score history row
    "Merged with LD-…"), the later last activity, the earlier first contact.

  Its next follow-up is worked out again. It keeps its reference, stage and
  owner. Leads closed out as a duplicate of the other now name the kept one.
  Both leads are audited: a `mergedFrom` row and the field changes on the
  kept one, and `isMerged`, `duplicateOfId` and `deletedAt` on the other.

- **Import screen.** The checkbox "Also import rows that match a lead…" is now
  a select: Skip them (the default, as before), Update that lead, or Import
  them as new leads. Check first runs a dry run; changing the mapping or the
  choice clears its report. The report adds "N leads updated." and Download
  rejected rows.
- **API.** `POST /api/v1/leads` with `onDuplicate: MERGE` now answers 422; it
  used to create the lead as WARN does. `POST /api/v1/leads/import` takes
  `onDuplicate: UPDATE` and `dryRun: true`. Its answer gains `dryRun`,
  `updated` and `duplicates`.

**Decisions taken.** The brief has no DECISION item for this part. The choices
below are this change's design choices:

- **Permission.** A merge needs `leads:EDIT` over both leads, not
  `leads:DELETE`. Nothing is lost: every record moves to the kept lead and the
  other stays resolvable, as closing a lead out as a duplicate needs EDIT too.
  It also lets a rep who owns both copies clean them up; reps hold no DELETE.
- **What stays behind.** A record the kept lead already holds once per number,
  project, listing, event or field stays on the merged lead rather than being
  deleted. So do its allocation-queue entries, which are its own waiting
  history; the queue already drops deleted leads.
- **Numbers.** The main number that is no longer the main becomes an other
  number on the kept lead ("Main number of LD-…").
- **What the duplicate notice names.** Only leads in the viewer's EDIT scope,
  since a merge needs both. A role that sees a phone or email masked is not
  offered it on the compare screen.
- **UPDATE.** It goes through `updateLead`, so it is scoped, checked for
  duplicates and audited as an edit on the lead page. The first (most
  confident) match is updated. A phone or email the role sees masked is left
  as it is, which closes the open item in
  `2026-10-11-lead-contact-masking.md` about MERGE. A match outside the
  importer's EDIT scope is refused with the BLOCK sentence and counted as a
  duplicate.
- **Dry run.**
  - One transaction, rolled back, so a number repeated further down the file
    reports what the commit will do. Each row sits behind a savepoint.
  - The lead takes a stand-in reference, so the reference counter is not held
    locked against every other new lead in the workspace until the rollback.
- **Rejected rows file.** Built in the browser from the file's own cells. It
  lists the rows refused before sending (problems, and the repeats a skip
  leaves out) as well as those the server refused. Cells go through
  `csvCell`, so a formula is prefixed with `'`; a plain number such as
  `+971501234567` is left a number, as in every export.

**Verified** (rig `C:/ymw/pt`, logs `C:/ymw/logs/r4-4e2-*.log`).

- **New specs.**
  - `tests/sales/lead-merge.spec.ts` (4 cases):
    - children moved, numbers once, values picked, score and next follow-up
      worked out again, both leads audited, the old page names the kept lead,
      a second merge 404s;
    - the duplicate notice links the compare screen and leaves out another
      rep's copy;
    - 404 for a lead outside the caller's EDIT scope, either way round; their
      team manager may merge them;
    - 422 for a lead merged into itself, 403 without `leads:EDIT`.
  - `tests/sales/lead-import.spec.ts`: the BLOCK case now also checks
    `duplicates`, plus five cases:
    - MERGE refused on the import and on create;
    - UPDATE fills a new email without blanking the company or city, and the
      edit is audited;
    - UPDATE leaves a match outside the importer's scope and reports it as a
      duplicate;
    - a dry run writes no lead, activity, number or audit row, and the commit
      then reports the same;
    - `rejectedRowsCsv`: BOM, line order, the file's cells, formulas prefixed.
- **Fail-before.** With the source stashed (f3d78ad9):
  - the merge spec cannot load ("Cannot find package" for the merge route);
  - the import spec fails 6 of 7: `expected undefined to be 1` (`duplicates`);
    `expected 200 to be 422` (MERGE on create); 422 "Invalid enum value …
    received 'UPDATE'" twice; 422 "Unrecognized key(s) in object: 'dryRun'";
    `rejectedRowsCsv is not a function`.
  - After: 11/11.
- **E2E.** `tests/e2e/lead-merge-import.spec.ts`, Lead-Eagle-only workspace,
  2/2:
  - merge from the notice, with the compare screen at 390 px, the kept
    lead's timeline and the merged lead's page;
  - check first, then import with Update, then the downloaded file's bytes.

  On f3d78ad9 its first test fails: "May be the same person as LD-000002" is
  not found. The second, serial, does not run. Also run:
  `lead-bulk-stage` (2/2) and `lead-eagle-workspace` (1/1). `lead-import`,
  `lead-close-out` and `business-journey` need the demo workspace's
  credentials and were skipped on this rig. The compare screen, the notice and
  the import's check were seen at 390 px in the dark theme.

- **Broad runs.**
  - `tests/sales`: 62 files, 807 passed.
  - `tests/permission` with `tests/unit`: 87 files, 2030 passed, 2 skipped.
  - `tests/tenant` without the retention specs: 19 files, 193 passed. Then
    each alone: `retention` 5, `audit-retention` 7, `document-purge` 1,
    `credential-purge` 23.
  - `tests/security` with `tests/platform`: 55 files, 686 passed.
- **Static checks.** `tsc --noEmit` clean; eslint 0 errors (7 warnings, all in
  untouched lines); prettier clean.

**Left open.**

- Searching the lead grid for a merged lead's reference finds nothing; its
  address resolves. The lead search is round 3's
  (`2026-10-13-lead-views-kanban-calendar-search.md`).
- Marketing-list memberships, automation enrolments and webhook deliveries
  name a lead by id without a foreign key; they stay with the merged lead.
  Notifications open its page, which names the kept lead.
- A merge has no undo. The audit holds both sides, and the merged lead's row
  and what stayed on it remain.
- The screen checks a file in batches of 500 rows. Under Update, a row
  repeating one from an earlier batch reads as new in the check.
- A dry run holds the leads Update matches locked until it ends (seconds for
  500 rows).
