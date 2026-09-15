# Navigation map: routes to work areas and tabs

The sidebar lists work areas; the screens inside an area are tabs above the page. The model is `apps/web/src/lib/nav/workspaceNav.ts`, and `apps/web/tests/unit/workspace-nav.spec.ts` fails if any workspace page has no place in it.

Milestone 1 changes no URL. Every tab points at the existing route, so bookmarks, deep links, query strings and saved filters keep working, and no redirect is needed. Record pages (`/leads/[id]`, `/collections/[bookingId]`, `…/new`, `…/edit`) belong to the tab of their list.

Each tab carries the permission its page asserts on the server. Hiding a tab is presentation only.

Paths below omit `/{workspace}`. `s` is `/sales`, `p` is `/people`, `a` is `/admin`.

## Home

| Area | Tab | Route | Notes |
| --- | --- | --- | --- |
| My Workspace | My Day | `/dashboard` | |
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

## Screens the plan names that do not exist yet

These are not rendered. Each is listed against the milestone where its business rules are set.

| Area | Planned tab | Current state | Milestone |
| --- | --- | --- | --- |
| My Workspace | Approvals | decisions exist per record (receipts, fee amendments, recovery write-offs, payroll, leave, overtime); there is no combined queue | 2 |
| My Workspace | My Day, Team Work content | existing pages; the role-aware queues described in the plan | 2 |
| Inbox | Action Required, Mentions, Updates | one notification list; no read-state tabs, no mention workflow | 3 |
| Customers | Duplicate Review | duplicate rules exist; there is no review screen | 5 |
| Opportunities | Pipeline, Needs Attention | list only; no stage board, no stalled threshold | 2 (needs attention), 5 (pipeline) |
| Property Inventory | Units | units are edited inside a project; no cross-project unit list | 5 |
| Campaigns | Audiences, Delivery/Results | audience and results live inside a campaign | 5 |
| My HR | My Profile, My Documents | no employee self-profile or self-document screen | 4 |
| Payroll | Approval Queue, Payslips (administration) | approval happens inside a run; the payslips screen is the employee's own pay | 4 |
| Bookings | All, Drafts, Confirmed, Cancelled | bookings are managed from leads and collections; there is no bookings list, so the area is not shown | 5 |
| Collections | Receipts, Awaiting Verification, Fee Amendments | handled per sale; no cross-sale lists | 5 |
| Commissions & Payouts | Exceptions | no exceptions list | 5 |
| Reports | Marketing | no marketing report | 5 |

## Defect fixed along the way

The previous sidebar resolved permissions for a fixed list of 29 modules. Items gated on any other module were hidden from every role, whatever it held. That covered Collections, Commissions, Slab rules, Projects, Listings, Site visits, Requirements, Payroll, Recruitment and more. The layout now resolves exactly the tokens the model names.
