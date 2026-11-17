# Section 8 — End-to-end cross-role business workflow tests

Each workflow is one test case with **named sign-ins at each stage**. The point
is not to re-test the features — [Section 5](README.md) does that — but to prove
the hand-offs between roles work, and that what one role does is visible to the
next in the way the business expects.

**Run these in order within a workflow.** A stage that fails blocks the rest, so
record **Blocked** for the remainder rather than skipping silently.

**The worker must be running** for every workflow here. Several stages depend on
queued work, and each says so.

| ID               | Workflow                                                                                         | Roles involved                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `E2E-PROV-001`   | Company provisioning → subscription → admin setup → employee → role → login                      | Platform Owner, Company Admin, Employee                            |
| `E2E-LEAD-002`   | Incoming lead → assignment → notification → call → follow-up → site visit → booking → commission | Public Visitor, Agent, Team Leader, RE Ops, Finance                |
| `E2E-CALL-003`   | Lead assigned → call attempts → disposition → AI summary → Daily Activity → manager report       | Agent, Telecaller, Team Leader                                     |
| `E2E-HR-004`     | Onboarding → shift → attendance → leave/overtime → payroll → payslip                             | HR Manager, Dept Manager, Employee, Payroll Officer, Finance Admin |
| `E2E-PROP-005`   | Property → availability → site visit → booking → collection → commission                         | RE Ops, Agent, Finance (two accounts)                              |
| `E2E-LE-006`     | Lead-Eagle-only company → users → assignment → agent activity → manager reporting                | Platform Owner, LE Admin, LE Agent, LE Manager                     |
| `E2E-PERM-007`   | Permission change → existing session → restricted action → denial                                | Company Admin, the affected user                                   |
| `E2E-CANCEL-008` | Module cancellation → page and API access → entitlement enforcement                              | Platform Owner, Company Admin                                      |

---

## E2E-PROV-001 — Provisioning a company, end to end

|                   |                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**        | Platform → Administration → HRMS                                                                                                                                                                                                                                      |
| **Priority**      | **P0**                                                                                                                                                                                                                                                                |
| **Preconditions** | Platform owner credentials. A plan exists. The worker is running. The mail catcher is reachable                                                                                                                                                                       |
| **Test Data**     | Company `QA E2E Brokerage`, slug `qa-e2e`, plan `business` (HRMS + SALES), administrator `qa.e2e.admin@example.com`. Employee `QA E2E Agent`, code `E2E-001`, email `qa.e2e.agent@example.com`, role `Sales Representative`, branch and department created in stage 3 |

| Stage | Signs in as                                    | Does                                                                                                                                               |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Platform Owner**                             | Confirms the plan's modules at `/platform/plans`                                                                                                   |
| 2     | **Platform Owner**                             | Provisions `QA E2E Brokerage` at `/platform/workspaces/new` with HRMS + SALES and the administrator account                                        |
| 3     | **Company Admin** (`qa.e2e.admin@example.com`) | Signs in with the initial password, changes it, then creates a branch, a department and a designation                                              |
| 4     | **Company Admin**                              | Creates the role configuration `Telecaller` ([02](02-roles-and-personas.md) §2.6)                                                                  |
| 5     | **Company Admin**                              | Creates a work location `QA E2E Office`, radius 100 m                                                                                              |
| 6     | **Company Admin**                              | Creates the user `QA E2E Agent` with role `Sales Representative`, the branch, the department and the work location; records the temporary password |
| 7     | **Company Admin**                              | Creates a team with themselves as manager and the agent as a member                                                                                |
| 8     | **Employee / Agent**                           | Signs in with the temporary password, is required to change it, sets a new one                                                                     |
| 9     | **Agent**                                      | Opens **Account → Role & Access** and confirms the role shown is `Sales Representative`                                                            |
| 10    | **Agent**                                      | Opens **Check-in** and checks in successfully                                                                                                      |
| 11    | **Agent**                                      | Creates one lead                                                                                                                                   |
| 12    | **Company Admin**                              | Confirms the lead is visible, owned by the agent, and that the audit log records stages 2, 6 and 11                                                |

**Expected Result at each stage**

1. The plan's modules are exactly HRMS and SALES.
2. The workspace is created; the created-panel shows the slug and the administrator's credentials; the workspace is empty of data.
3. The administrator can sign in immediately and is made to change the password.
4. The role exists with exactly the intended grants.
5. The work location exists with its radius and check-out rule.
6. The user is created with an employee record; the temporary password shows **once**.
7. The team exists and TEAM scope now resolves through it.
8. The agent signs in and must change the password.
9. The role and scope shown match what was assigned.
10. **Check-in works** — the work-location assignment from stage 6 is what makes it possible. Without it, the screen says so.
11. The lead is owned by the agent.
12. Everything is visible to the administrator at ORGANIZATION scope, and the audit trail is complete and attributable.

**Where this workflow usually fails** — stage 10, because the work-location
assignment was forgotten at stage 6. That is a configuration miss, not a defect;
record it as such and complete stage 5–6 properly before failing it.

**Evidence** — The created workspace; both temporary-password panels (redacted);
the agent's successful check-in; the audit log showing the three entries.

---

## E2E-LEAD-002 — From an enquiry to a paid commission

|                   |                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**        | Public → Sales → Real Estate → Finance                                                                                                                                                                                                                                |
| **Priority**      | **P0**                                                                                                                                                                                                                                                                |
| **Preconditions** | `manath-homes`, with SALES and REAL_ESTATE. A published public form. An allocation rule routing that form's source to branch BB by rotation. Sara available for new leads with no quota. A project with units. **The worker running.** T4 and T5 both `finance_admin` |
| **Test Data**     | Visitor `QA E2E Buyer`, `+971501234530`, `qa.e2e.buyer@example.com`, message `QA: 2BR in Marina, budget 1.8M`. Booking: sale value `1850000`, agency fee `37000`. Collection: `18500` then `18500`                                                                    |

| Stage | Signs in as                                      | Does                                                                                                                                                    |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **nobody** (public visitor, private window)      | Submits the public form at `/f/manath-homes/{formKey}` with the test data                                                                               |
| 2     | —                                                | Waits up to five minutes                                                                                                                                |
| 3     | **Team Leader** (`sales.manager@manathhomes.ae`) | Confirms the lead arrived, its source is **Website**, and it was **automatically assigned** to Sara by the rule                                         |
| 4     | **Agent** (`sales.rep@manathhomes.ae`)           | Confirms a **notification** arrived and a **first-contact task** exists                                                                                 |
| 5     | **Agent**                                        | Creates a call against the lead, records **verbal** consent, dials or simulates, completes it with outcome **interested**, notes `QA: wants Marina 2BR` |
| 6     | **Agent**                                        | Creates a follow-up due tomorrow                                                                                                                        |
| 7     | **Agent**                                        | Creates a **requirement**: 2–3 bedrooms, 1.5M–2.5M AED, Dubai Marina                                                                                    |
| 8     | **Agent**                                        | Creates a **proposal** from the matched listings and shares it                                                                                          |
| 9     | **nobody** (public visitor)                      | Opens `/p/{token}`, confirms the shortlist, expresses interest in one property                                                                          |
| 10    | **Agent**                                        | Requests a **site visit** for that property                                                                                                             |
| 11    | **RE Ops** (T13)                                 | Approves the site visit; the QR pass is issued                                                                                                          |
| 12    | **nobody**                                       | Opens the QR pass with no session                                                                                                                       |
| 13    | **RE Ops**                                       | Records the visit as attended                                                                                                                           |
| 14    | **RE Ops**                                       | Creates a **booking** in DRAFT with the test data, then **CONFIRM**s it                                                                                 |
| 15    | **Sales Manager** (`dhruv.menon@example.com`)    | Proposes an agency-fee amendment to `40000` with a reason                                                                                               |
| 16    | **Finance Admin** (T4)                           | Approves the amendment; the live fee becomes `40000`                                                                                                    |
| 17    | **Finance Admin** (T4)                           | Accrues commission on the confirmed booking; checks the figure by hand                                                                                  |
| 18    | **Finance Admin** (T5)                           | Confirms the commission (an approval)                                                                                                                   |
| 19    | **Finance Admin** (T4)                           | Records a collection receipt of `18500`                                                                                                                 |
| 20    | **Finance Admin** (T5)                           | Verifies it; the outstanding figure drops                                                                                                               |
| 21    | **Finance Admin** (T4)                           | Records a second receipt of `18500`; **T5** verifies it; outstanding reaches `0.00`                                                                     |
| 22    | **Finance Admin** (T4)                           | Builds a payout run                                                                                                                                     |
| 23    | **Finance Admin** (T5)                           | Approves the payout run and releases it                                                                                                                 |
| 24    | **Team Leader**                                  | Opens **Insights → Reports** and **CRM → Daily Activity** and confirms the whole chain is reflected                                                     |
| 25    | **Company Admin**                                | Opens the audit log and confirms every money action names its actor                                                                                     |

**Expected Result**

- Stage 2–3: assignment happens **on a queue**, honouring the rule, the quota and availability. A lead that is never assigned with the worker running is a defect; one that is not assigned the instant it is created is correct.
- Stage 4: the agent is notified and has a first-contact task — a lead that lands with nobody told is the failure this chain exists to prevent.
- Stage 5: **consent before recording**, always.
- Stage 9: the public shortlist shows the properties and **nothing internal**.
- Stage 12: the QR pass works with no session.
- Stage 14: commission cannot accrue before the booking is CONFIRMED.
- Stages 15–16: the Sales Director **proposes**; Finance **approves**. The proposer cannot decide.
- Stages 17–23: **every money step is done by one person and approved by another**, and in each case the person who did it cannot approve it. Run each refusal as part of the flow, not only in [05e](05e-real-estate.md): attempt stage 18 as T4, stage 20 as T4, and stage 23 as T4, and confirm all three are refused before handing them to T5.
- Stage 24: the reports and the daily board show the same chain the records do.
- Stage 25: the audit trail names a person for every money action.

**Where this workflow usually fails** — stage 3, when the worker is not running.
Check the worker before blaming the allocation rule.

**Evidence** — A timeline: each stage, who did it, when, and the record
reference. Plus the three refused self-approvals, with their messages.

---

## E2E-CALL-003 — A day of calling, from assignment to the manager's report

|                   |                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**        | Sales CRM                                                                                                                                                                                      |
| **Priority**      | **P0**                                                                                                                                                                                         |
| **Preconditions** | `manath-homes`. The worker running. Five leads assigned to the Telecaller (T12) and five to Sara. Daily targets set: T12 `5`, Sara `5`. An AI provider configured if the AI stages are to pass |
| **Test Data**     | Outcomes to use across the ten calls: `connected`, `no answer`, `busy`, `not interested`, `callback requested`, `interested`, `qualified`, `wrong number`, `voicemail`, `converted`            |

| Stage | Signs in as                                  | Does                                                                                   |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1     | **Company Admin**                            | Sets daily targets of `5` for T12 and Sara                                             |
| 2     | **Team Leader**                              | Assigns five leads to each                                                             |
| 3     | **Telecaller** (T12)                         | Confirms the five leads are on **My Leads**; confirms **Add lead** is absent           |
| 4     | **Telecaller**                               | Opens **Check-in**, checks in, and reads **Today's target: 0 of 5 leads called**       |
| 5     | **Telecaller**                               | Calls all five leads, completing each with a different outcome from the list           |
| 6     | **Telecaller**                               | Re-calls one of them a second time                                                     |
| 7     | **Telecaller**                               | Uploads a transcript on the `connected` call and runs **AI Analysis**                  |
| 8     | **Telecaller**                               | Creates a follow-up on the `callback requested` lead, due in 10 minutes                |
| 9     | **Telecaller**                               | Re-reads the check-in screen's target line                                             |
| 10    | **Agent** (Sara)                             | Does the same with her five, including one **cold-data** call logged as an activity    |
| 11    | **Agent**                                    | Converts that cold record into a lead and calls the lead the same day                  |
| 12    | **Telecaller**                               | Waits for the follow-up reminder (up to five minutes)                                  |
| 13    | **Team Leader**                              | Opens **CRM → Daily Activity → Today** and checks every number against the definitions |
| 14    | **Team Leader**                              | Opens Sara's per-seller page and T12's                                                 |
| 15    | **Team Leader**                              | Opens **Insights → Reports → Productivity** and **Team Activity**                      |
| 16    | **QA Manager** (`qa.manager@manathhomes.ae`) | Opens **Call Audits**, audits two calls over their AI scores, and exports calls        |
| 17    | **Telecaller**                               | Confirms they **cannot** open Reports                                                  |

**Expected Result**

- Stage 3: the Telecaller holds `leads:VIEW/EDIT @ OWN` and no CREATE.
- Stage 4 and 9: the check-in screen's target line matches the board.
- Stage 6: **the board's Called count does not increase.** `called` counts **distinct** leads, so a lead called twice counts once. If it becomes 6, that is a P1 defect that inflates every seller's day.
- Stage 11: the cold record and the lead it became **count once**, not twice.
- Stage 13: every number matches the definitions in [05c](05c-sales.md) `SALES-DAILY-001` step 8. `CONNECTED` legitimately appears in both **connected** and **warm**.
- Stage 12: the reminder arrives from `reminders-five-minutely`. With the worker stopped, record **Blocked**.
- Stage 15: the reports show the same people and the same figures as the board — any disagreement is a scope or aggregation defect.
- Stage 16: the QA manager can write an audit (that is why `call_qa` holds `calls:EDIT`) and can export.
- Stage 17: refused — the `Telecaller` configuration has no `reports`.

**Where this workflow usually fails** — stage 13, because the tester counted
attempted calls rather than distinct leads. Count the records yourself before
recording a Fail.

**Evidence** — A worksheet: your own tally of the underlying calls beside the
board's figures, for both sellers. Plus the check-in target line at stages 4 and 9.

---

## E2E-HR-004 — From a joiner to a payslip

|                   |                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**        | HRMS                                                                                                                                                                                                                                                                     |
| **Priority**      | **P0**                                                                                                                                                                                                                                                                   |
| **Preconditions** | `manath-homes` with HRMS. T1 `hr_admin`, T6 `dept_manager`, T3 `payroll_officer`, T4 `finance_admin`. A work location. The worker running. WPS identifiers **unset** at the start                                                                                        |
| **Test Data**     | Employee `QA E2E Joiner`, code `E2E-HR-001`, email `qa.e2e.joiner@example.com`, department `QA Department`, reporting manager T6, first day today. Shift `QA Day` 09:00–18:00. Salary: basic `10000`, housing `5000`, transport `1000`. Overtime: 3 hours. Leave: 2 days |

| Stage | Signs in as               | Does                                                                                          |
| ----- | ------------------------- | --------------------------------------------------------------------------------------------- |
| 1     | **HR Manager** (T1)       | Creates the user and employee record, assigns the work location, sets T6 as reporting manager |
| 2     | **HR Manager**            | Starts the onboarding checklist and completes one item                                        |
| 3     | **HR Manager**            | Creates the shift `QA Day` and rosters the joiner for the week                                |
| 4     | **HR Manager**            | Creates a holiday inside that week and confirms the roster reflects it                        |
| 5     | **Employee** (the joiner) | Signs in with the temporary password, changes it                                              |
| 6     | **Employee**              | Opens **Check-in**, confirms the assigned location and radius, checks in and later checks out |
| 7     | **Employee**              | Confirms **My Roster** shows their shifts and the holiday                                     |
| 8     | **Employee**              | Applies for 2 days of leave                                                                   |
| 9     | **Employee**              | Claims 3 hours of overtime                                                                    |
| 10    | **Dept Manager** (T6)     | Confirms **Waiting on you** shows the joiner's leave; approves it                             |
| 11    | **Dept Manager**          | Approves the overtime claim                                                                   |
| 12    | **Dept Manager**          | Confirms they see **only** their own team's requests                                          |
| 13    | **HR Manager**            | Raises and approves an attendance exception for a day with a missing check-out                |
| 14    | **Payroll Officer** (T3)  | Records the joiner's salary with **Record salary**                                            |
| 15    | **Payroll Officer**       | Adds a one-off **Addition** adjustment of `500`                                               |
| 16    | **Payroll Officer**       | Opens a payroll run for this month and clicks **Calculate**                                   |
| 17    | **Payroll Officer**       | Checks the payslip's arithmetic by hand, then **Submit for approval**                         |
| 18    | **Payroll Officer**       | **Attempts to approve the run** and records the refusal                                       |
| 19    | **Finance Admin** (T4)    | **Send back**s the run; T3 recalculates and resubmits                                         |
| 20    | **Finance Admin**         | **Approve**s, then **Lock**s, then **Mark paid**s the run                                     |
| 21    | **Finance Admin**         | Confirms the **WPS file** control is **disabled** with its tooltip                            |
| 22    | **Company Admin**         | Sets the WPS identifiers in **HR Policies**                                                   |
| 23    | **Finance Admin**         | Downloads the **WPS file** and confirms it is a file, not a JSON error                        |
| 24    | **Employee**              | Opens **My Payslips** and confirms their own payslip, with the overtime and the adjustment    |
| 25    | **Employee**              | Confirms they can see **no other** employee's payslip                                         |
| 26    | **Auditor** (T11)         | Reads the payroll run and the HR reports, and confirms salary figures are **masked**          |

**Expected Result**

- Stage 6: check-in works because of the assignment at stage 1.
- Stages 8–11: the request reaches the **right** approver. T6 approves for their own people; stage 12 confirms the boundary.
- Stage 14: a salary is a **new record**, never an edit.
- Stage 17: the payslip's arithmetic matches a hand calculation, rounded to two decimal places, **half up**.
- Stage 18: **refused** — _"Your role does not allow approving payroll."_ The preparer never releases.
- Stage 20: the chain is APPROVED → LOCKED → PAID; each step has its own control and its own precondition.
- Stage 21: the WPS link is offered **only once it can produce a file**; disabled, with the tooltip _"Set the WPS identifiers in HR policy first"_.
- Stage 23: a real file.
- Stages 24–25: the employee sees their own payslip and nobody else's.
- Stage 26: the auditor reads everything and sees **no** salary figure (no `VIEW_SENSITIVE_FIELDS`).

**Also run the sharpest variant** — temporarily grant T3 `payroll:APPROVE`, have
T3 prepare a run and attempt to approve it, and confirm the refusal
_"You prepared this run, so somebody else must approve it."_ The guard is on the
**person**, not the role. If that succeeds, stop and escalate: it is the most
serious defect in this suite.

**Evidence** — The payslip arithmetic worksheet; the refusal at stage 18 and in
the variant, verbatim; the disabled and then working WPS control; the auditor's
masked view.

---

## E2E-PROP-005 — From inventory to a verified collection

|                   |                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**        | Real Estate → Finance                                                                                                                                  |
| **Priority**      | P0                                                                                                                                                     |
| **Preconditions** | `manath-homes` with REAL_ESTATE **and SALES** (see the note). T13 `Real Estate Operations`. T4 and T5 `finance_admin`. A lead exists                   |
| **Test Data**     | Project `QA E2E Heights`, 10 units. Listing: 2 BR, 1,250 sq ft, `1850000` AED. Booking value `1850000`, fee `37000`. Collection `37000` in one receipt |

| Stage | Signs in as            | Does                                                                                            |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| 1     | **RE Ops** (T13)       | Creates the project and adds 10 units                                                           |
| 2     | **RE Ops**             | Adds a payment plan                                                                             |
| 3     | **RE Ops**             | Creates the listing against one unit, marked available                                          |
| 4     | **RE Ops**             | Confirms the availability figures on **Properties**                                             |
| 5     | **Agent**              | Creates a requirement for the lead and sees the listing matched                                 |
| 6     | **Agent**              | Requests a site visit                                                                           |
| 7     | **RE Ops**             | Approves the visit and records it attended                                                      |
| 8     | **RE Ops**             | Creates the booking against that unit and **CONFIRM**s it                                       |
| 9     | **RE Ops**             | Confirms the unit's availability changed                                                        |
| 10    | **Finance Admin** (T4) | Records a collection receipt of `37000`                                                         |
| 11    | **Finance Admin** (T4) | **Attempts to verify it** and records the refusal                                               |
| 12    | **Finance Admin** (T5) | Verifies it; outstanding reaches `0.00`                                                         |
| 13    | **Finance Admin** (T4) | Accrues commission; checks the figure by hand                                                   |
| 14    | **Finance Admin** (T5) | Confirms the commission                                                                         |
| 15    | **RE Ops**             | Confirms the booking, the collection and the commission are all visible from the booking's page |
| 16    | **Company Admin**      | Confirms the audit log names an actor for every money step                                      |

**Expected Result**

- Stage 4 and 9: availability is **derived from the unit inventory**, not typed. A booking that does not change availability is a defect.
- Stage 8: a booking must say who bought it and what was sold.
- Stage 11: **"You recorded this receipt. Someone else has to verify it."**
- Stage 12: outstanding reaches exactly `0.00` — not `-0.00` and not a residue.
- Stage 13: the commission matches the slab and the sale value.

**Note on entitlement** — this workflow requires the workspace to hold **SALES**,
because `POST /api/v1/bookings` asserts SALES only while Collections and
Commissions accept Sales **or** Real Estate. A Real-Estate-only brokerage cannot
complete stage 8. Run the workflow once in a SALES + REAL_ESTATE workspace, and
then attempt **stage 8 alone** in a REAL_ESTATE-only workspace and record the
403 — that is the finding in [12](12-coverage-and-gaps.md).

**Evidence** — The unit availability before and after stage 8; the refusal at
stage 11; the commission arithmetic worksheet; the audit entries.

---

## E2E-LE-006 — A Lead-Eagle-only brokerage, end to end

|                   |                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**        | Platform → Lead Eagle                                                                                                                      |
| **Priority**      | P0                                                                                                                                         |
| **Preconditions** | `LE-SETUP-001` is done: `qa-lead-eagle` exists with **Lead Eagle only**, a plan including it, and T18 as administrator. The worker running |
| **Test Data**     | LE Agent T19 (`sales_rep`), LE Manager (`branch_manager`), a branch, a team, two leads                                                     |

| Stage | Signs in as        | Does                                                                                      |
| ----- | ------------------ | ----------------------------------------------------------------------------------------- |
| 1     | **Platform Owner** | Confirms the workspace's modules are **Lead Eagle only**                                  |
| 2     | **LE Admin** (T18) | Signs in and confirms the landing is `/qa-lead-eagle/lead-eagle/dashboard`                |
| 3     | **LE Admin**       | Confirms the sidebar matches `LE-NAV-001`'s table exactly                                 |
| 4     | **LE Admin**       | Creates a branch, a team, the LE Manager and T19, and builds the `Telecaller` role        |
| 5     | **LE Admin**       | Creates a lead source, a lead stage marked default, and a custom field                    |
| 6     | **LE Agent** (T19) | Signs in at `/login?product=lead-eagle` and confirms the Lead Eagle branding              |
| 7     | **LE Agent**       | Creates a lead through **Lead Eagle → Leads**, following `SALES-LEAD-001`                 |
| 8     | **LE Agent**       | Creates a follow-up, a call with consent and an outcome, and a site visit                 |
| 9     | **LE Agent**       | Attempts a **proposal** and records the refusal                                           |
| 10    | **LE Agent**       | Attempts `/qa-lead-eagle/sales/campaigns` and records the refusal                         |
| 11    | **LE Agent**       | Opens **Check-in** and checks in                                                          |
| 12    | **LE Manager**     | Signs in, confirms their branch's leads are visible, reassigns one lead within the branch |
| 13    | **LE Manager**     | Opens **Lead Eagle → Reports** and **Targets**                                            |
| 14    | **LE Manager**     | Attempts to open **Allocation** and records the result                                    |
| 15    | **LE Admin**       | Opens **Administration → Settings → Audit Log** and confirms the chain                    |
| 16    | **LE Admin**       | Calls each endpoint in `LE-ENT-001` step 6 and records the statuses                       |

**Expected Result**

- Stage 2: a Lead-Eagle-only workspace lands on the Lead Eagle board, decided by the plan.
- Stage 3: the navigation carries Lead Eagle's areas plus Home, the single **My Tasks** CRM tab, Administration and Account — and nothing else.
- Stages 9–10: refused with the entitlement panel naming the carrying products.
- Stage 11: **check-in works without HRMS.**
- Stage 14: **Allocation needs `allocation:VIEW`, which `branch_manager` does not hold.** Expect it to be absent. A brokerage that wants its Lead Eagle manager to run allocation must grant it explicitly — record that as the configuration requirement for the "Lead Eagle Manager" persona.
- Stage 16: `LEAD_MODULES` endpoints work; `SALES_OR_REALTY` and SALES-only endpoints are 403.

**Evidence** — The landing URL; the full sidebar; the two refusal panels; the
stage-16 status table.

---

## E2E-PERM-007 — A permission change reaches a live session

|                    |                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| **Module**         | Authorization                                                                                      |
| **Priority**       | **P0**                                                                                             |
| **Preconditions**  | Two browsers: Company Admin in one, the Agent (Sara) in the other, both signed in. Sara owns leads |
| **Code Reference** | `src/lib/auth/actorCache.ts`, `src/lib/security/rbac.ts`                                           |

| Stage | Signs in as       | Does                                                                                                                      |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Agent**         | Signs in. Opens **CRM → Leads**, opens a lead, edits a field and saves. Confirms it works. **Leaves the lead page open.** |
| 2     | **Company Admin** | Removes `leads:EDIT` from the `Sales Representative` role. **Notes the exact time.**                                      |
| 3     | **Agent**         | Without reloading, edits the same field again and saves. **Notes the exact time and the result.**                         |
| 4     | **Agent**         | If it still worked, waits 60 seconds and retries. Notes the time.                                                         |
| 5     | **Agent**         | Reloads the page. Confirms the edit controls are gone.                                                                    |
| 6     | **Agent**         | Sends `PATCH /api/v1/leads/{id}` directly. Records the status.                                                            |
| 7     | **Company Admin** | Also removes `leads:VIEW`.                                                                                                |
| 8     | **Agent**         | Reloads. Confirms **CRM → Leads** is gone from the sidebar, and that the URL is refused.                                  |
| 9     | **Company Admin** | **Restores** both permissions.                                                                                            |
| 10    | **Agent**         | Reloads. Confirms access returns, and notes how long it took.                                                             |
| 11    | **Company Admin** | Changes Sara's **role** entirely, to `Read-Only User`.                                                                    |
| 12    | **Agent**         | Reloads. Confirms the navigation and the visible records both changed (TEAM scope now, not OWN).                          |
| 13    | **Company Admin** | **Deactivates** Sara's account.                                                                                           |
| 14    | **Agent**         | Acts. Records the result and the time.                                                                                    |
| 15    | **Company Admin** | Reactivates Sara and restores her role.                                                                                   |

**Expected Result**

- Stage 3: **the edit is refused immediately**, on the very next request. Any write to a model that feeds a user's authority invalidates the cache for the whole tenant, so no call site has to remember.
- Stage 4: if stage 3 somehow succeeded, the 60-second backstop must catch it. **More than 60 seconds is a defect** — the TTL exists only for changes made outside the application.
- Stage 6: **403** at the API, which is the real enforcement. A stale UI that still shows a button is a cosmetic lag; an API that still accepts the write is a P0 defect.
- Stage 10: restoring works just as promptly. **Test the widening direction too** — only the narrowing direction is usually tested, and a cache that clears on revoke but not on grant leaves a user locked out of what they were just given.
- Stage 12: a role change changes both the navigation and the **scope** of the records shown.
- Stage 14: deactivation ends access on the next request.

**Evidence** — Timestamps for stages 2, 3, 4, 9, 10, 13 and 14, and the exact
delay in each case. The API status from stage 6.

---

## E2E-CANCEL-008 — Cancelling a module

|                   |                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**        | Entitlement                                                                                                                                                                       |
| **Priority**      | **P0**                                                                                                                                                                            |
| **Preconditions** | A workspace with two modules and data in both. The platform owner in one browser, the Company Admin in another, signed in and **on a screen of the module about to be cancelled** |

| Stage | Signs in as        | Does                                                                                                                       |
| ----- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Company Admin**  | Confirms the module's screens work. Records what data exists. Leaves a tab open on one of its screens.                     |
| 2     | **Company Admin**  | Creates one more record in that module, so there is something recent.                                                      |
| 3     | **Platform Owner** | Removes the module from the workspace. **Notes the exact time.**                                                           |
| 4     | **Company Admin**  | In the open tab, triggers a navigation. **Notes the time and what appeared.**                                              |
| 5     | **Company Admin**  | Reloads the page directly.                                                                                                 |
| 6     | **Company Admin**  | Reads the refusal panel's exact wording.                                                                                   |
| 7     | **Company Admin**  | Calls the module's main API endpoint. Records the status and the body.                                                     |
| 8     | **Company Admin**  | Calls it every ten seconds for two minutes, recording when it first refuses.                                               |
| 9     | **Company Admin**  | Confirms the module is gone from the sidebar.                                                                              |
| 10    | **Company Admin**  | Opens **Administration → Settings → Modules** and confirms they **cannot** re-add it.                                      |
| 11    | **Company Admin**  | Tries a deep link to a specific record of that module, a bookmarked filtered list, and (if available) the mobile endpoint. |
| 12    | **Company Admin**  | Checks that the module's data does not appear in another module's reports, in an export, or in search results.             |
| 13    | **Platform Owner** | Cancels the whole subscription.                                                                                            |
| 14    | **Company Admin**  | Reloads. Records whether sign-in still works and what remains reachable.                                                   |
| 15    | **Platform Owner** | Restores the plan and the module.                                                                                          |
| 16    | **Company Admin**  | Confirms **all** the data from stages 1 and 2 is back, intact.                                                             |

**Expected Result**

- Stage 4 and 8: the refusal appears **within 60 seconds at the worst**, and in practice immediately — disabling a module clears the cache key outright rather than waiting for the TTL.
- Stage 6: **"{Screen} is part of {products}. This workspace's plan does not include it."** plus, for an administrator, _"The plan is set by your platform provider: ask them to add {products}."_ and a **Back to the dashboard** button. **Not** an error page, and **not** a silent redirect to the dashboard.
- Stage 7: **403**, naming the product(s).
- Stage 10: a workspace cannot grant itself a module.
- Stage 11: every path is refused, including the mobile one.
- Stage 12: no leakage through another module.
- Stage 14: record what happens. A sign-in that works but reaches nothing is acceptable; reaching a module the workspace no longer pays for is a **P0 defect**.
- Stage 16: **every record is intact.** Deleting a customer's data on cancellation would be catastrophic, and this stage is the only place in the suite that proves it does not happen.

**Evidence** — The refusal wording; the time of removal and of the first
refusal; the API status; **the data counts from stage 1 compared with stage 16**.
