# Section 5e — Real Estate

Workspace: `manath-homes` (holds REAL_ESTATE as well as SALES and HRMS), so the
`/realty/` routes are reachable. For the entitlement cases you also need a
**REAL_ESTATE-only** workspace — provision one from the platform console
(`PLAT-WS-001`) using the seeded `realestate` plan.

Accounts:

| Shorthand           | Account                    | Role                                                            |
| ------------------- | -------------------------- | --------------------------------------------------------------- |
| **RE Ops**          | T13                        | `Real Estate Operations` (custom, BRANCH BB)                    |
| **Agent**           | `sales.rep@manathhomes.ae` | `sales_rep`                                                     |
| **Sales Manager**   | `dhruv.menon@example.com`  | `sales_director`                                                |
| **Finance Admin**   | T4                         | `finance_admin`                                                 |
| **Finance Admin 2** | T5                         | `finance_admin` (second account — the two-person rule needs it) |
| **Admin**           | `admin@manathhomes.ae`     | `org_admin`                                                     |

### The money rule that runs through this whole section

Five separate actions refuse the person who set them up, **on the person, not
the role**. An account holding both permissions still cannot do both halves:

| Action                         | Refusal                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Verify a collection receipt    | _"You recorded this receipt. Someone else has to verify it."_                                    |
| Decide an agency-fee amendment | _"You proposed this amendment. Someone else has to decide it."_                                  |
| Approve a payout run           | _"You built this run. Someone else has to approve it."_                                          |
| Approve a recovery resolution  | _"You proposed this resolution. Someone else has to approve it."_                                |
| Approve a payroll run          | _"You prepared this run, so somebody else must approve it."_ ([05d](05d-people.md) `HR-PAY-008`) |

Each one is a P0 case. You need **two** finance accounts (T4 and T5) to test
them properly.

---

## RE-NAV-001 — The Real Estate area

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Real Estate                                                                                                                          |
| **User Role**       | Company Admin, then RE Ops                                                                                                           |
| **Feature**         | Navigation and entitlement                                                                                                           |
| **Test Scenario**   | The Real Estate section appears with its own areas, and the same screens under `/sales/` and `/realty/` are one register             |
| **Priority**        | P1                                                                                                                                   |
| **Preconditions**   | `manath-homes` holds REAL_ESTATE                                                                                                     |
| **Navigation Path** | **Real Estate →** every area                                                                                                         |
| **Code Reference**  | `src/lib/nav/workspaceNav.ts`, `src/lib/security/entitlements.ts` (`SALES_OR_REALTY`, `LEAD_MODULES`), `src/lib/nav/realtyShared.ts` |

**Test Steps**

1. Sign in as Admin. Confirm the sidebar has a **Real Estate** section.
2. Confirm its areas and tabs match [01](01-inventory.md) §1.3 exactly: Dashboard; Leads (Leads, Follow-ups, Tasks, Calls, Playbook, Site Visits, Requirements, Proposals, Allocation, QR Capture, Cold Data); Calendar; Lead Sources (Forms, Landing Pages); Inventory (Properties, Projects, Listings, Portals, Off-Plan); Deals (Collections, Commissions, Events, Reports, Targets).
3. Create a lead at `/manath-homes/realty/leads`.
4. Open `/manath-homes/sales/leads` and confirm **the same lead is there**.
5. Open the **Off-Plan** tab and confirm the URL carries `?possession=UNDER_CONSTRUCTION,NEW_LAUNCH` and that the list is filtered accordingly.
6. Open `/manath-homes/realty/dashboard`. Confirm it is titled **Real Estate**.
7. In the **REAL_ESTATE-only** workspace, sign in and repeat step 2.
8. In that workspace, navigate to `/{slug}/sales/leads`.
9. In that workspace, navigate to `/{slug}/sales/campaigns`.

**Expected Result**

- There is **one lead register read two ways**, not two registers: the page files live under `sales/` and the `realty/` routes re-export them. The brief was explicit that Real Estate must not grow a parallel lead model, and step 4 is the proof.
- Step 8: the workspace holds Real Estate, which carries the same screen, so you are **sent to `/realty/leads`** rather than refused.
- Step 9: Campaigns is a SALES screen with no Real Estate equivalent, so it is **refused** with _"Campaigns is part of Sales. This workspace's plan does not include it."_

**Negative Scenarios**

| What to try                                               | Expected                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `/{slug}/realty/leads` in a SALES-only workspace          | Redirected to `/sales/leads`                                         |
| `/{slug}/realty/proposals` in a Lead-Eagle-only workspace | Refused — proposals are `SALES_OR_REALTY`                            |
| As `sales_rep` in a Real Estate workspace                 | The Real Estate section appears but only the tabs their grants allow |

**Evidence** — The sidebar in both workspaces; the same lead at both URLs; the exact refusal from step 9.

---

## RE-PROP-001 — Projects, properties, listings and inventory

|                     |                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate                                                                                                                                                                                                             |
| **User Role**       | RE Ops (T13)                                                                                                                                                                                                            |
| **Feature**         | Inventory                                                                                                                                                                                                               |
| **Test Scenario**   | A project is created, units added, and a listing published with availability                                                                                                                                            |
| **Priority**        | P1                                                                                                                                                                                                                      |
| **Preconditions**   | T13 holds `projects` and `listings` at BRANCH                                                                                                                                                                           |
| **Test Data**       | Project `QA Marina Heights`, developer `QA Developments`, area `Dubai Marina`, possession `Under construction`. Units: 10. Listing: 2 bedrooms, 2 bathrooms, 1,250 sq ft, budget `1,850,000` AED, furnishing as offered |
| **Navigation Path** | **Real Estate → Inventory → Projects / Properties / Listings**                                                                                                                                                          |
| **Code Reference**  | `realty/projects/`, `realty/properties/page.tsx`, `realty/listings/`, `src/app/api/v1/projects/route.ts`, `src/app/api/v1/listings/route.ts`                                                                            |

**Test Steps**

1. Sign in as T13. Open **Real Estate → Inventory → Projects** (`/manath-homes/realty/projects`).
2. Create `QA Marina Heights` using **Add a project** / **Create project**, with the test data including **Developer**, **Area** and possession.
3. Open the project. Confirm the title **Project**.
4. Use **Add units** to add 10 units. Confirm they appear.
5. Use **Add plan** to add a payment plan.
6. Use **Add owner** if the screen offers it.
7. Open **Inventory → Properties** (`/manath-homes/realty/properties`). Confirm the title **Properties** and that the project's units are listed.
8. Open **Inventory → Listings** (`/manath-homes/realty/listings`). Create a listing with **Create listing** using the test data: **Bedrooms**, **Bathrooms**, **Area**, **Budget (AED)**, **Furnishing**, **Developer**, **Available**.
9. Open the listing. Confirm the title **Listing**.
10. Use the **Available only** filter on the list. Confirm it filters.
11. Open **Inventory → Off-Plan**. Confirm `QA Marina Heights` appears (possession is under construction).
12. Open **Inventory → Portals** (`/manath-homes/realty/portals`). Confirm the title **Portals**. Attempt to publish the listing.
13. Mark one unit as sold or reserved. Confirm the availability figures change.
14. Sign in as `sales_rep` and confirm what they can see on Inventory (`products:VIEW @ ORGANIZATION` only, by default — no `projects` or `listings` grant).

**Expected Result**

- A project holds units, payment plans and owners.
- Listings carry the attributes the search and matching use: bedrooms, bathrooms, area, budget, furnishing.
- The **Off-Plan** tab is a filtered view of Projects, not a separate register.
- **Portals** needs portal credentials: an unconfigured portal must refuse clearly, naming what is missing, and must not silently appear to publish. **Needs credentials.**
- Availability is derived from the unit inventory.
- A default `sales_rep` sees no Inventory tabs: `projects` and `listings` are not in their grants. Confirm by URL as well.

**Negative Scenarios**

| What to try                                                                          | Expected                               |
| ------------------------------------------------------------------------------------ | -------------------------------------- |
| A project with a blank name                                                          | Refused                                |
| Negative bedrooms, bathrooms or area                                                 | Refused                                |
| A budget of 0                                                                        | Record the behaviour                   |
| A listing with no project or unit                                                    | Record whether it is permitted         |
| 11 units when 10 exist on a 10-unit project                                          | Record whether the inventory is capped |
| T13 creating a project for a branch other than BB                                    | 404 or refused                         |
| `POST /api/v1/listings` in a workspace with none of SALES / REAL_ESTATE / LEAD_EAGLE | 403 naming all three                   |

**Evidence** — The project with its units and plan; the listing; the availability figures before and after step 13.

---

## RE-VISIT-001 — Site visits and QR passes

|                     |                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate                                                                                                                                        |
| **User Role**       | Sales Agent, then RE Ops                                                                                                                           |
| **Feature**         | Site visits, approval, QR pass                                                                                                                     |
| **Test Scenario**   | A viewing is requested, approved, and attended with a pass                                                                                         |
| **Priority**        | P1                                                                                                                                                 |
| **Preconditions**   | A lead and a listing exist. T13 holds `visits:APPROVE @ BRANCH`                                                                                    |
| **Navigation Path** | **Real Estate → Leads → Site Visits** (`/manath-homes/realty/site-visits`), or **CRM → Activities → Viewings** (`/manath-homes/sales/site-visits`) |
| **Code Reference**  | `realty/site-visits/`, `sales/site-visits/new/page.tsx`, `src/app/api/v1/site-visits/route.ts`                                                     |

**Test Steps**

1. Sign in as the Agent. Open **Site Visits**. Confirm the list page is titled **Site visits**.
2. Open the request form (`/manath-homes/sales/site-visits/new`). Confirm it is titled **Request a visit** and the submit button reads **Request**.
3. Request a visit for the lead against the listing, with a date and time.
4. Confirm it appears with a pending status.
5. Open the visit. Confirm the title **Site visit**.
6. Sign in as T13. Confirm the visit is **Awaiting your decision** or equivalent, and approve it.
7. Confirm the Agent sees the approval.
8. Confirm a QR pass is produced for the visit. Note how it is delivered to the client.
9. Open the pass as an unauthenticated visitor. Confirm it renders without a session.
10. Record the visit as attended.
11. Confirm the visit appears on the lead's timeline.
12. Confirm it is counted in the Real Estate reports.
13. Request a second visit and **reject** it as T13, with a reason.
14. As the Agent, attempt to approve your own visit request.

**Expected Result**

- `visits` carries `APPROVE`; `sales_rep` holds `visits` only via the Sales nav's **Viewings** tab — confirm against the role's actual grants, because the default `sales_rep` has no `visits` grant at all and will be refused.
- A visit moves: requested → approved or rejected → attended.
- The QR pass is readable by the client **without a session**, and is tied to that one visit.
- Step 14 is refused: requesting and approving are different acts.

**Negative Scenarios**

| What to try                               | Expected                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A visit in the past                       | Record the behaviour                                                                                                                                                                         |
| Two visits at the same time for one agent | Record whether a clash is flagged                                                                                                                                                            |
| Approve a visit twice                     | Refused                                                                                                                                                                                      |
| Record attendance on a rejected visit     | Refused                                                                                                                                                                                      |
| A QR pass URL with one character changed  | Refused — a guessable pass is a P1 defect                                                                                                                                                    |
| A QR pass reused after the visit          | Record whether it expires                                                                                                                                                                    |
| Many pass views from one IP in a minute   | Record the behaviour. The page itself is a server-rendered page, not a rate-limited API route; only the `/api/v1/public/*` endpoints carry the limits in [02](02-roles-and-personas.md) §2.8 |

**Evidence** — The visit at each status; the QR pass rendered without a session; the refusal from step 14.

---

## RE-BOOK-001 — Create and confirm a booking

|                     |                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate                                                                                                                                                                                                                                                               |
| **User Role**       | RE Ops (T13)                                                                                                                                                                                                                                                              |
| **Feature**         | Bookings                                                                                                                                                                                                                                                                  |
| **Test Scenario**   | A booking records who bought what, for how much, and is confirmed before anything accrues                                                                                                                                                                                 |
| **Priority**        | **P0**                                                                                                                                                                                                                                                                    |
| **Preconditions**   | A lead, a project and a unit exist. T13 holds `bookings:VIEW/CREATE/EDIT`. **`manath-homes` must hold SALES** — see the Expected Result                                                                                                                                   |
| **Test Data**       | Buyer: the lead; sold: the unit in `QA Marina Heights`; **sale value** `1850000`; **agency fee** `37000`; currency `AED`; booking date today; agreement date today; notes `QA booking`                                                                                    |
| **Navigation Path** | **Needs UI Verification.** No page file named `bookings` exists; bookings are reached through **Real Estate → Deals → Collections** (`/manath-homes/realty/collections`) and the dashboards. Find the booking-creation entry point and record it before failing this case |
| **Code Reference**  | `src/app/api/v1/bookings/route.ts`, `sales/collections/page.tsx`, `sales/collections/[bookingId]/page.tsx`, `src/services/money/commissions.ts`                                                                                                                           |

**Test Steps**

1. Sign in as T13. Open **Real Estate → Deals → Collections**.
2. If no bookings exist, confirm the empty state reads **No bookings yet**.
3. Locate the booking-creation control. **Record where it is.** If you cannot find one, record this case as **Blocked — Needs UI Verification** and continue with the API steps below.
4. Create a booking with the test data.
5. Confirm it is created in **DRAFT** status.
6. Confirm the booking page shows the buyer, what was sold, the sale value, the agency fee and the currency.
7. Attempt to accrue commission on the DRAFT booking.
8. Confirm the booking's **CONFIRM** action and use it, supplying an agreement date.
9. Confirm the status becomes **CONFIRMED**.
10. Confirm commission now accrues (`RE-COMM-001`).
11. Create a second booking and **CANCEL** it, supplying a reason.
12. Confirm the cancellation reason is recorded.
13. Via the API, `POST /api/v1/bookings` with no `leadId`, `contactId` or `accountId`.
14. Via the API, `POST` with a buyer but no `projectId`, `listingId` or `unitInventoryId`.
15. **In the REAL_ESTATE-only workspace**, sign in and call `POST /api/v1/bookings` with a valid body. **Record the status.**

**Expected Result**

- A booking must say **who bought it** and **what was sold**: step 13 returns 422 with _"Say who bought it."_, step 14 returns 422 with _"Say what was sold."_ A booking without either would make the ledger a wish list.
- Statuses are **DRAFT**, **CONFIRMED**, **CANCELLED**.
- Step 7: refused — _"Only a confirmed booking accrues commission. Confirm the sale first."_
- A cancellation requires a reason of at least 4 characters.
- **Step 15 is the finding.** `POST /api/v1/bookings` asserts `productModule: 'SALES'`, **not** `SALES_OR_REALTY` — unlike Collections, Commissions, Events and Proposals around it, which all accept either product. So a **Real-Estate-only brokerage sees the Deals tabs and cannot create a booking**: the request returns **403 "Sales is not enabled for this company."** The same is true of `/api/v1/payouts`. Record the status and the message verbatim; this is logged as a finding in [12](12-coverage-and-gaps.md).

**Negative Scenarios**

| What to try                          | Expected                                                      |
| ------------------------------------ | ------------------------------------------------------------- |
| A sale value of `0` or negative      | Refused (must be positive)                                    |
| A negative agency fee                | Refused (non-negative)                                        |
| A currency of `AEDX` or `AE`         | Refused (exactly 3 characters)                                |
| Notes of 5,000 characters            | Refused (maximum 4,000)                                       |
| A `leadId` from `leadersfort`        | 404                                                           |
| A `projectId` that does not exist    | 404                                                           |
| **CONFIRM** a CANCELLED booking      | Refused                                                       |
| **CANCEL** with a 3-character reason | Refused (minimum 4)                                           |
| **CONFIRM** the same booking twice   | Refused                                                       |
| A booking date in the future         | Record the behaviour                                          |
| As `sales_rep`                       | Refused — no `bookings` grant                                 |
| As `finance_admin`                   | Refused on CREATE — `finance_admin` holds no `bookings` grant |

**Evidence** — The booking at each status; the two 422 messages verbatim; **the status and message from step 15**.

---

## RE-COLL-001 — Record a collection receipt

|                     |                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate / Finance                                                                                                                                                               |
| **User Role**       | Finance Administrator (T4)                                                                                                                                                          |
| **Feature**         | Collections                                                                                                                                                                         |
| **Test Scenario**   | A receipt against a confirmed booking is recorded, pending verification                                                                                                             |
| **Priority**        | **P0**                                                                                                                                                                              |
| **Preconditions**   | A CONFIRMED booking exists with an agency fee of `37000`. T4 and T5 both exist as `finance_admin`                                                                                   |
| **Test Data**       | Amount received `18500`; bank or provider transaction id `QA-REF-0001`; date today; an evidence document                                                                            |
| **Navigation Path** | **Finance → Collections → Overview** (`/manath-homes/sales/collections`) or **Real Estate → Deals → Collections**, then the booking (`/manath-homes/sales/collections/{bookingId}`) |
| **Code Reference**  | `src/services/money/collections.ts`, `src/app/api/v1/collections/receipts/route.ts`                                                                                                 |

**Test Steps**

1. Sign in as T4. Open **Finance → Collections → Overview**. Confirm the title **Collections**.
2. Open the confirmed booking's collections page. Confirm the agency fee and what is outstanding.
3. Record a receipt with the test data: **Amount received** `18500`, **Bank or provider transaction id** `QA-REF-0001`, **Date**, and an **Evidence document**.
4. Confirm the receipt is created in a **pending** state, not verified.
5. Confirm the outstanding figure has **not** changed yet — or record exactly when it does.
6. **As T4, attempt to verify the receipt you just recorded.**
7. **Record the exact message.**
8. Sign in as T5. Verify the receipt.
9. Confirm the receipt becomes verified and the outstanding figure drops to `18500`.
10. As T5, attempt to **reverse** the verified receipt.
11. Record a second receipt as T5 and, as T4, **reject** it while pending.
12. As T4, attempt to **reverse** the rejected receipt.
13. Record a third receipt and have T5 verify it, then as T4 reverse it.

**Expected Result**

- A receipt is recorded, then **verified by somebody else**. Step 6 is refused with **"You recorded this receipt. Someone else has to verify it."** — enforced on the person, and **no rank overrides it**. If T4 can verify their own receipt, that is the most serious money defect in this section.
- Step 12: refused with _"Only a verified receipt can be reversed. Reject a pending one instead."_
- A reversal is itself an approval action and is audited.
- Evidence documents are attached to the receipt.

**Negative Scenarios**

| What to try                                                 | Expected                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| An amount of `0` or negative                                | Refused                                                                                                                                    |
| An amount greater than the outstanding fee                  | Record the behaviour — over-collection should be refused or flagged, never silently accepted                                               |
| A duplicate transaction id                                  | Refused, or flagged — record which                                                                                                         |
| A receipt against a DRAFT booking                           | Refused                                                                                                                                    |
| A receipt against a CANCELLED booking                       | Refused                                                                                                                                    |
| Verify a receipt twice                                      | Refused                                                                                                                                    |
| An evidence document already cited by other money           | _"That document already evidences other money. A recovery needs its own evidence."_ (on a recovery; check whether receipts share the rule) |
| As `sales_rep`                                              | Refused; Collections is absent                                                                                                             |
| As `sales_director`                                         | `collections` is not in their grants — refused                                                                                             |
| As `org_admin` recording **and** verifying the same receipt | **Still refused.** `org_admin` holds `*:*`, and the guard is on the person. This is the sharpest version of the test — run it              |

**Evidence** — The receipt pending and then verified; **the exact message from step 7**; the outstanding figure at each step; the `org_admin` attempt.

---

## RE-COMM-001 — Commission accrual, confirmation and clawback

|                     |                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate / Finance                                                                                                        |
| **User Role**       | Finance Administrator                                                                                                        |
| **Feature**         | Commissions and commission plans                                                                                             |
| **Test Scenario**   | Commission accrues from a confirmed booking against a plan, is confirmed, and can be reversed                                |
| **Priority**        | **P0**                                                                                                                       |
| **Preconditions**   | A CONFIRMED booking. A commission plan (slab) exists. T4 holds `commissions:APPROVE`                                         |
| **Navigation Path** | **Finance → Commissions & Payouts → Commission Plans / Commissions / Payout Runs**                                           |
| **Code Reference**  | `src/services/money/commissions.ts`, `src/services/money/slabs.ts`, `sales/commissions/`, `sales/commissions/slabs/page.tsx` |

**Test Steps**

1. Sign in as T4. Open **Finance → Commissions & Payouts → Commission Plans** (`/manath-homes/sales/commissions/slabs`). Confirm the title **Commission slabs**.
2. Note the existing slabs and their thresholds and rates.
3. Open **Commissions** (`/manath-homes/sales/commissions`). Confirm the title **Commissions**.
4. Accrue commission on the confirmed booking.
5. Confirm the accrual's amount against the slab and the sale value. **Check the arithmetic by hand.**
6. Confirm the split between the agents involved, if more than one.
7. Attempt to accrue on the **same** booking a second time.
8. Record the message.
9. Confirm the commission (this is an approval).
10. Attempt step 9 as a role without `commissions:APPROVE`.
11. Claw back the commission on the booking.
12. Attempt to claw back again.
13. Attempt to claw back a booking with nothing on it.
14. Open **Payout Runs** (`/manath-homes/sales/commissions?view=payouts`). Build a payout run as T4.
15. **As T4, attempt to approve the payout run you built.** Record the message.
16. As T5, approve it.
17. Attempt to release money before approval.

**Expected Result**

- Commission accrues only from a **CONFIRMED** booking: _"Only a confirmed booking accrues commission. Confirm the sale first."_
- Step 8: _"This booking has already accrued. Adjust the split instead."_ — a second accrual would double-pay.
- Step 10: _"Confirming a commission is an approval."_
- Step 12: _"Every commission on this booking has already been reversed."_
- Step 13: _"There is nothing on this booking to reverse."_
- Clawing back requires `commissions:APPROVE`: _"Clawing back a commission is an approval."_
- Step 15: **"You built this run. Someone else has to approve it."**
- Step 17: _"This payout has not been approved."_ and _"Releasing money is an approval."_
- A payout run with nothing payable: _"Nothing is payable to this person for that period."_

**Negative Scenarios**

| What to try                                            | Expected                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A slab with overlapping thresholds                     | Refused, or the first match wins — record which, and check the arithmetic                                                               |
| A slab rate above 100%                                 | Refused                                                                                                                                 |
| A negative rate                                        | Refused                                                                                                                                 |
| A split summing to more than 100%                      | Refused                                                                                                                                 |
| Accrue on a cancelled booking                          | Refused                                                                                                                                 |
| `POST /api/v1/payouts` in a REAL_ESTATE-only workspace | **403 "Sales is not enabled for this company."** — `payouts` asserts SALES only, like `bookings`. Same finding as `RE-BOOK-001` step 15 |
| As `sales_director`                                    | `commissions` is not in their grants — refused                                                                                          |
| As `auditor`                                           | Read-only                                                                                                                               |

**Evidence** — Your hand-checked commission arithmetic beside the system's figure; **the exact message from step 15**; each refusal verbatim.

---

## RE-FEE-003 — Agency fee: the Sales Director proposes, Finance decides

|                     |                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate / Finance                                                                                                                    |
| **User Role**       | Sales Director, then Finance Administrator                                                                                               |
| **Feature**         | Agency fee amendments                                                                                                                    |
| **Test Scenario**   | A fee amendment is proposed by the commercial side and decided by finance, and the proposer cannot decide it                             |
| **Priority**        | **P0**                                                                                                                                   |
| **Preconditions**   | A CONFIRMED booking with an agency fee. `dhruv.menon@example.com` holds `agencyfee:VIEW/CREATE`. T4 and T5 hold `agencyfee:VIEW/APPROVE` |
| **Navigation Path** | The booking's collections page → the agency-fee controls                                                                                 |
| **Code Reference**  | `src/services/money/feeAmendments.ts`, `src/app/api/v1/collections/fee-amendments/route.ts`, `prisma/seed/roles.ts` (D-20)               |

**Test Steps**

1. Sign in as the Sales Director. Open the booking.
2. Confirm the **Agency fee** is shown, with an **Amendment reason** control for proposing a change.
3. Propose an amendment: change the fee from `37000` to `40000`, with the reason `QA: agreed uplift`.
4. Confirm it is recorded as **proposed**, and that the live fee is **still 37000**.
5. **As the Sales Director, attempt to approve the amendment you proposed.** Record the message.
6. Attempt to approve as a role with neither grant.
7. Sign in as T4. Confirm the amendment is awaiting a decision, with the **Decision**, **Decision note** and **Approval note** controls.
8. Approve it. Confirm the live fee becomes `40000`.
9. Confirm the change is audited with both the proposer and the decider.
10. Propose an amendment changing the fee to `40000` again.
11. Record the message.
12. Propose another amendment and have T5 **reject** it with a note. Confirm the fee stays `40000`.
13. As T4, attempt to propose an amendment. Record whether `agencyfee:CREATE` is absent from `finance_admin`.

**Expected Result**

- `sales_director` holds `agencyfee:VIEW` + `CREATE`: **the commercial administrator proposes the agreed agency fee and amendments to it; finance approves.**
- `finance_admin` holds `agencyfee:VIEW` + `APPROVE`: **finance approves fee amendments; it does not propose them.** Step 13 should therefore be refused.
- Step 5: **"You proposed this amendment. Someone else has to decide it."**
- Step 11: _"That is already the agreed fee."_
- The live fee changes only on approval.
- Both halves are audited.

**Negative Scenarios**

| What to try                               | Expected                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| An amendment to a negative fee            | Refused                                                                                      |
| An amendment with no reason               | Refused, or recorded blank — record which; a money change with no stated reason is a finding |
| An amendment on a CANCELLED booking       | Refused                                                                                      |
| Approve an already-decided amendment      | Refused                                                                                      |
| As `org_admin` proposing **and** deciding | **Still refused** on the second half — the guard is on the person                            |

**Evidence** — The fee before, proposed, and after; **the exact message from step 5**; the audit entry naming both people.

---

## RE-RECOV-001 — Recovery cases

|                     |                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Module**          | Real Estate / Finance                                                                   |
| **User Role**       | Finance Administrator                                                                   |
| **Feature**         | Recovery of outstanding money                                                           |
| **Test Scenario**   | A recovery case is opened, a resolution proposed, and approved by somebody else         |
| **Priority**        | P1                                                                                      |
| **Preconditions**   | A booking with an overdue outstanding fee. T4 and T5 exist                              |
| **Navigation Path** | **Finance → Collections → Recovery Cases** (`/manath-homes/sales/collections/recovery`) |
| **Code Reference**  | `src/services/money/recoveryCases.ts`, `src/app/api/v1/collections/recovery/route.ts`   |

**Test Steps**

1. Sign in as T4. Open **Finance → Collections → Recovery Cases**. Confirm the title **Recovery cases**.
2. Open a recovery case against the overdue booking.
3. Record an **Amount recovered** with an **Evidence document**.
4. Propose a resolution.
5. Confirm the status becomes **RESOLUTION_PROPOSED**.
6. **As T4, attempt to approve the resolution you proposed.** Record the message.
7. Attempt to propose a **second** resolution while one is pending. Record the message.
8. Sign in as T5. Approve the resolution.
9. Confirm the status becomes **RESOLVED**.
10. Attempt any further action on the resolved case. Record the message.
11. Open a second case and attach, as evidence, a document already cited by other money. Record the message.
12. Attempt to approve a case with nothing pending. Record the message.

**Expected Result**

- Step 6: **"You proposed this resolution. Someone else has to approve it."**
- Step 7: _"A resolution is already waiting for approval."_ (and, from the other entry point, _"A resolution is waiting for approval."_)
- Step 10: _"This case is resolved."_
- Step 11: _"That document already evidences other money. A recovery needs its own evidence."_
- Step 12: _"Nothing is waiting for approval on this case."_

**Negative Scenarios**

| What to try                                       | Expected                            |
| ------------------------------------------------- | ----------------------------------- |
| A negative amount recovered                       | Refused                             |
| An amount recovered exceeding the outstanding sum | Refused, or flagged                 |
| A recovery case with no evidence                  | Record whether evidence is required |
| As `sales_rep`                                    | Refused; the tab is absent          |

**Evidence** — The case at each status; **every quoted message verbatim**.

---

## RE-REQ-001 — Requirements, proposals and shared shortlists

|                     |                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Real Estate                                                                                                                                            |
| **User Role**       | Sales Agent / RE Ops                                                                                                                                   |
| **Feature**         | Buyer requirements, proposals, shared links                                                                                                            |
| **Test Scenario**   | A buyer's requirement is recorded, matched to listings, and sent as a shortlist the client can open without a session                                  |
| **Priority**        | P1                                                                                                                                                     |
| **Preconditions**   | A lead and at least three listings exist                                                                                                               |
| **Test Data**       | Requirement: **Bedrooms from** `2`, **Bedrooms to** `3`, **Budget from (AED)** `1500000`, **Budget to (AED)** `2500000`, **Areas** `Dubai Marina, JLT` |
| **Navigation Path** | **Real Estate → Leads → Requirements** (`/manath-homes/realty/requirements`) → **Proposals** (`/manath-homes/realty/proposals`)                        |
| **Code Reference**  | `realty/requirements/`, `realty/proposals/`, `src/app/api/v1/requirements/`, `src/app/api/v1/proposals/route.ts`, `src/app/p/[token]/page.tsx`         |

**Test Steps**

1. Sign in as the Agent. Open **Requirements**. Confirm the list page title **Requirements**.
2. Create a requirement for the lead with the test data.
3. Open it. Confirm the title **Requirement** and that matching listings are suggested.
4. Confirm the matches honour the bedroom range, the budget range and the areas.
5. Open **Proposals**. Create a proposal from the requirement with two or three listings.
6. Open the proposal. Confirm the title **Proposal**.
7. Share it. Note the public link (`/p/{token}`).
8. Open the link in a private window with **no session**.
9. Confirm the page is titled **Your shortlist** and shows the chosen listings.
10. Confirm it shows **no** internal data: no owner name, no lead score, no commission, no other client's details.
11. From the shortlist, express interest in one property if the page offers it.
12. Back in the workspace, confirm the interest is recorded against the lead.
13. Change one character of the token and reload.
14. Submit from the shortlist 31 times in a minute from one IP (`POST /api/v1/public/proposal`, limit 30 / min).

**Expected Result**

- Matching uses the recorded ranges; a listing outside them must not appear.
- The shortlist is readable **without a session** and shows only what a client should see. **Any internal field on the public page is a P0 data-leak defect.**
- Step 13: refused — the token must not be guessable.
- Step 14: the 31st submission is 429 (`POST /api/v1/public/proposal` is limited to 30 / min).
- Proposals are `SALES_OR_REALTY`: a Lead-Eagle-only workspace is refused.

**Negative Scenarios**

| What to try                              | Expected                                      |
| ---------------------------------------- | --------------------------------------------- |
| **Bedrooms to** below **Bedrooms from**  | Refused                                       |
| **Budget to** below **Budget from**      | Refused                                       |
| Negative budgets                         | Refused                                       |
| A proposal with no listings              | Refused, or an empty shortlist — record which |
| The link after the proposal is withdrawn | Refused                                       |
| The link after the listing is sold       | Record the behaviour                          |

**Evidence** — The matched listings beside the requirement's ranges; the public shortlist page with its full content visible, so a reviewer can confirm nothing internal leaked; the 429.

---

## RE-SHARE-001 — Sharing a record outside the workspace

|                     |                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate                                                                                                                       |
| **User Role**       | Sales Agent                                                                                                                       |
| **Feature**         | Shared records                                                                                                                    |
| **Test Scenario**   | A record shared by link is readable without a session, carries nothing internal, and is not indexed                               |
| **Priority**        | **P0**                                                                                                                            |
| **Preconditions**   | A listing and a lead exist                                                                                                        |
| **Navigation Path** | A record → the share control → `/s/{token}`                                                                                       |
| **Code Reference**  | `src/app/s/[token]/page.tsx`, `src/app/api/v1/public/share-view/`, `sales/leads/ShareWithLead.tsx`, `src/lib/nav/realtyShared.ts` |

**Test Steps**

1. Sign in as the Agent. Open a listing. Use the share control.
2. Note the link (`/s/{token}`).
3. Open it in a private window with no session.
4. Confirm the page is titled **Shared with you**.
5. **View the page source and confirm `robots` is set to no-index, no-follow.**
6. Confirm the page shows only the record's client-facing fields.
7. Confirm it shows **no** internal field: owner, score, stage, commission, internal notes, other records.
8. Share a **lead** with the lead themselves using **Share with lead**, and repeat steps 3–7.
9. Change one character of the token. Reload.
10. Revoke the share. Reload the original link.
11. Call `POST /api/v1/public/share-view` for the token 61 times in a minute from one IP (limit 60 / min).
12. Search for the token's content in a search engine, if the environment is internet-facing. (Skip on a local environment and say so.)

**Expected Result**

- The page renders with no session, titled **Shared with you**, and is explicitly **`robots: { index: false, follow: false }`**. A shared customer record that search engines may index is a P0 defect.
- Only client-facing fields appear.
- A changed token is refused.
- A revoked share stops working immediately.
- The 61st `share-view` call in a minute is 429.

**Negative Scenarios**

| What to try                    | Expected                                          |
| ------------------------------ | ------------------------------------------------- |
| A token from another workspace | Refused                                           |
| A token for a deleted record   | Refused                                           |
| An expired share               | Refused, with a clear message rather than a crash |
| Guess sequential tokens        | Refused — tokens must not be sequential           |

**Evidence** — The page source showing the robots meta; a full screenshot of the shared page; the result of steps 9, 10 and 11.

---

## RE-EVENT-001 — Events and RSVP

|                     |                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate                                                                                                                                                                              |
| **User Role**       | Marketing Manager / RE Ops                                                                                                                                                               |
| **Feature**         | Event management, invitations, RSVP                                                                                                                                                      |
| **Test Scenario**   | An event is created, invitations issued, and a guest responds without a session                                                                                                          |
| **Priority**        | P2                                                                                                                                                                                       |
| **Preconditions**   | `events` is granted. The workspace holds SALES or REAL_ESTATE                                                                                                                            |
| **Test Data**       | Event `QA Marina Open House`; **Starts** / **Ends** tomorrow; **Destination** `Dubai Marina`; guest: an existing lead                                                                    |
| **Navigation Path** | **Real Estate → Deals → Events** (`/manath-homes/realty/events`) or **Marketing → Campaigns → Events** (`/manath-homes/sales/events`) → **New event** (`/manath-homes/sales/events/new`) |
| **Code Reference**  | `sales/events/`, `src/app/api/v1/events/route.ts`, `src/app/rsvp/[token]/page.tsx`                                                                                                       |

**Test Steps**

1. Sign in as the marketing manager. Open **Events**. Confirm the list title **Events**.
2. Open the create form (`/manath-homes/sales/events/new`). Confirm the title **New event**.
3. Create `QA Marina Open House` with the test data.
4. Open it. Confirm the title **Event Detail**.
5. Issue an invitation to the lead. Note the **Expires** value if offered.
6. Confirm the invitation's state is tracked (sent, **First opened**, **Last opened**, **Accepted**, **Declined**).
7. Copy the RSVP link (`/rsvp/{token}`). Open it in a private window with no session.
8. Confirm the page is titled **Your invitation** and shows the event.
9. Accept the invitation.
10. In the workspace, confirm the RSVP is recorded as **Accepted**.
11. Open the link again and **decline**.
12. Confirm the change is recorded.
13. Change one character of the token. Reload.
14. Let the invitation expire (or set **Expires** in the past) and reload the link.
15. Confirm the event's attendance figures (**Arrived this period**, or equivalent) update when a guest is marked arrived.

**Expected Result**

- The RSVP page works without a session, titled **Your invitation**.
- A response is recorded against the invitation and visible in the workspace.
- A guest may change their answer; the latest stands and the history is kept.
- A tampered or expired token is refused with a clear message.
- Events are `SALES_OR_REALTY`: a Lead-Eagle-only workspace is refused — see `LE-ENT-001`.

**Negative Scenarios**

| What to try                                           | Expected                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| **Ends** before **Starts**                            | Refused                                                                   |
| An event with a blank name                            | Refused                                                                   |
| An invitation to an email that is not a valid address | Refused                                                                   |
| Two invitations to the same guest                     | Record the behaviour                                                      |
| RSVP to an event that was deleted                     | Refused                                                                   |
| 31 `GET /api/v1/public/rsvp` calls in a minute        | 429 (limit 30 / min); 21 `POST`s in a minute is also 429 (limit 20 / min) |

**Evidence** — The event; the invitation's state transitions; the RSVP page without a session; the refusals for the tampered and expired tokens.

---

## RE-TEST-001 — Testimonials and referrals

|                     |                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Real Estate / Sales                                                                                                           |
| **User Role**       | Sales Agent, then a public visitor                                                                                            |
| **Feature**         | Client profiles, testimonials, referrals                                                                                      |
| **Test Scenario**   | A client is invited to leave a testimonial, does so without a session, and it is approved before it is used                   |
| **Priority**        | P2                                                                                                                            |
| **Preconditions**   | `clientprofiles`, `testimonials` and `referrals` are granted. A client profile exists                                         |
| **Navigation Path** | **CRM → Customers → Client Profiles / Testimonials / Referrals**                                                              |
| **Code Reference**  | `sales/clients/page.tsx`, `src/app/testimonial/[token]/page.tsx`, `src/app/api/v1/testimonials/`, `src/app/api/v1/referrals/` |

**Test Steps**

1. Sign in as a role holding `clientprofiles` and `testimonials` (`org_admin` will do; `sales_rep` holds neither by default — confirm).
2. Open **CRM → Customers → Client Profiles** (`/manath-homes/sales/clients`). Confirm the title **Clients**.
3. Open **Testimonials** (`?view=testimonials`). Confirm it requires **both** `clientprofiles` and `testimonials`.
4. Invite a client to leave a testimonial. Note the link (`/testimonial/{token}`).
5. Open the link in a private window with no session. Confirm the page is titled **Share your experience**.
6. Submit a testimonial.
7. In the workspace, confirm it arrives **unapproved**.
8. Confirm it is **not** shown anywhere public until approved.
9. Approve it (`testimonials:APPROVE`).
10. Confirm it is now usable.
11. Open **Referrals** (`?view=referrals`). Confirm it requires `clientprofiles` **and** `referrals`.
12. Record a referral and confirm a referred lead can be created from it with source **Referral** and **Referred by** populated.

**Expected Result**

- The Testimonials and Referrals tabs each need **two** permissions; holding one is not enough. Confirm by granting only one and checking the tab disappears.
- A submitted testimonial is **unapproved** and invisible publicly until someone with APPROVE releases it. A testimonial that appears publicly on submission is a P1 defect.
- A referral produces a lead whose source is `REFERRAL` and whose **Referred by** is required — see `SALES-LEAD-001`'s negative _"Say who referred this lead."_

**Negative Scenarios**

| What to try                                     | Expected                            |
| ----------------------------------------------- | ----------------------------------- |
| An empty testimonial                            | Refused                             |
| A 10,000-character testimonial                  | Refused or truncated — record which |
| The link after submission                       | Record whether it can be reused     |
| A tampered token                                | Refused                             |
| Approve a testimonial as a role without APPROVE | 403                                 |

**Evidence** — The public testimonial page; the testimonial unapproved and then approved; the tabs with only one of the two permissions granted.
