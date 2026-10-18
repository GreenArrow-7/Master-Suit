# Every export also downloads as an Excel workbook

## What

M16-15: `format=xlsx` on the report, lead and HR report exports returns a real
.xlsx with the CSV's columns and rows; a scheduled report email can attach the
workbook instead of the CSV; an Excel button sits beside every CSV one. PR #229.

## Why

Audit row M16-15 (High), approved by the owner with the rest of the buildable
list: people open these files in Excel, and a CSV loses its numbers' types,
its dates and its non-ASCII names there. No new dependency: nothing in
`package.json` writes a zip (read-excel-file only reads).

## Where

- `apps/web/src/lib/xlsx.ts` — the writer: five fixed OOXML parts and the sheet, zipped with `node:zlib` (deflate, CRC-32), streamed.
- `apps/web/src/app/api/v1/reports/route.ts` — `format` json, csv or xlsx; EXPORT for either file.
- `apps/web/src/app/api/v1/leads/export/route.ts` — one page generator feeds the CSV stream and the workbook stream.
- `apps/web/src/app/api/v1/workspaces/[workspaceSlug]/hr/reports/[reportKey]/export/route.ts`, `src/services/hr/reports.ts` — `exportReportCsv(…, format)`.
- `apps/web/src/services/leadership/reportSchedules.ts`, `prisma/migrations/20261018141500_report_schedule_format` — `ReportSchedule.format` (default `csv`).
- `apps/web/src/lib/csv.ts` (`tableFiles`), `src/components/workspace/ExportCsv.tsx` — the People screens' in-page exports get Excel too.
- `apps/web/src/lib/mailer.ts` — an attachment can be base64 (`encoding`).

## Behaviour

- Reports (Sales, Real Estate, Lead Eagle), the lead grid, People → Reports, the attendance summary, the compliance register, face activity, work-location assignments and attendance each show **Excel** beside their CSV button.
- The workbook: a bold header row; a number is a number cell, a Date a date cell (UTC, as the CSV writes it; a UTC midnight shows the day alone); everything else is text, the CSV's text. Nothing is ever a formula: text is an inline string, and a cell the CSV prefixes with an apostrophe (`=`, `+`, `-`, `@`, tab, CR) carries Excel's quote-prefix style instead, which is how Excel stores a typed leading apostrophe. Characters XML cannot carry are dropped; a cell is cut at Excel's 32,767; the sheet name is at most 31 characters.
- The lead export streams the workbook page by page as it streams the CSV (sizes in a data descriptor), capped by `EXPORT_MAX_ROWS` as before.
- Same permission (EXPORT), same `EXPORT_REQUESTED` row, now with `format`. A wrong `format` answers 422.
- Reports → Email this report has a **File** choice (CSV or Excel); Scheduled emails lists it; existing schedules stay CSV.

## Verified

- `tests/unit/xlsx.spec.ts` (new): reads the zip back through its central directory (every part inflated, CRC and size checked), checks the sheet XML cell by cell (types, styles, escaping, the formula guard, dropped control characters), opens it in read-excel-file, streams 1,200 rows over pages, sheet names and columns past Z.
- `tests/sales/xlsx-export.spec.ts` (new, integration): each route with `format=xlsx` against `format=csv` — status, content type, `.xlsx` disposition, `PK`, same header and rows, numbers typed, a `=HYPERLINK` lead name kept as text, 403 without EXPORT, 422 on a bad format, one audit row each with its `format`; the Reports page links Excel; a schedule with `format: 'xlsx'` mails a readable workbook.
- Existing: reports, reports-polish, reports-new, report-schedules, lead-eagle-reports, lead-saved-views, lead-record-scope, field-security, custom-fields, HR reports and HR report scope, all passing; `tests/unit` whole; tsc; Prettier; schema drift none.
- Not checked in a browser or in Excel itself; read-excel-file is the reader the tests use.

## Left open

- `/api/v1/exports/{resource}` (the generic list exports) still writes CSV only; no screen links it.
- No Zip64, so a single sheet tops out at 4 GiB; `EXPORT_MAX_ROWS` (500,000) keeps a lead export far below it.
- No column widths or frozen header row.
