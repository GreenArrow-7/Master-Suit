-- Authorised workspace access for platform staff, and coverage of all of them.
--
-- Until now a platform OWNER could open any workspace on the platform: the
-- `enter` route looked the workspace up, pointed the session at it, and wrote a
-- WORKSPACE_OPENED row. That is an audited entry, which is not the same thing as
-- an authorised one — nothing anywhere expressed *which* customers a given
-- member of staff was supposed to be able to see.
--
-- PlatformAccessGrant already held the shape: a named person, a named workspace,
-- a stated reason, an expiry, revocation, and a row in the customer's own audit
-- trail. It only ever expressed one kind of authority (break-glass write), so
-- this adds the weaker kind rather than a second table.

-- CreateEnum
CREATE TYPE "PlatformGrantKind" AS ENUM ('READ', 'WRITE');

-- AlterTable
--
-- DEFAULT 'READ' and then backfill to 'WRITE': every row that exists today was
-- written by the break-glass route, which is the only thing that could create
-- one, so reading them as READ would silently downgrade a live elevation. The
-- default is for rows written *after* this, where the weaker kind is the safe
-- reading of an unspecified one.
ALTER TABLE "PlatformAccessGrant" ADD COLUMN "kind" "PlatformGrantKind" NOT NULL DEFAULT 'READ';
UPDATE "PlatformAccessGrant" SET "kind" = 'WRITE';

-- CreateIndex
DROP INDEX IF EXISTS "PlatformAccessGrant_platformUserId_tenantId_expiresAt_idx";
CREATE INDEX "PlatformAccessGrant_platformUserId_tenantId_expiresAt_kind_idx"
  ON "PlatformAccessGrant"("platformUserId", "tenantId", "expiresAt", "kind");

-- CreateTable
--
-- Deliberately carries no tenantId, and therefore sits outside row-level
-- security by construction rather than by exemption — the same shape, and the
-- same reason, as PlatformServiceCredential.
--
-- The alternative was a PlatformAccessGrant with a null tenantId, and
-- 20260826120000's own reasoning rules it out. That migration put this table
-- under a policy so that a query carrying some tenant's context could not "read
-- who has been inside which customer and why, or insert a grant naming a
-- workspace it had no business in". A null tenant would need `OR "tenantId" IS
-- NULL` in both halves of that policy, and in the WITH CHECK half it is a
-- privilege escalation: any tenant context could insert a grant covering every
-- workspace on the platform. Asymmetric USING/WITH CHECK would work and is
-- exactly the kind of subtlety that stops being understood.
CREATE TABLE "PlatformCoverageGrant" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "grantedById" TEXT,
    "requestId" TEXT,

    CONSTRAINT "PlatformCoverageGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformCoverageGrant_platformUserId_revokedAt_expiresAt_idx"
  ON "PlatformCoverageGrant"("platformUserId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "PlatformCoverageGrant" ADD CONSTRAINT "PlatformCoverageGrant_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The application role must be able to read and write it. Granted explicitly,
-- as every other table in this schema is: the role owns nothing and inherits
-- nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformCoverageGrant" TO master_saas_app;
