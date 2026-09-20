-- The daily cold-calling target counts distinct leads called, not dials.
ALTER TYPE "TargetMetric" ADD VALUE IF NOT EXISTS 'LEADS_CALLED';
