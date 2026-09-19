-- Account deletion schedules identity documents for removal; the retention job purges them.
ALTER TABLE "HrEmployeeDocument" ADD COLUMN "purgeAt" TIMESTAMP(3);
CREATE INDEX "HrEmployeeDocument_purgeAt_idx" ON "HrEmployeeDocument" ("purgeAt");
