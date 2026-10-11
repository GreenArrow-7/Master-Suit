# Lead Eagle gets website forms, landing pages, an embed snippet and a Referral source

**What.** A Lead-Eagle-only workspace now publishes website forms and landing
pages (`/lead-eagle/forms`, `/lead-eagle/landing-pages`, under a new **Lead
Sources** menu area); a submission from a site becomes a lead through the same
intake the portals and QR codes use, with source _Website form_ or _Landing
page_, and is handed to the distribution rule. `/embed.js` is a one-line
snippet that frames the workspace's public form on the brokerage's own site.
A lead can be recorded as a _Referral_ with who referred it, and the source
reports show Referral as a source. Audit rows M6-06, M6-07, M6-09, M6-15; M6-27
closed by decision. Branch `feat/intake-forms-landing-embed-referral`.

**Why.** The Lead Eagle gap audit of 11 Oct: Forms, Landing Pages and Referrals
were `SALES`-only, so a Lead-Eagle-only workspace had no website form beyond the
fixed QR capture page, no landing-page source and no way to record a referral;
nothing served an embeddable snippet. The owner's brief of 12 Oct: add forms and
landing pages to `LEAD_MODULES`, build the snippet, the smaller of the two
referral options, and mark M6-27 complete by decision.

**Where** (under `apps/web/`)

- `src/app/api/v1/forms/route.ts`, `forms/[id]/route.ts`, `landing-pages/route.ts`, `landing-pages/[id]/route.ts`: `productModule: LEAD_MODULES`.
- `sales/forms/page.tsx`, `sales/landing-pages/page.tsx`: `module: LEAD_MODULES`; `lead-eagle/forms/page.tsx`, `lead-eagle/landing-pages/page.tsx`: one-line re-exports.
- `src/lib/nav/realtyShared.ts`: `forms` and `landing-pages` join `LEAD_EAGLE_SHARED_ROOTS` (the drift guard covers both screens and all four routes).
- `src/lib/nav/workspaceNav.ts`: Lead Eagle → **Lead Sources** (Forms, Landing Pages); the Sales tabs alias the `/lead-eagle/` addresses.
- `src/app/api/v1/public/forms/route.ts`: a submission goes through `takeEnquiry` (`services/leads/intake.ts`, which now takes `company`): attached to the lead that already holds the number or email, audited in the same transaction, the first-contact clock, distribution and automations; the `FormSubmission` row is kept beside it. Takes `page` (a landing-page slug) and then records `LANDING_PAGE` / `landing:<slug>` and the page's conversion; a workspace without a lead module answers 404.
- `src/app/f/[workspaceSlug]/[formKey]/LeadForm.tsx`, `src/app/l/.../page.tsx`: the landing page sends its slug; the referer regex is gone.
- `public/embed.js`: reads `data-workspace` / `data-form` off its own script tag and inserts an iframe of `/f/<workspace>/<form>?embed=1` (optional `data-height`, `data-title`); `next.config.ts` caches it for an hour; `src/app/f/.../page.tsx` renders the card alone in embed mode; `src/proxy.ts` answers `frame-ancestors *` for `/f/<ws>/<key>` only; `FormAdmin.tsx` gains **Copy embed code**.
- `prisma/migrations/20261012004000_record_source_referral`: `RecordSource` gains `REFERRAL` (additive; the 102nd migration). `api/v1/leads/route.ts` accepts it and refuses a referral with no `sourceDetail`; `sales/leads/new/LeadForm.tsx` gets a Source select and a _Referred by_ field; `services/platform/leadEagleMove.ts` maps a standalone "referral" source to it.

**Behaviour**

- Lead Eagle menu: Lead Sources → Forms, Landing Pages, the same screens Sales
  has. A form's row offers _Copy link_ and _Copy embed code_
  (`<script src="…/embed.js" data-workspace="…" data-form="…"></script>`).
- A website submission: a new lead with source _Website form_ (`PUBLIC_FORM`,
  `sourceDetail` the form key) or _Landing page_ (`LANDING_PAGE`,
  `landing:<slug>`), implied consent, the number in E.164, unmapped answers on
  the timeline note, an audit row, the SLA clock, then the distribution rule.
  A known number or email attaches the submission to the existing lead instead
  (its owner is told); a name alone never matches. The visitor's answer is the
  same either way.
- A page another site frames: only `/f/<workspace>/<key>`; every other address
  still refuses framing. A workspace whose lead module has lapsed has no public
  form (404 on read and submit).
- New lead form: Source _Manual_ or _Referral_; Referral asks who referred the
  lead (required) and the detail shows on the lead as `referral · <name>`.
  Source analysis, lead quality and source-to-booking list _Referral_.

**Decisions taken** (the brief's defaults, accepted by the owner)

- M6-27: complete by decision — the adapter interface is accepted as is; no code.
- `PUBLIC_FORM` is the website-form source: it already carries that meaning
  (the audit row itself cites it), so no `WEBSITE_FORM` value was added.
- Referral is a `RecordSource` value with the referrer in `sourceDetail`
  (free text) rather than the Sales referral register opened to Lead Eagle: the
  register lives inside the Clients screen, which is not lead work.
- The public form route checks the workspace's lead entitlement, as the QR
  capture route does: a workspace nobody can open should not collect leads.
- The embed frame is a fixed height (560 px, `data-height` to change it); a
  postMessage resize is the upgrade if forms grow long.

**Verified.** `tests/sales/forms-lead-eagle.spec.ts` (8; fail on main: _Sales
is not enabled for this company_, 403 on `POST /api/v1/forms`): a Lead-Eagle-only
admin publishes a form and a landing page and sees both screens; a submission
becomes a lead with `PUBLIC_FORM`, the form key, a lower-cased email, implied
consent, an audit row and the timeline note, and the rule assigns it; a repeat
from the same number attaches; through the page, `LANDING_PAGE` and the page's
count; an unknown page is a plain form lead; a lapsed module is 404 and makes
nothing. `tests/sales/embed-snippet.spec.ts` (4; fail on main: no
`public/embed.js`, `frame-ancestors 'none'` on `/f/`): the script reads its
tag and frames `/f/…?embed=1`, evaluates nothing, is cacheable; only
`/f/<ws>/<key>` may be framed. `tests/sales/referral-source.spec.ts` (3; fail
on main: `invalid_enum_value … received 'REFERRAL'`, no Referral row): the
referrer recorded, a nameless referral 422, both source reports list Referral.
`tests/unit/lead-eagle-routes.spec.ts` (+1, fails on main) and
`tests/unit/workspace-nav.spec.ts` (+2, fail on main) pin the roots, the
re-exports, the four routes and the menu. E2E `tests/e2e/embed-form.spec.ts`
(2): a page on another origin with the script shows the form in a frame, a
submission becomes the lead, the headers; `lead-eagle-workspace.spec.ts` (+1
step): the menu, a published form, _Copy embed code_. Runs are listed in the PR.

**Left open**

- Real Estate workspaces reach the forms and landing-pages API and pages through
  `LEAD_MODULES` but have no `/realty/` screen or menu entry for them; add the
  re-exports when a Real Estate customer asks.
- The `/f/` and `/l/` pages still render for a workspace whose lead module has
  lapsed; only the submit and read API refuse. The QR capture page behaves the
  same.
- The embed frame does not resize to its form; long forms scroll inside it.
- A referrer is free text; linking a referral to a client record stays with the
  Sales referral register.
