# Section 9 — Smoke testing checklist

**Purpose.** Prove a deployment is alive and not obviously broken, in about
30 minutes. If a smoke item fails, stop and report — do not continue into
regression.

**Where to run it.** On the environment just deployed. Every item is read-only
or creates one disposable record prefixed `QA `.

**Before you start**, record these three things; every result below is read
against them:

|                                    |     |
| ---------------------------------- | --- |
| Environment                        |     |
| Commit / version deployed          |     |
| Is the **worker** process running? |     |

Items marked ⚙ depend on the worker. If the worker is down, mark those
**Blocked** and say so in the report, rather than Failed.

---

## 9.1 Infrastructure

| #    | Check                                       | Expected                                      | Pass / Fail |
| ---- | ------------------------------------------- | --------------------------------------------- | ----------- |
| S-01 | `GET /api/health`                           | Reports on real dependencies, all healthy     |             |
| S-02 | `GET /api/health/live`                      | Answers                                       |             |
| S-03 | `GET /api/metrics`                          | Returns metrics                               |             |
| S-04 | `/platform/system-health` as platform owner | Every dependency healthy; queues attached     |             |
| S-05 | Open any page; check response headers       | A `Content-Security-Policy` header is present |             |
| S-06 | Open `/` with no session                    | Renders                                       |             |

## 9.2 Authentication

| #    | Check                                      | Expected                                                             | Pass / Fail |
| ---- | ------------------------------------------ | -------------------------------------------------------------------- | ----------- |
| S-07 | `/login` renders                           | **Welcome back**, Email, Password, **Sign in**, **Forgot password?** |             |
| S-08 | Sign in as Company Admin                   | Lands on `/{slug}/dashboard`                                         |             |
| S-09 | Sign in with a wrong password              | Refused; message does not reveal whether the account exists          |             |
| S-10 | Sign in as an Agent                        | Lands in the workspace with a narrower sidebar                       |             |
| S-11 | `/login?product=lead-eagle`                | Tab title **Sign in to Lead Eagle**; Lead Eagle branding             |             |
| S-12 | Sign out                                   | Session ends; a protected URL sends you back to `/login`             |             |
| S-13 | `/forgot-password` with an unknown address | The **same** answer as a known one                                   |             |
| S-14 | Sign in as platform owner                  | `/platform` opens                                                    |             |

## 9.3 The boundary — the four items worth stopping a release for

| #    | Check                                                                        | Expected   | Pass / Fail |
| ---- | ---------------------------------------------------------------------------- | ---------- | ----------- |
| S-15 | As Company Admin of workspace A, `GET /api/v1/leads/{a workspace B lead id}` | **404**    |             |
| S-16 | As Company Admin, open `/platform`                                           | Refused    |             |
| S-17 | As an Agent, `GET /api/v1/leads/{a colleague's lead id}`                     | **404**    |             |
| S-18 | As an Agent, read a lead's phone number in the **raw API** response          | **Masked** |             |

**If any of S-15 to S-18 fails, stop. Do not continue.** Report it as a release
blocker and cross-reference [Section 7](07-tenancy-authz.md).

## 9.4 Sales CRM

| #    | Check                                                                            | Expected                   | Pass / Fail |
| ---- | -------------------------------------------------------------------------------- | -------------------------- | ----------- |
| S-19 | **CRM → Leads → All Leads** loads                                                | List renders with data     |             |
| S-20 | **My Leads** and **Unassigned** load                                             | Both render                |             |
| S-21 | Search a lead by name                                                            | Found                      |             |
| S-22 | **Add lead** → create `QA Smoke {date}`                                          | Created; lands on the lead |             |
| S-23 | Edit that lead's city and save                                                   | Saved                      |             |
| S-24 | Open **CRM → Calls & Coaching → Calls**                                          | Renders                    |             |
| S-25 | **New call** against the smoke lead; record consent; complete with **connected** | All three steps work       |             |
| S-26 | ⚙ **CRM → Daily Activity → Today**                                               | The smoke call is counted  |             |
| S-27 | **CRM → Activities → Tasks & Follow-ups**                                        | Renders                    |             |
| S-28 | **Insights → Reports → Sales**                                                   | Renders with figures       |             |
| S-29 | **Insights → Reports → Dashboards**                                              | Renders                    |             |
| S-30 | **CRM → Customers → Contacts** and **Accounts**                                  | Both render                |             |
| S-31 | **Opportunities**                                                                | Renders                    |             |

## 9.5 Real Estate

| #    | Check                                       | Expected                                    | Pass / Fail |
| ---- | ------------------------------------------- | ------------------------------------------- | ----------- |
| S-32 | **Real Estate → Dashboard**                 | Renders                                     |             |
| S-33 | **Real Estate → Leads → Leads**             | Renders; the same records as `/sales/leads` |             |
| S-34 | **Inventory → Projects** and **Listings**   | Both render                                 |             |
| S-35 | **Leads → Site Visits**                     | Renders                                     |             |
| S-36 | **Deals → Collections** and **Commissions** | Both render                                 |             |

## 9.6 People / HRMS

| #    | Check                                        | Expected                                               | Pass / Fail |
| ---- | -------------------------------------------- | ------------------------------------------------------ | ----------- |
| S-37 | **Check-in** (`/{slug}/check-in`)            | Renders; names the assigned location and radius        |             |
| S-38 | Check in, then check out                     | Both succeed; both appear in **Recent**                |             |
| S-39 | **People → Employees → Directory**           | Renders                                                |             |
| S-40 | **People → Attendance & Leave → Attendance** | Renders                                                |             |
| S-41 | **People → Attendance & Leave → Leave**      | Renders; the tab is labelled for the viewer's audience |             |
| S-42 | **People → Payroll → Payroll Runs**          | Renders                                                |             |
| S-43 | As an employee, **My Payslips**              | Renders; own payslips only                             |             |

## 9.7 Administration

| #    | Check                                        | Expected                                       | Pass / Fail |
| ---- | -------------------------------------------- | ---------------------------------------------- | ----------- |
| S-44 | **Administration → Settings → Users**        | Renders with the account list                  |             |
| S-45 | **Administration → Settings → Roles**        | Renders; all 25 seeded roles listed            |             |
| S-46 | **Administration → Settings → Audit Log**    | Renders; the smoke lead's creation appears     |             |
| S-47 | **Administration → Settings → Integrations** | Renders                                        |             |
| S-48 | **Administration → Settings → Modules**      | Shows the workspace's products; cannot add one |             |
| S-49 | **Account → Role & Access**                  | Shows the signed-in role and scope             |             |

## 9.8 Platform

| #    | Check                   | Expected                                                        | Pass / Fail |
| ---- | ----------------------- | --------------------------------------------------------------- | ----------- |
| S-50 | `/platform/workspaces`  | Lists workspaces                                                |             |
| S-51 | `/platform/plans`       | Lists plans with their modules                                  |             |
| S-52 | `/platform/users`       | Lists platform identities                                       |             |
| S-53 | `/platform/audit`       | Renders                                                         |             |
| S-54 | `/platform/ai-control`  | Renders                                                         |             |
| S-55 | A workspace detail page | **Subscription at a glance**, **Modules**, **Usage** all render |             |

## 9.9 Public

| #    | Check                                            | Expected                         | Pass / Fail |
| ---- | ------------------------------------------------ | -------------------------------- | ----------- |
| S-56 | A published public form at `/f/{slug}/{formKey}` | Renders with no session          |             |
| S-57 | Submit it with valid data                        | Succeeds                         |             |
| S-58 | ⚙ The submission appears as a lead               | Lead created, source **Website** |             |
| S-59 | A QR capture link at `/c/{slug}/{key}`           | Renders, branded                 |             |
| S-60 | `/privacy` and `/support`                        | Both render                      |             |

## 9.10 Entitlement

| #    | Check                                            | Expected                                       | Pass / Fail |
| ---- | ------------------------------------------------ | ---------------------------------------------- | ----------- |
| S-61 | A module the workspace does **not** hold, by URL | The friendly refusal panel, naming the product |             |
| S-62 | That module's API endpoint                       | **403** naming the product                     |             |

## 9.11 Background work ⚙

| #    | Check                                                            | Expected                                                 | Pass / Fail |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------- | ----------- |
| S-63 | The worker process is attached to every queue                    | Its output says so; it exits with a failure if it cannot |             |
| S-64 | A lead created in S-22 is assigned or queued within five minutes | Assigned, or in the waiting queue with a reason          |             |
| S-65 | `reminders-quarter-hourly` does **not** appear                   | Absent (it is retired)                                   |             |

---

## Sign-off

|                               |                                             |
| ----------------------------- | ------------------------------------------- |
| Tester                        |                                             |
| Date and time (and time zone) |                                             |
| Total items                   | 65                                          |
| Passed                        |                                             |
| Failed                        |                                             |
| Blocked                       |                                             |
| Worker running throughout?    |                                             |
| **Verdict**                   | **Proceed to regression / Stop and report** |

**Clean-up.** Delete or archive the `QA Smoke` lead and the smoke call once the
run is signed off, unless a failure means they are evidence.
