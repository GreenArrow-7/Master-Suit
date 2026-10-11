# Lead Eagle move tool: the report tells the whole story, and the screens show what moved

**What.** Seven gaps in the standalone-company move tool
([phase 5](2026-10-07-lead-eagle-phase-5.md)) and the screens that show its
output, found by the 10 Oct audit of that note's claims.

**Why.** The note promised things the code did not do: it said to "invite"
people in the platform portal, which has no invite; it asked for Real Estate
when a company had projects or listings, which Lead Eagle shows itself, and
ignored commissions, which it does not; the report named a person without an
account only when they owned leads, and gave their follow-ups to the admin
silently; and three things the tool stored — bookings that moved as drafts, a
lead's source and campaign, its status history — had no screen. Nothing was
lost, but an operator reading the report, or an agent opening a moved lead,
could not see it.

**Where** (under `apps/web/`)
- `src/services/platform/leadEagleMove.ts` — `needsRealEstate` is bookings + commissions; the unmatched-person line counts leads, cold data, listings, QR links and held units; follow-ups given to the fallback owner are counted and reported; wording.
- `scripts/move-lead-eagle.ts`, `src/app/(platform)/platform/users/UserDrawer.tsx`, `changes/2026-10-07-lead-eagle-phase-5.md` — "invite" became "add them from the workspace's Admin > Users".
- `src/app/(workspace)/[workspaceSlug]/sales/collections/page.tsx` — lists every booking, not only confirmed ones, with a Draft / Cancelled badge; noun "booking". Real Estate > Collections re-exports it.
- `src/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx`, `LeadDetail.tsx` — the Source row shows `sourceDetail` after the category; the Timeline merges stage history (latest 50, stored times, a deleted stage named "a removed stage") with activities, newest first; the tab count includes them. Lead Eagle and Real Estate lead pages re-export it.
- `tests/helpers/render.ts` (new) — `strings()` / `pageText()` for reading a page server component's rendered tree in a test (the helper three specs each carried a copy of).
- `tests/platform/lead-eagle-move.spec.ts` — the cases below.
- The cold-data list's notes are the cold-data change of the same day.

**Behaviour.** The report's `problems` now carry every silent fallback: "x
owns N records but has no account here; they move unowned" (all record kinds)
and "N follow-ups have no owner with an account; they are given to <admin>".
`--enable-real-estate` is asked for only when there are bookings or
commissions. Collections shows drafts and cancellations (every Sales or Real
Estate workspace, not only moved ones), each opening on the existing detail
page. A lead's page shows where exactly it came from and every stage change
with its stored time — moved ones and in-app ones alike. Nothing is
synthesised: no activity is invented for a stage change, and a stage deleted
since is named as removed rather than guessed. Dry-run rollback, the
already-moved guard and the single-transaction retry are unchanged.

**Verified.** `tests/platform/lead-eagle-move.spec.ts` (6, real database):
before the fix five cases failed — the dry run flagged projects/listings and
not the money screens, the commit report lacked the two new lines, Collections
rendered none of the three non-confirmed bookings, a moved lead's page carried
neither its source detail nor its stage change's instant, and the cold-data
list printed only the name. All pass after; the refusal to move twice is
unchanged. `tests/sales/collections.spec.ts` (27) passes with the status
filter gone. Prettier and ESLint clean on the touched files.

**Left open.**
- Follow-ups and activities on merged-duplicate leads are skipped silently (the reader leaves merged leads behind but reads every FollowUp/Activity row); they show only as source > moved in the counts.
- The already-moved guard keys on leads, so a company with no leads is not guarded.
- The Timeline does not name who changed the stage (`changedById`); add if asked.
