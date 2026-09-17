-- Runbook §9.1.2: return staff access after the candidate line serves again.
--
--   psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 \
--     -v change='CHG-2026-0915-01' -v operator='<name of the executing operator>' \
--     -f scripts/rollback/restore-staff-access.sql
--
-- Reactivates only the identities that change suspended, once, and records who
-- did it. Grants and coverage stay revoked: each is re-issued deliberately, by a
-- second owner, through the application, so it is audited as any grant is.

\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('rollback.change', :'change', true) AS change,
       set_config('rollback.operator', :'operator', true) AS operator
\gset rb_

DO $$
DECLARE
  chg      text := current_setting('rollback.change');
  op       text := trim(current_setting('rollback.operator'));
  restored text[];
BEGIN
  IF length(op) < 3 THEN
    RAISE EXCEPTION 'operator: name the person executing this change';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "PlatformAuditEvent" WHERE event = 'ROLLBACK_ACCESS_REMEDIATION' AND metadata->>'change' = chg) THEN
    RAISE EXCEPTION 'no suspension recorded under change id %', chg;
  END IF;
  IF EXISTS (SELECT 1 FROM "PlatformAuditEvent" WHERE event = 'ROLLBACK_STAFF_ACCESS_RESTORED' AND metadata->>'change' = chg) THEN
    RAISE EXCEPTION 'change % was already restored', chg;
  END IF;

  WITH r AS (
    UPDATE "PlatformUser" SET status = 'ACTIVE'
     WHERE status = 'SUSPENDED'
       AND id IN (SELECT "objectId" FROM "PlatformAuditEvent"
                   WHERE event = 'ROLLBACK_STAFF_ACCESS_SUSPENDED' AND metadata->>'change' = chg)
    RETURNING id)
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO restored FROM r;

  INSERT INTO "PlatformAuditEvent" (id, event, "objectType", metadata)
  VALUES (gen_random_uuid()::text, 'ROLLBACK_STAFF_ACCESS_RESTORED', 'platform',
          jsonb_build_object('change', chg, 'operator', op, 'restored', to_jsonb(restored), 'count', cardinality(restored)));
END $$;

SELECT metadata->>'count' AS "identities restored"
  FROM "PlatformAuditEvent" WHERE event = 'ROLLBACK_STAFF_ACCESS_RESTORED' AND metadata->>'change' = :'change';

COMMIT;
