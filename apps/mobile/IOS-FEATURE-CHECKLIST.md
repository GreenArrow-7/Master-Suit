# iOS feature checklist — YOUHAN ONE (TestFlight, development proof of concept)

The iOS app is Capacitor 8 loading the staging web application (`server.url`), so every
feature below is the same server-rendered screen as the web app. Permissions, tenant
isolation and second-person approvals are enforced by the server on every request; the app
adds no client-side checks and hiding a menu item never replaces them.

**Run.** Staging build of f3386b2 (web code identical to the TestFlight source apart from the CSV-export revoke delay); 16 September 2026: 78 passed, 1 hr-modules and 3 email-link failures explained below, all caused by the dev-tunnel origin in emailed links.

## Current test round — device testing in progress

**Status: Physical-iPhone testing in progress by the owner; structured results pending.**
No row below may be marked passed until the owner confirms a result. The seven preliminary
checks sent with the retest checklist are prompts for the tester, not evidence, and do not
close any of the untested rows.

| | |
|---|---|
| TestFlight build | **1.0 (3)** — uploaded 2026-09-16, `processingState=VALID` |
| Build source SHA | `afb53bd` (native shell; nothing since has touched `apps/mobile/ios` or the Capacitor config) |
| Backend under test | `https://ios-staging.youhan.in` |
| Backend revision | **`c43b06f496a878869c4aa3064fa491766d3e518b`** |
| Device / iOS version | *to be recorded from the owner's report* |

**Correction — there is no build 2.** PR #56's description says "TestFlight build 1.0 (2)".
That is wrong. Build numbers come from the workflow run number, and run #2 was a duplicate
dispatch that was cancelled before it produced an artifact, so it uploaded nothing. The
builds that exist are **1** (run #1, source `8eba37b`) and **3** (run #3, source `afb53bd`).

**Why build 3 is the right thing to test even though its source predates the iPhone fixes.**
The hydration fix (`3a3a1f6`) and the iOS zoom fix (`c43b06f`) are changes to `apps/web`,
which the app loads from the backend rather than carrying in the binary. The backend above
is at `c43b06f`, which contains both, and is missing nothing in `apps/web/src` relative to
`main`. The native shell in build 3 is current.

**Staging is held stable for the duration of this round.** Nothing will be deployed to
`ios-staging` while testing is in progress; any change will be announced first, with the new
revision recorded here.

**Evidence columns.** *Staging* = Playwright on the isolated mobile staging build
(Chromium; phone viewport where the spec says so). *iPhone* = the installed TestFlight
build on a physical device, recorded only from results the tester reports. No row is
iPhone-verified until that column says so.

| Area | iOS entry point | Functional test (staging) | Staging | iPhone | Remaining gap |
|---|---|---|---|---|---|
| Sign-in, wrong password, MFA enrol / code / recovery code | App launch → `/login` | `auth-mfa` (4), code fields use `autocomplete="one-time-code"` | pass | untested | Verify iOS code autofill from Messages/Authenticator |
| Return-to after sign-in, password change, session revocation | Deep link while signed out; Profile → Security | `auth-return-and-password-change`, `mobile-app-journey` (sign out everywhere ends the other phone's session) | pass | untested | Expired session after background/resume on device |
| Password reset | Sign-in → Forgot password | `password-reset`: same answer for unknown address, reset email sent | email sent: pass; link redemption: **not verified** | untested | Email links carry the staging origin, a dev tunnel, so the test browser stops at the tunnel warning page. Re-run once staging has a stable hostname. |
| Logout | Menu → Sign out | `mobile-app-journey` | pass | untested | — |
| Workspace navigation, drawer, tab bar, safe areas | Tab bar Home / Leads / Calls / Tasks / Menu | `workspace-navigation`, `entity-navigation`, `mobile` (no sideways scroll at 375px, drawer); safe-area CSS measured with iPhone 13 insets 47/34 | pass | untested | Notch, home indicator and keyboard overlap on device |
| Search, notifications, Inbox | Top bar search and bell; Menu → Communications → Inbox | `every-route` (renders), `workspace-navigation` | pass | untested | — |
| Leads, contacts/customers, opportunities, activities, tasks, follow-ups | Leads tab; Menu → Sales | `crm-lifecycle`, `follow-up-mobile` (390px), `mobile-app-journey` (own leads only; offline save refused), `admin-deletes` (403 without permission) | pass | untested | — |
| Lead photo / document attach | Lead → Documents → camera or library | `mobile-app-journey` (photo attaches; refused camera and dropped connection explained) | pass | untested | iOS camera permission prompt, denial and retry via Settings |
| Calls, recordings, transcripts, call audits, coaching | Calls tab; Menu → Call audits / Coaching | `modules`, `every-route`, `admin-deletes` (deleted call's recording no longer streams) | pass | untested | Transcript download → Quick Look on device |
| Live call assist, practice recording | Call → Live; Menu → Practice | not in scope | **blocked on iOS** | — | Needs the microphone; the app declares no microphone use, so WebKit refuses it and the screen shows its refusal message. Not cellular-call recording and not enabled without a decision. |
| Properties (projects, listings, media) and marketing (campaigns, forms, landing pages, social leads, events) | Menu → Sales | `modules`, `every-route` | pass | untested | External media, maps and meeting links open outside the app (by design) |
| My HR, employees, attendance, leave, payroll, payslips, recruitment | Menu → People | `employee-record-scope` (own / team / HR scope; no ID numbers), `every-route`, `workspace-navigation` (HR screens) | pass (`hr-modules` end-to-end blocked, see invitation row) | untested | Payslip/document download → Quick Look → Share/Save on device |
| Attendance check-in (face + location) | People → Check-in | `every-route` (screen renders only; no automated capture test) | renders | untested | Face capture, camera and location prompts, denial and retry — device test is the only evidence; foreground location only |
| Booking confirmation | Sales → Projects / Collections | `booking-api` (one sale per unit, refusals move nothing) | pass | untested | API-only in part — no separate iOS work |
| Collections, receipt evidence, fee amendments, recovery, write-offs | Sales → Collections | `collections-api`, `collections-ui` incl. 390px recorder/verifier, evidence PDF upload, amendment approval by another person, write-off approval by another person | pass | untested | Evidence from iPhone camera / Files on device |
| Commissions, slabs, payouts | Sales → Commissions | `modules` M9 (a slab cannot pay until signed) | pass | untested | — |
| Reports and CSV exports | Sales → Reports; People → Reports | `modules` M10 (every report answers) | pass | untested | CSV export uses a blob download; fixed natively in 5aadc69 — verify on device |
| Settings, users, roles, permissions | Menu → Admin | `every-route`, `admin-deletes` (custom role refused delete: 403), `ui-states` (empty and search states) | pass | untested | — |
| User creation by invitation; HR hiring | Admin → Users → Invite; People → Recruitment | `invitation` (exactly one email sent), `hr-modules` | email sent: pass; acceptance and the rest of `hr-modules`: **not verified** | untested | Same tunnel-origin link as password reset; re-run after the stable hostname. |

## Not provided in this build

Native push notifications, offline editing, cellular-call recording or live transcription,
background location. Capacitor `server.url` is not a production-supported deployment model,
so this build is for internal TestFlight testing only.

## iPhone test checklist (tester records pass / fail / note)

1. Install from TestFlight; open; the sign-in page appears with no warning page.
2. Sign in; if MFA is on, enter the code (try autofill). Kill and reopen the app: still signed in.
3. Leads tab: open a lead; change the stage; reopen the app — the change is kept.
4. Lead → attach a photo with the camera. Then deny camera in iOS Settings and retry: the app explains it.
5. Collections or lead documents: attach a PDF from Files.
6. Open a document/payslip: Quick Look shows it; Share → Save to Files works; swipe back returns.
7. Reports → Export CSV: the file opens in Quick Look.
8. Lead → Call: the phone dialler opens. A meeting or map link opens outside the app.
9. People → Check-in: allow location and camera; then deny location and retry.
10. Turn on Airplane mode; try to save: an error, nothing lost; turn it off and retry.
11. Rotate; open the keyboard on a long form: the field stays visible above it.
12. Leave the app for 10+ minutes, return: either still usable or sent to sign-in cleanly.
13. Sign out; press back/reopen: signed-out screens only.
