# Lead Eagle, phase 6: self-serve sign-up (closed by default); offline actions on the phone

**What.** Gaps 8 and 9 of the [plan](2026-10-05-lead-eagle-plan.md), the last
phase, PR #134, stacked on phase 4 (#133).

**Why.** The owner's instruction of 7 Oct to complete every phase. Gap 8 was
marked "a business decision first", so sign-up ships **closed**: the platform
owner opens it, or not, in the console.

**Where** (under `apps/web/`)
- `src/services/platform/createWorkspace.ts` — the portal wizard's workspace transaction, moved out of `api/v1/platform/workspaces/route.ts` unchanged so sign-up makes the same workspace.
- `src/services/platform/signup.ts`, `api/v1/public/signup` (+ `/confirm`), `app/(auth)/signup` — the request, the emailed link, the confirmation page.
- `SignupRequest` (migration `20261007300000_signup_request`), global like the identity tables, listed in `GLOBAL_MODELS`.
- `src/lib/platform-settings.ts` — the `signupTrialDays` setting.
- `src/lib/offline.ts`, `src/components/workspace/OfflineBanner.tsx` — the outbox and its banner; the lead screen's updates and activity log go through it.
- `api/v1/activities` — `requestKey` (idempotent replay) and `occurredAt`.

**Behaviour**
- **Sign-up.** Platform console → Settings → *Self-serve sign-up (trial
  days)*: 0 (the default) keeps it closed and `/signup` a 404; any other number
  opens it — provided an active plan includes Lead Eagle (Plans); without one
  it stays closed, so nobody is mailed a link that could only fail. Open, the
  sign-in page offers "Start a N-day free trial". The form takes the company, the workspace address (suggested from the company; the
  app's own routes are reserved), a name, an email and a password (the app's
  policy). It makes nothing: it mails a link that works once, for 24 hours, and
  keeps only the link's hash. The link's page confirms from the browser — a mail
  scanner opening it cannot spend it — and makes a Lead-Eagle-only workspace on
  a trial of that many days, on the smallest active plan offering Lead Eagle,
  through the portal's own workspace transaction. An address that already has
  an account here is attached to the new workspace and keeps its password
  (using the link proved the address). Rate limits: 5 requests and 10
  confirmations an hour per address.
- **Offline.** In the app or a browser that loses its connection, changing a
  lead (stage, owner, fields, notes) or logging an activity is kept on the
  device instead of failing; a notice above the tab bar says how many changes
  are waiting, and sends them on reconnecting, on returning to the app, or on
  "Send now".
  Logging an activity carries a request key, so a send repeated after a lost
  answer is replayed rather than logged twice, and its own time (accepted
  within the last week). A change the server refuses is dropped and shown
  with the reason; a signed-out session or a server error keeps the rest
  waiting.

**Verified.** `tests/platform/self-serve-signup.spec.ts` (6, real routes,
database and mock mailer): a 404 while closed, and while no active plan
includes Lead Eagle; the link, not the form, makes a Lead-Eagle-only
workspace on a 14-day trial with its stages, and the password works; one link,
one workspace; a taken or reserved address and a weak password refused, with
no mail; a second company by an existing account keeps its password and gains
a membership. `tests/sales/activity-replay.spec.ts` (3): one activity however
often sent, at its own time; the same key with other content refused; the
week's bound. `tests/unit/offline-outbox.spec.ts` (4): sent when online, kept
when not, flushed in order stopping at a signed-out session, a refusal dropped
and reported. The portal's own workspace specs (52) pass on the moved
transaction. Full suite 3509 passed (the 2 seed-dependent skips as before).
In a browser on the rig, 10 checks at 390 px: closed is a 404; open, the
sign-in page offers the trial; the form suggests the address and makes
nothing; the link makes a Lead Eagle trial workspace once and its
administrator signs in; offline, a logged activity waits on the device under a
notice above the tab bar, and is sent once on reconnecting; no page errors.

**Left open**
- Sign-up has no captcha; the hourly limits and the emailed link are the
  defences. Add one if the form is abused.
- Offline covers the lead screen's updates and activity log; other screens
  still need a connection. Native background sync (sending while the app is
  closed) would need the store apps to change.
- A self-serve workspace's billing after its trial follows the platform's
  existing subscription states; nothing new charges anyone.
