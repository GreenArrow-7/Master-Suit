# Lead requirement, interest links, custom fields and scoring on the lead page

**What.** Four things on a lead, for every lead module:

- **Requirement.** The Overview has a Requirement card: purpose (buy or rent),
  property type and sub-type, bedrooms, budget in AED, areas and the date they
  need it by. It is written under the lead's own scope. An enquiry from a
  portal or Google Ads writes one from what it says it wants.
- **Interest links.** A lead names the projects and listings it asked about,
  from a picker on its page. A project's page lists the interested leads the
  viewer may see. The move tool carries the standalone's project links.
- **Custom fields.** Administration → Settings → Custom Fields defines text,
  number, date and select fields. The Overview shows them and Edit details
  fills them, each checked by type. The lead list can show one as a column.
- **Scoring.**
  - A new lead starts at its source's points, set on the Sources screen.
  - Each logged activity adds its type's points (`ActivityType.scoreDelta`),
    and deleting the activity takes them back.
  - A nightly job takes a workspace rule's points for every period without
    activity. It is off until an administrator switches it on.

This is Lead Eagle part 4A, second half. It is stacked on #169 (lead record
fields).

**Two migrations (104 in all), both additive:**

- `20261013100000_lead_requirement_interest_fields`:
  - `ClientRequirement` gets `subType` and `locations`.
  - `LeadSource` gets `weight`, default 0, so no score changes on deploy.
  - Two join tables, `LeadProject` and `LeadListing`, under forced row-level
    security.
- `20261013110000_lead_score_history_activity`: `LeadScoreHistory` gets a
  nullable `activityId`, the activity a score move was for.

No row is rewritten.

**Why.** The Lead Eagle gap audit of 11 Oct, rows M4-05, M4-06, M4-08, M4-11,
M4-13 and M6-29, part of the owner's brief "Build to completion: Lead Eagle M4
Leads, M5 Cold data, M6 Lead intake". Before this change:

- A requirement lived only in the Requirements register. It could not be
  reached from the lead, had no sub-type, and intake never wrote one, so a
  portal's purpose, type, area and budget stayed note text.
- A lead had no link to a project or listing. The move tool turned the
  standalone's LeadProject rows into a line in the notes, and the areas and
  handover date likewise.
- `LeadCustomFieldDefinition` existed in the schema, but no screen defined a
  field or showed one.
- Nothing read `ActivityType.scoreDelta` or `ScoringRule`. Only the post-call
  AI temperature, imports and the move tool ever set a score.

**Where** (under `apps/web/`)

- `prisma/schema.prisma` and the migration.
- `src/services/leads/requirement.ts`:
  - `openRequirement` reads the lead's open search.
  - `takeRequirement` is intake's write: none when the lead already has an open search.
  - `requirementForPage` gives the possession date as the workspace's calendar day.
- `src/app/api/v1/leads/[id]/requirement/route.ts`:
  - `PUT` the whole requirement, under `leads:EDIT` and `assertLeadInScope`.
  - The possession date is the end of that day in the workspace time zone (`dayBounds`).
  - A different purpose closes the open one and starts another.
  - Audited.
- `src/lib/integrations/leadSources.ts`:
  - `parseEnquiry` now returns `requirement`, from `requirementFrom(wants)`.
  - `requirementFrom` reads purpose (Rent, Lease, RR or CR is renting), type and sub-type, areas, bedrooms ("Studio", "3+") and budget ("60k - 80k", "1.5M").
  - An amount above 1e12 (the composer's ceiling) is left out, so a huge budget cannot overflow the column and lose the enquiry.
- `src/services/leads/intake.ts`: `takeEnquiry` writes the requirement on a new
  lead and on a repeat enquiry, and starts a new lead at its entry's points.
- `src/app/api/v1/leads/[id]/interests/route.ts`:
  - `POST` and `DELETE` take one `projectId` or one `listingId`.
  - Under `leads:EDIT` on the lead's scope.
  - Only a live project or listing of the workspace, and only with `projects:VIEW` or `listings:VIEW`; 404 otherwise.
  - Audited (`lead.interest_added`, `lead.interest_removed`).
- `sales/leads/[id]/`:
  - `page.tsx` loads the requirement, the interests, the active custom fields and the picker options (the first 300 projects by name and the 300 newest listings).
  - The interests are named only to a viewer with `projects:VIEW` or `listings:VIEW`, as the interests API answers.
  - `RequirementCard.tsx` and `InterestsCard.tsx` are new; `LeadDetail.tsx` renders them under the Details card.
  - `LeadDetail.tsx` also shows and edits the custom fields inside Details (`CustomInput`).
  - What Edit details sends is `customPatch` (`src/lib/leads/customPatch.ts`): each changed field, and each required field left empty.
- `sales/projects/[id]/page.tsx`: "Interested leads", through `leadScope`. It lists the 50 most recently updated, and says so when there are more.
- `sales/requirements/[id]/page.tsx`: shows the areas and the sub-type.
- `src/services/leads/customFields.ts`:
  - `leadFields`, `fieldForScreen`.
  - `fieldValue` checks a value by type. A number must be below 1e14, which the value column holds.
  - `withCustomValues` writes `Lead.customData` and the typed `LeadCustomFieldValue` rows.
  - `customForCreate` checks a new lead's `custom` in `createLead.ts` (`POST /api/v1/leads`).
  - `columnFor` moved here from `createLead.ts`.
  - `customColumns` and `customCells` serve the grid. A date column shows DD/MM/YYYY (`ColumnDef.date`).
- `src/app/api/v1/custom-fields/route.ts`:
  - `GET` needs `settings:VIEW`.
  - `POST` and `PATCH ?id=` need `settings:MANAGE_CONFIGURATION` and are audited.
  - The key and the type are fixed once a field exists, and a field is switched off (`isHidden`), never deleted.
  - `productModule: LEAD_MODULES`.
- `admin/custom-fields/` (`page.tsx`, `FieldEditor.tsx`, and `layout.tsx` with `NotInPlan` as #168 does) and a Custom Fields tab in `src/lib/nav/workspaceNav.ts`.
- `src/services/leads/updateLead.ts` and `api/v1/leads/[id]/route.ts`: `PATCH` takes `custom`. The values are checked after the scope check, and the change is audited through `auditDiff`.
- The grid:
  - `src/lib/grid/columns.ts`: `resolveColumns` takes the workspace's extra columns.
  - `api/v1/admin/grid-columns/route.ts` offers and accepts `cf:<key>` for leads.
  - `ColumnEditor.tsx` takes `extra`.
  - `sales/leads/page.tsx`, `sales/smart-views/page.tsx` and `LeadGrid.tsx` (`leadCell`) show the cells. Only those values leave the server, never the rest of `customData`.
- `src/services/leads/scoring.ts`:
  - `applyDelta` and `decayDue` are the arithmetic.
  - `withSourceScore` gives a new lead its entry's points (a sub-source worth nothing takes its source's).
  - `scoreActivity` applies a type's points in the activity's transaction.
  - `unscoreActivity` takes them back when the activity is deleted, net of any earlier take-back.
  - `runScoreDecay` is the nightly sweep.
  - `decayRule` reads the workspace's rule: its first DECAY rule (`FIRST_RULE`), which the sweep also takes.
  - Every move locks the lead's row (`SELECT … FOR UPDATE`) and writes a LeadScoreHistory row with its reason and `activityId`, and an audit row (`fieldKey: score`).
  - A decay step checks again, under the lock, that the lead has had no activity since.
- Callers of `withSourceScore`: `createLead.ts`, `intake.ts`, `services/meta/applyEvent.ts` and `api/v1/public/forms/route.ts`. `scoreActivity` is called from `api/v1/activities/route.ts`, and `unscoreActivity` from `api/v1/activities/[id]/route.ts` (`DELETE`).
- `src/workers/maintenance.ts`: `lead-score-decay` runs at 03:40 UTC.
- `api/v1/lead-scoring/route.ts`: `GET` and `PUT` the workspace's DECAY rule.
- `api/v1/lead-sources/route.ts` takes `weight` (0 to 100).
- `admin/lead-sources/` (`SourceEditor.tsx`, and `ScoreDecay.tsx`, which is new) sets both.
- `src/services/platform/leadEagleMove.ts` and `scripts/move-lead-eagle.ts`:
  - The snapshot carries `projectIds` and `handoverBy`.
  - Interests move as LeadProject links. One on a project that did not move is reported.
  - Areas and the handover date become the requirement's `locations` and `possessionBy`, not notes. The date is stored as the end of that day in the workspace's time zone, as the composer stores one.
- `docs/01-PERMISSIONS.md`: the requirement and the interest links are the lead's.

**Behaviour.** What customers on production see:

- **Lead page.** Two new cards under Details: Requirement and Interested in.
  - A role that edits the lead edits both. A read-only role sees them.
  - "Matching listings" appears only where the viewer may open the
    requirement in the register.
  - Existing requirements of a lead show on its page, the newest open one.
  - A linked project or listing is named only to a role that may see
    projects or listings.
  - Once an administrator marks a custom field required, Edit details will
    not save while that field is empty, whatever else changed.
- **Portal and Google Ads leads.** An enquiry that states a purpose, type,
  area, bedrooms or budget now also creates a requirement on the lead. It has
  no owner until someone sets one: the register's list shows it to
  organisation-wide roles only, and the lead page shows it to everyone who
  sees the lead. An enquiry from someone selling, or one that states nothing,
  writes none. The note on the timeline is unchanged.
- **Projects.** A project page has an "Interested leads" section for roles
  that see leads: the 50 most recently updated, with a line saying so when
  there are more.
- **Custom Fields.** A new tab under Administration → Settings, in Sales, Real
  Estate and Lead Eagle workspaces. Nothing is defined on deploy, so no lead
  page changes until an administrator adds a field.
- **The create API.** `POST /api/v1/leads` keeps any `custom` key no field
  defines, as before. Once a field is defined, its key's value is checked by
  type: a wrong one answers 422 naming the field, where it used to fail with
  a 500 or be stored unchecked. An empty one is left out. A required field is
  not asked for on create.
- **Sources.** Each entry has "Starts at" (0 for all). Under the list is a
  "Lead score" card with the decay switch (off).
- **Scores.** Logging an activity whose type carries points moves the lead's
  score:
  - Outbound call +3, incoming call +8, meeting +12, email sent +1,
    follow-up completed +3 in workspaces provisioned with those types.
  - The demo seed's types carry their own points.
  - Before, scores never moved on an activity.
  - Deleting an activity takes back what it added. An activity logged before
    this change added nothing, so deleting it takes nothing.

  A lead's score stays between 0 and 100. The AI temperature an agent applies
  still sets the score outright, and events move it from there.

- **Move tool.** A moved lead's projects are links, not a line in its notes.
  Its areas and handover date are on its requirement, the date as the end of
  that day in the workspace's time zone.

**Decisions taken.** The brief marks no DECISION in these rows. These are design choices (mine, not the owner's):

- Scores move by event rather than being recomputed from all activities, so
  the AI temperature, imports and the move tool's carried score keep their
  meaning. Each event is a LeadScoreHistory row. Deleting an activity takes
  back what it actually moved the score by, after the 0 to 100 clamp.
- The source weight is a column on `LeadSource`, as the standalone has it. It
  sets only a new lead's starting score: changing a lead's source later does
  not rescore it. All weights start at 0.
- Decay is one `ScoringRule` per workspace (triggerType `DECAY`). Each night
  it takes `decayAmount` for every `decayDays` without activity, counted from
  the last activity or the last step. It applies to open leads in an open
  stage, and is off by default. A run up to an hour early still counts the
  day. If two administrators saving at once leave a second rule, the first
  one is the workspace's, everywhere.
- The requirement on the lead page is scoped like the lead (`leads:EDIT`), not
  by the register's `requirements` permission. Its owner is the lead's owner
  when the composer creates it.
- Purpose stays Buy or Rent, as the register has it. "Invest" is buying, and
  "Sell" writes no requirement. A budget with no purpose is taken as buying.
  Audit row M4-05 lists buy, rent, sell and invest, so M4-05 is closed pending
  the owner's confirmation of this (see Left open).
- Areas are free text (`locations`). Matching still keys on micromarkets, which
  no screen creates yet.
- Custom field keys are lower-case, so they never meet the system's camelCase
  entries in `customData`. A field is switched off, never deleted. Only the
  four types the brief names are offered. Field-level security is untouched.
- The interest pickers are plain selects of the first 300.
- A required custom field is enforced by Edit details, which sends it empty
  so the server refuses it by name. It is not enforced on every `PATCH`, or a
  stage move from another screen would fail on a field nobody filled.
- The create API checks the values of defined fields and keeps other keys, so
  an integration that sends its own keys keeps working.

**Verified.** On the rig (scratch database at 102 migrations plus these two; logs `C:/ymw/logs/r2-4a2-*.log`).

New and touched specs, all green (`new-final`: 9 files, 228 tests):

- `tests/unit/lead-scoring.spec.ts` (new, 7 cases): the arithmetic, pinned —
  20 + 3 + 12 = 35, two 5-point steps give 25, both ends, rounding; one step
  per period, the next counted from the last step or a later activity, and the
  hour's grace.
- `tests/sales/lead-scoring.spec.ts` (new, 8 cases):
  - An outbound call moves 10 to 13 with its history and audit rows; a type
    worth nothing writes nothing; 99 stops at 100.
  - Weights from the Sources API (101 refused); a sub-source worth nothing
    starts at its source's; an enquiry starts at its entry's.
  - Decay is off without a rule. The scoring API reads and writes it, and
    refuses 0 days.
  - Decay takes 30 to 25 once, never below 0, not on a fresh, closed-out or
    other workspace's lead. A second run that night does nothing, a week later
    takes 20, and switched off stops.
  - The job is registered.
- `tests/sales/lead-requirement.spec.ts` (new, 9 cases):
  - The composer stores every field; 1 March in Dubai becomes
    `2027-03-01T19:59:59.999Z`. It edits in place, and a new purpose closes
    the old.
  - Upside-down budgets and bedrooms, 30 February and "SELL" are refused.
    Another agent's or workspace's lead answers 404.
  - The lead page shows it, and offers the matches link only with
    `requirements:VIEW`; the register's page shows areas and sub-type.
  - The possession date is matched against `availableFrom`.
  - `requirementFrom` on four portal wordings. A Property Finder enquiry with
    a budget writes one row, shown on the lead page, audited as System and
    matching a listing; a repeat enquiry adds none, and an enquiry stating
    nothing writes none.
- `tests/sales/lead-interest-links.spec.ts` (new, 6 cases):
  - Links once each, audited.
  - Neither or both, a deleted project, another workspace's project or
    listing, and a listing without `listings:VIEW` all answer 404 or 422.
  - Another's lead answers 404. Links are removed.
  - The pickers offer only what the viewer sees.
  - The project page lists only the viewer's leads.
- `tests/sales/custom-fields.spec.ts` (new, 11 cases):
  - Defining all four types. A key in use answers 409; a select with no
    options, a type not offered and a key that is not plain answer 422.
  - Renaming, reordering, options and switching off work; key and type are
    fixed.
  - The permissions, and another workspace answering 404.
  - The screen.
  - An OWN agent filling values, typed rows written and `metaLeadgen` kept,
    cleared values removed.
  - Each wrong value refused with its label. Another's lead answers 404
    first.
  - The Overview shows them; the grid column through the column API and the
    leads page.
  - A Lead-Eagle-only workspace defines and fills one; a workspace with no
    lead product answers 403.
- `tests/platform/lead-eagle-move.spec.ts`:
  - Notes no longer carry the interest line.
  - The requirement has `locations` and `possessionBy`.
  - A LeadProject link to the moved project exists.
  - The dry run counts 3 interest links, moves 2, and reports the one on a
    deleted project.
- `tests/unit/lead-eagle-routes.spec.ts`: the screen, both APIs and the layout
  admit `LEAD_MODULES`, and the tab is offered.
- `tests/permission/module-entitlement.spec.ts`: an HR-only workspace gets "Custom fields is part of Sales, Real Estate or Lead Eagle."
- `tests/sales/meta-apply-event.spec.ts`: its mocked database now has
  `leadSource`, and a Meta lead starts at its entry's 10 points.

Fail-before, with `apps/web/src` and `scripts` put back to the base, origin/feat/lead-record-fields:

- With the base source alone (`baseA`), all 8 files fail:
  - The new specs cannot load: no `/api/v1/leads/[id]/requirement`,
    `/interests`, `/custom-fields`, `/lead-scoring` or `services/leads/scoring`.
  - 5 route cases and the layout case fail with ENOENT.
  - The move tool throws "Cannot read properties of undefined (reading 'length')".
- With only the new files added (`baseB`), 24 cases fail:
  - "expected 10 to be 13" and "expected 99 to be 100" (no scoring on an
    activity); "expected +0 to be 20" (no source weight).
  - "expected [ 'retention', … ] to include 'lead-score-decay'".
  - "requirementFrom is not a function"; "expected undefined to match object
    { purpose: 'BUY', … }" (intake wrote none).
  - The lead page: "expected '…' to contain 'Duplex'", "… 'Marina Heights'",
    "… 'Visa'". The project page: "… to contain 'Interested leads'".
  - "Unrecognized key(s) in object: 'custom'", "expected 422 to be 404",
    "expected '1 field failed validation' to contain 'Family size'".
  - "expected [ 'reference', … ] to include 'cf:visa_status'"; the nav case.
- With the old snapshot field put back in the move spec (`baseC`), 2 cases fail:
  - "expected { …(74) } to match object { fullName: 'Aisha Karim', … }": the notes still carried the interest.
  - The problems list lacked the interest-link line.

Also green:

- `tests/permission`, `tests/sales` and `tests/ai`: 80 files, 1,511 tests
  (`wide1`). It had 6 failures, all in `meta-apply-event.spec.ts`, whose
  mocked database lacked `leadSource`. Fixed in the spec; 18 of 18 pass
  (`meta`).
- `tests/tenant`, `unit`, `platform`, `security`, `integration`, `identity`, `hr` and `diagnostic`, without the two retention specs (`wide2`):
  - 183 files: 2,623 passed, 2 skipped and 2 failed.
  - Both failures were "Unable to start a transaction" under load, in
    `assistant-guardrails` and `realty-dashboard`. Run alone they pass, 38 of
    38 (`wide2b`).
  - The retention specs alone: 4 and 7.
- `tsc`, eslint and prettier:
  - `tsc` is clean (`tsc2`).
  - eslint has no errors. Its warnings are `no-explicit-any` in files that
    had them; two came with `columnFor`.
  - prettier is clean.
- `scripts/check-rls.mjs`: 198 tables RLS-forced. `check-raw-sql-scope.mjs`
  is clean. Schema drift against the migrated rig database is empty.

Browser, on the rig's dev server:

- `lead-requirement-interest` (new, 1 passed, in a Lead-Eagle-only
  workspace, at 390 px where stated):
  - The administrator adds a select field (390 px).
  - The composer saves a requirement that is still there after a reload
    (390 px).
  - Edit details fills the field, still there after a reload.
  - A project picked as an interest links to its page, which lists the lead
    (390 px).
  - An outbound call logged on the lead makes the score 3.
  - Its first run failed at sign-in on a cold `.next`.
- `crm-lifecycle` (6), `lead-contact-masking` (3) and `lead-eagle-workspace`
  (1) passed. `lead-eagle-workspace` passed on its second run: the first
  failed at #168's soft-navigation step on a cold `.next`.
- The lead page (Overview, composer, Edit details), Custom fields, Sources and
  the project page were captured at 390 and 1280 px, in light and dark.
  None scrolls sideways at 390 px; all use tokens only.

Review round, 13 Oct (logs `r2-4a2-rv-*`). Fourteen cases were added to the
specs above. Four files had cases added or changed:

- `lead-scoring` (13 cases):
  - A deleted activity takes its 3 points back, once.
  - Two activities logged at the same moment give 16, not 13.
  - A lead in a won stage keeps its score; one never worked decays from when
    it came in.
  - A second, active decay rule does nothing while the first is off.
  - Points and decay need `settings:MANAGE_CONFIGURATION`.
  - The 03:40 schedule is armed.
- `lead-requirement` (12 cases):
  - New York's 1 March is stored as `2027-03-02T04:59:59.999Z`, and the page
    shows 1 March.
  - A 17-digit or 400-digit budget is left out, and that enquiry still
    becomes a lead.
  - A repeat enquiry stating a budget writes the requirement the first did
    not.
  - A role that only views the lead gets 403.
- `lead-interest-links` (9 cases):
  - A listing linked to the lead is not named to a role without
    `listings:VIEW`.
  - A view-only role gets 403 on adding and removing.
  - A projects-only role sees no "Interested leads".
  - 51 interested leads show 50 and the line.
- `custom-fields` (14 cases):
  - `customPatch` sends an empty required field with an unrelated edit, and
    the server refuses it by name.
  - The create API answers 422 for "1.5M" and 1e15, stores typed values and
    keeps a key no field defines.
  - `1e15` on `PATCH` answers 422.
  - The leads list and a smart view show the date column as 30/06/2027.
  - Only chosen columns leave `customData`.
- `lead-eagle-move`: the moved handover date is `2027-01-31T19:59:59.999Z`.

Fail-before on the branch's own source (`git checkout HEAD -- apps/web/src`,
with only the new `customPatch.ts` kept; `rv-failbefore`): 12 cases fail.

- "expected 13 to be 10" (delete) and "expected 13 to be 16" (race).
- "expected 25 to be 30" (second rule).
- "expected 500 to be 422" on `PATCH` and `POST` (1e15, "1.5M").
- "… to contain '30/06/2027'"; `customCells` gave the raw date.
- "… not to contain 'Two-bed in Marina Heights'".
- "… to contain 'Showing the 50 most recently updated'".
- `requirementFrom` kept the 17-digit budget, and the intake case failed with
  a numeric field overflow (P2020-class `PrismaClientKnownRequestError`).
- "expected '2027-01-31T00:00:00.000Z' to be '2027-01-31T19:59:59.999Z'".

Without `customPatch.ts` the custom-fields file cannot load. The cases that
pass on the branch's source are added coverage: the time zone, the repeat
enquiry, the 403s, the projects-only page, the won stage and the schedule.

After the fixes:

- New and touched specs (`rv-new`): 9 files, 242 tests, all green.
- `tests/permission`, `tests/sales` and `tests/ai` (`rv-wide1`): 80 files,
  1,525 tests, all green.
- `tests/tenant`, `unit`, `platform`, `security`, `integration`, `identity`,
  `hr` and `diagnostic`, without the retention specs (`rv-wide2`): 183 files,
  2,625 passed and 2 skipped. The retention specs alone: 4 and 7.
- `tsc` is clean (`rv-tsc`). eslint has no errors; its warnings are the
  existing `no-explicit-any`. prettier is clean.
- `check-rls` (198 tables) and `check-raw-sql-scope` (35 raw statements, the
  new `FOR UPDATE` read among them) are clean. Schema drift is empty after
  the second migration.
- E2E (`rv-e2e1`–`3`): `lead-requirement-interest` passed. `crm-lifecycle`
  and `lead-contact-masking` (9) passed. `lead-eagle-workspace` failed once,
  at #168's soft-navigation step, and passed on its rerun.

**Merge-up with main (round 1), 13 Oct.** Main has #169 squashed (the same
tree as the #169 head this branch was built on), #171 and #170. Merged on that
head, four files conflicted:

- `services/leads/intake.ts`: `takeEnquiry`'s enquiry takes this change's
  `requirement` and #170's `company`.
- `api/v1/public/forms/route.ts`: main's version. #170 sends a website-form or
  landing-page submission through `takeEnquiry`, which already starts a new
  lead at its entry's points (the Website entry), so the route no longer calls
  `withSourceScore` itself.
- `changes/README.md`: every row, newest first.
- `PROJECT.md`: both texts. Real Estate 40 and Lead Eagle 29 screens (counted
  on the merged tree); Custom Fields and the source score beside #170's forms,
  landing pages and Targets.

Merged without a marker and read: `LeadDetail.tsx` (#170's
`Referral · <referrer>` beside the Requirement, Interested in and custom-field
cards), `schema.prisma`, `workspaceNav.ts`, `lead-eagle-routes.spec.ts` and
`module-entitlement.spec.ts`. The new-lead form keeps #170's one Source
control. A cold call (#171) is logged by `logColdCall`, not the activities
API, so it moves no score, and moving it onto a lead at conversion adds none.
On the merged tree (106 migrations): `tsc --noEmit` clean. The branch's specs
(those it adds or changes against main) with `lead-record-fields`,
`lead-source-intake`, `referral-source`, `forms-lead-eagle`, `cold-data`,
`cold-call-activity`, `lead-eagle-routes`, `workspace-nav`,
`module-entitlement` and `page-access`: 23 files, 1,346 passed and 1 failed, a
transaction timeout in `lead-record-scope`, which passes alone (341/341).
`tests/` permission, sales, tenant and unit: 166 files, 161 green;
`lead-record-scope`, `fee-amendments`, `lead-interest-links` and
`provision-lead-work` timed out under load and pass alone (51/51 for the last
three), and `retention` passes alone (4/4). E2E on a fresh `.next`:
`lead-requirement-interest` and `crm-lifecycle` 7/7; `lead-eagle-workspace`
failed once at #168's soft-navigation step and passed on its rerun. eslint is
clean on the two code files; `README.md` and `PROJECT.md` fail prettier on
main as on the branch.

**Left open.**

- The requirement's owner does not follow the lead's owner when the lead is
  reassigned or assigned by distribution. An intake requirement has none until
  edited in the register, so the Requirements list shows it to
  organisation-wide roles only. The lead page shows it to everyone who sees
  the lead.
- `PATCH /api/v1/requirements/{id}` accepts any `ownerId` without
  `assertAssignableUser`. That is pre-existing.
- Areas are not matched. A micromarket registry screen, or name matching,
  would let them be.
- Activity types and their points have no screen; the provisioning defaults
  apply. Calls placed through the dialer (`Call`) and follow-up emails do not
  score; only a logged activity does. `ScoringRule.maxPerDay` is not applied.
- The lead form and import have no custom fields. A field's `isSensitive` is
  not masked.
- For the owner: audit row M4-05 lists buy, rent, sell and invest as
  purposes; this keeps Buy and Rent (Invest as Buy, Sell writes none). If Sell
  and Invest must be kept, they need a column of their own on the requirement.
- Listings have no "interested leads" section; projects do.
- The pickers list the first 300 projects and listings; a search box is
  needed when books are bigger.
