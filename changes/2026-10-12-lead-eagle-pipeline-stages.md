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
- M4-18: nothing asked for a visit's date, time and project, and nothing
  booked it: "Site Visit Scheduled" could be set with no visit anywhere.
- M4-45: the rail drew the exits as steps after the win, so a dropped lead
  showed every stage up to Booked as passed.

**Where** (under `apps/web/src/`)

- `services/platform/provisioning.ts`: `LEAD_EAGLE_STAGES`, seeded by
  `provisionLeadWork` when the workspace has Lead Eagle and no stages, else
  `GENERAL_STAGES`. A workspace with stages is never touched.
- `lib/leads/stageBookings.ts`: what a stage can book, named in
  `LeadStage.requiredFields`: `visitAt` (date, time and project) and
  `meetingAt` (date and time). No migration.
- `services/leads/updateLead.ts`: `book()` writes the `SiteVisit` or the
  meeting `Task` in the transaction that moves the stage, each audited; a
  booking sent with no move is refused. `bookableProjects`: the picker's list.
- `app/api/v1/leads/[id]/route.ts` (PATCH takes `visitAt`, `projectId`,
  `meetingAt`); `app/api/v1/workspaces/[workspaceSlug]/sales/stages/route.ts`
  and `admin/lead-stages/StageEditor.tsx` (a stage can be set to book either).
- `components/workspace/StageReason.tsx`: the mini-form, a modal `<dialog>`
  drawn as the `.lf-drawer` sheet (`app/globals.css`); `asksBeforeMove`
  replaces `asksForReason`. Used by `sales/leads/[id]/LeadDetail.tsx` and
  `sales/leads/LeadGrid.tsx` (leads list and smart views).
- `components/ui/StageRail.tsx`, `app/globals.css` (`.lf-rails`,
  `.lf-rail--exits`): the TERMINAL stages in their own group.

**Behaviour**

- A workspace created with Lead Eagle (wizard, sign-up, or a plan or module
  change that brings Lead Eagle to a workspace with no stages) lists the
  twelve stages on Admin → Lead Stages, New the default; Dropped asks for a
  reason in words. Without Lead Eagle: New, Qualified, Won, Lost. Existing
  workspaces keep their stages.
- Lead page and lead grids: Site Visit Scheduled opens "Move to Site Visit
  Scheduled" (date, time and project, all required) and the move creates a
  requested site visit; Meeting Scheduled asks for the date and time and adds
  a Meeting task. A stage with a reason asks for it in the same dialog. A bulk
  move books one visit or meeting per lead. Choosing the stage a lead is
  already in on the lead page does nothing.
- API: `PATCH /api/v1/leads/{id}` to such a stage without the fields: 422; a
  project outside the caller's catalogue: 404; no `visits:CREATE`: 403; a past
  visit: 422; a booking with no move (the same stage, or no `stageId`): 422,
  so a bulk move names the leads already in that stage instead of claiming a
  booking; the Meeting task type switched off: 422.
- The rail on the lead and opportunity pages: lost and junk stages sit apart;
  a record in one of them shows no step as passed.
- The lead page, lead list and smart views load the project names (up to 500)
  only for a role with `projects:VIEW` in a workspace where a stage books a
  visit.
- The Lead Eagle move tool lands a standalone company's statuses on the
  matching stages of a new Lead Eagle workspace by key.

**Decisions taken**

- None by the owner beyond the rows themselves (the brief marks no DECISION
  for this part).
- Design choices, not the owner's:
  - What a stage books is named in the existing `requiredFields`, in the
    standalone's words (`visitAt`, `meetingAt`); `visitAt` implies the project.
  - Dropped's reason is written in, with no list; the standalone's Dropped
    sub-statuses are exits of their own here. No SLA minutes, colours or
    sub-statuses were seeded.
  - The visit and the meeting belong to whoever moves the lead, as when booked
    from Site visits or Tasks; booking a visit needs `visits:CREATE`.
  - The ladder is seeded whenever a workspace with Lead Eagle has no stages at
    all; a workspace with stages is never touched.
  - One dialog for every stage that asks for something, a reason included.
  - A booking sent with no move is refused, not booked: rebooking a visit is
    done from Site visits, and a bulk move never stacks a second visit on a
    lead already in the stage.

**Verified.** On the rig's scratch database:

- `tests/tenant/provision-lead-work.spec.ts` and the new
  `tests/sales/stage-mini-form.spec.ts`: 13 of their first 36 cases failed on
  main's source. After review, five cases and stronger assertions were added:
  three fail on the first version of this branch (a visit sent to the lead's
  own stage answered 200 and booked nothing; a switched-off Meeting type still
  booked; a workspace with no visit stage loaded the catalogue), the stages
  API and opportunity-rail cases fail with main's route and rail, and the
  workspace-clock case fails when the zone is hard-coded to Dubai. All 41
  pass; with `stage-reasons`, `bulk-stage-move`, `lead-task-scope`,
  `lead-eagle-move` and `self-serve-signup`: 67 of 67.
- The sales, permission, tenant, unit and platform directories: 160 files,
  2822 passed, 2 skipped. The security and integration directories: all 728
  pass. `tsc --noEmit`, eslint (no errors) and prettier clean.
- Playwright on the rig's dev server: `lead-stage-mini-form.spec.ts` (a
  wizard-made Lead Eagle workspace at 390 px: the rail's exits, the dialog
  refusing to submit empty, the visit booked at 16:30 Dubai = 12:30 UTC,
  re-choosing the current stage asks nothing; the lead list's bulk move to
  Meeting Scheduled through the dialog books a task per lead),
  `lead-bulk-stage.spec.ts` and `lead-eagle-workspace.spec.ts`: 5 of 5. The
  re-choice step fails with the first version's lead page. Checked by eye at
  390 px (light and dark) and 1280 px.

**Left open**

- Owner: should a visit or meeting booked by a move belong to the lead's owner
  rather than the person moving it? Today a manager's bulk move books visits
  the agents at OWN scope cannot open.
- Owner: creating a lead straight into a stage (`POST /api/v1/leads`, social
  lead convert, Meta routing, sales/leads POST) checks neither the stage's
  reason nor what it books. Refusing would drop automated intake; landing on
  the default stage is the alternative.
- A visit booked by a move does not become the lead's next follow-up (the
  standalone sets one at the visit time); `recomputeNextFollowUp` reads tasks
  only.
- The Kanban (M4-21) does not exist yet; it should open the same mini-form.
- The rail does not move a lead; the Stage menu beside it does.
- The project picker lists the first 500 projects by name, without saying
  when it cuts.
- Seen, not changed: a hydration mismatch on the lead page's "Another number"
  field; the social enquiry and Meta routing drawers (`.lf-drawer` inside the
  page) may sit under the desktop top bar, as this dialog's first version did.
