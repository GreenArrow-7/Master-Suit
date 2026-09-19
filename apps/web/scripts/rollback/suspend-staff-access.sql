-- Runbook §9.1.1 step 4: suspend platform staff access before an application
-- rollback to a release that cannot enforce workspace grants.
--
-- Run with the database OWNER role, with every web and worker instance of the
-- candidate stopped (step 1), after the backup (step 2) and the read-only
-- identification (step 3), whose four counts are passed in as `expect`:
--
--   psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 \
--     -v change='CHG-2026-0915-01' -v operator='<name of the executing operator>' \
--     -v expect='<grants>,<coverage>,<sessions>,<identities>' \
--     -f scripts/rollback/suspend-staff-access.sql
--
-- One transaction. It refuses — and changes nothing — when the change id is
-- missing or was used before, when no operator is named, or when what it finds
-- differs from the step-3 counts. It revokes every live access grant and
-- coverage grant, revokes every live session of an OWNER, SUPPORT or
-- SECURITY_AUDITOR identity (monitoring and administration alike), suspends those
-- identities, and deletes unfinished MFA challenges. USER and AI_SERVICE
-- identities and their sessions are not touched.
--
-- Every change is written to the platform audit trail and attributed: the change
-- id and the operator are on each row, each revoked grant is also recorded against
-- its workspace, and nothing is deleted from any audit table. Restore with
-- restore-staff-access.sql and the same change id.

\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('rollback.change', :'change', true) AS change,
       set_config('rollback.operator', :'operator', true) AS operator,
       set_config('rollback.expect', :'expect', true) AS expect
\gset rb_

DO $$
DECLARE
  chg        text := current_setting('rollback.change');
  op         text := trim(current_setting('rollback.operator'));
  expect     int[] := string_to_array(current_setting('rollback.expect'), ',')::int[];
  grants     text[];
  coverage   text[];
  sessions   text[];
  identities text[];
  n          int;
  challenges int;
BEGIN
  IF chg !~ '^[A-Za-z0-9._:-]{4,64}$' THEN
    RAISE EXCEPTION 'change: a change-ticket id (4-64 of A-Z a-z 0-9 . _ : -) is required';
  END IF;
  IF length(op) < 3 THEN
    RAISE EXCEPTION 'operator: name the person executing this change';
  END IF;
  IF cardinality(expect) <> 4 THEN
    RAISE EXCEPTION 'expect: pass the four step-3 counts as grants,coverage,sessions,identities';
  END IF;
  IF EXISTS (SELECT 1 FROM "PlatformAuditEvent" WHERE metadata->>'change' = chg) THEN
    RAISE EXCEPTION 'change id % is already in the audit trail; use a new id', chg;
  END IF;

  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO grants
    FROM "PlatformAccessGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now();
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO coverage
    FROM "PlatformCoverageGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now();
  SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}') INTO sessions
    FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
   WHERE s."revokedAt" IS NULL AND s."expiresAt" > now()
     AND u."platformRole"::text IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR');
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO identities
    FROM "PlatformUser"
   WHERE "platformRole"::text IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR')
     AND status = 'ACTIVE' AND "deletedAt" IS NULL;

  IF ARRAY[cardinality(grants), cardinality(coverage), cardinality(sessions), cardinality(identities)] <> expect THEN
    RAISE EXCEPTION 'found grants=%, coverage=%, sessions=%, identities=%; step 3 counted %. Something changed: return to step 3',
      cardinality(grants), cardinality(coverage), cardinality(sessions), cardinality(identities), expect;
  END IF;

  -- Grants, each also recorded in the workspace's own audit trail.
  INSERT INTO "PlatformAuditEvent" (id, "tenantId", event, "objectType", "objectId", metadata)
  SELECT gen_random_uuid()::text, g."tenantId", 'ROLLBACK_ACCESS_GRANT_REVOKED', 'platform_access_grant', g.id,
         jsonb_build_object('change', chg, 'operator', op, 'platformUserId', g."platformUserId",
                            'kind', g.kind::text, 'sensitive', g.sensitive)
    FROM "PlatformAccessGrant" g WHERE g.id = ANY(grants);
  UPDATE "PlatformAccessGrant" SET "revokedAt" = now() WHERE id = ANY(grants) AND "revokedAt" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(grants) THEN RAISE EXCEPTION 'revoked % of % grants', n, cardinality(grants); END IF;

  UPDATE "PlatformCoverageGrant" SET "revokedAt" = now(), "revokedReason" = chg || ': rollback to a release without grant enforcement'
   WHERE id = ANY(coverage) AND "revokedAt" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(coverage) THEN RAISE EXCEPTION 'revoked % of % coverage grants', n, cardinality(coverage); END IF;

  UPDATE "PlatformSession" SET "revokedAt" = now(), "revokedReason" = chg || ': rollback'
   WHERE id = ANY(sessions) AND "revokedAt" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(sessions) THEN RAISE EXCEPTION 'revoked % of % sessions', n, cardinality(sessions); END IF;

  INSERT INTO "PlatformAuditEvent" (id, event, "objectType", "objectId", metadata)
  SELECT gen_random_uuid()::text, 'ROLLBACK_STAFF_ACCESS_SUSPENDED', 'platform_user', u.id,
         jsonb_build_object('change', chg, 'operator', op, 'priorStatus', 'ACTIVE', 'role', u."platformRole"::text)
    FROM "PlatformUser" u WHERE u.id = ANY(identities);
  UPDATE "PlatformUser" SET status = 'SUSPENDED' WHERE id = ANY(identities) AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(identities) THEN RAISE EXCEPTION 'suspended % of % identities', n, cardinality(identities); END IF;

  DELETE FROM "PlatformMfaChallenge" WHERE "consumedAt" IS NULL;
  GET DIAGNOSTICS challenges = ROW_COUNT;

  INSERT INTO "PlatformAuditEvent" (id, event, "objectType", metadata)
  VALUES (gen_random_uuid()::text, 'ROLLBACK_ACCESS_REMEDIATION', 'platform',
          jsonb_build_object('change', chg, 'operator', op,
                             'counts', jsonb_build_object('grants', cardinality(grants), 'coverage', cardinality(coverage),
                                                          'sessions', cardinality(sessions), 'identities', cardinality(identities),
                                                          'mfaChallengesDeleted', challenges),
                             'revokedGrants', to_jsonb(grants), 'revokedCoverage', to_jsonb(coverage),
                             'revokedSessions', to_jsonb(sessions), 'suspendedIdentities', to_jsonb(identities)));
END $$;

-- Post-conditions, inside the transaction: every line must read 0.
SELECT 'live staff sessions' AS "check", count(*) AS "must be 0"
  FROM "PlatformSession" s JOIN "PlatformUser" u ON u.id = s."platformUserId"
 WHERE s."revokedAt" IS NULL AND s."expiresAt" > now() AND u."platformRole"::text IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR')
UNION ALL
SELECT 'live grants and coverage',
       (SELECT count(*) FROM "PlatformAccessGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now())
     + (SELECT count(*) FROM "PlatformCoverageGrant" WHERE "revokedAt" IS NULL AND "expiresAt" > now())
UNION ALL
SELECT 'active staff identities', count(*)
  FROM "PlatformUser" WHERE "platformRole"::text IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR') AND status = 'ACTIVE' AND "deletedAt" IS NULL;

SELECT metadata->'counts' AS "rollback counts (paste into the ticket)"
  FROM "PlatformAuditEvent" WHERE event = 'ROLLBACK_ACCESS_REMEDIATION' AND metadata->>'change' = :'change';

COMMIT;
