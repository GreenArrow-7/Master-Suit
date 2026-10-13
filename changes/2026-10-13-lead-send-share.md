# Send a WhatsApp or email template from the lead and to many leads; share a listing or project as a page that tells the agent when it is opened

**What.** Lead Eagle part 4D, second half, for every lead module. Audit rows
M4-28, M4-30 and M4-38. Branch `feat/lead-send-share`, stacked on
`feat/lead-call-log-timeline` (#178, open).

- **Send from the lead** (M4-28). The lead's Overview has a Message card:
  Send WhatsApp and Send email. A dialog picks an approved WhatsApp template
  (or one of the workspace's email templates), fills `{{1}}` with the lead's
  first name and `{{2}}` with the sender's unless typed, and asks for any other
  value. WhatsApp goes to a number marked as on WhatsApp (the main one by
  default; another of its numbers when chosen). It is sent through the inbox's
  own send, so it is a message on the lead's thread and timeline, audited.
  Refused, with the reason on the card and from the API, when the lead opted
  out of the channel, has no number marked or no email, or WhatsApp is not
  connected.
- **Email templates.** Administration → Settings → Email Templates: a name, a
  subject and a body, kept as message templates beside the WhatsApp ones.
- **Send template on the lead grid** (M4-38, the owner's default). Select
  leads, Send template: one queued send per lead, a workspace's sends going one
  a second, each the same send as from the lead page. Opted-out leads, leads
  with nowhere to send and leads outside the sender's reach are skipped and
  counted. At most 100 leads at a time.
- **Share a property** (M4-30). The Overview's Share a property card makes a
  link for a listing or a project: a public page, `/s/{token}`, showing what an
  advert would. Share via WhatsApp opens WhatsApp with the link written to the
  lead's number, where the viewer may read it; Copy link and Open always.
  Opening the page logs "Shared link opened" on the lead's timeline, once per
  visitor per day. A link works 30 days and can be revoked.

**One migration (108 in all):** `20261014090000_lead_shares`. Additive: the
`LeadShare` table, row-level security forced. No row is written.

**Why.** The Lead Eagle gap audit of 11 Oct, part of the owner's brief "Build
to completion: Lead Eagle M4 Leads, M5 Cold data, M6 Lead intake". Before this
change:

- A Lead Eagle lead could be messaged only from a phone (`wa.me`, `mailto:`),
  so nothing reached its timeline; templated sends lived in the Sales inbox,
  and there were no email templates (M4-28).
- No link for one listing or project existed; the shortlist (proposal) is a
  Sales register (M4-30).
- A template could not be sent to selected leads at all (M4-38).

**Where** (under `apps/web/`)

- `prisma/schema.prisma` and the migration: `LeadShare` (lead, one project or one listing, who shared it, `expiresAt`, `revokedAt`, `viewCount`, `lastViewedAt`); a check constraint keeps exactly one target.
- `src/services/conversations/send.ts` (new): what the inbox's reply and the lead's send share.
  - `sendableTemplate` re-reads the template (an approved, active WhatsApp one; an active email one).
  - `fillTemplate` writes the values into it; `whatsAppSender` is the connected provider or 403; `sendWhatsAppTemplate` sends one.
  - `src/app/api/v1/conversations/[id]/messages/route.ts` now calls them; its behaviour is unchanged.
- `src/services/leads/leadMessages.ts` (new):
  - `sendLeadMessage(ctx, leadId, input)`: `assertLeadInScope` at `EDIT` (404), `recipientOf`, the template, `templateValues`.
  - The Communication (QUEUED, on the lead's WhatsApp thread, which the sender claims when unowned) and its `MESSAGE_SENT` audit row are written in one transaction before the provider is called; the provider's answer, a failure included, is written on it.
  - `queueLeadMessages` (bulk): refuses a template it cannot send, or WhatsApp not connected, before queueing; reads the leads under `leadScope(ctx, 'EDIT')`; counts the skipped; reserves send slots per workspace in Redis (`reserveSendSlots`, `SEND_SPACING_MS` 1 s) and enqueues `campaign` / `lead-message` per lead with its delay; one `lead-message-batch` audit row.
  - `runQueuedLeadMessage` (the job, `src/workers/jobs.ts`): runs as the sender (`ctxForUser`), checks `communications:CREATE` again, sends through `sendLeadMessage`; a refusal then (opted out since, out of scope) is logged, not retried; a retried job finds its message by `batchId` and sends nothing.
- `src/app/api/v1/leads/[id]/messages/route.ts` (new): `POST`, `communications:CREATE`, `LEAD_MODULES`, 30 per 5 minutes. The body names a number by id (`main` or a LeadPhone id), never by value; the answer carries the message's id, channel, status and error, never the address.
- `src/app/api/v1/leads/messages/route.ts` (new): `POST` the bulk send, `communications:CREATE`, `LEAD_MODULES`, `leadIds` 1 to 100.
- `src/app/api/v1/email-templates/route.ts` (new): `GET` (`communications:CREATE`) lists the active ones; `POST` and `PATCH ?id=` (`settings:MANAGE_CONFIGURATION`) keep them, audited; another workspace's id answers 404. `LEAD_MODULES`.
- `src/app/(workspace)/[workspaceSlug]/admin/email-templates/` (new: `page.tsx`, `EmailTemplateEditor.tsx`, and `layout.tsx` with `NotInPlan` outside a lead product, as #168's admin screens); `src/lib/nav/workspaceNav.ts` adds the Email Templates tab after Custom Fields.
- `src/services/leads/leadShares.ts` (new):
  - `shareLink = publicLink('lead-share', 's')`: the token is signed and carries the tenant, derived from the row, never stored.
  - `leadTarget` and `assertLeadTarget` moved here from the interests route, which now imports them; `shareRequest` adds `days` (1 to 90).
  - `createShare` (`leads:EDIT` on the lead; stock the sharer sees; 409 for a listing not ACTIVE or UNDER_OFFER, or a project not pitchable), `revokeShare`, `leadShares` (the lead page's list), all audited where they write.
  - `loadShare` answers 404 alike for a bad signature, an unknown, revoked or lapsed link, a deleted lead, stock off the market, and a workspace with no lead module.
  - `recordShareView` counts every opening on the link and, once per visitor per day (the workspace's day), writes the `link_view` activity on the lead, audited as the system. The visitor is a hash of address and browser, kept two days in Redis only.
- `src/app/api/v1/leads/[id]/shares/route.ts` (new): `POST` makes a link, `DELETE ?share=` revokes one; `leads:EDIT`, `LEAD_MODULES`.
- `src/app/s/[token]/page.tsx` (new): the public page, outside the route groups like `/p/{token}`, `noindex`, rate-limited per client as the public form's read is (`limits.publicShare`, 60 a minute).
- `src/lib/proposals/publicProposal.ts`: `PUBLIC_LISTING`, `publicListing`, `agencyOf` and `SHOWABLE`, factored out of `loadProposal`, so the shortlist and the share page show a listing the same way.
- `sales/leads/TemplateSendDialog.tsx` (new): the dialog, a native modal, one `Idempotency-Key` per dialog; the single send and the bulk one.
- `sales/leads/[id]/MessageCard.tsx` and `ShareCard.tsx` (new), on the Overview in `LeadDetail.tsx`; `sales/leads/[id]/page.tsx` passes them the numbers marked as on WhatsApp as the viewer reads them (masked where masked), why a channel is closed, the links, and `wa.me` only through a visible number of a lead not opted out of WhatsApp.
- `sales/leads/LeadGrid.tsx`: Send template in the bulk bar (`canMessage`, from `sales/leads/page.tsx` and `sales/smart-views/page.tsx`); the bar's buttons wrap on a phone.
- `src/services/platform/provisioning.ts`: Lead Eagle's starter roles get `communications` VIEW and CREATE (the Viewer VIEW only), at each role's scope.
- `src/lib/security/ratelimit.ts` (`publicShare`); `src/services/platform/signup.ts` reserves `s` as a workspace address.

**Behaviour.** What customers on production see:

- **Lead page** (Sales, Real Estate, Lead Eagle). For a role with
  `communications:CREATE` whose `leads:EDIT` reaches the lead: a Message card
  with Send WhatsApp and Send email, each closed with its reason where it
  cannot go. A sent message is on the timeline as "WhatsApp sent" or "Email
  sent", with its text. For a role whose `leads:EDIT` reaches the lead: a
  Share a property card listing its links (opened how often, last opened,
  until when) with Share via WhatsApp, Copy link, Open and Revoke.
- **Timeline.** An opened link shows as "Shared link opened", naming the
  listing or project, with no person.
- **Lead lists and smart views.** Roles with `communications:CREATE` get Send
  template in the bulk bar. The answer counts what was queued and what was
  skipped and why.
- **Administration → Settings.** A new Email Templates tab in every lead
  module.
- **The client.** A link opens a page with the agency's name, the listing's or
  project's public details and photographs (listings), and who shared it.
- **New Lead Eagle workspaces** (and Lead Eagle added to a workspace without
  its starter roles): Agent, Telecaller, Team Lead and Manager may send; the
  Viewer sees messages on the timeline. Existing roles are not changed.
- The inbox's reply is unchanged.

**Decisions taken.**

The owner's default (M4-38): the bulk template send is built, for roles with
the communications permission, throttled, honouring opt-out, logged per lead.

Design choices (mine, not the owner's):

- Who may send: `communications:CREATE` (the inbox's send) and the lead's
  `leads:EDIT` reach, as Log call. A role that only reads the lead gets 404.
- Lead Eagle's starter roles get `communications`; without it no Lead Eagle
  agent could send. Existing roles are left as they are.
- Email templates are message templates with channel EMAIL: the model already
  had them, nothing kept them. `{{1}}` is the lead's first name and `{{2}}` the
  sender's name, for email and WhatsApp alike; any other placeholder is typed
  (in a bulk send, once for every lead).
- The number is named by id, never by value. Without a choice: the main
  number when marked as on WhatsApp, else its first other number marked.
- The message and its audit row are written before the provider is called,
  and the outcome after. A provider failure is a FAILED message on the
  timeline, not an error page.
- The bulk send uses the existing `campaign` queue, one message a second per
  workspace, 100 leads a batch, each checked again when it goes.
- A sent message does not move `lastActivityAt`, as the inbox reply and the
  call follow-up email do not.
- The link is a signed token (`/s/{token}`) naming a stored share, so it ties
  the opening to the lead and can lapse (30 days, 1 to 90 through the API) or
  be revoked. `/s/` keeps clear of `/l/{workspace}/{slug}`.
- The page shows a listing as the shortlist page does (no address, reference,
  seller or mandate), and a project's name, developer, community, from-price,
  possession and handover, unit types, highlights, description and RERA
  number (not its code or stock counts).
- An opening is counted on the link every time and logged on the lead once
  per visitor per day. It is not scored and does not count as working the
  lead.
- Share via WhatsApp is `wa.me` with the link written, through the lead's
  WhatsApp number where the viewer may read it; a lead opted out of WhatsApp
  gets none.

**Verified.** On the rig's scratch database (108 migrations; logs
`C:/ymw/logs/r4-4d2-*.log`).

New and touched specs, all green on the final code (after the merge of #176
and #177 through the base; `after1`, 16 files, 670 tests):

- `tests/sales/lead-send.spec.ts` (new, 13 cases, a Lead-Eagle-only
  workspace, WhatsApp connected with a test provider standing in for Meta):
  - An OWN agent sends an approved template to the main number: the provider
    gets `971501234567`, `viewing_invite`, and "Sara", "The agent" and the
    typed `{{3}}`; one Communication (SENT, the filled text, on the lead's
    thread, which the agent now owns), one `MESSAGE_SENT` audit row naming
    it, and "WhatsApp sent" first on the timeline. The answer has no number.
  - Another number marked as on WhatsApp when chosen, and 422
    `not_whatsapp` once it is unmarked; a landline main number with no other
    number marked is 422 `no_whatsapp_number`, and with one marked that one
    is the default.
  - Opted out of WhatsApp and of email: 422 `opted_out` with the sentence,
    nothing sent, no message written.
  - A paused template 409, an unknown one 404, `{{3}}` left empty 422
    "Fill in {{3}}.", nothing sent.
  - A role that sees numbers masked sends; its answer is only the message's
    id, channel, status, error and time.
  - The lead page's Message card: the agent's numbers labelled "Main · …"
    and "Office · …"; the masked role's carry the mask; none for a role
    without the permission or one that only reads the lead; the reasons for
    an opted-out lead, no email, and WhatsApp not connected.
  - 404 for another's lead, another workspace's, and a lead the role only
    reads; 403 without `communications:CREATE`; nothing sent.
  - 403 "WhatsApp is not connected for this workspace." when disconnected.
  - The inbox's reply sends a template through the same send (a guard on the
    moved code: the base's route did the same).
  - Email templates: the administrator adds one (audited), an agent may not
    (403), the agent's list has the active ones only, another workspace's id
    answers 404; the send fills subject and body ("Your brochure, Sara"),
    goes through the mail provider, and is "Email sent" on the timeline; a
    lead with no address is 422 `no_email`.
- `tests/sales/share-page.spec.ts` (new, 10 cases): the link
  (`/s/{tenant}.{id}.{signature}`, 30 days, audited); the listing's page
  shows title, "AED 2,400,000", beds, baths, "1,450 sq ft", community,
  description, permit and who shared it, its photo through `/li/`, and not the
  seller, the seller's number, the lead, the reference, the address or the
  mandate; the project's page shows name, developer, "From AED 1,200,000",
  "Under construction, handover Dec 2027", unit types, highlights and RERA
  number, not its code or stock counts; two openings from one browser and one
  from another log two "Shared link opened" activities (no visitor in them,
  audited as the system) and count four openings; a lapsed link, a revoked
  one (audited) and a sold listing are 404, and the listing back on the
  market opens again; an altered signature, a proposal token for the same
  ids, another workspace's id and garbage are 404; a lapsed lead module is
  404; the lead page lists the links and offers `wa.me` only through a visible
  number of a lead not opted out; another's lead and another workspace's
  stock 404, a draft listing 409, both targets 422; past 60 openings a minute
  the page says "Too many requests" and shows nothing.
- `tests/sales/bulk-template-send.spec.ts` (new, 6 cases): 7 leads give 2
  queued, 1 opted out, 2 with no number marked, 2 out of reach (another's,
  another workspace's), one batch audit row; the delays are 1 s apart and a
  second batch starts after the first, while another workspace starts at
  once; each job sends through the lead's send ({{1}} the lead's first name,
  {{2}} the sender's), one Communication and one audit row as the sender per
  lead, and run again sends nothing; a lead opted out after queueing is
  skipped; email skips no address and opted out; 101 leads 422, no
  permission 403, an unknown template 404 before anything is queued.
- Touched: `tests/unit/lead-eagle-routes.spec.ts` (Email Templates screen,
  API, `NotInPlan` layout and menu), `tests/permission/module-entitlement.spec.ts`
  (its layout says "Email templates is part of Sales, Real Estate or Lead
  Eagle."), `tests/unit/workspace-nav.spec.ts`, and
  `tests/tenant/provision-lead-work.spec.ts` (Agent and Telecaller send at
  OWN).

Fail-before, against the base `5952e968` (this branch's source swapped back,
tests kept, then restored; the source's hash checked identical, logs
`failbefore-A`, `e2e-failbefore`):

- The three new specs cannot load (no `leads/[id]/messages`,
  `leads/[id]/shares` or `leads/messages` route).
- 7 cases fail elsewhere: the email-templates layout cannot be imported; the
  four admin cases in `lead-eagle-routes` (no such page, API or layout;
  "expected [ '/eagle/dashboard', …(15) ] to deeply equal ArrayContaining");
  "expected null to be 'settings / Email Templates'"; and "expected undefined
  to be 'OWN'" for the agent's `communications:CREATE`.
- The E2E times out waiting for the New email template form's Name.

Wider runs on the final code:

- `tests/permission` and `tests/sales` (`wide1`): 93 files, 1,688 passed.
- `tests/tenant`, `unit` and `platform` without the retention specs
  (`wide2`): 87 files; 2 failed on "Unable to start a transaction" and pass
  alone, 18 of 18 (`wide2b`); 1,474 passed and 2 skipped. The retention specs
  alone: 5, 7 and 1.
- `tests/security`, `integration`, `identity`, `hr`, `diagnostic` and `ai`
  (`wide3`): 100 files; 2 failed under load (Prisma transaction errors) and
  pass alone, 36 of 36 (`wide3b`).
- `tsc` clean (`tsc2`, after the merge); eslint no errors, 10
  `no-explicit-any` warnings, all on lines this change did not write;
  prettier clean; `check-rls` (199 tables forced), `check-raw-sql-scope` (36
  statements, all in a tenant transaction), `check-observability`,
  `check-test-data` and the permission catalogue clean; `prisma migrate diff`
  empty.
- E2E on a fresh `.next`:
  - `lead-send-share` (new) passed twice (`e2e1`, and `e2e2` after the
    merge).
  - `lead-call-log` passed (`e2e2`).
  - `lead-contact-masking` and `crm-lifecycle`: the new Send WhatsApp button
    made their `getByRole('button', { name: 'WhatsApp' })` match two buttons;
    the three locators now say `exact: true`, as `crm-lifecycle` already did
    elsewhere. Then 3 of 3 and 6 of 6 (`e2e4`), with `lead-eagle-workspace`.
  - `lead-requirement-interest` failed once there: the project page,
    compiled for the first time, took over the 20 s wait. It passed on its
    rerun (`e2e5`).
  - `lead-bulk-stage` 2 of 2 (`e2e6`); `lead-close-out` skips without the
    demo workspace's settings.

Screens, captured at 390 and 1280 px in light and dark: the lead's Overview
with Message and Share a property, the Send email dialog, the links, the
Email Templates screen, Send template on the grid, the public page and the
timeline with an opening. None scrolls sideways at 390 px; tokens only, the
public page using the agency's colour as the shortlist page does. The
template editor's body field was given the textarea style after the capture.

**Left open.**

- Existing Lead Eagle workspaces: their administrator grants Communications
  (View, Create) in Admin → Roles before agents can send.
- No photographs on a project's page: project media has no public image
  route like the listings' `/li/{token}`.
- A bulk send's progress is not shown after it is queued; each message's
  outcome is on its lead's timeline. A box with no worker running holds the
  jobs until one starts.
- The Sales campaign send (`services/campaigns/send.ts`) still does not read
  `Lead.whatsappOptOut`; it filters on consent and do-not-call only.
- WhatsApp templates are filled by number (`{{1}}`…); Meta's named
  parameters are not supported, here or in the inbox.
- Making and revoking a link are in the audit log, not on the timeline.
