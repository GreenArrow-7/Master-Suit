-- P1-1 completion: existing-lead reconciliation, idempotent operations, and a
-- notification outbox that survives a crash between commit and delivery.

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'ABANDONED');

-- AlterEnum
-- A lead the reconciliation found. Deliberately its own value rather than a
-- guess at one of the four failure reasons: nothing recorded why it was never
-- placed, and inventing a cause puts a fabricated fact in front of a manager.
ALTER TYPE "LeadTriageReason" ADD VALUE 'PRE_EXISTING';

-- AlterTable
-- `openedAt` on a reconciled entry is when it was discovered, not when the
-- customer began waiting. Every surface showing a duration has to say so.
ALTER TABLE "LeadTriageEntry" ADD COLUMN "historyUnknown" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IdempotentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "scopeRef" TEXT,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotentRequest_tenantId_operation_requestKey_key" ON "IdempotentRequest"("tenantId", "operation", "requestKey");

-- CreateIndex
CREATE INDEX "IdempotentRequest_expiresAt_idx" ON "IdempotentRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotentRequest_tenantId_scopeRef_idx" ON "IdempotentRequest"("tenantId", "scopeRef");

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "objectType" TEXT,
    "recordId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedBy" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per logical notification. A redelivered job, an overlapping sweep and
-- a resumed worker converge here rather than producing three notices.
CREATE UNIQUE INDEX "NotificationOutbox_tenantId_eventKey_key" ON "NotificationOutbox"("tenantId", "eventKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_claimedUntil_idx" ON "NotificationOutbox"("status", "claimedUntil");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_userId_status_idx" ON "NotificationOutbox"("tenantId", "userId", "status");

-- AddForeignKey
ALTER TABLE "IdempotentRequest" ADD CONSTRAINT "IdempotentRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tenant isolation ─────────────────────────────────────────────────────────
-- Same policy as every tenant-scoped table (see 20260819100000): RLS is FORCEd
-- because the migration role owns these tables and an owner bypasses RLS
-- without it — lib/startup-check.ts refuses to boot on exactly that condition.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['IdempotentRequest', 'NotificationOutbox'];
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
