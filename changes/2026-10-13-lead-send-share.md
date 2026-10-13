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
  out of the channel or withdrew its consent, has no number marked or no
  email, or WhatsApp is not connected. An email's replies go to the sender,
  and a workspace sends at most 300 lead emails a day.
- **Email templates.** Administration → Settings → Email Templates: a name, a
  subject and a body, kept as message templates beside the WhatsApp ones.
- **Send template on the lead grid** (M4-38, the owner's default). Select
  leads, Send template: one queued send per lead, a workspace's sends going one
  a second, each the same send as from the lead page. Opted-out leads, leads
  with nowhere to send and leads outside the sender's reach are skipped and
  counted. At most 100 leads at a time. Each send is checked again when it
  goes, the workspace's plan and status included.
- **Share a property** (M4-30). The Overview's Share a property card makes a
  link for a listing or a project: a public page, `/s/{token}`, showing what an
  advert would. Share via WhatsApp opens WhatsApp with the link written to the
  lead's number, where the viewer may read it; Copy link and Open always.
  The page's own script reports an opening, so a link preview (WhatsApp
  fetches the page as the agent sends the link) and the agent's own look
  (signed in to the workspace) are not openings. Each opening is counted, and
  "Shared link opened" goes on the lead's timeline once per visitor per day,
  at most three a day per link. A link works 30 days and can be revoked.

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
  - The Communication (QUEUED, on the lead's WhatsApp thread) and its `MESSAGE_SENT` audit row are written in one transaction before the provider is called; the provider's answer, a failure included, is written on it.
  - The thread: a new one is the lead owner's (the sender's, for a lead with none); an unowned one linked to this lead (or to none) is linked and claimed for the lead's owner, and one still held by a previous owner of a reassigned lead moves to its owner now, each with an `OWNER_CHANGED` audit row on the conversation (`from`, `ownerId`); one linked to another lead is left as it is.
  - `recipientOf` refuses `opted_out` for a lead whose `consentStatus` is `WITHDRAWN` (both channels), as campaigns and the dialer read it.
  - Email: `limits.leadEmailDay` (300 a UTC day per workspace, 429 past it) and `Reply-To` the sender (`src/lib/mailer.ts` takes `replyTo`).
  - `queueLeadMessages` (bulk): refuses a template it cannot send, or WhatsApp not connected, before queueing; reads the leads under `leadScope(ctx, 'EDIT')`; counts the skipped; reserves send slots per workspace in Redis (`reserveSendSlots`, `SEND_SPACING_MS` 1 s) and enqueues `campaign` / `lead-message` per lead with its delay; one `lead-message-batch` audit row.
  - `runQueuedLeadMessage` (the job, `src/workers/jobs.ts`): checks the workspace is ACTIVE and holds a lead module, runs as the sender (`ctxForUser`), checks `communications:CREATE` again, sends through `sendLeadMessage`; a refusal then (opted out since, out of scope) is logged, not retried; a retried job finds its message by `batchId` and sends nothing.
- `src/app/api/v1/leads/[id]/messages/route.ts` (new): `POST`, `communications:CREATE`, `LEAD_MODULES`, 30 per 5 minutes. The body names a number by id (`main` or a LeadPhone id), never by value; the answer carries the message's id, channel, status and error, never the address.
- `src/app/api/v1/leads/messages/route.ts` (new): `POST` the bulk send, `communications:CREATE`, `LEAD_MODULES`, `leadIds` 1 to 100.
- `src/app/api/v1/email-templates/route.ts` (new): `GET` (`communications:CREATE`) lists the active ones; `POST` and `PATCH ?id=` (`settings:MANAGE_CONFIGURATION`) keep them, audited; another workspace's id answers 404. `LEAD_MODULES`.
- `src/app/(workspace)/[workspaceSlug]/admin/email-templates/` (new: `page.tsx`, `EmailTemplateEditor.tsx`, and `layout.tsx` with `NotInPlan` outside a lead product, as #168's admin screens); `src/lib/nav/workspaceNav.ts` adds the Email Templates tab after Custom Fields.
- `src/services/leads/leadShares.ts` (new):
  - `shareLink = publicLink('lead-share', 's')`: the token is signed and carries the tenant, derived from the row, never stored.
  - `leadTarget` and `assertLeadTarget` moved here from the interests route, which now imports them; `shareRequest` adds `days` (1 to 90).
  - `createShare` (`leads:EDIT` on the lead; stock the sharer sees; 409 for a listing not ACTIVE or UNDER_OFFER, or a project not pitchable), `revokeShare`, `leadShares` (the lead page's list), all audited where they write.
  - `loadShare` answers 404 alike for a bad signature, an unknown, revoked or lapsed link, a deleted lead, stock off the market, and a workspace with no lead module.
  - `recordShareView` counts every opening on the link and, once per visitor per day (the workspace's day) and at most `LOGGED_PER_DAY` (3) a day per link, writes the `link_view` activity on the lead, audited as the system. The visitor is a hash of address and browser, kept two days in Redis only. The `link_view` type is created inactive, so the lead page's Log activity menu leaves it out.
- `src/app/api/v1/leads/[id]/shares/route.ts` (new): `POST` makes a link, `DELETE ?share=` revokes one; `leads:EDIT`, `LEAD_MODULES`.
- `src/app/s/[token]/page.tsx` (new): the public page, outside the route groups like `/p/{token}`, `noindex`, rate-limited per client as the public form's read is (`limits.publicShare`, 60 a minute). It records nothing itself; `Opened.tsx` (new, a client component) reports the opening once it is on screen. The token is used as it comes (no `decodeURIComponent`, which threw on a broken escape).
- `src/app/api/v1/public/share-view/route.ts` (new): `POST { token }`, anonymous like the other `/public` routes, 60 a minute per client; 404 for a bad token; counts nothing when the request carries a session for the link's workspace.
- `src/lib/proposals/publicProposal.ts`: `PUBLIC_LISTING`, `publicListing`, `agencyOf` and `SHOWABLE`, factored out of `loadProposal`, so the shortlist and the share page show a listing the same way.
- `sales/leads/TemplateSendDialog.tsx` (new): the dialog, a native modal; the single send and the bulk one. Its `Idempotency-Key` is kept until an answer comes (a lost answer is replayed, not sent twice) and renewed after one, so Send after "Not sent" is a new request.
- `sales/leads/[id]/MessageCard.tsx` and `ShareCard.tsx` (new), on the Overview in `LeadDetail.tsx`; `sales/leads/[id]/page.tsx` passes them the numbers marked as on WhatsApp as the viewer reads them (masked where masked), why a channel is closed, the links, and `wa.me` only through a visible number of a lead not opted out of WhatsApp.
- `sales/leads/LeadGrid.tsx`: Send template in the bulk bar (`canMessage`, from `sales/leads/page.tsx` and `sales/smart-views/page.tsx`); the bar's buttons wrap on a phone.
- `src/services/platform/provisioning.ts`: Lead Eagle's starter roles Manager, Team Lead and Agent get `communications` VIEW and CREATE at their scope; the Telecaller CREATE only (OWN), the Viewer none. The inbox names each thread by its full number, so the roles that read numbers masked do not get it.
- `src/services/leads/timeline.ts`: a role with no inbox (no `communications:VIEW`) reads the messages it sent itself, where it read none; a role with the inbox reads by thread, as before.
- `src/lib/security/ratelimit.ts` (`publicShare`, `leadEmailDay`); `src/services/platform/signup.ts` reserves `s` as a workspace address.

**Behaviour.** What customers on production see:

- **Lead page** (Sales, Real Estate, Lead Eagle). For a role with
  `communications:CREATE` whose `leads:EDIT` reaches the lead: a Message card
  with Send WhatsApp and Send email, each closed with its reason where it
  cannot go. A sent message is on the timeline as "WhatsApp sent" or "Email
  sent", with its text, for those whose inbox reaches the thread, and for a
  sender with no inbox. A WhatsApp send puts the lead's thread with the lead's
  owner, moving it from a previous owner of a reassigned lead (audited). A
  lead whose consent is withdrawn is closed on both channels. An
  email's replies go to the sender's address; past 300 lead emails in a UTC
  day a workspace is refused until the next. For a role whose `leads:EDIT`
  reaches the lead: a Share a property card listing its links (opened how
  often, last opened, until when) with Share via WhatsApp, Copy link, Open
  and Revoke.
- **Timeline.** An opened link shows as "Shared link opened", naming the
  listing or project, with no person: when a browser shows the page to
  someone not signed in to the workspace, at most three a day per link.
- **Lead lists and smart views.** Roles with `communications:CREATE` get Send
  template in the bulk bar. The answer counts what was queued and what was
  skipped and why.
- **Administration → Settings.** A new Email Templates tab in every lead
  module.
- **The client.** A link opens a page with the agency's name, the listing's or
  project's public details and photographs (listings), and who shared it.
- **New Lead Eagle workspaces** (and Lead Eagle added to a workspace without
  its starter roles): Agent, Team Lead and Manager may send and have the
  inbox; the Telecaller sends, with no inbox, and sees its own messages on the
  timeline; the Viewer neither sends nor has the inbox. Existing roles are not
  changed.
- The inbox's reply is unchanged.

**Decisions taken.**

The owner's default (M4-38): the bulk template send is built, for roles with
the communications permission, throttled, honouring opt-out, logged per lead.

Design choices (mine, not the owner's):

- Who may send: `communications:CREATE` (the inbox's send) and the lead's
  `leads:EDIT` reach, as Log call. A role that only reads the lead gets 404.
- Lead Eagle's starter roles get `communications`; without it no Lead Eagle
  agent could send. The Telecaller gets CREATE only and the Viewer nothing:
  the inbox shows a thread's number unmasked (a gap `PROJECT.md` already
  records), and these two roles read numbers masked. A role with no inbox
  reads on the timeline the messages it sent. Existing roles are left as they
  are.
- A send puts the lead's thread with the lead's owner, so the client's reply
  reaches the lead's own agent and the message is on their timeline: a new
  thread, an unowned one, and one a previous owner still holds after the lead
  was reassigned (audited). A thread linked to another lead is never taken.
- Withdrawn consent (`consentStatus` WITHDRAWN) is an opt-out of both
  channels, as the campaigns and the dialer read it.
- Lead email goes through the platform's mail server, so it is capped at 300
  a UTC day per workspace (`limits.leadEmailDay`, one figure for all), and
  its `Reply-To` is the sender.
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
- An opening is what the page's own script reports, not a fetch of the page:
  link previews run no script. A request signed in to the link's workspace is
  not an opening. Each is counted on the link, and logged on the lead once per
  visitor per day, at most three a day per link (a new browser string is a
  new visitor). It is not scored and does not count as working the lead.
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
  audited as the system) and count three openings; a lapsed link, a revoked
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

**Review fixes (13 Oct).** Six reviewers' findings, checked against the
code; all were real. Fixed, each with a case that fails on the reviewed
commit `9741ba21` (its `src/` stashed, tests kept, then restored) and passes
now:

- The new Telecaller and Viewer had `communications:VIEW`, so the inbox
  (`GET /api/v1/conversations`, which names threads by their full number)
  read them the numbers the lead page masks. `provision-lead-work`: "expected
  true to be false" (the Telecaller's VIEW) and "Telecaller: expected 200 to
  be 403" on the inbox (log `fix-fb-prov`).
- "Shared link opened" was logged by any fetch of the page: WhatsApp's link
  preview, the agent's own Open. `share-page`: rendering the page with a
  WhatsApp user agent counted "expected 2 to be +0"; the E2E timed out waiting
  for the page's report (`fix-fb-share`, `fix-e2e-fb2`). Also capped at three
  a day per link ("to have a length of undefined but got 5") and the type
  made inactive; a broken escape in a token was a 500 ("got 'URI
  malformed'").
- A message sent from a reassigned lead went into the previous owner's
  thread, so the new owner did not see it and the reply went to the previous
  owner; a role with no inbox did not see its own message: "expected
  undefined to match object { title: 'WhatsApp sent' }" twice. A new thread
  went to the sender, not the lead's owner (a manager's bulk send kept every
  thread), and an unowned thread linked to another lead was claimed: "expected
  { …(16) } to match object" in `lead-send` and `bulk-template-send`
  (`fix-fb-send2`, `fix-fb-bulk`). The send now moves the thread to the
  lead's owner. A first attempt showed every sender their own messages on the
  timeline instead; it broke the base's case that a thread handed to another
  agent takes the messages with it (`lead-timeline`, `fix-wide1`), so it
  was narrowed to roles with no inbox.
- Withdrawn consent was sent to: "expected 200 to be 422" (`lead-send`), and
  bulk queued it ("expected { …(4) } to match object { queued: +0 }").
- Lead email: no `Reply-To` and no ceiling ("expected { to: 'mia@client.test',
  …(3) } to match object { subject: 'Hi Mia', …(1) }").
- A queued send went out after the workspace lost its lead modules
  ("expected vi.fn() to not be called at all, but actually been called 1
  times").
- After "Not sent", Send again replayed the stored refusal under the same
  `Idempotency-Key`: the E2E's "expect(keys[1]).not.toBe(keys[0])" failed
  (`fix-e2e-fb`).
- Guards added for paths that already worked: a provider refusal is a FAILED
  message (error code and text, audited, "Failed" on the timeline), the same
  key replays it and a new key sends again; a paused template, a missing
  `{{3}}` and WhatsApp disconnected are refused before anything is queued,
  `{{3}}` typed once goes to every lead and a lead picked twice is sent once;
  days 0 and 91 are 422, another lead's link cannot be revoked through this
  one (404), a project no longer offered is 409 and its links 404, a sharer
  without `projects:VIEW` gets 404; the E2E waits for the share route's
  answer rather than a fixed 20 s.

After the fixes: `lead-send` 19 of 19 and `bulk-template-send` 10 of 10
(`fix-new6`), `share-page` 12 of 12 (`fix-new4`); `lead-timeline`,
`lead-call-log`, `assignment-working-hours`, `whatsapp-templates`,
`whatsapp-unknown-number` and `meta-apply-event` 63 of 63 (`fix-regress`);
`tests/permission` and `tests/sales` 93 files, 1,687 passed and 13
skipped, two files stopped by a 60 s `beforeAll` under load that pass alone,
13 of 13 (`fix-wide1b`, `fix-wide1c`); `tests/tenant` and `tests/unit`
without the retention specs 84 files, 1,457 passed, 2 skipped (`fix-wide2`);
`tsc` clean (`fix-tsc2`); eslint no errors (two `no-explicit-any` warnings
on lines this change did not write); prettier clean. E2E: `lead-send-share`
and `lead-call-log` 2 of 2 on the final code (`fix-e2e4`); before the
timeline was narrowed, `lead-send-share` (`fix-e2e1`), `lead-contact-masking`
and `lead-eagle-workspace` with `lead-call-log` 5 of 5 (`fix-e2e2`), and
`crm-lifecycle` 6 of 6 (`fix-e2e3`).

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
- Reassigning a lead does not itself move its WhatsApp thread (as before
  this change); the next send from the lead page does. Until then a client's
  reply reaches the previous owner's inbox.
- Two leads with one number share one WhatsApp thread (Meta names a thread
  by its number). A send from the lead the thread is not linked to goes into
  it and is that lead's message, on its timeline only for those whose inbox
  reaches the thread.
- The Telecaller, with no inbox, sees its own sent messages on the timeline
  but not the client's replies. Giving it the inbox needs the inbox to mask
  numbers for such roles (`GET /api/v1/conversations`, its thread route and
  the Sales communications list), which it does not today for any role.
- A role that reads numbers masked gets Copy link and Open for a shared link,
  not Share via WhatsApp (the `wa.me` link would carry the number). A send
  through the Message card with the link as a template value would do it; not
  built.
- The 300-a-day email ceiling is one figure for every workspace, trial or
  paid. Whether bulk email should wait until a workspace has its own sender is
  the owner's call.
- A bulk job refused at its turn by the email ceiling is logged, not shown:
  the batch's counts are taken when it is queued.
