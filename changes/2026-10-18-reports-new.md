# Project, site-visit and call reports; reports regroup by user, month, project or lead; any report can be emailed on a schedule

**What.** Three new reports on the Reports menu (Sales, Real Estate, Lead
Eagle): **Projects** (units, available, booked, the leads each project drew,
those who visited, bookings and their value), **Site Visits** (scheduled, done,
missed, cancelled and the show rate) and **Call Report** (calls, connected
calls and talk time). Activity Log and Follow-up Adherence regroup by user or
month, Site Visits by agent, project or month, Call Report by agent, lead or
month: chips above the table, `?by=` on `GET /api/v1/reports`, and the CSV
follows. Below any report, a role holding `reports:EXPORT` can have it emailed
daily, weekly or monthly as a CSV attachment, and stop it under Scheduled
emails on the Reports page. PR #204. **One migration (114 in all):**
`20261018090000_report_schedules`.

**Why.** The Lead Eagle requirements audit of 11 Oct, rows M16-03, M16-07,
M16-09, M16-13 and M16-16, approved by the owner for building on 17 Oct. M16-15
(XLSX) is declined under the owner's default: no workbook writer is among the
app's dependencies, and the CSV carries a byte-order mark so Excel opens it.

**Where.**

- `services/leadership/reports.ts`: the three reports, `PIVOTS` (each report's
  groupings, default first), `perMonth` (one groupBy per month on the
  workspace's clock, 36 months at most), `reportFileName`.
- `api/v1/reports/route.ts`: `by`, refused 422 for a grouping the report lacks.
- `services/leadership/reportSchedules.ts`: create, list, delete, `nextRunAt`,
  `periodOf` and the sweep; `api/v1/reports/schedules` (GET, POST) and
  `schedules/{id}` (DELETE), all `reports:EXPORT`.
- `workers/maintenance.ts`: `report-schedules`, every quarter hour.
- `lib/mailer.ts`: `sendMail` takes attachments (the mock outbox keeps them).
- `sales/reports/page.tsx`, `ReportSchedules.tsx`: the menu, chips, form, list.

**Behaviour.**

- Calls count as the board counts them: provider calls placed (not scheduled
  or cancelled) plus calls logged by hand; connected is a completed call with
  an answered outcome, or a logged Connected, Interested or Call back later.
- A visit is scheduled unless cancelled or refused; done is COMPLETED (as on
  the board), missed is NO_SHOW; show rate is done of done-or-missed.
- Projects: units as they stand, for the workspace; leads are those with an
  interest link made, or a visit booked, in the period; visited means a visit
  took place (checked in or completed); bookings exclude cancelled ones.
- A schedule runs as its creator, at their reports scope on the day, and
  sends nothing once they lose `reports:EXPORT` or their account. Recipients
  must be active members of the workspace, checked when saved and again when
  sent. Each send writes `EXPORT_REQUESTED` (System, `source`
  `report-schedule`, with the schedule, the creator and the recipient count).
  Each person sees and stops only their own schedules.

**Decisions taken** (owner defaults of 17 Oct): XLSX declined ("CSV with BOM
opens in Excel; no new dependency"); scheduled emails on the maintenance queue
and `sendMail`. Also: a schedule sends at 07:00 on the workspace's clock,
daily (yesterday), on Mondays (the week before) or on the 1st (the month
before), so its range is its cadence's period; a lead's call figures are the
Call Report grouped by lead rather than a block on the lead timeline, which
already lists each call.

**Verified.** `tests/sales/reports-new.spec.ts` (each audit acceptance seeded
and read back: 4 scheduled / 2 done / 1 missed; 3 calls / 2 connected / 3 min,
then a logged call beside them; a project with one booked unit and one visited
lead; activity log by month one row per month per type; the route's `by`, its
CSV and the 422; the screen) and `tests/sales/report-schedules.spec.ts` (the
send times and periods; a weekly schedule fires through `handleJob` and the
mock mailer receives the CSV once, audited; nothing sent once the creator
loses EXPORT; recipients outside the workspace refused; another person's
delete is 404; the quarter-hourly schedule) fail on the old code. No browser
check on the rig (no session without reading a credential); the screens use
the existing `lf-chips`, `lf-card`, `lf-field` classes and wrap at 390 px, and
`tests/e2e/modules.spec.ts` now opens Site Visits and Call Report in CI.

**Left open.** Arabic and RTL are untouched here. Month grouping is one query
per month (`ponytail:` in `perMonth`); a sweep sends 200 schedules at most,
the next quarter hour takes the rest. A schedule cannot be edited, only
stopped and made again.
