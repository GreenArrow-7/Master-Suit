# Section 5a — Platform Owner / Platform Staff

The platform console is the vendor's own console, at `/platform`. It creates
workspaces, sells them product modules, and watches the system. **No workspace
role can reach it, ever** — that is tested in [07](07-tenancy-authz.md)
`TEN-PLAT-001`.

Accounts used here: the platform owner from [04](04-environment-and-data.md)
§4.6, plus T20 (`SUPPORT`) and T21 (`SECURITY_AUDITOR`), which you create first.

Every case below leaves **Actual Result** and **Test Status** blank for the
tester. Default status: **Not Run**.

---

## PLAT-AUTH-001 — Platform owner signs in and reaches the console

|                     |                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                                                        |
| **User Role**       | Platform Owner (`PlatformRole = OWNER`)                                                                                                         |
| **Feature**         | Platform sign-in                                                                                                                                |
| **Test Scenario**   | The platform owner's credentials admit them to `/platform`                                                                                      |
| **Priority**        | P0                                                                                                                                              |
| **Preconditions**   | The application and database are up. The seed has run, or a platform owner exists. `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` are known |
| **Test Data**       | Email `owner@masterapp.local`; password as set                                                                                                  |
| **Navigation Path** | `/login` → `/platform`                                                                                                                          |
| **Code Reference**  | `apps/web/src/app/(auth)/login/LoginForm.tsx`, `src/lib/auth/login.ts`, `src/app/(platform)/platform/page.tsx`                                  |

**Test Steps**

1. Open the application's base URL in a browser.
2. Navigate to `/login`.
3. Confirm the heading reads **Welcome back** and the lede reads **Sign in to your workspace.**
4. Confirm the form has two fields labelled **Email** and **Password**, both marked required, a **Forgot password?** link beside the Password label, and a **Sign in** button.
5. Confirm the note below the button reads **Access is by invitation from your workspace administrator.**
6. Enter the platform owner's email in **Email**.
7. Enter the password in **Password**.
8. Click the eye icon beside the password field. Confirm its accessible label changes between **Show password** and **Hide password** and the characters become visible, then hide them again.
9. Click **Sign in**.
10. If MFA is enabled for this account (only when `PLATFORM_OWNER_MFA_SECRET` was set), confirm the heading becomes **Verify it's you**, the lede reads **Enter the 6-digit code from your authenticator app.**, the email is shown with a **Change** button, and a field labelled **Authentication code** accepts 6 digits. Enter the code.
11. Confirm you land on the platform console.
12. Confirm the console shows the command band with a headline, and navigation to Workspaces, Plans, Subscriptions, Users, Identity, Credentials, Security, AI Control Center, AI usage, Platform audit, System health and Settings.
13. Navigate to `/platform/system-health`. Confirm the heading reads **System health**.

**Expected Result**

- Sign-in succeeds with one request; the page does not reload twice.
- The 6-digit field auto-submits on the sixth digit when MFA is on.
- `/platform` renders. No workspace sidebar (CRM, People, Administration) appears anywhere in the platform console.
- **System health** loads and reports on the database, Redis and queues.

**Negative Scenarios**

| What to try                                           | Expected                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Wrong password                                        | Refused. The message must not say whether the email exists        |
| Non-existent email                                    | Refused with **the same** message as a wrong password             |
| 6 wrong passwords for the same email within 5 minutes | The 6th is refused with HTTP 429 (per-account limit is 5 / 5 min) |
| 11 sign-in attempts from one IP within 5 minutes      | The 11th is refused with 429 (per-IP limit is 10 / 5 min)         |
| A `PlatformRole = USER` account                       | Lands on `/no-platform-access`, **not** on `/platform`            |
| MFA code `000000`                                     | Refused; a wrong code does not consume the password step          |

**Evidence** — Screenshot of `/platform`; for each negative, the message text and HTTP status.

---

## PLAT-WS-001 — Provision a new workspace

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Platform                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **User Role**       | Platform Owner                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Feature**         | Workspace provisioning                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Test Scenario**   | A new company is created with a plan, modules and a first administrator                                                                                                                                                                                                                                                                                                                                                        |
| **Priority**        | P0                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Preconditions**   | Signed in as platform owner. At least one subscription plan exists (the seed creates five)                                                                                                                                                                                                                                                                                                                                     |
| **Test Data**       | Workspace name `QA Brokerage One`; slug `qa-brokerage-one`; legal name `QA Brokerage One LLC`; administrator name `QA Admin One`; administrator email `qa.admin.one@example.com`; initial password a strong value you record; plan `business`; modules **Sales CRM** and **People / HRMS**; country `United Arab Emirates`; currency `AED`; time zone `Asia/Dubai`; maximum users `25`; maximum employees `25`; storage `5120` |
| **Navigation Path** | `/platform` → **Workspaces** → **New** (`/platform/workspaces/new`)                                                                                                                                                                                                                                                                                                                                                            |
| **Code Reference**  | `apps/web/src/app/(platform)/platform/workspaces/new/`, `src/app/api/v1/platform/`, `src/lib/modules/catalogue.ts`                                                                                                                                                                                                                                                                                                             |

**Test Steps**

1. Sign in as the platform owner.
2. Navigate to `/platform/workspaces`.
3. Confirm the existing workspaces are listed, including `Manath Homes` and `Leadersfort` on a seeded environment.
4. Open the new-workspace form at `/platform/workspaces/new`.
5. Enter `QA Brokerage One` in **Workspace name**.
6. Enter `qa-brokerage-one` in **Workspace slug**.
7. Enter `QA Brokerage One LLC` in **Legal name**.
8. Enter `QA Brokerage One` in **Display name**.
9. Enter `QA Admin One` in **Administrator name**.
10. Enter `qa.admin.one@example.com` in **Administrator email**.
11. Enter the recorded strong password in **Initial password**.
12. Select plan `business` in **Plan**.
13. In **Modules**, tick **Sales CRM** and **People / HRMS**. Confirm all four modules are offered: **People / HRMS**, **Sales CRM**, **Real Estate**, **Lead Eagle**, each with its description.
14. Complete **Country**, **Currency**, **Time zone**, **Maximum users**, **Maximum employees** and **Storage (MB)** with the test data.
15. Complete any remaining field the form marks required.
16. Click **Create workspace**.
17. Confirm the button shows **Creating…** while it works.
18. Confirm a **Workspace created** panel appears, and note the workspace slug and administrator credentials it shows.
19. Navigate to `/platform/workspaces`. Confirm `QA Brokerage One` is listed.
20. Open the new workspace's detail page. Confirm **Subscription at a glance**, **Modules**, **Usage** and **Company administrators and users** sections appear, and that Modules lists exactly **Sales** and **HR**.
21. Open a private browsing window. Navigate to `/login`. Sign in as `qa.admin.one@example.com` with the initial password.
22. Confirm you land inside `qa-brokerage-one` and the sidebar shows CRM, Properties, Marketing, People, Finance, Insights, Administration and Account — but **not** Real Estate and **not** Lead Eagle.

**Expected Result**

- The workspace is created with exactly the two ticked modules entitled.
- The administrator account is created ACTIVE and can sign in immediately.
- The new workspace's data is empty: no leads, no employees, no demo records.
- The detail page's module list matches what was ticked.
- The new administrator sees only their own workspace's navigation.

**Negative Scenarios**

| What to try                                             | Expected                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Submit with **Workspace slug** blank                    | Refused with a field-level message; nothing is created                                                                        |
| Reuse the slug `manath-homes`                           | Refused (409 conflict); no second workspace                                                                                   |
| A slug with spaces or capitals, e.g. `QA Brokerage`     | Refused or normalised — record which. **Needs UI Verification**                                                               |
| Reuse `admin@manathhomes.ae` as the administrator email | Record the behaviour: a platform identity is per-email, a workspace user is per (workspace, email). **Needs UI Verification** |
| Tick **no** modules                                     | Record the behaviour. If it succeeds, confirm the workspace opens to a navigation with only Home, Account and Administration  |
| A weak initial password, e.g. `abc`                     | Refused against the password policy                                                                                           |
| A non-existent plan code, by API                        | 422                                                                                                                           |

**Evidence** — Screenshots of the completed form, the created panel, the detail page's Modules list, and the new administrator's sidebar.

---

## PLAT-WS-002 — Change a workspace's entitled modules

|                     |                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Platform                                                                                                                       |
| **User Role**       | Platform Owner                                                                                                                 |
| **Feature**         | Product entitlement                                                                                                            |
| **Test Scenario**   | Adding and removing a module changes what the workspace can reach, within a minute                                             |
| **Priority**        | P0                                                                                                                             |
| **Preconditions**   | `QA Brokerage One` exists with Sales + HRMS. A workspace user of it is signed in in a second browser                           |
| **Test Data**       | Add **Real Estate**; then remove **Sales CRM**                                                                                 |
| **Navigation Path** | `/platform/workspaces/{workspaceId}`                                                                                           |
| **Code Reference**  | `src/lib/security/entitlements.ts`, `src/components/workspace/NotInPlan.tsx`, `src/components/workspace/RecheckOnNavigate.tsx` |

**Test Steps**

1. As the workspace administrator of `QA Brokerage One` (second browser), confirm the sidebar has **no** Real Estate section, and that `/{slug}/realty/leads` shows the refusal panel.
2. As the platform owner, open the workspace's detail page.
3. Add **Real Estate** to its modules and save.
4. In the workspace browser, navigate to another page so the layout re-renders, then to `/{slug}/realty/leads`.
5. Confirm the Real Estate area is now reachable and the sidebar shows it.
6. As the platform owner, **remove Sales CRM** from the workspace's modules and save.
7. In the workspace browser, navigate to `/{slug}/sales/leads`.
8. Read the panel that appears. Confirm it reads **Leads is part of …** naming the products that carry the screen, then **This workspace's plan does not include it.**
9. Confirm that because the workspace still holds Real Estate — which carries the same screen — you are instead redirected to `/{slug}/realty/leads`. Record which of the two happened.
10. Confirm a **Back to the dashboard** button is present on the refusal panel if it appeared.
11. Call `GET /api/v1/leads` directly from the workspace session. Record the status code.

**Expected Result**

- Adding a module takes effect on the workspace's next page load, and **within 60 seconds at the very worst** (the entitlement cache TTL is 60 s and disabling a module clears the key outright).
- Removing a module refuses the screen with the friendly panel, not an error page and not a blank redirect.
- Because the same screens live under `sales/`, `realty/` and `lead-eagle/`, a workspace that still holds a carrying product is **sent to that product's URL** rather than refused. This is deliberate.
- With **no** carrying product, `GET /api/v1/leads` returns **403** with a body naming the product: _"Sales, Real Estate or Lead Eagle is not enabled for this company."_
- The refusal names **every** product that carries the screen, not just the last one checked.

**Negative Scenarios**

| What to try                                                                              | Expected                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Remove every module                                                                      | The workspace still signs in; only Home, Account and Administration remain reachable                              |
| Immediately after removal, retry the URL repeatedly                                      | Still refused. Caching must not let a removed module keep working beyond 60 s                                     |
| A workspace user tries to re-add the module from **Administration → Settings → Modules** | Refused. The refusal text tells an administrator _"The plan is set by your platform provider: ask them to add …"_ |

**Evidence** — The exact refusal wording; the HTTP status from step 11; timestamps for steps 3–5 and 6–7.

---

## PLAT-WS-003 — Open a customer workspace read-only as platform staff

|                     |                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                 |
| **User Role**       | Platform Staff (`SUPPORT`)                                                                               |
| **Feature**         | Platform support entry into a workspace                                                                  |
| **Test Scenario**   | Support can read a customer's workspace and change nothing                                               |
| **Priority**        | P0                                                                                                       |
| **Preconditions**   | T20 exists with `PlatformRole = SUPPORT`. `manath-homes` is seeded                                       |
| **Navigation Path** | `/login` → `/platform/workspaces` → open `Manath Homes`                                                  |
| **Code Reference**  | `src/lib/auth/platform-access.ts` (`buildSupportActor`), `src/lib/nav/workspaceNav.ts` (`platformStaff`) |

**Test Steps**

1. Sign in as T20.
2. Navigate to `/platform/workspaces` and open `Manath Homes`.
3. Enter the workspace.
4. Confirm you can open **CRM → Leads → All Leads** and see lead records.
5. Confirm the **People** section is **absent from the navigation entirely**.
6. Navigate directly to `/{slug}/people/employees`. Record what happens.
7. Open a lead. Attempt to edit any field and save.
8. Attempt to create a lead from **Add lead**.
9. Attempt to delete a record.
10. Return to the platform console. Open `/platform/audit`.
11. Confirm an audit entry records your entry into the workspace, and what mode it was.

**Expected Result**

- Reading the workspace needs no ceremony and works.
- **The People section is hidden outright** for platform staff: they hold no employee record there, so the self-service tabs would be meaningless, and the monitoring boundary excludes HR. This is by design.
- Every write is refused. `SUPPORT` is read-only and holds no path to elevate.
- The workspace-entry audit row records the mode accurately. It must **not** claim read-only for a session that could write, nor the reverse.

**Negative Scenarios**

| What to try                                            | Expected                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| A direct `POST /api/v1/leads` from the support session | 403                                                            |
| A direct `PATCH` on a lead                             | 403                                                            |
| `SECURITY_AUDITOR` (T21) doing the same                | Identical: read-only                                           |
| An `AI_SERVICE` identity attempting any write          | 403. It is read-only **by construction** and can never elevate |

**Evidence** — Screenshot showing no People section; the HTTP status of each attempted write; the audit row.

---

## PLAT-BG-001 — Take time-boxed write access (break-glass)

|                     |                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                                                       |
| **User Role**       | Platform Owner                                                                                                                                 |
| **Feature**         | Break-glass write access into one customer workspace                                                                                           |
| **Test Scenario**   | Writing in a customer's workspace requires a stated reason and a clock, and both reach the customer's own audit trail                          |
| **Priority**        | P0                                                                                                                                             |
| **Preconditions**   | Signed in as platform owner. `Manath Homes` exists. No active grant on it                                                                      |
| **Test Data**       | Reason: `QA-1234 correcting a duplicated lead reference for the customer` (long enough to pass the minimum); duration **30 minutes (default)** |
| **Navigation Path** | `/platform/workspaces/{workspaceId}` → **Write access** panel                                                                                  |
| **Code Reference**  | `src/app/(platform)/platform/workspaces/[workspaceId]/BreakGlass.tsx`, `src/lib/auth/platform-access.ts`                                       |

**Test Steps**

1. Open the workspace detail page as the platform owner.
2. Find the **Write access** panel. Confirm its explanatory text says that opening a workspace needs no ceremony, that changing something in it needs a stated reason and a clock, and that both are written to **their** audit trail.
3. Confirm a field labelled **Why do you need to change this customer's data?** with placeholder **Ticket number and what you are going to change.**
4. Confirm the hint below it reads **At least {n} characters. This is what the customer reads on their audit trail.** Note the number `{n}`.
5. Type a reason of `{n} - 1` characters. Confirm the **Take write access** button is **disabled**.
6. Complete the reason with the test data.
7. Open the **For how long?** dropdown. Confirm the options are **15 minutes**, **30 minutes**, **1 hour**, **2 hours**, **4 hours** — and that exactly one is marked **(default)**. Confirm no option exceeds the maximum.
8. Confirm the hint below reads **It ends by itself. Asking again is cheap; a grant nobody closes is not.**
9. Leave the default selected. Click **Take write access**.
10. Confirm the button shows **Opening…**, then the panel changes to show the grant with the **reason given** and a countdown.
11. Read the countdown. Confirm it is phrased as e.g. **29 minutes left**, and that it never shows **0 minutes left** or a negative value.
12. Enter the workspace. Open a lead. Change one field and save.
13. Confirm the change saves.
14. In the workspace, open **Administration → Settings → Audit Log**.
15. Confirm the customer's own audit trail records the platform write, **with the reason you typed**.
16. Return to the workspace detail page. Click **Hand it back now**.
17. Confirm the button shows **Handing it back…**, then the panel returns to asking for a reason.
18. Return to the workspace and attempt the same edit again.

**Expected Result**

- Write access cannot be taken without a reason of at least the stated length; the UI refuses locally exactly what the API refuses.
- The maximum duration offered is **240 minutes (4 h)**, default **30 minutes**.
- While the grant is live, writes succeed.
- **The customer reads the reason on their own audit trail.** This is the point of the control.
- After handing it back, the same edit is refused.
- The countdown is always a positive, human phrase.

**Negative Scenarios**

| What to try                                                 | Expected                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A reason of one character, forced through the API           | 422, with a field-level message explaining the minimum                                                                                        |
| `minutes: 1000` through the API                             | Refused; capped at 240                                                                                                                        |
| `minutes: 0` or negative                                    | Refused                                                                                                                                       |
| `SUPPORT` (T20) attempting to take write access             | **Refused.** Only `OWNER` can elevate                                                                                                         |
| `AI_SERVICE` attempting it                                  | Refused. It can never elevate                                                                                                                 |
| Waiting for the grant to expire, then writing               | Refused. Expiry is enforced **on every read**, not by a background sweeper                                                                    |
| Deleting the grant row directly in the database and writing | Refused — but note the row is deliberately **left in place** after expiry, because it is the record of who was in the customer's data and why |

**Evidence** — Screenshots of the disabled button at `{n}-1` characters, the duration options, the live countdown, and the customer's audit entry showing your reason.

---

## PLAT-BG-002 — Grant durations and their ceilings

|                     |                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                       |
| **User Role**       | Platform Owner                                                                                 |
| **Feature**         | Grant types                                                                                    |
| **Test Scenario**   | Each kind of authorisation has its own default and its own hard maximum, and none is unlimited |
| **Priority**        | P0                                                                                             |
| **Preconditions**   | Signed in as platform owner                                                                    |
| **Navigation Path** | `/platform/workspaces/{workspaceId}`, `/platform/security`                                     |
| **Code Reference**  | `src/lib/auth/platform-access.ts`                                                              |

**Test Steps**

1. For each grant type below, request it at its default and confirm the default.
2. Request it one minute above its maximum and confirm refusal.
3. Attempt to request it with no expiry at all (omit the duration, or send `null`).

| Grant type                              | Expected default | Expected maximum               |
| --------------------------------------- | ---------------- | ------------------------------ |
| Write (break-glass), one workspace      | 30 minutes       | 240 minutes                    |
| Read (monitoring), one workspace        | 7 days           | 30 days                        |
| Coverage, every workspace (operational) | 1 day            | 7 days                         |
| Standing CRM monitoring                 | 90 days          | _(bounded — record the value)_ |

**Expected Result**

- Each default and maximum matches the table.
- **No path anywhere creates an authorisation that does not expire.** An "unlimited" or "never expires" option appearing in the UI is a P0 defect.
- Note the design reason, so the asymmetry does not look like a bug: a write grant is held for the length of a repair, a monitoring authorisation for the length of an engagement, and **coverage across every workspace is deliberately shorter than a single-workspace authorisation**, not longer.

**Negative Scenarios** — Any attempt to create a non-expiring grant, by UI or API, must be refused. Record the exact response.

**Evidence** — The accepted and refused values for each of the four types, with status codes.

---

## PLAT-PLAN-001 — Create a subscription plan and its modules

|                     |                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                           |
| **User Role**       | Platform Owner                                                                                     |
| **Feature**         | Subscription plans                                                                                 |
| **Test Scenario**   | A plan defines which modules and limits a workspace on it receives                                 |
| **Priority**        | P1                                                                                                 |
| **Preconditions**   | Signed in as platform owner                                                                        |
| **Test Data**       | Code `qa-leadeagle`; name `QA Lead Eagle`; modules **Lead Eagle** only; seats `10`; storage `1024` |
| **Navigation Path** | `/platform/plans`                                                                                  |
| **Code Reference**  | `src/app/(platform)/platform/plans/page.tsx`, `src/lib/modules/catalogue.ts`                       |

**Test Steps**

1. Navigate to `/platform/plans`. Confirm the heading **Subscription plans**.
2. Confirm the five seeded plans are listed: `hrms`, `sales`, `business`, `realestate`, `enterprise`, with the modules each includes.
3. Confirm **none** of them includes Lead Eagle. _(This is the gap recorded in [12](12-coverage-and-gaps.md).)_
4. Create a new plan with the test data. Tick **only** **Lead Eagle** in its modules.
5. Save, and confirm the plan appears with Lead Eagle as its only module.
6. Navigate to `/platform/workspaces/new`. Confirm `QA Lead Eagle` is offered in the **Plan** dropdown.

**Expected Result**

- All four modules are offered when defining a plan, including Lead Eagle. _(A module present in the schema but missing from this form was a real past defect: the entire Real Estate module was unreachable in production despite being deployed, because the checkbox simply was not there.)_
- The plan saves with exactly the ticked modules.
- The new plan is immediately selectable when provisioning a workspace.

**Negative Scenarios**

| What to try                               | Expected                     |
| ----------------------------------------- | ---------------------------- |
| Reuse the code `business`                 | Refused (the code is unique) |
| Zero seats, or negative storage           | Refused                      |
| A plan with no modules at all             | Record the behaviour         |
| A module key not in the catalogue, by API | 422                          |

**Evidence** — Screenshot of the plans list, including the absence of Lead Eagle among the seeded plans.

---

## PLAT-SUB-001 — Move a workspace between plans, and cancel

|                     |                                                                          |
| ------------------- | ------------------------------------------------------------------------ |
| **Module**          | Platform                                                                 |
| **User Role**       | Platform Owner                                                           |
| **Feature**         | Subscriptions                                                            |
| **Test Scenario**   | A plan change changes entitlement; a cancellation removes it             |
| **Priority**        | P0                                                                       |
| **Preconditions**   | `QA Brokerage One` exists. A user of it is signed in in a second browser |
| **Navigation Path** | `/platform/subscriptions`, `/platform/workspaces/{workspaceId}`          |
| **Code Reference**  | `src/lib/security/entitlements.ts`                                       |

**Test Steps**

1. Note `QA Brokerage One`'s current plan and modules.
2. Move it to the `hrms` plan.
3. In the workspace browser, navigate to a Sales screen.
4. Confirm the refusal panel, or a redirect to a carrying product.
5. Confirm the People section still works.
6. Cancel the subscription outright.
7. In the workspace browser, reload. Record whether the user can still sign in, and what they can reach.
8. Call `GET /api/v1/leads` from that session. Record the status.
9. Restore the original plan. Confirm access returns.

**Expected Result**

- Entitlement follows the plan on the workspace's next request, and never lags more than 60 seconds.
- A cancelled subscription removes module access. Whether the user can still sign in is a product decision — record what happens; a sign-in that works but reaches nothing is acceptable, a sign-in that reaches a module the workspace no longer pays for is a **P0 defect**.
- `GET /api/v1/leads` returns **403**, not 200 with an empty list.

**Negative Scenarios** — see `TEN-ENT-001`…`TEN-ENT-004` in [07](07-tenancy-authz.md), which test enforcement from the workspace side by URL and API.

**Evidence** — Status code from step 8; timestamps.

---

## PLAT-USER-001 — Platform users and their roles

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Platform                                                                                                                             |
| **User Role**       | Platform Owner                                                                                                                       |
| **Feature**         | Platform staff identities                                                                                                            |
| **Test Scenario**   | Each platform role grants exactly what [02](02-roles-and-personas.md) §2.7 says                                                      |
| **Priority**        | P0                                                                                                                                   |
| **Preconditions**   | Signed in as platform owner                                                                                                          |
| **Test Data**       | T20 `qa.support@example.com` as `SUPPORT`; T21 `qa.auditor@example.com` as `SECURITY_AUDITOR`; one `qa.nobody@example.com` as `USER` |
| **Navigation Path** | `/platform/users`                                                                                                                    |
| **Code Reference**  | `prisma/schema.prisma` (`enum PlatformRole`), `src/lib/auth/platform-access.ts`, `src/app/no-platform-access/page.tsx`               |

**Test Steps**

1. Navigate to `/platform/users`. Confirm the heading **Platform users**.
2. Create T20 as `SUPPORT`, T21 as `SECURITY_AUDITOR`, and one account as `USER`.
3. Sign in as each in a private window, one at a time.
4. For `SUPPORT` and `SECURITY_AUDITOR`: confirm `/platform` opens; attempt a write in a customer workspace; attempt to take break-glass write access.
5. For `USER`: confirm you land on `/no-platform-access` and that `/platform` is not reachable by URL.
6. Create an `AI_SERVICE` identity from `/platform/identity`. Confirm it is credential-only — there must be **no way to set a password for it and sign in as a person**.
7. Attempt to change an existing `AI_SERVICE` identity's role to `OWNER`.

**Expected Result**

| Role               | `/platform`                    | Read a workspace | Write in a workspace   | Elevate   |
| ------------------ | ------------------------------ | ---------------- | ---------------------- | --------- |
| `OWNER`            | yes                            | yes              | only with a live grant | yes       |
| `SUPPORT`          | yes                            | yes              | no                     | **no**    |
| `SECURITY_AUDITOR` | yes                            | yes              | no                     | **no**    |
| `AI_SERVICE`       | no interactive session         | yes (machine)    | no                     | **never** |
| `USER`             | **no** → `/no-platform-access` | no               | no                     | no        |

- An `AI_SERVICE` identity authenticates **only** with a rotatable credential, through `/service-login`. It is read-only by construction, not by configuration.
- Promoting an `AI_SERVICE` identity to a role that can write is a **P0 defect** if it succeeds.

**Negative Scenarios**

| What to try                                                 | Expected                                      |
| ----------------------------------------------------------- | --------------------------------------------- |
| `SUPPORT` opening `/platform/users` and creating an `OWNER` | Refused                                       |
| 11 `/service-login` attempts for one username in 15 minutes | The 11th is 429                               |
| A workspace user's email used as a platform user            | Record — the two identity spaces are separate |

**Evidence** — The landing URL for each role; the status of every refused action.

---

## PLAT-AI-001 — AI usage visibility and cost control

|                     |                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                                  |
| **User Role**       | Platform Owner                                                                                                            |
| **Feature**         | AI Control Center                                                                                                         |
| **Test Scenario**   | AI consumption is visible per workspace and per user, and a limit can be set                                              |
| **Priority**        | P1                                                                                                                        |
| **Preconditions**   | Signed in as platform owner. At least one AI action has run in a workspace (see `SALES-AI-001`), or the screens show zero |
| **Navigation Path** | `/platform/ai-control` → `/platform/ai-control/workspaces` → a workspace → a user                                         |
| **Code Reference**  | `src/app/(platform)/platform/ai-control/`, `/platform/ai-usage`                                                           |

**Test Steps**

1. Navigate to `/platform/ai-control`. Confirm the heading **AI Control Center**.
2. Navigate to `/platform/ai-control/workspaces`. Confirm **AI usage by workspace** lists each workspace with its consumption.
3. Open one workspace. Confirm **Workspace AI usage**.
4. Open one user within it. Confirm **User AI usage and token settings**.
5. Set a token limit for that user. Save.
6. Navigate to `/platform/ai-usage`. Confirm platform-wide **AI usage** and cost.
7. In the workspace, sign in as that user and trigger an AI action beyond the limit you set.

**Expected Result**

- Usage is attributable to a workspace **and** to a user, not only in aggregate.
- A limit set here is enforced in the workspace: the AI action is refused with a message naming the limit, and the underlying business action (the call, the lead) is **not** damaged.
- Zero usage renders as zero, not as a broken page.

**Negative Scenarios**

| What to try                                   | Expected                                                      |
| --------------------------------------------- | ------------------------------------------------------------- |
| A negative token limit                        | Refused                                                       |
| A limit of zero                               | AI is effectively disabled for that user; the refusal says so |
| A workspace user opening `/platform/ai-usage` | Refused (`TEN-PLAT-001`)                                      |

**Evidence** — Screenshots of all four AI screens; the refusal the limited user receives.

---

## PLAT-AUDIT-001 — Platform audit trail

|                     |                                                                                  |
| ------------------- | -------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                         |
| **User Role**       | Platform Owner, then `SECURITY_AUDITOR`                                          |
| **Feature**         | Platform audit                                                                   |
| **Test Scenario**   | Platform-level actions are recorded, attributable, and readable by an auditor    |
| **Priority**        | P0                                                                               |
| **Preconditions**   | `PLAT-WS-001`, `PLAT-WS-002` and `PLAT-BG-001` have been run in this environment |
| **Navigation Path** | `/platform/audit`                                                                |
| **Code Reference**  | `src/app/(platform)/platform/audit/page.tsx`, `src/lib/security/audit.ts`        |

**Test Steps**

1. Navigate to `/platform/audit`. Confirm the heading **Platform audit**.
2. Find the entry for the workspace you created in `PLAT-WS-001`.
3. Find the entry for the module change in `PLAT-WS-002`.
4. Find the entry for the break-glass grant in `PLAT-BG-001`, and confirm it records **the reason**.
5. Confirm each entry names **who** acted, **when**, and **what changed**.
6. Sign in as T21 (`SECURITY_AUDITOR`) and confirm the same entries are readable.
7. As T21, attempt to delete or edit an audit entry.

**Expected Result**

- Every provisioning, entitlement and elevation action appears.
- The break-glass entry's mode matches what the session could actually do. A row claiming read-only for a session that could write is a **P0 defect** — this exact mismatch is the historical bug the control was built to fix.
- An auditor can read and cannot change. Audit entries are append-only.

**Negative Scenarios** — Any successful edit or deletion of an audit entry, by any role, is a P0 defect.

**Evidence** — Screenshots of the three entries, with the actor and timestamp legible.

---

## PLAT-HEALTH-001 — System health and metrics

|                     |                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                            |
| **User Role**       | Platform Owner                                                                                                      |
| **Feature**         | System health                                                                                                       |
| **Test Scenario**   | Health reflects the real state of the database, Redis and the queues                                                |
| **Priority**        | P1                                                                                                                  |
| **Preconditions**   | Signed in as platform owner. The worker process is running                                                          |
| **Navigation Path** | `/platform/system-health`, plus `/api/health` and `/api/metrics`                                                    |
| **Code Reference**  | `src/app/(platform)/platform/system-health/page.tsx`, `src/app/api/health/route.ts`, `src/app/api/metrics/route.ts` |

**Test Steps**

1. Navigate to `/platform/system-health`. Confirm the heading **System health** and that each dependency reports healthy.
2. Open `/api/health` in the browser. Note the response.
3. Open `/api/health/live`. Note the response.
4. Open `/api/metrics`. Confirm metrics are returned.
5. Stop the worker process (`Ctrl-C` in its terminal).
6. Reload `/platform/system-health`. Record what changes.
7. Restart the worker. Reload. Confirm it recovers.

**Expected Result**

- `/api/health` reports on real dependencies, not a hard-coded OK.
- `/api/health/live` is a liveness check and answers even when a dependency is unwell.
- `/api/metrics` collects at scrape time, with a timeout, so a slow dependency does not hang the scrape.
- With the worker stopped, health reflects it. **If health still reports everything healthy with no worker attached, record it as a defect** — it is the difference between a diagnosable Blocked result and a mystery.

**Negative Scenarios**

| What to try                                   | Expected                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/api/metrics` unauthenticated from outside   | Record the behaviour; metrics should not be world-readable in a deployed environment |
| `/platform/system-health` as a workspace user | Refused (`TEN-PLAT-001`)                                                             |

**Evidence** — The health response before and after stopping the worker.

---

## PLAT-SET-001 — Platform settings and the self-serve sign-up offer

|                     |                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform                                                                                                                                        |
| **User Role**       | Platform Owner                                                                                                                                  |
| **Feature**         | Platform settings; trial sign-up                                                                                                                |
| **Test Scenario**   | The sign-up offer on `/login` appears only while the platform owner keeps it open, and never inside the iOS app                                 |
| **Priority**        | P1                                                                                                                                              |
| **Preconditions**   | Signed in as platform owner                                                                                                                     |
| **Navigation Path** | `/platform/settings`, then `/login` in a private window                                                                                         |
| **Code Reference**  | `src/app/(platform)/platform/settings/page.tsx`, `src/services/platform/signup.ts`, `src/app/(auth)/login/page.tsx`, `src/lib/mobile/iosApp.ts` |

**Test Steps**

1. Navigate to `/platform/settings`.
2. Find the self-serve sign-up offer and note its trial length in days.
3. Enable it with a trial of `14` days. Save.
4. Open `/login` in a private window. Confirm the text **New here?** followed by **Start a 14-day free trial** linking to `/signup`.
5. Open `/login?product=lead-eagle`. Confirm the link instead reads **Start your Lead Eagle trial**.
6. Disable the offer. Save.
7. Reload `/login`. Confirm **no** sign-up offer appears.
8. Re-enable it. Navigate to `/signup`, complete the form, and follow the confirmation to `/signup/confirm`.

**Expected Result**

- With the offer off, `/login` shows no trial link at all.
- With it on, the link text uses the configured number of days.
- Under `?product=lead-eagle`, the whole page is Lead Eagle's: the title reads **Sign in to Lead Eagle**, and the offer is phrased for Lead Eagle. It is the same form, endpoint, accounts and session — only the name changes.
- The offer is **never** shown inside the iOS app (App Store rule 3.1.1). If you can run the iOS build, verify it; otherwise mark that step **Needs UI Verification**.

**Negative Scenarios**

| What to try                                          | Expected                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| A trial of 0 or negative days                        | Refused, or treated as off — record which                                     |
| `/signup` by URL while the offer is disabled         | Refused or redirected. A reachable sign-up while the offer is off is a defect |
| Signing up with an email that already has an account | Refused without revealing whether the account exists                          |

**Evidence** — Screenshots of `/login` with the offer on, off, and under `?product=lead-eagle`.
