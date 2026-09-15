# Navigation map: routes to work areas and tabs

The sidebar lists work areas; the screens inside an area are tabs above the page. The model is `apps/web/src/lib/nav/workspaceNav.ts`, and `apps/web/tests/unit/workspace-nav.spec.ts` fails if any workspace page has no place in it.

Milestone 1 changes no URL. Every tab points at the existing route, so bookmarks, deep links, query strings and saved filters keep working, and no redirect is needed. Record pages (`/leads/[id]`, `/collections/[bookingId]`, `…/new`, `…/edit`) belong to the tab of their list.

Each tab carries the permission its page asserts on the server. Hiding a tab is presentation only.

Paths below omit `/{workspace}`. `s` is `/sales`, `p` is `/people`, `a` is `/admin`.

## Home

| Area | Tab | Route | Notes |
| --- | --- | --- | --- |
| My Workspace | Workspace Summary | `/dashboard` | the existing home screen; see below |
| | Sales Overview | `s` | existing sales desk: overdue follow-ups, SLA breaches, unassigned |
| | Team Work | `s/leadership?view=chasing` | existing chasing queue; needs `reports` |
| | Business Overview | `s/leadership` | existing leadership summary |
| | Team Feed | `s/engagement` | team feed, contests and awards; its own view switch stays inside the page |
| Inbox | All | `/notifications` | |

## CRM

| Area | Tab | Route | Notes |
| --- | --- | --- | --- |
| Leads | All Leads | `s/leads` | the page's own filter chips remain |
| | My Leads | `s/leads?filter=mine` | existing filter |
| | Unassigned | `s/leads?filter=unassigned` | existing filter |
| | Saved Views | `s/smart-views` | |
| Customers | Contacts | `s/contacts` | |
| | Accounts | `s/accounts` | |
| | Conversations | `s/communications/inbox` | customer messaging belongs with customers, not the internal Inbox |
| | Client Profiles | `s/clients` | |
| | Testimonials | `s/clients?view=testimonials` | |
| | Referrals | `s/clients?view=referrals` | |
| | Service | `s/service` | customer tickets |
| | Documents | `s/documents` | lead and customer documents |
| Opportunities | List | `s/opportunities` | |
| Activities | Tasks & Follow-ups | `s/follow-ups` | |
| | My Tasks | `/tasks` | |
| | All Tasks | `s/tasks` | |
| | Calendar | `s/calendar` | |
| | Viewings | `s/site-visits` | |
| | Activity Log | `s/activities` | |
| | Field Sales | `s/field-sales` | field visits are activity work |
| Calls & Coaching | Calls | `s/calls` | includes live call and dialer pages beneath |
| | Call Audits | `s/call-audits` | |
| | Coaching | `s/coaching` | |
| | Playbook | `s/playbook` | call scripts and objections serve calls and coaching |
| | Practice | `s/practice` | role-play practice is coaching |

## Properties, Marketing

| Area | Tab | Route | Notes |
| --- | --- | --- | --- |
| Property Inventory | Projects | `s/projects` | units are managed inside a project |
| | Listings | `s/listings` | |
| | Buyer Requirements | `s/requirements` | demand matched against inventory |
| | Products | `s/products` | the catalogue |
| Campaigns | Campaigns | `s/campaigns` | campaign dialer at `s/campaigns/[id]/dialer` |
| | Events | `s/events` | events are run as campaigns |
| Lead Sources | Forms | `s/forms` | |
| | Landing Pages | `s/landing-pages` | |
| | Social Sources | `s/social-leads` | |

## People

People screens serve an employee and HR from the same route, scoped by role on the server. A shared route is labelled for the viewer. It shows as a "My" tab to someone who sees only their own records, and as an HR tab to someone with `employee` VIEW at TEAM scope or wider. It never shows both ways, and a "My" label never covers other people's data.

| Area | Tab | Route | Audience |
| --- | --- | --- | --- |
| My HR | Overview | `p` | self |
| | Check-in | `p/check-in` | everyone |
| | My Attendance | `p/attendance` | self |
| | My Leave | `p/leave` | self |
| | My Roster | `p/roster` | self |
| | My Overtime | `p/overtime` | self |
| | Holidays | `p/holidays` | self |
| | My Payslips | `p/payslips` | everyone with `employee` |
| | My Requests | `p/requests` | self |
| Employees | Overview | `p` | oversight |
| | Directory | `p/employees` | oversight |
| | Onboarding, Offboarding, Lifecycle, Departments, Compliance | `p/onboarding` and so on | oversight |
| | Documents | `p/documents` | `hr_documents` holders |
| Attendance & Leave | Attendance, Leave Requests | `p/attendance`, `p/leave` | oversight |
| | Shifts, Rosters, Holidays, Overtime | `p/shifts`, `p/roster`, `p/holidays`, `p/overtime` | oversight |
| | Exceptions | `p/requests` | oversight; the page holds attendance exceptions and temporary work locations |
| | Work Locations, Face Activity | `p/work-locations`, `p/face-activity` | oversight |
| Payroll | Payroll Runs | `p/payroll` | `payroll` holders |
| Recruitment | Recruitment | `p/recruitment` | |
| Performance | Performance | `p/performance` | everyone with `employee`; the page has "My review" and administration |

## Finance, Insights, Administration, Account

| Area | Tab | Route | Notes |
| --- | --- | --- | --- |
| Collections | Overview | `s/collections` | per-sale receipts, amendments and cases at `s/collections/[bookingId]` |
| | Recovery Cases | `s/collections/recovery` | |
| Commissions & Payouts | Commissions | `s/commissions` | its internal Earnings and Payout runs switch became these tabs |
| | Payout Runs | `s/commissions?view=payouts` | |
| | Commission Plans | `s/commissions/slabs` | |
| Reports | Sales | `s/reports` | |
| | Team Activity | `s/leadership?view=compliance` | |
| | Activity Feed | `s/leadership?view=feed` | |
| | HR | `p/reports` | oversight |
| | Finance | `s/leadership?view=pl` | the P&L |
| | Dashboards | `s/dashboards` | |
| | Targets | `s/targets` | targets are measured performance |
| Settings | Workspace, Company, Modules, Subscription, Security Policy | `a/settings`, `a/company`, `a/modules`, `a/subscription`, `a/security` | |
| | Users, Roles | `a/users`, `a/roles` | `p/users` and `p/roles` are the same screens and highlight these tabs |
| | Teams | `s/people` | |
| | Allocation | `s/allocation` | |
| | HR Policies | `p/settings` | needs `employee` EDIT |
| | Integrations | `a/integrations` | Meta setup beneath |
| | Channels | `s/communications` | messaging channel configuration |
| | Automation | `s/automation` | |
| | Audit Log | `a/audit` | |
| My Account | Security, Role & Access, Appearance | `/profile/security`, `/profile/role`, `/profile/appearance` | collapsed at the bottom; `p/security` highlights Security |

The Leadership page's internal view tabs became tabs of My Workspace and Reports. Moving between them keeps the page's date range and person filter.

## My Workspace: what each screen is for

These are existing screens, labelled for what they show. None of them is the personal My Day the plan describes; that is Milestone 2.

| Tab | Route | What it shows | Scope |
| --- | --- | --- | --- |
| Workspace Summary | `/dashboard` | summary cards (pipeline value, open opportunities, active leads, present today), items needing attention, follow-ups across the workspace, and panels shown by permission: People summary, Call quality, Subscription, Security | each card and list is limited to what the viewer's role may see; for an administrator that is the whole workspace |
| Sales Overview | `s` | the sales desk: follow-ups due today and overdue, leads in scope, leads waiting for an owner, SLA breaches, target progress | the viewer's sales scope |
| Team Work | `s/leadership?view=chasing` | the chasing queue: overdue obligations across the people the viewer leads | people the viewer leads; needs `reports` |
| Business Overview | `s/leadership` | funnel, conversion and performer board for a period, filterable by person | people the viewer leads; needs `reports` |
| Team Feed | `s/engagement` | team posts, contests and awards | the workspace; needs `posts` |

Overlap to assess:

- Workspace Summary and Sales Overview both list follow-ups due and overdue.
- Team Work's chasing queue repeats overdue items for managers.
- Business Overview does not repeat the others; it is period analytics.

Milestone 2 is where My Day, Team Work and Approvals get their defined content. The overlap is resolved there, not by relabelling.

## Planned tabs, classified

Three different situations are easy to confuse:

- **Inside another screen.** The work can be done today, on a record's page.
- **Route missing.** The data and actions exist, but there is no list screen that gathers them.
- **Feature missing.** The capability itself does not exist.

A missing tab is not a missing feature.

| Area | Planned tab | Classification | Where the existing functionality is |
| --- | --- | --- | --- |
| Collections | Receipts | inside another screen; cross-sale list route missing | `s/collections/[bookingId]` renders `ReceiptPanel.tsx`: record, verify or reject, reverse, upload and download evidence. The Collections list shows verified and pending amounts per sale. `GET /api/v1/collections/receipts` requires a `bookingId` |
| Collections | Awaiting Verification | inside another screen; cross-sale queue route missing | pending receipts are marked per sale on `s/collections` (Pending column) and verified in `ReceiptPanel.tsx` |
| Collections | Fee Amendments | inside another screen; cross-sale list route missing | `s/collections/[bookingId]` renders `FeeAmendmentPanel.tsx`: propose, preview, approve or reject. The Collections list flags "Fee amendment pending". `GET /api/v1/collections/fee-amendments` requires a `bookingId` |
| Collections | Recovery Cases | **exists as a tab** | `s/collections/recovery` with `RecoveryCaseList.tsx`: assign, acknowledge, record a recovery, propose and approve a write-off or adjustment |
| Bookings | All, Drafts, Confirmed, Cancelled | route missing; creating, confirming and cancelling from the screens is also missing | `GET /api/v1/bookings` lists with a status filter; `POST` creates; `PATCH` confirms and cancels. Confirmed sales with an agreed fee appear on `s/collections` and `s/collections/[bookingId]`. There is no bookings screen, and no screen that creates or confirms a booking. The Commissions page notes "No bookings page yet" |
| Property Inventory | Units | inside another screen; cross-project list route missing | `s/projects/[id]` renders `UnitBoard.tsx`: list and edit a project's units. The API is `GET` and `POST /api/v1/projects/[id]/units` and `PATCH …/units/[unitId]` |
| Campaigns | Audiences | inside another screen; cross-campaign route missing | `s/campaigns/[id]` renders `AudiencePicker.tsx`, adding leads through `POST /api/v1/campaigns/[id]/audience`, and shows the member count (`/api/v1/campaigns/[id]/members`). There is no reusable saved audience separate from a campaign |
| Campaigns | Delivery/Results | inside another screen | `s/campaigns/[id]` (`CampaignSend.tsx`, status actions, members); calling campaigns through `s/campaigns/[id]/dialer` |
| Payroll | Approval Queue | inside another screen | `p/payroll`: runs with Prepared by and Approved by, approval actions for the payroll approver, maker-checker enforced |
| Payroll | Payslips (administration) | inside another screen | a run's payslips on `p/payroll?run=…`; `p/payslips` is the employee's own pay |
| Customers | Duplicate Review | feature missing | duplicate detection rules are configured on `a/settings`; there is no review queue of suspected duplicates |
| Opportunities | Pipeline | feature missing | `s/opportunities` is a list with an open-pipeline total; there is no stage board |
| Opportunities | Needs Attention | feature missing | no stalled-opportunity rule or threshold exists |
| Inbox | Action Required, Mentions, Updates | Action Required and Updates: route missing; Mentions: feature missing | `/notifications` lists notifications with a Read column; there is no mention workflow |
| My Workspace | Approvals | route missing | decisions happen on each record: receipts, fee amendments, recovery write-offs, payroll runs, leave, overtime |
| My HR | My Profile, My Documents | feature missing | no employee self-profile or self-document screen; HR documents (`p/documents`) are for `hr_documents` holders |
| Commissions & Payouts | Exceptions | feature missing | no exception list; blocked payouts show their reason on `s/commissions?view=payouts` |
| Reports | Marketing | feature missing | no marketing report |

"Route missing" items are navigation work over existing services. "Feature missing" items are new product work, each in the milestone where its rules are set.

## Defect fixed along the way

The previous sidebar resolved permissions for a fixed list of 29 modules. Items gated on any other module were hidden from every role, whatever it held. That covered Collections, Commissions, Slab rules, Projects, Listings, Site visits, Requirements, Payroll, Recruitment and more. The layout now resolves exactly the tokens the model names.
