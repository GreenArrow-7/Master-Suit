# The phone app checks in and receives pushes through the mobile API

**What.** The two parts of the standalone Lead Eagle app's API that #234 left
out: its attendance tab (`GET /api/mobile/attendance`, `POST
/api/mobile/attendance/challenge`, `/check-in`, `/check-out`) on YOUHAN ONE's
own face check-in, and `POST`/`DELETE /api/mobile/devices/push` registering the
phone's native push token. `me` now reports the real work location and
enrolment. PR #TBD, stacked on #235 (`batch/le-finish-r1`).

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
- `src/app/api/mobile/attendance/` — `route.ts` (GET), `challenge`, `check-in`, `check-out`: `hr_self:VIEW`, `selfService`, `mobile: true`, the default rate limit, as the web's `hr/self/[action]`.
- `src/services/hr/attendance.ts` — an accepted `punch()` also answers `punchId` and `locationName`.
- `src/app/api/mobile/devices/push/route.ts` — register (POST), forget (POST `pushToken: null`, or DELETE); `notifications:EDIT`, `selfService`, 20 per 5 minutes, as `/api/v1/devices`.
- `prisma/migrations/20261019150000_device_token_app` — `DeviceToken.bundleId`, `DeviceToken.deviceSessionId` (nullable; the model stays global, scoped by `userId`).
- `src/lib/push/send.ts` — `apns-topic` is the token's `bundleId`, else `APNS_BUNDLE_ID`; `workers/notifications.ts` and `notification-preferences/test` read the column.
- `src/app/api/mobile/auth/sign-out/route.ts`, `src/services/identity/accounts.ts` (`signOutDevice`) — signing a phone out forgets its token.

**Behaviour.**

- `challenge` is the web's `requestChallenge` (consent, enrolment, the face engine up, a single-use nonce whose move the server picked), answered `{ challengeId, instruction, expiresIn, frames: 3 }`.
- `check-in` and `check-out` take multipart: `photo` (2 to 10 JPEG or PNG frames, the first neutral, the last after the move), `challengeId`, `latitude`, `longitude`, `accuracyM`. Missing frames (the standalone app's JSON check-out among them) answer 422 `face-required` ("Checking out needs your face as well as your location…"); a missing or blank position 422 `location-required`; both before the challenge is spent or a punch row written. The rest is `punch()` unchanged: the minimum interval, the open check-in, the work gate, the assignment, GPS accuracy, the nonce, liveness, face match, then the geofence, every refusal a punch row (with the frame as evidence once the camera is involved) answered 422 with its sentence and `result` (`REJECTED_GEOFENCE`, …); an accepted one is the audited punch row and the day record, answered `{ ok, shiftId, locationName, distanceM, tasks }`. The punch's device is `mobile:{device session id}`.
- `GET /api/mobile/attendance` answers the open check-in (`id`, `locationName`, `checkInAt`), today's calling target as `tasks`, and `blocked: []` (the work gate decides at the punch and its refusal is the 422 the app shows), or `{ shift: null }`.
- `me.attendance` is `{ location: { name, radiusMeters } | null, enrolled }`: the first active assignment that allows check-in and has not ended (primary first), and face templates at the workspace's sample count. A seat with no employee record reads `null`/`false`.
- `devices/push` takes `{ pushToken, platform, bundleId }`, kept on the token for the signed-in person and this device session (a token moves to whoever registers it, as `/api/v1/devices`). An `ExponentPushToken[…]` is refused 422 naming the native token; a token without `platform` 422. `pushToken: null`, DELETE, the app's sign-out and Profile → Security → Sign out remove this phone's token and no other.

**Verified.** `tests/integration/mobile-attendance-push.spec.ts` (14): `me` with and without a location, enrolment and an employee record; the challenge and its refusals (no enrolment 409, no employee 404, no bearer 401); a check-in without frames, without or with a blank position (422, no row, the challenge kept); outside the fence (422 with the distance, a `REJECTED_GEOFENCE` row, the challenge spent so a replay is 409); a stranger's face and a burst without the move (422); an accepted check-in (row, audit, open shift); the standalone app's JSON check-out (422, shift still open); a check-out outside the fence then inside it (shift closed); register, the Expo and platform refusals, and forgetting on null, DELETE, sign-out and Profile's sign-out. `tests/unit/push-send.spec.ts`: each iOS token's topic (http2 stubbed). With the topic back to `APNS_BUNDLE_ID` the topic case fails, and without the sign-out's delete the forgetting case fails (both tried). `mobile-api`, `push-test`, `notification-prefs`, `notification-digest`, the HR punch, work-gate and self-service specs pass unchanged; `tests/unit` (76 files) and `tsc` clean; `public/openapi.json` unchanged (it documents `/api/v1` only).

**Left open.**

- The standalone app needs a store build: check-out through the camera like check-in (challenge, frames, then `check-out`), and `getDevicePushTokenAsync()` sent with `platform` and its bundle id instead of the Expo token.
- APNs: the `.p8` in `APNS_KEY` must belong to the Apple team that owns `ae.leadeagle.app`, or Lead Eagle's iOS pushes are refused. FCM: the Lead Eagle Android app must be added to the Firebase project in `FCM_PROJECT_ID` (its `google-services.json` from there), or its tokens answer a sender mismatch.
- Other revocations (password change, sign out everywhere, suspension) end the phone's session but leave its push token until the transport reports it stale or another account registers it, as for the YOUHAN ONE app's tokens.
