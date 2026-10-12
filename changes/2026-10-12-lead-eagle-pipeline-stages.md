# A Lead Eagle workspace starts with its own pipeline; moving a lead to a visit or a meeting books it

**What.** A new Lead Eagle workspace starts with the owner's pipeline instead
of four general stages. Moving a lead to a stage that books something opens a
mini-form, and the move books the site visit or the meeting in the same
request; the API refuses the move without it. The lead page's stage rail shows
the exits apart from the ladder. Part 4B of the Lead Eagle M4/M5/M6 build.

**Why.** Audit rows of 11 Oct (owner's brief, 12 Oct):

- M4-14 and M4-16: a wizard-made Lead Eagle workspace had New, Qualified, Won
  and Lost, not New → Pending → Callback → Meeting Scheduled → Meeting Done →
  Site Visit Scheduled → Site Visit Done → Booked with the exits Not
  Interested, Dropped (with a reason), Not Reachable and Junk / Duplicate.
- M4-18: a stage could require lead fields, but nothing asked for a visit's
  date, time and project, and nothing booked the visit: "Site Visit Scheduled"
  could be set with no visit anywhere.
- M4-45: the rail drew the exits as steps after the win, so a dropped lead
  showed every stage up to Booked as passed.

**Where** (under `apps/web/src/`)

- `services/platform/provisioning.ts`: `LEAD_EAGLE_STAGES`, seeded by
  `provisionLeadWork` when the workspace has Lead Eagle and no stages; the
  general four otherwise (`GENERAL_STAGES`). A workspace with stages is never
  touched, so running it again adds nothing.
- `lib/leads/stageBookings.ts`: what a stage can book, named in
  `LeadStage.requiredFields` beside the lead's fields: `visitAt` (a site visit:
  date, time and project) and `meetingAt` (a meeting: date and time). No
  migration: the column exists.
- `services/leads/updateLead.ts`: a stage with `visitAt` also needs
  `projectId`; `book()` writes the `SiteVisit` (REQUESTED, the caller's, to a
  project of the caller's catalogue, needs `visits:CREATE`) or the meeting
  `Task` (type `meeting`, APPOINTMENT, the lead's next follow-up recomputed)
  in the transaction that moves the stage, each with an `AuditLog` row. A time
  `YYYY-MM-DDTHH:mm` is on the workspace's clock (`Tenant.timezone`,
  `dayBounds`); an ISO instant with an offset is taken as it is.
  `bookableProjects(ctx)`: the picker's list, the same rule.
- `app/api/v1/leads/[id]/route.ts`: PATCH takes `visitAt`, `projectId`,
  `meetingAt`. `app/api/v1/workspaces/[workspaceSlug]/sales/stages/route.ts`
  and `admin/lead-stages/StageEditor.tsx`: a stage can be set to book either
  (two more checkboxes under "Must be filled before a lead enters it").
- `components/workspace/StageReason.tsx`: the mini-form is the browser's
  modal `<dialog>`, drawn as the `.lf-drawer` sheet, with the reason and
  what the stage books, required where the stage says; it shows the server's
  refusal inside it (`dialog.lf-drawer` in `app/globals.css`).
  `asksBeforeMove` replaces `asksForReason`. Used by the lead page
  (`sales/leads/[id]/LeadDetail.tsx`, `page.tsx`) and the grid's bulk move
  (`sales/leads/LeadGrid.tsx` on the leads list and smart views).
- `components/ui/StageRail.tsx`, `app/globals.css` (`.lf-rails`,
  `.lf-rail--exits`): the TERMINAL stages in their own group, beside the
  ladder, below it at phone width.

**Behaviour**

- Platform console: a workspace created with Lead Eagle (wizard, sign-up, a
  plan or module change that brings Lead Eagle to a workspace with no stages)
  lists the twelve stages on Admin → Lead Stages, New the default. Dropped
  asks for a reason in words. A Sales or Real Estate workspace without Lead
  Eagle still gets New, Qualified, Won, Lost. Existing workspaces keep their
  stages.
- Lead page and lead grids: choosing Site Visit Scheduled opens "Move to Site
  Visit Scheduled" with the visit's date, time and project; it does not
  submit until all three are filled, and the move creates a requested site
  visit at that time (visible under Site visits, awaiting approval). Meeting
  Scheduled asks for the meeting's date and time and adds a Meeting task on
  the lead. A stage with a reason now asks for it in the same dialog rather
  than in a line under the header. A bulk move books one visit or meeting
  per lead.
- API: `PATCH /api/v1/leads/{id}` to such a stage without the fields answers
  422 ("Site Visit Scheduled needs: visitAt, projectId."); a project outside
  the caller's catalogue 404; a role without `visits:CREATE` 403; a visit in
  the past 422.
- The rail on the lead and opportunity pages: the lost and junk stages sit
  apart; a lead in one of them shows no step as passed.
- The Lead Eagle move tool: a standalone company moved into a new Lead Eagle
  workspace lands on the matching stages by key (New, Pending, Callback,
  Meeting Scheduled, Site Visit Scheduled, Site Visit Done, Booked, Not
  Interested, Dropped) instead of adding its own after them.

**Decisions taken**

- None by the owner beyond the rows themselves (the brief marks no DECISION
  for this part).
- Design choices, not the owner's:
  - What a stage books is named in the existing `requiredFields`, in the
    standalone's words (`visitAt`, `meetingAt`), so no migration; `visitAt`
    implies the project.
  - Dropped's reason is written in, with no list: the standalone's Dropped
    sub-statuses (unreachable, wrong number, junk) are exits of their own
    here. No SLA minutes, colours or sub-statuses were seeded.
  - The visit and the meeting belong to whoever moves the lead, as when booked
    from Site visits or Tasks; a move needs `visits:CREATE` to book a visit.
  - The ladder is seeded whenever a workspace with Lead Eagle has no stages at
    all, not only on Lead Eagle's arrival: an empty pipeline is filled either
    way, and a workspace with stages is never touched.
  - The mini-form is one dialog for every stage that asks for something, a
    reason included, on the lead page and the grids.

**Verified.** On the rig's scratch database:

- `tests/tenant/provision-lead-work.spec.ts` (new and changed cases) and the
  new `tests/sales/stage-mini-form.spec.ts`: 13 of their 36 cases fail on
  main's source (the pipeline, Dropped's 422 in a wizard-made workspace, the
  bookings, the 404/403s, the rail's exits, the picker, the dialog) and all 36
  pass with this change. With `stage-reasons`, `bulk-stage-move`,
  `lead-task-scope`, `lead-eagle-move` and `self-serve-signup`: 62 of 62.
- The sales, permission, tenant, unit and platform directories: 2814 passed,
  2 skipped, 3 failed, all three in `retention.spec.ts` under the wide run's
  load; alone it passes 4 of 4. The security and integration directories: 728
  of 728. `tsc --noEmit`, eslint (no errors) and prettier clean.
- Playwright on the rig's dev server: the new `lead-stage-mini-form.spec.ts`
  (a wizard-made Lead Eagle workspace at 390 px: the rail's exits, the dialog
  refusing to submit empty, the visit booked at 16:30 Dubai = 12:30 UTC),
  `lead-bulk-stage.spec.ts` and `lead-eagle-workspace.spec.ts`: 4 of 4.
  Checked by eye at 390 px (light and dark) and 1280 px: the rail, the dialog
  on the lead page and the grid's bulk move to Meeting Scheduled.

**Left open**

- Creating a lead directly in a stage (`POST /api/v1/leads` with `stageId`)
  checks neither a stage's reason nor what it books; automations that set a
  stage do not either.
- The Kanban (M4-21) does not exist yet; it should open the same mini-form.
- The rail does not move a lead; the Stage menu beside it does.
- The project picker lists the first 500 projects by name.
- Seen while checking, not changed: the dev overlay reports a hydration
  mismatch on the lead page's "Another number" field (its inline style); and a
  `.lf-drawer` rendered inside the page sat under the desktop top bar, which is
  why this dialog is a native modal `<dialog>`. The social enquiry and Meta
  routing drawers use the old way and were not checked.
