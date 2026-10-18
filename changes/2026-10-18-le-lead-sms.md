# Send an SMS from the lead, through the workspace's Twilio

**What.** The lead page's Message card has **Send SMS**: a small composer with a
character and SMS-part counter that texts the lead through the workspace's
Twilio connection (the one that places its calls), from the **SMS sender** set
on the Twilio card under Administration → Integrations. Every send, and every
failure, is an SMS on the lead's timeline. PR —.

**Why.** Audit row M4-29 ("Send an SMS from the lead", High), not built
anywhere. Built on the owner's approval of 18 Oct; like Google Calendar, it is
off until the owner's side exists (a Twilio account with SMS and a sender).

**Where.**

- `src/lib/integrations/telephony/types.ts`, `twilio.ts`, `index.ts` — the `SMS` capability and `sendSms` (Twilio's Messages API, basic auth with the account SID and token; not retried); the development mock texts nobody; `sendsSms(vendor)`.
- `src/lib/integrations/telephony/resolve.ts` — `smsSetup` (is it set up, else why) and `resolveSms`: the default calling vendor, connected, sending SMS, with a valid sender.
- `src/lib/integrations/registry.ts` — the SMS sender setting, on a vendor with the SMS capability only (Twilio).
- `src/services/leads/leadSms.ts` — `smsRecipientOf`, `smsBlock` (the page) and `sendLeadSms`.
- `src/app/api/v1/leads/[id]/sms/route.ts` — `POST { body }`, 1–640 characters.
- `src/lib/sms.ts` — the part count; `sales/leads/[id]/SmsDialog.tsx`, `MessageCard.tsx`, `page.tsx` — the button and composer.
- `prisma/seed/index.ts` — the development mock connection gets a sender.

**Behaviour.** Permissioned as Send WhatsApp: `communications:CREATE` in a lead
module, on a lead the sender's `leads:EDIT` reaches (404 outside it), 20 sends
per person per 5 minutes (the counter `communications:CREATE` shares). The text
goes to the lead's main number, else its first other number. Refused with the
reason (422) for a lead with no number, one that opted out of SMS (`smsOptOut`)
or withdrew consent, or one on the do-not-call list (`doNotCall`); 403 with the
reason while SMS is not set up (no calling provider that texts, not connected,
no sender, or a sender that is neither an E.164 number nor 1–11 letters and
digits). The page shows the same reason under a disabled Send SMS. The message
is written (QUEUED) and audited (`MESSAGE_SENT`, channel SMS) before Twilio is
asked, then marked SENT with Twilio's message id, or FAILED with Twilio's code
and reason, numbers taken out of the reason (the sender may read them masked).
The answer never carries the number. The mock sends nothing and is refused in
production, as mock telephony is.

**Verified.** `tests/sales/lead-sms.spec.ts` (8, `fetch` stubbed): sends and
logs (the exact Messages API request, the Communication, the audit row, the
timeline); a Twilio refusal and an immediate `failed` logged as FAILED; 404 out
of scope and for a reader, 403 without the permission, 422 empty or too long;
no number, opted out, withdrawn, do-not-call (route and page); another number;
not set up four ways; the Twilio card's setting; the mock in development and
refused in production. `tests/unit/sms-parts.spec.ts` (3).
`tests/sales/lead-send.spec.ts` updated for the page's new `smsBlocked`.
`public/openapi.json` regenerated; mutation-audit lists the route as audited by
`leadSms.ts`. No browser check: no dev server on the shared rig.

**Left open.**

- Owner: a Twilio account able to send SMS to the UAE, connected as the calling provider, and a sender on its card (a UAE-registered alphanumeric sender ID, or a Twilio number).
- Delivery receipts (Twilio's status callback) are not wired: a text reads Sent once Twilio accepts it.
- No inbound SMS, no SMS templates, no bulk SMS from the grid; Plivo and Exotel do not text from here.
