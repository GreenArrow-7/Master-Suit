# App Store listing — YOUHAN ONE

Everything App Store Connect asks for before version 1.0 can be submitted, filled in
where the answer is a fact about this codebase and marked **OWNER** where it is a
business decision that must not be invented.

- **App:** YOUHAN ONE · **Bundle ID:** com.youhan.one · **Apple ID:** 6812716422
- **Team:** 3SHW6AX727 · **Primary language:** English (U.K.) · **SKU:** YOUHAN-ONE-IOS-001
- **Current state:** version 1.0, `PREPARE_FOR_SUBMISSION`, age rating unset, no
  screenshots, no privacy disclosures.

## Blockers that stand between this listing and a submission

These are not metadata gaps. None of them is fixed by filling in a form.

1. **The app is a WebView over a hosted site, and guideline 4.2 rejects apps that are
   only a website.** `apps/mobile/capacitor.config.js` loads `server.url`; Capacitor's own
   configuration reference says that setting "is not intended for use in production", and
   `apps/mobile/README.md` lists both facts under *Before any release build*. A reviewer
   opening this build sees the same pages Safari shows. This needs an owner decision:
   submit and accept the rejection risk, or invest in a production-supported architecture
   first. It is the single largest release blocker and it is an engineering decision, not
   a listing field.
2. **No privacy manifest.** `PrivacyInfo.xcprivacy` does not exist anywhere under
   `apps/mobile/ios`. Apple requires one for apps that use required-reason APIs, and
   App Store Connect rejects uploads that omit it where it is required. This has to be
   added to the Xcode target before a submission candidate is built.
3. **The upload API key cannot submit.** It is Developer role by deliberate design, so CI
   can ship builds without holding submission rights. `POST /v1/appStoreVersionSubmissions`
   returns `403 FORBIDDEN_ERROR`. Submission needs Account Holder, Admin or App Manager —
   either a person in App Store Connect, or a new key at that role.
4. **Uploads depend on a virus scanner.** Document and receipt attachments fail closed when
   ClamAV is unreachable. Production must have a reachable scanner before a build pointed at
   `one.youhan.in` is reviewed, or a reviewer testing an attachment sees an error.

## App Information

| Field | Value |
|---|---|
| Name | `YOUHAN ONE` (11 chars; limit 30) |
| Subtitle | `Your business. Working as one.` (30 chars; limit 30) — from `PRODUCT_TAGLINE` |
| Category, primary | **Business** |
| Category, secondary | **Productivity** |
| Content rights | Contains no third-party content |
| Age rating | **4+** — see questionnaire below |
| Privacy policy URL | **OWNER** — required; none exists in the codebase |
| Support URL | **OWNER** — required; the only address in the repo is the placeholder `support@example.com` |
| Marketing URL | **OWNER** — optional |
| Copyright | **OWNER** — e.g. `2026 <registered entity name>` |

## Version 1.0

**Promotional text** (170 max, editable without review):

> Sales, people and money in one place. Work your pipeline, log calls, check in for
> attendance and approve collections from your phone.

**Description** (4000 max):

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

**Keywords** (100 chars, comma separated, no spaces after commas):

```
CRM,sales,pipeline,leads,HR,attendance,payroll,collections,commission,property,field,team
```

*(89 characters. Do not repeat words from the app name or category.)*

**What's New in 1.0:**

> First release.

## App Privacy

Derived from what this codebase actually sends to the server. **No third-party analytics,
advertising or tracking SDK is present** — the iOS app's only dependencies are
`@capacitor/core`, `@capacitor/ios` and `@capacitor/android`, and the web app contains no
Google Analytics, Meta, Segment, Mixpanel, Amplitude, Sentry, Hotjar or Clarity code.

**Tracking: No.** Nothing is shared with data brokers, no advertising identifier is read,
and no data is used to track across apps or websites owned by other companies. Answer
"No" to every tracking question.

Everything below is **collected, linked to the user's identity, and used for App
Functionality only** — never for advertising, marketing, analytics for third parties, or
personalisation beyond the product's own function.

| Data type | What it is here | Why |
|---|---|---|
| **Contact Info** | Name, email address, phone number — the signed-in user's, and the customers, leads and property owners they record | App Functionality |
| **Contacts** | Customer and lead records are contact details about other people. See the note below | App Functionality |
| **Precise Location** | Attendance check-in and site-visit punches send latitude, longitude and accuracy. `enableHighAccuracy: true`, so this is **Precise**, not Coarse | App Functionality |
| **Sensitive Info** | Face check-in stores a biometric face template (a numeric embedding) and matches against it | App Functionality |
| **Financial Info** | Collections, receipts, commissions, payroll and payslip records | App Functionality |
| **User Content** | Photos taken or chosen for records, uploaded documents and receipt evidence, and free-text notes | App Functionality |
| **Identifiers** | User ID and session identifier | App Functionality |
| **Usage Data** | Audit records of what was opened and changed, which the product exists to keep | App Functionality |
| **Diagnostics** | Server-side request and error logs keyed to a request ID | App Functionality |

**Not collected:** Health & Fitness, Browsing History, Search History, Purchases,
Advertising Data, Other Data.

Three judgement calls for the owner, all of which affect whether the label is accurate:

- **Contacts.** The app never reads the device address book. It does store contact details
  about third parties that the user types in. Apple's "Contacts" type covers contact
  information about other individuals, so declaring it is the conservative and, in my
  reading, correct answer. **OWNER** to confirm.
- **Sensitive Info / biometrics.** Face check-in is optional per workspace, but the app
  binary supports it, so it should be declared. If face check-in will be disabled for every
  customer at launch, say so and it can come off. **OWNER**.
- **Data deletion.** Apple asks whether the app offers account deletion. This product's
  accounts are created and removed by a workspace administrator, not self-service. That is
  an acceptable answer for a business app but must be described accurately in the review
  notes. **OWNER** to confirm the intended answer.

## Age rating questionnaire

Every content question: **None**. Specifically —

| Question | Answer |
|---|---|
| Cartoon or fantasy violence, realistic violence, sexual content, nudity, profanity, horror, alcohol/tobacco/drugs, simulated gambling, contests | None |
| Unrestricted web access | **No** — the app loads only its own origin; external links open in Safari |
| Gambling | No |
| User-generated content shared publicly | **No** — content is visible only inside the customer's own workspace |
| Age assurance / medical / health | No |

Result: **4+**.

## Screenshots

Required for 1.0: at least one set at **6.9"** (1320 × 2868 or 2868 × 1320). A 6.5" set is
recommended for older devices. iPad screenshots are only needed if the app stays
iPad-compatible — the target is currently `TARGETED_DEVICE_FAMILY = "1,2"`, so **either
supply iPad screenshots or drop iPad from the target before submitting.** **OWNER decision.**

Proposed six, all capturable from the running app on demo data:

1. **Workspace Summary** — pipeline value, open opportunities, what needs attention
2. **Leads** — the list on a phone, with follow-up state
3. **Lead detail** — activity, notes, call and follow-up against one record
4. **Collections** — a receipt with its verification state
5. **Attendance check-in** — the People area on a phone
6. **Reports** — a report rendering on a phone

**These must be captured from demo data only.** Screenshots of real customer, employee or
financial records would publish personal data to the App Store. The `manath-homes` demo
workspace on staging is the correct source.

## Reviewer access (App Review Information)

App Review cannot see anything without an account, and a reviewer who cannot sign in gets
rejected as "unable to review".

- **Sign-in required:** Yes
- **Demo account:** **OWNER** — a dedicated reviewer account on a demo workspace containing
  synthetic data only. Do not give App Review access to a real customer workspace.
- **Two-factor:** MFA must be **disabled for the reviewer account**, or review will stall at
  the code prompt. If workspace policy forces MFA, that policy has to exempt this account.
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
> The app requests camera access only when attaching a photo to a record or using face
> check-in, and location only when checking in for attendance or recording a site visit.
> Both are optional and the app explains the refusal if they are declined.

## Pricing and availability — OWNER

- **Price:** free, or a tier. The product is sold by subscription outside the App Store; if
  no purchase happens inside the app, it is free with no in-app purchases.
- **Countries:** all, or a named list. UAE-first content suggests a narrower list may be wanted.
- **Release:** manual, or automatic on approval. Version 1.0 currently has
  `releaseType = AFTER_APPROVAL`.
- **Business model note.** Apple may ask how the app makes money. A B2B tool whose customers
  pay outside the App Store is acceptable, but the answer must be stated consistently.

## What is needed from the owner, in order

1. **Guideline 4.2 decision** — submit the WebView build and accept the rejection risk, or
   change the architecture first.
2. **Privacy policy URL** and **support URL** — both mandatory, neither exists.
3. **Reviewer demo account** on a synthetic workspace, with MFA disabled.
4. **App Review contact** — name, phone, email.
5. **Copyright holder** — the registered entity name.
6. **Pricing and country availability.**
7. **iPad** — supply iPad screenshots or drop iPad from the target.
8. **An Account Holder, Admin or App Manager** to submit, or a key at that role.

## What can be completed without the owner

- `PrivacyInfo.xcprivacy` added to the Xcode target.
- Screenshots captured from the demo workspace at 6.9" and 6.5".
- Description, keywords, promotional text and reviewer notes entered as drafted above.
- Age rating questionnaire answered as above.
