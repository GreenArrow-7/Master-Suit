-- A budget at TENANT or PLAN scope answers one of two different questions:
-- "how much may this whole company spend" and "how much may each person in it
-- spend". They need different rows, different arithmetic and different override
-- behaviour — a user override replaces the second and never the first — so the
-- flag joins the unique key rather than sitting beside it.

-- DropIndex
DROP INDEX "AiBudget_scope_scopeId_feature_period_key";

-- AlterTable
ALTER TABLE "AiBudget" ADD COLUMN     "appliesPerUser" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AiBudget_scope_scopeId_appliesPerUser_idx" ON "AiBudget"("scope", "scopeId", "appliesPerUser");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_scope_scopeId_feature_period_appliesPerUser_key" ON "AiBudget"("scope", "scopeId", "feature", "period", "appliesPerUser");

