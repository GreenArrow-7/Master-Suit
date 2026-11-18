# YOUHAN ONE — product, UI and UX audit

**Date:** 17 November 2026
**Branch inspected:** `feat/live-coaching-first-call` (equal to `main` for every
file in this report)
**Nothing was changed.** This document is the only file this audit added.
**Out of scope by instruction:** the AI assistant and live phone-call assistance.
Where they occupy navigation or screen space I name the fact and stop there.

---

## How to read this report

Every claim is marked:

- **Measured** — counted or read in this checkout. The command or file is named
  so you can repeat it.
- **Assumed** — a designer's judgement from the source. Reasonable, not proven.
- **Unknown** — needs the running app, or usage data, before anyone decides.

**What I did not do, and what that costs.** I did not open the running
application. There are no screenshots in this report, no phone-width check and
no walk-through of a live screen. Every visual verdict below is read from source
— the token file, the ten stylesheets, the navigation model and a sample of
pages. That is enough to judge the *system*; it is not enough to judge how any
one screen actually looks. I also ran no usage query, so **no feature in this
report is called low-value because nobody uses it.** Both gaps are listed as the
first two items of work in Phase 7.

---

# Executive summary

Three findings decide everything else.

**1. The design system is better than the product looks, and the problem is not
the palette.** `apps/web/src/styles/tokens.css` is a deliberate, documented
system: a measured contrast ramp with the ratios written down per surface, a
stated colour budget ("a business state is never a brand colour"), a fluid type
scale, a 4/8 spacing scale, Inter self-hosted with tabular figures, and three
declared responsive tiers. It is the work of someone who knew what they were
doing. **Measured:** of ~727 inline `fontSize` values across the app, 714 are
`var(--lf-text-*)` tokens and only about twelve are raw. Colours and gaps are
tokenised at the same rate. So the usual diagnosis — "random colours, random
sizes, looks machine-generated" — is **not true here**, and a redesign that
starts by replacing the palette would throw away the single best asset in the
codebase.

**2. What is missing is a component layer, and that is what makes screens feel
inconsistent.** **Measured:** `src/components/ui/` holds **8** primitives
(`AiInsight`, `Badge`, `EmptyState`, `MetricCard`, `PageHeader`, `PageSkeleton`,
`QrCode`, `StageRail`). There is no Button, Input, Select, Table, Card, Modal,
Tabs or Toast component. `lf-btn` is typed as a string **1,408 times across 195
files**. `PageHeader` is used on **21 of 213** workspace screens; 45 others hand-
write `<h1 className="lf-h1">`; three header patterns compete. There are **2,440
inline `style={{…}}` objects**, and only **47** of them contain a JavaScript
expression — so roughly **98% are static layout and typography re-decided on
each screen**. Consistency is enforced by a developer remembering the right class
string, not by an API. That is the mechanism behind "it doesn't feel polished".

**3. The product is very large, and the navigation shows the user all of it.**
**Measured:** 213 workspace screens, 16 platform screens, 256 API routes, 11
sidebar sections, 30 work areas, 206 navigation tabs. Worse, the three
lead-selling products overlap: a workspace entitled to **Sales CRM and Real
Estate at once sees both a "CRM" section and a "Real Estate" section**, each
containing Leads, Follow-ups, Tasks, Calls, Site Visits, Allocation, QR Capture
and Cold Data, over the *same database rows*. **Measured:** all 26 `unlessModule`
suppressions in `workspaceNav.ts` gate on HRMS or Sales; the CRM section has
**zero** — it never hides itself.

**The reassuring half of finding 3.** The duplication is in the navigation and in
the user's head, **not in the code**. **Measured:** 41 of 43 `realty/` pages and
**33 of 33** `lead-eagle/` pages are pure `export { default } from '../../sales/…'`
re-exports — 1,282 lines against Sales' 14,700. Redesign a Sales screen and its
Real Estate and Lead Eagle twins change with it. This is the most important fact
for costing the redesign.

**The honest conclusion.** YOUHAN ONE is not an application "filled with
unnecessary features and generic AI-generated UI". It is a large, carefully
engineered product with a good visual vocabulary, no component layer to enforce
it, and a sidebar that exposes its full surface area to every user on day one.
The route to feeling like a modern technology product is **componentisation and
navigation reduction**, not restyling.

---

# Phase 1 — Complete module inventory

**Measured** from `find src/app -name page.tsx` and
`src/lib/nav/workspaceNav.ts`. Module descriptions are reconciled against
`changes/PROJECT.md`, which the project maintains as its own state record.

| # | Module | Folder | Screens | Code lines in pages | Primary purpose |
|---|---|---|---|---|---|
| 1 | **Sales CRM** | `sales/` | 76 | 14,700 | The real implementation of everything: leads, contacts, accounts, opportunities, tasks, follow-ups, calls, campaigns, inbox, forms, landing pages, dashboards, leadership, projects, listings, bookings, collections, commissions, proposals, portals |
| 2 | **Real Estate** | `realty/` | 43 | 1,099 | Brokerage packaging of Sales. **41 of 43 pages are re-exports.** Adds Properties, Events with QR passes, lead recycling |
| 3 | **Lead Eagle** | `lead-eagle/` | 33 | 183 | Lead-management packaging. **33 of 33 pages are re-exports.** Its own sign-in door and sidebar section |
| 4 | **People / HRMS** | `people/` | 32 | 4,670 | Employees, lifecycle, compliance, departments, documents, attendance, roster, shifts, leave, overtime, payroll, payslips, WPS, recruitment, performance |
| 5 | **Administration** | `admin/` | 18 | 2,266 | Users, roles, teams, lead stages, sources, custom fields, email templates, integrations, lead sources, work locations, holidays, settings, data retention, audit log |
| 6 | **Attendance (every workspace)** | `attendance/`, `check-in/` | 4 | — | Check-in, attendance record, requests, face activity. Deliberately **not** gated on HRMS |
| 7 | **Workspace home** | `dashboard/`, `tasks/`, `notifications/` | 3 | 795 (dashboard) | Landing page; every panel gated on its own permission |
| 8 | **My account** | `profile/` | 4 | — | Appearance, notifications, role & access, security |
| 9 | **Platform console** | `(platform)/platform` | 16 | — | Workspaces, plans, subscriptions, monitoring grants. Staff-only, not a customer surface |

**Totals: 213 workspace screens, 229 with the platform console, 249 page files in
the app, 256 API routes.**

## Navigation structure as it exists today

**Measured** — 11 sections, 30 areas, 206 tabs:

| Section | Areas | Notes |
|---|---|---|
| Home | My Workspace, Inbox | Workspace Summary, Check-in, Attendance, Attendance Requests, Face Activity, Team Work, Business Overview |
| CRM | Leads, Customers, Opportunities, Activities, Calls, Daily activity | **Never suppressed by any other module** |
| Real Estate | Overview, Clients (11 tabs), Calendar, Sources, Inventory, Deals | Same records as CRM |
| Lead Eagle | Overview, Leads (10 tabs), Calendar, Sources, Inventory, Reports | Correctly hidden when Sales or Real Estate is present |
| Properties | Inventory | Portals, Buyer Requirements, Proposals |
| Marketing | Campaigns, Lead sources | |
| People | My HR, Employees, Attendance & leave, Payroll, Recruitment, Performance | |
| Finance | Collections, Commissions | |
| Insights | Reports | |
| Administration | Settings — **15 tabs** | |
| Account | My account | |

## Per-module functionality audit

Format per module: purpose · what it does · importance · do users need it ·
complexity cost · is the UI intuitive · verdict.

### 1. Sales CRM — *the engine*

- **What it does.** Lead capture (spreadsheet import with a dry run and a
  refused-rows CSV, web forms, landing pages, portal webhooks, QR capture,
  social sources, referrals), a lead grid with keyset paging, filter chips,
  per-person saved views and a stage board, a paged lead timeline, duplicate
  merge, close-out, Move to Data, bulk assign/stage/tag/task/delete with a
  10-second undo, follow-ups and tasks, call logging, site visits,
  requirements with stock matching, contacts/accounts/opportunities,
  campaigns and a dialer, an inbox, projects/listings/portals/proposals,
  bookings/collections/commissions, targets, reports with CSV and Excel export
  and scheduled email delivery, automation rules.
- **Importance.** Critical. This *is* the product.
- **Do users need it.** Yes — but not all of it on day one. See Phase 2.
- **Complexity cost.** High and partly unavoidable. 76 screens.
- **UI intuitive?** **Unknown without the running app.** The grid, board,
  timeline and filter-chip patterns are soundly specified in CSS. The
  **Measured** risk is that these 76 screens carry the bulk of the 2,440 inline
  style objects, so layout varies screen to screen.
- **Verdict: KEEP. Redesign at the component level, not screen by screen.**

### 2. Real Estate — *packaging*

- **What it does.** Nothing of its own except Properties, Events with QR passes
  and lead recycling. **Measured:** 41 of 43 pages re-export Sales.
- **Importance.** Commercial, not functional — it is how the product is sold to
  brokerages.
- **Complexity cost.** Near zero in code; **high in navigation**, because it adds
  a second full section over the same records.
- **Verdict: KEEP the product, MERGE the navigation.** One workspace should see
  one lead section, named for the product it bought.

### 3. Lead Eagle — *packaging, done right*

- **What it does.** 33 of 33 pages re-export. Its own sign-in door
  (`/login?product=lead-eagle`), its own sidebar section, five editable starter
  roles, its own landing route.
- **Measured:** correctly carries `unlessModule: [SALES, REAL_ESTATE]`, so it
  hides when either is present. **This is the pattern CRM and Real Estate should
  copy.**
- **Verdict: KEEP. It is already the correct model.**

### 4. People / HRMS

- **What it does.** Directory, lifecycle (onboarding/offboarding), compliance
  (expiring visa, Emirates ID, passport, labour card, RERA card), departments,
  documents, attendance, roster, shifts, leave, overtime, payroll, payslips,
  WPS, recruitment, performance, HR reports.
- **Importance.** High for the workspaces that bought it. Independent of Sales.
- **Complexity cost.** Moderate. 32 screens, 4,670 lines — a real second
  implementation, not packaging.
- **Measured problem:** **six screens exist at two URLs each** — `users`,
  `roles`, `work-locations`, `holidays`, `settings` and `reports` live under both
  `admin/` and `people/`; `check-in` and `attendance` live under both `people/`
  and the workspace root. The `people/` copies are thin wrappers over one
  implementation (good), but they are **two sidebar entries for one screen**
  (not good).
- **Verdict: KEEP. MERGE the duplicate entry points.**

### 5. Administration

- **What it does.** 18 screens behind a **15-tab** Settings area: Subscription,
  Data Retention, Lead Stages, Sources, Custom Fields, Email Templates, Users,
  Roles, Allocation, Work Locations, Holidays, Integrations, Channels,
  Automation, Automation.
- **Measured defect:** the Settings area lists **"Automation" twice**. Verify
  against the running sidebar before fixing; it may be two tabs resolving to one
  route.
- **Importance.** High, but it is a setup surface, visited rarely.
- **Complexity cost.** A 15-item flat tab strip is past the point where anyone
  scans it. This is the single worst piece of information architecture in the
  product.
- **Verdict: SIMPLIFY. Group the 15 into four: Lead work · People & access ·
  Integrations · Company & data.**

### 6. Attendance (every workspace)

- Check-in, attendance record, requests, face activity, work locations,
  check-out rules — deliberately available without HRMS, with a documented
  reason. Face check-in has its own Python service (`apps/face`).
- **Verdict: KEEP as is.** The entitlement decision here is correct and
  well-reasoned; do not disturb it.

### 7. Workspace home (`/dashboard`)

- **Measured:** 795 lines. Every panel gated on its own permission with the
  reasoning written in the file ("a sales representative has no business reading
  either"). Headings present: a "Needs attention" block and "Follow-ups across
  the workspace". Four `AiInsight` call sites — **out of scope**.
- **Measured:** the Sales home (`sales/page.tsx`, 603 lines) already uses the
  structure `My day` / `The floor` as visually-hidden headings.
- **Verdict: IMPROVE.** The right structure is half-built already. See Phase 6.

### 8. My account (`profile/`)

- Appearance (three themes), notifications, role & access, security (including
  phones signed in).
- **Verdict: KEEP, SIMPLIFY Appearance** — see the Glass theme in Phase 2.

### 9. Platform console

- Staff-only. **Verdict: OUT OF SCOPE for a customer-facing redesign.** Do not
  spend redesign effort here.

---

# Phase 2 — Candidates for removal or reduction

Nothing in this list should be deleted on the strength of this report alone.
I ran **no usage query**, so no item is here because "nobody uses it".
Each entry says what the evidence actually is.

| # | Item | Why it is a candidate | Impact of removing | Evidence |
|---|---|---|---|---|
| 1 | **The Glass theme** | A third theme that is Dark with translucent surfaces. Costs 22 `backdrop-filter` rules and a parallel surface stack, and the file itself documents having to force tables back to 93% opacity so data stays readable. It is decoration that fights legibility. | One fewer radio on Appearance; two fewer token blocks to keep in sync. No feature lost. | **Measured** — `tokens.css` `[data-theme='glass']`, 22 `backdrop-filter` uses |
| 2 | **The duplicate CRM / Real Estate sections** | One workspace, two sidebar sections, same `Lead`/`Call`/`SiteVisit` rows. | Large reduction in perceived size. Zero code deleted — the routes stay for bookmarks. | **Measured** — CRM section has 0 of 26 `unlessModule` guards |
| 3 | **Eight double entry points** (`users`, `roles`, `work-locations`, `holidays`, `settings`, `reports` under both `admin/` and `people/`; `check-in`, `attendance` under both `people/` and root) | Two sidebar rows per screen. | Shorter sidebar. Routes stay. | **Measured** — directory listing |
| 4 | **The second "Automation" tab** in Settings | Listed twice in one 15-tab strip. | Removes a confusing duplicate. | **Measured** — needs one check in the running sidebar first |
| 5 | **The `--lf-*` token alias layer** | Two names for every colour, ~400 call sites on the old names (the file's own figure). New code is told to use `--yh-*`; nothing enforces it. | No visual change. One vocabulary instead of two. | **Measured** — `tokens.css` alias block; **Measured** in use: inline styles overwhelmingly still reference `--lf-*` |
| 6 | **The five bolt-on "mobile" stylesheets** (`redesign-mobile`, `forms-mobile`, `lists-mobile`, `shell-mobile`, `pages-copy` — 1,381 lines) | Mobile is a correction layer applied after the fact. That is the opposite of the mobile-first goal. | Behaviour must be preserved exactly; this is a refactor, not a deletion. | **Measured** — file names, line counts, "phone-first corrections (2026-09-20)" header |
| 7 | **The 13 off-system breakpoints** | `tokens.css` mandates three tiers and records that twelve ad-hoc breakpoints once caused 22 routes to overflow at 768px. The ad-hoc breakpoints are **back**: 359, 430, 560, 600, 640, 720, 820, 860, 900, 960, 1100, 1180px, 21 uses in all. | Predictable layout at every width. | **Measured** — `@media` scan of all ten stylesheets |
| 8 | **Page descriptions of 150–210 characters** | Good prose, wrong slot. A header subtitle is not where three clauses belong. | Faster scanning. Move the detail into the existing `.lf-help` disclosure, which already exists and is keyboard-reachable. | **Measured** — longest is 208 chars; `.lf-help` has 24 uses |
| 9 | **`changes/PROJECT.md` itself** | The project's own memory file has duplicated paragraphs: "Attendance is not HR" appears twice, "Real AI and telephony" twice, "10-second Undo" twice, and one table cell repeats "Reports (Sales' page, re-exported)" three times. Its own rule is "it has to stay short and current". | Not user-facing, but it is the file every new session reads first, and it is now self-contradicting. | **Measured** — `changes/PROJECT.md` |
| 10 | **Dual lead list surfaces** (grid *and* board, each with its own filter and saved-view machinery) | **INVESTIGATE, do not remove.** Both are specified as reading one query, so the cost is UI, not data. Whether agents use both is unknown. | Unknown. | **Unknown** — needs usage data |

**What I specifically did *not* put on this list**, having looked for it:

- **Excessive animation** — **Measured:** 15 `@keyframes`, 13 `animation:`, 22
  `transition:` across 9,878 lines of CSS. Restrained. Not a problem.
- **Too many gradients** — **Measured:** 31, most of them the two-pixel
  cyan→azure signal hairline and the midnight chrome. Deliberate.
- **Too many colours** — the palette is budgeted and documented. Not a problem.
- **Accessibility neglect** — **Measured:** 404 `aria-*`, 236 `role=`, only 8
  click handlers on a `div`/`span`, 3 `tabIndex`. Sound by the standards of a
  product this size.
- **Generic AI-generated copy** — the product's writing voice is distinctive and
  specific ("Acknowledging is not recovering; recovering needs evidence; writing
  off needs a second person"). It is *too long for the slot*, not generic.

---

# Phase 3 — UI and visual design audit

| Dimension | Finding | Verdict |
|---|---|---|
| **Colour palette** | Midnight `#020817` chrome, `#F7F9FC` canvas, brand blue `#2455E6` as the primary, azure for links/focus, cyan reserved for dark chrome and AI. Status colours deliberately non-brand. The file explains why cyan cannot be the primary (1.7:1 on white). | **Strong. Keep.** |
| **Typography** | Inter everywhere, self-hosted via `next/font` (the file records that naming Inter without loading it once left the whole product silently rendering Segoe UI). Manrope confined to the brand lockup. Fluid `clamp()` above body size; body sizes fixed. Tabular figures on every number. | **Strong. Keep.** |
| **Contrast / readability** | A four-step ink ramp with measured ratios per surface, and a written rule that the one sub-AA step (`faint`) must never carry information. | **Strong. Keep and enforce.** |
| **Spacing and alignment** | A 4/8 scale exists and is used — gaps are `var(--lf-space-*)` at a rate of ~280 of 300. **But** ~900 inline `margin`/`padding` declarations set vertical rhythm per screen. | **IMPROVE** — move rhythm into layout components. |
| **Design consistency** | **This is the weak point.** No Button/Input/Table/Card/Modal component. `lf-btn` typed 1,408 times. Three competing page-header patterns. 2,440 inline style objects, 98% static. | **The main redesign target.** |
| **Cards and surfaces** | `.lf-card` exists as a class with a border-first, shadow-sparingly rule. Composition is still inline per use (the Appearance screen builds a selectable card from eight inline style props). | **IMPROVE** — make it a component. |
| **Buttons and controls** | Specified in CSS (radius 6/8, 44px minimum touch target). No component API, so variants are string conventions (`lf-btn--primary`, and a stray `lf-button--ghost` naming split). | **IMPROVE.** |
| **Icons** | A closed union of **19** icon names in the nav model. Disciplined and small. | **KEEP.** |
| **Navigation** | 11 sections, 30 areas, 206 tabs, one 15-tab settings strip, two sections over the same records. | **SIMPLIFY — highest priority.** |
| **Dashboard layout** | Permission-gated panels, a "Needs attention" block, and a `My day` / `The floor` split already on the Sales home. | **IMPROVE** — finish the pattern. |
| **Responsiveness** | Three tiers declared (≤760 phone / 761–1023 tablet / ≥1024 desktop) and a documented table-becomes-card pattern. **But** mobile lives in five separate "corrections" stylesheets and 13 off-system breakpoints are back in use. | **IMPROVE — structural.** |
| **Right-to-left** | Logical properties (`margin-inline-start`, `inset-inline-end`) used as a rule, physical only where the side is the point. Arabic lays out RTL. | **Strong. Keep.** |
| **Decorative weight** | 15 keyframes, 13 animations, 31 gradients, 89 shadows over 9,878 lines. | **Appropriate. Do not cut.** |
| **Stylesheet health** | `globals.css` is **6,787 lines** in one file, with per-screen sections ("Security screen", "Leave screen", "User directory", "Roles & permissions", "Attendance console"). A global sheet that knows individual screens by name is a component layer that was never extracted. | **IMPROVE — structural.** |

### Why the product does not feel as modern as its own design system

**Assumed**, but tightly reasoned from the measurements:

1. **Layout is re-decided per screen.** 2,440 static inline style objects means no
   two screens are composed quite alike, even though every value is from the
   same scale. The eye reads that as "unfinished", and it is the specific thing
   people mean by "looks generated".
2. **The sidebar discloses everything at once.** 11 sections and 30 areas before
   a new user has done anything. Modern products reveal depth on demand.
3. **Mobile is a correction, not the starting point.** Five stylesheets named
   `*-mobile.css` say so plainly.
4. **Density is governed by tables.** The table-to-card pattern exists, but the
   working surface is a spreadsheet, and spreadsheets do not read as modern on a
   phone.

---

# Phase 4 — Design direction

**The honest recommendation for a "Gen Z" brief on this product: do not change
the palette or the type.** You have a measured, documented, accessible visual
identity. Replacing it with a trend palette would cost you the contrast ramp and
buy nothing a buyer can see. Modern, for a tool people run for eight hours a
day, is delivered through **speed of comprehension, density discipline and
restraint** — not hue.

**Keep, unchanged:** midnight/light surface stack; the four-step ink ramp; brand
blue as the primary and cyan confined to dark chrome; Inter with tabular
figures; the fluid type scale; the 4/8 spacing scale; border-first cards;
logical properties; the 19-icon set; the three responsive tiers.

**Change these five things:**

1. **Build the component layer.** `Button`, `Input`, `Select`, `Field`, `Card`,
   `Table`, `Toolbar`, `Modal`, `Tabs`, `Toast`, `Stack`, `Grid`, `PageLayout`.
   They wrap the classes that already exist, so there is **no visual change on
   day one** — which is exactly what makes the migration safe. Every one of the
   2,440 inline style objects then has somewhere to go.
2. **One lead section per workspace.** Give CRM the same `unlessModule` guard
   Lead Eagle already has. 11 sections become 7.
3. **Four settings groups, not fifteen tabs.**
4. **Make mobile the base layer.** Component styles written phone-first, with the
   two canonical `min-width` tiers layered on; the five `*-mobile.css` files
   retire into the components as they migrate. Enforce the three breakpoints with
   a lint rule so they do not drift a third time.
5. **Headers become one component.** `PageHeader` on all 213 screens, with the
   long description moved into the existing `.lf-help` disclosure.

**Explicitly not doing:** new animations; a new accent colour; rounder corners
(the token file argues 20px "reads as a consumer app, and this is not one" —
agreed); illustration; a marketing-style hero on a working screen.

---

# Phase 5 — Feature prioritisation matrix

| Feature / area | Class | Justification |
|---|---|---|
| Lead capture (import with dry run, forms, portals, QR, social) | **KEEP** | Core. The dry run and refused-rows CSV are genuinely good design. |
| Lead grid (keyset paging, chips, saved views, bulk bar) | **KEEP** | The workhorse screen. |
| Lead board by stage | **INVESTIGATE** | Second surface over one query. Usage unknown. |
| Lead timeline, merge, close-out, Move to Data | **KEEP** | Each solves a named real problem. |
| Follow-ups and Tasks | **KEEP** | |
| Call logging (list, lead page, phone CallWatch) | **KEEP** | |
| Site visits, Requirements, stock matching | **KEEP** | |
| Contacts / Accounts / Opportunities | **INVESTIGATE** | Classic CRM objects beside a lead-centric pipeline. Do brokerages use them? |
| Campaigns + dialer | **INVESTIGATE** | |
| Inbox / Communications | **KEEP** | |
| Projects, Listings, Portals, Proposals | **KEEP** | |
| Collections, Commissions, Recovery | **KEEP** | |
| Reports + CSV/Excel + scheduled email | **KEEP** | |
| Targets | **KEEP** | |
| Automation rules | **KEEP** (and **fix the duplicate tab**) | |
| HRMS, all areas | **KEEP** | Separately entitled, separately implemented. |
| Attendance in every workspace | **KEEP** | Correct entitlement call. |
| Face check-in | **KEEP** | |
| Workspace dashboard | **IMPROVE** | Structure half-built. |
| Sales home (`My day` / `The floor`) | **IMPROVE** | Finish into the three-question pattern. |
| Administration → Settings (15 tabs) | **SIMPLIFY** | |
| CRM section vs Real Estate section | **MERGE** | |
| 8 double entry points (admin ↔ people ↔ root) | **MERGE** | |
| Lead Eagle as a product | **KEEP** | Already the right model. |
| Platform console | **KEEP, out of scope** | Staff surface. |
| Glass theme | **REMOVE** | Decoration that fights legibility. |
| `--lf-*` alias layer | **SIMPLIFY** | One vocabulary. |
| Five `*-mobile.css` sheets | **MERGE** into components | |
| 13 off-system breakpoints | **REMOVE** | The system already mandates three. |
| 150–210-char page descriptions | **SIMPLIFY** | Into `.lf-help`. |
| `globals.css` per-screen sections | **MERGE** into components | |
| Decorative CSS (animation, gradients) | **KEEP** | Already restrained. |
| AI assistant, live call coaching, call audits, practice, playbook, coaching | **OUT OF SCOPE** | By instruction. |

---

# Phase 6 — Module-by-module redesign recommendations

### Sales / Real Estate / Lead Eagle — the lead surface

- **Design problems.** Layout re-composed per screen; three header patterns;
  tables as the primary mobile form; two sidebar sections over one dataset.
- **Functionality problems.** None found in the lead core. The specification is
  coherent and the scope rules are consistent.
- **Direction.** One lead section. One `PageLayout` + `PageHeader` +
  `Toolbar` + `Table` composition, used by all of them.
- **Proposed lead list layout.**
  - *Desktop:* page header (title · one line of context · one primary action)
    → toolbar (search · saved-view chips · filters · export) → table with a
    pinned first column → keyset pager. Bulk bar docks at the bottom on
    selection.
  - *Phone:* sticky search + the chip row scrolling sideways → one card per
    lead showing **name · stage · next action with its due time · owner**, and
    nothing else → a single primary action (Log call) per card. Everything
    further behind the card tap. This is the existing row-as-card pattern,
    reduced to four fields.
- **Content hierarchy.** Next action first, stage second, identity third.
  Today the grid leads with identity.
- **Retain:** every filter, chip, saved view, bulk action, the keyset pager.
- **Remove:** nothing.
- **Improve:** header consistency; mobile card density; one section in the nav.

### Workspace home and Sales home

- **Direction.** Finish the owner's own three-question frame, which the code
  already half-implements:
  1. **How am I doing?** — three figures, no more: today's calls against target,
     follow-ups cleared, leads worked. One row, tabular figures.
  2. **What needs attention?** — the existing "Needs attention" list, as a list
     you act on, not tiles you glance at (the stylesheet already says this:
     *"Attention centre: a list you act on, not chips you glance at"*).
  3. **What should I do next?** — the next three follow-ups by due time, each
     with a one-tap action.
- **Everything else moves below the fold or into Reports.** No tile grid.
- **Manager view:** the same three questions about the team, in the same order.
  Per the earlier decision, **Manager Today stays on hold.**

### Administration

- **Direction.** 15 tabs → 4 groups: **Lead work** (Stages, Sources, Custom
  Fields, Allocation, Automation) · **People & access** (Users, Roles, Work
  Locations, Holidays) · **Integrations** (Integrations, Channels, Lead sources,
  Email Templates) · **Company & data** (Subscription, Data Retention, Audit).
- **Layout.** A two-column settings index on desktop, a single list on phone;
  each group its own page. No 15-item strip at any width.
- **Fix:** the duplicated Automation tab.

### People / HRMS

- **Direction.** Keep the structure. Collapse the six double entry points to one
  each, chosen by where the user is: HR screens under People, platform/access
  screens under Administration. Routes stay for bookmarks.
- **Mobile:** the HR tables already have their own responsive block
  (`Responsive HR tables (H28)`); fold it into the shared `Table` component
  rather than keeping an HR-specific copy.

### Profile

- Remove the Glass option. Two themes, one density setting.
- Rebuild the theme radio using the new `Card` component — it is currently the
  clearest example in the codebase of a card assembled from eight inline style
  props, so it makes a good first migration.

### Platform console

- No redesign. Staff surface.

---

# Phase 7 — Implementation priorities, risks and dependencies

## Priorities

| Order | Work | Why first | Size |
|---|---|---|---|
| 0a | **Open the running app** at phone and desktop width across ~15 representative screens; capture what the source cannot tell you | Every visual verdict above is source-only | Small |
| 0b | **Run the 30-day `AuditLog` usage query** before any INVESTIGATE item is decided | No feature should be cut on inspection alone | Small |
| 1 | **Build the component layer**, wrapping existing classes so day one is visually identical | Unblocks everything else; makes the other work cheap | Large |
| 2 | **One lead section per workspace** (`unlessModule` on CRM) | Biggest perceived-size win for the smallest diff | Small |
| 3 | **Settings: 15 tabs → 4 groups**; fix the duplicate Automation tab | Worst IA in the product | Medium |
| 4 | **`PageHeader` on all 213 screens**; long descriptions into `.lf-help` | Visible consistency win; mechanical | Medium |
| 5 | **Collapse the 8 double entry points** | Shorter sidebar, no code deleted | Small |
| 6 | **Mobile-first migration**: components phone-first, the five `*-mobile.css` sheets retired as each area migrates | The actual "mobile-first" requirement | Large |
| 7 | **Enforce three breakpoints with a lint rule**, then remove the 13 off-system ones | It has already drifted twice | Small, then Medium |
| 8 | **Remove the Glass theme** | Small, clean | Small |
| 9 | **Retire the `--lf-*` aliases** behind a codemod | Pure hygiene; do it last | Medium |

## Risks and dependencies

1. **The redesign surface is 278 files, not 20 components.** 2,440 inline style
   objects live in page and component files. There is no central place to change
   layout today. **This is the single biggest cost driver, and priority 1 exists
   to remove it.**
2. **Re-exports cut the cost by roughly a third.** 74 of the 213 screens are
   re-exports; changing a Sales screen changes its Real Estate and Lead Eagle
   twins automatically. Conversely, **a change to one Sales screen changes three
   products at once** — every redesign PR must be reviewed against all three
   entitlements.
3. **Navigation changes can hide a screen from someone who needs it.**
   `workspaceNav.ts` carries permission and module tokens that mirror what each
   route asserts server-side. The file states that hiding a tab is presentation
   only and the page still refuses an unauthorised role — so the risk is
   *discoverability*, not security. `tests/permission/page-access.spec.ts` and
   the `realty-routes` / `lead-eagle-routes` specs guard the route side.
4. **The three-breakpoint rule has failed twice.** Writing it down did not work.
   Priority 7 must be a lint rule, not a comment.
5. **CSS behaviour change is the real hazard of priority 6.** `globals.css` has
   12 `!important` declarations and per-screen sections; moving rules into
   components can change cascade order. Migrate one area at a time, with a
   phone-and-desktop browser check per area — which is already the project's
   house rule.
6. **Settings regrouping changes URLs.** Keep every current route working; the
   project's own convention is that bookmarks and deep links survive.
7. **The AI surfaces are interleaved with the lead surface.** Playbook,
   coaching, call audits, practice and the live call screen sit inside the same
   sections as Leads and Calls. Reducing the lead section's navigation will
   *touch their placement* even though their design is out of scope. Flagging
   now so it is not a surprise.
8. **`changes/PROJECT.md` is partly stale and self-duplicating.** It is the first
   file every new session reads. Correct it before a multi-PR redesign starts
   leaning on it.

## Master table

| Module | Current problem | Recommendation | Priority |
|---|---|---|---|
| Sales CRM | Layout re-composed per screen; three header patterns | Improve (via components) | **High** |
| CRM nav section | Never suppressed; duplicates Real Estate over the same records | **Merge** | **High** |
| Real Estate | Second full section, 41/43 pages are re-exports | Merge (navigation only) | **High** |
| Lead Eagle | None — already the correct model | Keep | Low |
| Administration → Settings | 15 flat tabs; "Automation" listed twice | **Simplify** | **High** |
| People / HRMS | Six screens at two URLs each | Merge entry points | Medium |
| Attendance (every workspace) | None | Keep | Low |
| Workspace dashboard | Structure half-built | Improve | Medium |
| Sales home | `My day` / `The floor` unfinished | Improve | Medium |
| Shared UI layer (8 primitives) | No Button/Input/Table/Card/Modal; `lf-btn` typed 1,408× | **Improve — build it** | **High** |
| `globals.css` (6,787 lines) | Knows individual screens by name | Merge into components | Medium |
| Five `*-mobile.css` sheets | Mobile is a correction layer | Merge into components | Medium |
| Breakpoints | 13 off-system, 21 uses, where 3 are mandated | **Remove + lint** | Medium |
| Page headers | 21 of 213 use the component | Improve | Medium |
| Page descriptions | 150–210 characters in a header slot | Simplify | Low |
| Profile → Appearance | Three themes; Glass fights legibility | **Remove** Glass | Low |
| Design tokens | Two parallel namespaces, ~400 old call sites | Simplify | Low |
| Contacts / Accounts / Opportunities | Classic CRM objects beside a lead pipeline | **Investigate** | Medium |
| Lead board | Second surface over one query | **Investigate** | Low |
| Campaigns + dialer | Value unclear for a brokerage | **Investigate** | Low |
| `changes/PROJECT.md` | Duplicated paragraphs; its own rule is "short and current" | Simplify | Medium |
| Platform console | — | Keep, out of scope | — |
| AI assistant / live call | — | **Out of scope by instruction** | — |

---

# What I need from you before implementing

1. **Approval of the direction** — in particular that the palette and type scale
   stay, and the effort goes into components and navigation.
2. **A decision on the three INVESTIGATE items** (Contacts/Accounts/
   Opportunities, the lead board, Campaigns + dialer). I will not touch them
   without the usage query and your call.
3. **Permission to run the app and the usage query** (priorities 0a and 0b), so
   the next report has screenshots and numbers instead of source reasoning.
