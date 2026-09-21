-- CreateEnum
CREATE TYPE "AiBudgetScope" AS ENUM ('PLATFORM', 'PROVIDER', 'PLAN', 'TENANT', 'FEATURE', 'USER');

-- CreateEnum
CREATE TYPE "AiBudgetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AiBudgetAction" AS ENUM ('ALERT_ONLY', 'CHEAPER_MODEL', 'DISABLE_OPTIONAL', 'REQUIRE_APPROVAL', 'BLOCK');

-- CreateEnum
CREATE TYPE "AiRoutingStrategy" AS ENUM ('QUALITY_FIRST', 'BALANCED', 'COST_OPTIMIZED');

-- CreateEnum
CREATE TYPE "AiEventKind" AS ENUM ('REQUEST', 'FALLBACK', 'GUARDRAIL_BLOCK', 'BUDGET_BLOCK', 'RATE_LIMIT', 'PROVIDER_ERROR');

-- CreateEnum
CREATE TYPE "AiEventOutcome" AS ENUM ('OK', 'FAILED', 'BLOCKED', 'FELL_BACK');

-- CreateEnum
CREATE TYPE "AiAlertKind" AS ENUM ('BUDGET_THRESHOLD', 'PROVIDER_FAILURE', 'FALLBACK_RATE', 'SPEND_SPIKE', 'ERROR_RATE', 'LATENCY', 'GUARDRAIL_INCIDENT', 'PLAN_OVERAGE', 'ABNORMAL_USER');

-- CreateTable
CREATE TABLE "AiModelPrice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerM" DECIMAL(12,6) NOT NULL,
    "outputPerM" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBudget" (
    "id" TEXT NOT NULL,
    "scope" "AiBudgetScope" NOT NULL,
    "scopeId" TEXT,
    "feature" TEXT,
    "tokenLimit" BIGINT,
    "costLimit" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "period" "AiBudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "thresholds" INTEGER[] DEFAULT ARRAY[70, 85, 95]::INTEGER[],
    "action" "AiBudgetAction" NOT NULL DEFAULT 'ALERT_ONLY',
    "hardLimit" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGuardrailPolicy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PLATFORM',
    "scopeId" TEXT,
    "feature" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGuardrailPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRoute" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "strategy" "AiRoutingStrategy" NOT NULL DEFAULT 'BALANCED',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "fallbackTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deterministicFallback" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "kind" "AiEventKind" NOT NULL DEFAULT 'REQUEST',
    "outcome" "AiEventOutcome" NOT NULL DEFAULT 'OK',
    "reason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "fellBackFrom" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "priceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAlertRule" (
    "id" TEXT NOT NULL,
    "kind" "AiAlertKind" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PLATFORM',
    "scopeId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiModelPrice_provider_model_effectiveFrom_idx" ON "AiModelPrice"("provider", "model", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPrice_provider_model_effectiveFrom_key" ON "AiModelPrice"("provider", "model", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AiBudget_scope_enabled_idx" ON "AiBudget"("scope", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_scope_scopeId_feature_period_key" ON "AiBudget"("scope", "scopeId", "feature", "period");

-- CreateIndex
CREATE INDEX "AiGuardrailPolicy_key_scope_idx" ON "AiGuardrailPolicy"("key", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AiGuardrailPolicy_key_scope_scopeId_feature_key" ON "AiGuardrailPolicy"("key", "scope", "scopeId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "AiRoute_feature_key" ON "AiRoute"("feature");

-- CreateIndex
CREATE INDEX "AiEvent_occurredAt_idx" ON "AiEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AiEvent_tenantId_occurredAt_idx" ON "AiEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AiEvent_feature_occurredAt_idx" ON "AiEvent"("feature", "occurredAt");

-- CreateIndex
CREATE INDEX "AiEvent_provider_model_occurredAt_idx" ON "AiEvent"("provider", "model", "occurredAt");

-- CreateIndex
CREATE INDEX "AiEvent_kind_occurredAt_idx" ON "AiEvent"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "AiAlertRule_kind_enabled_idx" ON "AiAlertRule"("kind", "enabled");

-- ── AiEvent is tenant-owned, so it joins row-level security ──────────────────
--
-- The four configuration tables above carry no tenantId: they are platform
-- policy, reached only through requirePlatformOwner, and a policy on them would
-- have nothing to match. AiEvent is different — every row names the company
-- whose request it records, so it is covered by the same sweep as every other
-- tenant table, with FORCE so the owning role cannot read past it either.
--
-- One addition to the standard body: a row with no tenantId is the deployment's
-- own work (a platform-level refusal, a job with no workspace behind it). Such
-- a row may be written without a tenant in scope and may be read only by
-- withPlatformTx, which is what the asymmetry between USING and WITH CHECK says.
ALTER TABLE "AiEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiEvent" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR "tenantId" IS NULL
    OR current_setting('app.platform_admin', true) = 'on'
  );
