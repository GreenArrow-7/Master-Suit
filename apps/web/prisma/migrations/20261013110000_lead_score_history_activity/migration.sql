-- A score move's activity (Lead Eagle audit row M4-11, 13 Oct), so deleting the
-- activity takes back the points it gave. Additive: one nullable column; every
-- existing row keeps null (none was an activity's: activities never scored before).
ALTER TABLE "LeadScoreHistory" ADD COLUMN     "activityId" TEXT;
