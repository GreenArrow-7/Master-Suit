# The phone apps carry the push plugin

**17 Oct 2026** · build · Mobile (audit M17-02, M20-08, M8-03 — app half)

- `@capacitor/push-notifications` 8.1.2 (pinned) added to `apps/mobile` and synced into Android (Gradle) and iOS (SPM). The web side (`lib/pwa/nativePush.ts`: permission, register, `POST /api/v1/devices`, tap opens the record) and the server sender (`lib/push/send.ts`, FCM + APNs) already existed and were waiting for it; the iOS AppDelegate already forwards the APNs token.
- Push stays off until the owner supplies, outside the repository:
  - Android: a Firebase project for `com.youhan.one1` → `google-services.json` in `apps/mobile/android/app/` (the build applies the plugin only when the file is present), and its service-account key as `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` on production.
  - iOS: the Push Notifications capability on the App ID, a regenerated "YOUHAN ONE App Store" profile, then an `aps-environment` entitlement here; and an APNs `.p8` key as `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` on production.
- No version change here; 1.3.0 is built once the Firebase file exists.
