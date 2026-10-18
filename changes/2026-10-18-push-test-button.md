# One tap checks phone notifications end to end

**18 Oct 2026** · feature · Notifications (audit M17-02, M20-08 — owner-unblock helper)

- Profile → Notifications shows whether phone notifications are set up on the server and how many of your phones are registered, with **Send a test notification**.
- `POST /api/v1/notification-preferences/test` (your own devices, `selfService`, 5 per 10 minutes) answers which link is missing — no server keys, no registered phone, a phone that rejected it — or how many devices it reached; a token the transport rejects is removed, as the delivery worker does.
- Why now: push needs the owner's Firebase and APNs keys. Once they are on production this confirms the whole chain in one tap instead of waiting for a real follow-up to fall due.
- Test: `tests/integration/push-test.spec.ts` (3). `public/openapi.json` regenerated.
