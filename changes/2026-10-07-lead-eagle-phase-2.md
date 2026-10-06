# Lead Eagle, phase 2: leads from the portals and Google Ads; several numbers per lead

**What.** Gaps 1 and 2 of the [plan](2026-10-05-lead-eagle-plan.md), PR #130.
A workspace connects Property Finder, Bayut, Dubizzle or Google Ads lead forms
on Admin → Integrations, under the new **Lead sources** group, and each
enquiry becomes a lead, or a fresh enquiry on the lead that already holds the
person's number or email. A lead keeps several phone numbers, each with a
WhatsApp flag, and duplicate matching reads all of them.

**Why.** The owner's phase-1 decisions (5 Oct): all three sources first, and
the standalone Lead Eagle's multi-phone leads need somewhere to land (phase 5).

**Where** (under `apps/web/`)
- `src/app/api/v1/webhooks/leads/[key]/route.ts` — the receiver: rate limit, connection by `webhookKey`, verify, store the raw body once in `WebhookEvent`, queue.
- `src/lib/integrations/leadSources.ts` — the four sources, signature checks, the payload parser (ported from Lead Eagle's adapters).
- `src/services/leads/intake.ts` — the `webhook` job `lead-source.enquiry`: attach or create.
- `src/lib/integrations/registry.ts` — the `LEADS` providers; `webhook` now names its receiver.
- `prisma/migrations/20261007000000_lead_phones` — `LeadPhone` (raw, normalised, label, WhatsApp), RLS-forced.
- `src/services/leads/findDuplicates.ts` — phone rules match the main number and every `LeadPhone`.
- `src/app/api/v1/leads/[id]/phones/route.ts`, lead detail `OverviewTab` — add and remove numbers.

**Behaviour**
- Portals sign each delivery: HMAC-SHA256 of the exact body with the shared
  secret, hex, in `x-signature` or `x-hub-signature-256`, `sha256=` optional.
  Google cannot sign; it echoes the key typed into Google Ads as `google_key`.
  Unknown key, disconnected source and bad signature all answer 401.
- Idempotent: the sender's `Idempotency-Key`, else its lead id, else the body's
  hash. A retry answers 200 and makes nothing. A queue outage answers 503, so
  the sender retries and the retry re-queues the stored delivery.
- New person: a lead with source Marketplace (portals) or Ad lead form
  (Google), `sourceDetail` `property_finder:<listing ref>` or
  `google_ads:<form id>`, implied consent, the default stage, the first-contact
  SLA, distribution and automations, and an "Enquiry via …" note on the
  timeline with purpose, type, area, budget and the message.
- Known number or email (never a name alone): no new lead. The note goes on the
  existing lead's timeline, new numbers are added to it, and its owner gets a
  high-priority bell ("… enquired again").
- Google's "Send test data" (`is_test`) is accepted and stored, never a lead.
- The parser never takes the listing agent for the client: contact fields under
  `agent`, `listing`, `property`, `user` and similar are read only with their
  prefix.
- Lead detail → Overview: **Other numbers**, each with a call link and, when
  flagged, a WhatsApp link; editors add and remove them. Hidden whenever the
  viewer's role may not see the main number.
- Fixed on the way: editing a lead's phone left `phoneNormalized` behind, so
  duplicate matching kept matching the old number; the WhatsApp button used the
  number as typed, which wa.me refuses in local form; the Integrations board
  showed WhatsApp Business the telephony callback URL instead of Meta's.

**Verified.** `tests/sales/lead-source-intake.spec.ts` (10, real receiver,
worker job and database): a signed Property Finder enquiry becomes a lead with
both numbers and its timeline note; a retry makes nothing; a wrong or missing
signature stores nothing; a repeat from the second number attaches and rings the
owner; Google's key and its test lead; unknown and disconnected keys; matching
on another number; an edited phone re-normalised (fails on the old
`updateLead`); add, refuse and remove numbers, and a role barred from the phone
field refused — that case failed on the first version of the route, which read
the field rules through the global client inside `withTx`.
`tests/unit/lead-sources.spec.ts` (6): signatures, Google's key, the agent never
taken for the client. Full suite 3443 passed (2 seed-dependent skips, as
before); schema drift, RLS, raw-SQL scope, permission catalogue and
observability gates pass. In a browser on the rig, desktop and 390 px: the Lead
sources group and its callback URL; a signed delivery through the running worker
made the lead from the client, not the listing agent; Other numbers with a
WhatsApp link, add, main-number refusal, remove; the timeline note; the repeat
enquiry attached; no sideways scroll, no page errors.

**Left open**
- Each portal's real payload and signature header arrive with its partner
  agreement; the first live delivery should be checked against the parser
  (the raw body is kept, so a replay recovers anything misread). Bayut and
  Dubizzle also offer a pull API; not built until their documentation is in hand.
- Enquiries do not yet create a `ClientRequirement` (purpose, type, budget);
  they are on the timeline as text.
- The main number has no WhatsApp flag; its WhatsApp button shows as before.
