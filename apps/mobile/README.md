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
| Permissions | Android: `INTERNET`, `CAMERA` (Take photo on lead documents). iOS: `NSCameraUsageDescription` |
| Backup | Android backup and device transfer disabled (the WebView cookie store holds the session) |
| FileProvider | Limited to the camera capture folder (`external-files-path` `Pictures/`) |
| Push | **Not included.** The plugin is removed until FCM/APNs credentials exist (see below) |
| Location, microphone | **Not declared.** Face check-in, the site-visit GPS punch and any audio feature cannot work in this build |
| Identifiers | `com.mastersuite.app` is a **placeholder**; label "YOUHAN ONE Dev", version `0.1.0-dev-poc` |

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

`.github/workflows/ios-testflight.yml` archives with automatic signing on a
GitHub-hosted `macos-26` runner (Xcode 26 or newer) and uploads to App Store
Connect. It is manual only: push a tag `ios-testflight-<anything>` that points at
a commit on `dev/mobile-app`. macOS runner minutes are billed on private
repositories — check the account's Actions usage and budget first.

Before the first run:

1. **Apple Developer Program** — an active membership (individual or organisation)
   and its 10-character Team ID (developer.apple.com → Account → Membership details).
2. **Bundle identifier** — decide the final one (it cannot change after the first
   upload to an app record). Register it under Certificates, Identifiers & Profiles
   → Identifiers, or let automatic signing register it.
3. **App Store Connect app record** — My Apps → + → New App: platform iOS, name
   (e.g. "YOUHAN ONE"), primary language, the bundle identifier above, a SKU.
4. **App Store Connect API key** — Users and Access → Integrations → App Store
   Connect API → Team Keys → generate with the **App Manager** (or Admin) role.
   Note the Key ID and Issuer ID; download `AuthKey_<KeyID>.p8` once.
5. **GitHub environment** — repository Settings → Environments → New environment
   `ios-testflight`:
   - Variables: `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `IOS_STAGING_URL` (the staging https origin).
   - Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` — the .p8 file
     base64-encoded, e.g. PowerShell
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard`,
     pasted into the secret field. Never paste key contents anywhere else.
6. **TestFlight testers** — App Store Connect → the app → TestFlight → Internal
   Testing → add yourself (a user on the team with a role). Internal testers need
   no beta review; install the TestFlight app on the iPhone and accept the invite.

The workflow refuses to run with any of these missing, with the placeholder
bundle id, or on a commit outside `dev/mobile-app`, and prints only names, never
values.

## Brand assets

`node scripts/render-brand-assets.mjs` renders the YOUHAN ONE mark
(`apps/web/src/app/icon.svg`) into the Android launcher icons (legacy, round and
adaptive foreground on midnight `#020817`), the Android splash images, the iOS
1024 app icon and the iOS splash image, using the Playwright Chromium already
installed for `apps/web`.

## Push notifications (not in this build)

The server side exists: `apps/web/src/lib/push/send.ts` speaks FCM HTTP v1 and
APNs token auth, and `apps/web/src/lib/pwa/nativePush.ts` registers a device when
the plugin is present (and does nothing when it is not). To add it back:

1. `npm install @capacitor/push-notifications` here, then sync.
2. Android: `google-services.json` from the Firebase project into `android/app/`
   (git-ignored), and declare `POST_NOTIFICATIONS`.
3. iOS: Push Notifications capability with a team; APNs auth key. The two delegate
   callbacks are already in `AppDelegate.swift`.
4. Server: the `FCM_*` and `APNS_*` variables (`.env.example`); `APNS_BUNDLE_ID`
   must equal `appId`.

Without Firebase configured, the Android plugin's `register()` calls
`FirebaseMessaging.getInstance()` with no Firebase app, which is why it is not
shipped in a build that has no credentials.

## Before any release build

- **Architecture** — `server.url` is not production-supported (see top).
- **`appId`** — `com.mastersuite.app` is a placeholder; neither store allows a change after a published upload.
- **A stable, approved HTTPS origin** — dev tunnels show Microsoft's one-time "developer tunnel" warning page to browsers and WebViews.
- **Release signing** — upload key ownership (Android), Apple team, certificates and provisioning (iOS).
- **App Store guideline 4.2** — apps that are only a website are rejected.
- **Privacy** — privacy policy URL, Play Data safety form, App Privacy labels, iOS privacy manifest.
