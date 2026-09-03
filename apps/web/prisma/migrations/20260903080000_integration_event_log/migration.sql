-- One line per exchange with an external provider, in either direction.
--
-- §33 asks a question this platform could not answer: "why are Facebook leads
-- not arriving?" `WebhookEvent` answers half — it is the idempotency claim for
-- inbound deliveries and records that one arrived and whether it processed. It
-- has no notion of an outbound call at all: every reply, dial and template send
-- went to stdout and was then gone, so "we tried to send and Meta refused" was
-- not a question anybody could ask of the database.
--
-- Deliberately a new table rather than columns on `WebhookEvent`. That table's
-- job is the (tenantId, provider, externalId) unique that makes redelivery
-- idempotent; outbound calls have no external id before they are made, and two
-- identical sends are two events rather than one. Overloading it would mean
-- breaking the claim or inventing ids to satisfy it.
--
-- Three outcomes rather than two: a redelivery the claim correctly refused, and
-- a lead form whose routing rule is switched off, are neither failures nor
-- silent successes. They are the answer to "where did my lead go", and OK would
-- hide them while FAILED would raise an alarm about working behaviour.

CREATE TYPE "IntegrationDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "IntegrationOutcome" AS ENUM ('OK', 'SKIPPED', 'FAILED');
CREATE TYPE "IntegrationErrorCategory" AS ENUM (
  'AUTH', 'PERMISSION', 'RATE_LIMIT', 'INVALID_REQUEST', 'NOT_FOUND', 'UNAVAILABLE', 'TIMEOUT', 'UNKNOWN'
);

CREATE TABLE "IntegrationEvent" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "direction"     "IntegrationDirection" NOT NULL,
  "operation"     TEXT NOT NULL,
  "outcome"       "IntegrationOutcome" NOT NULL,
  "errorCategory" "IntegrationErrorCategory",
  "detail"        TEXT,
  "httpStatus"    INTEGER,
  "attempts"      INTEGER NOT NULL DEFAULT 1,
  "durationMs"    INTEGER,
  "externalId"    TEXT,
  "entityType"    TEXT,
  "entityId"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "show me this provider's traffic, newest first" — the integrations screen.
CREATE INDEX "IntegrationEvent_tenantId_provider_createdAt_idx"
  ON "IntegrationEvent"("tenantId", "provider", "createdAt" DESC);
-- "show me what is failing" — the question §33 is actually about.
CREATE INDEX "IntegrationEvent_tenantId_direction_outcome_createdAt_idx"
  ON "IntegrationEvent"("tenantId", "direction", "outcome", "createdAt" DESC);
-- The retention sweep reads across tenants, by age.
CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");

-- ── Row-level security ──────────────────────────────────────────────────────
--
-- Same shape as every other tenant-owned table. It matters here specifically:
-- `detail` holds provider error messages, which routinely quote back part of
-- what was sent, so a cross-tenant read is a leak of one workspace's traffic
-- into another's screen rather than merely of metadata.
ALTER TABLE "IntegrationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "IntegrationEvent" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "IntegrationEvent" TO master_saas_app;
