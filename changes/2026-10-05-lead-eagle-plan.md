# Lead Eagle inside YOUHAN ONE — plan

**Status: approved 5 Oct; the owner's decisions are recorded at the end.**
Follows the decision of 5 Oct ([decision](2026-10-05-lead-eagle-decision.md)).

## The idea

Lead Eagle becomes a product module, `LEAD_EAGLE`, that the platform owner sells
per workspace from the platform portal: Plans, the New Workspace wizard and the
Workspace editor. A Lead Eagle workspace gets a lead-focused brokerage CRM:
leads from portals, ads and QR codes, automatic assignment, follow-ups, calls
with AI help, projects, units and listings, bookings, reports, attendance and
the YOUHAN ONE phone app.

It runs on the same records as Sales and Real Estate (`Lead`, `Call`,
`FollowUpTask`, `Project`, `UnitInventory`, `Listing`, `Booking`, commissions).
There is no second database and no copy of a customer. Moving a workspace from
Lead Eagle to Real Estate or Sales later is switching on a module, not a data
migration.

## What already exists in YOUHAN ONE

Lead Eagle's standalone repository has about 30 screens, 44 tables and an Expo
phone app. Most of it has a working equivalent here, which the module reuses by
one-line re-exports, the way `realty/` reuses `sales/`:

| Lead Eagle | YOUHAN ONE today |
|---|---|
| Dashboard, leads (list, detail, new) | Real Estate dashboard; Sales lead screens |
| Spreadsheet import with column mapping | lead import (Excel and CSV) |
| Lead recycling, proposals | Real Estate recycling; proposals (both ported from Lead Eagle in September) |
| Follow-ups, calls, AI call help, playbook | follow-ups, calls with live coaching, analysis and audits, sales playbook |
| Projects, units, listings, portal publishing | projects, properties, listings, portals |
| Bookings, commission per beneficiary | bookings, collections, commissions |
| Assignment rules, round robin, daily caps, SLA reassignment | `DistributionRule`, allocation, the SLA queue |
| Custom fields, saved views | `LeadCustomFieldDefinition`; smart views |
| Status with required fields | `LeadStage` and `PipelineStage` `requiredFields`, close-out reasons |
| Attendance: face, geofence, check-out quota | check-in, attendance, early check-out, daily target gate (every workspace) |
| Reports, audited export | Real Estate reports, leadership productivity; lead export with its own permission and audit |
| Settings: people, sources, telephony, integrations, audit | admin users, lead sources, integrations, admin audit |
| Phone app | the YOUHAN ONE app (iOS and Android) |

## What is missing — to build on YOUHAN ONE's records

| # | Gap | Size |
|---|---|---|
| 1 | **Inbound leads from portals and ads**: Property Finder, Bayut, Dubizzle, Google Ads lead forms. One signed, idempotent endpoint per source; the raw payload stored first (`WebhookEvent` already does this for Meta); a phone match attaches to the existing lead. | Medium, plus partner credentials |
| 2 | **Several phone numbers per lead**, each with a WhatsApp flag, and phone-first duplicate matching on intake. Today a lead has `phone` and one `secondaryPhone`. | Medium (a migration) |
| 3 | **Sub-statuses with a mandatory reason** (Lead Eagle's contextual status forms), on top of stages' required fields. Touches open decision D-7, the sales stage model. | Small to medium |
| 4 | **QR capture links**: a short branded form behind a QR code, per agent, project or campaign, creating an attributed lead. Builds on Forms. | Small |
| 5 | **Cold data**: import raw contact lists as data, work them, convert the good ones into leads. | Medium |
| 6 | **Assignment explains itself** ("why this agent"), and skips agents outside their working hours. | Small |
| 7 | **Two reports**: follow-up adherence; source performance through to bookings. | Small |
| 8 | **Self-serve sign-up** with workspace templates. Today only the platform owner creates workspaces. | Medium; a business decision first |
| 9 | **Offline actions in the phone app** (Lead Eagle's app queues calls and status changes and replays them). The YOUHAN ONE app is a web view. | Large; recommend later |

## The platform-portal part

- `ModuleKey` gains `LEAD_EAGLE` (one `ALTER TYPE … ADD VALUE` migration) and the
  catalogue gains its entry, which puts it in Plans, the wizard and the
  workspace editor. Reuse this part of #123's branch `feat/lead-eagle-product`,
  not its link-out page.
- Shared brokerage screens and API routes accept `LEAD_EAGLE` as they accept
  Real Estate today (`SALES_OR_REALTY` becomes the brokerage set; #109 did the
  same for Real Estate across 81 routes).
- `lead-eagle/` route folder of one-line re-exports, and a Lead Eagle nav section.
- Attendance needs nothing: it already covers every workspace.

## Phases

1. **The module, live in the platform portal.** Module key, catalogue, a Lead
   Eagle entitlement set for the API routes and shared screens in its scope
   (leads, follow-ups, calls, tasks, assignment, projects, listings, reports —
   not collections, commissions, proposals, portals or events), a "Lead Eagle"
   menu section, re-exported screens, and Sales links redirected the way a
   Real-Estate-only workspace's are. The owner can sell Lead Eagle, and a
   Lead-Eagle-only workspace works end to end on what exists. Checked like Real
   Estate: route drift guard, page access, module entitlement, and a browser
   pass as a Lead-Eagle-only workspace.
2. **Inbound leads** from Property Finder, Bayut and Dubizzle, and Google Ads
   lead forms (gap 1), then several phones and duplicate matching (gap 2).
   Needs each partner's access, which the owner obtains.
3. **Statuses, QR capture, cold data** (gaps 3–5).
4. **Assignment explanations and reports** (gaps 6–7).
5. **Moving the standalone Lead Eagle's customers across.** After phases 2–3, so
   every kind of record has somewhere to land (several phones, sub-statuses,
   cold data). Per company: a dry run against a copy, a count-and-sample check
   per table, then a cut-over while the standalone app is read-only. Bookings and
   commissions move into YOUHAN ONE's shared tables; a migrated company that uses
   them gets Real Estate switched on, so no data is hidden.
6. **Later, if wanted**: self-serve sign-up and the offline phone app (gaps 8–9).

Each phase is its own PR with its `changes/` entry, deployed when the owner says.

## The owner's decisions (5 Oct)

1. **A lighter lead-management product**: leads, intake, assignment, follow-ups,
   calls, attendance, projects and listings. No collections, commissions,
   proposals, portal publishing or events.
2. **"Lead Eagle" in the menu**: the YOUHAN ONE app and sign-in, with a Lead
   Eagle section named as the product.
3. **All three lead sources**: Property Finder, Bayut and Dubizzle, Google Ads.
4. **Move the standalone Lead Eagle's data** (phase 5).
5. Not yet asked, defaulted: a workspace with both Lead Eagle and Real Estate
   shows Real Estate's fuller menu; self-serve sign-up waits for phase 6.

Still needed for phase 5: where the standalone Lead Eagle runs and how its
database is reached, how many companies, users and leads it holds, and when a
cut-over may happen.
