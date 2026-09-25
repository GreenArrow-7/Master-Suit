-- Sub-statuses: the reason a lead is sitting where it is sitting.
--
-- A stage says what the pipeline thinks; a sub-status says why nothing has
-- moved. "Pending" is four different situations — phone off, budget short,
-- client abroad until March, spouse has to see it first — and a pipeline that
-- cannot tell them apart produces a column that means nothing.
--
-- This is a separate table rather than a self-relation on "LeadStage" on
-- purpose. Fifteen call sites list stages to draw a pipeline; a parentId
-- self-relation would have required each of them to grow a `parentId IS NULL`
-- filter, and the one that was missed would have rendered sub-statuses as
-- pipeline columns. Nothing that reads "LeadStage" today changes behaviour.
--
-- "Lead"."subStatusId" is nullable and has no default: every existing lead
-- keeps its stage and simply has no stated reason, which is true of them.

-- CreateTable
CREATE TABLE "LeadSubStatus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "requiresReason" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeadSubStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSubStatus_tenantId_stageId_key_key" ON "LeadSubStatus"("tenantId", "stageId", "key");

-- CreateIndex
CREATE INDEX "LeadSubStatus_tenantId_stageId_position_idx" ON "LeadSubStatus"("tenantId", "stageId", "position");

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "subStatusId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_subStatusId_idx" ON "Lead"("subStatusId");

-- AddForeignKey
ALTER TABLE "LeadSubStatus" ADD CONSTRAINT "LeadSubStatus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSubStatus" ADD CONSTRAINT "LeadSubStatus_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "LeadStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_subStatusId_fkey" FOREIGN KEY ("subStatusId") REFERENCES "LeadSubStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Tenant isolation ─────────────────────────────────────────────────────────
-- Same policy as every tenant-scoped table (see 20260819100000): RLS is FORCEd
-- because the migration role owns these tables and an owner bypasses RLS
-- without it — lib/startup-check.ts refuses to boot on exactly that condition.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['LeadSubStatus'];
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
