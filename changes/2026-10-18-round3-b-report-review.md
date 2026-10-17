# Round 3 batch B review: reports read a visit's and a booking's own project, Call Report reads under the calls scope, and a call report is mailed only to those who may see its calls

**18 Oct 2026** · fix · Reports, Lead Eagle · batch PR #217

**What.** Fixes from the independent review of the batch B integration (#204 with #205 and #210):

- **Site Visits** and the **Projects** report narrow a project by the visit's or booking's own project, as the board's visit and booking lists do (`boardWhere` with the `visit` and `booking` registers). They used to go through the lead's project interests, so `?project=X` dropped a visit to X by a lead that never asked about X, and the Projects report's own row for X shrank when filtered to X.
- **Call Report** reads calls the way Call Performance does (`callReach` in `reports.ts`, shared by both): provider calls under `callScope`, calls logged by hand by their owner at the same scope, your own without a calls grant, and a removed call is left out. It used to read every call in the reports reach, and its by-lead grouping named every lead anyone had called.
- **Scheduled emails**: a report that reads calls (Rep Activity, Call Performance, Call Report: `CALL_REPORTS`) goes only to members whose calls reach covers the creator's, checked when the schedule is made and again at each send.
- The schedule form on a filtered view says the email leaves out the person, team, source and project filters.
- `PROJECT.md`: the Lead Eagle row lost two repeated passages.

**Why.** Review findings on batch B (#217); M16-12 (one link reads alike on the board, its lists and a report) and M16-16 (a report reaches only those who could see it on the screen).

**Where.** `services/leadership/reports.ts`, `services/leadership/reportSchedules.ts`, `sales/reports/page.tsx`, `ReportSchedules.tsx`.

**Verified.** `tests/sales/reports-new.spec.ts` (site visits and Projects filtered to a project; Call Report under the calls scope; the filtered form's note) and `tests/sales/report-schedules.spec.ts` (call reports to a member without calls), all five failing on the old code.

**Left open.** A schedule does not keep the view's filters (it says so); storing them needs a column on `ReportSchedule`.
