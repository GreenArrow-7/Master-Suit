-- One identity, one credential.
--
-- `User` (a workspace membership) carried a full duplicate of the authentication
-- columns that `PlatformUser` (the person) already had. Nothing enforced that the
-- two agreed, and they did not: `auth/reset-password` wrote only the User copy
-- while `auth/login` reads only PlatformUser, so a password reset silently did
-- nothing and the old — possibly leaked — password kept working. Workspace
-- provisioning had the mirror-image bug: its PlatformUser upsert skipped the
-- password on the update branch, so re-using an existing email produced an
-- administrator who could not sign in.
--
-- Fixing the call sites one at a time would leave the shape that caused it. The
-- columns go.

-- Carry anything the duplicate holds that the authority does not, so a person
-- whose only good password lived on the User row is not locked out by this
-- migration. Newest non-null write wins; PlatformUser is preferred when both
-- carry a value, because that is the one login has been reading all along.
UPDATE "PlatformUser" p
SET "passwordHash"      = COALESCE(p."passwordHash", u."passwordHash"),
    "mfaSecret"         = COALESCE(p."mfaSecret", u."mfaSecret"),
    "mfaEnabled"        = p."mfaEnabled" OR u."mfaEnabled",
    "passwordChangedAt" = COALESCE(p."passwordChangedAt", u."passwordChangedAt"),
    "lastLoginAt"       = GREATEST(p."lastLoginAt", u."lastLoginAt")
FROM "WorkspaceMembership" m
JOIN "User" u ON u."id" = m."salesUserId"
WHERE m."platformUserId" = p."id"
  AND p."passwordHash" IS NULL;

-- Recovery codes are an array; only adopt them when the authority has none.
UPDATE "PlatformUser" p
SET "mfaRecoveryCodes" = u."mfaRecoveryCodes"
FROM "WorkspaceMembership" m
JOIN "User" u ON u."id" = m."salesUserId"
WHERE m."platformUserId" = p."id"
  AND cardinality(p."mfaRecoveryCodes") = 0
  AND cardinality(u."mfaRecoveryCodes") > 0;

ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" DROP COLUMN "mfaEnabled";
ALTER TABLE "User" DROP COLUMN "mfaSecret";
ALTER TABLE "User" DROP COLUMN "mfaRecoveryCodes";
ALTER TABLE "User" DROP COLUMN "failedLoginCount";
ALTER TABLE "User" DROP COLUMN "lockedUntil";
ALTER TABLE "User" DROP COLUMN "lastLoginAt";
ALTER TABLE "User" DROP COLUMN "passwordChangedAt";
