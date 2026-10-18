-- Scheduled report emails can attach the Excel workbook instead of the CSV
-- (M16-15, 18 Oct). Additive: one column; every existing schedule keeps the CSV.
-- The table's row-level security is unchanged.

ALTER TABLE "ReportSchedule" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'csv';
