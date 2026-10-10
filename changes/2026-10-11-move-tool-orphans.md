# Lead Eagle move tool: the report names the people and rows it drops

**What.** The standalone-company move tool's dry-run and commit reports now
count the rows that lose their person and the rows that stay behind, in the
style of the existing orphan lines. A company with no leads can be moved (it
crashed), and only once (the guard counted leads).

**Why.** Lead Eagle gap audit of 11 Oct, PLAN-06 (and the "Left open" of
[the move-tool gaps entry](2026-10-10-move-tool-gaps.md)): an activity or a
stage change by someone without an account here moved with no person
(`changedById` and `ownerId` null) and nothing said so; a record owned by
someone deleted in Lead Eagle moved unowned unnamed (the per-person line knew
only the users the reader returns); follow-ups, activities and enquiries on
merged-duplicate or deleted leads, calls on deleted cold data, units of a
deleted project and commissions on a booking that stayed behind were skipped
without a word — the calls were even counted as moved. The already-moved
guard keyed on moved leads, so a company with none was unguarded; in practice
such a company could not be moved at all, because the check sample read a
lead that did not exist.

**Where** (under `apps/web/`)

- `src/services/platform/leadEagleMove.ts` — `lost()` names the ids `owned()` turns to null; the per-person line counts from one list of record owners, and owners outside the snapshot's users get their own line; the timeline counts activities and stage changes that lose their person and rows on no lead that moved; an activity on deleted cold data moves onto its lead when it names one that moved; follow-ups, units and commissions count those left behind; the sample check skips when there are no leads; a commit writes a platform audit row `LEAD_EAGLE_COMPANY_MOVED` (company id; flat metadata: slug, lead count), and the guard refuses when that row or a marked lead exists, naming which.
- `tests/platform/lead-eagle-move.spec.ts` — the two cases below, and the commit case now pins the stage-change line and the absence of the others; `afterAll` deletes the spec's audit rows.

**Behaviour.** The report's `problems` (printed by
`scripts/move-lead-eagle.ts` for both runs) can now also say:

- "N records are owned by people no longer in Lead Eagle; they move unowned."
- "N activities were logged by someone without an account here; they move without who logged them."
- "N stage changes were made by someone without an account here; they move without who made them."
- "N activities and enquiries are on merged duplicates, deleted records or no record; they stay behind."
- "N follow-ups are on merged duplicates or deleted leads; they stay behind."
- "N units are on projects that did not move; they stay behind."
- "A commission of AED X is on booking REF, which did not move; it stays behind."

The "activities and enquiries" count no longer counts a call on deleted cold
data as moved; such a call that also names a lead that moved now moves onto
that lead's timeline. Each commit leaves one platform audit row (actor:
system); a dry run leaves none. That row also shows in the moved-into
workspace's own Admin › Audit log, under All and under the Sign-in tab (where
every non-read platform event for a workspace already lands), as "System ·
Lead Eagle Company Moved · slug=… · leads=N". A second move of the same
company is refused with "(N leads)" or, for a company without leads, "(audit
record of DATE)". Nothing else moves differently: the rows still move without
their person, and the left-behind rows still stay behind.

**Verified.** `tests/platform/lead-eagle-move.spec.ts` (8, real database).
On main both new cases fail: the dry run with a ghost-logged note, a removed
owner's lead and rows on a merged lead and on deleted cold data lacks the new
lines (`expect(report.problems)`), and moving a lead-less company throws
`Cannot read properties of undefined (reading 'primaryPhone')` at the sample
check. With the sample fix but without the audit-row guard, the second move
of that company commits (`rejects.toThrow('was already moved')` resolves). The
review round's additions fail on the first version of this change: the units
and commission lines are missing and the deleted-record note on a moved lead
is left behind (spec:506), the audit metadata nests the counts (spec:658), and
the refusal reads "(0 leads)" (spec:659); on main the commit case lacks the
stage-change line (spec:527). All 8 pass after; `tests/platform` 17 of 17;
`tsc` clean; ESLint and Prettier clean on the touched files.

**Left open.**

- Rows on merged duplicates are reported, not moved onto the surviving lead; the reader would need `mergedIntoId` to re-point them.
- The cold-data list still drops the person of every migrated call (they join the record's notes as text), matched or not.
- Two commits started at the same moment are not serialised; the guard is a read before the transaction.
- A re-run after undoing a move by hand is refused while its audit row stands; removing that row is a database step, which the product itself never takes.
- For a company without leads the guard is the audit row alone, so it lasts only while `PLATFORM_AUDIT_RETENTION_DAYS` keeps the row (unset, the default, keeps it for ever).
- The workspace Audit log files the move row under Sign-in, like every other non-read platform event; a tab of its own is a page change.
