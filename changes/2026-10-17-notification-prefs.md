# Each person chooses phone and email copies of their notifications

**17 Oct 2026** · feature · Notifications (audit M17-11, M18-10, M17-03, M8-03, M17-06)

- Profile → Notifications: "Phone notifications" (on by default) and "Email copies" (off by default), saved in the existing `User.notificationPrefs`. `GET/PUT /api/v1/notification-preferences` (your own, `selfService`).
- The `record-push` job now reads each recipient's choice: push only to those with it on, and an email copy (title, text, link to the record) to those who turned email on.
- The reminder sweep (follow-ups, call follow-ups, site visits) now queues the same job, so reminders reach the phone and email too — they used to stay in the bell.
- One switch per channel, not per event; noted in `lib/notificationPrefs.ts`.
- Phone delivery still needs the Firebase and APNs keys (see 2026-10-17-native-push-plugin.md); email works now.
- Test: `tests/integration/notification-prefs.spec.ts`.
