# Lead Eagle move tool: the report names every person and row it drops

**What.** The standalone-company move tool's dry-run and commit reports now
count every row that loses its person and every row that stays behind, in the
style of the existing orphan lines. A company with no leads can be moved (it
crashed), and only once (the guard counted leads).

**Why.** Lead Eagle gap audit of 11 Oct, PLAN-06 (and the "Left open" of
[the move-tool gaps entry](2026-10-10-move-tool-gaps.md)): an activity or a
stage change by someone without an account here moved with no person
(`changedById` and `ownerId` null) and nothing said so; a record owned by
someone deleted in Lead Eagle moved unowned unnamed (the per-person line knew
only the users the reader returns); follow-ups, activities and enquiries on
merged-duplicate or deleted leads, and calls on deleted cold data, were
skipped without a word — the calls were even counted as moved. The
already-moved guard keyed on moved leads, so a company with none was
unguarded; in practice such a company could not be moved at all, because the
check sample read a lead that did not exist.

**Where** (under `apps/web/`)

- `src/services/platform/leadEagleMove.ts` — `lost()` names the ids `owned()` turns to null; the per-person line counts from one list of record owners, and owners outside the snapshot's users get their own line; the timeline counts activities and stage changes that lose their person and rows on records that did not move; follow-ups count those left behind; the sample check skips when there are no leads; a commit writes a platform audit row `LEAD_EAGLE_COMPANY_MOVED` (company id, slug, counts), and the guard refuses when that row or a marked lead exists.
- `tests/platform/lead-eagle-move.spec.ts` — the two cases below; `afterAll` deletes the spec's audit rows.

**Behaviour.** The report's `problems` (printed by
`scripts/move-lead-eagle.ts` for both runs) can now also say:

- "N records are owned by people no longer in Lead Eagle; they move unowned."
- "N activities were logged by someone without an account here; they move without who logged them."
- "N stage changes were made by someone without an account here; they move without who made them."
- "N activities and enquiries are on merged duplicates or deleted records, which stay behind; they are not moved."
- "N follow-ups are on merged duplicates or deleted leads, which stay behind; they are not moved."

The "activities and enquiries" count no longer counts a call on deleted cold
data as moved. Each commit leaves one row on the platform audit trail
(actor: system); a dry run leaves none. Nothing else moves differently: the
rows still move without their person, and the left-behind rows still stay
behind.

**Verified.** `tests/platform/lead-eagle-move.spec.ts` (8, real database).
On the old code both new cases fail: the dry run with a ghost-logged note, a
removed owner's lead and rows on a merged lead and on deleted cold data lacks
all five new lines (`expect(report.problems)`), and moving a lead-less company
throws `Cannot read properties of undefined (reading 'primaryPhone')` at the
sample check. With the sample fix but without the audit-row guard, the second
move of that company commits (`rejects.toThrow('was already moved')` resolves).
All 8 pass after; `tests/platform` 17 of 17; `tsc` clean; ESLint and Prettier
clean on the touched files.

**Left open.**

- Rows on merged duplicates are reported, not moved onto the surviving lead; the reader would need `mergedIntoId` to re-point them.
- The cold-data list still drops the person of every migrated call (they join the record's notes as text), matched or not.
- Two commits started at the same moment are not serialised; the guard is a read before the transaction.
