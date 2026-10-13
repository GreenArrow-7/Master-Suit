# A new WhatsApp number or an unknown caller becomes a lead; the portals' lead emails come in through Portal emails

**What.** Three more ways a lead arrives, all through the intake the portals
and forms use (`takeEnquiry`: the number normalised, a known number or email
joins its lead, audited, the first-contact clock, distribution, automations).
Audit rows M6-10, M6-11, M6-12. Branch `feat/intake-whatsapp-telephony-email`,
stacked on #173.

- **WhatsApp** (M6-10): a message from a number no lead, contact or colleague
  holds makes a lead, the message its note, when the WhatsApp Business
  connection's _Create leads from new numbers_ is on: on by default in a Lead
  Eagle workspace, off elsewhere (a new number opens a conversation only, as
  before).
- **Calls** (M6-11): an inbound call, answered or missed, from a number no
  lead, contact or colleague holds makes a lead with source _Telephony_ and the
  call on it, when the telephony connection's _Create leads from unknown
  callers_ is on (on by default in every lead workspace). A call from a lead's
  second number now lands on that lead, as one from its main number does.
- **Portal emails** (M6-12): a new lead source. The workspace's mail service
  posts each email it receives, signed like a Custom webhook; a Property
  Finder, Bayut or dubizzle lead email becomes that portal's lead, and any
  other email is kept, unread, on Deliveries.
- **Distribution tells the agent.** An automatic assignment now raises the
  same _Lead assigned_ bell and push a reassignment by hand does, so the agent
  a new caller, WhatsApp number or email (or any other distributed lead) goes
  to hears of it.

**Why.** The Lead Eagle gap audit of 11 Oct: a WhatsApp message from a new
number opened a thread no Lead Eagle screen shows; an unknown caller was
recorded against the most senior user and nobody was told; and the owner's
email fallback for portals without a partner feed (23 Sep) was never built in
YOUHAN ONE. The owner's brief of 12 Oct, M6 third part.

**Where** (under `apps/web/`)

- `src/lib/integrations/leadSources.ts`: `inbound_email` (_Portal emails_) joins `LEAD_SOURCES`. `parsePortalEmail` (ported from the standalone's `EMAIL_PARSER`) names the portal from the sender, else the sender a forwarded email quotes, else the subject (never the body alone); reads the text part, else the HTML one (whitespace collapsed first, cells split by a tab, rows by a line); reads a forwarded email from its quoted header down; skips name, phone and email lines in an agent's, broker's or owner's block; keeps one number (the first under a client label, else the first in the email); reads the `Label: value` lines through `parseEnquiry` and the source's field map; takes a `Ref:` in the subject when the body has none. Every pass is linear (no lazy-then-anchor patterns, a one-pass `<style>`/`<script>`/`<head>` strip, the subject cut at 998 characters). `PHONE_KEYS` is shared with `parseEnquiry`.
- `src/app/api/v1/webhooks/leads/[key]/route.ts`: an email's `messageId` is its delivery id, ahead of `Idempotency-Key`.
- `src/services/leads/intake.ts`: `applyEnquiry` reads a Portal emails delivery with `parsePortalEmail` (`skipped: 'unparsed'` when it is null) and gives the lead the portal's source, `sourceDetail` and catalogue entry, noted _Enquiry via Bayut email_; `capturesUnknown` decides both switches; `withSwitches` lists them for Integrations (page and API); `heldInWorkspace` is a contact's or a colleague's number; `EnquiryOrigin.consent` (default `IMPLIED`).
- `src/services/meta/applyEvent.ts`: an inbound WhatsApp message from a number no lead, contact or colleague holds goes through `takeEnquiry` when `capturesUnknown` says so (source `CHAT`, detail `whatsapp`, consent `UNKNOWN`, the profile name, else _WhatsApp contact_); the conversation and message are on the lead. An intake failure is logged and the message is stored all the same. The sender's WhatsApp id is read as `+<id>`.
- `src/app/api/v1/webhooks/telephony/[key]/route.ts`: `createInboundCall` matches a lead by any of its numbers; Twilio's withheld-caller stand-ins (`+266696687`, `+86282452253`, `+7378742833`, `+2562533`) are no number; for a number no lead, contact or colleague holds it takes the enquiry (_Unknown caller_, source `TELEPHONY`, detail `<vendor>:<line>`, consent `UNKNOWN`) and puts the call on the lead. A failure there is logged and the call goes on.
- `src/services/distribution/assignLead.ts`: an automatic assignment raises `lead.assigned` through `notifyCrm` after the commit; `src/services/crm/notify.ts` takes only the tenant and actor id it uses.
- `src/app/api/v1/integrations/[provider]/route.ts`: PUT refuses a switch that is not `true` or `false` (422); a save that changes only switches on an existing connection updates its settings and nothing else (no vendor check, status kept).
- `src/app/api/v1/integrations/meta/callback/route.ts`: reconnecting Facebook keeps the connection's stored settings under the new Page's.
- `src/lib/integrations/registry.ts`: `SettingField.toggle`; `createLeadsFromNewNumbers` on WhatsApp Business, `createLeadsFromUnknownCallers` on each telephony vendor; the Portal emails entry (`issuesSecret`, no credential fields).
- `src/app/(workspace)/[workspaceSlug]/admin/integrations/page.tsx`, `src/components/workspace/IntegrationBoard.tsx`, `src/app/api/v1/integrations/route.ts`: a switch is a checkbox in the card's form and a line on its face (_Create leads from new numbers: on_), showing the saved value or its default; neither the page nor the API lists it in a workspace with no lead product.
- `src/services/leads/deliveries.ts`, `admin/lead-sources/[provider]/page.tsx`: the `unparsed` outcome, shown _Not read: unknown email_. `src/lib/nav/workspaceNav.ts`: the Portal emails page sits under Integrations.
- `docs/03-API.md` §6: the Portal emails contract.
- Tests: `tests/sales/whatsapp-unknown-number.spec.ts`, `tests/sales/telephony-unknown-caller.spec.ts`, `tests/sales/inbound-email.spec.ts` and `tests/unit/portal-email.spec.ts` with synthetic portal emails in `tests/helpers/portalEmails.ts`, `tests/e2e/intake-capture.spec.ts`; `meta-apply-event.spec.ts` (the intake mocked off) and `telephony-webhook-flow.spec.ts` (an unknown caller now has a lead) follow the change.

**Behaviour**

- Admin → Integrations: _WhatsApp Business_ reads _Create leads from new
  numbers: on_ (Lead Eagle) or _off_ (Sales, Real Estate); each telephony
  vendor reads _Create leads from unknown callers: on_. **Configure** (or
  **Connect**) shows the switch as a checkbox, saved with **Save and verify**;
  a save that only flips a switch checks nothing with the vendor and leaves
  the connection's status as it was (_Saved. The connection was not
  re-checked._). A workspace with no lead product shows neither switch.
- A WhatsApp message from a new number, switch on: a lead named by the
  sender's WhatsApp profile name (or _WhatsApp contact_), the number in full
  international form, source _Chat_ with detail `whatsapp`, consent
  _Unknown_, a note _Enquiry via WhatsApp_ with the message, an audit row,
  then distribution, the first-contact clock and the workspace's _record
  created_ automations. The conversation and the message are on the lead; the
  next message from that number joins it without another note. A number a
  contact or a colleague holds, or switch off: a conversation only, as before.
- An inbound or missed call from a number no lead, contact or colleague
  holds, switch on: a lead _Unknown caller_ with source _Telephony_, detail
  `<vendor>:<line>` (the connection's _Caller number_, else the number
  dialled, e.g. `twilio:+97144000000`), consent _Unknown_, a note _Enquiry via
  Telephony_, an audit row, then distribution, the clock and automations; the
  call is on it, recorded against the most senior user until distribution
  gives the lead to an agent, who is told. A call from a number a lead holds
  as its main or a second number is on that lead, owned by its owner, with
  nothing written. A withheld number (Twilio's stand-ins, or none) is no
  number: the call is recorded, no lead. Switch off: the call as before.
- Distribution: the agent an automatic assignment picks gets _Lead assigned:
  <name>_ in the bell and as a push, HIGH priority, linked to the lead.
- Lead sources → _Portal emails_: **Connect** issues a signing secret, shown
  once, and the URL the mail service posts to. A Property Finder, Bayut or
  dubizzle lead email: a lead with source _Marketplace_, detail
  `property_finder:<reference>` (or `bayut:`, `dubizzle:`), that portal's
  catalogue entry, implied consent, and a note _Enquiry via Property Finder
  email_ with the reference and the client's message; a known number or email
  joins its lead. One `messageId` makes one delivery, under any number of
  keys. Anything else (a newsletter, a portal's "listing approved", a portal
  named only in the body) is listed on Deliveries as _Not read: unknown
  email_; a label the parser does not know is named on Field mapping and the
  delivery replayed.

**Decisions taken**

The owner's DECISION default (the brief marks only this row so):

- M6-10: an unknown WhatsApp number creates a lead through `takeEnquiry` when
  the connection's _Create leads from new numbers_ is on, on by default for
  Lead Eagle.

M6-11 (an unknown caller becomes a distributed lead, per-connection switch,
on by default) and M6-12 (the standalone's parser as a signed,
provider-neutral lead-source kind) are the rows as written, built as they
say. Everything below is a design choice made while building, not an owner
decision:

- WhatsApp leads carry `CHAT`: `RecordSource` has no `WHATSAPP`, and `CHAT` is
  its value for a conversation channel; no migration. Telephony uses the
  existing `TELEPHONY`; portal emails the portal's own `MARKETPLACE` and key, so
  the source reports count an emailed Bayut lead with Bayut's.
- WhatsApp stays off by default outside Lead Eagle: until now a new number
  there never made a lead. Callers are on by default in every lead workspace,
  as the row says.
- A caller or a new WhatsApp number gets consent _Unknown_, not _Implied_:
  ringing or messaging is not asking for marketing, and campaigns send only to
  _Granted_ or _Implied_. Agents can still call and message them back. A
  portal email keeps _Implied_, like every portal enquiry.
- A number a contact or a colleague (a workspace user's own phone) holds is
  never captured: a customer on the books, or staff ringing in.
- The lead's name is the WhatsApp profile name or _WhatsApp contact_, and
  _Unknown caller_ for a call, never the number: a role that sees numbers
  masked (#158) would read it in the name.
- The detail of a call lead is the connection's own _Caller number_ (the line
  it advertises), else the number dialled: a vendor's `to` may be the agent
  the call was put through to (Knowlarity's `destination`).
- Twilio's four withheld-caller numbers are treated as no number; other
  vendors send no number or a word for a withheld caller, which normalises to
  none.
- The call is created before the lead, so two first callbacks racing for one
  call make one lead.
- Automatic assignment notifies through `notifyCrm` (`lead.assigned`, already
  a pushed event) after the assignment commits; a notification failure is
  logged and never undoes the assignment.
- An email is a portal's when its sender, else the sender a forwarded email
  quotes, else its subject names the portal; never on a mention in the body. A
  forwarded email is read from its quoted header (a run of `From:` …
  `Subject:` lines) down. An email gives one client number. A portal email with
  no phone or email is unread too. The Deliveries row shows nothing of the
  email (it may name a client to a viewer without leads access).
- The email's `messageId` comes before `Idempotency-Key`: one email posted
  twice under two keys is one email.
- A switch is saved through the existing Configure form; the PUT itself knows
  a switch-only save and skips the vendor check, so there is one save path.
- A WhatsApp id is read as `+<id>`: read bare, a number from abroad was given
  the UAE code, so it matched nobody.

**Verified.** The first build was shown failing on its base
(`origin/feat/intake-webhook-mapping-deliveries` at 776dc04a, this branch's
`src/` stashed): 21 cases failed, 36 guards passed. Review then raised the
cases below; this branch first took in the base's #172 merge (7b9b4ed4), and
the review fixes were written test-first against that. With `src/` at the
merge commit (910954fb) the new and changed cases fail, 23 of them, each for
the reason it names: a forwarded email's signature taken for the client (no
lead for the client's number), the listing agent's number and a second number
kept ("expected [ '055 000 3302', '04 000 9900' ] to deeply equal [ '055 000
3302' ]"), a pretty-printed or stub-text HTML email losing the name or the
whole lead, a body-only mention making a Bayut lead, a hostile 256 KB body
taking 87.7 s, one email under two keys making two deliveries and a second
note, a second-number call writing two notes and two bells, a withheld,
colleague's or contact's number becoming a lead, consent _Implied_ on a call
or a message, no _Lead assigned_ bell after distribution, a switch-only save
calling the vendor, a Meta reconnect dropping the switch, the integrations API
listing a switch raw or in an HR-only workspace, and a WhatsApp intake failure
losing the message ("tenant has no default lead stage"). 45 guards pass on
both.

Runs on the rig (its own database, 107 migrations):

- The new and touched specs with the specs of every module they share
  (`lead-source-intake`, `custom-webhook`, `field-map`, `lead-requirement`,
  `lead-scoring`, `custom-fields`, `forms-lead-eagle`, `lead-audit-trail`, the
  triage and assignment specs, `meta-oauth`, `crm-notifications`,
  `notification-feed`, `credential-purge`, `telephony-vendors`,
  `guarded-prologue`, `p2-regressions`, `module-entitlement`, `workspace-nav`,
  `lead-eagle-routes`): 29 files, 840/840.
- `tests/` permission, sales, tenant, unit, integration and security: 232
  files, 3767 passed, 34 skipped, 2 failed, 6 files failed, all under load (22
  "Unable to start a transaction in the given time", 2 hooks timed out at
  60 s). Those 6 files alone: 71/71.
- `tsc --noEmit` clean; eslint and prettier clean on the touched files.
- E2E on a fresh `.next` with the worker running: `intake-capture.spec.ts`
  2/2 and `lead-source-deliveries.spec.ts` 2/2. Screenshots checked: a
  Knowlarity switch saved off reading _Saved. The connection was not
  re-checked._ with the connection still _Connected_; the WhatsApp Business
  switch on by default; Deliveries with _Lead created_ and _Not read: unknown
  email_ at 390 px dark, with no sideways scroll.

**Left open**

- The mail side of Portal emails is the owner's to supply, and it is more than
  a forwarding rule: an inbound-mail service (SES, Mailgun, Postmark, SendGrid
  Inbound Parse, or the mail server's own hook) plus a small relay that posts
  each email as the JSON above, signed under the issued secret. None was
  created. No real portal email has been seen: the parser was tested on
  synthetic emails laid out like the portals' notifications, forwarded ones and
  hostile ones.
- A portal email whose own body ends in a quoted earlier message (`From:` …
  `Subject:`) is read from that quote down, and its lead is then unread on
  Deliveries; no portal template seen so far does that.
- A call lead's call stays on the most senior user after distribution assigns
  the lead, so it shows on the lead, not in the agent's own call list.
- Two first messages from one new WhatsApp number handled at the same moment
  can make two leads, as two portal deliveries for one new person already can.
- No catalogue entry by default for WhatsApp or Telephony leads: they land on
  one once an administrator adds _WhatsApp_ (key `whatsapp`) or _Telephony_
  (key `telephony`) under Sources, as a Custom webhook's do.
- Only distribution's automatic assignment was given the notice; a Meta lead
  form routed straight to a named agent still tells nobody.
