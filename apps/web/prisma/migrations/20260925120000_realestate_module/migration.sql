-- Real estate joins HRMS and SALES as a licensable module.
--
-- Added by hand rather than by `migrate dev`, which wanted to reset a
-- development database holding real workspaces. The value is only added here
-- and not used until a later migration, which is what keeps this safe inside
-- the transaction Prisma wraps it in.
ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'REALESTATE';
