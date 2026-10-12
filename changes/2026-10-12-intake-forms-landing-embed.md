# Lead Eagle gets website forms, landing pages, an embed snippet and a Referral source

**What.** A Lead-Eagle-only workspace now publishes website forms and landing
pages (`/lead-eagle/forms`, `/lead-eagle/landing-pages`, under a new **Lead
Sources** menu area), and so does a Real Estate one (`/realty/forms`,
`/realty/landing-pages`). A submission from a site becomes a lead through the
same intake the portals and QR codes use, with source `PUBLIC_FORM` (shown as
_Public form_) or `LANDING_PAGE` (_Landing page_), and is queued for the
distribution rule. `/embed.js` is a one-line snippet that frames the
workspace's public form on the brokerage's own site. A lead can be recorded as
a _Referral_ with who referred it, and the source reports show Referral as a
source. Audit rows M6-06, M6-07, M6-09, M6-15; M6-27 closed by decision.
Branch `feat/intake-forms-landing-embed-referral`.

**Why.** The Lead Eagle gap audit of 11 Oct: Forms, Landing Pages and Referrals
were `SALES`-only, so a Lead-Eagle-only workspace had no website form beyond the
fixed QR capture page, no landing-page source and no way to record a referral;
nothing served an embeddable snippet. The owner's brief of 12 Oct: add forms and
landing pages to `LEAD_MODULES`, build the snippet, the smaller of the two
referral options, and mark M6-27 complete by decision.

**Where** (under `apps/web/`)

- `src/app/api/v1/forms/route.ts`, `forms/[id]/route.ts`, `landing-pages/route.ts`, `landing-pages/[id]/route.ts`: `productModule: LEAD_MODULES` (was `SALES`).
- `sales/forms/page.tsx`, `sales/landing-pages/page.tsx`: `module: LEAD_MODULES`; `lead-eagle/forms/page.tsx`, `lead-eagle/landing-pages/page.tsx`, `realty/forms/page.tsx`, `realty/landing-pages/page.tsx`: one-line re-exports.
- `src/lib/nav/realtyShared.ts`: `forms` and `landing-pages` join both `REALTY_SHARED_ROOTS` and `LEAD_EAGLE_SHARED_ROOTS`, so the drift guards (`realty-routes.spec.ts`, `lead-eagle-routes.spec.ts`) cover the screens and all four routes.
- `src/lib/nav/workspaceNav.ts`: Lead Eagle → **Lead Sources** and Real Estate → **Lead Sources** (Forms, Landing Pages); the Real Estate and Sales tabs alias the `/lead-eagle/` addresses, as their other shared tabs do.
- `src/app/api/v1/public/forms/route.ts`: a submission goes through `takeEnquiry` (`services/leads/intake.ts`, which now takes `company`): attached to the lead that already holds the number or email, audited in the same transaction, the first-contact clock, distribution and automations; the `FormSubmission` row is kept beside it. Unmapped answers go on the timeline note, except contact details: an unmapped phone answer joins the lead's numbers, an unmapped email answer stays in the submission only. Takes `page` (a landing-page slug) and then records `LANDING_PAGE` / `landing:<slug>` and the page's conversion; a workspace without a lead module answers 404.
- `src/app/f/…/page.tsx`, `src/app/l/…/page.tsx`, `src/app/c/…/page.tsx`: the public form, landing page and QR capture page are a 404 when the workspace has no usable lead module, like their APIs.
- `src/app/f/[workspaceSlug]/[formKey]/LeadForm.tsx`, `src/app/l/.../page.tsx`: the landing page sends its slug; the referer regex is gone.
- `public/embed.js`: reads `data-workspace` / `data-form` off its own script tag and inserts an iframe of `/f/<workspace>/<form>?embed=1` (optional `data-height`, `data-title`); `next.config.ts` caches it for an hour; `src/app/f/.../page.tsx` renders the card alone in embed mode, and `globals.css` drops the page canvas there so the host site shows through; `src/proxy.ts` answers `frame-ancestors *` for `/f/<ws>/<key>` only (`docs/05-SECURITY.md` records the exception); `FormAdmin.tsx` gains **Copy embed code**.
- `prisma/migrations/20261012005000_record_source_referral`: `RecordSource` gains `REFERRAL` (additive). `api/v1/leads/route.ts` accepts it and refuses a referral with no `sourceDetail`; `sales/leads/new/LeadForm.tsx` gets a Source select and a _Referred by_ field; `services/leadership/reports.ts` never reads a referral's detail as an intake key, and looks a detail up only among its own keys.

**Behaviour**

- Lead Eagle and Real Estate menus: Lead Sources → Forms, Landing Pages, the
  same screens Sales has. A form's row offers _Copy link_ and _Copy embed code_
  (`<script src="…/embed.js" data-workspace="…" data-form="…"></script>`).
- A website submission: a new lead with source `PUBLIC_FORM` (the lead shows
  `public form · <form key>`, the reports _Public form_) or `LANDING_PAGE`
  (`landing:<slug>`), implied consent, the email lower-cased, the number
  normalised (E.164, +971 by default), unmapped answers other than contact
  details on the timeline note, an audit row, the SLA clock, then the
  distribution rule. A known number or email attaches the submission to the
  existing lead instead: its owner is told, and a new number from the form is
  added to that lead. A name alone never matches any more. The visitor's answer
  is the same either way.
- A page another site frames: only `/f/<workspace>/<key>`; every other address
  still refuses framing. Framed, the form has no background of its own around
  the card. A workspace whose lead modules have all lapsed has no public form,
  landing page or QR capture page (404 on the pages, the read and the submit).
- New lead form: Source _Manual_ or _Referral_; Referral asks who referred the
  lead (required) and the detail shows on the lead as `referral · <name>`.
  Source analysis, lead quality and source-to-booking list _Referral_, whatever
  the referrer is called.

**Decisions taken**

The brief's defaults, accepted by the owner:

- M6-27: complete by decision (adapter interface accepted as is); no code.
- M6-07: the embeddable snippet is built.
- M6-15: the smaller option: `REFERRAL` is a `RecordSource` value with the
  referrer as free text in `sourceDetail`. The Sales referral register was not
  opened to Lead Eagle.

Taken while building, for the owner to confirm (none of them is in the brief):

- `PUBLIC_FORM` stands for the row's `WEBSITE_FORM`; no new value was added.
  Every existing Sales form lead already carries it, and a second value would
  split the source reports between old and new form leads. Screens show it as
  _Public form_.
- Real Estate gets the two screens and a Lead Sources menu area too. Once the
  gate is `LEAD_MODULES`, a Real-Estate-only workspace may call the forms API.
  Without the screens it had no way to reach them, and after #168 a `/sales/forms`
  link there would be sent to a `/realty/forms` that did not exist.
- A workspace whose lead modules have all lapsed has no public form, landing
  page or QR capture page (404), as the QR capture API already did.
- Sales workspaces' form submissions now go through the portal intake, so a
  repeat that matches only by name makes a new lead instead of attaching to a
  namesake. A number or email match still attaches, and now also tells the owner.
- The embed frame is a fixed height (560 px, `data-height` to change it); a
  postMessage resize is the upgrade if forms grow long.

**Verified.** Every new test fails on the merge base's source (c03f59ae, the
branch's files swapped back) and passes on the branch, except the nameless
referral, which main refuses too. Three forms cases pass on main once only the
forms gate is widened, so they are guards; they are named below.
`tests/sales/forms-lead-eagle.spec.ts` (14): a Lead-Eagle-only admin publishes
a form and a landing page and sees both screens; a Real-Estate-only admin
publishes a form and sees it at `/realty/forms`; a submission becomes a lead
with `PUBLIC_FORM`, the form key, a lower-cased email, implied consent, an
audit row and the timeline note, and the submission itself queued it for
distribution (a spy on `enqueue`) before the rule assigns it; a repeat by email
in another case attaches and notifies the owner; unmapped phone and email
answers stay off the note (the phone joins the lead's numbers); through the
page, `LANDING_PAGE`, the page's count and the queued distribution; an unknown
page, a published page without the form and a paused page with it all give a
plain form lead and score nothing; a lapsed module is 404 on the API and on the
`/f`, `/l` and `/c` pages and makes nothing. On main: `POST /api/v1/forms` 403
_Sales is not enabled for this company_. With only the forms gate widened, 7 of
the 10 submission cases still fail on main (email not lower-cased, no
notification, no note, `page` an unrecognised key, 200 instead of 404). The
guards: the repeat by number, the namesake on another number and the
Real-Estate case pass on main once the gate is widened. Removing the
distribution enqueue from `takeEnquiry` fails the two queued checks, and
dropping `formId` or `state` from the page lookup fails the off-page case.
`tests/sales/embed-snippet.spec.ts` (4; on main: no `public/embed.js`): the
script reads its tag and frames `/f/…?embed=1`, evaluates nothing, is
cacheable; only `/f/<ws>/<key>` may be framed.
`tests/sales/referral-source.spec.ts` (3; on main: `invalid_enum_value …
received 'REFERRAL'`): a Lead-Eagle-only workspace records the referrer; a
nameless referral is 422 (a guard: main refuses it too); both source
reports list Referral, a referrer called `bayut` included (before the fix in
`reports.ts` it was filed under Bayut), and a detail of `__proto__` still gives
a text label. `tests/unit/lead-eagle-routes.spec.ts` (+1),
`tests/unit/realty-routes.spec.ts` (+1, and its walkers now cover the two
Real Estate re-exports and their APIs) and `tests/unit/workspace-nav.spec.ts`
(+2, plus four screen-coverage rows) pin the roots, re-exports, routes and
menus. E2E `tests/e2e/embed-form.spec.ts` (4): a page on another origin with
the script shows the form in a frame with a transparent page around the card,
and a submission becomes the lead; the headers; `/embed.js` is served with
`max-age`; a landing page at `/l/…` credits its lead (`LANDING_PAGE`,
`landing:<slug>`) and its count. On main: no iframe, `embed.js` blocked,
`frame-ancestors 'none'`; on the previous branch head the frame's body was
`rgb(247, 249, 252)`; without the landing page's `page` prop the `/l/` case
fails. `lead-eagle-workspace.spec.ts` (+2 steps; on main: no _Forms_ heading):
the menu, a published form, _Copy embed code_; the new-lead form records a
Referral with _Referred by_. The Forms screen, the new-lead form with Referral
and the embedded form were checked at 390 px in light and dark before the
review round, which changed only the embedded page's background.

Runs on the rig (its own database, 102 migrations), on the branch before the
merge-up with main: the new and touched specs with `growth.spec.ts` and
`lead-eagle-move.spec.ts` 8 files, 706/706; the broad run (`tests/`
permission, sales, tenant, unit, security, platform, integration, identity,
hr, ai; the retention specs apart) 259 files, 4078 passed, 2 skipped;
`retention`, `audit-retention`, `document-purge` one at a time 4/4, 7/7, 1/1;
`tsc --noEmit` clean; eslint (no findings) and prettier clean on the files this round touched; E2E
`embed-form.spec.ts` 4/4 and `lead-eagle-workspace.spec.ts` 1/1.

**Left open**

- For the owner: a website-form or QR submission that matches an existing lead
  by email adds the visitor's number to that lead (as a WhatsApp number, and as
  its main number when it had none), puts their note on its timeline and
  notifies the owner. Anyone who knows a client's email can therefore add a
  number to that client's lead. The number carries the label _Website form:
  <form>_ and the change is audited as `lead.enquired_again`. The QR capture
  route has worked this way since it shipped.
- For the owner: whether website-form leads should read _Website form_ rather
  than _Public form_ (a label, no data change), or carry a `WEBSITE_FORM` value.
- The embed frame does not resize to its form; long forms scroll inside it.
- A referrer is free text; linking a referral to a client record stays with the
  Sales referral register.
- Lead Eagle's starter roles carry no `forms` or `landingpages` grants: the
  Company Administrator publishes forms, and can grant them from Roles.
- `docs/03-API.md` still describes an older `/public/forms/{key}/submit`
  contract (stale before this change).

**Merge-up with main (#165–#168), 13 Oct.** Only `changes/README.md`
conflicted (both rows kept). Under #168's `NotInPlan` the new screens open
under whichever lead product the plan has: `/lead-eagle/forms` and
`/realty/forms` go to `/sales/forms` in a Sales-only workspace, `/sales/` and
`/lead-eagle/` ones to `/realty/` in a Real-Estate-only one, `/sales/` and
`/realty/` ones to `/lead-eagle/` in a Lead-Eagle-only one, and the same for
landing pages; with no lead product the page reads "Forms is part of Sales,
Real Estate or Lead Eagle." A case in `tests/permission/module-entitlement.spec.ts`
holds this. On the merged tree: `tsc --noEmit` clean; the branch's specs with
`page-access` and `module-entitlement` 8 files, 931/931; `tests/` permission,
sales, tenant, unit 159 files, 2828 passed, 2 skipped, and the three retention
specs (which clear each other's rows when run together) one at a time 4/4,
7/7, 1/1; E2E `embed-form.spec.ts` and `lead-eagle-workspace.spec.ts` 5/5.

**Merge-up with main (#169), 13 Oct.** #169 made a lead's source an entry of
the workspace's catalogue (Source, then Sub-source). The new-lead form now has
one Source control, #169's. Choosing the catalogue's Referral entry (key
`referral`, or a sub-source under it) shows this change's required _Referred
by_ and saves the lead as `REFERRAL`, the referrer in `sourceDetail` and the
entry in `sourceId`; any other entry saves `MANUAL` as before. The API's 422 for
a referral that names nobody stands. The lead page reads `Referral · <referrer>`:
the catalogue's label alone would hide who referred it. Website-form and
landing-page submissions keep `takeEnquiry` and land on the Website entry, where
#169 put public-form leads. The source reports keep both rules: #169 groups by
entry, and a referral's detail is still never read as an intake key. Source to
Booking adds the entry and the enum into one Referral row; Source Analysis lists
the entry's "Referral" beside the enum's "referral" (a new case in
`referral-source.spec.ts`). Conflicts: `public/forms/route.ts`, `reports.ts`,
`changes/README.md` (both rows) and `PROJECT.md` (both texts); `LeadForm.tsx`
merged without a marker but with two Source controls. On the merged tree:
`tsc --noEmit` clean; the branch's and #169's specs with `page-access` and
`module-entitlement` 10 files, 969/969; `tests/` permission, sales, tenant,
unit 160 files, 2872 passed, 2 skipped; E2E `embed-form.spec.ts` and
`crm-lifecycle.spec.ts` 10/10.
