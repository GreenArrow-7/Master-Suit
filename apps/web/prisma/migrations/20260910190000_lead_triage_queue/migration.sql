-- P1-1: the accountable unassigned-lead queue.
--
-- `assignLead` returned silently on three different failures and recorded
-- nothing, leaving the lead unowned and indistinguishable from one nobody had
-- reached yet. This is the record that was missing.

-- CreateEnum
CREATE TYPE "LeadTriageReason" AS ENUM ('NO_RULE', 'EMPTY_POOL', 'NO_ELIGIBLE_AGENT', 'ALL_AT_CAPACITY');

-- CreateEnum
CREATE TYPE "LeadTriageStatus" AS ENUM ('WAITING', 'ASSIGNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LeadTriageEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "episode" INTEGER NOT NULL,
    "reason" "LeadTriageReason" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "ruleId" TEXT,
    "responsibleTeamId" TEXT,
    "responsibleUserId" TEXT,
    "reviewDueAt" TIMESTAMP(3),
    "reviewPolicyMissing" BOOLEAN NOT NULL DEFAULT false,
    "routingPolicyMissing" BOOLEAN NOT NULL DEFAULT false,
    "status" "LeadTriageStatus" NOT NULL DEFAULT 'WAITING',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadTriageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadTriageEntry_tenantId_leadId_episode_key" ON "LeadTriageEntry"("tenantId", "leadId", "episode");

-- CreateIndex
CREATE INDEX "LeadTriageEntry_tenantId_status_openedAt_idx" ON "LeadTriageEntry"("tenantId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "LeadTriageEntry_tenantId_status_reviewDueAt_idx" ON "LeadTriageEntry"("tenantId", "status", "reviewDueAt");

-- CreateIndex
CREATE INDEX "LeadTriageEntry_tenantId_responsibleUserId_status_idx" ON "LeadTriageEntry"("tenantId", "responsibleUserId", "status");

-- CreateIndex
CREATE INDEX "LeadTriageEntry_tenantId_responsibleTeamId_status_idx" ON "LeadTriageEntry"("tenantId", "responsibleTeamId", "status");

-- CreateIndex
CREATE INDEX "LeadTriageEntry_leadId_idx" ON "LeadTriageEntry"("leadId");

-- AddForeignKey
ALTER TABLE "LeadTriageEntry" ADD CONSTRAINT "LeadTriageEntry_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTriageEntry" ADD CONSTRAINT "LeadTriageEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── At most one open episode per lead ────────────────────────────────────────
-- This is the control that makes repeated intake safe. A portal that redelivers
-- its webhook, a BullMQ retry, and two workers racing on the same lead all reach
-- the same insert; the index refuses the second, and the caller treats the
-- conflict as "already queued" rather than as an error.
--
-- Partial, because ASSIGNED and CANCELLED episodes must accumulate — that is the
-- history of how often this lead has needed a human. Prisma cannot express a
-- partial unique index, so it lives here and is invisible to `prisma db pull`;
-- `tests/sales/lead-triage.spec.ts` asserts it exists for exactly that reason.
CREATE UNIQUE INDEX "LeadTriageEntry_one_open_per_lead"
    ON "LeadTriageEntry" ("tenantId", "leadId")
 WHERE "status" = 'WAITING';

-- ── Tenant isolation ─────────────────────────────────────────────────────────
-- Same policy as every tenant-scoped table (see 20260819100000): RLS is FORCEd
-- because the migration role owns these tables and an owner bypasses RLS
-- without it — lib/startup-check.ts refuses to boot on exactly that condition.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['LeadTriageEntry'];
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
