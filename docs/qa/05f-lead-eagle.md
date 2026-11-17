# Section 5f — Lead Eagle

Lead Eagle is **the lead-management product for brokerages**: leads,
follow-ups, calls, assignment, projects and listings. The money and marketing
registers — collections, commissions, proposals, portals, events — are **not**
part of it; they are `SALES_OR_REALTY`.

### Three things to know before you start

1. **No seeded workspace is entitled to Lead Eagle, and no seeded plan includes
   it.** You must provision both. `LE-SETUP-001` does this.
2. **There is no Lead-Eagle-specific role.** The four Lead Eagle personas are
   the ordinary seeded roles inside a Lead-Eagle-only workspace. See
   [02](02-roles-and-personas.md) §2.5.1 — this is marked **Needs UI
   Verification** and is a gap in [12](12-coverage-and-gaps.md).
3. **The Lead Eagle section only appears when the workspace does _not_ hold Real
   Estate.** With both, Real Estate carries the same screens and the Lead Eagle
   navigation is hidden. `LE-NAV-002`.

Accounts, once `LE-SETUP-001` is done:

| Shorthand          | Account       | Role in the LE workspace      |
| ------------------ | ------------- | ----------------------------- |
| **LE Admin**       | T18           | `org_admin`                   |
| **LE Manager**     | a new account | `branch_manager`              |
| **LE Team Leader** | a new account | `team_manager`                |
| **LE Agent**       | T19           | `sales_rep`                   |
| **LE Telecaller**  | a new account | `Telecaller` (built per §2.6) |
| **LE Viewer**      | a new account | `read_only`                   |

---

## LE-SETUP-001 — Provision a Lead-Eagle-only workspace

|                     |                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Platform / Lead Eagle                                                                                                               |
| **User Role**       | Platform Owner                                                                                                                      |
| **Feature**         | Lead Eagle entitlement                                                                                                              |
| **Test Scenario**   | A workspace is created entitled to Lead Eagle and nothing else, with its own roles and users                                        |
| **Priority**        | **P0**                                                                                                                              |
| **Preconditions**   | Signed in as platform owner. `PLAT-PLAN-001` has created a plan including **Lead Eagle** (no seeded plan does)                      |
| **Test Data**       | Workspace `QA Lead Eagle Co`, slug `qa-lead-eagle`, plan `QA Lead Eagle` (Lead Eagle only), administrator `qa.le.admin@example.com` |
| **Navigation Path** | `/platform/plans` → `/platform/workspaces/new`                                                                                      |
| **Code Reference**  | `src/lib/modules/catalogue.ts`, `prisma/seed/index.ts` (the five seeded plans), `src/lib/security/entitlements.ts`                  |

**Test Steps**

1. Sign in as the platform owner.
2. Open `/platform/plans`. **Confirm that none of the five seeded plans (`hrms`, `sales`, `business`, `realestate`, `enterprise`) includes Lead Eagle.** Record this.
3. Create the plan `QA Lead Eagle` with **only** Lead Eagle ticked, if `PLAT-PLAN-001` has not already.
4. Provision `QA Lead Eagle Co` on that plan, ticking **only** **Lead Eagle** in Modules, with T18 as its administrator.
5. Confirm the workspace detail page lists **Lead Eagle** as its only module.
6. Sign in as T18 in a private window.
7. **Confirm you land on `/qa-lead-eagle/lead-eagle/dashboard`, not on `/qa-lead-eagle/dashboard`.**
8. Create the five further accounts from the table above, using **Administration → Settings → Users → add a user**.
9. Build the `Telecaller` role in this workspace too (it is per workspace) — see [02](02-roles-and-personas.md) §2.6.
10. Create at least two leads so there is data to work with.

**Expected Result**

- Lead Eagle is offered when defining a plan and when provisioning a workspace. If the checkbox is missing, the entire module is unreachable for every customer — exactly the failure that once made Real Estate unreachable in production despite being deployed.
- Step 7: **a workspace whose only usable product is Lead Eagle lands on the Lead Eagle board.** This is decided by the plan, not by the person — so a user whose role lacks `leads` lands there and meets the board's own refusal, then uses the menu. That is correct.
- The workspace is empty of demo data.

**Negative Scenarios**

| What to try                                   | Expected                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Provision with Lead Eagle **and** Real Estate | Allowed, but the Lead Eagle navigation then disappears — `LE-NAV-002`                                                    |
| Provision with Lead Eagle and HRMS            | Allowed; landing is `/{slug}/dashboard`, **not** the Lead Eagle board, because Lead Eagle is not the only usable product |

**Evidence** — The plans list showing no seeded Lead Eagle plan; the workspace's module list; **the landing URL from step 7**.

---

## LE-AUTH-001 — The Lead Eagle sign-in door

|                     |                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Lead Eagle                                                                                                                                                                         |
| **User Role**       | LE Agent                                                                                                                                                                           |
| **Feature**         | `?product=lead-eagle`                                                                                                                                                              |
| **Test Scenario**   | Lead Eagle's own door is the same form, endpoint, accounts and session under Lead Eagle's name                                                                                     |
| **Priority**        | P1                                                                                                                                                                                 |
| **Preconditions**   | `LE-SETUP-001` is done. T19 exists in `qa-lead-eagle`                                                                                                                              |
| **Navigation Path** | `/login?product=lead-eagle`                                                                                                                                                        |
| **Code Reference**  | `src/app/(auth)/login/page.tsx`, `src/components/auth/BrandHero.tsx`, `src/lib/security/redirect.ts` (`LEAD_EAGLE_LOGIN`), `src/lib/security/entitlements.ts` (`workspaceLanding`) |

**Test Steps**

1. Open `/login?product=lead-eagle` in a private window.
2. Confirm the browser tab title reads **Sign in to Lead Eagle** (the plain door reads **Sign in**).
3. Confirm the brand panel shows **Lead Eagle** as the product name and its description: _"Lead management for brokerages: leads, follow-ups, calls, assignment, projects and listings."_
4. Confirm the form heading is still **Welcome back**, and the lede now reads **Sign in to Lead Eagle with your YOUHAN ONE account.**
5. Confirm the fields are the same **Email** and **Password**, with the same **Forgot password?** link and the same **Sign in** button.
6. If the platform's self-serve sign-up offer is on, confirm the link reads **Start your Lead Eagle trial** rather than **Start a {n}-day free trial**.
7. Sign in as T19.
8. Confirm you land on `/qa-lead-eagle/lead-eagle/dashboard`.
9. Sign out. Open the **plain** `/login` and sign in as the same T19.
10. Confirm you land in exactly the same place.
11. Sign in as `admin@manathhomes.ae` (a workspace **without** Lead Eagle) through `/login?product=lead-eagle`.
12. Confirm they land on their own workspace's dashboard, not on a Lead Eagle board and not on a refusal.
13. While signed out, navigate to `/qa-lead-eagle/lead-eagle/leads`.
14. Confirm you are sent to sign in, and **confirm which door** you are sent to.

**Expected Result**

- `?product=lead-eagle` changes the **name and the brand copy only**. The form, the endpoint, the accounts and the session are identical. A separate account space for Lead Eagle would be a defect.
- A Lead-Eagle-only workspace lands on its board **either way** — the landing is decided by the plan, not by which door was used.
- A workspace without Lead Eagle is unaffected by the parameter.
- Step 14: a signed-out visitor sent away from a `/{slug}/lead-eagle/...` path is returned to **Lead Eagle's door** (`/login?product=lead-eagle`), not the plain one. That is what `redirect.ts` decides from the path.

**Negative Scenarios**

| What to try                                | Expected                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `/login?product=nonsense`                  | The plain door; the parameter is ignored                                                                                |
| `/login?product=LEAD-EAGLE` (wrong case)   | The plain door — the comparison is exact                                                                                |
| A wrong password at the Lead Eagle door    | The same refusal as the plain door, and the same rate limits (5 / 5 min per account)                                    |
| `/login?product=lead-eagle&next=/platform` | After signing in, **not** sent to `/platform`. `next` is only a request; the form checks it against the server's answer |

**Evidence** — Screenshots of both doors side by side; the landing URL from steps 8, 10 and 12; the door you were sent to in step 14.

---

## LE-NAV-001 — The Lead Eagle navigation

|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Module**          | Lead Eagle                                                                                  |
| **User Role**       | LE Admin                                                                                    |
| **Feature**         | Navigation                                                                                  |
| **Test Scenario**   | The Lead Eagle workspace shows exactly its own areas, and nothing from Sales or Real Estate |
| **Priority**        | P1                                                                                          |
| **Preconditions**   | `LE-SETUP-001` is done. Signed in as T18                                                    |
| **Navigation Path** | the sidebar of `qa-lead-eagle`                                                              |
| **Code Reference**  | `src/lib/nav/workspaceNav.ts`                                                               |

**Test Steps**

1. Sign in as T18.
2. Write down every section, area and tab in the sidebar.
3. Compare against this, which is the model rendered for a Lead-Eagle-only workspace with every permission:

| Section            | Areas                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**           | My Workspace (Workspace Summary, Check-in, Attendance, Attendance Requests, Face Activity); Inbox                                                                                                                                                 |
| **CRM**            | Activities (My Tasks) — **only** this one tab                                                                                                                                                                                                     |
| **Lead Eagle**     | Dashboard; Leads (Leads, Follow-ups, Tasks, Calls, Playbook, Site Visits, Requirements, Allocation, QR Capture, Cold Data); Calendar; Lead Sources (Forms, Landing Pages); Inventory (Properties, Projects, Listings); Reports (Reports, Targets) |
| **Administration** | Settings (Workspace, Company, Modules, Subscription, Security Policy, Data Retention, Lead Stages, Sources, Custom Fields, Email Templates, Users, Teams, Roles, Work Locations, Holidays, Integrations, Automation, Audit Log)                   |
| **Account**        | My Account (Security, Role & Access, Appearance, Notifications)                                                                                                                                                                                   |

4. Confirm there is **no** Properties section, **no** Marketing section, **no** People section, **no** Finance section and **no** Insights section.
5. Confirm the Lead Eagle Leads area has **no Proposals tab** (Real Estate's does).
6. Confirm the Lead Eagle Inventory area has **no Portals tab** and **no Off-Plan tab**.
7. Confirm the Lead Eagle Reports area has **no Events tab**, **no Collections tab** and **no Commissions tab**.
8. Confirm **Check-in** appears under **Home → My Workspace** — not under People, which does not exist here.
9. Confirm **Work Locations** and **Holidays** appear under **Administration → Settings**, not under People.
10. Confirm **Automation** under Administration points at `/qa-lead-eagle/lead-eagle/automation`, not at a `/sales/` path.

**Expected Result**

- The navigation matches the table exactly.
- **Check-in, Work Locations and Holidays are reachable without HRMS** — they are self-service or `employee:EDIT`-gated, not module-gated. A Lead Eagle brokerage must be able to clock its agents in. See [05d](05d-people.md) `HR-NOHRMS-001`.
- The absent tabs are absent because they belong to `SALES_OR_REALTY`, not because of a navigation bug.

**Negative Scenarios** — For **every** tab you listed as absent in steps 4–7, navigate to its `/lead-eagle/...`, `/sales/...` and `/realty/...` URL and record the result. See `LE-ENT-001`.

**Evidence** — The full sidebar as a screenshot and as a written list, compared against the table.

---

## LE-NAV-002 — Lead Eagle disappears when Real Estate is present

|                     |                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Module**          | Lead Eagle                                                                                                 |
| **User Role**       | Company Admin                                                                                              |
| **Feature**         | `unlessModule`                                                                                             |
| **Test Scenario**   | With both Lead Eagle and Real Estate, Real Estate carries the screens and the Lead Eagle section is hidden |
| **Priority**        | P1                                                                                                         |
| **Preconditions**   | A workspace you can change the modules of. Start with Lead Eagle only                                      |
| **Navigation Path** | the sidebar, before and after                                                                              |
| **Code Reference**  | `src/lib/nav/workspaceNav.ts` (`unlessModule`), `src/lib/nav/realtyShared.ts` (`sameScreenElsewhere`)      |

**Test Steps**

1. In `qa-lead-eagle`, confirm the **Lead Eagle** section is present.
2. As the platform owner, add **Real Estate** to that workspace's modules.
3. In the workspace, navigate so the layout re-renders.
4. Confirm a **Real Estate** section has appeared.
5. **Confirm the Lead Eagle section has disappeared.**
6. Navigate directly to `/qa-lead-eagle/lead-eagle/leads`.
7. Record what happens.
8. As the platform owner, remove Real Estate again.
9. Confirm the Lead Eagle section returns.

**Expected Result**

- Step 5: the Lead Eagle section is **hidden**, because Real Estate carries the same screens and the product offers each screen once, not twice.
- Step 6: the URL still **works** — the entitlement is still held, and the layout's gate passes. Hiding the nav is presentation. Record exactly what you see; if it refuses, that is a defect in the opposite direction.
- The behaviour is symmetrical when Real Estate is removed.

**Negative Scenarios**

| What to try                         | Expected                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lead Eagle + SALES (no Real Estate) | Record which section carries Leads. Sales and Lead Eagle both carry them; the nav must not show both |
| All four modules                    | No Lead Eagle section at all (`ADMIN-AUTH-001` step 6)                                               |

**Evidence** — The sidebar before and after, and the result of step 6.

---

## LE-ENT-001 — A Lead Eagle workspace cannot reach Sales-only or Real-Estate-only screens

|                    |                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Lead Eagle / entitlement                                                                                                |
| **User Role**      | LE Admin                                                                                                                |
| **Feature**        | Entitlement enforcement                                                                                                 |
| **Test Scenario**  | Every screen outside Lead Eagle's own entitlement groups is refused, by URL and by API                                  |
| **Priority**       | **P0**                                                                                                                  |
| **Preconditions**  | `qa-lead-eagle` holds **Lead Eagle only**. Signed in as T18, who holds `*:*` — so **only entitlement can refuse these** |
| **Code Reference** | `src/lib/security/entitlements.ts`, `src/components/workspace/NotInPlan.tsx`, each route's `productModule`              |

**Test Steps**

1. Sign in as T18 in `qa-lead-eagle`.
2. For each URL below, navigate to it and record exactly what you see:

| URL                                  | Expected                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `/qa-lead-eagle/sales/campaigns`     | Refused: _"Campaigns is part of Sales."_                                                 |
| `/qa-lead-eagle/sales/opportunities` | Refused (SALES)                                                                          |
| `/qa-lead-eagle/sales/contacts`      | Refused (SALES)                                                                          |
| `/qa-lead-eagle/sales/accounts`      | Refused (SALES)                                                                          |
| `/qa-lead-eagle/sales/collections`   | Refused: part of **Sales or Real Estate**                                                |
| `/qa-lead-eagle/sales/commissions`   | Refused: part of **Sales or Real Estate**                                                |
| `/qa-lead-eagle/sales/events`        | Refused: part of **Sales or Real Estate**                                                |
| `/qa-lead-eagle/sales/proposals`     | Refused: part of **Sales or Real Estate**                                                |
| `/qa-lead-eagle/sales/portals`       | Refused: part of **Sales or Real Estate**                                                |
| `/qa-lead-eagle/realty/dashboard`    | Refused (REAL_ESTATE)                                                                    |
| `/qa-lead-eagle/people/employees`    | Refused (HRMS)                                                                           |
| `/qa-lead-eagle/people/payroll`      | Refused (HRMS)                                                                           |
| `/qa-lead-eagle/sales/leads`         | **Redirected** to `/qa-lead-eagle/lead-eagle/leads` — Lead Eagle carries the same screen |
| `/qa-lead-eagle/check-in`            | **Works** — self-service, no module gate                                                 |
| `/qa-lead-eagle/tasks`               | **Works**                                                                                |
| `/qa-lead-eagle/notifications`       | **Works**                                                                                |

3. For each refusal, confirm the panel's wording: **"{Screen} is part of {products}. This workspace's plan does not include it."** followed, because T18 holds `settings:MANAGE_CONFIGURATION`, by **"The plan is set by your platform provider: ask them to add {products}."**
4. Confirm each refusal offers **Back to the dashboard**.
5. Confirm each refusal names **every** product that carries the screen, not just one.
6. For each of these API endpoints, send a request from T18's session and record the status and body:

| Endpoint                           | Expected                                 |
| ---------------------------------- | ---------------------------------------- |
| `GET /api/v1/leads`                | 200 — `LEAD_MODULES` includes Lead Eagle |
| `GET /api/v1/calls`                | 200                                      |
| `GET /api/v1/site-visits`          | 200                                      |
| `GET /api/v1/listings`             | 200                                      |
| `GET /api/v1/projects`             | 200                                      |
| `GET /api/v1/collections/receipts` | **403**, naming Sales or Real Estate     |
| `GET /api/v1/commissions`          | **403**                                  |
| `GET /api/v1/events`               | **403**                                  |
| `GET /api/v1/proposals`            | **403**                                  |
| `POST /api/v1/bookings`            | **403**, naming **Sales** only           |
| `GET /api/v1/payouts`              | **403**, naming **Sales** only           |
| `GET /api/v1/campaigns`            | **403**                                  |

**Expected Result**

- Every refusal is the friendly entitlement panel, **not** an error page and **not** a silent redirect to the dashboard. _(The layouts once sent the viewer to the dashboard without a word, so a Lead Eagle administrator opening Events could not tell a missing product from a broken link.)_
- The refusal **names every carrying product**. _(It used to pass on only the last one checked, so a Lead-Eagle-only workspace asking for Events was told "Real Estate is not enabled for this company" — naming a product that was not the only answer.)_
- A screen the plan **does** carry under another folder sends the viewer there instead of refusing.
- T18 holds every permission, so **anything refused here is refused by entitlement alone**. That is what makes this case a clean entitlement test.
- The page beneath the refusal is still rendered by the framework (unseen), so **each page also asserts its own module** — which is why the API checks in step 6 must be run too.

**Negative Scenarios**

| What to try                                             | Expected                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Any of the 403 endpoints with a valid `Idempotency-Key` | Still 403; entitlement is checked before the body          |
| Any of them repeatedly for a minute                     | Still 403 — the entitlement cache must not let one through |
| The same endpoints after the platform adds SALES        | 200, within 60 seconds                                     |

**Evidence** — A table: URL or endpoint | what happened | exact wording or status. This table is the deliverable for this case.

---

## LE-LEAD-001 — The full Lead Eagle lead workflow

|                     |                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Module**          | Lead Eagle                                                                                                  |
| **User Role**       | LE Agent (T19)                                                                                              |
| **Feature**         | Leads, follow-ups, calls, site visits, requirements                                                         |
| **Test Scenario**   | An agent works a lead end to end inside Lead Eagle                                                          |
| **Priority**        | P0                                                                                                          |
| **Preconditions**   | `LE-SETUP-001` is done. T19 is `sales_rep` with `leads:VIEW/CREATE/EDIT @ OWN`                              |
| **Test Data**       | As [04](04-environment-and-data.md) §4.8                                                                    |
| **Navigation Path** | **Lead Eagle → Leads** (`/qa-lead-eagle/lead-eagle/leads`)                                                  |
| **Code Reference**  | The Lead Eagle routes re-export the `sales/` pages; see `src/lib/security/entitlements.ts` (`LEAD_MODULES`) |

**Test Steps**

1. Sign in as T19. Confirm you land on `/qa-lead-eagle/lead-eagle/dashboard`.
2. Open **Lead Eagle → Leads**. Confirm the tabs: **Leads**, **Follow-ups**, **Tasks**, **Calls**, **Playbook**, **Site Visits**, **Requirements**, **Allocation**, **QR Capture**, **Cold Data**.
3. Create a lead. **Follow `SALES-LEAD-001` steps 9–35 exactly** — the form, its validation, its required field and its labels are the same code.
4. Confirm the created lead's URL is under `/lead-eagle/`, not `/sales/`.
5. Open the lead. Create a follow-up (as `SALES-FU-001`).
6. Create a call against the lead and complete it with an outcome (as `SALES-CALL-001`).
7. Confirm the call appears under **Lead Eagle → Leads → Calls**.
8. Open **Playbook** and confirm it loads (`calls` grant).
9. Create a site visit (as `RE-VISIT-001` steps 1–5).
10. Create a requirement (as `RE-REQ-001` steps 1–4).
11. Attempt to create a **proposal** from that requirement.
12. Open **Lead Eagle → Reports → Reports**. Confirm it loads.
13. Open **Lead Eagle → Reports → Targets**. Confirm T19's own targets.
14. Open **Lead Eagle → Inventory → Projects** and **Listings**. Record what T19 can do (`sales_rep` holds no `projects` or `listings` grant by default).
15. Open **Cold Data** and **QR Capture**.
16. Attempt to open `/qa-lead-eagle/lead-eagle/allocation` as T19.

**Expected Result**

- Every lead action behaves exactly as in Sales, because it is the same code. **Any behavioural difference between `/sales/leads` and `/lead-eagle/leads` for the same role is a defect**, with one exception: the URLs.
- Step 11: **refused** — proposals are `SALES_OR_REALTY`, and this workspace has neither.
- Step 14: T19 sees the tabs only if their role grants `projects` / `listings`; by default `sales_rep` does not, so expect a refusal. Confirm against the role's actual grants.
- Step 16: refused — `allocation` is not in `sales_rep`'s grants.

**Negative Scenarios** — Every negative in `SALES-LEAD-001`, re-run against the `/lead-eagle/` URL. Confirm the behaviour is identical.

**Evidence** — The created lead's URL; the call and follow-up; the refusal from step 11; the result of steps 14 and 16.

---

## LE-ROLE-001 — The four Lead Eagle personas

|                    |                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Lead Eagle                                                                                                                  |
| **User Role**      | LE Manager, LE Team Leader, LE Agent, LE Telecaller, LE Viewer                                                              |
| **Feature**        | Role scope inside Lead Eagle                                                                                                |
| **Test Scenario**  | Each persona sees and does exactly what its underlying role allows                                                          |
| **Priority**       | P0                                                                                                                          |
| **Preconditions**  | `LE-SETUP-001` is done, with all six accounts created, a team built (as `ADMIN-TEAM-001`) and leads owned by several agents |
| **Code Reference** | `prisma/seed/roles.ts`; [02](02-roles-and-personas.md) §2.5.1                                                               |

**Test Steps**

1. Build a team in `qa-lead-eagle`: the LE Team Leader manages the LE Agent and the LE Telecaller.
2. Give the LE Manager a branch, and put all three in it.
3. Create at least two leads owned by each of the LE Agent and the LE Telecaller, and one owned by a fourth agent in a **different** branch.
4. For each of the five personas in turn, sign in and record:
   - every section, area and tab in the sidebar;
   - the number of leads on **Lead Eagle → Leads**, and whose they are;
   - whether **Add lead** is offered;
   - whether an owned lead can be edited;
   - whether another persona's lead can be opened by URL (record the status);
   - whether **Allocation** is reachable;
   - whether **Reports** is reachable;
   - whether any export is offered.

**Expected Result**

| Persona        | Role             | Leads visible            | Create | Edit     | Assign | Allocation                    | Reports     | Export |
| -------------- | ---------------- | ------------------------ | ------ | -------- | ------ | ----------------------------- | ----------- | ------ |
| LE Manager     | `branch_manager` | whole branch             | yes    | yes      | yes    | no (`allocation` not granted) | yes @BRANCH | yes    |
| LE Team Leader | `team_manager`   | own team and descendants | yes    | yes      | yes    | no                            | yes @TEAM   | **no** |
| LE Agent       | `sales_rep`      | own only                 | yes    | own only | **no** | no                            | yes @OWN    | **no** |
| LE Telecaller  | `Telecaller`     | own only                 | **no** | own only | no     | no                            | **no**      | **no** |
| LE Viewer      | `read_only`      | own team                 | **no** | **no**   | no     | no                            | yes @TEAM   | **no** |

- Opening another persona's lead by URL returns **404** wherever it is out of scope.
- **Allocation** needs `allocation:VIEW`, which none of the five seeded roles above carries — only `super_admin`, `org_admin`, and `sales_director` (via `distribution`). So the Allocation tab should be absent for all five. Record this: a brokerage wanting a Lead Eagle manager to run allocation must **grant it explicitly**, and that is the documented configuration requirement for the "Lead Eagle Manager" persona.
- The LE Viewer reads their team and writes nothing.

**Negative Scenarios** — For every "no" in the table, confirm by URL **and** by API, and record the status. A single "yes" where the table says "no" is a defect; a single "no" where it says "yes" is a configuration problem to check against the workspace's actual role grants first.

**Evidence** — One filled-in copy of the table per persona, with lead counts and owners, plus the API status for each refused action.

---

## LE-MOVE-001 — Moving a standalone Lead Eagle company into a workspace

|                    |                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Platform / Lead Eagle                                                                                                                                                                                                 |
| **User Role**      | Platform Owner                                                                                                                                                                                                        |
| **Feature**        | Lead Eagle migration                                                                                                                                                                                                  |
| **Test Scenario**  | A company is moved in, as a dry run first, then committed; a second run is refused                                                                                                                                    |
| **Priority**       | P1                                                                                                                                                                                                                    |
| **Preconditions**  | **Needs UI Verification and owner coordination.** This is run by a script (`scripts/move-lead-eagle.ts`), not from a screen. A `LeadEagleCompany` snapshot must exist. Do not attempt it without the owner's go-ahead |
| **Code Reference** | `src/services/platform/leadEagleMove.ts`, `apps/web/scripts/move-lead-eagle.ts`                                                                                                                                       |

**Test Steps**

1. Confirm with the owner before running anything.
2. Create the destination workspace with the Lead Eagle plan (`LE-SETUP-001`).
3. **Create the workspace's user accounts first**, matching the source company's people by email.
4. Run the move as a **dry run**.
5. Read the report: the counts, the sample, and every reported case.
6. Confirm **nothing** was written: the workspace's lead count is unchanged.
7. Confirm the report names each of these cases if they occurred:
   - a record owned by someone with **no account** in the workspace → moved **unowned**;
   - a follow-up or booking that must have an owner → fell to the workspace's **first Company Admin**;
   - an activity or stage change → kept its row, lost its person;
   - rows on a merged-duplicate or deleted record → **stayed behind**.
8. Run the move as a **commit**.
9. Confirm the counts match the dry run's.
10. Confirm a **platform audit row** names the company.
11. **Run the same move a second time.** Record the refusal.
12. Open the workspace and confirm the moved leads, follow-ups, projects and listings are present and correctly owned.
13. Confirm the workspace's lead references continue from its own sequence.

**Expected Result**

- **One transaction, all or nothing.** A dry run performs every write — so every constraint, foreign key and row-level-security policy is exercised against the real workspace — checks the counts and a sample, and rolls back.
- A commit does the same and keeps it, with a platform audit row naming the company.
- Step 11: **refused.** A company already moved into the workspace cannot be moved again, so a second run cannot double the book. If a second run succeeds, that is a **P0 data-integrity defect**.
- **Accounts are never created by the move.** People are matched by email to the workspace's existing users; add them to the workspace first.
- Every unowned or reassigned record is **reported**, not silently handled.

**Negative Scenarios**

| What to try                                            | Expected                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A move into a workspace **not** entitled to Lead Eagle | Refused                                                                                      |
| A move with no accounts created at all                 | Everything falls to the first Company Admin or moves unowned, and **every case is reported** |
| A snapshot that fails a constraint                     | The dry run fails **before** any commit, naming the constraint                               |
| Interrupt the commit mid-way                           | Nothing is left half-written — it is one transaction                                         |

**Evidence** — The dry-run report; the lead count before and after; the platform audit row; **the refusal from step 11**.
