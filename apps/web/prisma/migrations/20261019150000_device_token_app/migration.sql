-- Pushes to the Lead Eagle phone app (M20-10, 19 Oct): a device token keeps the
-- app's bundle id, which APNs addresses an iOS push to (null: APNS_BUNDLE_ID),
-- and the phone's device session, so signing that phone out forgets its token.
-- Additive and nullable; DeviceToken stays global, scoped by userId.

ALTER TABLE "DeviceToken" ADD COLUMN "bundleId" TEXT;
ALTER TABLE "DeviceToken" ADD COLUMN "deviceSessionId" TEXT;
