# App Store listing — YOUHAN ONE

Everything App Store Connect asks for before version 1.0 can be submitted. Fields that are
a fact about this codebase are filled in and say how they were checked. Business decisions
are marked **OWNER** and are not guessed.

- **App:** YOUHAN ONE · **Bundle ID:** com.youhan.one · **Apple ID:** 6812716422
- **Team:** 3SHW6AX727 · **Primary language:** English (U.K.) · **SKU:** YOUHAN-ONE-IOS-001
- **Current state:** version 1.0, `PREPARE_FOR_SUBMISSION`, age rating unset, no
  screenshots, no privacy disclosures.

This file was rewritten after review. Four claims in the first draft were wrong or
overstated; each is corrected below and flagged **[corrected]** so the earlier version is
not quoted by mistake.

## 1. Guideline 4.2 — a real risk, not an automatic rejection **[corrected]**

The first draft said 4.2 rejects apps that are "only a website" and treated that as
disqualifying. That overstates it. 4.2 asks for "features, content, and UI that elevate it
beyond a repackaged website", and 4.2.2 targets web clippings, content aggregators and link
collections. A substantial authenticated business platform is not a web clipping, and
WebView-based enterprise apps ship on the App Store routinely.

What actually drives the outcome for this build:

| Raises the risk | Lowers the risk |
|---|---|
| Every screen is the website; there is no native UI | Substantial product behind a login, not marketing content |
| The same content is fully usable in Safari | Native document downloads into Quick Look with Share / Save to Files |
| No offline behaviour | Camera capture and precise location wired to real workflows |
| No push, widgets, Face ID lock or share extension | Dialler and external links handed to the system |

Honest assessment: this is a **moderate** risk, concentrated in "what does the app do that
Safari does not". It is not decided by the fact that a WKWebView renders the UI.

Cheapest credible mitigations, in order of value per effort, none of which is an
architecture rewrite:

1. **Biometric app lock** (Face ID / Touch ID to reopen). Small, native, visibly
   app-only, and a natural fit for a tool holding payroll and customer data.
2. **Native share sheet** for a document already downloaded — the Quick Look path exists.
3. **Offline read of the last-loaded screen**, or an honest offline screen instead of a
   WebKit error page.
4. **Push notifications** for follow-ups and approvals. Highest value to a reviewer, but
   needs APNs and server work; do not attempt before the first submission.

**OWNER decision:** submit as-is and accept a moderate rejection risk, or spend the effort
on 1–3 first. Rejection under 4.2 is not fatal — Apple states the reason and a resubmission
with added native functionality is normal.

## 2. Capacitor production suitability — smallest supported change **[corrected]**

The first draft said `server.url` is "not production-supported" and left it there, implying
a rewrite. The quote is accurate — Capacitor's configuration reference describes `server.url`
as intended for live-reload servers — but the smallest fix is far short of a rewrite.

Why the obvious fix does not apply: the web app cannot be bundled into the binary. It is
`output: 'standalone'` and renders on the server against a session and a tenant, with 95 of
115 workspace pages reading the database directly. There is no static export to ship.

Two supported shapes, both small:

**Option A — keep Capacitor, stop using `server.url`.** Ship a minimal real `webDir` bundle
so the config is ordinary, and have the existing `YouhanBridgeViewController` load the
production URL into the same WKWebView. Session cookies, downloads and permissions behave
exactly as today.
*Scope:* a stub `index.html`, remove `server` from `capacitor.config.js`, one `load()` call.
*Catch:* Capacitor's `WebViewDelegationHandler` decides navigation against
`bridge.config.serverURL`; with that gone, in-app links would be treated as external and
opened in Safari. The navigation delegate is already wrapped by `DownloadCoordinator`, so
this is where the work actually lands.
*Estimate:* half a day plus a signed build to verify.

**Option B — drop Capacitor on iOS.** A plain `WKWebView` app: app delegate, one view
controller, the `DownloadCoordinator` that already exists, and the Info.plist entries that
already exist. Removes the unsupported config entirely and shrinks the binary.
*Needs reimplementing, all small:* media-capture permission grant
(`requestMediaCapturePermissionFor`), JavaScript alert/confirm/prompt handlers, and external
URL opening — roughly 60 lines that Capacitor currently provides.
*Estimate:* about a day including signing and a device check.

**Recommendation:** Option B. It is barely larger than A, it removes the unsupported setting
rather than working around it, and most of the native code it needs is already written. Both
are reversible and neither touches the backend. **OWNER** to choose, or to defer both and
submit on the current configuration — which is a supportability and 4.2 argument, not a
functional defect.

## 3. Privacy manifest — recommended, not an upload blocker **[corrected]**

The first draft called a missing `PrivacyInfo.xcprivacy` a blocker that gets uploads
rejected. Checked properly:

- **Capacitor already ships manifests** at
  `@capacitor/ios/Capacitor/Capacitor/PrivacyInfo.xcprivacy` and the CapacitorCordova
  framework. Both declare empty `NSPrivacyAccessedAPITypes`, empty
  `NSPrivacyCollectedDataTypes` and `NSPrivacyTracking false`.
- **No required-reason API is used.** Searched Capacitor's iOS source and our own Swift for
  `UserDefaults`, file creation/modification timestamps, `systemUptime` /
  `mach_absolute_time`, free-disk-space APIs and `activeInputModes`. Zero hits in both.
- The app target itself references no manifest (`PrivacyInfo` appears 0 times in
  `project.pbxproj`).

So an app-level manifest is **not required** by required-reason API usage, and its absence
is not an automatic rejection. It is still worth adding a small one declaring
`NSPrivacyTracking false` and the collected data types, so Apple's generated privacy report
matches the App Privacy answers below. Treat it as a recommended tidy-up, not a gate.

## 4. App Privacy

Derived from what the code sends. **No third-party analytics, advertising or tracking SDK
is present in the app**: the iOS dependencies are only `@capacitor/core`, `@capacitor/ios`
and `@capacitor/android`, and the web app contains no Google Analytics, Meta pixel, Segment,
Mixpanel, Amplitude, Sentry, Hotjar or Clarity code.

**Tracking: No.** No advertising identifier, no data broker, nothing shared for cross-app
tracking.

> Note, separate from the app: the marketing site `youhan.in` loads event reporting from
> `readdy.ai`. That is the website, not the app, so it does not change these labels — but
> the privacy policy covering the site must disclose it.

All of the following are **collected, linked to identity, App Functionality only**:

| Data type | What it is here | Evidence |
|---|---|---|
| **Contact Info** | The user's name, email, phone; and those of leads, customers and property owners they record | CRM and identity models |
| **Contacts** | Contact details about third parties the user enters. The device address book is never read | No contacts plugin |
| **Precise Location** | Attendance check-in and site-visit punches send latitude, longitude, accuracy | `enableHighAccuracy: true` in check-in, site visits and face capture — so **Precise**, not Coarse |
| **Sensitive Info** | Face check-in stores a biometric template and matches against it | `Float32Array` embedding, cosine similarity |
| **Financial Info** | Collections, receipts, commissions, payroll, payslips | Finance modules |
| **User Content** | Photos, uploaded documents, receipt evidence, free-text notes | Upload routes |
| **Identifiers** | User ID and session identifier | `lf_session` cookie |
| **Usage Data** | Audit records of what was opened and changed | Audit log |
| **Diagnostics** | Server request and error logs keyed to a request ID | Structured logs |

**Not collected:** Health & Fitness, Browsing History, Search History, Purchases,
Advertising Data, Other Data.

### Third parties that can receive data **[corrected again — the AI flows were missing]**

Checked against the running production deployment, not only the source. Provider selectors
and secret **names** were read; no secret value was read or recorded.

**Google Gemini — the significant omission from both earlier drafts.** `GEMINI_API_KEY` is
set on production and `GEMINI_MODEL=gemini-flash-latest`. Five code paths send content to
Google, and they do not all protect it the same way:

| Path | What is sent | Protection |
|---|---|---|
| Live call assist (`calls/[id]/live-audio`) | **Raw call audio**, up to 5 MB per chunk, `audio/webm` | **Consent-gated** — the route throws `Forbidden('Record consent before streaming call audio.')`. A text redactor cannot filter audio, so what the customer said reaches Google as spoken. |
| Call analysis (`lib/ai/analysis.ts`) | Transcript | **Redacted** |
| AI call audits (`lib/ai/audit.ts`) | Transcript, first 30 000 chars | **Redacted** |
| Follow-up email drafting (`lib/ai/followUpEmail.ts`) | Transcript | **Redacted** |
| AI assistant (`lib/ai/assistant/service.ts`) | The question, plus **tool results read from CRM data** | **No redaction** — see the note below |

The redaction layer (`lib/ai/redact.ts`) is good: it strips `SECRET`, `EMAIL`, `CARD`
(Luhn-checked, so an order reference or a price survives while a real card number does not),
`PHONE` and `NUMBER`, replaces them with typed placeholders so the model still knows a card
was discussed, logs only counts and never values, and is deliberately irreversible — the
original stays in the access-controlled `Transcript` row. The prompts also tell the model not
to follow instructions found in user-supplied text, which is a prompt-injection guard.

**The assistant is the exception, and it should be a decision rather than an oversight.**
`assistant/service.ts` imports `gemini`, `provider`, `usage` and `rbac` but not `redact`,
and it runs `generateWithTools`, so tool results are fed back to the model. Customer names,
emails and phone numbers can therefore reach Google through the assistant while the same
data is redacted on every other AI path. It may well be intentional — an assistant that
cannot see a customer's name is not much of an assistant — but the privacy policy has to
describe it accurately either way. **OWNER** to confirm intended.

The key is the workspace's own where one is connected, otherwise the deployment's, so on the
current configuration these requests are billed to and made with the operator's key.

**Email — Google.** `EMAIL_PROVIDER=smtp` with `SMTP_HOST=smtp.gmail.com`, so invitations,
password resets and notifications leave through Gmail: recipient address and message body.

**Configured but connected by nobody.** `WHATSAPP_PROVIDER=meta` is selected at deployment
level, and Google Calendar OAuth is supported in code — but `IntegrationConnection` holds
**0 rows** across the **1** production tenant. Neither provider is receiving anything today.
This is the distinction between a capability and a live data flow, and the policy should not
describe a provider as active when nothing is connected to it.

### Internal services — data that stays on the host

`clamav` (uploads), `face:8000` with `FACE_SERVICE_TOKEN` (biometric templates never leave
the operator's infrastructure), `minio:9000` for documents at rest, Postgres and Redis. None
of these is a third-party disclosure; they are the operator's own processing.

### Observed versus configured

One active `RecordingConsent` row exists in production, which is what permits the audio path
— it is not evidence that audio was sent. A key being set and a consent existing establish
capability, not use. Proving requests occurred would need provider-side logs, which have not
been inspected.

### Superseded note


These are per-tenant integrations a customer enables; they are off unless configured. The
privacy policy must name them, and App Privacy answers should reflect that data may be
shared when enabled:

| Provider | What leaves | Configured by |
|---|---|---|
| SMTP relay | Invitations, resets, notifications — recipient address and message | Customer |
| **Meta WhatsApp Business** | Message content and recipient phone number | Customer |
| **Google Calendar** (OAuth) | Event details and attendees | Customer |
| Telephony (caller number, country) | Numbers dialled and call metadata | Customer |
| ClamAV | Uploaded file bytes, scanned in the operator's own infrastructure | Operator |
| Object storage (S3/MinIO) | Uploaded documents at rest | Operator |
| Face sidecar | Face frames and embeddings, in the operator's own infrastructure | Operator |

**OWNER:** confirm which of these are live for the customers this release serves. A provider
that is configured for nobody should not be described as active, and one that is must be in
the policy.

## 5. Rules that need a specific answer, not a blanket one **[corrected]**

| Rule | Answer here | Basis |
|---|---|---|
| **Account deletion (5.1.1(v))** | **Applies — treat as an open item** | See section 5a. The earlier "does not apply" was wrong. |
| **Payments / IAP (3.1.1, 3.1.3)** | No in-app purchase | Nothing is sold inside the app. Business software sold to organisations outside the app is permitted; the subscription screen links to `mailto:` rather than taking payment. **OWNER** to confirm no in-app purchase path is planned for 1.0. |
| **Content rights** | Contains no third-party content | The app shows only the customer's own data and YOUHAN branding. |
| **Age rating** | **4+** | Per question, not by assumption: no violence, sexual content, profanity, horror, alcohol/drugs, gambling or contests. **Unrestricted web access: No** — the WebView loads only the app's own origin and hands external links to Safari. **User-generated content: not public** — content is visible only inside the customer's workspace. |
| **Sign in with Apple (4.8)** | Not triggered | Applies where a third-party social login is offered. This app has none — credentials are issued by the customer's administrator. |
| **Data deletion / retention** | **OWNER** | Retention periods for audit records, recordings and documents are an operator policy, not a code fact, and the policy cannot be written without them. |

### 5a. Account creation and deletion, rechecked **[corrected twice]**

The first draft claimed 5.1.1(v) does not apply because there is no sign-up route. That
reasoning was wrong: absence of a public sign-up form is not absence of account creation.
Three code paths create accounts, and one of them is driven by the end user.

| Path | Who performs it | What is created |
|---|---|---|
| `acceptInvitation(token, { password, fullName })` | **The invited person, unauthenticated, holding only a token** | `tx.platformUser.create({ passwordHash, ... })` — the credential record itself |
| `createStaffAccount(ctx, input)` | An administrator inside the app | A staff account, rank-guarded: a role at or above the actor's own is refused |
| `POST /api/v1/platform/workspaces` | A platform operator | A workspace and its first administrator |

The middle path alone would be arguable. The first is not: a person who is not signed in
chooses a password and ends up with a credential record. By any ordinary reading the app
supports account creation.

**Deletion exists, but only an administrator can perform it.** `deleteUser(ctx, userId,
reason?)` soft-deletes the user, sets `status: 'DEACTIVATED'` — deliberately both, because
the login path reads `status`, so a half-applied delete still refuses the sign-in — marks
the workspace membership `REMOVED`, revokes every session and writes an audit record. It
refuses to remove you, anyone at or above your rank, the workspace's primary administrator,
and the last active administrator.

**What is missing is self-service.** `profile/` contains `appearance`, `role` and
`security`, and nothing anywhere offers "delete my account". A person who created their own
credential by accepting an invitation cannot remove it from inside the app.

So the position is: **the app supports account creation and does not let the account holder
delete their own account.** That is the gap 5.1.1(v) is aimed at. Apple does recognise that
accounts belonging to an organisation are managed differently, and this is a workspace
product where the employer owns the account — but that is an argument to be made explicitly
to App Review, not an exemption to assume. I am not going to state Apple's exception wording
from memory as though it settles it.

Two ways to close it, for **OWNER** to choose:

1. **Add a deletion request affordance** — a clear item under Profile → Security explaining
   that the account belongs to the workspace, naming the administrator who can remove it,
   and offering a one-tap route to the support address. Small, self-contained, and removes
   the ambiguity. Needs the public support email from section 9.
2. **Argue the organisation-managed case in review notes** — state that accounts are
   provisioned and removed by the customer's administrator, that the app exposes removal to
   that administrator, and describe how an individual requests deletion. Cheaper, but it is
   a judgement call that App Review can decline.

Recommended: (1), with (2) in the review notes as well. It is a small amount of work against
a rejection reason that is entirely avoidable.

The privacy policy must in either case state how a person's data is deleted, by whom, and
what is retained afterwards — the audit record of a removal is kept by design.

## 6. Reviewer access — without weakening anyone's security **[corrected]**

The first draft said MFA "must be disabled for the reviewer account". That was wrong, and it
would have meant changing a security control for a review.

**MFA here is per-user opt-in, not organisation-enforced.** Login demands a code only when
that user's `mfaEnabled` is set. So the correct instruction is simply: **create the reviewer
account and do not enrol it in two-factor.** Nothing is disabled, no policy changes, and no
other account is affected.

If a workspace ever does require MFA for everyone, the fallback is the existing recovery
codes rather than turning the control off.

- **Sign-in required:** Yes
- **Demo account:** **OWNER** — a dedicated reviewer account on a synthetic-data workspace.
  Never a real customer workspace.
- **Contact:** first name, surname, phone, email — **OWNER**

**Notes for the reviewer** (draft):

> YOUHAN ONE is a workspace application for organisations that already subscribe. Sign in
> with the account above; it opens a demonstration workspace containing synthetic data, not
> real customers.
>
> What to try: open Leads and select any record to see its activity and follow-ups; open
> Collections to see a receipt and the second-person verification it requires; open People
> for attendance and leave. Access is decided by the role on the account, so some areas are
> intentionally unavailable to some users.
>
> The app asks for camera access only when attaching a photo to a record or using face
> check-in, and location only when checking in for attendance or recording a site visit.
> Both are optional and the app explains the refusal if they are declined.

## 7. Listing text, counts verified mechanically **[corrected]**

The first draft asserted counts by hand and got the app name wrong. These were measured:

| Field | Count | Limit |
|---|---|---|
| Name — `YOUHAN ONE` | 10 | 30 |
| Subtitle — `Your business. Working as one.` | 30 | 30 |
| Keywords | 89 | 100 |
| Promotional text | 133 | 170 |
| Description | 1294 | 4000 |
| What's New | 14 | 4000 |

Keywords also checked: no space after a comma, no duplicate term, and no word repeated from
the app name or category.

**Keywords:**

```
CRM,sales,pipeline,leads,HR,attendance,payroll,collections,commission,property,field,team
```

**Promotional text:**

> Sales, people and money in one place. Work your pipeline, log calls, check in for
> attendance and approve collections from your phone.

**Description:**

> YOUHAN ONE brings sales, people, operations and finance into a single workspace, so the
> work your team does in the field is the same work the office sees.
>
> SALES
> Track leads from first contact to closed deal. Log calls, notes and follow-ups against
> the record they belong to, so nothing is remembered only by the person who did it.
> Opportunities, activities and tasks stay tied to the customer they came from.
>
> PROPERTY
> Keep the listing book, mandates and project inventory in one place, with the owner
> relationship and the marketing behind each property.
>
> PEOPLE
> Attendance, leave, payroll, documents and recruitment for the whole team. Staff check in
> from their phone, request leave and read their own records without asking HR first.
>
> MONEY
> Booking confirmation, collections, receipts and commissions with the approvals your
> finance team already requires — including a second person to verify what the first
> recorded.
>
> BUILT FOR REAL ORGANISATIONS
> Permissions decide what each role can open, change or delete, and every workspace's data
> is isolated from every other. Approvals that must be made by a second person cannot be
> completed by the person who raised them.
>
> YOUHAN ONE is a workspace for organisations that already use it. You will need an account
> from your administrator to sign in.

**App Information:** primary category **Business**, secondary **Productivity**.

## 8. Support and privacy pages — neither exists yet **[new]**

`youhan.in` is a single-page site that answers **200 with the same `<title>YOUHAN</title>`
for every path**, including one invented for the test. So `youhan.in/privacy` and
`youhan.in/support` are soft 404s, not pages. Apple checks the privacy policy URL, and a URL
that renders the marketing home page instead of a policy is a routine rejection.

Both pages have to be real before submission. They live on the marketing site, which is
outside this repository — **OWNER** to say who edits it and whether `/privacy` and
`/support` are the right paths for that platform.

A privacy policy can be drafted from sections 4 and 5 once the **OWNER** facts in section 9
are known. It should not be published before then: retention periods, the legal operator and
the live provider list are factual and legal declarations, and guessing them is worse than
having no page.

## 9. What is needed from the owner

One compact list. Nothing here can be derived from the code.

1. **Rights holder** — the name to put in the copyright line and the privacy policy as the
   operator. An individual's name is fine; a registered company is not required.
2. **Public support email** — the repo contains only the placeholder `support@example.com`.
3. **App Review contact** — first name, surname, phone, email.
4. **Pricing and country availability** — free or a tier, and all countries or a named list.
5. **Retention and deletion** — how long audit records, call recordings and uploaded
   documents are kept, and how a person's data is deleted on request.
6. **Live providers** — which of the section-4 integrations are actually in use for the
   customers this release serves.
7. **Who edits `youhan.in`**, so `/privacy` and `/support` can be published.
8. **The 4.2 decision** (section 1) and **the Capacitor option** (section 2).

Submission itself needs Account Holder, Admin or App Manager. The upload key is Developer
role by design and returns `403 FORBIDDEN_ERROR` on
`POST /v1/appStoreVersionSubmissions`; the Account Holder submitting by hand is the right
answer rather than broadening that key.

## 10. Screenshots

Required for 1.0: at least one set at **6.9"** (1320 × 2868). A 6.5" set is recommended.

**iPad:** the target is `TARGETED_DEVICE_FAMILY = "1,2"`, so iPad screenshots are required
unless iPad is dropped. iPad layout has not been tested at all. Proposed scope reduction,
stated plainly: **set the target to iPhone only for 1.0**, which removes the iPad screenshot
requirement and the obligation to support a layout nobody has verified. iPad can be added in
a later version once it is tested. **OWNER** to accept or reject.

Six proposed shots, all capturable from the demo workspace:

1. Workspace Summary — pipeline value, open opportunities, what needs attention
2. Leads — the list on a phone with follow-up state
3. Lead detail — activity, notes, call and follow-up on one record
4. Collections — a receipt and its verification state
5. Attendance check-in — People on a phone
6. Reports — a report rendering on a phone

**Synthetic data only.** Screenshots of real customer, employee or payroll records would
publish personal data on a public listing.
