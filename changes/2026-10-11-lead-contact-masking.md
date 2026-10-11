# A lead's main phone and email can be masked per role

**What.** A lead's main phone and email, its other numbers (LeadPhone), its
normalised and WhatsApp numbers are sensitive fields now: a role without
`leads:VIEW_SENSITIVE_FIELDS` (Roles & permissions → Leads → view sensitive
fields) sees them masked, `+971 •• ••• ••67` and `c•••••@example.com`, and
cannot dial, mail, WhatsApp or change them. A migration grants the permission
to every role that reads leads or calls, so nothing changes on deploy until an
administrator switches it off for a role.

**Why.** Lead Eagle audit row M2-06 (11 Oct), owner's brief part C: hiding a
lead's main number from a role took a database insert. Underneath it,
`applyFieldSecurity` checked `lead:VIEW_SENSITIVE_FIELDS` (the object type
lower-cased) while the role editor grants `leads:`, so the switch reached
nobody and the secondary phone, email and address were withheld from every
role, Company Admin included.

**Where.**

- `lib/security/fieldSecurity.ts`: the permission is read on the module
  (`LEAD` → `leads`); a sensitive field carries its mask (`SensitiveFields`)
  instead of always being dropped; `seesField` answers "does this role see it
  as stored"; `assertFilterableFields` takes the masked fields too;
  `MASK_PARTIAL` keeps a phone's country code (a `+` and at most three digits)
  and last two digits, separators as typed, and anything else's first four and
  last two.
- `services/leads/createLead.ts`: `LEAD_SENSITIVE_FIELDS` with phone, email,
  normalised, WhatsApp and secondary numbers masked, address hidden;
  `asLeadPhone` (a lead's number held elsewhere), `contactSearch` (whole-value
  search when masked), `maskCallNumbers` (a call to a lead reads as its phone:
  the number dialled, or on an inbound call the number that rang).
- `components/workspace/CallLink.tsx`: `dialable` refuses a masked number, so
  no `tel:` or `wa.me` link is built from one anywhere.
- Lead screens: `sales/leads/page.tsx` (search), `leads/[id]/page.tsx` and
  `LeadDetail.tsx` (other numbers masked, Phone, Email and WhatsApp off with a
  note, masked fields not editable).
- Lead API: `api/v1/leads/route.ts` (filter on a masked field 403),
  `leads/[id]/route.ts` (PATCH of phone or email 403),
  `leads/[id]/phones/route.ts` (add and remove 403),
  `workspaces/[workspaceSlug]/sales/leads/route.ts` (the legacy list now goes
  through field security at all).
- Calls, through `maskCallNumbers` or `asLeadPhone`: `api/v1/calls/route.ts`
  (list; a call created by lead id with the masked number goes to the stored
  one), `calls/[id]/route.ts`, `calls/[id]/dial/route.ts` (the "Place call"
  answer), `calls/[id]/follow-up-email/route.ts` (the composer's "To" is the
  masked address; the mail goes to the stored one), `sales/calls/page.tsx`,
  `calls/[id]/page.tsx`, `calls/[id]/live/`, `sales/call-audits/page.tsx`,
  `services/shared/coachingInsights.ts` (coaching list),
  `services/targets/dailyBoard.ts` (a seller's own day, page and API).
- Bells: `services/crm/notify.ts` (`notifyAboutCall`) and
  `services/crm/reminders.ts` (call follow-up due) name the lead, not its
  number; only a call with no lead shows its number.
- `sales/site-visits/new/page.tsx` (client picker), `lib/ai/assistant/tools.ts`
  (the assistant's lead answers, search and calendar).
- `prisma/migrations/20261011000000_lead_contact_sensitive` (migration 99):
  grants `leads:VIEW_SENSITIVE_FIELDS` to every role holding `leads:VIEW` at
  that scope, then to every role holding `calls:VIEW` without it, at its calls
  scope. `prisma/seed/index.ts` does the same for the seeded roles, and the
  role the HR screen creates for a new employee
  (`workspaces/[workspaceSlug]/hr/[resource]/route.ts`) gets it;
  `docs/01-PERMISSIONS.md` follows.
- `tests/helpers/fixtures.ts`: the fixture roles hold it too, as production's
  will; `tests/e2e/lead-contact-masking.spec.ts` is the browser check.

**Behaviour.** For customers on production: none on deploy. Every existing
role that reads leads or calls gets the permission and sees what it saw. Then:

- An administrator who switches it off for a role masks that role on the lead
  list, smart views, the lead page, the API, the CSV export, the calls list,
  call detail and live call (the "Place call" answer included), the follow-up
  email composer, call audits, coaching, the seller's day board, the
  site-visit picker and the assistant. Search finds a lead by its whole number
  or address, not by a fragment. The assisted call still works: the provider
  dials the stored number. Adding, removing or changing a number or the email
  answers 403 (404 first for a lead outside their scope).
- Call bells ("Call scheduled with", "Missed call from", "Call completed
  with", "Call follow-up due") name the lead instead of its number, for every
  role.
- Roles holding the permission (every role after the migration) now also see
  the secondary phone, secondary email and address on the API, which were
  withheld from every role.
- A role made in the role editor starts without it, like every other
  permission: its numbers are masked until the administrator switches it on.
  A cloned role keeps its source's setting; the HR screen's new-employee role
  holds it.
- Platform support and monitoring sessions never hold the permission and now
  see lead phone and email masked; break-glass keeps everything. An API key
  scoped `leads:read` would also see them masked (`VIEW_SENSITIVE_FIELDS`
  counts as a write scope in `lib/auth/apiKey.ts`); nothing issues API keys
  today.

**Verified.** `tests/permission/field-security.spec.ts`, 41 tests: list API,
detail API (every number), CSV, lead list, search by fragment and by whole
value, lead page with the other numbers and nothing dialable, phones and PATCH
403 (404 for a missing lead), filter 403, calls list and API, a call by lead
id goes to the stored number, the "Place call" answer and the assistant's
calendar, the seller's day, coaching and call audits, an inbound call's
number, the follow-up email's "To", the bells, the holder sees everything (the
secondary number included), the migration's grant (lead and call readers, no
one else), the phone-shaped `MASK_PARTIAL` (local numbers keep no prefix). On
the old code 16 of the first 36 failed, then each review fix's case failed on
its own before it was fixed. `tests/security/hr-employee-escalation.spec.ts`:
the new-employee role holds the permission. `tests/e2e/lead-contact-masking.spec.ts`,
3 tests in a provisioned workspace: the telecaller's page shows the mask with
Phone and Email off, no WhatsApp, no `tel:`, `wa.me` or `mailto:` link; the
assisted call stores the real number; the administrator sees it whole. On the
old code it fails at the mask. Also green: `tests/permission`,
`tests/identity`, `tests/hr`, `tests/sales`, `tests/security`,
`tests/integration`, `tests/platform`, `tests/ai`, `tests/unit` and
`tests/tenant` without the retention specs, `crm-lifecycle` and
`lead-eagle-workspace` E2E; tsc, eslint, prettier. The migration applied to
the rig database: 42 roles read leads, all 42 hold the permission.

**Left open.**

- Still shown whole to a role without the permission: the campaign dialer's
  queue (numbers copied from leads, dialled from the screen), event invitees
  and the event page's meeting numbers, cold-data records (not yet leads), and
  the WhatsApp inbox thread's number.
- Lead import with `onDuplicate: MERGE` can still overwrite a lead's phone or
  email for a role that sees them masked; only PATCH and the phones routes
  refuse.
- Roles where an administrator had switched the permission off get it back
  on deploy: it did nothing before, so the row cannot be told from one never
  set.
- Owner's decisions: whether the secondary phone, secondary email and address
  should widen to every lead reader with the permission (they do on deploy);
  whether a new role in the editor should start with it ticked when Leads view
  is; whether a `leads:read` API key should count as holding it.
