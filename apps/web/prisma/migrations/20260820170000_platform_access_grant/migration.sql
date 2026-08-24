-- Break-glass for platform write access into a customer workspace.
--
-- ── What it replaces ────────────────────────────────────────────────────────
--
-- `lib/auth/support-actor.ts` gave a platform OWNER every permission in every
-- tenant at ORGANIZATION scope, permanently, with no record of why. SUPPORT and
-- SECURITY_AUDITOR were already read-only; OWNER was not, and the difference was
-- invisible — the workspace-entry audit row even recorded
-- `mode: 'platform_support_readonly'` for a session that could delete a
-- customer's payroll.
--
-- Reading a customer's data and changing it are different acts. Only the first
-- should be ambient.
--
-- ── What this table is ──────────────────────────────────────────────────────
--
-- One row per elevation: who, into which workspace, why, and until when. Without
-- an unexpired, unrevoked row, an OWNER inside a workspace now gets exactly the
-- read-only actor SUPPORT gets. Expiry is enforced on read, so access ends on
-- time whether or not anybody closes it.
--
-- ── What it deliberately does not do ────────────────────────────────────────
--
-- There is no approver column, and it is not an oversight. M-5 asks for
-- "break-glass approval and a time limit"; the time limit is here, and
-- second-person approval is not, because a platform with one owner cannot
-- satisfy it and would be locked out of its own product. Whether this deployment
-- has a second person to approve is an organisational question, not a schema
-- one — see the roadmap. Adding a column now for a control nobody enforces is
-- the dead-schema pattern this codebase already has too much of.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- A bootstrap table, like PlatformAuditEvent and PlatformSession. It carries a
-- tenantId but it is control-plane data about *staff*, resolved before any
-- tenant context exists — the lookup that decides whether the actor may write is
-- the one that would have to set `app.tenant_id`, and a policy here would make
-- that lookup match nothing. It is reachable only through requirePlatformOwner.

CREATE TABLE "PlatformAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "requestId" TEXT,

    CONSTRAINT "PlatformAccessGrant_pkey" PRIMARY KEY ("id")
);

-- The lookup on every request from platform staff inside a workspace: one
-- person, one tenant, still in date.
CREATE INDEX "PlatformAccessGrant_platformUserId_tenantId_expiresAt_idx"
    ON "PlatformAccessGrant"("platformUserId", "tenantId", "expiresAt");
-- "Who has been in this workspace, and why" — the question an incident asks.
CREATE INDEX "PlatformAccessGrant_tenantId_grantedAt_idx"
    ON "PlatformAccessGrant"("tenantId", "grantedAt");

ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_platformUserId_fkey"
    FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformAccessGrant" ADD CONSTRAINT "PlatformAccessGrant_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformAccessGrant" TO master_saas_app;
