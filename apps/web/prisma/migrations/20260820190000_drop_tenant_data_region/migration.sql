-- Drops Tenant."dataRegion".
--
-- The column was created by the baseline migration with a default of
-- 'me-central-1', written once by the seed, and read by nothing — no query, no
-- route, no policy, no index. It implied per-tenant data residency, which this
-- system does not do: there is one database, in one place, holding every
-- tenant's rows. A column that names a region the data is not necessarily in is
-- worse than no column, because it reads as a control to anyone reviewing the
-- schema for a compliance question.
--
-- Removing it is the deliberate answer to "remove it or give it meaning". Giving
-- it meaning is regional sharding, which is a product decision and a great deal
-- of infrastructure; naming the absence honestly costs one column.
--
-- ── The guard, and why a drop needs one ─────────────────────────────────────
--
-- `DROP COLUMN` is irreversible and this one carries values. The whole premise
-- of removing it is that those values are the default nobody chose. If that is
-- false on some deployment — if an operator set a real region for a customer,
-- meaning somebody believed this column did something — then destroying it
-- silently is exactly the wrong move, and this refuses instead.
--
-- To proceed anyway, record where those tenants' data actually lives somewhere
-- that is true, then set the column back to its default and re-run.
--
-- The DROP is inside the guard rather than a statement after it. `prisma migrate
-- deploy` wraps a migration file in a transaction, so a RAISE would roll the
-- whole thing back either way — but applied by hand with psql, which the restore
-- runbook does, each statement stands alone and a DROP written below the guard
-- executes anyway. Then the guard has printed a refusal and destroyed the column
-- in the same run, which is the worst of both. One statement cannot do that.
DO $$
DECLARE
  divergent INTEGER;
  sample    TEXT;
BEGIN
  SELECT count(*), min("dataRegion")
    INTO divergent, sample
    FROM "Tenant"
   WHERE "dataRegion" IS DISTINCT FROM 'me-central-1';

  IF divergent > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop Tenant."dataRegion": % tenant(s) carry a non-default value (for example %). '
      'This migration assumes the column was never meaningfully set. Record that information '
      'somewhere it is true, reset the column to ''me-central-1'', and re-run.',
      divergent, sample;
  END IF;

  EXECUTE 'ALTER TABLE "Tenant" DROP COLUMN "dataRegion"';
END $$;
