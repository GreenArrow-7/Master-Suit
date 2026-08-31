# Mobile shell

Android and iOS store builds of `apps/web`. The native projects are a WebView
pointed at the running server — see the reasoning in
[`capacitor.config.js`](capacitor.config.js). No screen, route or API call is
duplicated here, so there is nothing to keep in sync with the web app: a deploy
updates the phones.

## Build

```bash
cd apps/mobile && npm install
```

Then, with the URL of the server the app should load:

```bash
MOBILE_SERVER_URL=https://app.example.com npm run sync
```

`sync` bakes that URL into `android/app/src/main/assets/capacitor.config.json`
and the iOS equivalent, so **it has to be set on every sync that precedes a
store build**. Sync without it and the binary opens `www/index.html`, which says
so rather than showing a blank screen. The committed config carries no URL on
purpose — the value differs per environment and the tunnel host in `.env` is not
a production origin.

Open the native project and build from there:

```bash
npm run open:android
```

```bash
npm run open:ios
```

Android needs Android Studio. iOS needs a Mac with Xcode and CocoaPods —
`npx cap add ios` ran on Windows and produced a valid project, but `pod install`
did not, so run it once on the Mac before the first Xcode build.

## Native edits already made

Both are required by screens that already exist in the web app, and both are
lost if the `android/` or `ios/` directory is ever regenerated:

- `android/app/src/main/AndroidManifest.xml` — `CAMERA` and location
  permissions. The WebView cannot grant the page a permission the app does not
  hold; without these, face check-in and the site-visit GPS punch fail silently
  inside the app while working in the phone's browser.
- `ios/App/App/Info.plist` — `NSCameraUsageDescription` and
  `NSLocationWhenInUseUsageDescription`. iOS kills the app instead of prompting
  when these are absent.

## Push notifications

Wired end to end. Every HR notification the web app already writes — the
eighteen events in `apps/web/src/services/hr/notify.ts` — now also rings the
recipients' phones, and a tap opens the record it is about.

The transports are spoken directly, with no SDK: FCM for Android, APNs for iOS.
Routing iOS through Firebase as well would have meant the Firebase iOS SDK and an
AppDelegate that swizzles the APNs callbacks; `apps/web/src/lib/push/send.ts`
signs both vendors' JWTs with `node:crypto` instead.

Nothing here is on until the credentials exist. With the server's push variables
unset, notifications are written in-app and emailed exactly as before.

**Server** — set the `FCM_*` and `APNS_*` block in `apps/web/.env` (documented in
`.env.example`). `APNS_BUNDLE_ID` must equal `appId` in `capacitor.config.js`, and
`APNS_SANDBOX=true` for development and TestFlight builds.

**Android** — download `google-services.json` from the Firebase console into
`android/app/`. The Gradle files already apply the plugin when that file is
present and skip it when it is not, so nothing else changes.

**iOS** — in Xcode, Signing & Capabilities, add **Push Notifications**; upload an
APNs auth key to the Apple Developer portal and use the same key in `APNS_KEY`.
The two delegate callbacks the plugin needs are already in `AppDelegate.swift` —
the Capacitor template omits them, and without them iOS registers with Apple and
hands the token to nobody.

## Before the first submission

- **`appId`** — `com.mastersuite.app` is a placeholder and neither store lets you
  change it after a published upload. `branding.ts` says the product name is
  expected to change before launch; settle both first.
- **Icons and splash** — the native projects still carry the default Capacitor
  logo. With a 1024×1024 `assets/icon.png` and a 2732×2732 `assets/splash.png`,
  `npx @capacitor/assets generate` fills in every size for both platforms. Worth
  doing once there is a real mark rather than the placeholder "MS" tile.
- **A stable HTTPS origin.** `APP_URL` is currently a dev tunnel. Session
  cookies are `Secure`, and a URL that changes strands every installed app.
- **App Store guideline 4.2** rejects apps that are only a website. The camera
  attendance capture, the GPS site-visit punch and native push are the defence —
  three things the browser build cannot do. Push needs its credentials in place
  before review, or the reviewer sees the same website the guideline is about.
- **Privacy policy URL** — both stores require one, and the camera and location
  use has to be declared in Play's Data Safety form and Apple's privacy
  nutrition labels.
