# Section 4 — Test environment, test accounts, and sample test data

## 4.1 Which environment to test in

| Environment               | Use it for                                                                                                                  | Do not                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Local / demo** (seeded) | All of Sections 5–8. This is where the suite is designed to run.                                                            | —                                                                   |
| **Staging**               | Smoke ([09](09-smoke.md)) and regression ([10](10-regression.md))                                                           | Do not seed demo data into it — the seed refuses, see §4.3          |
| **Production**            | Only the UAT acceptance checklist ([11](11-uat-acceptance.md)), and only read-only checks plus the owner's own agreed smoke | Never create test leads, test employees or test users in production |

Production releases are run by the owner. Nobody testing from this suite has
production SSH or database access, and should not ask for it.

## 4.2 Bringing a local environment up

Run from `apps/web`. Each command is one step; stop at the first failure.

```bash
npm install
```

```bash
npm run secrets
```

```bash
npm run docker:up
```

That starts Postgres, Redis, MinIO (object storage) and Mailpit (a local mail
catcher — **this is where invitation and password-reset emails arrive**).

```bash
npm run db:deploy
```

```bash
ALLOW_DEMO_SEED=yes npm run db:seed
```

```bash
npm run dev
```

And in a second terminal, because several expected results depend on it:

```bash
npm run worker
```

**If the worker is not running**, everything that happens on a queue or a
schedule never happens: automatic lead assignment, notifications, first-contact
tasks, AI analysis, digests, retention, recycling, report schedules. The UI gives
no warning. Any case whose expected result says "shortly afterwards" must be
recorded **Blocked**, not Failed, when the worker is down.

### Checks worth running before you start

```bash
npm run preflight
```

```bash
npm run check:permissions
```

The second one verifies that the migrated database's permission catalogue matches
the code. If it fails, authorization cases will produce nonsense and the whole of
Section 7 should be deferred.

## 4.3 The seed, and its three guards

`npm run db:seed` creates dozens of ACTIVE, email-verified logins. It is, pointed
at the wrong database, a mass account-provisioning tool. Three independent gates
stop that, and none of them trusts the other two:

1. `NODE_ENV=production` → refused.
2. `APP_ENV=production` or `staging` → refused, with a message saying demo
   personas and published passwords must never reach a shared environment.
3. A target database whose **name** ends in `_prod`, `_production`, `_staging` or
   `_stage` → refused, whatever the declarations say. This guard reads the
   connection string itself.

And then `ALLOW_DEMO_SEED=yes` must be set explicitly, every time.

**If any of those three refusals does not fire, that is a P0 defect** — see
`NEG-SEED-001` in [Section 6](06-negative-boundary.md).

### The demo password

`DEMO_PASSWORD` is **generated per run and printed once** to the seed's output.
It is not committed anywhere and it is not the same between runs. Capture it from
the terminal when you seed. To pin it (useful for a long test cycle), set
`DEMO_PASSWORD` in the environment before seeding.

Every seeded workspace account shares that one password. **It therefore belongs
nowhere but a disposable local database** — do not reuse it, do not paste it into
a ticket, do not set it on a shared environment.

## 4.4 Seeded workspaces

| Slug           | Display name | Plan     | Entitled modules             |
| -------------- | ------------ | -------- | ---------------------------- |
| `manath-homes` | Manath Homes | Business | **HRMS, SALES, REAL_ESTATE** |
| `leadersfort`  | Leadersfort  | HRMS     | **HRMS only**                |

Seeded subscription plans:

| Plan code    | Name        | Modules                  | Seats | Storage |
| ------------ | ----------- | ------------------------ | ----- | ------- |
| `hrms`       | HRMS        | HRMS                     | 100   | 5 GB    |
| `sales`      | Sales       | SALES                    | 100   | 5 GB    |
| `business`   | Business    | HRMS, SALES              | 250   | 20 GB   |
| `realestate` | Real Estate | REAL_ESTATE              | 100   | 5 GB    |
| `enterprise` | Enterprise  | HRMS, SALES, REAL_ESTATE | 1000  | 100 GB  |

> **No seeded plan includes `LEAD_EAGLE`, and neither seeded workspace is
> entitled to it.** Every Lead Eagle case in [05f](05f-lead-eagle.md) therefore
> begins by provisioning a Lead-Eagle-only workspace from the platform console.
> This is recorded as a gap in [Section 12](12-coverage-and-gaps.md).

`leadersfort` exists specifically so that cross-workspace isolation is visible
in the UI rather than only at the API. Use it as the "other company" in every
`TEN-ISO-*` case.

## 4.5 Seeded accounts in `manath-homes`

All use the generated `DEMO_PASSWORD`. Branch codes: `BB`, `JLT`, `DT` (region
`DXB`); `REEM` (region `AUH`); `SHJ` (region `NE`).

### The role-demonstration cast — use these for Section 5

These exist precisely so that "this is what a manager sees" is real. Prefer them
over the generated addresses.

| Email                            | Name            | Role                  | Branch / region | Persona it serves                                    |
| -------------------------------- | --------------- | --------------------- | --------------- | ---------------------------------------------------- |
| `admin@manathhomes.ae`           | Manath Admin    | `org_admin`           | —               | **Company Admin**                                    |
| `demo@manathhomes.ae`            | Manath Demo     | `org_admin`           | —               | spare Company Admin                                  |
| `demo@manathhomes.com`           | Demo Presenter  | `org_admin`           | —               | spare Company Admin                                  |
| `sales.manager@manathhomes.ae`   | Omar Hassan     | `team_manager`        | BB / DXB        | **Team Leader** — manages Sara and Rayan             |
| `sales.rep@manathhomes.ae`       | Sara Khan       | `sales_rep`           | BB / DXB        | **Sales Agent**                                      |
| `sdr@manathhomes.ae`             | Rayan Malik     | `sales_rep`           | BB / DXB        | second agent, for OWN-scope negatives                |
| `account.manager@manathhomes.ae` | Nadia Ahmed     | `sales_rep`           | **DT** / DXB    | an agent in **another branch** — for `TEN-SCOPE-003` |
| `qa.manager@manathhomes.ae`      | Daniel Joseph   | `call_qa`             | —               | **Call Quality Manager**                             |
| `executive@manathhomes.ae`       | Khalid Mansour  | `executive_read_only` | —               | read-only executive                                  |
| `auditor@example.com`            | Auditor Account | `read_only`           | —               | **Read-Only User**                                   |

Omar, Sara and Rayan share the BB branch, which is what makes Omar their manager.
That relationship is the basis of every TEAM-scope case.

### Generated accounts

Everyone else has an address of the form
`firstname.lastname@example.com` (lower-case, punctuation stripped). The roles
seeded, with branch and region:

| Name              | Email                          | Role                | Branch | Region |
| ----------------- | ------------------------------ | ------------------- | ------ | ------ |
| Amina Al Rashid   | `amina.alrashid@example.com`   | `org_admin`         | —      | —      |
| Dhruv Menon       | `dhruv.menon@example.com`      | `sales_director`    | —      | —      |
| Elena Petrova     | `elena.petrova@example.com`    | `regional_manager`  | BB     | DXB    |
| Tariq Al Mansoori | `tariq.almansoori@example.com` | `regional_manager`  | REEM   | AUH    |
| Sofia Marchetti   | `sofia.marchetti@example.com`  | `branch_manager`    | BB     | DXB    |
| Omar Khalifa      | `omar.khalifa@example.com`     | `branch_manager`    | JLT    | DXB    |
| Priya Nair        | `priya.nair@example.com`       | `branch_manager`    | DT     | DXB    |
| Faisal Al Zaabi   | `faisal.alzaabi@example.com`   | `branch_manager`    | REEM   | AUH    |
| Marco Rossi       | `marco.rossi@example.com`      | `branch_manager`    | SHJ    | NE     |
| Rashid Al Suwaidi | `rashid.alsuwaidi@example.com` | `team_manager`      | BB     | DXB    |
| Ritika Bhatt      | `ritika.bhatt@example.com`     | `team_manager`      | BB     | DXB    |
| Vikram Iyer       | `vikram.iyer@example.com`      | `team_manager`      | JLT    | DXB    |
| Clara Lindqvist   | `clara.lindqvist@example.com`  | `team_manager`      | DT     | DXB    |
| Joel Fernandes    | `joel.fernandes@example.com`   | `sales_rep`         | BB     | DXB    |
| Nadia Karim       | `nadia.karim@example.com`      | `sales_rep`         | BB     | DXB    |
| Rohan Mehta       | `rohan.mehta@example.com`      | `sales_rep`         | BB     | DXB    |
| Ayesha Siddiqui   | `ayesha.siddiqui@example.com`  | `sales_rep`         | JLT    | DXB    |
| Stefan Kovac      | `stefan.kovac@example.com`     | `sales_rep`         | JLT    | DXB    |
| Layla Barakat     | `layla.barakat@example.com`    | `sales_rep`         | DT     | DXB    |
| Youssef Farooq    | `youssef.farooq@example.com`   | `sales_rep`         | REEM   | AUH    |
| Sana Chowdhury    | `sana.chowdhury@example.com`   | `sales_rep`         | SHJ    | NE     |
| Karim Haddad      | `karim.haddad@example.com`     | `field_rep`         | BB     | DXB    |
| Bilal Ahmadi      | `bilal.ahmadi@example.com`     | `field_rep`         | JLT    | DXB    |
| Noor Al Hashimi   | `noor.alhashimi@example.com`   | `marketing_manager` | BB     | DXB    |
| Anton Novak       | `anton.novak@example.com`      | `marketing_exec`    | BB     | DXB    |
| Zainab Okafor     | `zainab.okafor@example.com`    | `marketing_exec`    | BB     | DXB    |
| Mariam Dcruz      | `mariam.dcruz@example.com`     | `service_manager`   | BB     | DXB    |
| Liza Gonzales     | `liza.gonzales@example.com`    | `service_agent`     | BB     | DXB    |
| Hamdan Pereira    | `hamdan.pereira@example.com`   | `service_agent`     | BB     | DXB    |
| Reem Silva        | `reem.silva@example.com`       | `analyst`           | —      | —      |

**Roles with no seeded account in `manath-homes`.** The HR and back-office roles
are created by the seed but no demo person is assigned to them. Before testing
[05d](05d-people.md) and the finance cases, the tester must create one user per
role from **Administration → Settings → Users**:

`hr_admin`, `hr_executive`, `payroll_officer`, `recruiter`, `dept_manager`,
`site_manager`, `it_admin`, `finance_admin`, `auditor`, `employee`,
plus the three configurations from [Section 2](02-roles-and-personas.md) §2.6:
`Telecaller`, `Real Estate Operations`, `Custom Minimal`.

## 4.6 The platform account

| Field         | Value                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| Email         | `owner@masterapp.local`, or whatever `PLATFORM_OWNER_EMAIL` is set to        |
| Password      | `PLATFORM_OWNER_PASSWORD`, or the generated `DEMO_PASSWORD` if that is unset |
| Platform role | `OWNER`                                                                      |
| MFA           | Enabled **only** if `PLATFORM_OWNER_MFA_SECRET` is set                       |

Platform `SUPPORT`, `SECURITY_AUDITOR` and `AI_SERVICE` identities are **not**
seeded. Create them from **`/platform/users`** and **`/platform/identity`** before
running [05a](05a-platform.md).

## 4.7 Test accounts to create before you begin

Record the password you set for each; several negative cases reuse them.

| #   | Purpose                               | Workspace                   | Role                              | Must also have                                                |
| --- | ------------------------------------- | --------------------------- | --------------------------------- | ------------------------------------------------------------- |
| T1  | HR Manager                            | manath-homes                | `hr_admin`                        | —                                                             |
| T2  | HR Executive                          | manath-homes                | `hr_executive`                    | —                                                             |
| T3  | Payroll preparer                      | manath-homes                | `payroll_officer`                 | —                                                             |
| T4  | Payroll approver                      | manath-homes                | `finance_admin`                   | —                                                             |
| T5  | Second finance account                | manath-homes                | `finance_admin`                   | For the two-person collection rule                            |
| T6  | Department manager                    | manath-homes                | `dept_manager`                    | A team, with T9 reporting to them                             |
| T7  | Site manager                          | manath-homes                | `site_manager`                    | Branch `BB`                                                   |
| T8  | IT administrator                      | manath-homes                | `it_admin`                        | —                                                             |
| T9  | Ordinary employee                     | manath-homes                | `employee`                        | An employee record **and an active work-location assignment** |
| T10 | Recruiter                             | manath-homes                | `recruiter`                       | —                                                             |
| T11 | Auditor                               | manath-homes                | `auditor`                         | —                                                             |
| T12 | Telecaller                            | manath-homes                | `Telecaller` (custom)             | —                                                             |
| T13 | Real Estate Ops                       | manath-homes                | `Real Estate Operations` (custom) | Branch `BB`                                                   |
| T14 | Minimal custom role                   | manath-homes                | `Custom Minimal` (custom)         | —                                                             |
| T15 | Branch manager with **no branch set** | manath-homes                | `branch_manager`                  | Branch deliberately **empty** — for `SALES-SCOPE-004`         |
| T16 | Team manager with **no team**         | manath-homes                | `team_manager`                    | No team, no reports — for `HR-SCOPE-003`                      |
| T17 | Other-company admin                   | **leadersfort**             | `org_admin`                       | For every `TEN-ISO-*` case                                    |
| T18 | Lead Eagle admin                      | **a new LE-only workspace** | `org_admin`                       | See [05f](05f-lead-eagle.md) `LE-SETUP-001`                   |
| T19 | Lead Eagle agent                      | the same LE workspace       | `sales_rep`                       | —                                                             |
| T20 | Platform support                      | _(platform)_                | `SUPPORT`                         | —                                                             |
| T21 | Platform auditor                      | _(platform)_                | `SECURITY_AUDITOR`                | —                                                             |

T9's **work-location assignment** is easy to forget and blocks every check-in
case: without one, the check-in screen says _"You have no active work-location
assignment, so no check-in can be accepted. Ask HR to assign you a location."_
That message is correct behaviour, not a defect.

## 4.8 Sample test data

Use these exact values so results are comparable between testers and between
runs. UAE conventions throughout, because the application's own data uses them.

### Leads

| Field       | Valid value                 | Invalid value to try               | Why                                     |
| ----------- | --------------------------- | ---------------------------------- | --------------------------------------- |
| Full name   | `QA Rehana Mahmood`         | _(blank)_                          | The only unconditionally required field |
| Email       | `qa.rehana.001@example.com` | `qa.rehana`, `qa@`, 260 characters | Must be a valid address, max 254        |
| Phone       | `+971501234501`             | 40 characters                      | Max 32 characters                       |
| Company     | `QA Marina Holdings`        | 200 characters                     | Max 160                                 |
| Job title   | `Investor`                  | 200 characters                     | Max 120                                 |
| Country     | `United Arab Emirates`      | 100 characters                     | Max 80                                  |
| City        | `Dubai`                     | 100 characters                     | Max 80                                  |
| Nationality | `Indian`                    | 100 characters                     | Max 80                                  |
| Campaign    | `QA Marina launch`          | 200 characters                     | Max 120                                 |
| Tags        | `vip, investor`             | 21 tags; one tag of 50 chars       | Max 20 tags, 40 chars each              |
| Priority    | `Medium`                    | —                                  | One of Low / Medium / High / Urgent     |
| Source      | any active catalogue entry  | —                                  | Must belong to this workspace           |
| Referred by | `QA Partner Ltd`            | _(blank, with source = Referral)_  | Required when the source is a referral  |

Prefix every lead name with `QA ` and every email with `qa.` so test data is
identifiable and removable.

### Duplicate pair — for `SALES-LEAD-013`

Create `QA Dup One` with email `qa.dup@example.com` and phone `+971501234599`.
Then try to create `QA Dup Two` with **the same email**, and separately with
**the same phone**, and separately with **the same full name**. All three are
duplicate signals.

### Employees

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Full name         | `QA Tester Employee`                                        |
| Employee code     | auto-assigned, prefix `MH-`                                 |
| Department        | `QA Department` (create it)                                 |
| Designation       | `QA Analyst`                                                |
| Employment type   | `Full time`                                                 |
| Work location     | `QA Office`, radius `100` m, check-out rule `Same location` |
| First day         | today                                                       |
| Reporting manager | T6                                                          |

### Properties and inventory

| Field     | Value                                   |
| --------- | --------------------------------------- |
| Project   | `QA Marina Heights`                     |
| Developer | `QA Developments`                       |
| Listing   | `QA Marina Heights — 2 BR, 1,250 sq ft` |
| Bedrooms  | `2`                                     |
| Budget    | `1,850,000` AED                         |
| Area      | `Dubai Marina`                          |

### Money

| Field              | Value                                  |
| ------------------ | -------------------------------------- |
| Currency           | `AED`                                  |
| Booking value      | `1,850,000`                            |
| Agency fee         | `2%` → `37,000`                        |
| Collection receipt | `18,500`, bank reference `QA-REF-0001` |

Use round numbers. Rounding and percentage behaviour is checked separately in
[Section 6](06-negative-boundary.md), where exact values matter.

### Dates and time zones

The application's working day is **Gulf Standard Time (UTC+4)**. Every
date-boundary case uses these three moments, and they must be entered in the
workspace's own time zone, not the tester's:

| Moment                             | Why it matters                                               |
| ---------------------------------- | ------------------------------------------------------------ |
| `23:55` local, today               | A record created here must count against **today's** targets |
| `00:05` local, tomorrow            | The same action must count against **tomorrow's**            |
| The last day of the month, `23:59` | Month-boundary reporting and payroll periods                 |

If your machine is not on UTC+4, say so in the Actual Result on every
date-boundary case. Several of them cannot be judged without it.

## 4.9 Evidence to capture

| Case kind                        | Minimum evidence                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Positive functional              | Screenshot of the result, plus the record reference (e.g. `LEAD-00123`)          |
| Validation                       | Screenshot showing the error **next to the field**                               |
| Authorization refused in the UI  | Screenshot of the refusal **and** the URL you used                               |
| Authorization refused at the API | The **HTTP status code** and the response body. A screenshot alone is not enough |
| Tenancy                          | Both workspace slugs, the record ID, and the status code                         |
| Background outcome               | The time you acted, the time you re-checked, and whether the worker was running  |
| Money                            | Before and after values, and the audit-log entry                                 |

### How to make a direct API request

Several P0 cases require bypassing the UI, because hiding a button is not a
restriction. Sign in through the browser as the role under test, then use the
browser's developer tools (Network tab → right-click a request → _Copy as
fetch_) so your session cookie is carried, and change the URL or body. Record the
status code.

The API is documented at `/api/v1/openapi.json` on the running instance.

Expected status codes across the API:

| Status  | Means                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- |
| 401     | No session, or an expired one                                                                   |
| 403     | Signed in, but the module is not in the plan, or the permission is absent                       |
| **404** | The record exists but is **out of your scope** — this is deliberate, and a 403 here is a defect |
| 409     | A conflict: a duplicate, or an action the record's state forbids                                |
| 422     | The body failed validation; the response names the field                                        |
| 429     | A rate limit, with `Retry-After`                                                                |
