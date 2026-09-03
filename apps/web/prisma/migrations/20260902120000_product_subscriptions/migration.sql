-- Product subscriptions: one row per product a company has bought.
--
-- Before this, a company had exactly one TenantSubscription carrying exactly one
-- plan, and SubscriptionModule was a bare (module, state) tag beneath it. Two
-- things were therefore unrepresentable, and both are ordinary commercial states:
--
--   1. HRMS_PRO and SALES_BASIC at the same time. One planId for the container
--      meant one plan for every product the customer owned.
--   2. Cancelling Sales while keeping HR. Every write path updated entitlements
--      with `where: { tenantId }` and no module filter, so cancelling anything
--      cancelled everything.
--
-- The billing container stays exactly as it is — one per tenant, same id, same
-- plan column, nothing dropped — and SubscriptionModule grows into the product
-- subscription. That keeps this migration additive: no column is removed and no
-- row is deleted, so a rollback is a schema revert rather than a data recovery.

-- ── Schema ──────────────────────────────────────────────────────────────────
--
-- The (subscriptionId, module) unique goes because "two sources provide SALES"
-- is legitimate: a bundle overlapping a standalone contract during a migration,
-- or a promotional term running alongside a paid one. Entitlement asks whether
-- ANY source is usable, so several rows per module is the normal case.
DROP INDEX IF EXISTS "SubscriptionModule_subscriptionId_module_key";

ALTER TABLE "SubscriptionModule"
  ADD COLUMN IF NOT EXISTS "planId"             TEXT,
  ADD COLUMN IF NOT EXISTS "metadata"           JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "startsAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "endsAt"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trialEndsAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "graceEndsAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "currentPeriodEnd"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceledAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "externalCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalContractId" TEXT;

CREATE INDEX IF NOT EXISTS "SubscriptionModule_subscriptionId_module_idx"
  ON "SubscriptionModule"("subscriptionId", "module");
CREATE INDEX IF NOT EXISTS "SubscriptionModule_module_state_idx"
  ON "SubscriptionModule"("module", "state");
CREATE INDEX IF NOT EXISTS "SubscriptionModule_planId_idx"
  ON "SubscriptionModule"("planId");

ALTER TABLE "SubscriptionModule"
  ADD CONSTRAINT "SubscriptionModule_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Data: inherit the container's commercial terms ───────────────────────────
--
-- Every existing product row keeps the plan and the dates it was actually being
-- sold under. Without this each row would read "no plan, starts now", and a
-- customer mid-trial would look like a fresh purchase.
UPDATE "SubscriptionModule" sm
SET "planId"             = COALESCE(sm."planId", ts."planId"),
    "startsAt"           = ts."createdAt",
    "trialEndsAt"        = ts."trialEndsAt",
    "graceEndsAt"        = ts."graceEndsAt",
    "currentPeriodEnd"   = ts."currentPeriodEnd",
    "canceledAt"         = ts."canceledAt",
    "externalCustomerId" = ts."externalCustomerId",
    "externalContractId" = ts."externalContractId"
FROM "TenantSubscription" ts
WHERE ts."id" = sm."subscriptionId";

-- ── Data: entitlement continuity ────────────────────────────────────────────
--
-- This is the half that protects live customers, and it runs in this direction
-- deliberately.
--
-- After this migration ModuleEntitlement is DERIVED — syncModuleEntitlements
-- recomputes it from the product rows below. A tenant that holds a usable
-- entitlement today but has no matching product row would therefore lose access
-- the first time anything reconciled, which is the worst possible outcome for a
-- paying customer and would look like an outage with no cause.
--
-- So: give every currently-usable entitlement a product row that explains it.
-- The state and dates are copied from the entitlement itself, so the derived
-- answer after the first sync is identical to what the tenant has right now.
INSERT INTO "SubscriptionModule" (
  "id", "subscriptionId", "module", "planId", "state", "limits", "metadata",
  "startsAt", "endsAt", "trialEndsAt", "graceEndsAt", "currentPeriodEnd",
  "createdAt", "updatedAt"
)
SELECT
  -- Deterministic id: re-running this migration cannot produce a second row for
  -- the same (subscription, module) pair.
  'psub_' || substr(md5(ts."id" || '/' || me."module"::text), 1, 20),
  ts."id",
  me."module",
  ts."planId",
  me."state",
  me."limits",
  jsonb_build_object('backfilledFrom', 'ModuleEntitlement'),
  me."startsAt",
  me."endsAt",
  ts."trialEndsAt",
  ts."graceEndsAt",
  ts."currentPeriodEnd",
  me."createdAt",
  NOW()
FROM "ModuleEntitlement" me
JOIN "TenantSubscription" ts ON ts."tenantId" = me."tenantId"
WHERE NOT EXISTS (
  SELECT 1 FROM "SubscriptionModule" sm
  WHERE sm."subscriptionId" = ts."id" AND sm."module" = me."module"
);
