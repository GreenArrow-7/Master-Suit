# Lead record fields: WhatsApp on the main number, sources and sub-sources, nationality, a second owner, tags, a duplicate check on edit

**What.** Six fields and rules on a lead, for every lead module:

- The main number has a WhatsApp flag. It is on by default and can be
  switched off for a landline. The lead page offers WhatsApp only when it is
  on, and never for a masked number.
- Each workspace has its own catalogue of sources and sub-sources, under
  Administration → Settings → Sources. A lead takes one entry, picked on the
  lead form and on the Overview, plus a free-text campaign. Portal and Google
  Ads enquiries land on their portal's entry, and the source reports group by
  entry.
- Nationality.
- A second owner, who reaches the lead as its owner does, at every scope.
- Tags typed on the form and on the Overview, and a Tags column for the grid.
- Changing a phone or email to a value another lead holds answers 409, as
  create does.

**One migration (102 in all):** `20261012004000_lead_record_fields`.

**Why.** The Lead Eagle gap audit of 11 Oct (rows M4-02, M4-03, M4-07, M4-09,
M4-10, M4-51). This is part 4A, first half, of the owner's brief "Build to
completion: Lead Eagle M4 Leads, M5 Cold data, M6 Lead intake". Before this
change:

- The WhatsApp link on the main number was unconditional.
- Sources were a fixed enum, and the campaign needed the Sales register.
- Nationality and the second owner were missing, so the move tool dropped
  them.
- Tags could be set only through the API.
- `PATCH /api/v1/leads/{id}` accepted another lead's phone or email without a
  word.

**Where** (under `apps/web/`)

- `prisma/schema.prisma` and the migration add these columns on `Lead`:
  `phoneIsWhatsapp` (default true), `sourceId`, `campaignName`, `nationality`
  and `secondaryOwnerId`, with an index on `(tenantId, secondaryOwnerId)`.
  They also add a `LeadSource` table (tenant, parent, key, name, isActive,
  position) under forced row-level security.
- `src/services/leads/leadSources.ts`:
  - `DEFAULT_LEAD_SOURCES`: the ten defaults.
  - `sourceKey`: keeps letters of any script; a name with no letters or digits
    gets a random key.
  - `ensureLeadSources`: the idempotent seed.
  - `listLeadSources`, `leadSourceIdFor`, `assertLeadSource` (another
    workspace's entry answers 404), `leadSourceLabel`.
- `src/app/api/v1/lead-sources/route.ts`: GET needs `settings:VIEW`. POST and
  `PATCH ?id=` need `settings:MANAGE_CONFIGURATION` and are audited.
  `productModule: LEAD_MODULES`.
- `src/app/(workspace)/[workspaceSlug]/admin/lead-sources/` (`page.tsx`,
  `SourceEditor.tsx`) is the new screen. `src/lib/nav/workspaceNav.ts` adds
  the Sources tab after Lead Stages.
- `src/components/forms/useRun.tsx`: `send` and `useRun`, moved out of
  `admin/lead-stages/StageEditor.tsx` and shared by both editors.
- `src/components/forms/SourcePicker.tsx`: a Source select, then a Sub-source
  select that follows it.
- `src/lib/leads/tags.ts`: `parseTags`.
- `src/components/workspace/CallLink.tsx`: `whatsappLink(raw, flagged)`. Every
  WhatsApp link is built here, so the flag and the mask both apply.
- `sales/leads/new/` (`LeadForm.tsx`, `page.tsx`) and `sales/leads/[id]/`
  (`page.tsx`, `LeadDetail.tsx`): the new fields, the Second owner menu, and
  the editable tags.
- `sales/leads/LeadGrid.tsx` (`leadCell`, the `tags` cell),
  `src/lib/grid/columns.ts` (the Tags column), and `sales/leads/page.tsx` and
  `sales/smart-views/page.tsx` (both select tags).
- `src/app/api/v1/leads/route.ts` and `leads/[id]/route.ts`: the new body
  fields.
- `src/services/leads/createLead.ts`: the entry must belong to the workspace.
- `src/services/leads/updateLead.ts`:
  - `refuseDuplicate`: the same rules (`findDuplicates`) and the same 409 as
    create, but only for the fields that change, and never matching the lead
    itself. A lead outside the caller's scope answers 404 first.
  - The secondary owner is named under the same ASSIGN (or REASSIGN) scope as
    the owner, through `assertAssignableUser`.
- `src/lib/security/visibility.ts` (`coOwnerFields`) and `record-scope.ts`:
  - `leadScope(ctx, action, opts)` is `visibilityWhere` on leads with the
    secondary owner counted as an owner.
  - `assertLeadInScope` falls back to the secondary owner.
  - Every read of `Lead` by scope now goes through `leadScope`: the lists
    (API, page, Smart Views, export, the legacy route), the lead page, the
    workspace, Sales and Real Estate dashboards, the Sales overview, cold data,
    the site-visit picker, documents, campaign audiences, event invitees,
    triage, bulk assign and the assistant.
- `src/services/leads/intake.ts`: an enquiry takes the entry whose key is its
  connection's kind.
- `src/services/leadership/reports.ts`: Source to Booking, Source Analysis and
  Lead Quality key on the entry.
- `src/services/platform/provisioning.ts`: seeds the catalogue for a new lead
  workspace.
- `src/services/platform/leadEagleMove.ts` and `scripts/move-lead-eagle.ts`:
  the move tool carries nationality, the secondary owner, the main number's
  WhatsApp flag (the standalone's primary `LeadPhone`) and the campaign.
- `docs/01-PERMISSIONS.md`: the secondary owner counts in scope.

**Behaviour.** For customers on production:

- **WhatsApp.** Nothing changes on deploy: every existing lead has the flag
  on. Switching off "On WhatsApp" on the form, or in Overview → Edit details,
  removes the lead page's WhatsApp button. A masked number never had one.
- **Sources screen.** Administration → Settings → Sources is new in Sales,
  Real Estate and Lead Eagle workspaces. Reading it needs `settings:VIEW`;
  changing it needs `settings:MANAGE_CONFIGURATION`. The ten defaults appear
  the first time a lead screen, the API or an enquiry needs them:
  - Property Finder, Bayut, Dubizzle, Google Ads, Meta
  - Website, Walk-in, Referral, Cold data, Other

  An administrator adds sources and sub-sources, renames them, or stops
  offering them on the form. Nothing is deleted.

- **Lead form.** New fields: On WhatsApp, Nationality, Source, Sub-source,
  Campaign and Tags.
- **Lead page.** The Overview shows Nationality and Campaign. Source shows the
  entry where a lead has one ("Website · Marina launch") and reads as before
  otherwise. Edit details changes all of these, the tags too. Roles with
  `leads:ASSIGN` get a "Second owner" menu beside Owner.
- **Lead grid.** A Tags column can be added under Columns. It is not shown by
  default.
- **Source reports.** A lead with an entry counts under it ("Website / Marina
  launch"). Existing leads have none and count as before. Portal and Google
  Ads leads that arrive from now on count under "Property Finder", "Bayut",
  "Dubizzle" or "Google Ads". Before, Source Analysis showed them as
  "marketplace" or "ad lead form".
- **Second owner.** The second owner, and the managers whose scope covers
  them, list, open and edit the lead as they would their own. Naming someone
  outside the caller's ASSIGN scope answers 404 "User not found.". The
  change is audited.
- **Duplicate check on edit.** Changing a lead's phone or email to another
  lead's main number, other number or email answers 409 with create's
  sentence, for example "A lead with this phoneNormalized already exists
  (LD-000123).". The Overview shows that sentence above the details. Before,
  the change was saved.
- **Assistant.** "What should I focus on today" lists SLA-breached and hot
  leads the caller works as second owner.

**Decisions taken** (defaults the owner accepted):

- **M4-02:**
  - The flag is a column on `Lead` (`phoneIsWhatsapp`) rather than the main
    number moving into `LeadPhone`. That is the smaller change: every screen
    keeps reading `Lead.phone`.
  - The flag is on by default for existing leads, the form, imports, intake
    and the public forms, and is switched off per lead, so nothing changes on
    deploy.
- **M4-03:**
  - Existing workspaces get the catalogue lazily on first use; new lead
    workspaces get it at provisioning. There is no data migration.
  - The enum `source` and `sourceDetail` stay as the pipeline writes them. A
    lead points at one entry: the sub-source when one is chosen, otherwise the
    source.
  - Entries are switched off, never deleted.
- **M4-07:** `Lead.nationality` is free text, rather than surfacing
  `ClientProfile`.
- **M4-09:** The secondary owner counts as an owner in every lead scope
  check. Follow-ups, tasks, activities by id and the per-person report rollups
  still key on the owner.
- **M4-10:** Tags are typed comma-separated, not entered as chips.
- **M4-51:**
  - Only the phone or email being changed is checked, against every other
    lead's main number, other numbers and email.
  - A lead outside the caller's scope answers 404 before any 409.

**Verified.** On the rig (scratch database at 101 migrations plus this one).

New and touched specs, all green (`C:/ymw/logs/r1-4a1-new3.log`):

- `tests/sales/lead-record-fields.spec.ts`, 10 new cases: the seed; adding,
  renaming, deactivating and the duplicate 409; Arabic and letterless names;
  read-only roles and another workspace; the fields on create and edit, and
  another workspace's entry answering 404; both source reports naming the
  sub-source; the secondary owner stored, audited, assignable-only and ignored
  without ASSIGN; the grid's Tags column; the tags inputs; the email and phone 409.
- `tests/sales/lead-source-intake.spec.ts`:
  - New cases: the flag starts on and the link follows it; the column's
    default; a masked number is never a link; editing a phone to another
    lead's main or other number answers 409, and an out-of-scope caller gets 404.
  - Two portal cases now assert the catalogue entry.
- `tests/permission/lead-record-scope.spec.ts`, 4 new cases: OWN; TEAM,
  BRANCH, REGION and ORGANIZATION; naming under ASSIGN; the assistant's day.
- `tests/platform/lead-eagle-move.spec.ts`: nationality, the secondary owner,
  the flag and the campaign.
- `tests/unit/lead-eagle-routes.spec.ts`, 4 cases: the screen and its API
  admit `LEAD_MODULES`, and a Lead-Eagle-only administrator gets the tab.

Fail-before, with `apps/web/src` put back to the base commit c03f59a. All the
failures are listed below. Logs: `r1-4a1-base1.log`, `base2`, `base4`.

- `lead-record-fields` cannot load: `/api/v1/lead-sources` does not exist.
  With only the new modules added (`base2`), 6 of its 10 cases fail:
  - "Unrecognized key(s) … 'sourceId', 'campaignName', 'nationality'", twice
  - "… 'secondaryOwnerId'"
  - "expected [ 'reference', … ] to include 'tags'"
  - the form has no `name="tags"`
  - "expected 200 to be 409"

  The other 4 test only the new catalogue.

- In `lead-source-intake`, the Property Finder and Google Ads cases fail with
  "expected null to match object { key: … }". Both WhatsApp cases fail with
  "whatsappLink is not a function". The edit check fails with "+971 50 940
  0001: expected 200 to be 409". The column-default case passes there, because it
  reads the rig database, which already has the column. Main's database has
  no such column.
- In `lead-record-scope`, the 4 new cases fail:
  - "expected 404 to be 200", twice
  - "expected 422 to be 404"
  - "expected [] to include '<lead id>'"

  The other 333 pass.

- In `lead-eagle-move`: "expected { …(74) } to match object { fullName:
  'Aisha Karim', … }".
- In `lead-eagle-routes`, 3 of 4 fail. The lead-stages case passes on both.

Review fixes, each failing first on this branch's earlier state (logs
`r1-4a1-inherited.log`, `inherited2`, `perm-bug`):

- An Arabic sub-source took its parent's key and answered 409: "expected {…}
  to match object { key: 'website_بيوت' }".
- An out-of-scope caller editing a lead's phone to a duplicate got the 409,
  which confirmed the lead exists: "expected 409 to be 404".
- The assistant's day spread the `leadScope` function instead of its `where`.
  Every call threw "Lead.findMany was issued without a tenantId filter".

Also green:

- `tests/permission`, `tests/sales` and `tests/ai`: 76 files, 1,455 tests.
- `tests/tenant`, `unit`, `platform`, `security`, `integration`, `identity`
  and `hr` without the retention specs: 182 files, 2,601 tests, 2 skipped.
  The two retention specs alone: 4 and 7 tests.
- `tsc` and prettier are clean. eslint has no errors; its 22 warnings were
  all there before.

Browser, on the rig's dev server:

- `crm-lifecycle` (5 passed): the form takes a phone, On WhatsApp, Website and
  a new sub-source, a campaign, a nationality and tags. The Overview shows
  them, with the WhatsApp button. A tag added in Edit details is still a badge
  after a refresh.
- `lead-eagle-workspace` (1 passed), in a Lead-Eagle-only workspace: the
  administrator adds a sub-source under Website on Admin → Sources, which
  fits 390 px. It is selectable on the lead form, and Source Analysis names
  "Website / <sub-source>".
- `lead-contact-masking` and `workspace-navigation` (11 passed).
- `every-route` (4 passed). Its route lists do not name the Sources screen;
  `lead-eagle-workspace` opens it.
- Sources, the lead form and the lead page were captured at 390 px in light
  and dark themes. None scrolls sideways, and all use tokens only.

**Left open.**

- No entry is set on these leads:
  - Cold data conversions and QR capture: cold data is the M5 lane.
  - The move tool's leads: it still carries the standalone's source as text
    in `sourceDetail`.
- Lead import has no column for nationality, source entry, campaign or the
  WhatsApp flag.
- The Sales dashboards' and the Real Estate dashboard's "by source" tiles
  still group by the enum.
- Correcting an activity by id (`activities/[id]`) still follows the logger or
  the lead's owner, not the second owner.
- The leads list's Mine chip shows the leads the caller owns, not the ones
  they are second owner of. The default list shows both.
- Deactivating a member hands on the leads they own. Leads where they are
  second owner keep them in that role.
- The 409 sentence names the matched field as stored ("phoneNormalized"), as
  create's always has.
