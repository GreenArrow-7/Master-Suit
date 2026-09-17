-- A person's request to delete their own platform account, recorded and tracked.
--
-- Scope is the login identity and the person's membership of every workspace they
-- belong to. It is not a workspace deletion and not a deletion of the records that
-- person created: those belong to the customer's workspace.

CREATE TYPE "AccountDeletionStatus" AS ENUM ('REQUESTED', 'BLOCKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "requestedInTenantId" TEXT,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "blockedReason" TEXT,
    "outcome" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountDeletionRequest_platformUserId_status_idx"
    ON "AccountDeletionRequest" ("platformUserId", "status");
CREATE INDEX "AccountDeletionRequest_status_requestedAt_idx"
    ON "AccountDeletionRequest" ("status", "requestedAt");

-- One open request per person, enforced by the database rather than by a read-then-write
-- in the service: two taps on a slow connection must not become two rows. COMPLETED and
-- CANCELLED are terminal, so they are excluded and a person may ask again later.
CREATE UNIQUE INDEX "AccountDeletionRequest_one_open_per_user"
    ON "AccountDeletionRequest" ("platformUserId")
    WHERE "status" IN ('REQUESTED', 'BLOCKED', 'IN_PROGRESS');

ALTER TABLE "AccountDeletionRequest"
    ADD CONSTRAINT "AccountDeletionRequest_platformUserId_fkey"
    FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
