# The phone app's API: device sessions, idempotent writes and call times that stay true

**What.** `/api/mobile/*`, the standalone Lead Eagle Expo app's API, ported to
YOUHAN ONE with the same paths and JSON shapes, so the app can later point its
server at YOUHAN ONE unchanged: sign in, sign out, `me`, the lead list, log a
call, move a lead, today's follow-ups. A phone signs in with a 90-day bearer
token held in the same session table as the browser's; Profile → Security lists
the phones signed in, each with **Sign out**. PR #234.

**Why.** Audit row M20-10 ("a mobile API: bearer-token device sessions in the
same sessions table with the same revocation, idempotency keys bound to the
person, call logs that keep the real call time and refuse future times"),
built on the owner's approval of building everything that needs no owner
account.

**Where.**

- `prisma/migrations/20261019090000_device_sessions` — `PlatformSession.kind` (`WEB`, `MOBILE`) and `platform`; the device's name goes in the existing `deviceLabel`.
- `src/lib/auth/login.ts` — the web login's steps, moved out of `api/v1/auth/login/route.ts` unchanged, with a `MobileDoor`: one named workspace, workspace users only, a device session at the end. `api/v1/auth/login/route.ts` is now its caller.
- `src/lib/auth/session.ts` — `createDeviceSession`, `resolveDeviceCtx`; `loadSession` reads browser sessions only. `api/v1/auth/refresh` refuses a phone's token.
- `src/lib/api/handler.ts` — `route({ mobile: true })`: the device bearer and nothing else; a replay answers `Idempotent-Replay: true`.
- `src/app/api/mobile/` — `auth/sign-in`, `auth/sign-out`, `me`, `leads`, `leads/[leadId]/call`, `leads/[leadId]/status`, `follow-ups`.
- `src/services/leads/logCall.ts` — `logLeadCall`, the one-step call log moved out of `api/v1/leads/[id]/call-log` so both doors write the same rows.
- `src/services/identity/accounts.ts` (`myDevices`, `signOutDevice`), `identity/self/[action]` (`device-sign-out`), `profile/security/page.tsx`, `SecurityScreen.tsx`, `globals.css` — Phones signed in.

**Behaviour.**

- Sign-in (`POST /api/mobile/auth/sign-in`, `{ workspace, email, password, deviceName?, platform? }`) runs the web form's code: the same per-address and per-account throttle, lockout, one answer for a wrong password, an unknown account, a workspace the person is not in, a suspended or deactivated account and platform staff. With an authenticator it answers `{ mfaRequired, challenge }` and takes `{ workspace, challenge, mfaCode | recoveryCode }` next, as the web does. A workspace that requires two factors from someone with none enrolled, and a temporary or expired password, answer 403 saying to finish on the web; no session is made. Success answers `{ token, expiresAt, workspace }`.
- The token is `{tenantId}.{secret}`, 256 random bits, only the secret's SHA-256 kept, on a `MOBILE` row pinned to that workspace for 90 days (no idle timeout). It works only as `Authorization: Bearer` on `/api/mobile`: refused with another workspace's id in front, as a cookie on any web route, by the refresh route, and as a bearer on `/api/v1` (it never parses as an API key). A browser cookie is refused on `/api/mobile`. Each request re-checks what the web does: the account active, the membership, the workspace and the user active.
- Revocation: every path that ends a person's sessions (password change or reset, sign out everywhere, suspension, removal, role and permission changes, ended employment, the platform console) updates the identity's rows without a kind, so it ends their phones too. A phone signs itself out (`POST /api/mobile/auth/sign-out`, that phone only); Profile → Security → Phones signed in lists this workspace's phones (name, iPhone or Android, last used on the workspace's clock) and signs one out (audited `LOGOUT`); another person's id is not found.
- Writes (`call`, `status`) take an `Idempotency-Key` through `route()`: the same person, key and body replays the first answer; a different body or person is 409; kept 24 h per workspace (`IdempotentRequest`, under RLS). The call also hands the key to `logLeadCall`, which keeps it in the call's own transaction (`mobile.lead.call`): a retry sent while the first is still running gets 409 and writes nothing, where `route()`'s check alone let both through.
- A call from the phone (`CONNECTED`, `NO_ANSWER`, `BUSY`, `SWITCHED_OFF`, `CALLBACK_REQUESTED`, `WRONG_NUMBER`, `NOT_INTERESTED`) is the web call log's activity, score, follow-up and audit rows, under the lead's `leads:EDIT` scope (404 outside it). Its `occurredAt` is kept; more than 2 minutes ahead of the server, or more than a week old, is refused 422.
- The lead list is the web grid's query (lead scope, named filter as `preset`, search, closed-out left out), keyset-paged by `cursor`, `q` matching a lead's id as well as the text search (any word of 9+ characters starting with c passes for a cuid, so the id never replaces the search); numbers as the role reads them (`masked`). Follow-ups are the caller's own open ones on leads they reach, overdue before today began on the workspace's clock, no number for a masking role. Both need a lead module (Sales, Real Estate or Lead Eagle).

**Verified.** `tests/integration/mobile-api.spec.ts` (28): sign-in and its row, refusals, throttle and lockout, both MFA steps, MFA enrolment and temporary passwords sent to the web, bearer only, the edited prefix, cookie and refresh refusals, per-device and Profile sign-out, password change, sign out everywhere, the revocation hook, an inactive membership, idempotent replay and both 409s, the kept call time, the 2-minute skew and the future and week-old refusals, record scope on calls, lists and moves, the product gate, and every mobile route declaring `mobile: true`. With `loadSession`'s kind check removed the cookie case fails, and with the 2-minute check removed the future-time case fails (both tried). Existing login, MFA, call-log and security specs pass unchanged (`self-service-platform-staff.spec.ts` mocks the two new loaders). `public/openapi.json` regenerated (the `device-sign-out` action). Review fixes: two calls sent at once with one key log one activity (200 and 409, then a replay of the first), and a search for "Christina" or an email starting with "chris" finds the lead; both cases fail without their fix (tried).

**Left open.**

- The app's attendance tab (`/api/mobile/attendance/*`) is not served: YOUHAN ONE checks out with the face too, and the app checks out with a position only. Owner decision: face on check-out from the phone, or the app sending frames. Until then `me` reports no work location, so the app offers no check-in.
- `devices/push` (an Expo push token on the session) is not served: nothing here sends through Expo. The app ignores the refusal.
- Pointing the Expo app at YOUHAN ONE is a store build of that app.
