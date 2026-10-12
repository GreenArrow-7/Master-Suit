-- A cold call is a logged call (Lead Eagle audit, M5-06): working a cold record
-- writes an outbound-call Activity on it, so an Activity may name the record it
-- was made on as it names a lead. Additive; the table's RLS policy already
-- covers the row by tenantId.
--
-- SET NULL, not CASCADE: Make lead re-points a record's calls onto the lead, so
-- they are the lead's timeline too; deleting the record must not delete them.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "dataRecordId" TEXT;

-- CreateIndex
CREATE INDEX "Activity_tenantId_dataRecordId_occurredAt_idx" ON "Activity"("tenantId", "dataRecordId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_dataRecordId_fkey" FOREIGN KEY ("dataRecordId") REFERENCES "DataRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
