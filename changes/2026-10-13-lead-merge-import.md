# Two leads merge into one; a lead import can update the leads it matches, be checked first, and hand back its refused rows

**What.** Part 4E (merge and import) of the owner's brief "Build to completion:
Lead Eagle M4 Leads, M5 Cold data, M6 Lead intake", rows M4-31, M4-41, M4-42
and M4-43, for every lead module. Branch `feat/lead-merge-import`, from `main`
at f3d78ad9, merged up with `main` at fa01771f (#177, #178) after review, and
again at fe5ecc75 (#179) and 4bb6078b (#180).

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

- `services/leads/merge.ts` (new): `mergeLeads`, `assertMayMerge` (who may
  merge two given leads) and `MERGE_FIELDS`, the fields the compare screen
  offers.
- `app/api/v1/leads/[id]/merge/route.ts` (new): `POST`, `leads:EDIT`,
  `productModule: LEAD_MODULES`. It hands the service the role's field rules:
  a field this role may not write, or sees masked, stays the kept lead's.
- `app/(workspace)/[workspaceSlug]/sales/leads/[id]/merge/` (new): `page.tsx`
  (both leads in the viewer's EDIT scope, else not found; `assertMayMerge`,
  else not found or forbidden) and `MergeForm.tsx`. Re-exported under
  `realty/leads/[id]/merge/` and `lead-eagle/leads/[id]/merge/`;
  `tests/unit/realty-routes.spec.ts` and `lead-eagle-routes.spec.ts` cover them.
- `sales/leads/[id]/page.tsx`: the duplicate notice (`mergeable`: the
  `findDuplicates` matches the viewer could merge this lead with, shown to
  roles with `leads:EDIT`), and a merged lead's page (`mergedInto`).
- `sales/leads/LeadGrid.tsx`: Merge in the bulk bar with two leads selected.
- `app/api/v1/leads/import/route.ts`: `onDuplicate` takes `UPDATE`, the body
  takes `dryRun` (at most 500 rows), and the answer adds `dryRun`, `updated`
  and `duplicates` to `created` and `failed`. Its `IMPORT_STARTED` audit row
  moved into the handler and carries the counts and `dryRun`. The route has a
  rate limit of 60 calls a minute per person.
- `services/leads/createLead.ts` and `updateLead.ts`: `opts.dryRun`, the
  caller's transaction. Every read goes through it, `createLead` takes a
  stand-in reference instead of the next number, and nothing runs after commit.
  `refuseDuplicate` and `findDuplicates` take the client to read through.
- `lib/db.ts`: `withTx` takes Prisma's `timeout`; the dry run allows 120 s,
  a merge 30 s. The tenant guard knows `updateManyAndReturn` (the merge's
  moves return what they moved), as it knows `updateMany`.
- `app/api/v1/leads/route.ts`: `onDuplicate` is `BLOCK` or `WARN`.
- `sales/leads/LeadImport.tsx`: the duplicate select, Check first (and its note
  when a file was checked in parts), the update count and Download rejected
  rows.
- `lib/leads/importMapping.ts`: `rejectedRowsCsv`.
- `lib/csvCell.ts` (new): `csvCell` moved out of `lib/csv.ts`, which re-exports
  it, so the browser can build a CSV (`lib/csv.ts` reads server settings).

**Behaviour.** For customers on production:

- **Lead page.** A role with `leads:EDIT` sees a notice above a lead it may
  edit that the duplicate rules match with another lead it could merge it
  with, with "Compare and merge". A merged-away lead's address shows where it
  went, to whoever could open it before.
- **Who may merge.** Both leads in the caller's `leads:EDIT` scope. Leads
  different people own: the other lead's person passes to the kept lead's
  owner, so the role also needs `leads:ASSIGN` or `leads:REASSIGN` reaching
  that owner, as reassigning on the lead page does (403 otherwise). A lead
  with no owner: only a role that may claim one (ASSIGN or REASSIGN wider than
  its own leads: `leadScope`'s `includeUnassigned` rule; 404 otherwise). The
  notice, the compare screen and the route apply the same rule.
- **Merging.** The kept lead takes:
  - everything on the other lead: timeline activities, tasks, follow-ups,
    documents, stage, assignment and score history, calls, messages and
    conversations, requirements, site visits, bookings, opportunities,
    tickets, form submissions, campaign queue entries, proposals,
    testimonials, referral codes, the referrals it made, detected
    requirements, reserved units and field visits;
  - its other numbers, project and listing interests, event invitations and
    custom values, each unless the kept lead has that one already; its client
    profile and the referral that brought it in, unless the kept lead has a
    live one (one per lead); a referral between the two leads stays behind,
    since the kept lead would refer itself;
  - the values picked on the compare screen, and the other's columns where its
    own are empty, except a column the role may not write or sees masked;
  - both leads' tags, the higher of the two scores (with a score history row
    "Merged with LD-…"), the later last activity, the earlier first contact.

  Its next follow-up is worked out again. It keeps its reference, stage and
  owner. Leads closed out as a duplicate of the other, or merged into it
  before, now name the kept one; if the kept lead was itself closed out as a
  duplicate of the other, it no longer names anyone. Both leads are audited:
  a `mergedFrom` row on the kept one naming every record that moved (ids by
  model) and every lead re-pointed, its field changes, and `isMerged`,
  `duplicateOfId` and `deletedAt` on the other.

- **Import screen.** The checkbox "Also import rows that match a lead…" is now
  a select: Skip them (the default, as before), Update that lead, or Import
  them as new leads. Under Update, a row's number the lead does not hold is
  added as another number ("From an import"); the lead's main number changes
  only where it had none. Check first runs a dry run; changing the mapping or
  the choice clears its report, and a file over 500 rows checked under Update
  says it was checked in parts. The report adds "N leads updated." and
  Download rejected rows.
- **API.** `POST /api/v1/leads` with `onDuplicate: MERGE` now answers 422; it
  used to create the lead as WARN does. `POST /api/v1/leads/import` takes
  `onDuplicate: UPDATE` and `dryRun: true` (a dry run takes at most 500 rows,
  else 422). Its answer gains `dryRun`, `updated` and `duplicates`. The route
  now answers 429 past 60 calls a minute per person. Every call, dry run or
  not, writes one `IMPORT_STARTED` audit row with the counts.

**Decisions taken.** The brief has no DECISION item for this part. The choices
below are this change's design choices:

- **Permission.** A merge needs `leads:EDIT` over both leads, not
  `leads:DELETE`. Nothing is lost: every record moves to the kept lead and the
  other stays resolvable, as closing a lead out as a duplicate needs EDIT too.
  It also lets a rep who owns both copies clean them up; reps hold no DELETE.
  Because the other lead's person passes to the kept lead's owner, leads
  different people own need what that reassignment needs on the lead page,
  and an unassigned lead needs the right to claim it; a second owner of a
  lead may not merge it away.
- **What stays behind.** A record the kept lead already holds once per number,
  project, listing, event or field stays on the merged lead rather than being
  deleted, as does a second live client profile, a second referral of the
  person, and a referral between the two leads. So do its allocation-queue
  entries, which are its own waiting history; the queue already drops deleted
  leads.
- **Numbers.** The main number that is no longer the main becomes an other
  number on the kept lead ("Main number of LD-…").
- **Field rules.** A column the role may not write, or sees masked, is neither
  offered on the compare screen nor filled in from the other lead; it stays
  on the merged lead.
- **What the duplicate notice names.** Only leads the viewer could merge this
  one with (the rule above), and only on a lead in their EDIT scope.
- **UPDATE.** It goes through `updateLead`, so it is scoped, checked for
  duplicates and audited as an edit on the lead page. The first (most
  confident) match is updated; a duplicate rule on the name alone never picks
  it (the row goes on to create, which refuses it as Skip does). A phone or
  email the role sees masked is left as it is, which closes the open item in
  `2026-10-11-lead-contact-masking.md` about MERGE. A number the lead does not
  hold is added as another number rather than replacing its main one. A match
  outside the importer's EDIT scope is refused with the BLOCK sentence and
  counted as a duplicate.
- **Dry run.**
  - One transaction, rolled back, so a number repeated further down the file
    reports what the commit will do. Each row sits behind a savepoint.
  - The lead takes a stand-in reference, so the reference counter is not held
    locked against every other new lead in the workspace until the rollback.
    A reason that would name it says "a lead an earlier line creates".
  - At most 500 rows (the screen's batch), and a rate limit on the route, since
    the check holds one pooled connection until it ends. Its audit row is
    written after the rollback.
- **Rejected rows file.** Built in the browser from the file's own cells. It
  lists the rows refused before sending (problems, and the repeats a skip
  leaves out) as well as those the server refused. Cells go through
  `csvCell`, so a formula is prefixed with `'`; a plain number such as
  `+971501234567` is left a number, as in every export.

**Verified** (rig `C:/ymw/pt`, logs `C:/ymw/logs/r4-4e2-*.log`).

- **New specs.**
  - `tests/sales/lead-merge.spec.ts` (10 cases):
    - children moved, numbers once, values picked, score and next follow-up
      worked out again, both leads audited, the old page names the kept lead,
      a second merge 404s;
    - the duplicate notice links the compare screen and leaves out another
      rep's copy;
    - 404 for a lead outside the caller's EDIT scope, either way round; their
      team manager may merge them;
    - 422 for a lead merged into itself, 403 without `leads:EDIT`;
    - both leads with a live client profile and a referral, plus a referral
      between them: 200, each stays where the indexes allow; messages,
      conversations and assignment history move; the audit row lists their
      ids; a kept lead closed out as the other's duplicate names no one;
    - a shared project and custom field, the other's number taken as the
      main one (the kept one relabelled), and a lead merged twice naming the
      last;
    - a second owner and a rep on an unassigned lead refused (403, 404), a
      team editor without ASSIGN refused across owners but not for one
      owner's two leads, the team manager allowed;
    - the notice: none on a lead the viewer sees but does not edit, none for
      another owner's lead to a role that may not reassign;
    - the compare screen: 404 out of scope either way, 403 across owners for
      a rep and for a VIEW-only role;
    - a masked role: the kept lead's phone and email stay, no WhatsApp number
      or second email filled in.
  - `tests/sales/lead-import.spec.ts` (12 cases): the BLOCK case checks
    `duplicates`; MERGE refused on the import and on create; UPDATE fills a
    new email while `company: ''` and `city: '   '` change nothing (no audit
    row for them, nor for the phone); a new number is added as another number
    and a match by another number keeps the main one; a name-only rule picks
    no lead to fill; a masked importer's email stays; a match out of scope is
    a duplicate; the dry run writes no lead, activity, number or audit row but
    its own `IMPORT_STARTED` (`dryRun: true`), queues nothing, and the commit
    reports the same; under Skip, a 409 row and a row Postgres refuses (a NUL)
    leave the next row created in the check as in the commit; 501 rows in a
    dry run is a 422; `rejectedRowsCsv`.
- **Fail-before.**
  - With the source stashed (f3d78ad9) the merge spec cannot load, and the
    first seven import cases fail as recorded on the first commit
    (`duplicates` undefined, MERGE accepted, UPDATE and `dryRun` refused,
    `rejectedRowsCsv is not a function`).
  - The review's fixes, against 9d1e0178 (the merged-up branch before them):
    5 of the 10 merge cases fail (logs `r4-4e3-failbefore-merge.log`): "This
    client profile already exists" (409, not 200); a second owner's merge
    `expected 200 to be 403`; the notice on a lead the viewer cannot edit
    contains `/merge?with=`; the compare screen across owners resolves instead
    of refusing; the masked merge fills `whatsappNumber`. 5 import cases fail
    (`r4-4e3-failbefore.log`): a `phone` audit row for the same number
    retyped; the main number replaced by the row's; a name-only match
    updated; no `IMPORT_STARTED` row for the dry run; 501 rows run for over
    30 s instead of a 422.
  - Mutation checks for the cases that pin code already there
    (`r4-4e3-mutant-*.log`): without the dry run's savepoint the Skip case
    fails (`created: 0`); with empty cells let through the "never blanks" case
    fails; without the masked-field filter the masked import fails; without
    the merge's field filter the masked merge fails; without the dry run's
    early return in `createLead` `enqueue` is called 6 times.
  - After: merge 10/10, import 12/12.
- **E2E.** `tests/e2e/lead-merge-import.spec.ts`, Lead-Eagle-only workspace,
  2/2 (log `r4-4e3-e2e-2.log`, on the merged-up branch):
  - Merge in the lead list's bulk bar with the two selected (its address),
    then the notice, the compare screen at 390 px in the light and the dark
    theme, the kept lead's timeline and the merged lead's page;
  - check first, then import with Update, then the downloaded file's bytes.

  On f3d78ad9 its first test fails: "May be the same person as LD-000002" is
  not found. The second, serial, does not run. Also run
  (`r4-4e3-e2e-touched.log`): `lead-bulk-stage` 2/2, `lead-call-log` 1/1,
  `lead-contact-masking` 3/3, `lead-eagle-workspace` 1/1. `lead-import` and
  `lead-close-out` need the demo workspace's credentials (`E2E_DEMO_*`) and
  were skipped on this rig, as was `business-journey` in the first round.

- **Broad runs** (on the merged-up branch with the review's fixes).
  - `tests/sales`: 67 files, 878 passed.
  - `tests/permission` with `tests/unit`: 88 files, 2043 passed, 2 skipped.
  - `tests/tenant` without the retention specs: 19 files, 193 passed. Then
    each alone: `retention` 5, `audit-retention` 7, `document-purge` 1,
    `credential-purge` 23.
  - `tests/security` with `tests/platform`: 55 files, 686 passed.
- **Static checks.** `tsc --noEmit` clean; eslint 0 errors (2 warnings, on
  untouched lines of the lead page); prettier clean.
- **Merged up with `main` at fe5ecc75 (#179).** Only `changes/README.md` and
  `PROJECT.md` conflicted; the grid keeps #179's sort and #178's call cells
  with Merge in its bulk bar. Screens now: Sales 76, Real Estate 42, Lead
  Eagle 31 (#179's calendars and this branch's compare screens). 107
  migrations, none from this branch. `tsc` clean; eslint 0 errors; prettier
  clean. Vitest: the merge, import, saved-view, search, Kanban, call-log,
  timeline, calendar, entitlement, route and nav specs, 13 files, 869 passed;
  `tests/sales` with `tests/permission`, 95 files, 1678 passed, and the six
  files whose `beforeAll` timed out under that load passed alone (59). E2E,
  each alone on a fresh `.next`: `lead-merge-import` 2/2, `lead-views-board`
  5/5, `redesign-mobile` 3/3 (demo workspace). The compare screen's
  dark-theme check failed twice and passed on the third run: it read a card's
  colour inside the 180 ms theme fade, before a frame had run. It now polls.
- **Merged up with `main` at 4bb6078b (#180).** Only `changes/README.md`
  conflicted. The lead page takes #180's two transactions; its duplicate
  notice and merged-lead lookup run after them, one query at a time, so they
  add no fan-out. `tsc` clean; eslint 0 errors; prettier clean. Vitest:
  `lead-page-connections` with the merge, import, timeline, call-log, search,
  saved-view, Kanban and entitlement specs, 9 files, 120 passed (the
  call-log and timeline files' `beforeAll` timed out together and passed
  alone). E2E on a fresh `.next`: `lead-merge-import` 2/2, `redesign-mobile`
  3/3.

**Left open.**

- Searching the lead grid for a merged lead's reference finds nothing; its
  address resolves, which is what the brief asked of the old reference. The
  lead search is round 3's (`leadSearch`, #179,
  `2026-10-13-lead-views-kanban-calendar-search.md`); a "was merged into"
  answer there belongs with it.
- Marketing-list memberships, automation enrolments and webhook deliveries
  name a lead by id without a foreign key; they stay with the merged lead.
  Notifications open its page, which names the kept lead.
- A merge has no undo button. The kept lead's `mergedFrom` audit row lists
  every record that moved and every lead re-pointed, so one can be taken apart
  by hand; the merged lead's row and what stayed on it remain.
- The compare screen offers the columns in `MERGE_FIELDS`; workspace custom
  fields merge with the kept lead's values winning, without a choice.
- The screen checks a file in batches of 500 rows. Under Update, a row
  repeating one from an earlier batch reads as created in the check; the panel
  says so for such a file.
- A dry run holds the leads Update matches locked until it ends (up to tens
  of seconds for 500 rows on a loaded machine). There is no cap on how many
  dry runs run at once in a process, beyond the rate limit.
