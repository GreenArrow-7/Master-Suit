# Lead Eagle, phase 5: moving a standalone Lead Eagle company in

**What.** The tool that moves one company from the standalone Lead Eagle into
a YOUHAN ONE workspace ([plan](2026-10-05-lead-eagle-plan.md), phase 5), PR
#132, stacked on phase 3 (#131).

**Why.** The owner's decision of 5 Oct: move the standalone app's data. On
7 Oct the standalone had no deployment and no git remote, and its only
database (the developer machine's docker copy) held test and seed companies —
so this is the tool, proven on the seed company Meridian, ready for a real copy.

**Where** (under `apps/web/`)
- `scripts/move-lead-eagle.ts` — reads one company from the standalone's database (as its platform admin) into a snapshot; the CLI.
- `src/services/platform/leadEagleMove.ts` — writes the snapshot into the workspace, in one transaction.

**How to run it**
1. In the platform portal, make the company's workspace with Lead Eagle, and
   invite its people with the emails they use in Lead Eagle.
2. From `apps/web`, with `.env` pointing at YOUHAN ONE's database and the
   standalone's URL in the environment (never on the command line):
   `LEAD_EAGLE_DATABASE_URL=… npx tsx --env-file=.env scripts/move-lead-eagle.ts --company <lead eagle slug> --into <workspace slug>`
   — a dry run: every write is made, counted and sample-checked, then rolled
   back. Read the report: people without accounts, owners missing, what stays
   behind.
3. Put the standalone app in read-only, then run it again with `--commit`, and
   `--enable-real-estate` when the report says the company has projects,
   listings or bookings (Lead Eagle's own menu does not show them).
4. A second `--commit` into the same workspace is refused.

**Behaviour — what moves, and where**
- People: matched by email, never created. Records of someone without an
  account move unowned; a follow-up or booking, which must have an owner, goes
  to the workspace's first Company Admin. Both are reported.
- Statuses → lead stages (by key; a stage of the same key is reused and gains
  the reasons); sub-statuses → the stage's reasons; a lead's sub-status (or
  lost reason) → its `stageReason`.
- Leads: new references (the old one is kept in `customData.leadEagle`),
  numbers (main and others), source and campaign as `sourceDetail`, tags,
  notes, score, dates; project interest becomes a line in the notes; purpose,
  property types, bedrooms, budget and areas → a client requirement. Merged
  duplicates stay behind.
- Timeline: notes, calls (direction, outcome, duration), emails, meetings and
  visits → activities; status changes → stage history; enquiries → "Enquiry
  via …" notes, once (Lead Eagle stored each twice).
- Follow-ups → follow-up tasks; cold data → cold data, its calls joining the
  record's notes; QR links → QR links (counts kept).
- Projects (developer found or created), units, listings (landlord as an
  owner record) → Real Estate's; a listing without a price stays behind, as a
  listing here must have one. Bookings get new references (the old one in
  notes); commissions to someone without an account (an outside channel
  partner) stay behind, reported with the amount.
- Not moved, counted in the report: proposals, media files, payment plans,
  custom fields, saved views, assignment rules, integrations (reconnect them
  under Lead sources), attendance set-up, call recordings, portal feeds.

**Verified.** `tests/platform/lead-eagle-move.spec.ts` (3, real database): a
dry run writes everything and keeps nothing; a commit moves every table with
the mappings above, including unmatched people, owner fallbacks, an unpriced
listing, an external commission and the twice-written enquiry, and enables
Real Estate when asked; a second commit is refused. Against the standalone's
local database: Meridian dry-ran, then moved into a fresh Lead-Eagle-only rig
workspace — 262 leads, 243 requirements, 197 activities and enquiries, 148
follow-ups, 90 cold-data records, 2 QR links, 4 projects, 144 units, 8
listings, 9 bookings, 9 of 12 commissions (3 owed to a channel partner); a
second run was refused. In a browser as Meridian's admin, 32 checks at 1280
and 390 px: leads, a lead's timeline, cold data, projects, listings and
commissions, no sideways scroll, no page errors.

**Left open**
- Where it runs for a real company: a machine that reaches both databases
  (production's image may not carry `tsx`); decided with the owner at cut-over.
- Media files (photos in the standalone's object storage) are not copied.
