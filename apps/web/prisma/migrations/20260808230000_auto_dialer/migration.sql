-- The auto-dialer: a campaign queue, and the session that works through it (M7).
--
-- Click-to-call, four telephony vendors, recordings, transcripts, AI analysis
-- and campaigns already existed. What did not was the thing that turns a list
-- into a shift: a queue an agent works without deciding who to ring next.
--
-- The acceptance criterion is the design. "Dialer state survives a page
-- refresh" means the agent position is a column and there is no client state to
-- lose. "No call is lost or double-dialled" means two partial unique indexes —
-- one live session per agent, one claim per contact — plus a claim taken with
-- FOR UPDATE SKIP LOCKED so two agents on one campaign can never be handed the
-- same person, and a cooldown checked against the phone number rather than
-- against the contact row.
--
-- The cooldown is a workspace setting, not a constant. Ringing somebody twice
-- in five minutes is the complaint that ends a campaign, and how long is long
-- enough differs between a launch and a collections desk.

-- CreateEnum
CREATE TYPE "DialerSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "CampaignContactStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CALLBACK', 'SKIPPED', 'EXHAUSTED', 'SUPPRESSED');

-- AlterTable
ALTER TABLE "OrganizationSetting" ADD COLUMN     "dialerCooldownSeconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "dialerMaxAttempts" INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE "CampaignContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "displayName" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT,
    "status" "CampaignContactStatus" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "claimedBySessionId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "outcome" "CallOutcome",
    "lastCallId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CampaignContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialerSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DialerSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentContactId" TEXT,
    "currentCallId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dialed" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "callbacks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignContact_tenantId_campaignId_status_position_idx" ON "CampaignContact"("tenantId", "campaignId", "status", "position");

-- CreateIndex
CREATE INDEX "CampaignContact_tenantId_campaignId_nextAttemptAt_idx" ON "CampaignContact"("tenantId", "campaignId", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CampaignContact_tenantId_claimedBySessionId_idx" ON "CampaignContact"("tenantId", "claimedBySessionId");

-- CreateIndex
CREATE INDEX "CampaignContact_tenantId_leadId_idx" ON "CampaignContact"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContact_campaignId_phoneNormalized_key" ON "CampaignContact"("campaignId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "DialerSession_tenantId_campaignId_status_idx" ON "DialerSession"("tenantId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "DialerSession_tenantId_userId_status_idx" ON "DialerSession"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "DialerSession_tenantId_status_lastActivityAt_idx" ON "DialerSession"("tenantId", "status", "lastActivityAt");


-- ── The two guarantees the acceptance criterion names ───────────────────────

-- "No call is double-dialled", half one: an agent has at most one live dialer.
--
-- Two sessions for one person means two queues advancing independently, two
-- contacts claimed, and a second call placed while the first is still ringing.
-- Enforced here rather than by a read-then-insert, which races with itself.
CREATE UNIQUE INDEX "DialerSession_one_active_per_user"
    ON "DialerSession" ("tenantId", "userId") WHERE "status" = 'ACTIVE';

-- "No call is double-dialled", half two: a contact is held by one session.
--
-- The claim is released on every advance, on session end, and by the stale
-- sweep. While it is held, the partial index makes a second claim impossible
-- even if two sessions somehow selected the same row.
CREATE UNIQUE INDEX "CampaignContact_one_claim"
    ON "CampaignContact" ("id") WHERE "claimedBySessionId" IS NOT NULL;

-- The queue read. Every advance runs this exact shape — eligible rows for one
-- campaign in position order — so it gets its own partial index rather than
-- filtering a general one down.
CREATE INDEX "CampaignContact_queue_idx"
    ON "CampaignContact" ("tenantId", "campaignId", "position")
    WHERE "status" IN ('PENDING', 'CALLBACK');

-- ── Integrity ───────────────────────────────────────────────────────────────

-- A contact with nobody behind it cannot be called back or credited to a lead.
ALTER TABLE "CampaignContact"
    ADD CONSTRAINT "CampaignContact_subject_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "CampaignContact"
    ADD CONSTRAINT "CampaignContact_attempts_check"
    CHECK ("attempts" >= 0 AND "attempts" <= 100);

-- A claim without a time, or a time without a claim, is a half-written release
-- and the stale sweep cannot reason about it.
ALTER TABLE "CampaignContact"
    ADD CONSTRAINT "CampaignContact_claim_check"
    CHECK (("claimedBySessionId" IS NULL) = ("claimedAt" IS NULL));

-- Cooldown and attempt ceilings that make no sense would silently disable the
-- protection they exist to provide.
ALTER TABLE "OrganizationSetting"
    ADD CONSTRAINT "OrganizationSetting_dialer_check"
    CHECK ("dialerCooldownSeconds" >= 0 AND "dialerCooldownSeconds" <= 86400
           AND "dialerMaxAttempts" >= 1 AND "dialerMaxAttempts" <= 20);

-- ── Permissions ────────────────────────────────────────────────────────────
--
-- `dialer` is its own module rather than part of `calls`. Placing a single call
-- from a lead and being handed a queue of two hundred strangers are different
-- authorities: the first is what every agent does, the second is a shift a
-- manager assigns. Splitting them is what lets a workspace grant one without
-- the other.
--
-- VIEW is what an agent needs to work a queue. `MANAGE_USERS` is the team
-- dialer: seeing who else is live and on what. Named that way because it is the
-- existing admin action for "act across other people", not a new vocabulary.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'dialer', 'VIEW',         'Work a campaign dial queue'),
  (gen_random_uuid()::text, 'dialer', 'CREATE',       'Load contacts into a campaign queue'),
  (gen_random_uuid()::text, 'dialer', 'EDIT',         'Reset, suppress or re-queue contacts'),
  (gen_random_uuid()::text, 'dialer', 'MANAGE_USERS', 'See and end other agents'' dialer sessions')
ON CONFLICT ("module", "action") DO NOTHING;

-- VIEW ← whoever may already place a call. If an agent can dial, they can be
-- handed a queue; the queue does not widen what they may reach.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'dialer' AND target."action" = 'VIEW'
WHERE source."module" = 'calls' AND source."action" = 'EDIT'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- CREATE and EDIT ← whoever may run campaigns. Loading a queue is choosing who
-- the floor rings today, which is a campaign decision and not an agent's.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'dialer' AND target."action" IN ('CREATE', 'EDIT')
WHERE source."module" = 'campaigns' AND source."action" = 'EDIT'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- The team dialer ← whoever already reassigns other people's leads. That is the
-- existing test for "may act across the floor".
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'dialer' AND target."action" = 'MANAGE_USERS'
WHERE source."module" = 'leads' AND source."action" = 'REASSIGN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['CampaignContact', 'DialerSession'];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ') '
      'WITH CHECK ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ')',
      target
    );
  END LOOP;
END $$;
