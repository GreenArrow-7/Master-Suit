# Section 1 — Application module and functionality inventory

Read off commit `1b8226f9` on 6 November 2026. See [README.md](README.md) for
the standing caveat: this is the repository, not production.

## 1.1 What the application is

YOUHAN ONE is a multi-tenant SaaS application for UAE real-estate brokerages.
One company is a **workspace** (a tenant). Everything a workspace user sees and
does is confined to that workspace. Above the workspaces sits a **platform
console** run by the vendor, which creates workspaces, sells them product
modules and watches the system's health.

The whole application is one Next.js codebase (`apps/web`) run in two process
roles from two stages of one Dockerfile:

- `PROCESS_ROLE=web` — the pages, `/api/v1/*` and `/api/mobile/*`.
- `PROCESS_ROLE=worker` — the background queues, the schedulers and the
  live-call WebSocket server.

A tester never sees the split, but it matters: anything the expected result calls
"a moment later" or "within five minutes" happens in the worker process. If the
worker is not running, those outcomes never arrive — and the UI will not say so.
Every such case below names the queue so a Blocked result can be diagnosed.

**Measured at this commit:** 249 page files (213 workspace, 16 platform), 256 API
route files (241 under `/api/v1`, 12 under `/api/mobile`), 231 Prisma models,
126 migrations, 47 tables with Postgres row-level security enabled, 11 background
queues, 12 armed schedules, 25 seeded roles, 66 permission modules, 4 product
modules.

## 1.2 The four product modules

A workspace is entitled to zero or more of these. Entitlement is sold by the
platform, not chosen by the company.

| Key           | Label on screen | Sold as                                                                                     |
| ------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `SALES`       | Sales CRM       | Leads, opportunities, accounts, activities, campaigns and reporting                         |
| `HRMS`        | People / HRMS   | Employees, attendance, leave, shifts, documents and organisation                            |
| `REAL_ESTATE` | Real Estate     | Brokerage leads, property inventory, site visits, bookings and commissions                  |
| `LEAD_EAGLE`  | Lead Eagle      | Lead management for brokerages: leads, follow-ups, calls, assignment, projects and listings |

_Source: `apps/web/src/lib/modules/catalogue.ts`_

Three entitlement groupings are enforced in code, and they are the reason some
screens appear under more than one product:

| Grouping          | Members                        | Used by                                                                                                                    |
| ----------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `LEAD_MODULES`    | SALES, REAL_ESTATE, LEAD_EAGLE | Leads, follow-ups, calls, tasks, activities, site visits, requirements, allocation, projects, listings, documents, reports |
| `SALES_OR_REALTY` | SALES, REAL_ESTATE             | Collections, commissions, proposals, portals, events                                                                       |
| (none)            | —                              | Check-in, own attendance, own tasks, notifications, profile — self-service, no module gate at all                          |

_Source: `apps/web/src/lib/security/entitlements.ts`_

**Testing consequence, and it is not obvious:** the same screen lives under
`/sales/…`, `/realty/…` and `/lead-eagle/…`. The page files live under
`sales/` and the other two re-export them. So a Lead Eagle workspace reaching
`/{slug}/lead-eagle/leads` runs the same code as a Sales workspace reaching
`/{slug}/sales/leads`. Test the path the workspace's own menu offers, and treat
the other paths as authorization cases ([07](07-tenancy-authz.md)).

### Module interaction that will surprise you

With **all four** modules entitled, the **Lead Eagle section disappears from the
navigation entirely** — Real Estate carries the same screens, so the nav hides
the duplicate. Lead Eagle's own area only appears when the workspace does _not_
hold Real Estate. This is deliberate (`unlessModule` in the navigation model) and
is covered by `LE-NAV-001` and `LE-NAV-002`.

_Source: `apps/web/src/lib/nav/workspaceNav.ts`_

## 1.3 Navigation, as the code builds it

The sidebar is generated from one model, filtered by (a) the workspace's
entitled modules and (b) the permission tokens the signed-in role holds. The
tables below are that model rendered for a workspace holding **all four**
modules and a role holding **every** permission — the maximum menu. A real
tester sees a subset.

Slug placeholder: `{slug}` is the workspace slug in the URL.

### Home

| Area         | Tab               | Path                                    | Permission |
| ------------ | ----------------- | --------------------------------------- | ---------- |
| My Workspace | Workspace Summary | `/{slug}/dashboard`                     | —          |
| My Workspace | Sales Overview    | `/{slug}/sales`                         | —          |
| My Workspace | Team Work         | `/{slug}/sales/leadership?view=chasing` | `reports`  |
| My Workspace | Business Overview | `/{slug}/sales/leadership`              | `reports`  |
| My Workspace | Team Feed         | `/{slug}/sales/engagement`              | `posts`    |
| Inbox        | All               | `/{slug}/notifications`                 | —          |

Without SALES but with LEAD_EAGLE or REAL_ESTATE, My Workspace instead carries
**Check-in**, **Attendance**, **Attendance Requests** and **Face Activity**.

### CRM (SALES)

| Area             | Tab                | Path                                      | Permission                        |
| ---------------- | ------------------ | ----------------------------------------- | --------------------------------- |
| Leads            | All Leads          | `/{slug}/sales/leads`                     | `leads`                           |
| Leads            | My Leads           | `/{slug}/sales/leads?filter=mine`         | `leads`                           |
| Leads            | Unassigned         | `/{slug}/sales/leads?filter=unassigned`   | `leads`                           |
| Leads            | Saved Views        | `/{slug}/sales/smart-views`               | `smartviews`                      |
| Leads            | QR Capture         | `/{slug}/sales/capture-links`             | `leads`                           |
| Leads            | Cold Data          | `/{slug}/sales/cold-data`                 | `leads`                           |
| Customers        | Contacts           | `/{slug}/sales/contacts`                  | `contacts`                        |
| Customers        | Accounts           | `/{slug}/sales/accounts`                  | `accounts`                        |
| Customers        | Conversations      | `/{slug}/sales/communications/inbox`      | `communications`                  |
| Customers        | Client Profiles    | `/{slug}/sales/clients`                   | `clientprofiles`                  |
| Customers        | Testimonials       | `/{slug}/sales/clients?view=testimonials` | `clientprofiles` + `testimonials` |
| Customers        | Referrals          | `/{slug}/sales/clients?view=referrals`    | `clientprofiles` + `referrals`    |
| Customers        | Service            | `/{slug}/sales/service`                   | `tickets`                         |
| Customers        | Documents          | `/{slug}/sales/documents`                 | `documents`                       |
| Opportunities    | List               | `/{slug}/sales/opportunities`             | `opportunities`                   |
| Activities       | Tasks & Follow-ups | `/{slug}/sales/follow-ups`                | `leads`                           |
| Activities       | My Tasks           | `/{slug}/tasks`                           | `tasks`                           |
| Activities       | All Tasks          | `/{slug}/sales/tasks`                     | `tasks`                           |
| Activities       | Calendar           | `/{slug}/sales/calendar`                  | `tasks`                           |
| Activities       | Viewings           | `/{slug}/sales/site-visits`               | `visits`                          |
| Activities       | Activity Log       | `/{slug}/sales/activities`                | `activities`                      |
| Activities       | Field Sales        | `/{slug}/sales/field-sales`               | `fieldsales`                      |
| Calls & Coaching | Calls              | `/{slug}/sales/calls`                     | `calls`                           |
| Calls & Coaching | Call Audits        | `/{slug}/sales/call-audits`               | `calls`                           |
| Calls & Coaching | Coaching           | `/{slug}/sales/coaching`                  | `calls`                           |
| Calls & Coaching | Playbook           | `/{slug}/sales/playbook`                  | `calls`                           |
| Calls & Coaching | Practice           | `/{slug}/sales/practice`                  | `calls`                           |
| Daily Activity   | Today              | `/{slug}/sales/leadership?view=daily`     | `reports`                         |

Daily Activity is its own area, **not** a tab under Reports. Its gate is
`reports` + SALES. A code comment records the move as deliberate: a manager opens
it every morning, which is not where Reports lives.

### Properties (SALES)

| Area               | Tab                | Path                         | Permission     |
| ------------------ | ------------------ | ---------------------------- | -------------- |
| Property Inventory | Projects           | `/{slug}/sales/projects`     | `projects`     |
| Property Inventory | Listings           | `/{slug}/sales/listings`     | `listings`     |
| Property Inventory | Portals            | `/{slug}/sales/portals`      | `listings`     |
| Property Inventory | Buyer Requirements | `/{slug}/sales/requirements` | `requirements` |
| Property Inventory | Proposals          | `/{slug}/sales/proposals`    | `requirements` |
| Property Inventory | Products           | `/{slug}/sales/products`     | `products`     |

### Marketing (SALES)

| Area         | Tab            | Path                          | Permission     |
| ------------ | -------------- | ----------------------------- | -------------- |
| Campaigns    | Campaigns      | `/{slug}/sales/campaigns`     | `campaigns`    |
| Campaigns    | Events         | `/{slug}/sales/events`        | `events`       |
| Lead Sources | Forms          | `/{slug}/sales/forms`         | `forms`        |
| Lead Sources | Landing Pages  | `/{slug}/sales/landing-pages` | `landingpages` |
| Lead Sources | Social Sources | `/{slug}/sales/social-leads`  | `leads`        |

### Real Estate (REAL_ESTATE)

| Area         | Tab           | Path                                                               | Permission     |
| ------------ | ------------- | ------------------------------------------------------------------ | -------------- |
| Dashboard    | Dashboard     | `/{slug}/realty/dashboard`                                         | `leads`        |
| Leads        | Leads         | `/{slug}/realty/leads`                                             | `leads`        |
| Leads        | Follow-ups    | `/{slug}/realty/follow-ups`                                        | `leads`        |
| Leads        | Tasks         | `/{slug}/realty/tasks`                                             | `tasks`        |
| Leads        | Calls         | `/{slug}/realty/calls`                                             | `calls`        |
| Leads        | Playbook      | `/{slug}/realty/playbook`                                          | `calls`        |
| Leads        | Site Visits   | `/{slug}/realty/site-visits`                                       | `visits`       |
| Leads        | Requirements  | `/{slug}/realty/requirements`                                      | `requirements` |
| Leads        | Proposals     | `/{slug}/realty/proposals`                                         | `requirements` |
| Leads        | Allocation    | `/{slug}/realty/allocation`                                        | `allocation`   |
| Leads        | QR Capture    | `/{slug}/realty/capture-links`                                     | `leads`        |
| Leads        | Cold Data     | `/{slug}/realty/cold-data`                                         | `leads`        |
| Calendar     | Calendar      | `/{slug}/realty/calendar`                                          | `tasks`        |
| Lead Sources | Forms         | `/{slug}/realty/forms`                                             | `forms`        |
| Lead Sources | Landing Pages | `/{slug}/realty/landing-pages`                                     | `landingpages` |
| Inventory    | Properties    | `/{slug}/realty/properties`                                        | `projects`     |
| Inventory    | Projects      | `/{slug}/realty/projects`                                          | `projects`     |
| Inventory    | Listings      | `/{slug}/realty/listings`                                          | `listings`     |
| Inventory    | Portals       | `/{slug}/realty/portals`                                           | `listings`     |
| Inventory    | Off-Plan      | `/{slug}/realty/projects?possession=UNDER_CONSTRUCTION,NEW_LAUNCH` | `projects`     |
| Deals        | Collections   | `/{slug}/realty/collections`                                       | `collections`  |
| Deals        | Commissions   | `/{slug}/realty/commissions`                                       | `commissions`  |
| Deals        | Events        | `/{slug}/realty/events`                                            | `events`       |
| Deals        | Reports       | `/{slug}/realty/reports`                                           | `reports`      |
| Deals        | Targets       | `/{slug}/realty/targets`                                           | —              |

### Lead Eagle (LEAD_EAGLE, and only when REAL_ESTATE is absent)

| Area         | Tab           | Path                               | Permission     |
| ------------ | ------------- | ---------------------------------- | -------------- |
| Dashboard    | Dashboard     | `/{slug}/lead-eagle/dashboard`     | `leads`        |
| Leads        | Leads         | `/{slug}/lead-eagle/leads`         | `leads`        |
| Leads        | Follow-ups    | `/{slug}/lead-eagle/follow-ups`    | `leads`        |
| Leads        | Tasks         | `/{slug}/lead-eagle/tasks`         | `tasks`        |
| Leads        | Calls         | `/{slug}/lead-eagle/calls`         | `calls`        |
| Leads        | Playbook      | `/{slug}/lead-eagle/playbook`      | `calls`        |
| Leads        | Site Visits   | `/{slug}/lead-eagle/site-visits`   | `visits`       |
| Leads        | Requirements  | `/{slug}/lead-eagle/requirements`  | `requirements` |
| Leads        | Allocation    | `/{slug}/lead-eagle/allocation`    | `allocation`   |
| Leads        | QR Capture    | `/{slug}/lead-eagle/capture-links` | `leads`        |
| Leads        | Cold Data     | `/{slug}/lead-eagle/cold-data`     | `leads`        |
| Calendar     | Calendar      | `/{slug}/lead-eagle/calendar`      | `tasks`        |
| Lead Sources | Forms         | `/{slug}/lead-eagle/forms`         | `forms`        |
| Lead Sources | Landing Pages | `/{slug}/lead-eagle/landing-pages` | `landingpages` |
| Inventory    | Properties    | `/{slug}/lead-eagle/properties`    | `projects`     |
| Inventory    | Projects      | `/{slug}/lead-eagle/projects`      | `projects`     |
| Inventory    | Listings      | `/{slug}/lead-eagle/listings`      | `listings`     |
| Reports      | Reports       | `/{slug}/lead-eagle/reports`       | `reports`      |
| Reports      | Targets       | `/{slug}/lead-eagle/targets`       | —              |

Lead Eagle has **no** Proposals, **no** Portals, **no** Off-Plan filter, **no**
Collections, **no** Commissions and **no** Events tab. Those are
`SALES_OR_REALTY` screens. A Lead-Eagle-only workspace that reaches one of their
URLs gets the "part of Sales or Real Estate" refusal — see `LE-ENT-001`.

### People (HRMS)

| Area               | Tab            | Path                            | Permission                  |
| ------------------ | -------------- | ------------------------------- | --------------------------- |
| My HR              | Check-in       | `/{slug}/check-in`              | — (self-service)            |
| My HR              | My Payslips    | `/{slug}/people/payslips`       | `employee`                  |
| My HR              | My Roster      | `/{slug}/people/roster`         | `employee` (self audience)  |
| Employees          | Overview       | `/{slug}/people`                | —                           |
| Employees          | Directory      | `/{slug}/people/employees`      | `employee`                  |
| Employees          | Onboarding     | `/{slug}/people/onboarding`     | `employee`                  |
| Employees          | Offboarding    | `/{slug}/people/offboarding`    | `employee`                  |
| Employees          | Lifecycle      | `/{slug}/people/lifecycle`      | `employee`                  |
| Employees          | Departments    | `/{slug}/people/departments`    | `employee`                  |
| Employees          | Compliance     | `/{slug}/people/compliance`     | `employee`                  |
| Employees          | Documents      | `/{slug}/people/documents`      | `hr_documents`              |
| Attendance & Leave | Attendance     | `/{slug}/people/attendance`     | — (role-scoped server-side) |
| Attendance & Leave | Leave Requests | `/{slug}/people/leave`          | — (role-scoped server-side) |
| Attendance & Leave | Shifts         | `/{slug}/people/shifts`         | `employee`                  |
| Attendance & Leave | Rosters        | `/{slug}/people/roster`         | `employee`                  |
| Attendance & Leave | Holidays       | `/{slug}/people/holidays`       | `employee`                  |
| Attendance & Leave | Exceptions     | `/{slug}/people/requests`       | `employee`                  |
| Attendance & Leave | Overtime       | `/{slug}/people/overtime`       | `employee`                  |
| Attendance & Leave | Work Locations | `/{slug}/people/work-locations` | `employee`                  |
| Attendance & Leave | Face Activity  | `/{slug}/people/face-activity`  | `employee`                  |
| Payroll            | Payroll Runs   | `/{slug}/people/payroll`        | `payroll`                   |
| Recruitment        | Recruitment    | `/{slug}/people/recruitment`    | `recruitment`               |
| Performance        | Performance    | `/{slug}/people/performance`    | `employee`                  |

The People area shows the same route under two labels depending on the viewer:
**"My Leave"** for someone who sees only their own records, **"Leave Requests"**
for someone with oversight. A tester seeing "My Leave" where they expected
"Leave Requests" has an `employee` grant at OWN scope, not a bug.

The People section is **hidden outright** for platform staff and platform service
identities inside a customer workspace: they hold no employee record there.

### Finance (SALES)

| Area                  | Tab              | Path                                     | Permission        |
| --------------------- | ---------------- | ---------------------------------------- | ----------------- |
| Collections           | Overview         | `/{slug}/sales/collections`              | `collections`     |
| Collections           | Recovery Cases   | `/{slug}/sales/collections/recovery`     | `collections`     |
| Commissions & Payouts | Commissions      | `/{slug}/sales/commissions`              | `commissions`     |
| Commissions & Payouts | Payout Runs      | `/{slug}/sales/commissions?view=payouts` | `commissions`     |
| Commissions & Payouts | Commission Plans | `/{slug}/sales/commissions/slabs`        | `commissionslabs` |

### Insights

| Area    | Tab           | Path                                         | Permission |
| ------- | ------------- | -------------------------------------------- | ---------- |
| Reports | Sales         | `/{slug}/sales/reports`                      | `reports`  |
| Reports | Value         | `/{slug}/sales/leadership?view=value`        | `reports`  |
| Reports | Productivity  | `/{slug}/sales/leadership?view=productivity` | `reports`  |
| Reports | Team Activity | `/{slug}/sales/leadership?view=compliance`   | `reports`  |
| Reports | Activity Feed | `/{slug}/sales/leadership?view=feed`         | `reports`  |
| Reports | HR            | `/{slug}/people/reports`                     | `employee` |
| Reports | Finance       | `/{slug}/sales/leadership?view=pl`           | `reports`  |
| Reports | Dashboards    | `/{slug}/sales/dashboards`                   | `leads`    |
| Reports | Targets       | `/{slug}/sales/targets`                      | —          |

Note **Dashboards** is gated on `leads`, not `reports` — every figure on it is
derived from leads, so a role with `reports` but no `leads` would meet a page
that refuses. This is why the Call Quality Manager role carries a read-only
`leads` grant.

### Administration

| Area     | Tab             | Path                            | Permission               |
| -------- | --------------- | ------------------------------- | ------------------------ |
| Settings | Workspace       | `/{slug}/admin/settings`        | `settings`               |
| Settings | Company         | `/{slug}/admin/company`         | `settings`               |
| Settings | Modules         | `/{slug}/admin/modules`         | `settings`               |
| Settings | Subscription    | `/{slug}/admin/subscription`    | `settings:VIEW`          |
| Settings | Security Policy | `/{slug}/admin/security`        | `settings`               |
| Settings | Data Retention  | `/{slug}/admin/retention`       | `settings`               |
| Settings | Lead Stages     | `/{slug}/admin/lead-stages`     | `settings` (SALES/RE/LE) |
| Settings | Sources         | `/{slug}/admin/lead-sources`    | `settings` (SALES/RE/LE) |
| Settings | Custom Fields   | `/{slug}/admin/custom-fields`   | `settings` (SALES/RE/LE) |
| Settings | Email Templates | `/{slug}/admin/email-templates` | `settings` (SALES/RE/LE) |
| Settings | Users           | `/{slug}/admin/users`           | `users`                  |
| Settings | Teams           | `/{slug}/admin/teams`           | `users`                  |
| Settings | Roles           | `/{slug}/admin/roles`           | `roles`                  |
| Settings | Teams (sales)   | `/{slug}/sales/people`          | `users`                  |
| Settings | Allocation      | `/{slug}/sales/allocation`      | `allocation`             |
| Settings | Work Locations  | `/{slug}/admin/work-locations`  | `employee:EDIT`          |
| Settings | Holidays        | `/{slug}/admin/holidays`        | `employee:EDIT`          |
| Settings | HR Policies     | `/{slug}/people/settings`       | `employee:EDIT`          |
| Settings | Integrations    | `/{slug}/admin/integrations`    | `integrations`           |
| Settings | Channels        | `/{slug}/sales/communications`  | `communications`         |
| Settings | Automation      | `/{slug}/sales/automation`      | `automation`             |
| Settings | Automation (LE) | `/{slug}/lead-eagle/automation` | `automation`             |
| Settings | Audit Log       | `/{slug}/admin/audit`           | `auditlogs`              |

### Account (always present, collapsible)

| Area       | Tab           | Path                            | Permission |
| ---------- | ------------- | ------------------------------- | ---------- |
| My Account | Security      | `/{slug}/profile/security`      | —          |
| My Account | Role & Access | `/{slug}/profile/role`          | —          |
| My Account | Appearance    | `/{slug}/profile/appearance`    | —          |
| My Account | Notifications | `/{slug}/profile/notifications` | —          |

_Source for all of the above: `apps/web/src/lib/nav/workspaceNav.ts`, rendered
through `buildNavigation`._

## 1.4 Platform console

Reachable only by a platform identity, at `/platform`. Workspace users have no
door into it at all.

| Screen                           | Path                                                        | Purpose                                                   |
| -------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Overview                         | `/platform`                                                 | Command band, workspace and health summary                |
| Workspaces                       | `/platform/workspaces`                                      | Provision a workspace, set its modules, open it           |
| Workspace detail                 | `/platform/workspaces/{workspaceId}`                        | One company: plan, modules, status                        |
| Subscription plans               | `/platform/plans`                                           | Define plans and the modules each includes                |
| Subscriptions                    | `/platform/subscriptions`                                   | Who is on what plan                                       |
| Platform users                   | `/platform/users`                                           | Platform staff identities and roles                       |
| Identity                         | `/platform/identity`                                        | Service identities and their credentials                  |
| Credentials                      | `/platform/credentials`                                     | Rotatable machine credentials                             |
| Security                         | `/platform/security`                                        | Platform security posture and grants                      |
| AI Control Center                | `/platform/ai-control`                                      | AI enablement and token limits                            |
| AI usage by workspace            | `/platform/ai-control/workspaces`                           | Consumption per tenant                                    |
| Workspace AI usage               | `/platform/ai-control/workspaces/{tenantId}`                | One tenant's consumption                                  |
| User AI usage and token settings | `/platform/ai-control/workspaces/{tenantId}/users/{userId}` | One user's budget                                         |
| AI usage                         | `/platform/ai-usage`                                        | Platform-wide AI cost                                     |
| Platform audit                   | `/platform/audit`                                           | Platform-level audit trail                                |
| System health                    | `/platform/system-health`                                   | Queue, database and dependency health                     |
| Settings                         | `/platform/settings`                                        | Platform settings, including the self-serve sign-up offer |

_Source: `apps/web/src/app/(platform)/platform/`_

## 1.5 Public (unauthenticated) surfaces

| Surface              | Path                        | What it does                                                                          |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Marketing / root     | `/`                         | Product front page                                                                    |
| Sign in              | `/login`                    | The single sign-in endpoint                                                           |
| Lead Eagle sign in   | `/login?product=lead-eagle` | The same form, endpoint and accounts under Lead Eagle's name                          |
| Sign up (trial)      | `/signup`                   | Only while the platform owner keeps self-serve sign-up open; never inside the iOS app |
| Confirm sign-up      | `/signup/confirm`           | Completes a trial sign-up                                                             |
| Forgot password      | `/forgot-password`          | Requests a reset                                                                      |
| Reset password       | `/reset-password`           | Consumes a reset token                                                                |
| Accept invitation    | `/accept-invite`            | A new user sets their password                                                        |
| Enrol second factor  | `/enroll-2fa`               | Forced enrolment when policy requires it                                              |
| Service sign-in      | `/service-login`            | Platform service identity door                                                        |
| Public web form      | `/f/{slug}/{formKey}`       | Lands a lead from a form                                                              |
| QR capture           | `/c/{slug}/{key}`           | Lands a lead from a QR stand                                                          |
| Landing page         | `/l/{slug}/{pageSlug}`      | A published landing page with a form                                                  |
| Proposal / shortlist | `/p/{token}`                | A client's property shortlist                                                         |
| Shared record        | `/s/{token}`                | A record shared out of the workspace, `noindex`                                       |
| Event RSVP           | `/rsvp/{token}`             | Accept or decline an invitation                                                       |
| Testimonial          | `/testimonial/{token}`      | A client leaves a testimonial                                                         |
| Privacy              | `/privacy`                  | Policy                                                                                |
| Support              | `/support`                  | Support page                                                                          |
| No platform access   | `/no-platform-access`       | Shown to an identity with no platform grant                                           |

_Source: `apps/web/src/app/` top level._

## 1.6 Background processing

Eleven queues; twelve armed schedules. A tester needs these names only to
diagnose a Blocked result.

| Queue purpose         | Schedule name                        | Cadence      |
| --------------------- | ------------------------------------ | ------------ |
| Retention sweep       | `retention-daily`                    | daily        |
| Lead triage           | `lead-triage-five-minutely`          | every 5 min  |
| First contact         | `first-contact-five-minutely`        | every 5 min  |
| Time-based automation | `automation-time-five-minutely`      | every 5 min  |
| Follow-up drift       | `follow-up-drift-daily`              | `20 3 * * *` |
| Account deletions     | `account-deletions-quarter-hourly`   | every 15 min |
| Lead recycling        | `lead-recycle-daily`                 | `10 4 * * *` |
| Lead score decay      | `lead-score-decay-daily`             | `40 3 * * *` |
| Morning digest        | `morning-digest-hourly`              | `5 * * * *`  |
| Report schedules      | `report-schedules-quarter-hourly`    | every 15 min |
| Calendar sync retry   | `calendar-sync-retry-quarter-hourly` | every 15 min |
| Reminders             | `reminders-five-minutely`            | every 5 min  |

Retired and should not appear: `reminders-quarter-hourly`.

_Source: `apps/web/src/workers/maintenance.ts`, `apps/web/src/lib/queue.ts`_

## 1.7 Implementation status

Status is assigned from repository evidence only, using these four labels. The
distinction matters: three of the four look identical to a tester who has not
been told which to expect.

| Label                      | Means                                                                                                                    | How a tester sees it                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Complete**               | Screen, API, service and schema all present; the path works with ordinary test data                                      | Works                                                 |
| **Needs credentials**      | Code complete, but it calls a third party that must be configured first                                                  | A clear refusal naming what is missing — not a crash  |
| **Built but switched off** | Code complete, gated behind an environment variable or a workspace setting that is off by default                        | The feature is simply absent until switched on        |
| **Needs UI Verification**  | The behaviour is in the code, but the exact label, button text or screen could not be read off the source with certainty | Confirm against the running app before failing a case |

| Module / feature                                                               | Status                                     | Note                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, MFA, recovery codes, password reset, invitation                       | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Lead create / read / edit / list / search / saved views                        | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Lead import (CSV), export                                                      | Complete                                   | Dry-run supported                                                                                                                                                                                                                                                                                         |
| Lead deduplication                                                             | Complete                                   | Blocks by default; caller may pass `WARN`                                                                                                                                                                                                                                                                 |
| Lead allocation rules, waiting queue, manual assign                            | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Lead recycling, score decay, triage                                            | Complete                                   | Runs on schedules in the worker                                                                                                                                                                                                                                                                           |
| Opportunities, accounts, contacts, client profiles                             | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Tasks, follow-ups, calendar, activity log                                      | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Calls: create, consent, complete with outcome, notes                           | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Call recording upload, transcript upload                                       | Complete                                   | Both gated on recorded consent                                                                                                                                                                                                                                                                            |
| Outbound dialling through a provider                                           | **Needs credentials**                      | A telephony integration must be configured; otherwise the live workspace runs in demo simulation and places no real call                                                                                                                                                                                  |
| Live AI transcription and coaching                                             | **Needs credentials**                      | Needs the live-stream WebSocket server (`LIVE_STREAM_WS_URL`) and an AI provider                                                                                                                                                                                                                          |
| Post-call AI analysis / scorecard                                              | **Needs credentials**                      | Needs an AI provider; the trigger button only appears once a transcript exists                                                                                                                                                                                                                            |
| Call audits, coaching notes, playbook, practice                                | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Daily Activity / daily targets board                                           | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Campaigns, dialer campaign, events                                             | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Web forms, landing pages, QR capture, social sources                           | Complete                                   | Social sources need the Meta integration                                                                                                                                                                                                                                                                  |
| Conversations inbox / WhatsApp                                                 | **Needs credentials**                      | Channel must be configured                                                                                                                                                                                                                                                                                |
| Service tickets, SLA                                                           | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Properties, projects, listings, portals                                        | Complete                                   | Portal publishing needs portal credentials                                                                                                                                                                                                                                                                |
| Requirements, proposals, shared shortlists                                     | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Site visits, QR passes                                                         | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Bookings                                                                       | Complete (API) + **Needs UI Verification** | `POST/PATCH /api/v1/bookings` exists; no page file named `bookings` was found — bookings are reached through Collections and the dashboards. Confirm the booking-creation screen before failing `RE-BOOK-001`                                                                                             |
| Collections, recovery cases                                                    | Complete                                   | Two-person rule: the account that records a receipt cannot verify it                                                                                                                                                                                                                                      |
| Commissions, commission plans, payout runs                                     | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Agency fee propose / approve                                                   | Complete                                   | Sales Director proposes, Finance approves                                                                                                                                                                                                                                                                 |
| Employees, departments, lifecycle, onboarding, offboarding, compliance         | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Attendance, check-in / check-out, geofence                                     | Complete                                   | Self-service; **no module gate**                                                                                                                                                                                                                                                                          |
| Face check-in                                                                  | **Needs credentials**                      | Needs the Python face sidecar, biometric consent and an HR-performed enrolment                                                                                                                                                                                                                            |
| Shifts, rosters, holidays, exceptions, overtime                                | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Leave: apply, approve, balances                                                | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Payroll: open run, adjustments, calculate, lock, release                       | Complete                                   | Preparer and approver are separate roles by design                                                                                                                                                                                                                                                        |
| Payslips (employee self-service)                                               | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| WPS export                                                                     | Complete, **gated**                        | `GET /api/v1/workspaces/{slug}/hr/payroll/{runId}/wps` as a **WPS file** download on an APPROVED, LOCKED or PAID run. The link is offered only once the workspace has set its WPS identifiers in HR policy; otherwise it renders disabled with the tooltip _"Set the WPS identifiers in HR policy first"_ |
| Recruitment (requisition, candidate, stages, offer)                            | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Performance (cycles, goals, reviews, calibration, final rating)                | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| HR documents, HR reports                                                       | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Lead Eagle: all areas listed in 1.3                                            | Complete                                   | Shares the Sales code                                                                                                                                                                                                                                                                                     |
| Lead Eagle starter roles                                                       | **Needs UI Verification**                  | No Lead-Eagle-specific seeded role exists. The 25 seeded roles are shared; a Lead Eagle workspace configures them. See [02](02-roles-and-personas.md) §2.5                                                                                                                                                |
| Users: invite, create, activate, deactivate, remove, reset password, hand over | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Roles: create, clone, edit grants, assign, assignment history                  | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Field permissions and sensitive-field masking                                  | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Data scopes (OWN → ORGANIZATION)                                               | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Integrations registry                                                          | Complete                                   | Each provider needs its own credentials                                                                                                                                                                                                                                                                   |
| Audit log, data retention                                                      | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Workspace provisioning, plans, subscriptions, entitlements                     | Complete                                   | Platform console                                                                                                                                                                                                                                                                                          |
| Platform break-glass write grants                                              | Complete                                   | Time-boxed, reason required                                                                                                                                                                                                                                                                               |
| AI usage and cost controls                                                     | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| System health, metrics                                                         | Complete                                   |                                                                                                                                                                                                                                                                                                           |
| Mobile apps (Capacitor WebView shells)                                         | **Needs UI Verification**                  | Shells exist with 12 mobile API routes; a code comment describes the `server.url` arrangement as a proof of concept while project documentation records an iOS submission. The two disagree — do not test mobile from this suite until the owner resolves it. See [12](12-coverage-and-gaps.md)           |

Nothing in this inventory is labelled **Planned**: no feature was found that is
described in the schema or navigation but has no implementation behind it. The
navigation model's own comment is explicit that screens the plan names but the
product does not have are kept out of the nav rather than rendered as empty tabs,
so an empty tab would itself be a defect.
