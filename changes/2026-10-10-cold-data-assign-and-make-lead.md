# Cold data: a record handed over from its row; Make lead no longer opens a 404; the notes show

**What.** Three gaps of the Lead Eagle audit (10 Oct) on the Cold Data screen,
branch `fix/lead-eagle-gaps`. One record can be handed to an agent from its row
(the phase 3 note promised "a list or a record"; only the list had a control).
Make lead opens the lead only when the agent can see it; when the number was
already another agent's lead it attached the touch and then opened a 404.
A record's notes — where phase 5's move puts the standalone's call history —
are shown under the name; nothing displayed them.

**Why.** [Phase 3](2026-10-07-lead-eagle-phase-3.md) claims all three on the
screen and the audit found each one API-only, 404, or unreadable. Owner's audit,
10 Oct.

**Where** (under `apps/web/`)

- `src/app/(workspace)/[workspaceSlug]/sales/cold-data/ColdDataActions.tsx` — `RecordAssign` (the Agent cell's select); `ListAssign` now reports its count; `RecordActions` opens the lead only when `visible`, otherwise says so in the row; a converted record the viewer cannot open reads as text, not a link.
- `src/app/(workspace)/[workspaceSlug]/sales/cold-data/page.tsx` — the Agent cell, the notes under the name, and the lead ids a viewer may open (same `visibilityWhere` rule as the lead page). Lead Eagle and Real Estate re-export this page.
- `src/app/api/v1/cold-data/[id]/convert/route.ts` — the response gains `visible`.
- `tests/sales/cold-data.spec.ts`, `tests/e2e/cold-data-assign.spec.ts`.

**Behaviour**

- Whoever holds leads:ASSIGN sees a select in each unconverted row's Agent
  column: Unassigned, then the active members; an owner who has since left is
  listed greyed so the control does not misreport. A pick says "Handed to X."
  or "Unassigned."; a refusal shows the server's sentence (role cannot assign,
  user not found, record converted or outside scope). The list hand-over says
  "N handed to X." / "N unassigned." Everyone else, and converted rows, see
  text as before. Nothing changed in the PATCH or the bulk route.
- Make lead: a new lead, or a match on a lead the agent can open, opens as
  before. A match on a lead the agent cannot open (somebody else's, or an
  unassigned one the agent cannot claim) stays on the page: the row reads
  "Already a lead you cannot open; the enquiry was added to it." — the touch
  is added and the owner, when the lead has one, is notified. The record is
  converted as before and, under the Converted filter, reads "Converted — the
  lead is not yours to open" with no link; a viewer who can open the lead
  keeps the link.
- A record with notes shows a "Notes" disclosure under its name.

**Verified.** `tests/sales/cold-data.spec.ts` (12): the four existing cases
(two now also assert `visible`), three on the flag — a match on the agent's own
lead (true), an unassigned lead for an agent who cannot claim (false), any lead
for organisation-wide access (true) — and five on handing one record: to an
active member (and the agent can then work it), refused for a member who left
or belongs to another workspace, handed on then back to nobody, a converted
record keeps its lead, a list hand-over still moves every unconverted record.
Five fail on the old code (the response had no `visible`); the five assignment
cases pass there too, because the API already existed — the screen was missing.
`tests/e2e/cold-data-assign.spec.ts` (1, three steps): the imported row's notes
open from the Notes disclosure under its name (fails on the old code: nothing
rendered them); the administrator hands that row to a seller from the Agent
select and it holds after reload; the seller's Make lead on the administrator's
number stays on the page with the sentence and the converted row has no link;
the lead is a 404 for the seller by URL and the administrator's to open, link
kept. Written against the demo workspace (`E2E_DEMO_*`, as
record-scope.spec.ts) and not yet run on this rig; on the old code it fails at
the Notes disclosure, then at the first combobox (the Agent cell was text) and,
with both skipped, on the navigation to the 404. Format and lint clean on the files
touched.

**Left open**

- The in-row "Already a lead…" sentence does not refresh the page (a refresh
  would drop the row, and the sentence with it); the counts above update on
  the next navigation.
- Record scope for an assigner at TEAM/BRANCH/REGION is still own-or-all
  (`coldDataScope`): they can hand on only their own records, but any whole
  list — as before.
- A custom role with leads:ASSIGN but not leads:EDIT would see the select and
  get the kernel's 403 sentence (the PATCH is gated EDIT); no shipped role is
  shaped that way.
