-- An anonymous platform service identity for background/AI reads.
--
-- ── Why a new role rather than reusing OWNER or SUPPORT ─────────────────────
--
-- OWNER and SUPPORT are people. They hold a PlatformSession, they sign in with
-- a password and an authenticator, and OWNER can elevate to full write access
-- through a PlatformAccessGrant. A background service wants none of that: no
-- interactive login, no elevation path, and a credential that can be rotated
-- and revoked without touching a human's account.
--
-- Reusing SUPPORT would have worked on day one and been wrong on day two: the
-- first time somebody widened what SUPPORT may do for a genuine support reason,
-- the machine identity would have silently inherited it.
--
-- ── Read-only is structural, not configured ─────────────────────────────────
--
-- `buildSupportActor` grants AI_SERVICE only VIEW and VIEW_REPORTS, and the
-- elevation branch is gated on `platformRole === 'OWNER'`, so there is no value
-- of any column in this table that turns this identity into a writer. Write
-- capability would need a code change and a review, which is the point.
--
-- ── Why not APIKey ──────────────────────────────────────────────────────────
--
-- APIKey is tenant-scoped: a required `tenantId` and permissions derived from a
-- workspace Role. This identity belongs to no workspace and reads across all of
-- them. Bolting a nullable tenantId onto APIKey would have put a cross-tenant
-- credential in the table every workspace admin can already mint keys in.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- A bootstrap table like PlatformSession, PlatformAuditEvent and
-- PlatformAccessGrant: it carries no tenantId at all and is read before any
-- tenant context exists — the lookup is what decides which tenants the caller
-- may touch. Reachable only through requirePlatformServiceActor.

ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'AI_SERVICE';

CREATE TABLE "PlatformServiceCredential" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tenantAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 120,
    "lastUsedAt" TIMESTAMP(3),
    -- NOT NULL, unlike APIKey.expiresAt. A machine credential with no expiry is
    -- one nobody ever rotates.
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "rotatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PlatformServiceCredential_pkey" PRIMARY KEY ("id")
);

-- The authentication lookup: one credential, by the only part of it stored in
-- the clear.
CREATE UNIQUE INDEX "PlatformServiceCredential_prefix_key" ON "PlatformServiceCredential"("prefix");
CREATE UNIQUE INDEX "PlatformServiceCredential_keyHash_key" ON "PlatformServiceCredential"("keyHash");
-- "Which credentials does this identity have live" — what rotation and the
-- revoke-all path both ask.
CREATE INDEX "PlatformServiceCredential_platformUserId_revokedAt_idx"
    ON "PlatformServiceCredential"("platformUserId", "revokedAt");

ALTER TABLE "PlatformServiceCredential" ADD CONSTRAINT "PlatformServiceCredential_platformUserId_fkey"
    FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformServiceCredential" TO master_saas_app;
