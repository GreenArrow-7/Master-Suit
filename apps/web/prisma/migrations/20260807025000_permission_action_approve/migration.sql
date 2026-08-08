-- Adds the APPROVE action.
--
-- Its own migration because Postgres refuses to use a new enum value in the same
-- transaction that created it, and Prisma runs each migration in one. The
-- permissions that use it are created in the next migration.
ALTER TYPE "PermissionAction" ADD VALUE IF NOT EXISTS 'APPROVE';
