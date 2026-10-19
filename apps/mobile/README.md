# Mobile shell — DEVELOPMENT PROOF OF CONCEPT

Android and iOS builds of `apps/web`. The native projects are a WebView pointed at
the running server — see [`capacitor.config.js`](capacitor.config.js). No screen,
route or API call is duplicated here: a deploy updates the phones.

**Not production-ready.** The app loads the server through Capacitor's
`server.url`, which Capacitor documents as "intended for use with live-reload
servers" and "not intended for use in production" (capacitorjs.com/docs/config,
v8). Builds from this project are development proofs of concept until a
production-supported architecture is chosen. Do not submit them to a store.

## What this build contains

| Area | State |
|---|---|
| Server | `MOBILE_SERVER_URL` at sync time — an https origin only (enforced) |
| Navigation | The server origin only; every other host opens in the system browser (no `allowNavigation`) |
| Session | The web app's httpOnly session cookie, first-party in the WebView; no passwords or tokens stored by the app |
| Permissions | Android: `INTERNET`, `CAMERA`, `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `READ_PHONE_STATE` (CallWatch, below). iOS: camera, location when in use and microphone usage descriptions (`ios/App/App/Info.plist`); CallWatch needs none |
| Calls | CallWatch, the app's own plugin: a call placed from a lead in the app logs itself on the lead (below) |
| Backup | Android backup and device transfer disabled (the WebView cookie store holds the session) |
| FileProvider | Limited to the camera capture folder (`external-files-path` `Pictures/`) |
| Push | `@capacitor/push-notifications` 8.1.2 is in the build; it stays off until the owner's Firebase file and APNs key exist (`changes/2026-10-17-native-push-plugin.md`) |
| Offline | The site's own outbox (`apps/web/src/lib/offline.ts`): a logged call, a follow-up, a lead edit or a cold call made with no signal waits on the phone and is sent once when it is back; opening a screen still needs the server |
| Identifiers | iOS bundle id `com.youhan.one`; Android `applicationId` `com.youhan.one1` (namespace `com.youhan.one`); label "YOUHAN ONE", version 1.2.0 (Android version code 11) |

## Android: build the development APK

Requirements, matching this project: JDK 21, Android SDK platform 36 and
build-tools 35/36, platform-tools; Gradle 8.14.3 comes from the wrapper.

```bash
cd apps/mobile && npm ci
```

```bash
MOBILE_SERVER_URL=https://your-staging-origin npm run sync
```

```bash
cd android && ./gradlew assembleDebug lintDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`, signed with the
local Android **debug** certificate. It installs on a phone with "Install unknown
apps" allowed, or with `adb install -r app-debug.apk`. It is debuggable: anyone
with the phone and a USB cable can inspect the WebView, including the session.
Use test accounts only.

`sync` bakes the origin into `android/app/src/main/assets/capacitor.config.json`
(git-ignored) and runs `scripts/fix-ios-spm-paths.mjs`, which rewrites the
backslash paths `cap sync` writes into the iOS Swift package manifest on Windows.

No release keystore exists and none is committed (`*.jks` and `*.keystore` are
git-ignored). An AAB for Play needs an upload key with a named owner and recovery
plan first.

## iOS

The Xcode project uses Swift Package Manager (no CocoaPods). It needs a Mac with
Xcode 26 to build; App Store Connect uploads require the Xcode 26 / iOS 26 SDK.

```bash
cd apps/mobile && npm ci && MOBILE_SERVER_URL=https://your-staging-origin npm run sync && npm run open:ios
```

A simulator build needs no signing. A build on a physical iPhone or TestFlight
needs an Apple Developer team selected under Signing & Capabilities, which this
project does not have.

### TestFlight from GitHub Actions (no Mac needed locally)

`.github/workflows/ios-testflight.yml` has one trigger, `workflow_dispatch`, and its
job runs only for the `dev/mobile-app` ref. On a GitHub-hosted `macos-26` runner it
archives the Release configuration signed **manually** (Apple Distribution certificate,
App Store profile "YOUHAN ONE App Store", team 3SHW6AX727), exports for App Store
Connect and uploads to TestFlight. The build number is the workflow run number.
macOS runner minutes are billed on private repositories.

GitHub offers dispatch only for workflows whose file is on the default branch. The
smallest change is a pull request to `main` containing only this workflow file; the
dispatched run still uses the file and code from `dev/mobile-app`
(`gh workflow run ios-testflight.yml --ref dev/mobile-app`).

Least privilege — signing material and upload authentication are separate
(developer.apple.com/support/roles):

- **Creating** the distribution certificate and the App Store profile is limited to
  the Account Holder or an Admin. It is done once, by hand, from a CSR generated
  locally; the private key never leaves the owner's machine except as the encrypted
  `.p12` repository secret.
- **Uploading** builds is allowed for Account Holder, Admin, App Manager and Developer.
  CI uses a Team API key with the **Developer** role and never provisions
  (no `-allowProvisioningUpdates`).

Owner setup, once:

1. Certificates, Identifiers & Profiles → Certificates → + → Apple Distribution;
   upload the CSR generated locally; download the `.cer`.
2. Profiles → + → App Store Connect (Distribution); App ID `com.youhan.one`; select
   that certificate; name it exactly `YOUHAN ONE App Store`; download it.
3. App Store Connect → Users and Access → Integrations → Team Keys → +, role
   **Developer**; download `AuthKey_<KEYID>.p8` (offered once) and note the Issuer ID.
4. Put the three files and `issuer-id.txt` beside the CSR and run the local helper
   `node scripts/set-ios-secrets.mjs <folder>`: it verifies certificate, key, profile and team, builds the
   `.p12`, and stores repository secrets `IOS_DIST_CERT_P12_BASE64`,
   `IOS_DIST_CERT_PASSWORD`, `IOS_APPSTORE_PROFILE_BASE64`, `ASC_KEY_ID`,
   `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` and variable `APPLE_TEAM_ID`, printing names only.
5. Variable `IOS_STAGING_URL`: an https origin that loads without an interstitial
   page — not a dev tunnel.
6. TestFlight → Internal Testing: a group containing the tester's App Store Connect
   user; TestFlight installed on the iPhone with the same Apple Account.

The preflight refuses to continue with missing names, a dev-tunnel URL, or a project
bundle id other than `com.youhan.one`; it prints names only, never values.

Export compliance: see [EXPORT-COMPLIANCE.md](EXPORT-COMPLIANCE.md).

## Brand assets

`node scripts/render-brand-assets.mjs` renders the YOUHAN ONE mark
(`apps/web/src/app/icon.svg`) into the Android launcher icons (legacy, round and
adaptive foreground on midnight `#020817`), the Android splash images, the iOS
1024 app icon and the iOS splash image, using the Playwright Chromium already
installed for `apps/web`.

## Push notifications (in the build, off until credentials exist)

The server side exists: `apps/web/src/lib/push/send.ts` speaks FCM HTTP v1 and
APNs token auth, and `apps/web/src/lib/pwa/nativePush.ts` registers a device when
the plugin is present. `@capacitor/push-notifications` is installed and synced
(`changes/2026-10-17-native-push-plugin.md`). What turns it on is the owner's:

1. Android: `google-services.json` from the Firebase project into `android/app/`
   (git-ignored; the build applies the plugin only when the file is present).
2. iOS: Push Notifications capability on the App ID, a regenerated profile, then
   an `aps-environment` entitlement; APNs auth key. The two delegate callbacks are
   already in `AppDelegate.swift`.
3. Server: the `FCM_*` and `APNS_*` variables (`.env.example`); `APNS_BUNDLE_ID`
   must equal `appId`.

## Calls placed from the app log themselves (CallWatch)

`CallWatch` is a local Capacitor plugin in this project, not an npm package:
`android/app/src/main/java/com/youhan/one/CallWatchPlugin.java` (registered in
`MainActivity`) and the `CallWatchPlugin` class in
`ios/App/App/YouhanBridgeViewController.swift` (registered in `capacitorDidLoad`). The
web half is `apps/web/src/lib/leads/callWatch.ts`.

- `start({ key })` arms it for the next outgoing call and answers `{ armed }`. One
  `callEnded` event follows with the key: `{ startedAt, connectedAt, endedAt,
  durationSeconds, connected, timedOut }` (epoch ms), when that call ends, or with
  `timedOut` after 60 seconds with no call. A call coming in while armed is ignored.
- The lead page and the lead list arm it before opening `tel:`; the phone's own dialler
  places the call. When it ends the call is logged on the lead through the one-step call
  log (start time, talk time, Connected or No answer, one request key per call so a retry
  is not a second log), and the page says "Call logged automatically" with Edit, which
  corrects that call rather than adding one. In a browser, or in an app built before
  CallWatch, nothing changes.
- **Android**: `TelephonyCallback.CallStateListener` on API 31+, `PhoneStateListener`
  below. Needs `READ_PHONE_STATE`, asked for once, after a rationale, the first time an
  agent taps Call; refused, the manual call log opens after the dialler as before (the
  agent can allow it later under the app's Phone permission). Android tells an ordinary
  app only idle, ringing and off hook: not the number and not when an outgoing call was
  answered. So `connected` and `connectedAt` are null and `durationSeconds` is the time off
  hook, ringing included; the page counts 45 seconds or more off hook as answered
  (`ANSWERED_AFTER_SECS`, changed with a web deploy) and the agent corrects with Edit.
- **iOS**: `CXCallObserver`, no permission. It reports the answer (`connected`). iOS
  suspends the app soon after the call screen opens; a background task keeps it awake
  for about 30 seconds to see the answer, and an answer learnt only at the end is counted
  from the start of the call.
- **Not detected**: inbound calls and calls dialled outside the app. Those need the phone's
  call log (`READ_CALL_LOG`), which Google Play restricts to the default dialler, so the
  app never asks for it, nor for `PROCESS_OUTGOING_CALLS`, `ANSWER_PHONE_CALLS`,
  `CALL_PHONE` or the dialler role.
- **No recordings**: a third-party app cannot record cellular call audio on Android 10+ or
  on iOS. Recorded calls come from calls bridged through the workspace's telephony
  provider (Call with AI assistance), whose recordings the server already stores.
- The Swift half has not been compiled here (no Mac); it follows the Capacitor 8 plugin
  shape (`CAPPlugin`, `CAPBridgedPlugin`, `registerPluginInstance`). Build it in Xcode
  before an iOS release.
- It reaches users only with a new store build (the web half is live with a deploy and
  does nothing until the app carries the plugin).

Store forms:

- **Play Data safety**: `READ_PHONE_STATE` is declared. The app sends the start time and
  length of calls placed from it to the workspace, with the lead they were for: declare
  *Calls and SMS → Call logs*, collected, not shared, for app functionality, linked to the
  user. Nothing is read from the phone's call history.
- **App Store App Privacy**: the same call start times and lengths, under *Other user
  content* or *Other data types*, linked to the user, for app functionality.

## Before any release build

- **Architecture** — `server.url` is not production-supported (see top).
- **Android `applicationId`** — `com.youhan.one1`, a separate Play listing from the earlier `com.youhan.one`; neither store allows a change after a published upload. iOS uses `com.youhan.one`, and so does `capacitor.config.js` `appId`, which does not set the Android package.
- **A stable, approved HTTPS origin** — dev tunnels show Microsoft's one-time "developer tunnel" warning page to browsers and WebViews.
- **Release signing** — upload key ownership (Android), Apple team, certificates and provisioning (iOS).
- **App Store guideline 4.2** — apps that are only a website are rejected.
- **Privacy** — privacy policy URL, Play Data safety form (with `READ_PHONE_STATE` and call logs, see CallWatch above), App Privacy labels, iOS privacy manifest.
