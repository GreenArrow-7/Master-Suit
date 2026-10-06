# Lead Eagle, phase 3: stage reasons, QR capture links, cold data

**What.** Gaps 3–5 of the [plan](2026-10-05-lead-eagle-plan.md), PR #131,
stacked on phase 2 (#130). Every lead module (Sales, Real Estate, Lead Eagle)
gets all three.

**Why.** The approved plan; phase 5 (moving the standalone Lead Eagle's data)
needs somewhere for its sub-statuses and cold data to land.

**Where** (under `apps/web/`)
- `prisma/migrations/20261007100000_stage_reasons_capture_links_cold_data` — `LeadStage.requiresReason` and `reasons`, `Lead.stageReason`, `CaptureLink`, `DataRecord` with `DataStatus`; both tables RLS-forced.
- `src/services/leads/updateLead.ts` — the rule on entering a stage; `src/components/workspace/StageReason.tsx` — the prompt, used by the lead screen and the grid's bulk move.
- `src/app/(workspace)/[workspaceSlug]/admin/lead-stages/` — the Lead Stages settings screen; the stages API now admits every lead module.
- `src/services/leads/intake.ts` — `takeEnquiry`, phase 2's create-or-attach core, now shared by portals, QR capture and cold data.
- `src/app/c/[workspaceSlug]/[key]/page.tsx`, `src/app/api/v1/public/capture/route.ts`, `sales/capture-links/` — the QR page, its submit, the links screen.
- `sales/cold-data/`, `src/app/api/v1/cold-data/**`, `src/services/leads/coldData.ts` — lists, working, converting, assigning.
- `realty/` and `lead-eagle/` re-export both screens; the nav gains QR Capture and Cold Data in each lead menu, and Lead Stages under Administration → Settings.

**Behaviour**
- **Stages.** Administration → Settings → Lead Stages lists the pipeline: name,
  kind (open, won, lost, junk), order, response time, a reason required on
  entry, the reasons to choose from (Lead Eagle's sub-statuses), and the lead
  fields that must be filled first. Moving a lead into such a stage — on the
  lead or in bulk from the grid — asks for the reason; the server refuses
  without it (422 with the sentence shown), stores it on the lead
  (`stageReason`, shown under the stage) and in the stage history, and clears it
  when the lead moves on. The two stage columns that existed unenforced,
  `requiredFields` and `allowedNextStages`: the first is now enforced; the
  second still is not. Deleted stages no longer appear in the lead screens.
- **QR capture.** QR Capture makes a link per stand, flyer or campaign: who gets
  its leads (or distribution), a project or campaign, the page's headline. Each
  card shows the QR code, the URL and opened/sent counts, and switches off.
  The public page (`/c/<workspace>/<key>`, the public form's look and
  component) asks for name and mobile, email and message optional; a submission
  becomes a lead owned by the link's agent (or distributed), source Public
  form, `sourceDetail` `capture:<key>`, or a fresh touch on the lead already
  holding the number. A switched-off link is a 404.
- **Cold data.** Cold Data imports a spreadsheet through the lead import's own
  screen (same column detection) into a list named after the file — contacts,
  not leads. Each list shows contacts, still to work, interested, converted and
  its conversion rate; whoever holds leads:ASSIGN hands a list to an agent. An
  agent sees what is assigned to them (organisation-wide lead access sees
  everything), sets each call's outcome, and **Make lead** turns a contact into
  a lead owned by them — or a touch on the existing lead with that number —
  then opens it. The record stays, marked converted.
- Phase 2's intake now creates the "note" activity type when a workspace lacks
  it, as the spreadsheet import does, so the enquiry's words are never dropped.

**Verified.** Real routes and database: `tests/sales/stage-reasons.spec.ts`
(4: no reason, an unoffered reason, the reason kept on the lead and its history
and cleared on the next move, required fields — three fail on the old
`updateLead`; clearing holds there trivially), `capture-links.spec.ts` (4: the agent's lead, a second
submission attached, a switched-off link and another workspace's key both
404), `cold-data.spec.ts` (4: a list not leads with bad rows reported, an
own-scope agent works only what is assigned and cannot reassign, conversion
keeps the record, a contact already in the pipeline attaches). Phase 2's intake
spec still passes on the shared core; the nav spec's pinned menus gain the two
tabs. Full suite: 3488 passed; the one failure, a rate-limit case crossing a
minute boundary under load, passes alone and is unrelated (filed separately).
Schema drift, RLS (195 tables), types and lint clean. In a browser on the rig,
16 checks at 1280 and 390 px: a stage saves its reasons; the lead asks for the
reason and moves with it; a QR link shows its code, its public page takes a
visitor, who becomes a lead credited to the link; a CSV lands as a list, an
outcome sticks and saves, Make lead opens the new lead and the record is kept;
no sideways scroll on the three screens, no page errors.

**Left open**
- `allowedNextStages` is still not enforced, and nothing edits it.
- Cold data: a team manager sees only their own records (organisation-wide
  access sees all); calls placed from a contact are not logged against it.
- A capture link's agent is not told of a new lead by bell or push; it is in
  their My Leads.
