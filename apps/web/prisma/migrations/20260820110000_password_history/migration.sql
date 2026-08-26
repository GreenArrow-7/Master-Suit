-- Previous credentials, so PasswordPolicy.reuseWindow can mean something.
--
-- `reuseWindow` has been typed on PasswordPolicy since it was written, defaulted
-- to 5, and offered on the workspace settings screen with a 0..24 validator. No
-- code read it. An administrator who set "cannot reuse the last five passwords"
-- got a setting that saved, redisplayed, and did nothing — which is worse than
-- not offering it, because it reads as a control that is working.
--
-- The same is true of `maxAgeDays`, which needs no table: expiry is derived from
-- PlatformUser.passwordChangedAt, which already exists.
--
-- No tenantId: a credential belongs to the PlatformUser, not to any one of their
-- workspace memberships. Outside row-level security for the same reason
-- PlatformUser is — it is read before any tenant is known.
CREATE TABLE "PasswordHistory" (
  "id"             TEXT         NOT NULL,
  "platformUserId" TEXT         NOT NULL,
  "passwordHash"   TEXT         NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

-- The only query shape: "the most recent N hashes for this account".
CREATE INDEX "PasswordHistory_platformUserId_createdAt_idx"
  ON "PasswordHistory" ("platformUserId", "createdAt" DESC);

-- CASCADE: a deleted account's former password hashes have no reason to outlive
-- it, and keeping them would be the one place credentials survived a deletion
-- request.
ALTER TABLE "PasswordHistory"
  ADD CONSTRAINT "PasswordHistory_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "PasswordHistory" TO master_saas_app;
