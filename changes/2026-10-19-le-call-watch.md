# Calls placed from the phone app log themselves

**What.** The phone app carries its own Capacitor plugin, CallWatch. Tapping
Call (or Phone, or one of a lead's other numbers) on the lead page or the lead
list, in the app, arms it before the dialler opens. When the call ends it is
logged on the lead through the one-step call log, with its real start time,
its talk time and Connected or No answer. The page then says "Call logged
automatically", with Edit, which corrects that call rather than adding one.
Branch `feat/le-call-watch`, PR #233.

**Why.** Audit row M9-09: the phone app detects calls to and from lead numbers,
logs them and uploads the recording. It was declined because reading the phone's
call log needs `READ_CALL_LOG`, which Google Play allows only the default dialler.
This is the part Play allows, built on the owner's approval of 18 Oct: calls
placed from the app.

**Where.**

- `apps/mobile/android/app/src/main/java/com/youhan/one/CallWatchPlugin.java`: the
  plugin, registered in `MainActivity`; `AndroidManifest.xml`: `READ_PHONE_STATE`.
- `apps/mobile/ios/App/App/YouhanBridgeViewController.swift`: the Swift plugin
  (`CXCallObserver`), registered in `capacitorDidLoad`. No project file change.
- `apps/web/src/lib/leads/callWatch.ts`: the plugin through `window.Capacitor`,
  `autoLog` (what a reported call logs) and `dialAndLog` (arm, dial, log once).
- `sales/leads/CallLogDialog.tsx`: `useAfterDial(open, onLogged)` returns
  `{ dial, notice, logFor }`; the dialog corrects a call by `activityId`.
  `LeadDetail.tsx`, `LeadGrid.tsx`: wired, refreshing the page on a log.
- `lib/offline.ts`: `sendOrQueue(..., { retry: true })` also keeps an unsure answer
  (401, 429, 5xx) in the outbox, under the same key.
- `api/v1/leads/[id]/call-log/route.ts`: takes `durationSecs` (the measured talk
  time) and `activityId` (the caller's own outbound call on this lead, rewritten in
  place, audited `RECORD_UPDATED`, 404 otherwise). `public/openapi.json` regenerated.
  In the batch with #234 (whose `logLeadCall` in `services/leads/logCall.ts` now
  holds the call log's body), both live in `logLeadCall`, and the `activityId`
  check runs before a replay, as the lead and call checks do.
- `apps/mobile/README.md`: the plugin, its limits and the store-form answers.

**Behaviour.**

- One request key per armed call: a retry or a replayed send from the outbox is
  the same log, and a second report of the same call is ignored. Offline, the log
  waits in the outbox like a manual one (the notice is the outbox's). So does a
  5xx, 429 or 401 answer, which may come after the call was saved: it is sent
  again with the same body and key, and the route replays the call already logged.
  Only a refusal (4xx) opens the manual log, and nothing was logged then.
- A logged call refreshes the page, so the timeline and its call counts show it.
  While the notice is up, that lead's own Log call button (lead page, list row)
  opens Edit for the same call, not a second log.
- Armed, but no call within the minute while still away (the dialler left open,
  a call placed later): back in the app, the manual log opens as before. Back
  before the watch ends, or after another dial, it does not.
- No call placed within 60 seconds: nothing is logged. A call ringing in while
  armed is ignored.
- Android asks for `READ_PHONE_STATE` once, after a rationale, the first time Call
  is tapped. Refused (or an app built before CallWatch, or a browser), the manual
  call log opens after the dialler exactly as before (M20-06).
- Android never tells an ordinary app when an outgoing call was answered, only
  when it went off hook and back. So an Android call's time is from off hook,
  ringing included, and 45 seconds or more off hook counts as Connected
  (`ANSWERED_AFTER_SECS`, a web deploy to change). iOS reports the answer; a
  background task keeps the app awake about 30 seconds to see it, and an answer
  seen only at the end is counted from the start.
- Not detected: inbound calls and calls dialled outside the app (that needs
  `READ_CALL_LOG`, the Play-restricted permission). No recording: a third-party
  app cannot record cellular call audio on Android 10+ or iOS; recordings come
  from calls bridged through the workspace's telephony provider.
- No versionCode, versionName or MARKETING_VERSION change (PR #224 owns 1.3.0).

**Verified.**

- `tests/unit/call-watch.spec.ts` (plugin mocked, real outbox): a connected call
  logs once with its start, talk time, outcome and the armed key; No answer; the
  Android off-hook reading; refused permission and a failing plugin log nothing and
  open no dialler; a timeout logs nothing; a call reported twice logs once and a
  report for an earlier armed call is ignored; a refusal comes back for the manual
  log; a 500, 502, 504, 429 or 401 is kept in the outbox and resent with the same
  body and keys, with no manual log offered; no plugin in a browser.
- `useAfterDial` (the refresh, Log call as Edit, the timeout fallback) has no unit
  test: apps/web has no DOM test harness, and E2E does not drive the native path.
- `tests/sales/lead-call-log.spec.ts`: `durationSecs` kept as sent; a correction
  rewrites the outcome, note and minutes of the same activity and books the
  follow-up, audited; another person's call or one on another lead answers 404
  and is left alone; once the call is gone, a correction's key answers 404, not
  its first answer.
- Android: `gradlew :app:compileDebugJavaWithJavac :app:lintDebug` with the repo's
  toolchain (JDK 21, SDK 36), after `cap sync android`, no `google-services.json`
  (the build skips push config without it): both pass, no lint finding in the new
  code. Nothing signed or uploaded.
- iOS: not compiled (Windows); the Swift follows the Capacitor 8 plugin shape.
- tsc, prettier, mutation-audit, openapi, env-example and the unit folder pass.

**Left open.**

- A store build carrying CallWatch (after #224's 1.3.0), and the Play Data safety
  answer for call logs (README). A device check on Android and iPhone.
- The 45-second Android threshold is a guess at ring time; tune from real calls.
- An auto-logged call is not marked as such on the timeline.
