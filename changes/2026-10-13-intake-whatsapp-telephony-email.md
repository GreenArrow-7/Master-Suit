# A new WhatsApp number or an unknown caller becomes a lead; the portals' lead emails come in through Portal emails

**What.** Three more ways a lead arrives, all through the intake the portals
and forms use (`takeEnquiry`: the number normalised, a known number or email
joins its lead, audited, the first-contact clock, distribution, automations).
Audit rows M6-10, M6-11, M6-12. Branch `feat/intake-whatsapp-telephony-email`,
stacked on #173.

- **WhatsApp** (M6-10): a message from a number no lead holds makes a lead,
  the message its note, when the WhatsApp Business connection's _Create leads
  from new numbers_ is on: on by default in a Lead Eagle workspace, off
  elsewhere (a new number opens a conversation only, as before).
- **Calls** (M6-11): an inbound call, answered or missed, from a number no lead
  or contact holds makes a lead with source _Telephony_ and the call on it,
  when the telephony connection's _Create leads from unknown callers_ is on
  (on by default in every lead workspace).
- **Portal emails** (M6-12): a new lead source. The workspace's mail service
  posts each email it receives, signed like a Custom webhook; a Property
  Finder, Bayut or dubizzle lead email becomes that portal's lead, and any
  other email is kept, unread, on Deliveries.

**Why.** The Lead Eagle gap audit of 11 Oct: a WhatsApp message from a new
number opened a thread no Lead Eagle screen shows; an unknown caller was
recorded against the most senior user and became nobody's lead; and the
owner's email fallback for portals without a partner feed (23 Sep) was never
built in YOUHAN ONE. The owner's brief of 12 Oct, M6 third part, with the
defaults below accepted.

**Where** (under `apps/web/`)

- `src/lib/integrations/leadSources.ts`: `inbound_email` (_Portal emails_) joins `LEAD_SOURCES`; `parsePortalEmail` (ported from the standalone's `EMAIL_PARSER`) names the portal from the sender, else the subject, else the body (the earliest mention), reads the body's `Label: value` lines, or an HTML table's label and value cells, through `parseEnquiry` and the source's field map, takes a `Ref:` in the subject when the body has none, and is null for an email no portal sent or one with no phone or email; `emailIdOf` is the email's `messageId`.
- `src/app/api/v1/webhooks/leads/[key]/route.ts`: an email's `messageId` is its delivery id (after `Idempotency-Key`, before the body hash).
- `src/services/leads/intake.ts`: `applyEnquiry` reads a Portal emails delivery with `parsePortalEmail` (`skipped: 'unparsed'` when it is null) and gives the lead the portal's source, `sourceDetail` and catalogue entry, noted _Enquiry via Bayut email_; `capturesUnknown(tenantId, setting, metadata)` decides both switches.
- `src/services/meta/applyEvent.ts`: an inbound WhatsApp message from a number no lead holds goes through `takeEnquiry` when `capturesUnknown` says so (source `CHAT`, detail `whatsapp`, the profile name, else _WhatsApp contact_), and the conversation and message are on the lead. The sender's WhatsApp id is read as `+<id>`.
- `src/app/api/v1/webhooks/telephony/[key]/route.ts`: `createInboundCall` creates the call, then, for a number no lead (main number) or contact holds, takes the enquiry (_Unknown caller_, source `TELEPHONY`, detail `<vendor>:<number dialled>`) and puts the call on the lead it made or joined; a lead found by a second number gives the call its owner. A failure there is logged and the call goes on.
- `src/lib/integrations/registry.ts`: `SettingField.toggle`; `createLeadsFromNewNumbers` on WhatsApp Business, `createLeadsFromUnknownCallers` on each telephony vendor; the Portal emails entry (`issuesSecret`, no credential fields).
- `src/app/api/v1/integrations/[provider]/route.ts`: PUT refuses a switch that is not `true` or `false` (422).
- `src/app/(workspace)/[workspaceSlug]/admin/integrations/page.tsx`, `src/components/workspace/IntegrationBoard.tsx`, `src/app/api/v1/integrations/route.ts`: a switch is a checkbox in the card's form and a line on its face (_Create leads from new numbers: on_), showing the saved value or its default; hidden in a workspace with no lead product. The page's card list is re-indented inside a `Promise.all`; `git diff -w` shows the real lines.
- `src/services/leads/deliveries.ts`, `admin/lead-sources/[provider]/page.tsx`: the `unparsed` outcome, shown _Not read: unknown email_. `src/lib/nav/workspaceNav.ts`: the Portal emails page sits under Integrations.
- `docs/03-API.md` §6: the Portal emails contract.
- Tests: `tests/sales/whatsapp-unknown-number.spec.ts`, `tests/sales/telephony-unknown-caller.spec.ts`, `tests/sales/inbound-email.spec.ts` with synthetic portal emails in `tests/helpers/portalEmails.ts`, `tests/e2e/intake-capture.spec.ts`; `meta-apply-event.spec.ts` (the switch mocked off) and `telephony-webhook-flow.spec.ts` (an unknown caller now has a lead) follow the change.

**Behaviour**

- Admin → Integrations: _WhatsApp Business_ reads _Create leads from new
  numbers: on_ (Lead Eagle) or _off_ (Sales, Real Estate); each telephony
  vendor reads _Create leads from unknown callers: on_. **Configure** (or
  **Connect**) shows the switch as a checkbox, saved with **Save and verify**.
  A workspace with no lead product shows neither.
- A WhatsApp message from a new number, switch on: a lead named by the
  sender's WhatsApp profile name (or _WhatsApp contact_), the number in full
  international form, source _Chat_ with detail `whatsapp`, implied consent,
  a note _Enquiry via WhatsApp_ with the message, an audit row, then
  distribution. The conversation and the message are on the lead; the next
  message from that number joins it without another note. Switch off: a
  conversation only, as before.
- An inbound or missed call from a number no lead or contact holds, switch
  on: a lead _Unknown caller_ with source _Telephony_, detail
  `<vendor>:<number dialled>` (e.g. `twilio:+97144000000`), a note _Enquiry
  via Telephony_, an audit row, then distribution; the call is on it, still
  recorded against the most senior user until someone takes the lead. A lead
  holding the number as a second number gets the call instead (its owner as
  the call's, and _… enquired again_ to them). The next call from the number
  is on the same lead. Switch off: the call as before, no lead.
- Lead sources → _Portal emails_: **Connect** issues a signing secret, shown
  once, and the URL the mail service posts to. A Property Finder, Bayut or
  dubizzle lead email: a lead with source _Marketplace_, detail
  `property_finder:<reference>` (or `bayut:`, `dubizzle:`), that portal's
  catalogue entry, and a note _Enquiry via Property Finder email_ with the
  reference and the client's message; a known number or email joins its lead.
  The same `messageId` twice makes one lead. Anything else (a newsletter, a
  portal's "listing approved") is listed on Deliveries as _Not read: unknown
  email_; a label the parser does not know is named on Field mapping and the
  delivery replayed.

**Decisions taken**

The brief's defaults, accepted by the owner:

- M6-10: an unknown WhatsApp number creates a lead through `takeEnquiry` when
  the connection's _Create leads from new numbers_ is on, on by default for
  Lead Eagle.
- M6-11: an unknown inbound or missed caller becomes a lead through
  `takeEnquiry` (source Telephony, detail vendor:number), distributed, opt-in
  per telephony connection, on by default.
- M6-12: the standalone's portal-email parser is a lead-source kind fed by a
  signed, provider-neutral inbound-mail POST; the mailbox or forwarding
  service is the owner's to supply.

Taken while building (design choices, not owner decisions):

- WhatsApp leads carry `CHAT`: `RecordSource` has no `WHATSAPP`, and `CHAT` is
  its value for a conversation channel; no migration. Telephony uses the
  existing `TELEPHONY`; portal emails the portal's own `MARKETPLACE` and key, so
  the source reports count an emailed Bayut lead with Bayut's.
- WhatsApp stays off by default outside Lead Eagle, as the brief allows: until
  now a new number there never made a lead. Callers are on by default in every
  lead workspace, as the row says.
- The lead's name is the WhatsApp profile name or _WhatsApp contact_, and
  _Unknown caller_ for a call, never the number: a role that sees numbers
  masked (#158) would read it in the name.
- The detail of a call lead is the number the caller dialled, which tells one
  advertised line from another; the caller's own number is the lead's phone.
- The call is created before the lead, so two first callbacks racing for one
  call make one lead: the second fails on the call's unique key, as it did
  before, before it reaches the intake. The call stays recorded against the
  most senior user when the lead is new: distribution runs after, on the queue.
- An email is a portal's when its sender, else subject, else body names the
  portal first; an email no portal sent is never a lead, even with labelled
  fields, and neither is a portal email with no phone or email. The
  Deliveries row says _Not read: unknown email_ and shows nothing of the email
  (it may name a client to a viewer without leads access).
- Settings are switches in the existing Configure form, saved by **Save and
  verify**, not a separate control: one save path, and the PUT already took
  booleans.
- A WhatsApp id is read as `+<id>`: read bare, a number from abroad was given
  the UAE code, so it matched nobody.

**Verified.** Against the base (`origin/feat/intake-webhook-mapping-deliveries`,
776dc04a, this branch's `src/` stashed) the three new specs and the two
touched ones fail 21 cases and pass 36: Portal emails is not a provider (PUT
404, every delivery 401), a new WhatsApp number makes no lead ("expected
undefined to match object { fullName: 'Layla Hassan' … }") and the meta card
has no switch, an unknown caller makes no lead ("expected undefined to match
object { fullName: 'Unknown caller' … }"), a second number's call is not on its
lead, and both switches are refused as unknown fields (422). The guards pass on
both: a wrong signature is 401, a switch off or a workspace without a lead
product makes no lead, a word for a switch is 422, and the Meta worker's unit
cases.

Runs on the rig (its own database, 105 migrations):

- The new and touched specs with `workspace-nav`, `lead-source-intake`,
  `custom-webhook`, `deliveries`, `field-map`, `lead-eagle-routes` and
  `module-entitlement`: 12 files, 595/595.
- `tests/` permission, sales, tenant, unit, integration and security: 226
  files, 3489 passed, 222 skipped, 3 failed; 24 files failed under load (34
  "Unable to start a transaction in the given time", 11 hooks timed out at
  60 s). Those 23 files alone: 256/256. The retention specs one at a time:
  `document-purge` 1/1, `retention` 5/5, `audit-retention` 7/7.
- `tsc --noEmit` clean; eslint and prettier clean on the touched files.
- E2E with the worker running: `intake-capture.spec.ts` 2/2 and
  `lead-source-deliveries.spec.ts` 2/2. On a fresh `.next` the first run of
  `intake-capture` failed waiting 20 s for the Deliveries heading while the
  page was still compiling (a loading skeleton in the screenshot); it passed on
  the warm server. Screenshots checked: the WhatsApp Business switch on by
  default and a Knowlarity switch saved off, at 390 px dark; Deliveries with
  _Lead created_ (linked to the lead) and _Not read: unknown email_, on a
  desktop and at 390 px dark, with no sideways scroll.

**Left open**

- The mail service that posts to Portal emails is the owner's to supply (an
  inbound-mail provider or a forwarding rule on the agency's portal mailbox);
  none was created. No real portal email has been seen: the parser was tested
  on synthetic emails laid out like the portals' notifications.
- The agent distribution assigns a new lead to is not told (PROP-02b: no bell
  or push on an automatic assignment); a lead joined by a known number tells
  its owner as before.
- A call lead's call stays on the most senior user after distribution assigns
  the lead, so it shows on the lead, not in the agent's own call list.
- A telephony lead is matched by the lead's main number before the intake
  runs; a number held only as a second number reaches its lead through the
  intake, with an _Enquiry via Telephony_ note on each such call.
- Reconnecting Facebook through Meta's sign-in rewrites the connection's
  settings, so a WhatsApp switch turned off returns to its default.
- Two first messages from one new WhatsApp number handled at the same moment
  can make two leads, as two portal deliveries for one new person already can.
- No catalogue entry by default for WhatsApp or Telephony leads: they land on
  one once an administrator adds _WhatsApp_ (key `whatsapp`) or _Telephony_
  (key `telephony`) under Sources, as a Custom webhook's do.
