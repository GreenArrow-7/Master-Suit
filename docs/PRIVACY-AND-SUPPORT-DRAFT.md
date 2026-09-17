# Privacy policy and support page — DRAFT for owner approval

**Status: draft. Not published. Nothing here is a legal opinion.** Every statement of fact
below is derived from the code at `feat/account-deletion` `19e42c04877b`; every bracketed
**[OWNER]** item is a decision or a value only the owner can supply. The store listing needs
public URLs for both pages before submission; the suggested locations are
`https://one.youhan.in/privacy` and `https://one.youhan.in/support`.

---

## Privacy policy (draft)

**Who we are.** YOUHAN ONE is business software provided by **[OWNER: legal entity name,
registered address, country]**, used by organisations ("workspaces") to manage sales,
customers, staff and payroll. Your organisation, not YOUHAN, decides what is recorded in it.

**Accounts.** There is no public sign-up. An administrator in your organisation invites you;
your account is linked to that workspace.

**What the app collects, and why** (all for the app's own functionality; none for advertising
or tracking):

- **Your identity and contact details** — name, email, phone, photo — to sign you in and show
  who did what.
- **Contact details of the people you record** — leads, customers, property owners — entered
  by you or your colleagues.
- **Precise location** — when you check in for attendance or record a site visit. Captured
  only at that moment, with the accuracy your device reports.
- **Face templates** — only if you give consent on the Security screen; used to confirm it is
  you at check-in. Stored as a mathematical template, not a photograph. You can withdraw
  consent at any time and the templates are deleted.
- **Financial and payroll information** — collections, receipts, commissions, payslips —
  recorded by your organisation.
- **Documents and photos you upload**, including identity documents held by your HR team.
- **Call recordings and transcripts** — only where your organisation has enabled call
  recording and consent has been recorded for the call.
- **Usage and audit records** — what was opened and changed, with your user id, IP address
  and browser, so your organisation can audit its own records.
- **Diagnostics** — server request and error logs keyed to a request id.

**Third parties.** No analytics, advertising or tracking SDK is in the app. Data leaves the
service only to providers your organisation configures: an email relay, **Meta WhatsApp
Business**, **Google Calendar**, a telephony provider, and — where enabled — **Google Gemini**
for call analysis and drafting assistance, which receives call transcripts and the text you
ask it to work on. **[OWNER: confirm which are enabled for launch; list only those.]** Files
are virus-scanned and stored in infrastructure operated by **[OWNER: hosting provider,
region]**.

**Retention.** **[OWNER: D1–D6 — retention periods for HR identifiers and documents, audit
records, recordings, and the backup rotation window.]** Encrypted backups are kept for
**[OWNER: n days]** and cannot be edited selectively.

**Deleting your account.** Profile → Security → *Delete my account*. You confirm with your
password (and authenticator code if enabled). Your sign-in, password, two-factor setup,
sessions, face templates, personal contact details and API keys are removed and your
membership of every workspace ends. Records you created for your organisation — leads,
calls, receipts, approvals — stay with the organisation with your name against them, as do
the audit trail and your employment record and any identity documents held by HR
**[OWNER: per D1–D2]**. The completed request records exactly what was kept and why.
Eligible requests are processed **[OWNER: "within 24 hours" as an operational target]**; if
you are your organisation's owner or last administrator you are asked to hand that over
first. **[OWNER: whether processing is switched on at launch — D8.]**

**Your rights.** **[OWNER: jurisdiction-specific — e.g. UAE PDPL, GDPR if any EU users —
access, correction, deletion, complaint route.]** Contact: **[OWNER: privacy contact email]**.

**Changes.** We will post changes here with the date. Last updated **[OWNER: date]**.

---

## Support page (draft)

- **Help with your account** (password, authenticator, access): contact your organisation's
  administrator first — they manage your account.
- **Report a problem with the app:** **[OWNER: support email]**, **[OWNER: hours / response
  target]**.
- **Privacy requests:** **[OWNER: privacy contact email]**.
- **Delete your account:** in the app, Profile → Security → *Delete my account* (see the
  privacy policy).
- **Version:** shown on Profile → About. **[OWNER: confirm the screen exists at launch or drop
  this line.]**

---

## App Store reviewer notes (draft)

Demo workspace and reviewer account: **[OWNER: create a disposable reviewer account with a
synthetic workspace on production; MFA is per-user opt-in and must simply not be enabled on
it — no security control is changed.]** Precise location and camera are requested only on
attendance/site-visit/face check-in screens. There is no sign-up; accounts are invited.
Account deletion is in Profile → Security.
