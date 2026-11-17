# Section 3 — Role vs Functionality Access Matrix

Generated from the seeded role catalogue at commit `1b8226f9`
(`apps/web/prisma/seed/roles.ts`). **Every cell is a default** that an
administrator may have changed — read the workspace's actual
**Administration → Settings → Roles** page before asserting a refusal is wrong.

Scope words mean exactly what [Section 2](02-roles-and-personas.md) §2.3 says
they mean. A grant that is absent here does not exist: a missing row is a refusal.

## 3.1 Functionality matrix — the actions that matter most

Read this with §3.2, which is authoritative; this table is a summary.

| Functionality                              | Permission needed                        | Who holds it by default                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open the workspace at all                  | _(a session)_                            | every role                                                                                                                                                                                                                                                                     |
| Check self in / out                        | _(none — self-service)_                  | every user with an employee record and an active work-location assignment                                                                                                                                                                                                      |
| View leads                                 | `leads:VIEW`                             | super_admin, org_admin, sales_director, marketing_manager, analyst, call_qa, executive_read_only @ORGANIZATION · regional_manager @REGION · branch_manager, service_manager @BRANCH · team_manager, service_agent, marketing_exec, read_only @TEAM · sales_rep, field_rep @OWN |
| Create a lead                              | `leads:CREATE`                           | super_admin, org_admin, sales_director, marketing_manager @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH · team_manager, marketing_exec @TEAM · sales_rep, field_rep @OWN                                                                                   |
| Assign / reassign a lead                   | `leads:ASSIGN` / `REASSIGN`              | super_admin, org_admin, sales_director @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH · team_manager @TEAM                                                                                                                                                  |
| Bulk-update leads                          | `leads:BULK_UPDATE`                      | super_admin, org_admin, sales_director @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH · team_manager, marketing_manager @TEAM                                                                                                                               |
| Import leads                               | `leads:IMPORT`                           | super_admin, org_admin, sales_director, marketing_manager @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH · it_admin via `imports:IMPORT` @ORGANIZATION                                                                                                      |
| Export leads                               | `leads:EXPORT`                           | super_admin, org_admin, sales_director, marketing_manager, analyst @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH                                                                                                                                           |
| See a lead's sensitive fields (full phone) | `leads:VIEW_SENSITIVE_FIELDS`            | super_admin, org_admin, sales_director @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH. **Nobody below branch level**, and no HR, finance or IT role                                                                                                         |
| Delete a lead                              | `leads:DELETE`                           | super_admin and org_admin only                                                                                                                                                                                                                                                 |
| View calls                                 | `calls:VIEW`                             | super_admin, org_admin, analyst, call_qa, executive_read_only @ORGANIZATION                                                                                                                                                                                                    |
| Edit / audit a call                        | `calls:EDIT`                             | super_admin, org_admin, call_qa @ORGANIZATION                                                                                                                                                                                                                                  |
| Export calls                               | `calls:EXPORT`                           | super_admin, org_admin, call_qa @ORGANIZATION                                                                                                                                                                                                                                  |
| View opportunities                         | `opportunities:VIEW`                     | super_admin, org_admin, sales_director, marketing_manager, analyst, executive_read_only @ORGANIZATION · regional_manager @REGION · branch_manager @BRANCH · team_manager, read_only @TEAM · sales_rep, field_rep @OWN                                                          |
| Approve an allocation                      | `allocation:APPROVE`                     | super_admin and org_admin only                                                                                                                                                                                                                                                 |
| View employee records                      | `employee:VIEW`                          | super_admin, org_admin, hr_admin, hr_executive, payroll_officer, recruiter, auditor @ORGANIZATION · site_manager @BRANCH · dept_manager @TEAM · employee @OWN                                                                                                                  |
| See salary / sensitive employee fields     | `employee:VIEW_SENSITIVE_FIELDS`         | super_admin, org_admin, hr_admin, payroll_officer @ORGANIZATION. **Not** hr_executive, **not** it_admin, **not** recruiter                                                                                                                                                     |
| Approve leave                              | `leave:APPROVE`                          | super_admin, org_admin, hr_admin @ORGANIZATION · site_manager @BRANCH · dept_manager @TEAM                                                                                                                                                                                     |
| Approve attendance                         | `attendance:APPROVE`                     | super_admin, org_admin, hr_admin @ORGANIZATION · site_manager @BRANCH · dept_manager @TEAM                                                                                                                                                                                     |
| Approve overtime                           | `overtime:APPROVE`                       | super_admin, org_admin, hr_admin, finance_admin @ORGANIZATION · site_manager @BRANCH · dept_manager @TEAM                                                                                                                                                                      |
| Prepare a payroll run                      | `payroll:CREATE` / `EDIT`                | super_admin, org_admin, payroll_officer @ORGANIZATION                                                                                                                                                                                                                          |
| **Release / approve a payroll run**        | `payroll:APPROVE`                        | super_admin, org_admin, finance_admin @ORGANIZATION. **Never payroll_officer**                                                                                                                                                                                                 |
| Approve commissions / payouts              | `commissions:APPROVE`, `payouts:APPROVE` | super_admin, org_admin, finance_admin @ORGANIZATION                                                                                                                                                                                                                            |
| Record and verify a collection             | `collections:CREATE` / `APPROVE`         | super_admin, org_admin, finance_admin @ORGANIZATION — **but never the same account for both on one receipt**                                                                                                                                                                   |
| Propose an agency fee                      | `agencyfee:CREATE`                       | super_admin, org_admin, sales_director @ORGANIZATION                                                                                                                                                                                                                           |
| Approve an agency fee                      | `agencyfee:APPROVE`                      | super_admin, org_admin, finance_admin @ORGANIZATION                                                                                                                                                                                                                            |
| Create / edit a role                       | `roles:CREATE` / `EDIT`                  | super_admin and org_admin only. **hr_admin and it_admin hold `roles:VIEW` + `ASSIGN` only**                                                                                                                                                                                    |
| Create a user / invite                     | `users:CREATE`, `users:MANAGE_USERS`     | super_admin, org_admin, hr_admin, it_admin @ORGANIZATION                                                                                                                                                                                                                       |
| Change workspace settings                  | `settings:EDIT` / `MANAGE_CONFIGURATION` | super_admin, org_admin, it_admin @ORGANIZATION                                                                                                                                                                                                                                 |
| Manage integrations                        | `integrations:*`                         | super_admin, org_admin, it_admin @ORGANIZATION                                                                                                                                                                                                                                 |
| Read the audit log                         | `auditlogs:VIEW`                         | super_admin, org_admin, it_admin, analyst, hr_admin, finance_admin, auditor @ORGANIZATION                                                                                                                                                                                      |
| Export the audit log                       | `auditlogs:EXPORT`                       | super_admin, org_admin, it_admin, auditor @ORGANIZATION                                                                                                                                                                                                                        |
| View reports                               | `reports:VIEW_REPORTS`                   | most management roles; **not** `employee`, **not** `field_rep`, **not** `recruiter`, **not** `it_admin`                                                                                                                                                                        |
| Open Daily Activity                        | `reports` + SALES                        | every role holding `reports:VIEW` — at its own scope                                                                                                                                                                                                                           |
| Open Dashboards                            | `leads` + SALES                          | note: `leads`, **not** `reports`                                                                                                                                                                                                                                               |
| Enter the platform console                 | _(a platform identity)_                  | **no workspace role, ever**                                                                                                                                                                                                                                                    |

## 3.2 Per-role grants, verbatim from the seed

#### `super_admin` — Super Administrator (rank 0, default scope ORGANIZATION)

Every action on every module at ORGANIZATION scope (`*:*`).

#### `org_admin` — Organization Administrator (rank 10, default scope ORGANIZATION)

Every action on every module at ORGANIZATION scope (`*:*`).

#### `sales_director` — Sales Director (rank 20, default scope ORGANIZATION)

| Module          | Actions                                                                                  | Scope        |
| --------------- | ---------------------------------------------------------------------------------------- | ------------ |
| `agencyfee`     | VIEW, CREATE                                                                             | ORGANIZATION |
| `leads`         | VIEW, CREATE, EDIT, ASSIGN, REASSIGN, BULK_UPDATE, EXPORT, IMPORT, VIEW_SENSITIVE_FIELDS | ORGANIZATION |
| `opportunities` | VIEW, CREATE, EDIT, DELETE, EXPORT                                                       | ORGANIZATION |
| `accounts`      | VIEW, EDIT                                                                               | ORGANIZATION |
| `contacts`      | VIEW                                                                                     | ORGANIZATION |
| `activities`    | VIEW, CREATE                                                                             | ORGANIZATION |
| `tasks`         | VIEW, ASSIGN                                                                             | ORGANIZATION |
| `products`      | VIEW, EDIT                                                                               | ORGANIZATION |
| `documents`     | VIEW                                                                                     | ORGANIZATION |
| `campaigns`     | VIEW                                                                                     | ORGANIZATION |
| `reports`       | VIEW, CREATE, VIEW_REPORTS                                                               | ORGANIZATION |
| `dashboards`    | VIEW, CREATE                                                                             | ORGANIZATION |
| `smartviews`    | VIEW, CREATE                                                                             | ORGANIZATION |
| `distribution`  | VIEW, MANAGE_CONFIGURATION                                                               | ORGANIZATION |
| `fieldsales`    | VIEW                                                                                     | ORGANIZATION |

#### `regional_manager` — Regional Manager (rank 30, default scope REGION)

| Module          | Actions                                                                                  | Scope        |
| --------------- | ---------------------------------------------------------------------------------------- | ------------ |
| `leads`         | VIEW, CREATE, EDIT, ASSIGN, REASSIGN, BULK_UPDATE, EXPORT, IMPORT, VIEW_SENSITIVE_FIELDS | REGION       |
| `opportunities` | VIEW, CREATE, EDIT                                                                       | REGION       |
| `accounts`      | VIEW, EDIT                                                                               | REGION       |
| `contacts`      | VIEW                                                                                     | REGION       |
| `activities`    | VIEW, CREATE                                                                             | REGION       |
| `tasks`         | VIEW, ASSIGN                                                                             | REGION       |
| `documents`     | VIEW                                                                                     | REGION       |
| `products`      | VIEW                                                                                     | ORGANIZATION |
| `reports`       | VIEW, CREATE, VIEW_REPORTS                                                               | REGION       |
| `dashboards`    | VIEW, CREATE                                                                             | REGION       |
| `smartviews`    | VIEW, CREATE                                                                             | REGION       |
| `fieldsales`    | VIEW                                                                                     | REGION       |

#### `branch_manager` — Branch Manager (rank 40, default scope BRANCH)

| Module          | Actions                                                                                  | Scope        |
| --------------- | ---------------------------------------------------------------------------------------- | ------------ |
| `leads`         | VIEW, CREATE, EDIT, ASSIGN, REASSIGN, BULK_UPDATE, EXPORT, IMPORT, VIEW_SENSITIVE_FIELDS | BRANCH       |
| `opportunities` | VIEW, CREATE, EDIT                                                                       | BRANCH       |
| `accounts`      | VIEW, EDIT                                                                               | BRANCH       |
| `contacts`      | VIEW                                                                                     | BRANCH       |
| `activities`    | VIEW, CREATE                                                                             | BRANCH       |
| `tasks`         | VIEW, ASSIGN                                                                             | BRANCH       |
| `documents`     | VIEW                                                                                     | BRANCH       |
| `products`      | VIEW                                                                                     | ORGANIZATION |
| `tickets`       | VIEW                                                                                     | BRANCH       |
| `reports`       | VIEW, CREATE, VIEW_REPORTS                                                               | BRANCH       |
| `dashboards`    | VIEW, CREATE                                                                             | BRANCH       |
| `smartviews`    | VIEW, CREATE                                                                             | BRANCH       |
| `fieldsales`    | VIEW                                                                                     | BRANCH       |

#### `team_manager` — Team Manager (rank 50, default scope TEAM)

| Module          | Actions                                           | Scope        |
| --------------- | ------------------------------------------------- | ------------ |
| `leads`         | VIEW, CREATE, EDIT, ASSIGN, REASSIGN, BULK_UPDATE | TEAM         |
| `opportunities` | VIEW, CREATE, EDIT                                | TEAM         |
| `accounts`      | VIEW, EDIT                                        | TEAM         |
| `contacts`      | VIEW                                              | TEAM         |
| `activities`    | VIEW, CREATE                                      | TEAM         |
| `tasks`         | VIEW, ASSIGN                                      | TEAM         |
| `documents`     | VIEW                                              | TEAM         |
| `products`      | VIEW                                              | ORGANIZATION |
| `reports`       | VIEW, VIEW_REPORTS                                | TEAM         |
| `smartviews`    | VIEW, CREATE                                      | TEAM         |
| `dashboards`    | VIEW                                              | TEAM         |
| `fieldsales`    | VIEW                                              | TEAM         |

#### `sales_rep` — Sales Representative (rank 60, default scope OWN)

| Module          | Actions            | Scope        |
| --------------- | ------------------ | ------------ |
| `leads`         | VIEW, CREATE, EDIT | OWN          |
| `opportunities` | VIEW, CREATE, EDIT | OWN          |
| `accounts`      | VIEW               | TEAM         |
| `contacts`      | VIEW               | TEAM         |
| `activities`    | VIEW, CREATE       | OWN          |
| `tasks`         | VIEW, CREATE, EDIT | OWN          |
| `documents`     | VIEW               | OWN          |
| `products`      | VIEW               | ORGANIZATION |
| `reports`       | VIEW, VIEW_REPORTS | OWN          |
| `smartviews`    | VIEW, CREATE       | OWN          |
| `dashboards`    | VIEW               | OWN          |

#### `field_rep` — Field Sales Representative (rank 60, default scope OWN)

| Module          | Actions            | Scope        |
| --------------- | ------------------ | ------------ |
| `leads`         | VIEW, CREATE, EDIT | OWN          |
| `opportunities` | VIEW, EDIT         | OWN          |
| `accounts`      | VIEW               | TEAM         |
| `contacts`      | VIEW               | TEAM         |
| `activities`    | VIEW, CREATE       | OWN          |
| `tasks`         | VIEW, CREATE, EDIT | OWN          |
| `documents`     | VIEW               | OWN          |
| `products`      | VIEW               | ORGANIZATION |
| `fieldsales`    | VIEW, CREATE, EDIT | OWN          |
| `smartviews`    | VIEW               | OWN          |

#### `marketing_manager` — Marketing Manager (rank 40, default scope ORGANIZATION)

| Module           | Actions                            | Scope        |
| ---------------- | ---------------------------------- | ------------ |
| `leads`          | VIEW, CREATE, EXPORT, IMPORT       | ORGANIZATION |
| `leads`          | EDIT, BULK_UPDATE                  | TEAM         |
| `opportunities`  | VIEW                               | ORGANIZATION |
| `accounts`       | VIEW                               | ORGANIZATION |
| `contacts`       | VIEW                               | ORGANIZATION |
| `activities`     | VIEW, CREATE                       | ORGANIZATION |
| `campaigns`      | VIEW, CREATE, EDIT, DELETE         | ORGANIZATION |
| `lists`          | VIEW, CREATE, EDIT                 | ORGANIZATION |
| `forms`          | VIEW, CREATE, MANAGE_CONFIGURATION | ORGANIZATION |
| `landingpages`   | VIEW, CREATE, MANAGE_CONFIGURATION | ORGANIZATION |
| `communications` | VIEW, CREATE                       | ORGANIZATION |
| `automation`     | VIEW, MANAGE_AUTOMATION            | ORGANIZATION |
| `reports`        | VIEW, CREATE, VIEW_REPORTS         | ORGANIZATION |
| `dashboards`     | VIEW, CREATE                       | ORGANIZATION |
| `products`       | VIEW                               | ORGANIZATION |
| `smartviews`     | VIEW, CREATE                       | ORGANIZATION |

#### `marketing_exec` — Marketing Executive (rank 60, default scope OWN)

| Module           | Actions            | Scope        |
| ---------------- | ------------------ | ------------ |
| `leads`          | VIEW, CREATE       | TEAM         |
| `leads`          | EDIT               | OWN          |
| `contacts`       | VIEW               | TEAM         |
| `campaigns`      | VIEW, CREATE, EDIT | OWN          |
| `lists`          | VIEW, CREATE       | OWN          |
| `communications` | VIEW, CREATE       | OWN          |
| `activities`     | VIEW, CREATE       | OWN          |
| `tasks`          | VIEW               | OWN          |
| `reports`        | VIEW, VIEW_REPORTS | OWN          |
| `products`       | VIEW               | ORGANIZATION |
| `smartviews`     | VIEW               | OWN          |

#### `service_manager` — Customer Service Manager (rank 40, default scope ORGANIZATION)

| Module           | Actions                                    | Scope        |
| ---------------- | ------------------------------------------ | ------------ |
| `tickets`        | VIEW, CREATE, EDIT, ASSIGN, DELETE, EXPORT | ORGANIZATION |
| `sla`            | VIEW, MANAGE_CONFIGURATION                 | ORGANIZATION |
| `accounts`       | VIEW                                       | ORGANIZATION |
| `contacts`       | VIEW                                       | ORGANIZATION |
| `leads`          | VIEW                                       | BRANCH       |
| `activities`     | VIEW, CREATE                               | BRANCH       |
| `tasks`          | VIEW, ASSIGN                               | BRANCH       |
| `documents`      | VIEW                                       | BRANCH       |
| `communications` | VIEW, CREATE                               | ORGANIZATION |
| `forms`          | VIEW, MANAGE_CONFIGURATION                 | ORGANIZATION |
| `automation`     | VIEW, MANAGE_AUTOMATION                    | ORGANIZATION |
| `reports`        | VIEW, CREATE, VIEW_REPORTS                 | ORGANIZATION |
| `dashboards`     | VIEW, CREATE                               | ORGANIZATION |
| `products`       | VIEW                                       | ORGANIZATION |
| `smartviews`     | VIEW                                       | ORGANIZATION |

#### `service_agent` — Customer Service Agent (rank 60, default scope TEAM)

| Module           | Actions            | Scope        |
| ---------------- | ------------------ | ------------ |
| `tickets`        | VIEW, CREATE, EDIT | TEAM         |
| `accounts`       | VIEW               | TEAM         |
| `contacts`       | VIEW               | TEAM         |
| `leads`          | VIEW               | TEAM         |
| `activities`     | VIEW, CREATE       | TEAM         |
| `tasks`          | VIEW               | TEAM         |
| `documents`      | VIEW               | TEAM         |
| `communications` | VIEW, CREATE       | TEAM         |
| `products`       | VIEW               | ORGANIZATION |
| `reports`        | VIEW, VIEW_REPORTS | TEAM         |
| `smartviews`     | VIEW               | TEAM         |

#### `analyst` — Reporting Analyst (rank 45, default scope ORGANIZATION)

| Module          | Actions                                  | Scope        |
| --------------- | ---------------------------------------- | ------------ |
| `leads`         | VIEW, EXPORT                             | ORGANIZATION |
| `opportunities` | VIEW, EXPORT                             | ORGANIZATION |
| `accounts`      | VIEW                                     | ORGANIZATION |
| `contacts`      | VIEW                                     | ORGANIZATION |
| `activities`    | VIEW                                     | ORGANIZATION |
| `tasks`         | VIEW                                     | ORGANIZATION |
| `tickets`       | VIEW                                     | ORGANIZATION |
| `campaigns`     | VIEW                                     | ORGANIZATION |
| `documents`     | VIEW                                     | ORGANIZATION |
| `fieldsales`    | VIEW                                     | ORGANIZATION |
| `products`      | VIEW                                     | ORGANIZATION |
| `auditlogs`     | VIEW                                     | ORGANIZATION |
| `reports`       | VIEW, CREATE, EDIT, EXPORT, VIEW_REPORTS | ORGANIZATION |
| `dashboards`    | VIEW, CREATE                             | ORGANIZATION |
| `smartviews`    | VIEW, CREATE                             | ORGANIZATION |
| `calls`         | VIEW                                     | ORGANIZATION |
| `events`        | VIEW                                     | ORGANIZATION |

#### `hr_admin` — HR Administrator (rank 20, default scope ORGANIZATION)

| Module           | Actions                                                   | Scope        |
| ---------------- | --------------------------------------------------------- | ------------ |
| `employee`       | VIEW, CREATE, EDIT, DELETE, EXPORT, VIEW_SENSITIVE_FIELDS | ORGANIZATION |
| `employees`      | VIEW, CREATE, EDIT, EXPORT                                | ORGANIZATION |
| `attendance`     | VIEW, CREATE, EDIT, APPROVE, EXPORT, VIEW_REPORTS         | ORGANIZATION |
| `leave`          | VIEW, CREATE, EDIT, APPROVE, EXPORT                       | ORGANIZATION |
| `overtime`       | VIEW, CREATE, EDIT, APPROVE                               | ORGANIZATION |
| `shifts`         | VIEW, CREATE, EDIT, DELETE, APPROVE                       | ORGANIZATION |
| `holidays`       | VIEW, CREATE, EDIT, DELETE                                | ORGANIZATION |
| `hr_documents`   | VIEW, CREATE, EDIT, DELETE, EXPORT                        | ORGANIZATION |
| `hr_reports`     | VIEW, VIEW_REPORTS, EXPORT                                | ORGANIZATION |
| `hrms`           | VIEW, EDIT, MANAGE_CONFIGURATION                          | ORGANIZATION |
| `recruitment`    | VIEW, CREATE, EDIT, APPROVE                               | ORGANIZATION |
| `performance`    | VIEW, CREATE, EDIT, APPROVE                               | ORGANIZATION |
| `work_locations` | VIEW, CREATE, EDIT, DELETE, MANAGE_CONFIGURATION          | ORGANIZATION |
| `departments`    | VIEW, CREATE, EDIT                                        | ORGANIZATION |
| `users`          | VIEW, CREATE, EDIT, MANAGE_USERS                          | ORGANIZATION |
| `roles`          | VIEW, ASSIGN                                              | ORGANIZATION |
| `auditlogs`      | VIEW                                                      | ORGANIZATION |
| `payroll`        | VIEW                                                      | ORGANIZATION |
| `documents`      | VIEW, CREATE                                              | ORGANIZATION |
| `reports`        | VIEW, VIEW_REPORTS                                        | ORGANIZATION |
| `dashboards`     | VIEW                                                      | ORGANIZATION |

#### `hr_executive` — HR Executive (rank 50, default scope ORGANIZATION)

| Module           | Actions            | Scope        |
| ---------------- | ------------------ | ------------ |
| `employee`       | VIEW, CREATE, EDIT | ORGANIZATION |
| `employees`      | VIEW, EDIT         | ORGANIZATION |
| `attendance`     | VIEW, CREATE, EDIT | ORGANIZATION |
| `leave`          | VIEW, CREATE, EDIT | ORGANIZATION |
| `overtime`       | VIEW, CREATE       | ORGANIZATION |
| `shifts`         | VIEW, CREATE, EDIT | ORGANIZATION |
| `holidays`       | VIEW               | ORGANIZATION |
| `hr_documents`   | VIEW, CREATE, EDIT | ORGANIZATION |
| `hr_reports`     | VIEW               | ORGANIZATION |
| `hrms`           | VIEW               | ORGANIZATION |
| `recruitment`    | VIEW, CREATE, EDIT | ORGANIZATION |
| `performance`    | VIEW, CREATE       | ORGANIZATION |
| `work_locations` | VIEW               | ORGANIZATION |
| `departments`    | VIEW               | ORGANIZATION |
| `users`          | VIEW               | ORGANIZATION |
| `dashboards`     | VIEW               | ORGANIZATION |

#### `payroll_officer` — Payroll Officer (rank 55, default scope ORGANIZATION)

| Module       | Actions                                           | Scope        |
| ------------ | ------------------------------------------------- | ------------ |
| `payroll`    | VIEW, CREATE, EDIT, EXPORT, VIEW_SENSITIVE_FIELDS | ORGANIZATION |
| `overtime`   | VIEW                                              | ORGANIZATION |
| `attendance` | VIEW, VIEW_REPORTS, EXPORT                        | ORGANIZATION |
| `leave`      | VIEW                                              | ORGANIZATION |
| `employee`   | VIEW, VIEW_SENSITIVE_FIELDS                       | ORGANIZATION |
| `employees`  | VIEW                                              | ORGANIZATION |
| `hr_reports` | VIEW, VIEW_REPORTS, EXPORT                        | ORGANIZATION |
| `hrms`       | VIEW                                              | ORGANIZATION |
| `dashboards` | VIEW                                              | ORGANIZATION |

#### `recruiter` — Recruiter (rank 60, default scope ORGANIZATION)

| Module         | Actions                    | Scope        |
| -------------- | -------------------------- | ------------ |
| `recruitment`  | VIEW, CREATE, EDIT, EXPORT | ORGANIZATION |
| `employee`     | VIEW                       | ORGANIZATION |
| `employees`    | VIEW                       | ORGANIZATION |
| `hr_documents` | VIEW, CREATE               | ORGANIZATION |
| `departments`  | VIEW                       | ORGANIZATION |
| `hrms`         | VIEW                       | ORGANIZATION |
| `dashboards`   | VIEW                       | ORGANIZATION |

#### `dept_manager` — Department Manager (rank 45, default scope TEAM)

| Module        | Actions                     | Scope |
| ------------- | --------------------------- | ----- |
| `employee`    | VIEW                        | TEAM  |
| `employees`   | VIEW                        | TEAM  |
| `attendance`  | VIEW, APPROVE, VIEW_REPORTS | TEAM  |
| `leave`       | VIEW, APPROVE               | TEAM  |
| `overtime`    | VIEW, APPROVE               | TEAM  |
| `shifts`      | VIEW, EDIT                  | TEAM  |
| `performance` | VIEW, CREATE, EDIT          | TEAM  |
| `hr_reports`  | VIEW                        | TEAM  |
| `hrms`        | VIEW                        | TEAM  |
| `tasks`       | VIEW, ASSIGN                | TEAM  |
| `dashboards`  | VIEW                        | TEAM  |

#### `site_manager` — Site Manager (rank 48, default scope BRANCH)

| Module           | Actions                     | Scope  |
| ---------------- | --------------------------- | ------ |
| `employee`       | VIEW                        | BRANCH |
| `employees`      | VIEW                        | BRANCH |
| `attendance`     | VIEW, APPROVE, VIEW_REPORTS | BRANCH |
| `leave`          | VIEW, APPROVE               | BRANCH |
| `overtime`       | VIEW, APPROVE               | BRANCH |
| `shifts`         | VIEW, CREATE, EDIT          | BRANCH |
| `work_locations` | VIEW                        | BRANCH |
| `hr_reports`     | VIEW                        | BRANCH |
| `hrms`           | VIEW                        | BRANCH |
| `dashboards`     | VIEW                        | BRANCH |

#### `it_admin` — IT Administrator (rank 30, default scope ORGANIZATION)

| Module         | Actions                                          | Scope        |
| -------------- | ------------------------------------------------ | ------------ |
| `users`        | VIEW, CREATE, EDIT, MANAGE_USERS                 | ORGANIZATION |
| `roles`        | VIEW, ASSIGN                                     | ORGANIZATION |
| `settings`     | VIEW, EDIT, MANAGE_CONFIGURATION                 | ORGANIZATION |
| `integrations` | VIEW, CREATE, EDIT, DELETE, MANAGE_CONFIGURATION | ORGANIZATION |
| `apikeys`      | VIEW, CREATE, DELETE, ACCESS_API                 | ORGANIZATION |
| `auditlogs`    | VIEW, EXPORT                                     | ORGANIZATION |
| `imports`      | VIEW, IMPORT                                     | ORGANIZATION |
| `exports`      | VIEW, EXPORT                                     | ORGANIZATION |
| `automation`   | VIEW, MANAGE_AUTOMATION                          | ORGANIZATION |
| `dashboards`   | VIEW                                             | ORGANIZATION |

#### `finance_admin` — Finance Administrator (rank 35, default scope ORGANIZATION)

| Module            | Actions                                      | Scope        |
| ----------------- | -------------------------------------------- | ------------ |
| `payroll`         | VIEW, APPROVE, EXPORT, VIEW_SENSITIVE_FIELDS | ORGANIZATION |
| `commissions`     | VIEW, CREATE, EDIT, APPROVE, EXPORT          | ORGANIZATION |
| `commissionslabs` | VIEW, EDIT                                   | ORGANIZATION |
| `payouts`         | VIEW, APPROVE, EXPORT                        | ORGANIZATION |
| `collections`     | VIEW, CREATE, APPROVE                        | ORGANIZATION |
| `agencyfee`       | VIEW, APPROVE                                | ORGANIZATION |
| `overtime`        | VIEW, APPROVE                                | ORGANIZATION |
| `reports`         | VIEW, VIEW_REPORTS, EXPORT                   | ORGANIZATION |
| `hr_reports`      | VIEW, VIEW_REPORTS, EXPORT                   | ORGANIZATION |
| `exports`         | VIEW, EXPORT                                 | ORGANIZATION |
| `auditlogs`       | VIEW                                         | ORGANIZATION |
| `dashboards`      | VIEW                                         | ORGANIZATION |

#### `auditor` — Auditor (rank 70, default scope ORGANIZATION)

| Module           | Actions                    | Scope        |
| ---------------- | -------------------------- | ------------ |
| `auditlogs`      | VIEW, EXPORT               | ORGANIZATION |
| `employee`       | VIEW                       | ORGANIZATION |
| `employees`      | VIEW                       | ORGANIZATION |
| `attendance`     | VIEW, VIEW_REPORTS, EXPORT | ORGANIZATION |
| `leave`          | VIEW                       | ORGANIZATION |
| `overtime`       | VIEW                       | ORGANIZATION |
| `payroll`        | VIEW                       | ORGANIZATION |
| `hr_documents`   | VIEW                       | ORGANIZATION |
| `hr_reports`     | VIEW, VIEW_REPORTS, EXPORT | ORGANIZATION |
| `hrms`           | VIEW                       | ORGANIZATION |
| `work_locations` | VIEW                       | ORGANIZATION |
| `roles`          | VIEW                       | ORGANIZATION |
| `users`          | VIEW                       | ORGANIZATION |
| `settings`       | VIEW                       | ORGANIZATION |
| `reports`        | VIEW, VIEW_REPORTS         | ORGANIZATION |
| `dashboards`     | VIEW                       | ORGANIZATION |

#### `employee` — Employee (rank 90, default scope OWN)

| Module         | Actions      | Scope        |
| -------------- | ------------ | ------------ |
| `employee`     | VIEW, EDIT   | OWN          |
| `attendance`   | VIEW         | OWN          |
| `leave`        | VIEW, CREATE | OWN          |
| `overtime`     | VIEW, CREATE | OWN          |
| `hr_documents` | VIEW         | OWN          |
| `payroll`      | VIEW         | OWN          |
| `shifts`       | VIEW         | OWN          |
| `holidays`     | VIEW         | ORGANIZATION |
| `performance`  | VIEW, EDIT   | OWN          |
| `hrms`         | VIEW         | OWN          |
| `tasks`        | VIEW, EDIT   | OWN          |
| `dashboards`   | VIEW         | OWN          |

#### `read_only` — Read-Only User (rank 90, default scope TEAM)

| Module          | Actions            | Scope        |
| --------------- | ------------------ | ------------ |
| `leads`         | VIEW               | TEAM         |
| `opportunities` | VIEW               | TEAM         |
| `accounts`      | VIEW               | TEAM         |
| `contacts`      | VIEW               | TEAM         |
| `activities`    | VIEW               | TEAM         |
| `tasks`         | VIEW               | TEAM         |
| `tickets`       | VIEW               | TEAM         |
| `products`      | VIEW               | ORGANIZATION |
| `reports`       | VIEW, VIEW_REPORTS | TEAM         |
| `dashboards`    | VIEW               | TEAM         |
| `smartviews`    | VIEW               | TEAM         |

#### `call_qa` — Call Quality Manager (rank 40, default scope ORGANIZATION)

| Module       | Actions            | Scope        |
| ------------ | ------------------ | ------------ |
| `leads`      | VIEW               | ORGANIZATION |
| `calls`      | VIEW, EDIT, EXPORT | ORGANIZATION |
| `tasks`      | VIEW, CREATE, EDIT | ORGANIZATION |
| `reports`    | VIEW, VIEW_REPORTS | ORGANIZATION |
| `dashboards` | VIEW               | ORGANIZATION |
| `documents`  | VIEW               | ORGANIZATION |

#### `executive_read_only` — Executive (Read-Only) (rank 15, default scope ORGANIZATION)

| Module          | Actions            | Scope        |
| --------------- | ------------------ | ------------ |
| `leads`         | VIEW               | ORGANIZATION |
| `opportunities` | VIEW               | ORGANIZATION |
| `accounts`      | VIEW               | ORGANIZATION |
| `contacts`      | VIEW               | ORGANIZATION |
| `activities`    | VIEW               | ORGANIZATION |
| `tasks`         | VIEW               | ORGANIZATION |
| `calls`         | VIEW               | ORGANIZATION |
| `campaigns`     | VIEW               | ORGANIZATION |
| `products`      | VIEW               | ORGANIZATION |
| `documents`     | VIEW               | ORGANIZATION |
| `reports`       | VIEW, VIEW_REPORTS | ORGANIZATION |
| `dashboards`    | VIEW               | ORGANIZATION |
| `smartviews`    | VIEW               | ORGANIZATION |

## 3.3 Restrictions to assert, not assume

For each role the suite tests at least one of each: a permitted action, a refused
action, and a record out of scope. The refusals below each have an explicit
design reason in the source, and are therefore the P0 authorization cases in
[Section 7](07-tenancy-authz.md).

| Role                       | Must NOT be able to                                   | Case                            |
| -------------------------- | ----------------------------------------------------- | ------------------------------- |
| `sales_rep`                | See another agent's lead (OWN scope)                  | `TEN-SCOPE-001`                 |
| `sales_rep`                | See a lead's full phone number                        | `TEN-FIELD-001`                 |
| `sales_rep`                | Delete any lead                                       | `SALES-LEAD-016`                |
| `sales_rep`                | Read employee salary data                             | `TEN-FIELD-004`                 |
| `Telecaller`               | Create a lead                                         | `SALES-LEAD-015`                |
| `Telecaller`               | Open Opportunities, Contacts, Accounts or Reports     | `SALES-NAV-004`                 |
| `team_manager`             | See a lead outside their team tree                    | `TEN-SCOPE-002`                 |
| `branch_manager`           | See a lead in another branch                          | `TEN-SCOPE-003`                 |
| `read_only`                | Modify any record                                     | `SALES-RO-002`                  |
| `auditor`                  | Create, edit, delete or approve anything              | `ADMIN-AUD-004`                 |
| `employee`                 | Read another employee's record, attendance or payslip | `TEN-SCOPE-006`                 |
| `payroll_officer`          | Release or approve a payroll run                      | `HR-PAY-008`                    |
| `hr_executive`             | Approve leave, or see salary                          | `HR-LEAVE-008`, `TEN-FIELD-003` |
| `it_admin`                 | Read any lead, call, employee record or salary        | `TEN-FIELD-005`                 |
| `recruiter`                | Approve an offer                                      | `HR-REC-006`                    |
| `hr_admin`                 | Edit the role catalogue                               | `ADMIN-ROLE-009`                |
| `call_qa`                  | Work the pipeline (no `opportunities` grant)          | `SALES-QA-005`                  |
| `org_admin` of workspace A | Reach any record of workspace B                       | `TEN-ISO-001`                   |
| Any workspace role         | Reach `/platform`                                     | `TEN-PLAT-001`                  |
| Any workspace              | Reach a module its plan excludes, by URL or API       | `TEN-ENT-001` … `TEN-ENT-004`   |

## 3.4 What this matrix cannot tell you

1. **Whether the workspace under test still matches it.** An administrator may
   have trimmed any grant. Before failing an authorization case, open
   **Administration → Settings → Roles**, select the role, and read the grants.
2. **Whether the user is in a team, branch or region.** TEAM, BRANCH and REGION
   scopes resolve through the user's own placement — see §2.3's three edge cases.
   An empty list is often a missing placement, not a broken query.
3. **Field-level masking.** A role may hold `VIEW` on a module and still see a
   masked value on individual fields, set per workspace through field
   permissions. Masking is tested separately in [Section 7](07-tenancy-authz.md).
