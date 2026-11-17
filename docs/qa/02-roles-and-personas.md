# Section 2 — Actual roles, permissions, and persona mapping

## 2.1 How authority actually works

Four independent things decide whether an action succeeds. All four must pass.
A tester who confuses them will log defects that are not defects.

| #   | Layer                   | What it decides                                                 | Where it lives                                      |
| --- | ----------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| 1   | **Product entitlement** | Does this _workspace_ own the module the screen belongs to?     | `src/lib/security/entitlements.ts`                  |
| 2   | **Permission**          | Does this _role_ hold `module:ACTION`?                          | `src/lib/security/rbac.ts`                          |
| 3   | **Scope**               | Of the records this action covers, _which_ may this user touch? | `src/lib/security/visibility.ts`, `record-scope.ts` |
| 4   | **Field security**      | Of the fields on a record the user may see, which are masked?   | `src/lib/security/fieldSecurity.ts`                 |

And beneath all four, at the database: 47 tables carry Postgres row-level
security keyed on the tenant. A query that somehow escaped layers 1–4 would
still return nothing across a tenant boundary.

### Why this matters to a test case

- A missing **entitlement** produces a specific, friendly page: _"{Screen} is
  part of {product}. This workspace's plan does not include it."_ It is **not**
  an error page, and it is not a 403 screen.
- A missing **permission** produces a refusal from the server. The nav hides the
  link too, but hiding is cosmetic — always confirm by URL.
- A record **out of scope** returns **404**, not 403. This is deliberate: a 403
  would confirm the record exists. Several negative cases below check for 404
  precisely, and a 403 there is a defect.
- A masked **field** shows as a mask, and an action that needs the real value
  refuses rather than using the mask (for example, dialling a masked number).

## 2.2 Permission tokens

A permission is a `module:ACTION` pair. A `Permission` row is only a
_definition_ — it confers nothing by existing. Authority comes from
`RolePermission` rows, and each of those carries a **scope**.

Revoking a permission **deletes its row** rather than setting a flag. So a role
with no grants at all and a role whose grants an administrator deliberately
trimmed to nothing are indistinguishable in the database. This is why the
role-repair script only fills roles holding no grants.

The 66 permission modules in the catalogue:

`accounts`, `activities`, `agencyfee`, `allocation`, `apikeys`, `attendance`,
`auditlogs`, `automation`, `bookings`, `calls`, `campaigns`, `clientprofiles`,
`collections`, `commissions`, `commissionslabs`, `communications`, `contacts`,
`contests`, `dashboards`, `departments`, `dialer`, `distribution`, `documents`,
`employee`, `events`, `exports`, `fieldsales`, `forms`, `holidays`,
`hr_documents`, `hr_reports`, `hrms`, `imports`, `integrations`, `landingpages`,
`leads`, `leave`, `listings`, `lists`, `opportunities`, `overtime`, `payouts`,
`payroll`, `performance`, `posts`, `products`, `projects`, `recruitment`,
`referrals`, `reports`, `requirements`, `roles`, `settings`, `shifts`, `sla`,
`smartviews`, `tasks`, `testimonials`, `tickets`, `users`, `visits`,
`work_locations`.

The actions, by module family:

| Family                                                                                                                                                                                                                                              | Actions                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration surfaces (`settings`, `roles`, `users`, `apikeys`, `auditlogs`, `automation`, `communications`, `dashboards`, `distribution`, `exports`, `forms`, `imports`, `integrations`, `landingpages`, `lists`, `reports`, `sla`, `smartviews`) | ACCESS_API, CREATE, DELETE, EDIT, EXPORT, MANAGE_AUTOMATION, MANAGE_CONFIGURATION, MANAGE_USERS, VIEW, VIEW_REPORTS                  |
| Managed records (`leads`, `calls`, `campaigns`, `contacts`, `accounts`, `activities`, `opportunities`, `tasks`)                                                                                                                                     | ASSIGN, BULK_UPDATE, CREATE, DELETE, EDIT, EXPORT, IMPORT, MANAGE_CONFIGURATION, MANAGE_USERS, REASSIGN, VIEW, VIEW_SENSITIVE_FIELDS |
| Plain records (`documents`, `events`, `fieldsales`, `products`, `tickets`)                                                                                                                                                                          | ASSIGN, BULK_UPDATE, CREATE, DELETE, EDIT, EXPORT, IMPORT, REASSIGN, VIEW, VIEW_SENSITIVE_FIELDS                                     |
| Money and approvals (`agencyfee`, `allocation`, `collections`, `commissions`, `commissionslabs`, `payouts`, `payroll`, `performance`, `testimonials`)                                                                                               | subsets including APPROVE                                                                                                            |
| HR (`attendance`, `leave`, `overtime`, `shifts`, `employee`, `departments`, `holidays`, `hr_documents`, `hr_reports`, `hrms`, `work_locations`, `recruitment`, `visits`)                                                                            | subsets; several carry APPROVE and VIEW_SENSITIVE_FIELDS                                                                             |

_Source: `apps/web/src/lib/security/permissionCatalogue.ts`_

## 2.3 Scopes, and exactly what each resolves to

`NONE < OWN < TEAM < BRANCH < REGION < ORGANIZATION`

| Scope        | The user may touch records owned by                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| OWN          | themselves only                                                                                      |
| TEAM         | themselves, everyone they manage, and every member of their team **and its descendant teams**        |
| BRANCH       | themselves and every user in their own branch, plus any branch a BRANCH-scoped role assignment names |
| REGION       | themselves and every user in their own region, plus any region a REGION-scoped role assignment names |
| ORGANIZATION | every user in the workspace                                                                          |

**Three edge cases that look like bugs and are not:**

1. A user at **TEAM** scope who belongs to **no team** sees themselves plus
   anyone who reports to them — nothing more. `HR-SCOPE-003`.
2. A user at **BRANCH** or **REGION** scope with **no branch/region set** sees
   **only themselves**. A Branch Manager whose branch field is empty sees an
   empty CRM. `SALES-SCOPE-004`.
3. Scope resolution is memoized **per request only**. A team change therefore
   takes effect on the next page load, not mid-render. An earlier comment in the
   code claiming a five-minute cache was wrong and has been corrected — do not
   expect a five-minute delay.

**Ownerless records.** Unassigned leads appear only to a user who may claim
them: someone holding `ASSIGN` or `REASSIGN` at wider than OWN. An agent at OWN
scope sees an empty **Unassigned** tab, by design. `SALES-LEAD-011`.

**Writes are re-checked.** Scope is applied on every read _and_ re-applied on
write by loading the record inside the transaction. Checking only on read is the
classic IDOR, because a PATCH never passes through the list query. So a direct
PATCH to a record ID the user can guess must still return 404.

_Source: `apps/web/src/lib/security/visibility.ts`, `record-scope.ts`, `rbac.ts`_

## 2.4 The 25 seeded roles

These are created when a workspace is seeded. **Every cell is a default.** An
administrator edits them afterwards from **Administration → Settings → Roles**
("Roles & permissions"), so a tester must read the workspace's actual role
configuration before asserting what a role may do. `rank` is a precedence
number: lower is more senior.

| Key                   | Name on screen             | Rank | Default scope | Character                                                                                                                               |
| --------------------- | -------------------------- | ---- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin`         | Super Administrator        | 0    | ORGANIZATION  | Everything, every module, organisation-wide (`*:*`)                                                                                     |
| `org_admin`           | Organization Administrator | 10   | ORGANIZATION  | Everything, every module, organisation-wide (`*:*`)                                                                                     |
| `executive_read_only` | Executive (Read-Only)      | 15   | ORGANIZATION  | Reads the whole CRM; **no write action anywhere**                                                                                       |
| `sales_director`      | Sales Director             | 20   | ORGANIZATION  | Full lead authority org-wide; proposes agency fees; configures distribution                                                             |
| `hr_admin`            | HR Administrator           | 20   | ORGANIZATION  | All of HR including approvals; can onboard a user and reset a password; **cannot edit the role catalogue**                              |
| `it_admin`            | IT Administrator           | 30   | ORGANIZATION  | Users, roles (assign only), settings, integrations, API keys, audit, import/export, automation. **No HR or Sales record access at all** |
| `regional_manager`    | Regional Manager           | 30   | REGION        | Leads and pipeline across their region                                                                                                  |
| `finance_admin`       | Finance Administrator      | 35   | ORGANIZATION  | Approves payroll, commissions, payouts, agency fees; records and verifies collections                                                   |
| `branch_manager`      | Branch Manager             | 40   | BRANCH        | Leads and pipeline across their branch, plus tickets                                                                                    |
| `marketing_manager`   | Marketing Manager          | 40   | ORGANIZATION  | Campaigns, lists, forms, landing pages, communications, automation; leads VIEW org-wide but EDIT only at TEAM                           |
| `service_manager`     | Customer Service Manager   | 40   | ORGANIZATION  | Tickets and SLA org-wide; leads at BRANCH                                                                                               |
| `call_qa`             | Call Quality Manager       | 40   | ORGANIZATION  | Calls VIEW/EDIT/EXPORT org-wide, read-only `leads`; **no opportunities grant**                                                          |
| `analyst`             | Reporting Analyst          | 45   | ORGANIZATION  | Reads and exports almost everything; the call-quality reviewer; writes nothing except reports/dashboards/views                          |
| `dept_manager`        | Department Manager         | 45   | TEAM          | Approves attendance, leave and overtime **for their own people only**                                                                   |
| `site_manager`        | Site Manager               | 48   | BRANCH        | The same authority as a department manager, drawn around a place                                                                        |
| `team_manager`        | Team Manager               | 50   | TEAM          | Leads and pipeline for their team; assigns and reassigns within it                                                                      |
| `hr_executive`        | HR Executive               | 50   | ORGANIZATION  | Day-to-day HR records and requests. **No approvals, no salaries**                                                                       |
| `payroll_officer`     | Payroll Officer            | 55   | ORGANIZATION  | Prepares payroll runs and sees salaries. **No APPROVE anywhere, on purpose**                                                            |
| `sales_rep`           | Sales Representative       | 60   | OWN           | Own leads, opportunities, activities and tasks; contacts/accounts at TEAM                                                               |
| `field_rep`           | Field Sales Representative | 60   | OWN           | As `sales_rep` plus field-sales create/edit; opportunities EDIT but not CREATE                                                          |
| `marketing_exec`      | Marketing Executive        | 60   | OWN           | Own campaigns, lists, communications; leads VIEW/CREATE at TEAM, EDIT at OWN                                                            |
| `service_agent`       | Customer Service Agent     | 60   | TEAM          | Tickets and communications for their team                                                                                               |
| `recruiter`           | Recruiter                  | 60   | ORGANIZATION  | Moves candidates through the pipeline. **The offer decision is not theirs**                                                             |
| `auditor`             | Auditor                    | 70   | ORGANIZATION  | Reads audit logs, HR, payroll, settings. **No CREATE, EDIT, DELETE or APPROVE anywhere**                                                |
| `employee`            | Employee                   | 90   | OWN           | Their own employee record, attendance, leave, overtime, payslips, performance; holidays org-wide                                        |
| `read_only`           | Read-Only User             | 90   | TEAM          | Reads the CRM at team scope; writes nothing                                                                                             |

_Source: `apps/web/prisma/seed/roles.ts`_

### Separations of duty that are deliberate — test that they hold

These are design decisions with comments in the source saying so. A case that
breaks one of them is a **P0 defect**, not an enhancement request.

| Rule                                                                                                                              | Roles                                | Test case        |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------- |
| The payroll officer who builds a run **cannot release it**; Finance approves                                                      | `payroll_officer` vs `finance_admin` | `HR-PAY-008`     |
| The recruiter who moves a candidate **cannot decide the offer**                                                                   | `recruiter` vs `hr_admin`            | `HR-REC-006`     |
| The Sales Director **proposes** an agency fee; Finance **approves** it                                                            | `sales_director` vs `finance_admin`  | `RE-FEE-003`     |
| The same account **cannot verify a collection receipt it recorded**, and no rank overrides it                                     | `finance_admin`                      | `RE-COLL-004`    |
| HR can onboard a user and reset a password but **cannot edit the role catalogue** — or an HR lead could widen their own authority | `hr_admin`                           | `ADMIN-ROLE-009` |
| IT administers accounts but holds **no HR or Sales record access** — administering accounts is not a reason to read salaries      | `it_admin`                           | `TEN-FIELD-005`  |
| An auditor who can change the record is not an auditor                                                                            | `auditor`                            | `ADMIN-AUD-004`  |
| A department manager approves for their **own team**, not the company                                                             | `dept_manager`                       | `HR-LEAVE-007`   |

### Two roles that only exist because of a past defect

Worth knowing, because the expected behaviour reads oddly otherwise:

- **`employee` holds no biometric-consent or check-in grant.** Those live on the
  self-service route and are authorised by _being the account in question_, not
  by holding a module grant. An employee checking themselves in needs no
  permission at all — and needs no HRMS entitlement either.
- **HR and back-office roles once existed in the database with no grants.** HR
  staff could open the module and do nothing; an employee could not read their
  own record. They were added to the seed list. On an **existing** workspace they
  may still be empty — check before testing.

## 2.5 Persona mapping

The brief names 17 testing personas. Only some of them correspond to a seeded
role. The rest must be **created as role configurations** before testing, and the
required configuration is stated here. Do not assume a persona's authority from
its name.

| #   | Persona                         | Maps to                                                                                                   | Must be configured?                                                                                                                                       |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Platform Owner                  | Platform identity, `PlatformRole = OWNER`                                                                 | No — created in the platform console                                                                                                                      |
| 2   | Platform Staff                  | `PlatformRole = SUPPORT` or `SECURITY_AUDITOR`                                                            | No                                                                                                                                                        |
| 3   | Company Admin                   | `org_admin`                                                                                               | No                                                                                                                                                        |
| 4   | Sales Manager                   | `sales_director` (org-wide) or `branch_manager` (branch)                                                  | No — pick one and say which in the result                                                                                                                 |
| 5   | Team Leader                     | `team_manager`                                                                                            | No. **Must be given a team**, or TEAM scope collapses to self                                                                                             |
| 6   | Sales Agent                     | `sales_rep`                                                                                               | No                                                                                                                                                        |
| 7   | **Telecaller**                  | **No seeded role.** Closest is `sales_rep`                                                                | **Yes.** Clone `sales_rep`; keep `leads VIEW/EDIT @ OWN`; add `calls VIEW/CREATE/EDIT @ OWN`; remove `opportunities`. Name it `Telecaller`. See §2.6      |
| 8   | Branch Manager                  | `branch_manager`                                                                                          | No. **Must have a branch set**                                                                                                                            |
| 9   | Regional Manager                | `regional_manager`                                                                                        | No. **Must have a region set**                                                                                                                            |
| 10  | HR Manager                      | `hr_admin`                                                                                                | No                                                                                                                                                        |
| 11  | Payroll User                    | `payroll_officer`                                                                                         | No                                                                                                                                                        |
| 12  | Employee                        | `employee`                                                                                                | No                                                                                                                                                        |
| 13  | **Real Estate Operations User** | **No seeded role**                                                                                        | **Yes.** Clone `team_manager`; add `projects`, `listings`, `visits`, `bookings`, `collections VIEW`, `events` at BRANCH. Name it `Real Estate Operations` |
| 14  | **Lead Eagle Manager**          | **No Lead-Eagle-specific role exists.** `team_manager` or `branch_manager` in a Lead-Eagle-only workspace | **Yes** — see §2.5.1                                                                                                                                      |
| 15  | **Lead Eagle Team Leader**      | `team_manager` in a Lead-Eagle-only workspace                                                             | **Yes**                                                                                                                                                   |
| 16  | **Lead Eagle Agent**            | `sales_rep` in a Lead-Eagle-only workspace                                                                | **Yes**                                                                                                                                                   |
| 17  | **Lead Eagle Telecaller**       | The `Telecaller` configuration, in a Lead-Eagle-only workspace                                            | **Yes**                                                                                                                                                   |
| 18  | **Lead Eagle Viewer**           | `read_only` in a Lead-Eagle-only workspace                                                                | **Yes**                                                                                                                                                   |
| 19  | Custom Role / Read-Only User    | `read_only`, plus one hand-built custom role                                                              | **Yes** for the custom role — see §2.6                                                                                                                    |
| 20  | Public Visitor                  | No account at all                                                                                         | No                                                                                                                                                        |

### 2.5.1 About "Lead Eagle configurable starter roles"

**Marked Needs UI Verification.** No role in the seeded catalogue is specific to
Lead Eagle, and no separate Lead Eagle role seed was found at this commit. The
25 roles above are shared across all products: a Lead Eagle workspace uses the
same `team_manager`, `sales_rep` and `read_only`, and the entitlement layer is
what confines them to Lead Eagle's screens.

So the four Lead Eagle personas are **the general roles in a Lead-Eagle-only
workspace**, not distinct roles. If the product intends dedicated starter roles,
they are not in the repository at this commit. Confirm with the owner before
logging this as a gap — and see [12](12-coverage-and-gaps.md).

### 2.6 The three role configurations a tester must build

Build these once, in the test workspace, from **Administration → Settings →
Roles** using **New role** or **Clone selected**, before running Section 5.
Record the resulting grants as evidence; several expected results depend on them.

#### `Telecaller`

Clone `sales_rep`, then set grants to exactly:

| Module       | Actions            | Scope |
| ------------ | ------------------ | ----- |
| `leads`      | VIEW, EDIT         | OWN   |
| `calls`      | VIEW, CREATE, EDIT | OWN   |
| `tasks`      | VIEW, CREATE, EDIT | OWN   |
| `activities` | VIEW, CREATE       | OWN   |
| `dashboards` | VIEW               | OWN   |

Deliberately **absent**: `leads CREATE`, `leads ASSIGN`, `opportunities`,
`contacts`, `accounts`, `reports`, `smartviews`, `products`. Several negative
cases rely on each absence.

#### `Real Estate Operations`

Clone `team_manager`, then add at BRANCH scope: `projects VIEW/CREATE/EDIT`,
`listings VIEW/CREATE/EDIT`, `visits VIEW/CREATE/EDIT/APPROVE`,
`bookings VIEW/CREATE/EDIT`, `collections VIEW`, `events VIEW/CREATE/EDIT`.
Deliberately **absent**: `commissions APPROVE`, `payouts`, `payroll`.

#### `Custom Minimal`

A hand-built role to prove the RBAC engine itself, not a preset. Grants: exactly
one — `leads VIEW @ OWN`. Nothing else. Every other screen in the product must
refuse it, and the nav must show almost nothing.

## 2.7 Platform roles

Separate from workspace roles entirely. A workspace role can never reach the
platform console, and a platform role holds no workspace permissions of its own.

| `PlatformRole`     | What it is                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER`             | A platform account with no platform access (lands on `/no-platform-access`)                                                                                             |
| `OWNER`            | Full platform authority; **can elevate to write inside a customer workspace through a time-boxed break-glass grant**                                                    |
| `SUPPORT`          | Read-only across workspaces                                                                                                                                             |
| `SECURITY_AUDITOR` | Read-only across workspaces                                                                                                                                             |
| `AI_SERVICE`       | A machine identity for background and AI reads across every workspace. Authenticates only with a rotatable credential, **can never elevate**, read-only by construction |

### Break-glass, and why it is a P0 test area

Opening a customer workspace needs no ceremony. **Changing something in it needs
a stated reason and a clock.** Every grant expires, there is deliberately no
unlimited option, and expiry is enforced on every read rather than by a sweeper —
so a failed cleanup job cannot silently extend anyone's authority.

| Grant type                                    | Default | Maximum                          |
| --------------------------------------------- | ------- | -------------------------------- |
| Write (break-glass) into one workspace        | 30 min  | 240 min (4 h)                    |
| Read (monitoring) into one workspace          | 7 days  | 30 days                          |
| Coverage across every workspace (operational) | 1 day   | 7 days                           |
| Standing CRM monitoring                       | 90 days | _(bounded; no unlimited option)_ |

The historical defect this replaced is the reason for `PLAT-BG-001` through
`PLAT-BG-006`: a platform OWNER previously held every permission in every tenant
at ORGANIZATION scope, forever, with no record of why — while the audit row said
`platform_support_readonly`.

_Source: `apps/web/src/lib/auth/platform-access.ts`, `prisma/schema.prisma`_

## 2.8 Session facts a tester needs

| Fact                               | Value                                       | Source                         |
| ---------------------------------- | ------------------------------------------- | ------------------------------ |
| Web session lifetime               | 480 minutes (8 h)                           | `SESSION_TTL_MINUTES`          |
| Idle timeout                       | 60 minutes                                  | `SESSION_IDLE_TIMEOUT_MINUTES` |
| Service (platform machine) session | 30 minutes, capped at 480                   | `SERVICE_SESSION_TTL_MINUTES`  |
| Mobile device session              | 90 days                                     | `DEVICE_SESSION_DAYS`          |
| MFA enrolment window               | 10 minutes                                  | `MFA_ENROLMENT_TTL_MINUTES`    |
| Password reset token               | 30 minutes                                  | `RESET_TTL_MINUTES`            |
| **Permission-change propagation**  | **Up to 60 seconds**, and usually immediate | see below                      |

**Permission changes and live sessions.** A user's resolved authority is cached
for 60 seconds. But any write to a model that feeds it invalidates the cache for
the whole tenant automatically, so in practice a role change takes effect on the
user's **next request**. The 60-second TTL is a backstop for changes made outside
the application. So `E2E-PERM-007` expects the restricted action to fail
immediately on the next action — and allows up to 60 seconds before recording a
Fail.

### Rate limits — exact, and several cases depend on them

| What                                   | Limit | Window |
| -------------------------------------- | ----- | ------ |
| Sign-in per IP                         | 10    | 5 min  |
| Sign-in per account                    | 5     | 5 min  |
| Service sign-in per username           | 10    | 15 min |
| Password reset per email               | **3** | 1 hour |
| Password reset per IP                  | 20    | 1 hour |
| MFA confirm per user                   | 10    | 5 min  |
| Invitation lookup per IP               | 30    | 10 min |
| Requests per signed-in user            | 1200  | 1 min  |
| Export creation per user               | 10    | 1 hour |
| Lead notification emails per workspace | 300   | 1 day  |
| Webhook per integration                | 600   | 1 min  |

The **public** (unauthenticated) endpoints carry their own limits, declared on
each route rather than in that table:

| Endpoint                                        | Limit | Window     |
| ----------------------------------------------- | ----- | ---------- |
| `POST /api/v1/public/forms` (submit a web form) | 10    | 1 min      |
| `GET /api/v1/public/forms` (read a form)        | 60    | 1 min      |
| `POST /api/v1/public/capture` (QR capture)      | 10    | 1 min      |
| `POST /api/v1/public/share-view`                | 60    | 1 min      |
| `POST /api/v1/public/proposal`                  | 30    | 1 min      |
| `GET /api/v1/public/rsvp`                       | 30    | 1 min      |
| `POST /api/v1/public/rsvp`                      | 20    | 1 min      |
| `GET /api/v1/public/testimonial`                | 30    | 1 min      |
| `POST /api/v1/public/testimonial`               | 10    | 1 min      |
| `POST /api/v1/public/signup` (trial sign-up)    | **5** | **1 hour** |

> `limits.publicForm` (5 / min) and `limits.publicShare` (60 / min) are
> **declared in `ratelimit.ts` but no call site for either was found** at this
> commit. The effective limits are the per-route ones above. Noted as a finding
> in [12](12-coverage-and-gaps.md), not as a test failure.

_Source: `apps/web/src/lib/security/ratelimit.ts`, each `src/app/api/v1/public/*/route.ts`, `src/lib/env.ts`, `src/lib/auth/session.ts`_
