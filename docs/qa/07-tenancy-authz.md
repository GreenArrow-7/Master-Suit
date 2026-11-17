# Section 7 — Multi-tenant isolation and authorization

This is the section a release is blocked on. Every case here is **P0 unless
marked otherwise**, and every one must be checked **by direct HTTP request** as
well as through the UI — because hiding a button is not a restriction.

## 7.0 The four layers, and what each one's failure looks like

| Layer                          | Where                                                                                            | A failure looks like                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1. Application tenant guard    | `src/lib/db.ts` — a query issued without a tenant raises `TenantGuardError`                      | A 500 naming `TenantGuardError`: a bug, but a **safe** one |
| 2. Database row-level security | 47 tables; `withTx(tenantId)` runs `SELECT set_config('app.tenant_id', …, true)` per transaction | Another tenant's rows appear. **Catastrophic**             |
| 3. Scope                       | `src/lib/security/visibility.ts`, `record-scope.ts`                                              | A colleague's records appear, or 403 where 404 was due     |
| 4. Field security              | `src/lib/security/fieldSecurity.ts`                                                              | A masked value appears in the API, an export or a note     |

Cross-tenant reads are possible **only** through `withPlatformTx`, which sets a
distinct `app.platform_admin` flag the row-level-security policies name
explicitly. No workspace request path can reach it.

`set_config(..., true)` is **transaction-local**, so a tenant value cannot leak
to the next request on the same pooled connection.

### How to make the direct requests

Sign in through the browser as the role under test. Open developer tools, find
any API request, right-click → **Copy as fetch**, and edit the URL or body. Your
session cookie travels with it. **Record the status code for every attempt** —
a screenshot of an error page is not evidence for these cases.

### The 403-versus-404 rule, and why it matters

- **Out of your scope → 404.** Deliberate: a 403 would confirm the record
  exists, which is an enumeration oracle.
- **Module not in the plan → 403**, naming the product.
- **Permission absent → 403.**

So a 403 where the table below says 404 is a **defect**, even though it also
refuses the request. Record it.

---

## TEN-ISO-001 — A workspace administrator cannot reach another company

|                    |                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Tenancy                                                                                                                                                                                        |
| **User Role**      | Company Admin of `manath-homes`, then of `leadersfort`                                                                                                                                         |
| **Feature**        | Tenant isolation                                                                                                                                                                               |
| **Test Scenario**  | The most privileged workspace role cannot read, write or even confirm the existence of another company's data                                                                                  |
| **Priority**       | **P0**                                                                                                                                                                                         |
| **Preconditions**  | `manath-homes` and `leadersfort` both seeded. T17 is `org_admin` in `leadersfort`. You have at least one **real record ID** from each: a lead, a user, an employee, and (if present) a booking |
| **Code Reference** | `src/lib/db.ts` (`withTx`, `TenantGuardError`, `withPlatformTx`), the migrations' 47 `ENABLE ROW LEVEL SECURITY` statements                                                                    |

**Test Steps**

1. Sign in as T17 in `leadersfort`. Note a real employee ID and a real user ID there.
2. Sign in as `admin@manathhomes.ae` in `manath-homes`. Note a real lead ID, user ID and employee ID there.
3. As the `manath-homes` admin, navigate to `/leadersfort/dashboard`. Record what happens.
4. Navigate to `/leadersfort/people/employees`.
5. Navigate to `/leadersfort/admin/users`.
6. For each of these, send the request from the `manath-homes` admin's session and **record the status and the body**:

| Request                                                            | Expected                              |
| ------------------------------------------------------------------ | ------------------------------------- |
| `GET /api/v1/leads/{a leadersfort id}`                             | **404**                               |
| `PATCH /api/v1/leads/{a leadersfort id}`                           | **404**                               |
| `DELETE /api/v1/leads/{a leadersfort id}`                          | **404**                               |
| `GET /api/v1/workspaces/leadersfort/hr/self`                       | **403 or 404** — never 200            |
| `GET /api/v1/accounts/{a leadersfort id}`                          | 404                                   |
| `POST /api/v1/leads` with `ownerId` = a `leadersfort` user id      | **404**, and no lead created          |
| `POST /api/v1/leads` with `sourceId` = a `leadersfort` lead source | **404**                               |
| `GET /api/v1/leads?cursor={a leadersfort record id}`               | 200 with **only `manath-homes` data** |
| `GET /api/v1/leads?q={a leadersfort lead's exact phone number}`    | **No result**                         |
| `GET /api/v1/admin/audit`                                          | Only `manath-homes` entries           |
| Any export                                                         | Only `manath-homes` rows              |

7. Reverse the whole thing: as T17 in `leadersfort`, attempt every equivalent against `manath-homes` IDs.
8. As the `manath-homes` admin, create a lead. As T17, search `leadersfort` for it by name, email and phone.
9. As the `manath-homes` admin, open the audit log. Confirm no `leadersfort` entry appears.
10. Sign in to both workspaces in the **same browser** in two tabs. Act in each alternately, ten times. Confirm no data crosses.

**Expected Result**

- Every cross-tenant read returns **404** or 403. **Not one byte of another company's data appears**, in any field, in any response, in any export, in any audit log, in any search result.
- Step 6's `cursor` row is the pooled-connection test: a record ID from another tenant used as a cursor must not pull that tenant's rows in. `set_config` is transaction-local, so it cannot.
- Step 10 is the connection-reuse test: alternating between two tenants in one browser must never serve one tenant's data to the other.
- A `TenantGuardError` (a 500) is a bug worth reporting — but it is a **safe** failure. Returning another tenant's data is not.

**Negative Scenarios**

| What to try                                                                             | Expected                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A `manath-homes` session cookie sent to a `/leadersfort/...` URL                        | Refused                                                                                                                                        |
| A slug that does not exist, e.g. `/nonexistent/dashboard`                               | Refused the same way as `/leadersfort/dashboard` — the two must not be distinguishable to someone outside both                                 |
| An API key issued in `manath-homes` used against `leadersfort` data                     | Refused                                                                                                                                        |
| A mobile device session from one workspace used against the other                       | Refused                                                                                                                                        |
| A share token (`/s/{token}`) from `leadersfort` opened while signed into `manath-homes` | Shows the `leadersfort` record **as a public share**, which is what the token is for. Confirm it carries nothing internal — see `RE-SHARE-001` |

**Evidence** — The completed step-6 table with every status code, in both directions. **This table is the single most important artefact in the whole suite.**

---

## TEN-ISO-002 — Users cannot reach a workspace they do not belong to

|                    |                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Module**         | Tenancy                                                                                           |
| **User Role**      | Every seeded role in `manath-homes`                                                               |
| **Feature**        | Membership                                                                                        |
| **Test Scenario**  | A user's session reaches exactly the workspaces they are a member of                              |
| **Priority**       | **P0**                                                                                            |
| **Preconditions**  | Accounts in `manath-homes` and in `leadersfort`                                                   |
| **Code Reference** | `src/lib/auth/session.ts`, `src/app/api/v1/auth/workspaces/route.ts`, `src/lib/workspace-page.ts` |

**Test Steps**

1. Sign in as `sales.rep@manathhomes.ae`.
2. Call `GET /api/v1/auth/workspaces`. Confirm **only** `manath-homes` is listed.
3. Navigate to `/leadersfort/dashboard`.
4. Navigate to `/leadersfort/sales/leads`.
5. Repeat steps 3–4 as each of: `org_admin`, `team_manager`, `branch_manager`, `regional_manager`, `sales_director`, `call_qa`, `analyst`, `read_only`, `executive_read_only`, T1 (`hr_admin`), T8 (`it_admin`), T4 (`finance_admin`), T11 (`auditor`), T9 (`employee`), T14 (`Custom Minimal`).
6. Create a user with the **same email address** in both workspaces. Sign in and confirm which workspace you reach, and how you would reach the other.
7. For that dual-membership account, confirm that acting in one workspace carries **no** authority into the other, even where the role names match.

**Expected Result**

- `GET /api/v1/auth/workspaces` lists only the caller's own memberships.
- Every role in step 5 is refused for `leadersfort`, identically. **No role is an exception** — not `org_admin`, not `super_admin`.
- Accounts are unique per **(workspace, email)**, not globally, so the same address can exist in both as two separate accounts with separate roles, separate passwords and separate data.
- Step 7: authority is per membership. A `team_manager` in one workspace has no standing in the other.

**Negative Scenarios**

| What to try                                                    | Expected                              |
| -------------------------------------------------------------- | ------------------------------------- |
| A slug with different capitalisation, `/Leadersfort/dashboard` | Refused or normalised; never a way in |
| A slug with a trailing slash, a dot, or URL-encoded characters | Refused                               |
| `/leadersfort/../manath-homes/dashboard`                       | Resolved safely                       |
| A workspace that was deleted                                   | Refused                               |

**Evidence** — The `auth/workspaces` response for each role; a table of role → result for step 5.

---

## TEN-PLAT-001 — No workspace role reaches the platform console

|                    |                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Tenancy                                                                                                                                               |
| **User Role**      | Every workspace role, including `org_admin` and `super_admin`                                                                                         |
| **Feature**        | The platform boundary                                                                                                                                 |
| **Test Scenario**  | The vendor's console is unreachable from any workspace session                                                                                        |
| **Priority**       | **P0**                                                                                                                                                |
| **Preconditions**  | A signed-in `org_admin`, and a signed-in `super_admin` if one exists                                                                                  |
| **Code Reference** | `src/app/(platform)/platform/layout.tsx`, `src/lib/auth/platform.ts`, `src/lib/auth/platform-access.ts`, `prisma/schema.prisma` (`enum PlatformRole`) |

**Test Steps**

1. Sign in as `admin@manathhomes.ae`.
2. For each of these, navigate to it and record exactly what happens:

| URL                                          |
| -------------------------------------------- |
| `/platform`                                  |
| `/platform/workspaces`                       |
| `/platform/workspaces/{a real workspace id}` |
| `/platform/plans`                            |
| `/platform/subscriptions`                    |
| `/platform/users`                            |
| `/platform/identity`                         |
| `/platform/credentials`                      |
| `/platform/security`                         |
| `/platform/ai-control`                       |
| `/platform/ai-usage`                         |
| `/platform/audit`                            |
| `/platform/system-health`                    |
| `/platform/settings`                         |

3. For each of these API requests from the same session, record the status:
   - `GET /api/v1/platform/workspaces`
   - `POST /api/v1/platform/workspaces` (attempt to create one)
   - `PATCH` a workspace's modules
   - the break-glass grant endpoint
   - any platform audit endpoint
4. Repeat steps 2–3 as `super_admin` if the workspace has one.
5. Repeat as T8 (`it_admin`) — the role that administers accounts and settings.
6. Repeat with a signed-in **platform** `USER` (no platform grant) and confirm they reach `/no-platform-access`, which is **different** from what a workspace user gets.
7. Attempt to change your own workspace user record's platform role, by API.
8. Attempt to create a platform user from a workspace session.

**Expected Result**

- Every URL and every endpoint is refused for **every** workspace role.
- `it_admin` administers the workspace and has **no** platform standing. Administering accounts is not a reason to run the platform.
- A workspace role can never grant itself a platform role: steps 7 and 8 are refused.
- The two identity spaces are separate: a workspace role holds no platform permission, and a platform role holds no workspace permission of its own (platform staff act in a workspace only through a support actor, and only within a grant — `PLAT-WS-003`, `PLAT-BG-001`).
- A platform `USER` reaching `/no-platform-access` is a **different** outcome from a workspace user being refused. Record both wordings so they are not confused.

**Negative Scenarios**

| What to try                                                                          | Expected                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `/platform` with a platform owner's session cookie copied into the workspace browser | Works — that is the owner's session. Not a defect; note it and do not pursue it |
| `/platform` with a forged cookie                                                     | Refused                                                                         |
| A workspace API key used against a platform endpoint                                 | Refused                                                                         |
| `/api/mobile/...` platform equivalents, if any                                       | Refused                                                                         |

**Evidence** — The two tables, filled in, with the exact wording of each refusal.

---

## TEN-SCOPE-001 — OWN scope: an agent cannot see a colleague's lead

|                    |                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                                                     |
| **User Role**      | Sales Agent (`sales_rep`, OWN)                                                                                                |
| **Feature**        | Record scope on read and on write                                                                                             |
| **Test Scenario**  | A record outside OWN scope returns 404 on read, on write and on delete                                                        |
| **Priority**       | **P0**                                                                                                                        |
| **Preconditions**  | Sara and Rayan each own at least two leads. You know one of Rayan's lead IDs                                                  |
| **Code Reference** | `src/lib/security/visibility.ts` (`visibilityWhere`, `assertRecordVisible`), `src/lib/security/record-scope.ts` (`leadScope`) |

**Test Steps**

1. Sign in as Sara. Confirm **CRM → Leads → All Leads** shows only her leads.
2. Navigate to `/manath-homes/sales/leads/{Rayan's lead id}`. Record the result.
3. From Sara's session, send and record each of:
   - `GET /api/v1/leads/{Rayan's lead id}`
   - `PATCH /api/v1/leads/{Rayan's lead id}` with `{"city":"QA"}`
   - `DELETE /api/v1/leads/{Rayan's lead id}`
   - `POST /api/v1/activities` referencing Rayan's lead
   - `POST /api/v1/calls` with Rayan's lead as the lead
   - `POST /api/v1/tasks` against Rayan's lead
   - `GET /api/v1/leads?q={Rayan's lead's exact full name}`
   - `GET /api/v1/leads?q={Rayan's lead's exact phone number}`
4. As Rayan, confirm his lead is **unchanged**.
5. Repeat for each of these record types, using a record Rayan owns: an opportunity, a task, an activity, a call, a site visit.
6. Confirm the equivalent for the **mobile** API, if the endpoint exists.

**Expected Result**

- Every read, write and delete is **404**. Not 403, not 200, not an empty 200.
- Searching by another agent's lead's exact name or number returns **nothing** — a search that confirms existence is an enumeration oracle.
- **Scope is re-applied on write** by loading the record inside the transaction. Checking only on read is the classic IDOR, because a PATCH never passes through the list query. Step 3's PATCH and DELETE are that test, and they are the two most important requests in this case.
- Creating a child record (an activity, a call, a task) against an out-of-scope parent is refused too.

**Negative Scenarios**

| What to try                                       | Expected                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A bulk update whose ID list includes Rayan's lead | Sara's own are updated; Rayan's is not, and the response says so. **Silently applying it is a P0 defect** |
| A filter crafted to match Rayan's lead            | Returns nothing                                                                                           |
| An export                                         | Sara's leads only                                                                                         |
| A saved view shared by Rayan                      | Record the behaviour; a shared view must not widen scope                                                  |
| Rayan's lead ID in a report drill-down URL        | 404                                                                                                       |

**Evidence** — Every status code from step 3; Rayan's lead unchanged.

---

## TEN-SCOPE-002 — TEAM scope: a leader sees their tree and no more

|                    |                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                                                                             |
| **User Role**      | Team Leader (`team_manager`, TEAM)                                                                                                                    |
| **Feature**        | TEAM scope, including descendant teams                                                                                                                |
| **Feature**        | —                                                                                                                                                     |
| **Priority**       | **P0**                                                                                                                                                |
| **Preconditions**  | `ADMIN-TEAM-001` is done: Omar manages Sara and Rayan in `QA Team A`, with a child team `QA Team A1`. Nadia is in branch DT, in **no** team of Omar's |
| **Code Reference** | `src/lib/security/visibility.ts` (`case 'TEAM'`, `descendantTeamIds`)                                                                                 |

**Test Steps**

1. Sign in as Omar. Count the leads on **All Leads** and list their owners.
2. Confirm the list is exactly: Omar's own, Sara's, Rayan's, and `QA Team A1`'s member's.
3. Confirm **none** of Nadia's leads appear.
4. Navigate to `/manath-homes/sales/leads/{one of Nadia's lead ids}`. Record the result.
5. From Omar's session, `PATCH` Nadia's lead. Record the status.
6. Attempt to **assign** one of Sara's leads to Nadia. Record the status.
7. Attempt to assign it to Rayan. Confirm it succeeds.
8. As Admin, remove Rayan from `QA Team A`. In Omar's session, reload.
9. Confirm Rayan's leads are gone from Omar's list, and note how long it took.
10. As Admin, put Rayan back. Confirm his leads return.
11. As Admin, delete the child team `QA Team A1`. Confirm its member's leads leave Omar's view.
12. Confirm Omar's reports, dashboards and the daily board all show the **same** set of people as his lead list.

**Expected Result**

- TEAM resolves to **self + managed users + every member of the team and its descendant teams**.
- Step 4 and 5: **404**.
- Step 6: **404** — Nadia is outside Omar's ASSIGN scope.
- Steps 8–9: the change takes effect on the **next page load**. Scope resolution is memoized **per request only**; there is no cross-request cache, so there is no five-minute delay to wait for. _(A comment in the code once claimed a five-minute Redis cache; none ever existed.)_
- Step 12: **every** scoped surface agrees. A report that shows a wider set than the lead list is a P0 scope leak, and it is the most likely place for one to hide.

**Negative Scenarios**

| What to try                                                      | Expected                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Omar in **two** teams                                            | The union of both trees                                                                                                                                           |
| A team with a cycle                                              | Resolution terminates; no hang                                                                                                                                    |
| Omar as the manager of someone in **no** team                    | That person's records are included (`managedUserIds`)                                                                                                             |
| A lead whose `secondaryOwnerId` is Sara but whose owner is Nadia | **Visible to Omar** — `leadScope` includes co-owner fields, so a record is in scope when any of them names a resolved owner. Confirm, and do not log it as a leak |

**Evidence** — Omar's lead list with owners, at each of the six configurations; the status codes from steps 4–6; the comparison in step 12.

---

## TEN-SCOPE-003 — BRANCH and REGION scope

|                    |                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**         | Sales CRM                                                                                                                                                                                  |
| **User Role**      | Branch Manager, Regional Manager                                                                                                                                                           |
| **Feature**        | BRANCH and REGION scope                                                                                                                                                                    |
| **Test Scenario**  | A branch manager sees their branch and not another, and a region manager sees every branch in their region                                                                                 |
| **Priority**       | **P0**                                                                                                                                                                                     |
| **Preconditions**  | Sofia is `branch_manager` in BB. Priya is `branch_manager` in DT. Elena is `regional_manager` in DXB (BB, JLT, DT). Tariq is `regional_manager` in AUH (REEM). Leads exist in every branch |
| **Code Reference** | `src/lib/security/visibility.ts` (`case 'BRANCH'`, `case 'REGION'`)                                                                                                                        |

**Test Steps**

1. Sign in as Sofia. List the owners of every lead she sees. Confirm all are in **BB**.
2. Navigate to a DT lead's URL. Record the result.
3. `PATCH` a DT lead from Sofia's session. Record the status.
4. Sign in as Priya. Confirm she sees DT and not BB.
5. Sign in as Elena. Confirm she sees BB, JLT **and** DT, and **not** REEM or SHJ.
6. Navigate to a REEM lead's URL from Elena's session. Record the result.
7. Sign in as Tariq. Confirm he sees REEM and nothing in DXB.
8. As Admin, give Sofia a **BRANCH-scoped role assignment naming JLT** (`ADMIN-ROLE-003`).
9. In Sofia's session, reload. Confirm JLT leads now appear **as well as** BB.
10. Remove the assignment. Confirm JLT leaves her view.
11. As Admin, clear Sofia's own branch field entirely, keeping the role. Reload.
12. Record what she sees.

**Expected Result**

- BRANCH resolves to the actor's own branch **plus any branch a BRANCH-scoped role assignment names** — a manager covering a second branch sees it without being moved there. Step 9 is that case.
- REGION resolves the same way, one level up.
- Steps 2, 3 and 6: **404**.
- Step 12: **only Sofia herself.** BRANCH with no branch returns `[self]`. See `SALES-SCOPE-004` — this is correct, not a bug.

**Negative Scenarios**

| What to try                                | Expected                                                                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A branch in another **tenant**             | Not resolvable                                                                                                                                                                                                         |
| A role assignment with an expired window   | Grants nothing                                                                                                                                                                                                         |
| A role assignment whose branch was deleted | Grants nothing wider than self                                                                                                                                                                                         |
| A lead whose owner has **no** branch       | Record who sees it: a manager's BRANCH query is on users' branch ids, so a branchless owner's leads may be invisible to every branch manager. **Record this** — it is a real operational trap, and leads can go unseen |

**Evidence** — For each of the five managers, the branches of every lead owner they see; the status codes; Sofia's view at each of the four configurations.

---

## TEN-SCOPE-006 — An employee sees only their own HR records

|                    |                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | HRMS                                                                                                                      |
| **User Role**      | Employee (`employee`, OWN)                                                                                                |
| **Feature**        | OWN scope on HR records                                                                                                   |
| **Test Scenario**  | An employee reads their own record, attendance, leave, overtime, payslips and performance, and nobody else's              |
| **Priority**       | **P0**                                                                                                                    |
| **Preconditions**  | T9 and a second employee both have records, attendance, leave and payslips. You know the second employee's IDs            |
| **Code Reference** | `prisma/seed/roles.ts` (the `employee` block), `src/lib/security/record-scope.ts` (`attendanceScope`), `src/services/hr/` |

**Test Steps**

1. Sign in as T9.
2. Confirm **People → My HR** shows only T9's own records, and the tabs are labelled **My …**.
3. Confirm T9 can read: their own employee record (and edit it), their attendance, their leave, their overtime, their payslips, their performance, their roster, and the **organisation-wide** holiday calendar.
4. Navigate to `/manath-homes/people/employees`. Record the result.
5. Navigate to `/manath-homes/people/payroll`. Record the result.
6. Navigate to `/manath-homes/people/attendance`. Record the result.
7. From T9's session, send and record each of:
   - `GET` the second employee's record
   - `PATCH` the second employee's record
   - `GET` the second employee's attendance
   - `GET` the second employee's leave requests
   - `GET` the second employee's payslip
   - `POST` a leave request **on behalf of** the second employee
   - `POST` an attendance punch **for** the second employee
   - `POST` a leave approval on their own request
8. Confirm T9's own payslip shows their own salary.
9. Confirm T9 cannot see any other employee's salary anywhere, including in the holiday calendar, the directory, or a report.
10. Confirm T9 **can** check in and out (`HR-CHECKIN-001`) with no `attendance` grant for creation at all — because self-service is authorised by being the account in question.

**Expected Result**

- Every request in step 7 is **404** or **403**. A 200 on any of them is a **P0 personal-data breach**.
- Steps 4–6: refused — those are the oversight screens.
- Step 10: works. **Biometric consent and check-in are deliberately absent from the `employee` role's grants** because they live on the self-service route, authorised by being the account in question rather than by holding a module grant. Do not log their absence as a defect.
- T9 holds `holidays:VIEW @ ORGANIZATION` — the public holiday calendar is the same for everyone. That is the one organisation-wide thing they see.

**Negative Scenarios**

| What to try                                                           | Expected |
| --------------------------------------------------------------------- | -------- |
| T9 reading their own **manager's** record                             | 404      |
| T9 reading an **exited** colleague's record                           | 404      |
| T9 using a payslip URL with the ID incremented                        | 404      |
| T9 using a document URL for an HR document about someone else         | 404      |
| A direct object reference in a face-activity or attendance-export URL | 404      |

**Evidence** — Every status code from step 7; T9's own payslip; the refusals from steps 4–6.

---

## TEN-FIELD-001 — A lead's phone number is masked below branch level

|                    |                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                                                                                              |
| **User Role**      | Sales Agent, Team Leader, Branch Manager                                                                                                                               |
| **Feature**        | Sensitive-field masking                                                                                                                                                |
| **Test Scenario**  | The same lead's phone number is masked for some roles and real for others, consistently across every egress path                                                       |
| **Priority**       | **P0**                                                                                                                                                                 |
| **Preconditions**  | A lead with a full phone number, visible to all three roles (in branch BB, owned by Sara)                                                                              |
| **Code Reference** | `src/lib/security/fieldSecurity.ts` (`applyFieldSecurity`, `asLeadPhone`, `maskCallNumbers`, `dialable`), `src/services/leads/createLead.ts` (`LEAD_SENSITIVE_FIELDS`) |

**Test Steps**

1. As Admin, note the lead's full phone number and email.
2. For each of Sara (`sales_rep`), Omar (`team_manager`) and Sofia (`branch_manager`), sign in and record the phone number as it appears in **each** of these places:

| Egress path               | How                                              |
| ------------------------- | ------------------------------------------------ |
| The lead page             | read it                                          |
| The lead grid             | read the column                                  |
| The raw API               | `GET /api/v1/leads/{id}` — read the JSON         |
| The list API              | `GET /api/v1/leads` — read the JSON              |
| A CSV export              | download and open it, if the role may export     |
| A call record             | `GET /api/v1/calls/{id}` for a call on that lead |
| The lead's timeline notes | read them                                        |
| A report drill-down       | open it                                          |
| The mobile API            | if available                                     |

3. Attempt to **dial** the lead as Sara. Record the result.
4. Search by the **full** phone number as Sara. Record whether the lead is returned.
5. Filter the lead list by phone as Sara, via the API's filter parameter. Record the status.
6. As Admin, note which roles hold `leads:VIEW_SENSITIVE_FIELDS`: `super_admin`, `org_admin`, `sales_director` (ORGANIZATION), `regional_manager` (REGION), `branch_manager` (BRANCH). **Nobody below branch level.**
7. Repeat the whole table for the lead's **email**.
8. Repeat for a **call's** numbers (`maskCallNumbers`).

**Expected Result**

| Role                       | Phone                 |
| -------------------------- | --------------------- |
| Sara (`sales_rep`)         | **masked** everywhere |
| Omar (`team_manager`)      | **masked** everywhere |
| Sofia (`branch_manager`)   | real                  |
| Elena (`regional_manager`) | real                  |
| Dhruv (`sales_director`)   | real                  |
| Admin (`org_admin`)        | real                  |

- The mask is applied at the **API**, not only in the page. **A masked screen over an unmasked API is a P0 data-leak defect**, and it is the single most likely place for one.
- Step 3: dialling is **refused** — `dialable()` refuses a mask rather than dialling nonsense. The rule is enforced at the action, not only at the display.
- Step 4: the lead is **not** returned on a phone match for a user who cannot see the number.
- Step 5: refused — a filter that references a field the caller cannot see is rejected, not silently ignored.
- **The API, the grid and the CSV are all egress paths and must agree.** Any disagreement is a defect even if two of the three are correct.

**Negative Scenarios**

| What to try                                                 | Expected                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A field selection naming `phone` explicitly, by API         | Masked                                                                             |
| A GraphQL-style or expanded include, if any exists          | Masked                                                                             |
| The number in a timeline note created by a public form      | **Absent.** Contact details never go on the note, which nobody masks               |
| The number in a notification email to the agent             | Record what it contains — a notification is an egress path too                     |
| The number in an AI prompt or transcript sent to a provider | **Record this and raise it.** It is a question for the owner, not a pass/fail here |

**Evidence** — A grid: role × egress path, each cell holding what you actually saw. Nine paths × six roles. This grid is the deliverable.

---

## TEN-FIELD-003 — HR Executive cannot see a salary

|                    |                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| **Module**         | HRMS                                                                                                   |
| **User Role**      | HR Executive (T2)                                                                                      |
| **Feature**        | Sensitive employee fields                                                                              |
| **Test Scenario**  | A role with full employee access and no sensitive-field grant sees no pay                              |
| **Priority**       | **P0**                                                                                                 |
| **Preconditions**  | An employee with a recorded salary. T2 is `hr_executive`                                               |
| **Code Reference** | `prisma/seed/roles.ts` (`hr_executive` has no `payroll` grant and no `employee:VIEW_SENSITIVE_FIELDS`) |

**Test Steps**

1. Sign in as T2.
2. Open the employee's record. Look for any compensation figure.
3. Open **People → Employees → Documents** and look for a salary certificate or contract carrying pay.
4. Open **Insights → Reports → HR** and look for a pay column in every report offered.
5. Export whatever T2 may export, and search the file for the salary figure.
6. From T2's session, send and record:
   - `GET /api/v1/workspaces/manath-homes/hr/...` the employee record — search the JSON for any pay field
   - the payroll endpoints
   - the compensation endpoints
   - an HR report export
7. Repeat the whole case as T10 (`recruiter`) and as T8 (`it_admin`).

**Expected Result**

- T2 sees **no** salary figure anywhere — not masked, **absent**, because `hr_executive` holds no `payroll` grant at all.
- Payroll endpoints: **403**.
- `recruiter` likewise: `employee:VIEW` only, no sensitive fields.
- `it_admin` likewise, and more sharply: it holds **no HR or Sales record access at all** — administering accounts is not a reason to be able to read salaries. See `TEN-FIELD-005`.
- A salary reachable through an HR **document** that T2 may read is still a leak. Check step 3 carefully; it is the gap a permission matrix does not cover.

**Negative Scenarios**

| What to try                                | Expected                                       |
| ------------------------------------------ | ---------------------------------------------- |
| A WPS file download as T2                  | 403                                            |
| A payslip URL as T2                        | 403                                            |
| A bank-detail field on the employee record | Absent or masked                               |
| An Emirates ID or passport number          | Record what T2 sees; raise anything surprising |

**Evidence** — The employee record as T2 sees it; the JSON from step 6 with a search for the salary figure; the same for `recruiter` and `it_admin`.

---

## TEN-FIELD-004 — A Sales Agent cannot read employee data

|                   |                                                    |
| ----------------- | -------------------------------------------------- |
| **Module**        | Cross-module                                       |
| **User Role**     | Sales Agent                                        |
| **Feature**       | Module boundary                                    |
| **Test Scenario** | A CRM role holds nothing in HR                     |
| **Priority**      | P0                                                 |
| **Preconditions** | Sara is `sales_rep`. Employees with salaries exist |

**Test Steps**

1. Sign in as Sara.
2. Confirm the **People** section shows only **My HR** (check-in and her own payslips), if anything.
3. Navigate to `/manath-homes/people/employees`, `/people/payroll`, `/people/leave`, `/people/documents`, `/people/reports`. Record each.
4. From Sara's session, send and record: the employee list endpoint, one employee record, the payroll list, one payslip, an HR report export.
5. Confirm Sara **can** reach her own check-in and her own payslips.

**Expected Result**

- `sales_rep` holds no `employee`, `payroll`, `leave`, `hr_documents` or `hr_reports` grant. Every oversight screen and endpoint is **403**.
- Her **own** payslips and check-in work: those are self-service.

**Negative Scenarios** — Any 200 carrying another person's HR data is a P0 breach.

**Evidence** — A table of URL/endpoint → status.

---

## TEN-FIELD-005 — IT Administrator reads no business records

|                    |                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Cross-module                                                                                                                                                            |
| **User Role**      | IT Administrator (T8)                                                                                                                                                   |
| **Feature**        | Role boundary by design                                                                                                                                                 |
| **Test Scenario**  | The role that runs the plumbing holds no lead, call, employee or salary access                                                                                          |
| **Priority**       | **P0**                                                                                                                                                                  |
| **Preconditions**  | T8 is `it_admin`. Leads, calls and employees with salaries exist                                                                                                        |
| **Code Reference** | `prisma/seed/roles.ts` — _"Runs the plumbing and deliberately holds no HR or Sales record access: administering accounts is not a reason to be able to read salaries."_ |

**Test Steps**

1. Sign in as T8.
2. Write down every section the sidebar shows. Expect: Home, Administration (Settings, Users, Teams, Roles read-and-assign, Integrations, API keys, Audit Log, imports, exports, Automation), Insights → Dashboards, Account.
3. Confirm **CRM is absent**, **Real Estate is absent**, **People is absent**, **Properties is absent**, **Marketing is absent**, **Finance is absent**.
4. Navigate to each of: `/manath-homes/sales/leads`, `/sales/calls`, `/sales/opportunities`, `/sales/collections`, `/sales/commissions`, `/people/employees`, `/people/payroll`. Record each.
5. From T8's session, send and record: `GET /api/v1/leads`, `GET /api/v1/calls`, `GET /api/v1/opportunities`, `GET /api/v1/commissions`, the employee list, the payroll list.
6. Confirm T8 **can**: create a user, assign a role, change a setting, configure an integration, create an API key, read and export the audit log, run an import or export.
7. Confirm T8 **cannot** create or edit a **role** (`roles:VIEW` + `ASSIGN` only).
8. T8 holds `imports:IMPORT` and `exports:EXPORT`. **Use them.** Import leads, and export leads. Record what happens.

**Expected Result**

- Every business-record read is **403**.
- T8's authority is users, roles (assign only), settings, integrations, API keys, audit, import/export and automation.
- **Step 8 is the interesting one.** `it_admin` holds `imports:IMPORT` and `exports:EXPORT` but **no `leads` grant**. So an import or export of leads should be refused on the `leads` permission even though the generic import permission is held. **Record exactly what happens.** If T8 can export the whole lead book without holding `leads:VIEW`, that is a **P0 data-leak defect** and a release blocker — the role exists precisely so that administering accounts does not grant reading customers.

**Negative Scenarios**

| What to try                                                 | Expected                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8 granting themselves `leads:VIEW`                         | Refused — no `roles:EDIT`                                                                                                                                                                                                                         |
| T8 assigning themselves the `org_admin` role                | **Record this.** `it_admin` holds `roles:ASSIGN` at ORGANIZATION. If they can assign themselves `org_admin`, the whole boundary is cosmetic — this is a P0 privilege-escalation case, and `ADMIN-ROLE-004`'s API check is the one that decides it |
| T8 reading a lead through a dashboard                       | Dashboards is gated on `leads`; T8 holds `dashboards:VIEW` but no `leads`. Record whether the page refuses or renders empty                                                                                                                       |
| T8 reading a lead through the audit log's object references | The log may name a record; confirm it does not carry the record's **contents**                                                                                                                                                                    |

**Evidence** — T8's sidebar; the status for every URL and endpoint; **the outcome of step 8 and of the second negative row, in full**.

---

## TEN-ENT-001 — Entitlement enforcement by URL and by API

|                    |                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Entitlement                                                                                                                                               |
| **User Role**      | A workspace administrator holding `*:*`                                                                                                                   |
| **Feature**        | Product entitlement                                                                                                                                       |
| **Test Scenario**  | A module the plan excludes is unreachable by URL, by API and by mobile, for the most privileged role                                                      |
| **Priority**       | **P0**                                                                                                                                                    |
| **Preconditions**  | Four workspaces, or one workspace whose modules you change between runs: SALES-only, HRMS-only, REAL_ESTATE-only, LEAD_EAGLE-only. An `org_admin` in each |
| **Code Reference** | `src/lib/security/entitlements.ts`, each layout's gate, each route's `productModule`                                                                      |

**Test Steps**

For **each** of the four single-module workspaces, with an `org_admin` signed
in — so that **only entitlement can refuse anything** — fill in this grid. Each
cell holds the URL result and the API status.

| Surface              | URL                                      | API endpoint                       |
| -------------------- | ---------------------------------------- | ---------------------------------- |
| Leads                | `/{slug}/sales/leads`                    | `GET /api/v1/leads`                |
| Calls                | `/{slug}/sales/calls`                    | `GET /api/v1/calls`                |
| Opportunities        | `/{slug}/sales/opportunities`            | `GET /api/v1/opportunities`        |
| Contacts             | `/{slug}/sales/contacts`                 | `GET /api/v1/contacts`             |
| Campaigns            | `/{slug}/sales/campaigns`                | `GET /api/v1/campaigns`            |
| Site visits          | `/{slug}/sales/site-visits`              | `GET /api/v1/site-visits`          |
| Listings             | `/{slug}/sales/listings`                 | `GET /api/v1/listings`             |
| Projects             | `/{slug}/sales/projects`                 | `GET /api/v1/projects`             |
| Collections          | `/{slug}/sales/collections`              | `GET /api/v1/collections/receipts` |
| Commissions          | `/{slug}/sales/commissions`              | `GET /api/v1/commissions`          |
| Bookings             | _(see `RE-BOOK-001`)_                    | `POST /api/v1/bookings`            |
| Payouts              | `/{slug}/sales/commissions?view=payouts` | `GET /api/v1/payouts`              |
| Events               | `/{slug}/sales/events`                   | `GET /api/v1/events`               |
| Proposals            | `/{slug}/sales/proposals`                | `GET /api/v1/proposals`            |
| Employees            | `/{slug}/people/employees`               | the HR employee endpoint           |
| Payroll              | `/{slug}/people/payroll`                 | the payroll endpoint               |
| Check-in             | `/{slug}/check-in`                       | the HR **self** endpoint           |
| Realty dashboard     | `/{slug}/realty/dashboard`               | —                                  |
| Lead Eagle dashboard | `/{slug}/lead-eagle/dashboard`           | —                                  |

**Expected Result**

The expected pattern, from each route's declared entitlement:

| Surface                                                                                                        | Required product                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Leads, calls, tasks, activities, site visits, requirements, allocation, projects, listings, documents, reports | **any of** SALES, REAL_ESTATE, LEAD_EAGLE |
| Collections, commissions, proposals, portals, events                                                           | **either** SALES or REAL_ESTATE           |
| **Bookings, payouts**                                                                                          | **SALES only**                            |
| Opportunities, contacts, accounts, campaigns, communications                                                   | SALES                                     |
| Employees, payroll, leave, shifts, HR reports                                                                  | HRMS                                      |
| Check-in, own attendance, own tasks, notifications, profile                                                    | **none** — self-service                   |

- Every refusal is the friendly panel for a page, and **403 naming the product(s)** for an API.
- A screen the plan carries under **another folder** redirects rather than refusing.
- **Bookings and payouts are the anomaly.** They assert SALES only, while everything around them accepts SALES or REAL_ESTATE. So a Real-Estate-only brokerage sees Deals and cannot create a booking or a payout. Record the exact status and message, and see [12](12-coverage-and-gaps.md).
- Check-in works in **all four** workspaces. If it refuses in any of them, that is a P0 regression — see [05d](05d-people.md) `HR-NOHRMS-001`.

**Negative Scenarios**

| What to try                                     | Expected        |
| ----------------------------------------------- | --------------- |
| Any refused endpoint with an API key            | Refused         |
| Any refused endpoint via `/api/mobile/...`      | Refused         |
| Any refused endpoint repeatedly for two minutes | Still refused   |
| A scheduled report covering a removed module    | Stops producing |

**Evidence** — The grid, four times over (once per workspace), with URL results and API statuses. 19 rows × 4 workspaces.

---

## TEN-RLS-001 — Row-level security, verified at the database

|                    |                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Tenancy                                                                                                                                                         |
| **User Role**      | Whoever can run the repository's checks                                                                                                                         |
| **Feature**        | Postgres row-level security                                                                                                                                     |
| **Test Scenario**  | Isolation is enforced at the database, not only in the application                                                                                              |
| **Priority**       | **P0**                                                                                                                                                          |
| **Preconditions**  | A local environment with the database reachable                                                                                                                 |
| **Code Reference** | `apps/web/scripts/check-rls.mjs` (`npm run check:rls`), `src/lib/db.ts` (`withTx`, `withPlatformTx`), the migrations' 47 `ENABLE ROW LEVEL SECURITY` statements |

**Test Steps**

1. From `apps/web`, run the repository's own check:

```bash
npm run check:rls
```

2. Record its output in full. Note how many tables it reports and whether any is missing a policy.
3. Also run:

```bash
npm run check:permissions
```

4. Record its output. It verifies the migrated database's permission catalogue against the code.
5. Count the tables with row-level security enabled in the migrations and compare with the check's figure. (At this commit the migrations contain **47** `ENABLE ROW LEVEL SECURITY` statements.)
6. Ask the owner to confirm that the **application's database role is not a superuser and does not have `BYPASSRLS`** — row-level security is silently inert for a superuser. **Do not attempt to check this yourself by connecting as an administrator**; ask, and record the answer.
7. Confirm with the owner that the same checks run in CI, so a new table without a policy fails the build rather than reaching production.

**Expected Result**

- `check:rls` passes with no table missing a policy.
- `check:permissions` passes: the database's catalogue and the code agree.
- Row-level security is keyed on `app.tenant_id`, set per transaction by `withTx` and **transaction-local**, so it cannot leak to the next request on a pooled connection.
- Cross-tenant work is possible only through `withPlatformTx`, which sets the separate `app.platform_admin` flag that the policies name explicitly.
- The application's database role must not bypass row-level security. **If it does, every other case in this section is testing the application layer only, and the real guarantee is absent.** That makes step 6 the most important question in this case.

**Negative Scenarios**

| What to try                                                              | Expected                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:rls` after adding a table without a policy                        | Fails. Ask the owner whether this is covered in CI                                                                                                                                                                                                                                                                                 |
| A query issued through the global client from inside a `withTx` callback | Lands on a **different** pooled connection with **no** tenant context, so row-level security returns nothing. This is a known trap: a permission or field-rule read done that way silently reads as "no rule". If you see a permission or masking check behaving as though no rule exists, suspect this before suspecting the rule |
| A `connection_limit` in `DATABASE_URL`                                   | **Ignored** by the pg adapter. The pool is 10 per process. Do not rely on it for a load test                                                                                                                                                                                                                                       |

**Evidence** — The full output of both commands; the owner's answer to step 6, in writing.

---

## TEN-API-001 — API keys and service identities

|                    |                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Tenancy / API                                                                                                                      |
| **User Role**      | Company Admin, then an API key                                                                                                     |
| **Feature**        | API key scope                                                                                                                      |
| **Test Scenario**  | An API key acts only within its own workspace and its own permissions                                                              |
| **Priority**       | **P0**                                                                                                                             |
| **Preconditions**  | `apikeys` granted (`org_admin` or `it_admin`). Two workspaces                                                                      |
| **Code Reference** | `src/lib/auth/apiKey.ts`, `src/lib/api/handler.ts`, `src/lib/security/ratelimit.ts` (`apiKey`), `src/lib/auth/service-identity.ts` |

**Test Steps**

1. As Admin in `manath-homes`, create an API key. **Record its value — it is shown once.**
2. Call `GET /api/v1/leads` with the key. Confirm it works.
3. Call `GET /api/v1/leads/{a leadersfort lead id}` with the key. Record the status.
4. Call an endpoint the key's permissions do not cover. Record the status.
5. Create a lead with the key, **omitting** a required custom field.
6. Record the result.
7. Create a lead with the key and an `ownerId` of a `leadersfort` user.
8. Exceed the key's rate limit (it is per key, per minute — note the configured maximum).
9. Revoke the key. Call again.
10. Call a platform endpoint with the key.
11. Create a platform **service identity** (`AI_SERVICE`) and sign in through `/service-login`. Confirm the session lasts **30 minutes**.
12. With that service session, attempt a write in a workspace.
13. Attempt to elevate the service identity.

**Expected Result**

- An API key is scoped to **its own workspace**: step 3 is **404**.
- A key carries permissions; step 4 is **403**.
- Step 6: **the lead is created.** A **person** must fill the workspace's required custom fields; **an API key, like the public intake, still lands a lead that leaves one out.** This is deliberate — do not log it as a defect. It is also worth knowing, because it means an integration can create leads the UI would refuse.
- Step 7: **404**.
- Step 8: **429**.
- Step 9: 401 immediately.
- Step 10: refused.
- Step 11: 30 minutes, capped at 480.
- Steps 12–13: refused. An `AI_SERVICE` identity is read-only **by construction** and can never elevate.

**Negative Scenarios**

| What to try                                                      | Expected                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A key with its last character changed                            | 401                                                                                 |
| A key in a query string rather than a header                     | Record the behaviour; a key accepted in a URL is a finding, because URLs are logged |
| A key from a deleted workspace                                   | 401                                                                                 |
| Two keys used simultaneously                                     | Both work within their own limits                                                   |
| A key used from an IP outside an allowlist, if one is configured | Refused — `src/lib/security/cidr.ts` exists for this                                |

**Evidence** — The status for every step; the lead created in step 6 with its empty required field.

---

## TEN-ORIGIN-001 — Cross-site requests and the request envelope

|                    |                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Security                                                                                                                                                       |
| **User Role**      | Sales Agent                                                                                                                                                    |
| **Feature**        | Origin checking, CSP, direct requests                                                                                                                          |
| **Test Scenario**  | A state-changing request from another origin is refused, and the response headers are as expected                                                              |
| **Priority**       | P0                                                                                                                                                             |
| **Preconditions**  | A signed-in session. A simple HTML file you can serve from a different origin (a local file served on another port is enough)                                  |
| **Code Reference** | `src/lib/api/handler.ts` (the origin check), `src/lib/security/origin.ts`, `src/lib/security/envelope.ts`, `src/lib/security/directRequest.ts`, `src/proxy.ts` |

**Test Steps**

1. Sign in as Sara in a browser.
2. From a page served on a **different origin**, submit a form that `POST`s to `/api/v1/leads` with the browser's cookies.
3. Record the status.
4. Do the same with a `fetch` carrying `credentials: 'include'`.
5. Do the same with a `PATCH` and a `DELETE`.
6. Repeat with **no** `Origin` header at all (a server-to-server style request with the cookie copied).
7. Repeat with a **spoofed** `Origin` matching the application's own.
8. Inspect the response headers of any page. Record the `Content-Security-Policy`, and any `X-Frame-Options`, `Referrer-Policy` and `Strict-Transport-Security`.
9. Attempt to embed the application in an `<iframe>` on another origin.
10. Confirm whether a `GET` from another origin is treated differently from a `POST`.

**Expected Result**

- A state-changing cross-origin request is **refused** by the kernel's origin check.
- A spoofed `Origin` header from a browser is not possible; from a script it is, so step 7 tells you whether the origin check is the only defence. **Record the result and raise it** rather than passing or failing it: whether a cookie-bearing request with a forged origin succeeds is a question for the security review.
- A CSP header is present. Note that it is a **no-nonce** policy; record the header's value and leave its strength to the security review rather than failing this case on it.
- The application should not be embeddable on another origin.

**Negative Scenarios**

| What to try                                                         | Expected                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A `POST` with `Content-Type: text/plain` (a classic CSRF trick)     | Refused                                                                    |
| A multipart `POST` from another origin                              | Refused                                                                    |
| A request with `X-Forwarded-For` spoofed, to dodge an IP rate limit | Record whether the limit still applies. A bypassable IP limit is a finding |
| A request with an enormous header                                   | Refused cleanly                                                            |

**Evidence** — The status for each of steps 2–7; the full header set from step 8.
