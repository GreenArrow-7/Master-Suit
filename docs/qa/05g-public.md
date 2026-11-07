# Section 5g — Public Visitor

Every case here is run with **no session at all** — a private browsing window,
or a browser that has never signed in. If you are signed in anywhere, these
cases do not test what they claim to.

The public surfaces, from [01](01-inventory.md) §1.5:

| Surface              | Path                                   |
| -------------------- | -------------------------------------- |
| Web form             | `/f/{slug}/{formKey}`                  |
| QR capture           | `/c/{slug}/{key}`                      |
| Landing page         | `/l/{slug}/{pageSlug}`                 |
| Proposal / shortlist | `/p/{token}`                           |
| Shared record        | `/s/{token}`                           |
| Event RSVP           | `/rsvp/{token}`                        |
| Testimonial          | `/testimonial/{token}`                 |
| Trial sign-up        | `/signup` → `/signup/confirm`          |
| Password recovery    | `/forgot-password` → `/reset-password` |
| Invitation           | `/accept-invite`                       |
| Privacy, Support     | `/privacy`, `/support`                 |

The proposal, shared-record, RSVP and testimonial surfaces are tested in
[05e](05e-real-estate.md) (`RE-REQ-001`, `RE-SHARE-001`, `RE-EVENT-001`,
`RE-TEST-001`). This section covers the rest, plus the authentication flows.

---

## PUB-FORM-001 — Submit a public web form

|                     |                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Public / Sales CRM                                                                                                                                                                                                                                                                                                                        |
| **User Role**       | Public Visitor (no account)                                                                                                                                                                                                                                                                                                               |
| **Feature**         | Public lead-capture form                                                                                                                                                                                                                                                                                                                  |
| **Test Scenario**   | A visitor fills in a published form and it becomes a lead in the right workspace, through the same intake the portals and QR codes use                                                                                                                                                                                                    |
| **Priority**        | **P0**                                                                                                                                                                                                                                                                                                                                    |
| **Preconditions**   | In `manath-homes`, a form exists at **Marketing → Lead Sources → Forms** (`/manath-homes/sales/forms`), is **PUBLISHED** and **public**, and has at least a name field mapped to the lead's full name. Note its key. The workspace holds a lead module. **The worker should be running**, so distribution and automations can be observed |
| **Test Data**       | Your name `QA Public Visitor`; mobile `+971501234520`; email `qa.public@example.com`; message `QA: 2 bedrooms in Marina`                                                                                                                                                                                                                  |
| **Navigation Path** | `/f/manath-homes/{formKey}`                                                                                                                                                                                                                                                                                                               |
| **Code Reference**  | `src/app/f/[workspaceSlug]/[formKey]/page.tsx`, `src/app/api/v1/public/forms/route.ts`, `src/services/leads/intake.ts` (`takeEnquiry`), `src/services/leads/leadSources.ts`                                                                                                                                                               |

**Test Steps**

1. As Admin in a separate browser, create or confirm a published public form and note its key and its fields (each field's **Label**, type and whether it is required).
2. Open a private window with **no session**.
3. Navigate to `/f/manath-homes/{formKey}`.
4. Confirm the page renders with **no sidebar and no sign-in prompt**.
5. Confirm the workspace's display name (**Manath Homes**) appears above the heading, and the heading is the **form's own name**.
6. Confirm the fields match what the administrator configured, with required ones marked.
7. Submit the form **empty**. Read the message.
8. Fill in every field except the name. Submit. Read the message.
9. Fill in the whole form with the test data and submit.
10. Confirm a success state appears on the page.
11. In the Admin browser, open **CRM → Leads → All Leads** and find the lead.
12. Confirm the lead's **Full name**, **Email** and **Phone** match what you typed.
13. Confirm the lead's **source** is the workspace's **Website** entry.
14. Open the lead's timeline. Confirm a note carries the unmapped answers (for example the message), and confirm **no contact detail appears in that note**.
15. Confirm a second phone number you entered in another phone field appears among the **lead's numbers**, not in the note.
16. Confirm a **form submission** record is kept beside the lead as evidence.
17. Within five minutes, confirm the lead is distributed to an agent and a first-contact task exists.
18. Submit the same form again with the **same** email or phone.
19. Confirm the second submission is **attached to the existing lead** rather than creating a duplicate.
20. Submit 11 times within a minute from the same IP.
21. Open `/f/manath-homes/{formKey}` with `?embed=1` (or whatever the embed parameter is — see **Embedded form** on the Forms screen). Confirm the page renders without the full-page background, suitable for an iframe.

**Expected Result**

- The page is **unauthenticated by design**. The workspace slug plus the form key reach **only** forms that are PUBLISHED and public, in a workspace that still owns a lead module — so a guessed key exposes nothing that was not put on the internet on purpose.
- Step 7: refused with **"Please fill in: {labels}."** naming each missing required field.
- Step 8: refused with **"Please tell us your name."** — the lead must have a name.
- The submission becomes a lead through `takeEnquiry`, the **same intake the portals and QR codes use**: attached to the lead that already holds the number or email, audited, put on the first-contact clock, handed to distribution and the automations.
- Step 13: form and landing-page leads both count under the workspace's **Website** source entry.
- Steps 14–15: **contact details never go on the timeline note, which nobody masks.** Another phone number joins the lead's numbers; another email address stays in the submission. A phone number or email address appearing in an unmasked note is a **P0 data-leak defect**.
- The `FormSubmission` row is kept as evidence.
- Step 19: an existing lead is **matched**, not duplicated.
- Step 20: the 11th submission in a minute returns **429** (the route's limit is 10 / minute).

**Negative Scenarios**

| What to try                                                     | Expected                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A form key that does not exist                                  | **404**, which discloses nothing                                                                                                                  |
| A form that is DRAFT, not PUBLISHED                             | **404**                                                                                                                                           |
| A form marked not public                                        | **404**                                                                                                                                           |
| A workspace slug that does not exist                            | 404                                                                                                                                               |
| A workspace whose lead module was removed                       | 404 or refused — the form must stop working                                                                                                       |
| An answer of 2,500 characters                                   | Refused (maximum 2,000 per answer)                                                                                                                |
| 41 answers in one submission, by API                            | Refused (maximum 40)                                                                                                                              |
| An unknown field in the body, by API                            | 422 — the schema is strict                                                                                                                        |
| A `page` parameter naming a landing page the form is **not** on | Treated as a plain form submission, **not** attributed to that page                                                                               |
| A `page` parameter naming a DRAFT landing page                  | Not attributed                                                                                                                                    |
| An email of `<script>alert(1)</script>`                         | Stored as text and **rendered as text** everywhere it appears. Confirm on the lead page, the grid and any export. Script execution is a P0 defect |
| A name field containing `=1+1`                                  | In a CSV export, must not be interpreted as a formula by a spreadsheet. Confirm, and record                                                       |
| The same submission posted twice with one `Idempotency-Key`     | The second replays the first response with `Idempotent-Replay: true`                                                                              |

**Evidence** — The public page as a visitor sees it; both validation messages verbatim; the created lead with its source and timeline note; the second submission attaching rather than duplicating; the 429.

---

## PUB-QR-001 — QR capture link

|                     |                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Public / Sales CRM                                                                                                                                                                                                                              |
| **User Role**       | Public Visitor                                                                                                                                                                                                                                  |
| **Feature**         | QR capture (a code on a stand, a flyer or a sign board)                                                                                                                                                                                         |
| **Test Scenario**   | A visitor scans a code, leaves their details, and becomes a lead attributed to that link                                                                                                                                                        |
| **Priority**        | P1                                                                                                                                                                                                                                              |
| **Preconditions**   | In `manath-homes`, a QR capture link exists at **CRM → Leads → QR Capture** (`/manath-homes/sales/capture-links`) and is **switched on**. Note its key. Set the workspace's logo and brand colour under **Administration → Settings → Company** |
| **Test Data**       | Your name `QA Scanner`; mobile number `+971501234521`; email `qa.scanner@example.com`; what are you looking for `QA: studio in JLT`                                                                                                             |
| **Navigation Path** | `/c/manath-homes/{key}`                                                                                                                                                                                                                         |
| **Code Reference**  | `src/app/c/[workspaceSlug]/[key]/page.tsx`, `src/app/api/v1/public/capture/route.ts`, `sales/capture-links/page.tsx`                                                                                                                            |

**Test Steps**

1. As Admin, open **CRM → Leads → QR Capture** (the page is titled **QR capture**). Create a link with a **Headline on the page** of `QA: tell us what you need` and note its key. Confirm the link is active.
2. Open a private window with no session. Navigate to `/c/manath-homes/{key}`.
3. Confirm the workspace's **logo** appears at the top; if no logo is set, confirm the workspace's **name** appears instead.
4. Confirm there is a coloured bar at the top of the card in the workspace's brand colour.
5. Confirm the heading is your configured headline. (With none set, confirm the default: **Leave your details and we will call you**.)
6. Confirm the form has exactly four fields: **Your name** (required), **Mobile number** (required), **Email** (optional), **What are you looking for?** (optional).
7. Submit empty. Read the message.
8. Submit with a name but no mobile number. Read the message.
9. Submit the full test data.
10. In the Admin browser, find the lead and confirm it is attributed to this capture link.
11. Confirm the "what are you looking for" answer is on the lead's timeline and that **no contact detail is in that note**.
12. Switch the capture link **off** as Admin.
13. Reload `/c/manath-homes/{key}` as the visitor.
14. Submit 11 times in a minute from one IP.
15. Open the same page on a phone-width viewport (about 390 px). Confirm the form is usable and nothing scrolls sideways.

**Expected Result**

- The page sits **outside every route group**: no session, no sidebar.
- It wears the workspace's logo and brand colour, as `/p` and `/s` do. **Where no logo is set, the workspace's name is shown in the ink colour rather than the brand colour** — a dark brand on the dark theme would not read.
- Both required fields are enforced, with the same per-field message style as the web form.
- Step 13: **a switched-off link is a 404, which discloses nothing** — not a "this link is disabled" page, which would confirm the key was once valid.
- Step 14: the 11th in a minute is **429** (the capture route's limit is 10 / minute).
- The lead goes through the same intake as the web form, so matching, auditing, the first-contact clock, distribution and automations all apply.

**Negative Scenarios**

| What to try                               | Expected                    |
| ----------------------------------------- | --------------------------- |
| A key that never existed                  | 404                         |
| A key from another workspace              | 404                         |
| A mobile number of 40 characters          | Refused                     |
| A 3,000-character answer                  | Refused                     |
| A name of `<img src=x onerror=alert(1)>`  | Stored and rendered as text |
| A workspace whose lead module was removed | The link stops working      |

**Evidence** — The branded page (with and without a logo set); both validation messages; the lead attributed to the link; the 404 after switching the link off; the 429; a phone-width screenshot.

---

## PUB-LAND-001 — Landing page with a form

|                     |                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Public / Sales CRM                                                                                                                                                                                          |
| **User Role**       | Public Visitor                                                                                                                                                                                              |
| **Feature**         | Landing pages                                                                                                                                                                                               |
| **Test Scenario**   | A published landing page renders and its form attributes the lead and the conversion to that page                                                                                                           |
| **Priority**        | P1                                                                                                                                                                                                          |
| **Preconditions**   | In `manath-homes`, a landing page exists at **Marketing → Lead Sources → Landing Pages** (`/manath-homes/sales/landing-pages`), is **PUBLISHED**, and has a form attached. Note its slug and the form's key |
| **Navigation Path** | `/l/manath-homes/{pageSlug}`                                                                                                                                                                                |
| **Code Reference**  | `src/app/l/[workspaceSlug]/[pageSlug]/page.tsx`, `src/app/api/v1/public/forms/route.ts` (the `page` parameter), `sales/landing-pages/page.tsx`                                                              |

**Test Steps**

1. As Admin, open **Marketing → Lead Sources → Landing Pages** (the page is titled **Landing Pages**). Confirm the landing page's state is **PUBLISHED** and note which form it carries.
2. Open a private window with no session. Navigate to `/l/manath-homes/{pageSlug}`.
3. Confirm the page renders its own headline and content, and the attached form.
4. Submit the form with fresh test data.
5. In the Admin browser, find the lead.
6. Confirm the lead's source is the workspace's **Website** entry.
7. Confirm the lead is attributed to **this landing page**, and that the page's **conversion** count has increased.
8. Submit the **same form** directly at `/f/manath-homes/{formKey}` (not through the landing page).
9. Confirm that lead is a plain form submission, **not** attributed to the landing page, and that the page's conversion count has **not** increased.
10. Set the landing page back to draft. Reload its URL as the visitor.
11. Submit via the API with a `page` value naming a landing page that the form is **not** attached to.

**Expected Result**

- A landing page carries its own content and a form.
- **A lead filled in on one of the workspace's landing pages is that page's lead, and its conversion. A page the form is not on is a plain form submission.** Steps 7 and 9 are the two halves of that rule.
- Step 10: a draft landing page is not publicly reachable.
- Step 11: not attributed — the attribution requires the landing page to be PUBLISHED **and** to carry that form.

**Negative Scenarios**

| What to try                               | Expected                                 |
| ----------------------------------------- | ---------------------------------------- |
| A page slug that does not exist           | 404                                      |
| A page slug of 100 characters             | Refused (maximum 60)                     |
| A deleted landing page                    | 404                                      |
| A landing page whose form was unpublished | The form must stop accepting submissions |

**Evidence** — The landing page as a visitor sees it; the two leads from steps 4 and 8 side by side with their attribution; the conversion count before and after each.

---

## PUB-RESET-001 — Forgotten password

|                     |                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Public / authentication                                                                                                                                            |
| **User Role**       | Public Visitor (then an existing user)                                                                                                                             |
| **Feature**         | Password reset                                                                                                                                                     |
| **Test Scenario**   | A reset is requested and completed, and the request reveals nothing about whether the account exists                                                               |
| **Priority**        | **P0**                                                                                                                                                             |
| **Preconditions**   | `sales.rep@manathhomes.ae` exists. Mailpit (or the environment's mail catcher) is reachable, so you can read the email                                             |
| **Test Data**       | A known address `sales.rep@manathhomes.ae`; an unknown address `qa.nobody.at.all@example.com`; a new password of at least the workspace's minimum length           |
| **Navigation Path** | `/login` → **Forgot password?** → `/forgot-password` → the email → `/reset-password`                                                                               |
| **Code Reference**  | `src/app/api/v1/auth/forgot-password/route.ts`, `src/app/api/v1/auth/reset-password/route.ts`, `src/app/(auth)/forgot-password/`, `src/app/(auth)/reset-password/` |

**Test Steps**

1. Open `/login` in a private window. Click **Forgot password?**.
2. Confirm you are at `/forgot-password`.
3. Confirm the form asks **only for an email address** — and **no workspace, company or tenant field**.
4. Submit the **unknown** address. **Record the exact response text.**
5. Submit the **known** address. **Record the exact response text.**
6. **Compare the two.** They must be identical, character for character.
7. Open the mail catcher. Confirm an email arrived for the known address and **none** for the unknown one.
8. Note the time. Open the reset link from the email.
9. Confirm you are at `/reset-password` with the token in the URL.
10. Enter a password that is **too short** for the policy. Submit. Read the message.
11. Enter the user's **current** password. Submit. Read the message.
12. Enter a valid new password. Submit.
13. Confirm success and that you can sign in with the **new** password.
14. Confirm the **old** password no longer works.
15. **Confirm every other session for that account has been signed out.** Have the same account signed in in a third browser before step 12, and check it after.
16. Open the **same** reset link again. Submit another password.
17. Request a reset, wait 31 minutes, then use the link.
18. Request a reset for the same address **4 times within an hour**.
19. Request resets for 21 different addresses from one IP within an hour.

**Expected Result**

- Steps 4–6: **the answer is identical whether or not the account exists.** This is the whole point of the screen: a different message would make it an account-enumeration tool. If the two differ in any way — wording, timing that is obviously different, a redirect — that is a **P0 defect**.
- **The form asks for the email only — no tenant slug.** A reset that required the company name would be unusable by the person who has forgotten it.
- The token is stored **hashed**: confirm with the owner that the raw token is not in the database, or at minimum confirm the token in the email does not appear verbatim in any admin screen.
- The token lives **30 minutes**. Step 17 is refused.
- Step 16: a used token is refused — one reset per token.
- Step 10: the policy is checked **twice** — against the default policy before the token is even looked up, and against the workspace's own policy afterwards. Both refusals should be clear.
- Step 11: refused, because a previously used password cannot be reused.
- Step 15: **every session is revoked.** A reset that leaves an attacker's existing session alive defeats the reset.
- Step 18: the 4th request in an hour is **429** (3 / hour per email).
- Step 19: the 21st is **429** (20 / hour per IP).
- **Historical note worth checking deliberately:** an earlier version wrote the new credential to a copy of the user record that the sign-in path never read, so **resets were inert** — the email arrived, the form succeeded, and the old password still worked. Steps 13 and 14 together are the regression test for that. Run both.

**Negative Scenarios**

| What to try                                                                 | Expected                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------- |
| A tampered token (one character changed)                                    | Refused                                         |
| A token from another account                                                | Refused                                         |
| A blank email                                                               | Refused                                         |
| An email of 300 characters                                                  | Refused                                         |
| A reset for a **deactivated** account                                       | The same identical answer, and no working reset |
| A reset for a platform identity                                             | Record the behaviour                            |
| `POST /api/v1/auth/reset-password` with a valid token and a password of `a` | 422, naming the policy                          |

**Evidence** — **The two response texts from steps 4 and 5, side by side.** The email; the old password failing and the new one working; the third browser's session state after the reset; both 429s.

---

## PUB-INVITE-001 — Accept an invitation

|                     |                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Public / authentication                                                                                                                                |
| **User Role**       | Public Visitor (an invited new user)                                                                                                                   |
| **Feature**         | Invitation                                                                                                                                             |
| **Test Scenario**   | An invited person sets their own password and lands in the right workspace                                                                             |
| **Priority**        | P0                                                                                                                                                     |
| **Preconditions**   | As Admin, invite a new user from **Administration → Settings → Users** using **Issue invitation** / **Send invitation**. The mail catcher is reachable |
| **Test Data**       | `qa.invited@example.com`                                                                                                                               |
| **Navigation Path** | the invitation email → `/accept-invite`                                                                                                                |
| **Code Reference**  | `src/app/api/v1/auth/accept-invite/route.ts`, `src/app/(auth)/accept-invite/`, `src/lib/security/ratelimit.ts` (`inviteLookup`)                        |

**Test Steps**

1. As Admin, invite `qa.invited@example.com` with a role of `Employee`.
2. Open the mail catcher and find the invitation.
3. Note the link. Open it in a private window with no session.
4. Confirm the page shows who invited you and which workspace, and asks you to set a password.
5. Confirm the note on `/login` — **Access is by invitation from your workspace administrator.** — is consistent with this flow.
6. Set a password that is too short. Read the message.
7. Set a valid password. Submit.
8. Confirm you are signed in and land in `manath-homes`.
9. Confirm the account's role is `Employee` and its sidebar is correspondingly small.
10. Open the **same** invitation link again.
11. As Admin, issue a second invitation to a different address, then **revoke** it before it is used. Open its link.
12. Issue an invitation and let it expire (or set its expiry in the past). Open its link.
13. Request 31 invitation lookups from one IP within 10 minutes.

**Expected Result**

- The invitation names the workspace and the inviter, so the recipient knows what they are joining.
- The password policy applies.
- Step 10: a used invitation is refused.
- Step 11: a revoked invitation is refused.
- Step 12: an expired invitation is refused, with a message that tells the person to ask for a new one rather than a bare error.
- Step 13: the 31st lookup is **429** (30 / 10 min per IP).
- There is **no public sign-up into an existing workspace**: the only way in is an invitation, or the platform's trial sign-up which creates a **new** workspace.

**Negative Scenarios**

| What to try                                                          | Expected                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A tampered token                                                     | Refused                                                                      |
| A token for an address that already has an account in that workspace | Refused                                                                      |
| Accept the invitation while signed in as someone else                | Record the behaviour; it must not attach the invitation to the wrong account |

**Evidence** — The invitation page; the refusals for used, revoked and expired invitations; the 429.

---

## PUB-2FA-001 — Forced second-factor enrolment

|                     |                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Public / authentication                                                                                                                                                                 |
| **User Role**       | A user whose workspace policy requires MFA                                                                                                                                              |
| **Feature**         | MFA enrolment and recovery codes                                                                                                                                                        |
| **Test Scenario**   | A user required to enrol is taken through it, and recovery codes work once each                                                                                                         |
| **Priority**        | P0                                                                                                                                                                                      |
| **Preconditions**   | As Admin, set the workspace security policy to require a second factor. A test account without MFA exists. An authenticator app, or a TOTP tool                                         |
| **Navigation Path** | `/login` → `/enroll-2fa`; then **Account → Security** (`/manath-homes/profile/security`)                                                                                                |
| **Code Reference**  | `src/app/api/v1/auth/enroll-2fa/route.ts`, `src/lib/auth/mfa.ts`, `src/lib/auth/totp-consume.ts`, `src/app/(auth)/enroll-2fa/`, `src/lib/auth/session.ts` (`MFA_ENROLMENT_TTL_MINUTES`) |

**Test Steps**

1. As Admin, require a second factor in **Administration → Settings → Security Policy**.
2. In a private window, sign in as the test account.
3. Confirm you are taken to `/enroll-2fa` rather than into the workspace.
4. Confirm you cannot skip it: navigate to `/manath-homes/dashboard` and record what happens.
5. Complete the enrolment with an authenticator app.
6. **Record the recovery codes shown.** Confirm they are shown **once**.
7. Confirm you are now in the workspace.
8. Sign out. Sign in again.
9. Confirm the second step appears: heading **Verify it's you**, lede **Enter the 6-digit code from your authenticator app.**, your email with a **Change** button, and a field labelled **Authentication code**.
10. Type the 6 digits. **Confirm the form submits itself on the sixth digit** without a click.
11. Sign out. Sign in again. This time click **Lost your authenticator? Use a recovery code**.
12. Confirm the field becomes **Recovery code**, that typed characters are upper-cased automatically, and that the hint reads **Each saved code works once.**
13. Use one recovery code. Confirm you are signed in.
14. Sign out. Try the **same** recovery code again.
15. Confirm a link back: **Use your authenticator app instead**.
16. Start an enrolment, wait 11 minutes, then complete it.
17. Enter a wrong 6-digit code 11 times within 5 minutes.
18. Open **Account → Security** and confirm MFA is shown as enabled, and that recovery codes can be regenerated.

**Expected Result**

- Enrolment cannot be skipped while the policy requires it: step 4 returns you to `/enroll-2fa`.
- Recovery codes are shown **once**.
- Step 10: the code auto-submits on the sixth digit.
- Step 14: a used recovery code is **refused** — each works once.
- Step 16: the enrolment window is **10 minutes**; an expired enrolment must restart.
- Step 17: the 11th wrong code is **429** (10 / 5 min per user).
- A wrong code does **not** consume the password step: you stay on the second step rather than being sent back to the start.

**Negative Scenarios**

| What to try                                                  | Expected                                     |
| ------------------------------------------------------------ | -------------------------------------------- |
| A code from 10 minutes ago                                   | Refused (TOTP window)                        |
| The **same** valid code twice in a row                       | Refused — a consumed code cannot be replayed |
| A 5-digit code                                               | Refused                                      |
| A recovery code with the wrong case                          | Accepted — the field upper-cases input       |
| Disable MFA on your own account while the policy requires it | Refused                                      |
| An administrator resetting a user's MFA                      | Allowed; confirm it is audited               |

**Evidence** — The enrolment screen; the recovery codes screen (redact the codes); the auto-submit; the refusal of a reused recovery code; both the 10-minute expiry and the 429.

---

## PUB-SIGNUP-001 — Trial sign-up

|                     |                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Public / Platform                                                                                                                                                  |
| **User Role**       | Public Visitor                                                                                                                                                     |
| **Feature**         | Self-serve trial                                                                                                                                                   |
| **Test Scenario**   | A visitor starts a trial, a new workspace is created, and the offer disappears when the platform closes it                                                         |
| **Priority**        | P1                                                                                                                                                                 |
| **Preconditions**   | The platform owner has the sign-up offer **open** with a trial length set (`PLAT-SET-001`)                                                                         |
| **Test Data**       | Company `QA Trial Co`; your name and `qa.trial@example.com`                                                                                                        |
| **Navigation Path** | `/login` → **Start a {n}-day free trial** → `/signup` → `/signup/confirm`                                                                                          |
| **Code Reference**  | `src/app/(auth)/signup/`, `src/app/(auth)/signup/confirm/`, `src/app/api/v1/public/signup/route.ts`, `src/services/platform/signup.ts`, `src/lib/mobile/iosApp.ts` |

**Test Steps**

1. Open `/login` in a private window. Confirm **New here?** and **Start a {n}-day free trial**.
2. Confirm the Lead Eagle door (`/login?product=lead-eagle`) instead offers **Start your Lead Eagle trial**, and that the sign-up form carries a link to the Lead Eagle door.
3. Click through to `/signup`.
4. Complete it with the test data. Note which modules, if any, the trial includes.
5. Submit. Confirm you reach `/signup/confirm` and follow it through.
6. Confirm a workspace was created and you can sign in to it.
7. Confirm its trial start and end dates, and that the end is `{n}` days out.
8. In the platform console, confirm the new workspace appears with a trial subscription.
9. As the platform owner, **close** the sign-up offer.
10. Reload `/login`. Confirm the trial link is gone.
11. Navigate to `/signup` directly. Record what happens.
12. Submit `POST /api/v1/public/signup` directly while the offer is closed.
13. Re-open the offer. Submit 6 sign-ups from one IP within an hour.
14. Sign up with an email that already has an account.

**Expected Result**

- The offer appears **only while the platform owner keeps self-serve sign-up open**, and the trial length comes from the platform setting.
- The offer is **never shown inside the iOS app** (App Store rule 3.1.1). If you cannot run the iOS build, mark that **Needs UI Verification** rather than passing it.
- Step 11: `/signup` while the offer is closed must be refused or redirected. A reachable sign-up with the offer closed is a defect.
- Step 12: refused.
- Step 13: the 6th in an hour is **429** (5 / hour).
- Step 14: refused **without revealing whether the account exists**.
- A trial workspace is a real workspace with a real entitlement and a real expiry.

**Negative Scenarios**

| What to try                                                              | Expected                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A blank company name                                                     | Refused                                                                                  |
| A company name that produces a slug colliding with an existing workspace | Refused, or a unique slug is generated — record which                                    |
| A disposable or invalid email                                            | Refused on format at minimum                                                             |
| A weak password                                                          | Refused against the default policy                                                       |
| The trial after its end date                                             | The workspace's modules stop working; the account can still sign in. Confirm, and record |

**Evidence** — `/login` with the offer open and closed; the created trial workspace in the platform console with its dates; the result of steps 11 and 12; the 429.

---

## PUB-ANON-001 — What an unauthenticated visitor must never reach

|                    |                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Module**         | Public / security                                                                                              |
| **User Role**      | Public Visitor                                                                                                 |
| **Feature**        | Authentication boundary                                                                                        |
| **Test Scenario**  | Every workspace and platform surface requires a session, and the refusal reveals nothing                       |
| **Priority**       | **P0**                                                                                                         |
| **Preconditions**  | A private window with **no session**. You know the slug `manath-homes` and at least one real lead ID           |
| **Code Reference** | `src/lib/api/handler.ts` (`route` vs `bareRoute`, `anonymous`), `src/lib/security/redirect.ts`, `src/proxy.ts` |

**Test Steps**

1. In a window with no session, navigate to each of these and record exactly what happens:

| URL                                          | Expected                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/manath-homes/dashboard`                    | Sent to `/login`                                                                          |
| `/manath-homes/sales/leads`                  | Sent to `/login`                                                                          |
| `/manath-homes/sales/leads/{a real lead id}` | Sent to `/login` — **not** a 404 that confirms the lead exists, and **not** any lead data |
| `/manath-homes/people/payroll`               | Sent to `/login`                                                                          |
| `/manath-homes/admin/users`                  | Sent to `/login`                                                                          |
| `/manath-homes/admin/audit`                  | Sent to `/login`                                                                          |
| `/qa-lead-eagle/lead-eagle/leads`            | Sent to **`/login?product=lead-eagle`**                                                   |
| `/platform`                                  | Refused; **not** `/no-platform-access`, which is for a signed-in identity                 |
| `/platform/workspaces`                       | Refused                                                                                   |
| `/platform/audit`                            | Refused                                                                                   |
| `/manath-homes/check-in`                     | Sent to `/login` — self-service still needs a session                                     |

2. For each of these API endpoints with no session, record the status:

| Endpoint                                      | Expected                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/leads`                           | **401**                                                                                                                                                        |
| `GET /api/v1/leads/{a real id}`               | **401**                                                                                                                                                        |
| `GET /api/v1/calls`                           | 401                                                                                                                                                            |
| `GET /api/v1/workspaces/manath-homes/hr/self` | 401                                                                                                                                                            |
| `POST /api/v1/leads`                          | 401                                                                                                                                                            |
| `GET /api/v1/admin/retention`                 | 401                                                                                                                                                            |
| `GET /api/v1/platform/...`                    | 401                                                                                                                                                            |
| `GET /api/v1/openapi.json`                    | Record — the schema may be public by design                                                                                                                    |
| `GET /api/health`                             | 200 — a health check must not need a session                                                                                                                   |
| `GET /api/health/live`                        | 200                                                                                                                                                            |
| `GET /api/metrics`                            | **Record.** Metrics should not be world-readable in a deployed environment; on a local environment note the behaviour and raise it as a question for the owner |
| `POST /api/v1/public/forms`                   | Works — `anonymous: true` by design                                                                                                                            |
| `POST /api/v1/public/capture`                 | Works                                                                                                                                                          |
| `POST /api/v1/public/share-view`              | Works                                                                                                                                                          |
| `POST /api/v1/auth/login`                     | Works                                                                                                                                                          |
| `POST /api/v1/auth/forgot-password`           | Works                                                                                                                                                          |

3. Submit a `POST /api/v1/leads` with a forged or expired session cookie. Record the status.
4. Submit a `POST /api/v1/leads` from a page on a **different origin** (a simple HTML file on another host that posts to the API). Record the status.
5. Inspect the response headers on any page. Confirm a Content-Security-Policy header is present.
6. View the page source of `/login`. Confirm no lead, user or workspace data is embedded.

**Expected Result**

- Every workspace and platform surface requires a session; a signed-out visitor is **sent to sign in**, and a `/lead-eagle/` path sends them to Lead Eagle's door.
- Every non-public API endpoint returns **401**, not 403 and not 200 with an empty body.
- **An existing record's URL must not behave differently from a non-existent one** to a signed-out visitor. A 404 for a missing lead and a redirect for a real one would be an enumeration oracle.
- Only the handful of endpoints declared `anonymous: true` work without a session — the public intake, share views, and the authentication endpoints.
- Step 4: refused by the origin check in the API kernel.
- A CSP header is present. _(Note: it is a no-nonce policy — confirm it is there, and leave its strength to the security review rather than failing this case on it.)_

**Negative Scenarios**

| What to try                                                         | Expected                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A session cookie from a different workspace's user                  | Only that user's own workspace is reachable                                        |
| An expired session cookie                                           | 401                                                                                |
| A session cookie with its signature altered                         | 401                                                                                |
| `GET /api/v1/leads` with an `Authorization: Bearer <guessed key>`   | 401                                                                                |
| A request with `X-Forwarded-For` spoofed, to dodge an IP rate limit | The limit still applies. Record the behaviour — a bypassable IP limit is a finding |

**Evidence** — The two tables filled in with what actually happened and the status codes. This case's deliverable is those tables, and it is the single most important page in [Section 7](07-tenancy-authz.md)'s evidence pack.

---

## PUB-STATIC-001 — Privacy, support and the front page

|                     |                                                                            |
| ------------------- | -------------------------------------------------------------------------- |
| **Module**          | Public                                                                     |
| **User Role**       | Public Visitor                                                             |
| **Feature**         | Static public pages                                                        |
| **Test Scenario**   | The front page, privacy policy and support page render without a session   |
| **Priority**        | P2                                                                         |
| **Preconditions**   | None                                                                       |
| **Navigation Path** | `/`, `/privacy`, `/support`                                                |
| **Code Reference**  | `src/app/page.tsx`, `src/app/privacy/page.tsx`, `src/app/support/page.tsx` |

**Test Steps**

1. Open `/` with no session. Confirm it renders and offers a route to sign in.
2. Open `/privacy`. Confirm the policy renders.
3. Open `/support`. Confirm it renders and says how to get help.
4. Confirm none of the three embeds customer data.
5. Open each at phone width (about 390 px). Confirm nothing scrolls sideways.
6. Open `/no-platform-access` with no session. Record what happens.

**Expected Result**

- All three render for anyone.
- No customer data appears on any of them.
- They are usable at phone width.
- `/no-platform-access` is meant for a **signed-in** identity with no platform grant; with no session, record what it does and raise anything confusing as a usability finding rather than a defect.

**Negative Scenarios** — None beyond the above. Record any broken link or missing content.

**Evidence** — Screenshots at desktop and phone width.
