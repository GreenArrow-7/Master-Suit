# The phone app checks in and receives pushes through the mobile API

**What.** The two parts of the standalone Lead Eagle app's API that #234 left
out: its attendance tab (`GET /api/mobile/attendance`, `POST
/api/mobile/attendance/challenge`, `/check-in`, `/check-out`) on YOUHAN ONE's
own face check-in, and `POST`/`DELETE /api/mobile/devices/push` registering the
phone's native push token. `me` now reports the real work location and
enrolment. PR #237, stacked on #235 (`batch/le-finish-r1`).

**Why.** Audit row M20-10, the two items `2026-10-19-le-mobile-api.md` left
open. Owner defaults, decided for the owner on 19 Oct by the orchestrating
session: (1) attendance on the phone follows YOUHAN ONE's rules exactly, a face
capture and a position on check-in and on check-out, as the web check-in does,
so a check-out without frames is refused 422; (2) pushes go to the phone's
native token (FCM on Android, APNs on iOS) in `DeviceToken`, never an Expo
token, and APNs addresses each token's own app (Lead Eagle `ae.leadeagle.app`,
YOUHAN ONE `com.youhan.one`); FCM is unchanged (one Firebase project holds both
Android apps).

**Where.**

- `src/services/hr/mobileAttendance.ts` — `punchFromPhone` (multipart frames, challenge, position → the web console's `punch()`), `currentShift`, `launchAttendance` (for `me`).
- `src/app/api/mobile/attendance/` — `route.ts` (GET), `challenge`, `check-in`, `check-out`: `hr_self:VIEW`, `selfService`, `mobile: true`, as the web's `hr/self/[action]`; the three POSTs share `PHONE_ATTEMPTS` (30 per 10 minutes per person, one bucket), GET keeps the default.
- `src/services/hr/attendance.ts` — an accepted `punch()` also answers `punchId` and `locationName`.
- `src/app/api/mobile/devices/push/route.ts` — register (POST), forget (POST `pushToken: null`, or DELETE); `notifications:EDIT`, `selfService`, 20 per 5 minutes, as `/api/v1/devices`.
- `prisma/migrations/20261019150000_device_token_app` — `DeviceToken.bundleId`, `DeviceToken.deviceSessionId` (nullable; the model stays global, scoped by `userId`).
- `src/lib/push/send.ts` — `apns-topic` is `ae.leadeagle.app` (`LEAD_EAGLE_BUNDLE_ID`) when the token's `bundleId` is that, else `APNS_BUNDLE_ID`; `pushTargets` is the one token read for `workers/notifications.ts` and `notification-preferences/test`, dropping (and deleting) a token whose device session is revoked or expired.
- `src/app/api/mobile/auth/sign-out/route.ts`, `src/services/identity/accounts.ts` (`signOutDevice`) — signing a phone out forgets its token.

**Behaviour.**

- `challenge` is the web's `requestChallenge` (consent, enrolment, the face engine up, a single-use nonce whose move the server picked), answered `{ challengeId, instruction, expiresIn, frames: 3 }`.
- `check-in` and `check-out` take multipart: `photo` (2 to 10 JPEG or PNG frames, the first neutral, the last after the move), `challengeId`, `latitude`, `longitude`, `accuracyM`. Missing frames (the standalone app's JSON check-out among them) answer 422 `face-required` ("Checking out needs your face as well as your location…"); a missing or blank position 422 `location-required`; both before the challenge is spent or a punch row written. The rest is `punch()` unchanged: the minimum interval, the open check-in, the work gate, the assignment, GPS accuracy, the nonce, liveness, face match, then the geofence, every refusal a punch row (with the frame as evidence once the camera is involved) answered 422 with its sentence and `result` (`REJECTED_GEOFENCE`, …); an accepted one is the audited punch row and the day record, answered `{ ok, shiftId, locationName, distanceM, tasks }`. The punch's device is `mobile:{device session id}`.
- `GET /api/mobile/attendance` answers the open check-in (`id`, `locationName`, `checkInAt`), today's calling target as `tasks`, and `blocked: []` (the work gate decides at the punch and its refusal is the 422 the app shows), or `{ shift: null }`.
- `me.attendance` is `{ location: { name, radiusMeters } | null, enrolled }`: the first active assignment that allows check-in and has not ended (primary first), and face templates at the workspace's sample count. A seat with no employee record reads `null`/`false`.
- `devices/push` takes `{ pushToken, platform, bundleId }`, kept on the token for the signed-in person and this device session (a token moves to whoever registers it, as `/api/v1/devices`). `bundleId` is `ae.leadeagle.app` or `APNS_BUNDLE_ID` (stored as null) or absent; any other app is refused 422, since the team's APNs key would sign a push for any app the team owns. An `ExponentPushToken[…]` is refused 422 naming the native token; a token without `platform` 422. `pushToken: null`, DELETE, the app's sign-out and Profile → Security → Sign out remove this phone's token and no other.
- A token registered under a device session is pushed to only while that session lives (not revoked, not past its 90 days, kind MOBILE); otherwise the worker and the test route delete it before sending. So every revocation (sign out everywhere, a password change or reset, MFA reset, deactivation, a role change) and the expiry stop the phone's notifications without each of them deleting tokens. A token with no session (`/api/v1/devices`) is kept as before.
- A multipart body that does not parse (the proxy cuts bodies at 10 MiB, Next's `proxyClientMaxBodySize`) is answered 413 `photos-too-large` with a sentence naming the size, not `face-required`.

**Verified.** `tests/integration/mobile-attendance-push.spec.ts` (17): `me` with and without a location, enrolment and an employee record; the challenge and its refusals (no enrolment 409, no employee 404, no bearer 401); a check-in without frames, without or with a blank position (422, no row, the challenge kept); outside the fence (422 with the distance, a `REJECTED_GEOFENCE` row, the challenge spent so a replay is 409); a stranger's face and a burst without the move (422); an accepted check-in (row, audit, open shift); the standalone app's JSON check-out (422, shift still open); a check-out outside the fence then inside it (shift closed); register, the Expo and platform refusals, and forgetting on null, DELETE, sign-out and Profile's sign-out. `tests/unit/push-send.spec.ts`: each iOS token's topic (http2 stubbed). With the topic back to `APNS_BUNDLE_ID` the topic case fails, and without the sign-out's delete the forgetting case fails (both tried). Review round (19 Oct): an unknown `bundleId` 422 with no row; a topic for another team app falls back to `APNS_BUNDLE_ID` (unit); after `revokeAllSessions` (the password change) and after expiry `pushTargets` drops and deletes the phone's token, keeping a session-less one; 30 refused challenges then 429 on challenge, check-in and check-out, GET still 200; a cut-off multipart 413. Each case fails with its fix reverted (all four tried at once: 7 failures). `mobile-api`, `push-test`, `notification-prefs`, `notification-digest`, the HR punch, work-gate and self-service specs pass unchanged; `tests/unit` (76 files) and `tsc` clean; `public/openapi.json` unchanged (it documents `/api/v1` only).

**Left open.**

- The standalone app needs a store build: check-out through the camera like check-in (challenge, frames, then `check-out`), and `getDevicePushTokenAsync()` sent with `platform` and its bundle id instead of the Expo token.
- APNs: the `.p8` in `APNS_KEY` must belong to the Apple team that owns `ae.leadeagle.app`, or Lead Eagle's iOS pushes are refused. FCM: the Lead Eagle Android app must be added to the Firebase project in `FCM_PROJECT_ID` (its `google-services.json` from there), or its tokens answer a sender mismatch.
- The store build must bound the frames: `takePictureAsync` with a `pictureSize` or a resize to about 1280 px on the long edge, so each frame stays under 3 MB and the burst under 10 MiB; full-sensor JPEGs are refused 413.
- The web `hr/self` challenge and punch still have only the default 1200 a minute (a `ponytail:` note there); give them `PHONE_ATTEMPTS`' `consume()` if the browser is abused the same way.
