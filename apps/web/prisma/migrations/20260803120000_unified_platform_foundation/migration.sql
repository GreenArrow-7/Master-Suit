-- Unified platform foundation (additive, rollback-friendly).
-- Existing tenant-scoped users and sessions remain valid while callers migrate
-- to PlatformUser, WorkspaceMembership and PlatformSession.

CREATE TYPE "PlatformRole" AS ENUM ('USER', 'OWNER', 'SUPPORT', 'SECURITY_AUDITOR');
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

ALTER TABLE "Tenant"
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "companySize" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'AE',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'AED',
  ADD COLUMN "companyEmail" TEXT,
  ADD COLUMN "companyPhone" TEXT,
  ADD COLUMN "address" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "maxUsers" INTEGER,
  ADD COLUMN "maxEmployees" INTEGER,
  ADD COLUMN "maxStorageMb" INTEGER,
  ADD COLUMN "trialStartedAt" TIMESTAMP(3),
  ADD COLUMN "trialEndsAt" TIMESTAMP(3);

CREATE TABLE "PlatformUser" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "passwordHash" TEXT,
  "fullName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "phone" TEXT,
  "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
  "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
  "emailVerifiedAt" TIMESTAMP(3),
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "mfaSecret" TEXT,
  "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "passwordChangedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMembership" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "platformUserId" TEXT NOT NULL,
  "salesUserId" TEXT,
  "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
  "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT false,
  "roleSnapshot" TEXT,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt" TIMESTAMP(3),
  "suspendedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "employeeNumber" TEXT NOT NULL,
  "departmentCode" TEXT,
  "designation" TEXT,
  "employmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "employmentType" TEXT,
  "joinedOn" TIMESTAMP(3),
  "managerMembershipId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSession" (
  "id" TEXT NOT NULL,
  "platformUserId" TEXT NOT NULL,
  "activeTenantId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "deviceLabel" TEXT,
  "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "actorUserId" TEXT,
  "event" TEXT NOT NULL,
  "objectType" TEXT,
  "objectId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "requestId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");
CREATE UNIQUE INDEX "PlatformUser_normalizedEmail_key" ON "PlatformUser"("normalizedEmail");
CREATE INDEX "PlatformUser_status_platformRole_idx" ON "PlatformUser"("status", "platformRole");
CREATE UNIQUE INDEX "WorkspaceMembership_salesUserId_key" ON "WorkspaceMembership"("salesUserId");
CREATE UNIQUE INDEX "WorkspaceMembership_tenantId_platformUserId_key" ON "WorkspaceMembership"("tenantId", "platformUserId");
CREATE INDEX "WorkspaceMembership_platformUserId_status_idx" ON "WorkspaceMembership"("platformUserId", "status");
CREATE INDEX "WorkspaceMembership_tenantId_status_idx" ON "WorkspaceMembership"("tenantId", "status");
CREATE UNIQUE INDEX "EmployeeProfile_membershipId_key" ON "EmployeeProfile"("membershipId");
CREATE UNIQUE INDEX "EmployeeProfile_tenantId_employeeNumber_key" ON "EmployeeProfile"("tenantId", "employeeNumber");
CREATE INDEX "EmployeeProfile_tenantId_employmentStatus_idx" ON "EmployeeProfile"("tenantId", "employmentStatus");
CREATE INDEX "EmployeeProfile_tenantId_managerMembershipId_idx" ON "EmployeeProfile"("tenantId", "managerMembershipId");
CREATE UNIQUE INDEX "PlatformSession_tokenHash_key" ON "PlatformSession"("tokenHash");
CREATE INDEX "PlatformSession_platformUserId_revokedAt_idx" ON "PlatformSession"("platformUserId", "revokedAt");
CREATE INDEX "PlatformSession_activeTenantId_platformUserId_idx" ON "PlatformSession"("activeTenantId", "platformUserId");
CREATE INDEX "PlatformSession_expiresAt_idx" ON "PlatformSession"("expiresAt");
CREATE INDEX "PlatformAuditEvent_occurredAt_idx" ON "PlatformAuditEvent"("occurredAt" DESC);
CREATE INDEX "PlatformAuditEvent_tenantId_occurredAt_idx" ON "PlatformAuditEvent"("tenantId", "occurredAt" DESC);
CREATE INDEX "PlatformAuditEvent_actorUserId_occurredAt_idx" ON "PlatformAuditEvent"("actorUserId", "occurredAt" DESC);
CREATE INDEX "PlatformAuditEvent_event_occurredAt_idx" ON "PlatformAuditEvent"("event", "occurredAt" DESC);

ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_salesUserId_fkey"
  FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_managerMembershipId_fkey"
  FOREIGN KEY ("managerMembershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_activeTenantId_fkey"
  FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One identity per normalized email. Existing password/MFA data is copied from
-- the oldest active tenant user; conflicts are surfaced by the validation query
-- in docs/MIGRATION-RUNBOOK.md before rollout.
INSERT INTO "PlatformUser" (
  "id", "email", "normalizedEmail", "passwordHash", "fullName", "avatarUrl", "phone",
  "status", "emailVerifiedAt", "mfaEnabled", "mfaSecret", "mfaRecoveryCodes",
  "failedLoginCount", "lockedUntil", "lastLoginAt", "passwordChangedAt", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (lower(trim("email")))
  concat('pu_', md5(lower(trim("email")))), lower(trim("email")), lower(trim("email")),
  "passwordHash", "fullName", "avatarUrl", "phone", "status", "emailVerifiedAt",
  "mfaEnabled", "mfaSecret", "mfaRecoveryCodes", "failedLoginCount", "lockedUntil",
  "lastLoginAt", "passwordChangedAt", "createdAt", CURRENT_TIMESTAMP
FROM "User"
WHERE "deletedAt" IS NULL
ORDER BY lower(trim("email")), (CASE WHEN "status" = 'ACTIVE' THEN 0 ELSE 1 END), "createdAt";

INSERT INTO "WorkspaceMembership" (
  "id", "tenantId", "platformUserId", "salesUserId", "status", "isPrimaryAdmin",
  "roleSnapshot", "invitedAt", "joinedAt", "createdAt", "updatedAt"
)
SELECT concat('wm_', md5(u."id")), u."tenantId", concat('pu_', md5(lower(trim(u."email")))), u."id",
  CASE
    WHEN u."status" = 'ACTIVE' THEN 'ACTIVE'::"MembershipStatus"
    WHEN u."status" = 'SUSPENDED' THEN 'SUSPENDED'::"MembershipStatus"
    WHEN u."status" = 'DEACTIVATED' THEN 'REMOVED'::"MembershipStatus"
    ELSE 'INVITED'::"MembershipStatus"
  END,
  (r."key" IN ('company_admin', 'admin', 'super_admin')), r."key", u."createdAt",
  CASE WHEN u."status" = 'ACTIVE' THEN u."createdAt" ELSE NULL END, u."createdAt", CURRENT_TIMESTAMP
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
WHERE u."deletedAt" IS NULL;

WITH numbered AS (
  SELECT u.*,
    row_number() OVER (PARTITION BY u."tenantId", coalesce(nullif(u."employeeCode", ''), concat('EMP-', substr(md5(u."id"), 1, 8))) ORDER BY u."createdAt", u."id") AS duplicate_no
  FROM "User" u
  WHERE u."deletedAt" IS NULL
)
INSERT INTO "EmployeeProfile" (
  "id", "tenantId", "membershipId", "employeeNumber", "designation",
  "employmentStatus", "joinedOn", "metadata", "createdAt", "updatedAt"
)
SELECT concat('ep_', md5(n."id")), n."tenantId", concat('wm_', md5(n."id")),
  concat(coalesce(nullif(n."employeeCode", ''), concat('EMP-', substr(md5(n."id"), 1, 8))),
    CASE WHEN n.duplicate_no > 1 THEN concat('-', n.duplicate_no) ELSE '' END),
  n."jobTitle", CASE WHEN n."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  n."createdAt", jsonb_build_object('source', 'sales-user-backfill'), n."createdAt", CURRENT_TIMESTAMP
FROM numbered n;
