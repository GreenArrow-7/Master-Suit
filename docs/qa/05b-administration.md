# Section 5b — Company Admin

Account: `admin@manathhomes.ae` (`org_admin`) in `manath-homes`, unless a case
says otherwise. `org_admin` holds every action on every module at ORGANIZATION
scope, so these cases also establish the baseline that every narrower role is
then tested against.

---

## ADMIN-AUTH-001 — Company administrator signs in

|                     |                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform / Administration                                                                                       |
| **User Role**       | Company Admin (`org_admin`)                                                                                     |
| **Feature**         | Workspace sign-in and landing                                                                                   |
| **Test Scenario**   | A workspace administrator signs in and lands on their own workspace                                             |
| **Priority**        | P0                                                                                                              |
| **Preconditions**   | `manath-homes` is seeded with HRMS, SALES and REAL_ESTATE                                                       |
| **Test Data**       | `admin@manathhomes.ae` + `DEMO_PASSWORD`                                                                        |
| **Navigation Path** | `/login`                                                                                                        |
| **Code Reference**  | `src/lib/auth/login.ts`, `src/lib/security/entitlements.ts` (`workspaceLanding`), `src/lib/nav/workspaceNav.ts` |

**Test Steps**

1. Navigate to `/login`.
2. Enter `admin@manathhomes.ae` in **Email** and the demo password in **Password**.
3. Click **Sign in**.
4. Confirm you land on `/manath-homes/dashboard` — the **Workspace Summary**.
5. Confirm the sidebar has these sections, in this order: **Home**, **CRM**, **Real Estate**, **Properties**, **Marketing**, **People**, **Finance**, **Insights**, **Administration**, **Account**.
6. Confirm **Lead Eagle is absent** from the sidebar.
7. Open **Account → Role & Access** (`/manath-homes/profile/role`). Confirm the page is titled **My role & access** and shows the role `Organization Administrator`.
8. Open **Administration → Settings → Workspace**. Confirm the page loads.

**Expected Result**

- Landing is `/{slug}/dashboard`, because the workspace holds more than Lead Eagle. _(A workspace entitled to Lead Eagle **only** lands on `/{slug}/lead-eagle/dashboard` instead — `LE-AUTH-001`.)_
- **Lead Eagle is absent because the workspace holds Real Estate**, which carries the same screens. This is `unlessModule` in the navigation model and is deliberate, not a missing entitlement. If the workspace had Lead Eagle and _not_ Real Estate, the Lead Eagle section would appear.
- Every section listed above opens without a refusal, because `org_admin` holds `*:*`.

**Negative Scenarios**

| What to try                                                                      | Expected                 |
| -------------------------------------------------------------------------------- | ------------------------ |
| Sign in, then navigate to `/leadersfort/dashboard`                               | Refused — `TEN-ISO-002`  |
| Sign in, then navigate to `/platform`                                            | Refused — `TEN-PLAT-001` |
| Sign in with the correct password but a workspace the account does not belong to | Refused                  |

**Evidence** — Screenshot of the sidebar; the landing URL.

---

## ADMIN-USER-001 — Create a user with an employee record

|                     |                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                                                                                                                                                                                  |
| **User Role**       | Company Admin                                                                                                                                                                                                                                                                                                   |
| **Feature**         | User creation                                                                                                                                                                                                                                                                                                   |
| **Test Scenario**   | A new account is created with a role, an employee record and a temporary password shown once                                                                                                                                                                                                                    |
| **Priority**        | P0                                                                                                                                                                                                                                                                                                              |
| **Preconditions**   | Signed in as `org_admin`. A department and a branch exist (the seed creates branches `BB`, `JLT`, `DT`, `REEM`, `SHJ`)                                                                                                                                                                                          |
| **Test Data**       | Full name `QA Tester Employee`; employee code `QA-001`; work email `qa.employee@example.com`; phone `+971501234510`; role `Employee`; department `QA Department` (create it first, or use a seeded one); designation `QA Analyst`; branch `BB`; reporting manager T6; joined today; employment type `Full time` |
| **Navigation Path** | **Administration → Settings → Users** (`/manath-homes/admin/users`) → add a user (`/manath-homes/admin/users/new`)                                                                                                                                                                                              |
| **Code Reference**  | `src/app/(workspace)/[workspaceSlug]/people/users/new/NewUserForm.tsx`, `admin/users/new/page.tsx`                                                                                                                                                                                                              |

**Test Steps**

1. Navigate to `/manath-homes/admin/users`. Confirm the page is titled **Users** and shows the seeded accounts with columns including **Status**, **Role**, **Last sign-in** and **Two-factor**.
2. Open the add-user form at `/manath-homes/admin/users/new`. Confirm the heading **Add user**.
3. Enter `QA Tester Employee` in **Full name** (required; minimum 2, maximum 160 characters).
4. Enter `QA-001` in **Employee code** (required; maximum 40; placeholder shows `EMP-014`).
5. Enter `qa.employee@example.com` in **Work email** (required).
6. Enter `+971501234510` in **Phone**.
7. Select `Employee` in **Role** (required).
8. Select `QA Department` in **Department**.
9. Select `QA Analyst` in **Designation**.
10. Select `BB` in **Branch / office**.
11. Select T6 in **Reporting manager**.
12. Set the joining date (required) to today.
13. Select `Full time` in **Employment type**.
14. Set **Account status** to `ACTIVE`.
15. Set **Attendance location** to `QA Office` if the form offers it.
16. Click **Create user**. Confirm the button shows **Creating…**.
17. On the success panel, confirm it lists **Employee code**, **Work email**, **Role** and **Attendance location**, and shows **Temporary password:** with a value.
18. **Record the temporary password now.** Reload the page and confirm the password is no longer retrievable anywhere.
19. Sign out. Sign in as `qa.employee@example.com` with that temporary password.
20. Confirm you are required to change the password, or that the account's **Password** column on the Users page reads **Temporary — must change**.
21. Set a new password. Confirm you land in the workspace.
22. Confirm the sidebar shows only **Home**, **CRM → Activities → My Tasks**, **People → My HR**, and **Account** — nothing wider.

**Expected Result**

- The user is created ACTIVE with the chosen role and an employee record.
- **The temporary password is rendered exactly once**, on the success panel. A password an administrator can look up later is not temporary, it is shared. If it is retrievable after a reload, that is a **P0 defect**.
- The new account can sign in and is made to change the password.
- The `Employee` role sees only its own records: OWN scope throughout.
- The account appears in the Users list with **Status** ACTIVE.

**Negative Scenarios**

| What to try                                | Expected                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Submit with **Full name** blank            | Refused with the error **beside the field**, not a browser bubble                                                                   |
| A one-character name                       | Refused (minimum 2)                                                                                                                 |
| A 200-character name                       | Refused or truncated at 160 — record which                                                                                          |
| Submit with **Employee code** blank        | Refused                                                                                                                             |
| Reuse employee code `QA-001`               | Refused (409)                                                                                                                       |
| Reuse the email `sales.rep@manathhomes.ae` | Refused (409): the email is unique per workspace                                                                                    |
| An email with no `@`                       | Refused                                                                                                                             |
| Submit with **Role** blank                 | Refused                                                                                                                             |
| Submit with the joining date blank         | Refused                                                                                                                             |
| Double-click **Create user**               | **Exactly one** account is created. Two is a defect                                                                                 |
| The same email in `leadersfort`            | **Allowed** — accounts are unique per (workspace, email), not globally. Confirm, and confirm the two accounts are entirely separate |
| As `hr_admin` (T1)                         | **Allowed**: `hr_admin` holds `users:CREATE` + `MANAGE_USERS`                                                                       |
| As `it_admin` (T8)                         | **Allowed**: same grants                                                                                                            |
| As `hr_executive` (T2)                     | **Refused**: `users:VIEW` only                                                                                                      |
| As `sales_rep`                             | Refused, and the **Users** tab is absent from the sidebar. Confirm by URL too                                                       |

**Evidence** — The success panel (redact the password), the Users list row, and the new user's sidebar.

---

## ADMIN-USER-002 — Deactivate, remove and hand over a user's work

|                     |                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                              |
| **User Role**       | Company Admin                                                                                                                               |
| **Feature**         | Account lifecycle and work hand-over                                                                                                        |
| **Test Scenario**   | Deactivating an account ends its access; its open work is handed to someone else                                                            |
| **Priority**        | P0                                                                                                                                          |
| **Preconditions**   | `qa.employee@example.com` exists. A second account holds at least two open leads and one open task — use `sdr@manathhomes.ae` (Rayan Malik) |
| **Test Data**       | Hand follow-ups and tasks to `sales.rep@manathhomes.ae` (Sara Khan)                                                                         |
| **Navigation Path** | **Administration → Settings → Users** → open an account (`/manath-homes/admin/users/{userId}`)                                              |
| **Code Reference**  | `admin/users/UserRowActions.tsx`, `admin/users/HandOver.tsx`                                                                                |

**Test Steps**

1. Sign in as Rayan (`sdr@manathhomes.ae`) in a second browser and leave the session open on a lead page.
2. As `org_admin`, open `/manath-homes/admin/users` and open Rayan's account page. Confirm the page is titled **Account**.
3. Confirm the page shows **Status**, **Role**, **Access**, **Sign-in**, **Last sign-in**, **Two-factor**, **Active sessions**, **Signed in from**, **Device**, **Last seen**, **Employee**, **Face consent**, **Line manager**, **Reports to (blank for nobody)**, and **Lead work** with **Daily lead quota**, **Languages** and **Available for new leads**.
4. In the **Lead work** section, note the **Daily lead quota** hint: **New leads a day at most. Blank for no limit.** and the availability options **Available for new leads** / **No — passed over by automatic assignment**.
5. Find the hand-over control. Confirm it reads **Follow-ups and tasks go to** and lists other users.
6. Select Sara Khan. Submit (**Save lead work** or the hand-over button — **Needs UI Verification** for the exact label).
7. Confirm Rayan's open follow-ups and tasks now belong to Sara.
8. Click **Deactivate account**. Confirm the button shows **Deactivating…**, then the status becomes inactive.
9. In Rayan's browser, click any link or save any form.
10. Confirm Rayan's session no longer works and they are sent to sign in.
11. Attempt to sign in as Rayan with the correct password.
12. As `org_admin`, use **Reset password** on Rayan's account. Confirm the button shows **Resetting…** and a new temporary password is shown once.
13. Finally, on a disposable account (`qa.employee@example.com`), click **Remove account**. Confirm the button shows **Removing…**.

**Expected Result**

- Hand-over moves the open work before the account is closed; nothing is orphaned.
- Deactivation ends access **on the deactivated user's next request** — it must not wait for the session to expire 8 hours later. Allow up to 60 seconds before recording a Fail.
- A deactivated account cannot sign in, and the refusal does not say "wrong password" in a way that is misleading — record the exact wording.
- **Reset password** produces a one-time temporary password, shown once, as in `ADMIN-USER-001`.
- **Remove account** is the harder action: confirm whether it is a soft or hard removal and whether the user's historic records (leads they owned, calls they made, audit entries) survive. **Records must survive**; losing audit history with an account is a P0 defect.

**Negative Scenarios**

| What to try                                                            | Expected                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Deactivate the account you are signed in as                            | Refused, or you are signed out — record which. Locking the last administrator out of a workspace is a defect             |
| Deactivate the only `org_admin`                                        | Refused                                                                                                                  |
| Remove an account that still holds open work, without handing it over  | Record the behaviour. Either it refuses, or it hands the work somewhere explicit. Silently orphaning records is a defect |
| As `hr_admin`                                                          | Allowed to create, edit and reset; record whether removal is also allowed                                                |
| As `it_admin`                                                          | Same                                                                                                                     |
| As `sales_rep`                                                         | Refused; the screen is absent                                                                                            |
| A direct `DELETE` on another user's account from a `sales_rep` session | 403                                                                                                                      |

**Evidence** — Rayan's work before and after hand-over; the exact moment the session stopped working; the status of each refused attempt.

---

## ADMIN-ROLE-001 — Create a custom role

|                     |                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                          |
| **User Role**       | Company Admin                                                                                                                           |
| **Feature**         | Role creation                                                                                                                           |
| **Test Scenario**   | A role is created with chosen grants at a chosen scope                                                                                  |
| **Priority**        | P0                                                                                                                                      |
| **Preconditions**   | Signed in as `org_admin`                                                                                                                |
| **Test Data**       | Name `Custom Minimal`; key `custom_minimal`; default scope `OWN`; description `QA: one grant only`; the single grant `leads:VIEW @ OWN` |
| **Navigation Path** | **Administration → Settings → Roles** (`/manath-homes/admin/roles`)                                                                     |
| **Code Reference**  | `admin/roles/page.tsx`, `src/lib/security/rbac.ts`, `prisma/seed/roles.ts`                                                              |

**Test Steps**

1. Navigate to `/manath-homes/admin/roles`. Confirm the page is titled **Roles & permissions**.
2. Confirm all 25 seeded roles are listed by their display names from [02](02-roles-and-personas.md) §2.4.
3. Find the **New role** panel. Confirm its fields: a name, **Key (lowercase, no spaces)** with placeholder `branch_supervisor`, **Default scope** offering `OWN`, `TEAM`, `BRANCH`, `REGION`, `ORGANIZATION`, and **Description**. Confirm the submit button reads **Create role**.
4. Enter the test data and click **Create role**.
5. Select the new role from the list. Confirm its name appears as a heading.
6. Grant it exactly `leads:VIEW` at `OWN`. Save.
7. Confirm no other grant is set.
8. Assign the role to T14 using the **Assign a role** panel (see `ADMIN-ROLE-003`).
9. Sign in as T14 in a private window.
10. Confirm the sidebar shows almost nothing: **Home**, **CRM → Leads → All Leads / My Leads**, and **Account**.
11. Open **CRM → Leads**. Confirm only T14's own leads are listed (none, initially).
12. Attempt **Add lead**. Confirm the button is absent, and that `/manath-homes/sales/leads/new` redirects back to the lead list.

**Expected Result**

- The role is created with exactly the grants set — nothing is granted implicitly.
- A role with one grant produces a navigation with almost nothing in it.
- `/sales/leads/new` **redirects to the lead list** rather than showing an error, because the page itself re-checks `leads:CREATE` and redirects when it is absent.
- Every other module refuses T14.

**Negative Scenarios**

| What to try                                       | Expected                                                    |
| ------------------------------------------------- | ----------------------------------------------------------- |
| A key with spaces or capitals, e.g. `Custom Role` | Refused                                                     |
| Reuse the key `sales_rep`                         | Refused (409)                                               |
| Submit with the name blank                        | Refused                                                     |
| Submit with the key blank                         | Refused                                                     |
| As `hr_admin` (T1)                                | **Refused** — `ADMIN-ROLE-009`                              |
| As `it_admin` (T8)                                | **Refused** — `it_admin` holds `roles:VIEW` + `ASSIGN` only |
| As `auditor` (T11)                                | Refused — `auditor` holds `roles:VIEW` only                 |

**Evidence** — The created role with its single grant; T14's sidebar; the redirect from `/sales/leads/new`.

---

## ADMIN-ROLE-002 — Clone a role, and build the Telecaller

|                     |                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                 |
| **User Role**       | Company Admin                                                                                                                                  |
| **Feature**         | Role cloning                                                                                                                                   |
| **Test Scenario**   | A role is cloned and trimmed into a new one, and the original is unaffected                                                                    |
| **Priority**        | P1                                                                                                                                             |
| **Preconditions**   | Signed in as `org_admin`                                                                                                                       |
| **Test Data**       | Copy from `Sales Representative`; new role name `Telecaller`; key `telecaller`. Then trim to the grants in [02](02-roles-and-personas.md) §2.6 |
| **Navigation Path** | **Administration → Settings → Roles** → **Clone selected**                                                                                     |
| **Code Reference**  | `admin/roles/page.tsx`                                                                                                                         |

**Test Steps**

1. On the Roles page, select `Sales Representative` and note its grants exactly.
2. In the **Clone selected** panel, confirm the fields **Copy from**, **New role name** and **Key (lowercase, no spaces)**, and the submit button **Clone role**.
3. Clone it as `Telecaller` / `telecaller`.
4. Select `Telecaller`. Confirm its grants match `Sales Representative`'s exactly.
5. Remove `opportunities`, `contacts`, `accounts`, `reports`, `smartviews`, `products` and `leads:CREATE`.
6. Add `calls:VIEW`, `calls:CREATE`, `calls:EDIT`, all at `OWN`.
7. Save.
8. Re-select `Sales Representative`. Confirm its grants are **unchanged**.
9. Assign `Telecaller` to T12 and sign in as T12 in a private window.
10. Confirm the sidebar shows **CRM → Leads** and **CRM → Calls & Coaching**, but **not** Opportunities, Customers, Insights or Properties.

**Expected Result**

- The clone starts as an exact copy.
- Trimming the clone does not touch the original. A shared row between a role and its clone would be a **P0 defect**.
- A revoked permission **deletes its row** rather than setting a flag, so after step 5 those modules have no row at all.

**Negative Scenarios**

| What to try                                      | Expected                                    |
| ------------------------------------------------ | ------------------------------------------- |
| Clone with an existing key                       | Refused                                     |
| Clone with the name blank                        | Refused                                     |
| Clone `Super Administrator` as a non-super-admin | Record the behaviour — see `ADMIN-ROLE-004` |

**Evidence** — Side-by-side grants of the original and the clone, before and after trimming.

---

## ADMIN-ROLE-003 — Assign a role, with a scope and a window

|                     |                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                     |
| **User Role**       | Company Admin                                                                                      |
| **Feature**         | Role assignment                                                                                    |
| **Test Scenario**   | A role is assigned to a user at a chosen scope for a chosen window, and the assignment is recorded |
| **Priority**        | P0                                                                                                 |
| **Preconditions**   | Signed in as `org_admin`. T7 exists                                                                |
| **Test Data**       | Employee T7; role `Site Manager`; scope **A branch** = `BB`; start date today; end date in 7 days  |
| **Navigation Path** | **Administration → Settings → Roles** → **Assign a role**                                          |
| **Code Reference**  | `admin/roles/page.tsx`                                                                             |

**Test Steps**

1. In the **Assign a role** panel, confirm the fields **Employee**, a role selector, **Scope**, **Scope id / name (if scoped)**, **Start date** and **End date**, and the submit button **Assign role**.
2. Confirm the **Scope** options are exactly: **Entire organisation**, **A region**, **A branch**, **Their team**, **Their direct reports**, **Their own record only**.
3. Assign the test data and submit.
4. Confirm the **Users holding Site Manager** list now includes T7, with a **Held as** column showing the scope.
5. Open the **Assignment history** panel. Confirm the assignment appears with **User**, **Role**, **Scope**, **Window**, **Status** and **When**.
6. Sign in as T7. Confirm they see employees and attendance for branch `BB` only.
7. As `org_admin`, revoke the assignment from the Assignment history panel.
8. In T7's session, navigate again. Confirm the access is gone.
9. Re-assign with an **End date of yesterday**. Sign in as T7.

**Expected Result**

- Assignment is per user, per role, with its own scope and window — independent of the role's default scope.
- `Site Manager` at branch `BB` resolves to every user in `BB` plus T7 themselves.
- **An assignment whose window has passed grants nothing.** If T7 still has access in step 9, that is a P0 defect.
- Revocation takes effect on T7's next request (allow up to 60 seconds).
- The assignment history is a record: revoking does not erase it.

**Negative Scenarios**

| What to try                                            | Expected                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **A branch** scope with **Scope id / name** left blank | Refused, or resolves to nothing. Confirm T7 sees only themselves, not the whole company  |
| An end date before the start date                      | Refused                                                                                  |
| A branch name that does not exist                      | Refused (404 or 422)                                                                     |
| Assign a role to a user in `leadersfort`               | Refused — the employee list is this workspace's only                                     |
| As `hr_admin`                                          | **Allowed**: `hr_admin` holds `roles:ASSIGN`. Confirm they cannot _edit_ the role itself |
| As `it_admin`                                          | **Allowed**: `roles:ASSIGN`                                                              |
| As `auditor`                                           | Refused                                                                                  |

**Evidence** — The assignment row, the Held-as scope, T7's visible employee list, and what T7 sees after revocation and after an expired window.

---

## ADMIN-ROLE-004 — Nobody can grant themselves authority they do not have

|                     |                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Administration                                                                                                                 |
| **User Role**       | Various                                                                                                                        |
| **Feature**         | Privilege-escalation guard on role editing                                                                                     |
| **Test Scenario**   | Scopes above the editor's own level are shown but cannot be selected                                                           |
| **Priority**        | **P0**                                                                                                                         |
| **Preconditions**   | T6 (`dept_manager`, TEAM scope) exists. Temporarily grant T6 `roles:EDIT` at TEAM scope for this case, and record that you did |
| **Navigation Path** | **Administration → Settings → Roles**                                                                                          |
| **Code Reference**  | `admin/roles/page.tsx` — the UI states _"Scopes above your own level are shown but cannot be selected."_                       |

**Test Steps**

1. As `org_admin`, grant T6 `roles:VIEW` and `roles:EDIT` at TEAM scope. Save.
2. Sign in as T6 in a private window.
3. Open **Administration → Settings → Roles**.
4. Select any role. Confirm the note **Scopes above your own level are shown but cannot be selected.** appears.
5. Attempt to set any grant to `ORGANIZATION`. Confirm the option is visible but **not selectable**.
6. Using developer tools, send the same change to the API with `scope: "ORGANIZATION"` directly.
7. Record the status code.
8. Attempt to assign yourself (T6) the `Organization Administrator` role.
9. As `org_admin`, remove the temporary grants from T6 and confirm they are gone.

**Expected Result**

- The UI shows wider scopes so the editor understands the model, and refuses to let them be chosen.
- **The API refuses the same thing.** A UI-only guard here is a P0 defect: step 6 must return 403 or 422, never 200.
- A user cannot assign themselves a role more senior than their own.

**Negative Scenarios** — Every attempt in steps 5–8 must fail. Record each status code; a single success is a release blocker.

**Evidence** — The disabled options; the HTTP status from step 6; the result of step 8.

---

## ADMIN-ROLE-009 — HR cannot edit the role catalogue

|                     |                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                                                                                                                             |
| **User Role**       | HR Manager (`hr_admin`)                                                                                                                                                                                                                                    |
| **Feature**         | Separation of duty on role editing                                                                                                                                                                                                                         |
| **Test Scenario**   | HR can onboard a user and reset a password but cannot change what a role may do                                                                                                                                                                            |
| **Priority**        | **P0**                                                                                                                                                                                                                                                     |
| **Preconditions**   | T1 exists as `hr_admin`                                                                                                                                                                                                                                    |
| **Navigation Path** | `/manath-homes/admin/roles`                                                                                                                                                                                                                                |
| **Code Reference**  | `prisma/seed/roles.ts` — the `hr_admin` block's comment: _"Enough to onboard a joiner and reset their password, but not to edit the role catalogue: deciding what a role may do stays with the org admin, or an HR lead could widen their own authority."_ |

**Test Steps**

1. Sign in as T1.
2. Open **Administration → Settings → Roles**. Confirm you can **read** the role list (`roles:VIEW` is granted).
3. Confirm the **New role** panel is absent or its submit refuses.
4. Confirm the **Clone selected** panel is absent or refuses.
5. Attempt to change any grant on any role. Confirm it refuses.
6. Confirm the **Assign a role** panel **is** available (`roles:ASSIGN` is granted).
7. Assign the `Employee` role to a user. Confirm it succeeds.
8. Using developer tools, send a role-grant change directly to the API as T1. Record the status.
9. Attempt to assign yourself `Organization Administrator`.

**Expected Result**

- Read: yes. Assign: yes. **Create, clone or edit a role: no.**
- Step 8 returns 403.
- Step 9 is refused — otherwise an HR lead could widen their own authority, which is precisely what the design prevents.

**Negative Scenarios** — Any success in steps 3, 4, 5, 8 or 9 is a P0 defect.

**Evidence** — The HTTP status from step 8; screenshots of the absent or refusing panels.

---

## ADMIN-FIELD-001 — Field permissions and sensitive-field masking

|                     |                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                      |
| **User Role**       | Company Admin, then Sales Agent                                                                                                                     |
| **Feature**         | Field-level security                                                                                                                                |
| **Test Scenario**   | A field rule masks a value for a role that lacks the sensitive-field grant, and an action needing the real value refuses rather than using the mask |
| **Priority**        | **P0**                                                                                                                                              |
| **Preconditions**   | A lead exists with a full phone number. `sales.rep@manathhomes.ae` owns it                                                                          |
| **Navigation Path** | **Administration → Settings** (field permissions) → **CRM → Leads**                                                                                 |
| **Code Reference**  | `src/lib/security/fieldSecurity.ts` (`applyFieldSecurity`, `asLeadPhone`, `maskCallNumbers`, `dialable`)                                            |

**Test Steps**

1. As `org_admin`, open a lead and note its **full** phone number.
2. Sign in as Sara (`sales.rep@manathhomes.ae`) in a private window.
3. Open the same lead from **CRM → Leads → My Leads**.
4. Read the phone number. Confirm it is **masked**.
5. Attempt to copy the masked value and place a call with it from **New Call**.
6. Call `GET /api/v1/leads/{id}` from Sara's session and read the `phone` field in the JSON.
7. Call `GET /api/v1/leads?q=<the full phone number>` from Sara's session.
8. Attempt to filter or sort the lead list by phone from Sara's session via the API filter parameter.
9. Export the lead list as Sara, if the role allows export, and read the phone column.
10. Repeat steps 3–9 as `sales.manager@manathhomes.ae` (`team_manager`), who also lacks `VIEW_SENSITIVE_FIELDS`.
11. Repeat as Sofia Marchetti (`branch_manager`, who **does** hold `leads:VIEW_SENSITIVE_FIELDS` at BRANCH).

**Expected Result**

- The mask is applied at the **API**, not only in the page: step 6 must return the masked value in the JSON. A masked UI over an unmasked API is a P0 defect.
- A call placed with a masked number is **refused** — `dialable()` refuses a mask rather than dialling nonsense.
- Searching by the full number as a user who cannot see it must not confirm the number exists: step 7 must not return the lead on a phone match. Record exactly what it returns.
- Filtering on a field the user cannot see is refused (a filter that references an unseeable field is rejected, not silently ignored).
- An export carries the same masking as the screen. The API, the grid and the CSV are all egress paths and must agree.
- `branch_manager` sees the real number at BRANCH scope.

**Negative Scenarios**

| What to try                                                                   | Expected                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Sara requests the lead by API with an explicit field selection naming `phone` | Masked                                             |
| Sara's CSV export                                                             | Masked                                             |
| `it_admin` (T8) requesting the lead                                           | **403** — `it_admin` holds no `leads` grant at all |
| `payroll_officer` (T3) requesting an employee's salary                        | Allowed (`employee:VIEW_SENSITIVE_FIELDS`)         |
| `hr_executive` (T2) requesting the same salary                                | **Masked** — `TEN-FIELD-003`                       |

**Evidence** — The masked value from the UI **and** from the raw API response; the refusal when dialling a mask.

---

## ADMIN-SET-001 — Workspace, company and security settings

|                     |                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                               |
| **User Role**       | Company Admin                                                                                                                |
| **Feature**         | Workspace configuration                                                                                                      |
| **Test Scenario**   | Workspace identity, company details and the security policy save and take effect                                             |
| **Priority**        | P1                                                                                                                           |
| **Preconditions**   | Signed in as `org_admin`                                                                                                     |
| **Test Data**       | Display name `Manath Homes (QA)`; time zone `Asia/Dubai`; currency `AED`; a password policy requiring at least 12 characters |
| **Navigation Path** | **Administration → Settings → Workspace / Company / Security Policy**                                                        |
| **Code Reference**  | `admin/settings/page.tsx`, `admin/company/`, `admin/security/`, `src/app/api/v1/auth/reset-password/route.ts`                |

**Test Steps**

1. Open **Administration → Settings → Workspace** (`/manath-homes/admin/settings`). Confirm the title **Settings**.
2. Change the display name to `Manath Homes (QA)`. Save. Confirm it appears in the workspace header.
3. Open **Company** (`/manath-homes/admin/company`). Confirm the fields for legal name, address, email, phone, industry, logo, country, currency and time zone. Change the currency and save.
4. Open **Security Policy** (`/manath-homes/admin/security`). Note the current password policy.
5. Raise the minimum password length to 12 and save.
6. Create a new user (or reset an existing one) and attempt an 8-character password.
7. Attempt a 12-character password.
8. Open **Modules** (`/manath-homes/admin/modules`). Confirm it shows which products the workspace holds and that it **cannot** add one.
9. Open **Subscription** (`/manath-homes/admin/subscription`). Confirm it is read-only.
10. Revert the display name and currency.

**Expected Result**

- Settings save and are visible immediately.
- The password policy is enforced on **password reset** as well as on creation. The reset endpoint checks the policy twice: once against the default policy before it even looks up the token, and again against the workspace policy afterwards.
- **Modules** shows the entitlement and cannot change it: _"The plan is set by your platform provider: ask them to add …"_. A workspace that can grant itself a module is a **P0 defect**.
- A time-zone change affects the working day used by attendance and daily targets. Note the time zone before running any date-boundary case.

**Negative Scenarios**

| What to try                         | Expected                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| An empty display name               | Refused                                                       |
| An invalid time zone, by API        | 422                                                           |
| A minimum password length of 0 or 1 | Refused, or clamped to the product's own floor — record which |
| As `it_admin`                       | **Allowed** (`settings:EDIT` + `MANAGE_CONFIGURATION`)        |
| As `hr_admin`                       | **Refused** — `hr_admin` holds no `settings` grant            |
| As `auditor`                        | Read-only (`settings:VIEW`)                                   |
| As `sales_rep`                      | Refused; the whole Administration section is absent           |

**Evidence** — The saved values; the refusal for the 8-character password; the Modules page.

---

## ADMIN-SET-002 — Lead stages, sources, custom fields and the lead form layout

|                     |                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                       |
| **User Role**       | Company Admin                                                                                                                                        |
| **Feature**         | CRM configuration                                                                                                                                    |
| **Test Scenario**   | Configuration changes the Add lead form and the lead record                                                                                          |
| **Priority**        | P1                                                                                                                                                   |
| **Preconditions**   | Signed in as `org_admin`. The workspace holds SALES                                                                                                  |
| **Test Data**       | New stage `QA Qualified`; new source `QA Expo`; custom field `QA Budget Band`, type single-select, required, options `Under 1M` / `1–3M` / `Over 3M` |
| **Navigation Path** | **Administration → Settings → Lead Stages / Sources / Custom Fields**                                                                                |
| **Code Reference**  | `admin/lead-stages/`, `admin/lead-sources/`, `admin/custom-fields/`, `src/lib/leads/formLayout.ts`, `src/services/leads/customFields.ts`             |

**Test Steps**

1. Open **Lead Stages** (`/manath-homes/admin/lead-stages`). Confirm the title **Lead stages**.
2. Note which stage is marked default, and note any stage with an SLA in minutes.
3. Create `QA Qualified`. Save.
4. Open **Sources** (`/manath-homes/admin/lead-sources`). Confirm the title **Lead sources**.
5. Create `QA Expo` as active. Note whether it allows a starting score.
6. Open **Custom Fields** (`/manath-homes/admin/custom-fields`). Confirm the title **Custom fields**.
7. Create `QA Budget Band` as described, **required**, active.
8. On the same screen, find the **Layout** control for the Add lead form. Hide the **Nationality** field. Save.
9. Attempt to hide **Phone**, and attempt to hide **Source**.
10. Open **CRM → Leads → Add lead** (`/manath-homes/sales/leads/new`).
11. Confirm **Full name** is first and marked required.
12. Confirm **Nationality** is **absent**.
13. Confirm **QA Budget Band** appears, after the standard fields, marked required.
14. Confirm `QA Expo` is offered in the source picker.
15. Submit the form **without** choosing a Budget Band.
16. Choose one and submit. Open the created lead and confirm **Nationality** is absent from its Details card too.
17. Revert the layout and deactivate the custom field.

**Expected Result**

- New stages and sources appear immediately in the Add lead form.
- A required custom field is enforced for a **person**: step 15 is refused with a field-level error.
- **Phone and Source cannot be hidden** — calling and routing need them. The control must refuse, not merely warn.
- Hiding a field removes it from the Add lead form **and** from the lead page's Details card.
- Custom fields keep their own order and appear after the standard fields.

**Negative Scenarios**

| What to try                                                        | Expected                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two stages both marked default                                     | Refused, or the previous default is cleared — record which                                                                                                                         |
| A source with a blank name                                         | Refused                                                                                                                                                                            |
| A custom field whose key duplicates an existing one                | Refused                                                                                                                                                                            |
| A layout payload listing the same field twice, by API              | 422: _"A field is listed twice."_                                                                                                                                                  |
| A layout payload hiding `phone`, by API                            | Refused: a fixed field is never hidden                                                                                                                                             |
| A lead created **by API key** that omits the required custom field | **Allowed.** A person must fill required custom fields; an API key, like the public intake, still lands a lead that leaves one out. This is deliberate — do not log it as a defect |

**Evidence** — The Add lead form before and after the layout change; the refusal in step 15; the API response in the last negative row.

---

## ADMIN-INT-001 — Integrations

|                     |                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                        |
| **User Role**       | Company Admin, then IT Administrator                                                                  |
| **Feature**         | Integration registry                                                                                  |
| **Test Scenario**   | An integration can be configured, and an unconfigured one refuses clearly                             |
| **Priority**        | P1                                                                                                    |
| **Preconditions**   | Signed in as `org_admin`                                                                              |
| **Navigation Path** | **Administration → Settings → Integrations** (`/manath-homes/admin/integrations`)                     |
| **Code Reference**  | `src/lib/integrations/registry.ts`, `admin/integrations/page.tsx`, `admin/integrations/meta/page.tsx` |

**Test Steps**

1. Open `/manath-homes/admin/integrations`. Confirm the title **Integrations**.
2. Confirm the providers are grouped by category, and note every category and provider shown.
3. Open the Facebook & Instagram page (`/manath-homes/admin/integrations/meta`). Confirm the title **Facebook & Instagram**.
4. Without configuring anything, open **Marketing → Lead Sources → Social Sources** (`/manath-homes/sales/social-leads`).
5. Record what an unconfigured integration shows.
6. Configure a webhook-style provider (`custom_webhook`) and note the **secret** it issues.
7. Send a webhook request to its endpoint **without** a signature.
8. Send the same request **with** a valid signature.
9. Send the identical signed request a second time.
10. Repeat step 8 601 times within a minute.
11. Sign in as T8 (`it_admin`) and confirm the same screens are reachable.
12. Sign in as `hr_admin` (T1) and attempt to open Integrations.

**Expected Result**

- Each provider states what credentials it needs. An unconfigured provider produces a clear refusal naming what is missing, **not** a crash and **not** a silently empty screen.
- `custom_webhook` and `inbound_email` **issue a secret**; Exotel and Knowlarity callbacks are **unsigned** by design (their vendors do not sign) — so an unsigned callback from those two is not a defect, while an unsigned `custom_webhook` call must be rejected.
- A replayed identical webhook must not create a duplicate record. Record what happens.
- The 601st webhook in a minute is rate-limited (limit: 600 / minute per integration).
- `it_admin` has full integration authority; `hr_admin` has none.

**Negative Scenarios**

| What to try                                                                 | Expected                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A webhook with a wrong signature                                            | Rejected                                                   |
| A webhook for a provider that is switched off                               | Rejected                                                   |
| A credential field containing a URL pointing at `localhost` or a private IP | Rejected — outbound URL validation exists for exactly this |
| As `sales_rep`                                                              | Refused; the screen is absent                              |

**Evidence** — The provider list; the unconfigured refusal; the status of each webhook attempt.

---

## ADMIN-AUD-001 — Audit log records who did what

|                     |                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                               |
| **User Role**       | Company Admin                                                                                |
| **Feature**         | Audit log                                                                                    |
| **Test Scenario**   | Record creation, permission changes and platform entry all appear, attributable              |
| **Priority**        | P0                                                                                           |
| **Preconditions**   | `ADMIN-USER-001`, `ADMIN-ROLE-001` and `SALES-LEAD-001` have been run                        |
| **Navigation Path** | **Administration → Settings → Audit Log** (`/manath-homes/admin/audit`)                      |
| **Code Reference**  | `admin/audit/page.tsx`, `src/lib/security/audit.ts`, `src/lib/api/handler.ts` (`auditEvent`) |

**Test Steps**

1. Open `/manath-homes/admin/audit`. Confirm the title **Audit log**.
2. Find the lead you created in `SALES-LEAD-001`. Confirm a `RECORD_CREATED` entry naming the actor and the time.
3. Find the user you created in `ADMIN-USER-001`.
4. Find the role you created in `ADMIN-ROLE-001`.
5. If `PLAT-BG-001` was run against this workspace, find the platform write entry and confirm it carries the platform user's **stated reason**.
6. Filter or search the log by actor and by date.
7. Export the log. Confirm the export matches what is on screen.
8. Sign in as T11 (`auditor`) and confirm the same entries are readable and exportable.
9. As T11, attempt to delete or edit an entry.
10. Sign in as `sales_rep` and attempt to open the audit log.

**Expected Result**

- Every write that goes through the API kernel records an audit event with its actor.
- A platform break-glass write appears **in the customer's own log**, with the reason.
- `auditor` can read and export (`auditlogs:VIEW` + `EXPORT`) and change nothing.
- `sales_rep` is refused; the tab is absent.
- The log is append-only.

**Negative Scenarios**

| What to try                                          | Expected                               |
| ---------------------------------------------------- | -------------------------------------- |
| A `DELETE` on an audit entry, by API, as `org_admin` | Refused                                |
| An audit entry for a record in `leadersfort`         | Absent — the log is this tenant's only |
| An action performed and then the record deleted      | The audit entry **survives**           |

**Evidence** — Screenshots of the four entries; the HTTP status from step 9 and the API delete.

---

## ADMIN-AUD-004 — The auditor writes nothing

|                     |                                                                               |
| ------------------- | ----------------------------------------------------------------------------- |
| **Module**          | Administration                                                                |
| **User Role**       | Auditor (`auditor`)                                                           |
| **Feature**         | Read-only role integrity                                                      |
| **Test Scenario**   | `auditor` holds no CREATE, EDIT, DELETE or APPROVE anywhere                   |
| **Priority**        | **P0**                                                                        |
| **Preconditions**   | T11 exists as `auditor`                                                       |
| **Navigation Path** | Every screen T11 can reach                                                    |
| **Code Reference**  | `prisma/seed/roles.ts` — _"An auditor who can change the record is not one."_ |

**Test Steps**

1. Sign in as T11.
2. Note every section the sidebar shows. Expect: Home, People (read), Insights (reports), Administration (audit, roles read, users read, settings read), Account.
3. For each reachable list screen, confirm no create button is offered.
4. Open one employee record, one payroll run, one attendance record, one leave request, one HR document and the settings page. Attempt an edit on each.
5. Attempt to approve a leave request and a payroll run.
6. For each of the following, send a direct API request from T11's session and record the status: `POST /api/v1/leads`, `PATCH` an employee, `POST` a payroll approval, `PATCH` a workspace setting, `DELETE` any record.
7. Confirm the audit log and the HR reports export correctly.

**Expected Result**

- Every create, edit, delete and approve is refused, in the UI **and** at the API.
- Reading and exporting work: `auditlogs`, `employee`, `attendance`, `leave`, `overtime`, `payroll`, `hr_documents`, `hr_reports`, `work_locations`, `roles`, `users`, `settings`, `reports`, `dashboards` — all VIEW.
- Note that `auditor` holds `payroll:VIEW` but **not** `VIEW_SENSITIVE_FIELDS`: salary figures should be masked. Confirm, and record if they are not.

**Negative Scenarios** — Any single successful write by `auditor` is a P0 defect. Record the endpoint and the payload.

**Evidence** — A table of every endpoint tried in step 6 with its status code.

---

## ADMIN-RET-001 — Data retention

|                     |                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                          |
| **User Role**       | Company Admin                                                                                                           |
| **Feature**         | Data retention                                                                                                          |
| **Test Scenario**   | A retention policy is set and the retention sweep honours it                                                            |
| **Priority**        | P1                                                                                                                      |
| **Preconditions**   | Signed in as `org_admin`. **The worker must be running**                                                                |
| **Navigation Path** | **Administration → Settings → Data Retention** (`/manath-homes/admin/retention`)                                        |
| **Code Reference**  | `admin/retention/page.tsx`, `src/app/api/v1/admin/retention/route.ts`, `src/workers/maintenance.ts` (`retention-daily`) |

**Test Steps**

1. Open `/manath-homes/admin/retention`.
2. Note every record kind a retention period can be set for, and the current periods.
3. Set a short period on one kind — short enough that existing test data is already beyond it.
4. Save. Confirm the setting persists after a reload.
5. Trigger the retention run, by `POST /api/v1/admin/retention` or by waiting for `retention-daily`.
6. Confirm the records beyond the period are removed or anonymised — record which.
7. Confirm the audit log records the retention run.
8. Confirm nothing **inside** the retention period was touched.
9. Restore the original periods.

**Expected Result**

- Retention is per record kind, with its own period.
- The sweep removes only what is beyond the period. Removing anything inside it is a **P0 data-loss defect**.
- The run is recorded in the audit log.
- With the worker stopped, nothing happens and the screen does not pretend otherwise. If the worker is down, record **Blocked**.

**Negative Scenarios**

| What to try                                   | Expected                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A retention period of 0 days                  | Refused, or clamped — record which. A policy that deletes today's data on save is a P0 defect |
| A negative period                             | Refused                                                                                       |
| `POST /api/v1/admin/retention` as `sales_rep` | 403                                                                                           |
| `POST` it twice in quick succession           | The second must not double-delete or error unhandled                                          |

**Evidence** — Record counts before and after, with their dates; the audit entry.

---

## ADMIN-TEAM-001 — Teams, and why they matter to every scope case

|                     |                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Administration                                                                                                                                |
| **User Role**       | Company Admin                                                                                                                                 |
| **Feature**         | Teams                                                                                                                                         |
| **Test Scenario**   | A team, and its descendant teams, define what TEAM scope resolves to                                                                          |
| **Priority**        | P0                                                                                                                                            |
| **Preconditions**   | Signed in as `org_admin`                                                                                                                      |
| **Test Data**       | Team `QA Team A` with Omar Hassan as manager and Sara Khan and Rayan Malik as members. Then a child team `QA Team A1` with one further member |
| **Navigation Path** | **Administration → Settings → Teams** (`/manath-homes/admin/teams`)                                                                           |
| **Code Reference**  | `admin/teams/page.tsx`, `src/lib/security/visibility.ts` (`resolveOwnerIds`, `descendantTeamIds`)                                             |

**Test Steps**

1. Open `/manath-homes/admin/teams`. Confirm the title **Teams**.
2. Note the seeded teams and their members.
3. Create `QA Team A`, set Omar as manager, add Sara and Rayan.
4. Sign in as Omar. Open **CRM → Leads → All Leads**. Confirm you see Sara's and Rayan's leads and your own, and nobody else's.
5. As `org_admin`, create `QA Team A1` as a **child** of `QA Team A`, with one more member who owns at least one lead.
6. In Omar's session, reload the lead list.
7. Confirm the child team's member's leads are now visible to Omar.
8. As `org_admin`, remove Sara from `QA Team A`.
9. In Omar's session, reload.
10. As `org_admin`, create T16 as a `team_manager` with **no team and no reports**. Sign in as T16 and open the lead list.

**Expected Result**

- TEAM scope resolves to the user, everyone they manage, and **every member of their team and its descendant teams**. The child team's records are included — that is what `descendantTeamIds` is for.
- Removing a member removes their records from the manager's view on the **next page load**. Scope resolution is memoized **per request only**, so there is no five-minute delay. _(A comment in the code once claimed a five-minute cache; it never existed and has been corrected.)_
- T16, with no team, sees **only themselves plus anyone reporting to them** — here, nobody. An empty CRM for a manager is correct in that configuration, and is the most commonly mis-reported "bug" in this product.

**Negative Scenarios**

| What to try                               | Expected                                         |
| ----------------------------------------- | ------------------------------------------------ |
| A team that is its own parent, or a cycle | Refused                                          |
| A member in `leadersfort`                 | Not offered                                      |
| A team with no manager                    | Allowed; confirm nobody gains visibility from it |
| As `it_admin`                             | Allowed (`users:MANAGE_USERS`)                   |
| As `sales_rep`                            | Refused                                          |

**Evidence** — Omar's visible lead list at each step, with counts; T16's empty list with the team configuration shown beside it.
