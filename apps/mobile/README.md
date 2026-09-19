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
| Identifiers | iOS bundle id `com.youhan.one`; Android `com.mastersuite.app` is still a **placeholder**; label "YOUHAN ONE Dev", version `0.1.0-dev-poc` |

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
- **Android `applicationId`** — `com.mastersuite.app` is a placeholder; neither store allows a change after a published upload. iOS uses `com.youhan.one`.
- **A stable, approved HTTPS origin** — dev tunnels show Microsoft's one-time "developer tunnel" warning page to browsers and WebViews.
- **Release signing** — upload key ownership (Android), Apple team, certificates and provisioning (iOS).
- **App Store guideline 4.2** — apps that are only a website are rejected.
- **Privacy** — privacy policy URL, Play Data safety form, App Privacy labels, iOS privacy manifest.
