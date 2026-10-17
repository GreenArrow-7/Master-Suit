# Lead Eagle move tool: every table it leaves behind is counted, every author it loses is named

**18 Oct 2026** · fix · Lead Eagle, data migration (audit MIG-01, -05, -07, -08, -13)

**What.** (#208) The standalone-company move tool's reader (`scripts/move-lead-eagle.ts`)
now counts every standalone table that holds the company's rows and is not
moved, read from the standalone's own catalogue, instead of a hand list of
twelve. The report now names, by email, each person without an account who
logged activities or made stage changes (MIG-05), not only those who own
records. The 11 Oct audit rows for the tool were re-checked on main: three
were already met. MIG-07 and MIG-13 were already tested; MIG-08 gains the new
60-stage-change case.

**Why.** The hand list missed twelve tables the standalone writes — teams,
branches, the call playbook, attendance shift tasks and templates, portal
publications, proposal lines, telephony settings, the intake log, its roles,
its audit log and custom-field values — so a move dropped them without a line
in the report. A list of what the move reads cannot drift that way: a table
the standalone gains later is counted too. Activities and stage changes by
someone without an account were counted in an unnamed line, so a person whose
only rows were history never appeared in the report; the operator, told to
invite the people it names before the commit, could not invite them, and the
history moved with no author.

**Where** (under `apps/web/`)

- `src/services/platform/leadEagleMove.ts` — `name()`: one line per person without an account, by email, and one for people deleted in Lead Eagle; used for owned records, activities and stage changes.
- `scripts/move-lead-eagle.ts` — `READ` (the 17 tables the move reads) and `EPHEMERAL` (`Session`, `IdempotencyKey`); every other table with a `tenantId` column, from `information_schema.columns`, is counted into `notMoved`.
- `tests/platform/lead-eagle-move.spec.ts` — the reader against a stand-in client; a moved lead with 60 stage changes paged through `GET /api/v1/leads/{id}/timeline`; the ghost's activity and stage change named.

**Behaviour.** The dry-run and commit reports' "Not moved (rows)" table now
also lists `AuditLog`, `Branch`, `CallPlaybookEntry`, `CustomFieldValue`,
`IntakeEvent`, `ListingPublication`, `ProposalItem`, `Role`, `ShiftTask`,
`ShiftTaskTemplate`, `Team` and `TelephonyConfig` when the company has rows in
them (every standalone workspace starts with a branch, playbook entries and a
pool assignment rule, so those always show). What moves is unchanged.

The problems list replaces the two unnamed history lines with named ones:

- "x logged N activities but has no account here; they move without who logged them."
- "x made N stage changes but has no account here; they move without who made them."
- "N activities were logged by people no longer in Lead Eagle; …" and the same for stage changes, for authors deleted in Lead Eagle (no email to name).

**Re-checked on main (already met).** MIG-05 was claimed here at first; its
history lines counted but did not name, so it is built above.

- MIG-07 — nationality and the secondary owner move (`leadEagleMove.ts:433,439`; spec asserts both on the moved leads); rows on merged duplicates are reported (`leadEagleMove.ts:623-627,665-669`).
- MIG-08 — the lead's timeline names who made each stage change (`services/leads/timeline.ts:329`, `LeadDetail.tsx:1310`) and pages with Show older (`timeline.ts:132-142`, `LeadDetail.tsx:1161-1172,1345`); the new case shows all 60 moved stage changes, each with the agent's name.
- MIG-13 — a second commit of a company with no leads is refused by its `LEAD_EAGLE_COMPANY_MOVED` audit row, keyed on workspace and company id (`leadEagleMove.ts:303-316`; spec "moves a company with no leads once").

**Not built, and why.** Custom fields: the standalone has no code that creates
them (schema only), so no company holds any; they are counted. Assignment
rules, teams and branches: left out of this lane, not impossible. A new Lead
Eagle workspace already assigns automatically, so a moved company keeps
assigning without them; they are counted (see Left open). Media: the files
live in the standalone's object store, and moving rows without the files would
leave broken pictures; counted.

**Verified.** `tests/platform/lead-eagle-move.spec.ts` 10 of 10. On main the
reader case fails (`notMoved` held the twelve listed tables, not the four the
stand-in catalogue leaves behind). Before the MIG-05 fix the two cases that
expect the ghost named failed (2 failed, 8 passed); the 60-stage-change case
passes on main (MIG-08 was already met). With `tests/sales/lead-timeline.spec.ts` (9), 19 of 19. `tsc` clean.

**Left open.**

- MIG-01: the move has not run for a real company. The owner confirms whether a real standalone database exists; if so, `LEAD_EAGLE_DATABASE_URL` and a dry run from a machine that reaches both databases.
- Moving media needs read access to the standalone's object store, if a real one exists.
- Moving assignment rules, teams and branches, if a real company has them. Most of a standalone `AssignmentRule` has a target here: `sourceIds` and `projectIds` map to `DistributionRule.conditions`, `userIds` to its pool, and its `teamId` and `branchId` to `Team` and `Branch` (which would move first). `locations` matches the lead's preferred areas, not the city a rule here matches, and `budgetMin`/`budgetMax` and `purposes` have no counterpart; those conditions would be reported.
- Two commits started at the same moment are still not serialised (the guard is a read before the transaction).
