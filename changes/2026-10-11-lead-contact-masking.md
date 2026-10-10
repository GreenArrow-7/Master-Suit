# A lead's main phone and email can be masked per role

**What.** A lead's main phone and email, its other numbers (LeadPhone), its
normalised and WhatsApp numbers are sensitive fields now: a role without
`leads:VIEW_SENSITIVE_FIELDS` (Roles & permissions → Leads → view sensitive
fields) sees them masked, `+971 •• ••• ••67` and `c•••••@example.com`, and
cannot dial, mail, WhatsApp or change them. A migration grants the permission
to every role that reads leads, so nothing changes on deploy until an
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
  `MASK_PARTIAL` keeps the first four and last two, separators as typed.
- `services/leads/createLead.ts`: `LEAD_SENSITIVE_FIELDS` with phone, email,
  normalised, WhatsApp and secondary numbers masked, address hidden;
  `asLeadPhone` (a lead's number held elsewhere), `contactSearch` (whole-value
  search when masked), `maskCallNumbers` (a call to a lead reads as its phone).
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
- Calls: `api/v1/calls/route.ts` (list masked; a call created by lead id with
  the masked number goes to the stored one), `calls/[id]/route.ts`,
  `sales/calls/page.tsx`, `calls/[id]/page.tsx`, `calls/[id]/live/`.
- `sales/site-visits/new/page.tsx` (client picker), `lib/ai/assistant/tools.ts`
  (the assistant's lead answers and search).
- `prisma/migrations/20261011000000_lead_contact_sensitive` (migration 99):
  grants `leads:VIEW_SENSITIVE_FIELDS` to every role holding `leads:VIEW`, at
  its scope. `prisma/seed/index.ts` does the same for the seeded roles;
  `docs/01-PERMISSIONS.md` follows.
- `tests/helpers/fixtures.ts`: the fixture roles hold it too, as production's
  will; `tests/e2e/lead-contact-masking.spec.ts` is the browser check.

**Behaviour.** For customers on production: none on deploy. Every existing
role that reads leads gets the permission and sees what it saw. Then:

- An administrator who switches it off for a role masks that role on the lead
  list, smart views, the lead page, the API, the CSV export, the calls list,
  call and live-call screens, the site-visit picker and the assistant. Search
  finds a lead by its whole number or address, not by a fragment. The
  assisted call still works: the provider dials the stored number. Adding,
  removing or changing a number or the email answers 403 (404 first for a
  lead outside their scope).
- Roles holding the permission (every role after the migration) now also see
  the secondary phone, secondary email and address on the API, which were
  withheld from every role.
- A new role starts without it, like every other permission: its numbers are
  masked until the administrator switches it on. A cloned role keeps its
  source's setting.
- Platform support and monitoring sessions never hold the permission and now
  see lead phone and email masked; break-glass keeps everything.

**Verified.** `tests/permission/field-security.spec.ts`, 36 tests: list API,
detail API (every number), CSV, lead list, search by fragment and by whole
value, lead page with the other numbers and nothing dialable, phones and PATCH
403 (404 for a missing lead), filter 403, calls list and API, a call by lead
id goes to the stored number, the holder sees everything (the secondary
number included), the migration's grant, the phone-shaped `MASK_PARTIAL`. On
the old code 16 fail (3 of them on the sensitive-fields argument's new
shape). `tests/e2e/lead-contact-masking.spec.ts`, 3 tests in a provisioned
workspace: the telecaller's page shows the mask with Phone and Email off, no
WhatsApp, no `tel:`, `wa.me` or `mailto:` link; the assisted call stores the
real number; the administrator sees it whole. On the old code it fails at the
mask. Also green: `tests/permission`, `tests/identity`, `tests/hr` (874),
`tests/sales` (620), `tests/security`, `tests/integration`, `tests/platform`,
`tests/ai` (765), `tests/unit` and `tests/tenant` without the retention specs
(1313, 2 skipped on Windows), `crm-lifecycle` and `lead-eagle-workspace` E2E;
tsc, eslint, prettier. The migration applied to the rig database: 42 roles
read leads, all 42 now hold the permission.

**Left open.**

- Still shown whole: the campaign dialer's queue (copied numbers, dialled
  from the screen), event invitees, cold-data records (not yet leads), the
  WhatsApp inbox thread's number, and call notifications ("Call scheduled
  with +971…") sent to the lead's owner.
- Roles where an administrator had switched the permission off get it back
  on deploy: it did nothing before, so the row cannot be told from one never
  set.
