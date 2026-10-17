# Reports filter by period, person, team, source and project; Lead Eagle loses the money reports; Rep Activity counts calls, moves and notes; attendance summary without HRMS

**18 Oct 2026** · fix and feature · Reports, Lead Eagle, attendance · PR #210 (audit M16-00, M16-01, M16-02, M16-05, M16-10, M16-12; M16-14 was already done)

## What

- **Filters (M16-01, M16-12).** Every report reads the board's own parameters — `range` (today, 7, 30, 90 days), `from`/`to` (days on the workspace's clock), `owner`, `team`, `source`, `project` — through `reportParams`; the screen shows the board's filter bar (now `BoardFilterBar`, shared with the Lead Eagle board), and the Export CSV, All reports and menu links carry the same query. Person and team narrow inside the viewer's `reports` reach (one outside it is dropped, never widening or emptying the report); source takes its sub-sources; project is a lead's interest; records hung on a lead follow its source and project. The status report by person or team is Pipeline Summary under the filter. With no period: the first of the month two months back to the end of today, on the workspace's clock (it was the server's). An old link's ISO instants still work, and a lone `from` or `to` is that bound with the default for the other (it was silently dropped in review).
- **Lead Eagle menu (M16-00).** A workspace without Sales or Real Estate is not offered Revenue Forecast, Team Performance or Campaign Performance (`offeredReports`); asking by URL answers 404 on the API and the not-found screen on the page. Pipeline Summary stays (it is the status report) without its opportunity columns; renamed from "Sales Pipeline Summary". Source to Booking keeps leads and visits without its Bookings, Booked value and Lead to booking columns, and Lead conversion drops its opportunity and booking steps: all only ever zero there.
- **Sources (M16-02).** Source Analysis and Lead Quality group a lead with no catalogue entry by the portal its intake named (`bayut:…` → Bayut), so it folds into that portal's catalogue row beside the leads that have the entry; sub-sources stay "Source / Sub-source" rows. Migration `20261018120000_lead_source_backfill` links every lead from before the catalogue to its workspace's entry for the intake its `sourceDetail` names (`bayut:` → Bayut, `google_ads:` → Google Ads, `facebook:` → Meta, `data:` → Cold data; never a referral), and a converted cold-data record now takes the Cold data entry: a source filter then finds every lead its row counts, and Google Ads and Meta are one row each, not one under the intake's name and one under the catalogue's.
- **Rep Activity (M16-05).** Adds Calls (placed through the provider under `callScope`, plus logged), Connected, Stage moves (by whoever made them; a lead's first stage, written when it is created or imported, is not a move) and Notes (not deleted ones, nor the remarks a spreadsheet import files as notes under the importer) per agent, on screen and in the CSV.
- **Attendance summary (M16-10).** The HR attendance-summary export route opens to every workspace for that one report (`EVERY_WORKSPACE_REPORT`); other HR reports still need HRMS. The Attendance screen shows a "Per person" table (days, hours, average, with names) and Export summary, audited as `EXPORT_REQUESTED` on `hr_report`. The attendance reports cover the people `attendanceScope` covers, as the screen's rows and the attendance API do: a line manager's reporting line, not everyone in their sales teams (they read `resolveOwnerIds` before).
- The CSV audit row now records the filters with the period.

## Why

Owner-approved requirements audit (11 Oct), lane reports-polish. Decisions taken:
- Pipeline Summary is kept for a Lead-Eagle-only workspace (minus opportunity value) rather than dropped as the audit suggested: it is the status report M16-01 asks for.
- Filters use the board's parameter names (`owner`, `team`), not the audit's `ownerId`: one link vocabulary across the board, the lists and the reports.
- The per-user row variant of Pipeline Summary was not built: the person and team filter answers "leads per status by user and by team".
- Portals are top-level catalogue sources (M4-03), so Bayut and Property Finder are separate rows named by the catalogue, not children of "Marketplace".
- A lead from before the catalogue gets its entry from a one-off backfill rather than every source filter also matching `sourceDetail` prefixes: `sourceId` stays the one answer the board, the lead list, the lists and the reports all read.
- Attendance reports take the attendance screen's audience (`attendanceScope`), for the HR Reports page too, so the screen, the summary and both exports name the same people.

## Where

- `apps/web/src/services/leadership/reports.ts` — `reportParams`, `offeredReports`, the filter in `runReport`, Rep Activity, Source Analysis.
- `apps/web/src/services/leadership/rollups.ts` — `funnel`, `conversion`, `rank` take an optional lead filter (`throughLead`).
- `apps/web/src/lib/leads/boardFilter.ts` — `scopeBoardFilter` takes the module whose reach applies; `boardFilterOptions` moved here from the board page.
- `apps/web/src/components/workspace/BoardFilterBar.tsx` — the filter bar, from the board page, with the app's date field.
- `apps/web/src/app/(workspace)/[workspaceSlug]/sales/reports/page.tsx`, `apps/web/src/app/api/v1/reports/route.ts`.
- `apps/web/src/app/api/v1/workspaces/[workspaceSlug]/hr/reports/[reportKey]/export/route.ts`, `apps/web/src/services/hr/reports.ts` (`audienceFor`), `apps/web/src/app/(workspace)/[workspaceSlug]/people/attendance/page.tsx`.
- `apps/web/prisma/migrations/20261018120000_lead_source_backfill/migration.sql`, `apps/web/src/app/api/v1/cold-data/[id]/convert/route.ts`.

## Verified

- `tests/sales/reports-polish.spec.ts` (18): 13 fail on the old code (the 14th, "offers them again once the plan has Sales", passes on both). After review, 6 cases (new or tightened: Lead Eagle's booking columns, the Bayut filter, a lone day, Google Ads/Meta rows, creation moves and deleted/imported notes, a line manager's attendance summary) failed before the fixes and pass after; `tests/sales/cold-data.spec.ts` checks the Cold data entry.
- Review round: 18 spec files, 600 tests pass (reports, reports-polish, Lead Eagle reports, HR reports, HR report scope, HR downloads, attendance, attendance manager, cold data, cold-call activity, lead record fields, referral source, board and board filters, lead-work provisioning, lead record scope, lead audit trail, bulk actions); tsc clean.
- Existing specs for every touched area pass (reports, Lead Eagle reports, referral source, lead record fields, provisioning, HR reports and downloads, board filters, board, leadership, productivity, screen connections, routes and nav).
- E2E step added to `tests/e2e/lead-eagle-workspace.spec.ts` (runs in CI). No browser check on the rig (ports are shared); the screen reuses the board's filter bar styles, already checked at 390 px and in dark mode.

## Left open

- Drill-down from a report row to its list: the lead list hides closed-out leads and reads `leads` scope, so its count would not match the report's; not built.
- Source Analysis now reads the period's leads in memory, as Source to Booking already did (`ponytail:` note); a GROUP BY on the label if a range ever holds 100,000 leads.
- Rep Activity's Activities column (and Team Performance's, through `rank`) still counts soft-deleted activities; Notes no longer does.
- Notes moved from the standalone Lead Eagle are filed as IMPORT, so they drop out of Notes with the spreadsheet remarks (`ponytail:` note); standalone had no live customers.
- `#204` (new reports, `?by=` regrouping) and `#205` (call report, period form) touch the same files; whichever merges second resolves.
