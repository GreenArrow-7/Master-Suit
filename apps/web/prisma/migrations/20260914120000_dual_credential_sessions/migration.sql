-- One platform identity, two passwords, and a session that remembers which.
--
-- A platform staff identity may now hold a second password whose only effect is
-- read-only monitoring of explicitly authorised workspaces. The password that
-- was proven decides the session's mode, so the session has to record it, and
-- the MFA step has to carry it from the password check to the session without
-- trusting the client.
--
-- What this migration does NOT do:
--   * create a monitoring credential for anyone — the column starts null and is
--     only ever set by the identity itself, from an administration session, with
--     fresh re-authentication;
--   * create, widen or reinterpret any access grant;
--   * treat an existing session as either mode. A staff session issued before
--     this has no credential purpose, and it is revoked below.

-- CreateEnum
CREATE TYPE "PlatformCredentialPurpose" AS ENUM ('PLATFORM_ADMIN', 'MONITORING');

-- AlterTable
--
-- passwordVersion starts at 1 for every existing password. The monitoring
-- version starts at 0 with no hash: there is no monitoring credential until
-- someone sets one.
ALTER TABLE "PlatformUser"
  ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "monitoringPasswordHash" TEXT,
  ADD COLUMN "monitoringPasswordVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "monitoringPasswordSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformSession"
  ADD COLUMN "credentialPurpose" "PlatformCredentialPurpose",
  ADD COLUMN "credentialVersion" INTEGER;

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN "credentialPurpose" "PlatformCredentialPurpose";

-- CreateTable
--
-- No tenantId: a sign-in has not chosen a workspace yet. Outside row-level
-- security by construction, like PlatformSession, and listed in GLOBAL_MODELS.
CREATE TABLE "PlatformMfaChallenge" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "credentialPurpose" "PlatformCredentialPurpose",
    "credentialVersion" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMfaChallenge_tokenHash_key" ON "PlatformMfaChallenge"("tokenHash");
CREATE INDEX "PlatformMfaChallenge_platformUserId_consumedAt_idx" ON "PlatformMfaChallenge"("platformUserId", "consumedAt");
CREATE INDEX "PlatformMfaChallenge_expiresAt_idx" ON "PlatformMfaChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "PlatformMfaChallenge" ADD CONSTRAINT "PlatformMfaChallenge_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformMfaChallenge" TO master_saas_app;

-- Legacy staff sessions.
--
-- A live OWNER, SUPPORT or SECURITY_AUDITOR session issued before this cannot
-- say which password proved it, and must not be read as administration by
-- default. It is revoked: the person signs in again and chooses by the password
-- they type. The application refuses any such session regardless (including one
-- an older web tier issues during the deployment window); revoking here makes
-- the database say the same thing. Workspace users and machine identities keep
-- their sessions.
UPDATE "PlatformSession" s
   SET "revokedAt" = CURRENT_TIMESTAMP,
       "revokedReason" = 'CREDENTIAL_PURPOSE_MIGRATION'
  FROM "PlatformUser" u
 WHERE u."id" = s."platformUserId"
   AND s."revokedAt" IS NULL
   AND s."purpose" <> 'AI_SERVICE'
   AND u."platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR');

-- Unused reset links for staff carry no credential purpose either. Retire them;
-- the reset route refuses a purpose-less link for a staff identity anyway.
UPDATE "PasswordResetToken" t
   SET "usedAt" = CURRENT_TIMESTAMP
  FROM "PlatformUser" u
 WHERE u."id" = t."platformUserId"
   AND t."usedAt" IS NULL
   AND u."platformRole" IN ('OWNER', 'SUPPORT', 'SECURITY_AUDITOR');
