# Section 5d — People / HRMS

Workspace: `manath-homes` (holds HRMS). Accounts, from
[04](04-environment-and-data.md) §4.7:

| Shorthand           | Account                | Role              | Scope                                   |
| ------------------- | ---------------------- | ----------------- | --------------------------------------- |
| **HR Manager**      | T1                     | `hr_admin`        | ORGANIZATION                            |
| **HR Executive**    | T2                     | `hr_executive`    | ORGANIZATION, no approvals, no salaries |
| **Payroll Officer** | T3                     | `payroll_officer` | ORGANIZATION, prepares only             |
| **Finance Admin**   | T4                     | `finance_admin`   | ORGANIZATION, approves only             |
| **Dept Manager**    | T6                     | `dept_manager`    | TEAM                                    |
| **Site Manager**    | T7                     | `site_manager`    | BRANCH                                  |
| **Employee**        | T9                     | `employee`        | OWN                                     |
| **Recruiter**       | T10                    | `recruiter`       | ORGANIZATION                            |
| **Auditor**         | T11                    | `auditor`         | ORGANIZATION, read-only                 |
| **Admin**           | `admin@manathhomes.ae` | `org_admin`       | ORGANIZATION                            |

T9 must have an employee record **and an active work-location assignment**
before any check-in case will run.

### The one thing to understand before testing People

The People screens serve **two audiences from one route**, scoped by role on the
server. The same URL is labelled **"My Leave"** for someone who sees only their
own records and **"Leave Requests"** for someone with oversight — never both,
and never a "My" label over other people's data. If you expected oversight and
see a "My" label, the account's `employee` grant is at OWN scope. That is
configuration, not a defect.

---

## HR-CHECKIN-001 — Check in and out, with the geofence

|                     |                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS (self-service)                                                                                                                                                                                       |
| **User Role**       | Employee (`employee`)                                                                                                                                                                                     |
| **Feature**         | Attendance check-in / check-out                                                                                                                                                                           |
| **Test Scenario**   | An employee records their own attendance, inside and outside the allowed radius                                                                                                                           |
| **Priority**        | P0                                                                                                                                                                                                        |
| **Preconditions**   | T9 has an employee record and **an active work-location assignment** (`QA Office`, radius 100 m, check-out rule `Same location`). The browser can provide a location. **No HRMS entitlement is required** |
| **Navigation Path** | **Home → My Workspace → Check-in**, or **People → My HR → Check-in** (`/manath-homes/check-in`)                                                                                                           |
| **Code Reference**  | `check-in/page.tsx`, `check-in/CheckInConsole.tsx`, `src/services/hr/attendance.ts`, `src/app/api/v1/workspaces/{slug}/hr/self`                                                                           |

**Test Steps**

1. Sign in as T9.
2. Open `/manath-homes/check-in`. Confirm the page heading reads **Check in**.
3. Confirm a live clock, a circular camera viewport, and three verdict tiles (live / identity / on site).
4. Confirm the **Record attendance** panel.
5. Under **Your assigned location(s)**, confirm it names `QA Office` with **allowed radius 100 m** and the rule **check out at the same location**.
6. Confirm the status line reads **Ready. Check in when you're on site.**
7. Confirm a **Retry location** button is present.
8. Grant the browser's location permission if asked.
9. Click **Check in**.
10. Confirm the panel reports success and the status line updates.
11. Confirm **Check in** is now **disabled**, with the tooltip **You already have an open check-in.**
12. Confirm **Check out** is now **enabled**.
13. Scroll to **Recent**. Confirm the table has columns **When**, **Type**, **Result**, **Location** and **Distance**, and that your check-in appears with **Type** = **Check in** and a distance in metres.
14. Click **Refresh** on the Recent panel and confirm it reloads.
15. Click **Check out**. Confirm it succeeds and **Check in** becomes enabled again.
16. Confirm the check-out row appears in **Recent** with **Type** = **Check out**.
17. Deny the browser's location permission, reload, and read the diagnostic line.
18. As Admin, remove T9's work-location assignment. Reload T9's check-in page.
19. Restore the assignment. As Admin, set the location's radius to `1` metre. As T9, attempt a check-in.
20. As T9, if there is pending work and an open check-in, confirm the button **Ask my manager for an early check-out** appears, and use it.
21. Confirm T9's own daily calling target is shown: **Today's target: {n} of {m} leads called** with a progress bar labelled **Today's calling target**, and either **— met** or **— {n} to go**.

**Expected Result**

- **Check-in needs no permission and no HRMS entitlement.** It is self-service, authorised by being the account in question. A brokerage licensing only Sales or Real Estate must still be able to use this screen — the page asserts no product module, deliberately, and it sits beside dashboard, tasks and notifications rather than under `people/`.
- **The browser is never trusted with the verdict.** The page does not hand the browser a coordinate: distance and the geofence decision are computed **server-side on every read**, because a client-reported position is exactly what an attacker would forge. Confirm the page's JavaScript never receives the office's coordinates.
- Exactly one check-in may be open at a time; the buttons enforce it with explanatory tooltips.
- Step 18: with no assignment, the panel says **"You have no active work-location assignment, so no check-in can be accepted. Ask HR to assign you a location."** and no check-in is possible. **This is correct, not a defect.**
- Step 19: outside the radius, the attempt is refused with the distance stated.

**Negative Scenarios**

| What to try                                                                        | Expected                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Two **Check in** clicks in quick succession                                        | **One** attendance record. Two is a P1 data-integrity defect                                                                                   |
| `POST` the self-service check-in endpoint with a forged coordinate in the body     | **Ignored.** The server computes the position itself. If a forged coordinate changes the verdict, that is a **P0 defect**                      |
| Check out at a different assigned location while the rule is **Same location**     | Refused                                                                                                                                        |
| Check out with the rule **Any assigned location**, from a second assigned location | Allowed                                                                                                                                        |
| Check out with the rule requiring an approved exception, without one               | Refused; direct the tester to **People → Attendance & Leave → Exceptions**                                                                     |
| Check out with no open check-in, by API                                            | Refused (the button is disabled with the tooltip **There is no open check-in to close.**)                                                      |
| Check in, then check in again tomorrow without checking out                        | Record the behaviour. An open check-in spanning days should be visible to HR as an exception                                                   |
| T9 calling `/{slug}/people/attendance` (everyone's attendance)                     | **Refused** — reading everyone else's attendance is behind `employee` **and** HRMS. Doing your own is self-service; managing the floor's is HR |
| A user with no employee record at all                                              | The page explains it rather than crashing                                                                                                      |

**Evidence** — The assigned-location panel; Recent with both rows and their distances; the refusal at radius 1 m with the distance stated; the page source showing no office coordinates.

---

## HR-CHECKIN-002 — Face check-in

|                     |                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                                                                                                                 |
| **User Role**       | Employee, then HR Manager                                                                                                                                                                                            |
| **Feature**         | Face verification                                                                                                                                                                                                    |
| **Test Scenario**   | Face check-in requires recorded biometric consent and an HR-performed enrolment, and fails safely when the service is down                                                                                           |
| **Priority**        | P1                                                                                                                                                                                                                   |
| **Preconditions**   | **Needs credentials.** The Python face sidecar is running with its models present. T9 has an employee record                                                                                                         |
| **Navigation Path** | **Account → Security** (`/manath-homes/profile/security`) for consent; **People → Employees → Directory →** an employee **→ Face enrolment** (`/manath-homes/people/employees/{employeeId}/face`); then **Check-in** |
| **Code Reference**  | `check-in/CheckInConsole.tsx` (the three blocked states), `people/employees/[employeeId]/face/page.tsx`, `people/face-activity/page.tsx`, `apps/face/main.py`                                                        |

**Test Steps**

1. Sign in as T9 **without** recording consent. Open `/manath-homes/check-in`.
2. Read the blocked message. Confirm it says **Record your biometric consent on the Security page before using face check-in.**
3. Confirm **Start camera**, **Check in** and **Check out** are all **disabled**.
4. Open **Account → Security**. Record biometric consent.
5. Return to Check-in. Read the blocked message now.
6. Confirm it says **Your face is not enrolled yet. HR does this in person.**
7. Sign in as **HR Manager** (T1). Open **People → Employees → Directory**, open T9, and open **Face enrolment** (the page is titled **Face enrolment**).
8. Complete the enrolment.
9. Sign in as T9. Open Check-in. Confirm no blocked message.
10. Click **Start camera**. Confirm the button then reads **Camera running** and is disabled.
11. Check in. Confirm the three verdict tiles resolve (live / identity / on site).
12. Open **People → Attendance & Leave → Face Activity** as T1. Confirm the page is titled **Face recognition activity** and your attempt is listed.
13. Stop the face sidecar. As T9, reload Check-in.
14. Read the blocked message. Confirm it says **Face check-in is unavailable while the verification service is down. Nothing is recorded until it returns.**
15. Confirm no attendance record was created during the outage.
16. Restart the sidecar and confirm recovery.
17. As T9, withdraw biometric consent on the Security page. Return to Check-in.

**Expected Result**

- Three distinct blocked states, each with its own message: **no consent**, **not enrolled**, **service down**. A single generic error for all three is a usability defect.
- **Enrolment is done by HR in person** — an employee cannot enrol their own face. If T9 can self-enrol, that is a P0 defect.
- Step 15: during an outage, **nothing is recorded**. A check-in that succeeds without verification while the service is down is a **P0 defect**: it is the whole promise of the message.
- Withdrawing consent returns the screen to the no-consent state, and face check-in stops working.
- Face activity is auditable by HR.

**Negative Scenarios**

| What to try                                                | Expected                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Submit a still photograph of another employee              | Refused by liveness. Record the verdict tiles              |
| Submit a photograph of T9's own photograph                 | Refused by liveness                                        |
| T9 opening another employee's **Face enrolment** page      | 404                                                        |
| T9 calling the face-enrolment endpoint for themselves      | Refused                                                    |
| The face service returning a malformed response            | Refused safely; nothing recorded                           |
| A check-in attempt while enrolled but outside the geofence | Refused on location, with the identity verdict still shown |

**Evidence** — A screenshot of each of the three blocked messages; the Face recognition activity entry; the attendance table during the outage showing no new row.

---

## HR-LEAVE-001 — Apply for leave

|                     |                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                |
| **User Role**       | Employee                                                                                                            |
| **Feature**         | Leave request                                                                                                       |
| **Test Scenario**   | An employee applies for leave against a balance, and the request reaches an approver                                |
| **Priority**        | P0                                                                                                                  |
| **Preconditions**   | T9 has an employee record, a leave balance, and a reporting manager (T6). HRMS is entitled                          |
| **Test Data**       | Leave type: any with a balance; first day: the next working day; last day: two days later; reason `QA annual leave` |
| **Navigation Path** | **People → Attendance & Leave → My Leave** (`/manath-homes/people/leave`)                                           |
| **Code Reference**  | `people/leave/page.tsx`, `people/leave/LeaveScreen.tsx`, `src/services/hr/leave.ts`                                 |

**Test Steps**

1. Sign in as T9.
2. Open **People → Attendance & Leave**. Confirm the tab is labelled **My Leave** (not **Leave Requests**), because T9 has no oversight.
3. Confirm the page is titled **Leave**.
4. Under **Your balance**, note each leave type and its remaining days.
5. Under **Apply**, confirm the fields **Leave type**, **First day**, **Last day** and **Reason (optional)**, and the submit button **Apply for leave**.
6. Choose a leave type with a balance.
7. Set **First day** to the next working day and **Last day** to two days later.
8. Enter `QA annual leave` in **Reason (optional)**.
9. Click **Apply for leave**. Confirm the button shows **Applying…**.
10. Confirm the note **Leave requested.** appears.
11. Under **Your requests**, confirm the request appears with columns **Type**, **From**, **To**, **Days**, **Status**, and a status of **PENDING**.
12. Confirm **Days** is calculated correctly for the dates chosen — note whether weekends and public holidays are excluded, and compare against **People → Attendance & Leave → Holidays**.
13. Confirm a **Withdraw** action is offered while the request is PENDING.
14. Confirm your **Your balance** figures have **not** yet changed (the request is not approved).
15. Sign in as **Dept Manager** (T6). Open the same screen. Confirm the tab is now labelled **Leave Requests** and a **Waiting on you** section lists T9's request with an **Employee** column.
16. Sign in as T9 and click **Withdraw** on the request. Confirm it leaves the pending list.

**Expected Result**

- Applying needs `leave:CREATE @ OWN`, which `employee` holds.
- The request is PENDING and visible to the employee and to their approver only.
- **Days** respects the workspace's holiday calendar and weekend configuration. A count that includes a public holiday is a P1 defect.
- The balance is not debited until approval.
- **Withdraw** works while PENDING.
- The same route is labelled by audience: **My Leave** for T9, **Leave Requests** for T6.

**Negative Scenarios**

| What to try                                    | Expected                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Last day** before **First day**              | Refused                                                                                      |
| Days exceeding the balance                     | Refused, naming the balance                                                                  |
| Dates overlapping an existing approved request | Refused (409)                                                                                |
| Dates entirely in the past                     | Record the behaviour; it should be allowed only if the workspace's policy permits backdating |
| Apply with the leave type blank                | Refused                                                                                      |
| Apply on behalf of another employee, by API    | **404** — `employee` holds OWN scope only                                                    |
| Withdraw a request that is already approved    | Refused                                                                                      |
| Withdraw another employee's request            | 404                                                                                          |
| In a workspace without HRMS                    | The whole People section is absent, and the URL is refused with the entitlement panel        |

**Evidence** — The balance before and after; the request row with its Days count beside the holiday calendar; the two different tab labels for T9 and T6.

---

## HR-LEAVE-007 — A department manager approves for their own team only

|                     |                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | HRMS                                                                                                                     |
| **User Role**       | Department Manager (`dept_manager`, TEAM)                                                                                |
| **Feature**         | Leave approval, scoped                                                                                                   |
| **Test Scenario**   | T6 approves their own team's leave and cannot see or decide anyone else's                                                |
| **Priority**        | **P0**                                                                                                                   |
| **Preconditions**   | T6 manages T9. A second employee outside T6's team has a PENDING leave request                                           |
| **Navigation Path** | **People → Attendance & Leave → Leave Requests**                                                                         |
| **Code Reference**  | `prisma/seed/roles.ts` — the `dept_manager` block: _"Approves for their own people only. The scope is the whole point."_ |

**Test Steps**

1. Sign in as T6.
2. Open **People → Attendance & Leave → Leave Requests**.
3. Under **Waiting on you**, confirm **only** T9's request is listed.
4. Confirm the outside employee's request is **not** listed.
5. Click **Approve** on T9's request.
6. Confirm the status becomes approved and T9's balance is debited.
7. Create a second request as T9. As T6, click **Reject**.
8. Confirm a reason field appears with the placeholder **Why are you rejecting this?** Enter `QA: insufficient cover`.
9. Submit. Confirm the status becomes rejected and the reason is recorded.
10. Confirm T9 sees the rejection and the reason.
11. Note the outside employee's request ID. As T6, send the approval request for it directly to the API. Record the status.
12. Sign in as **Site Manager** (T7, BRANCH). Confirm they see every BB employee's request, including people who do not report to them.
13. Sign in as **HR Manager** (T1, ORGANIZATION). Confirm they see every request in the workspace.
14. Sign in as **HR Executive** (T2). Confirm **no** approve or reject control is offered.

**Expected Result**

- T6 sees and decides **only** their own people's requests.
- Step 11 returns **404**.
- T7 has the same authority **drawn around a place rather than a team** — which is how a site with mixed reporting lines works.
- T1 decides for the whole company.
- **T2 cannot approve anything**: `hr_executive` is day-to-day HR with _"no approvals and no salaries"_.
- A rejection carries a reason, and the employee can read it.

**Negative Scenarios**

| What to try                              | Expected                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| T6 approving their **own** leave request | Record the behaviour. Self-approval should be refused; if it succeeds, raise it as a P1 separation-of-duty finding |
| T6 approving a request twice             | The second is refused (409)                                                                                        |
| Reject with the reason blank             | Record whether the reason is required                                                                              |
| T9 approving their own request           | 403 — `employee` holds no `leave:APPROVE`                                                                          |

**Evidence** — T6's **Waiting on you** list beside the full list T1 sees; the status from step 11; the recorded rejection reason.

---

## HR-LEAVE-008 — HR Executive has no approvals and no salaries

|                    |                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **Module**         | HRMS                                                                                                |
| **User Role**      | HR Executive (`hr_executive`)                                                                       |
| **Feature**        | Role boundary                                                                                       |
| **Test Scenario**  | T2 maintains records and requests and decides nothing, and sees no pay                              |
| **Priority**       | P0                                                                                                  |
| **Preconditions**  | T2 exists as `hr_executive`                                                                         |
| **Code Reference** | `prisma/seed/roles.ts` — _"Day-to-day HR: records and requests, but no approvals and no salaries."_ |

**Test Steps**

1. Sign in as T2.
2. Confirm **People** is fully present: Employees (Directory, Onboarding, Offboarding, Lifecycle, Departments, Compliance), Attendance & Leave, Recruitment, Performance.
3. Confirm **Payroll** is **absent** from the sidebar.
4. Navigate to `/manath-homes/people/payroll`. Record the result.
5. Create an employee record. Confirm it works (`employee:CREATE`).
6. Edit an employee record. Confirm it works.
7. Open an employee and look for salary or compensation figures. Record what you see.
8. Attempt to approve a leave request, an attendance exception and an overtime claim. Confirm each is refused.
9. Attempt to create a leave request on an employee's behalf. Confirm it works (`leave:CREATE`).
10. Open **People → Employees → Documents**. Confirm it works (`hr_documents:CREATE/EDIT`).
11. Attempt to delete an HR document. Confirm it is refused (no `hr_documents:DELETE`).
12. Attempt to create a holiday. Confirm it is refused (`holidays:VIEW` only).
13. For each refusal above, send the corresponding API request and record the status.

**Expected Result**

- Records and requests: yes. **Approvals: none. Salaries: none.**
- Step 4: refused (no `payroll` grant at all).
- Step 7: **no salary figure is visible**, not even masked, because `hr_executive` holds no `payroll` grant and no `employee:VIEW_SENSITIVE_FIELDS`.
- Every API attempt in step 13 returns 403.

**Negative Scenarios** — Any successful approval, or any visible salary figure, is a P0 defect.

**Evidence** — The sidebar without Payroll; the employee record with no compensation; a table of endpoint → status.

---

## HR-ATT-001 — Attendance oversight, exceptions and overtime

|                     |                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                         |
| **User Role**       | HR Manager, Department Manager, Employee                                                                                     |
| **Feature**         | Attendance records, exceptions, overtime                                                                                     |
| **Test Scenario**   | HR reviews the floor's attendance, approves an exception, and handles an overtime claim                                      |
| **Priority**        | P1                                                                                                                           |
| **Preconditions**   | T9 has at least three days of attendance, including one day with a missing check-out and one day with hours beyond the shift |
| **Navigation Path** | **People → Attendance & Leave → Attendance / Exceptions / Overtime**                                                         |
| **Code Reference**  | `people/attendance/page.tsx`, `people/requests/page.tsx`, `people/overtime/page.tsx`, `src/services/hr/attendance.ts`        |

**Test Steps**

1. Sign in as **HR Manager** (T1).
2. Open **People → Attendance & Leave → Attendance** (`/manath-homes/people/attendance`). Confirm the page is titled **Attendance**.
3. Confirm the table has columns including **Employee**, **Date**, **First in**, **Last out**, **Worked**, **Location** and **Status**.
4. Use **Search this period** and the **From** / **To** filters. Confirm they work.
5. Find T9's day with the missing check-out. Note how it is shown.
6. Open **Exceptions** (`/manath-homes/people/requests`). Confirm T9's exception request appears if one was raised.
7. Approve it, using **Approve** or **Approve as time off**. Note which applies.
8. Confirm T9's attendance record is corrected.
9. Open **Overtime** (`/manath-homes/people/overtime`). Confirm sections for **Claims** and **Awaiting your decision**, and controls **Claim overtime**, **Submit claim** and **Detect from attendance** / **Scan the last 30 days**.
10. Click **Scan the last 30 days**. Confirm detected overtime is proposed from the attendance records.
11. Approve one overtime claim.
12. Sign in as T9. Open **People → Attendance & Leave**. Confirm T9 sees **only their own** attendance and overtime.
13. Sign in as T6 (`dept_manager`). Confirm they see their team's attendance and can approve for them.
14. Sign in as **Finance Admin** (T4). Confirm they can approve overtime (`overtime:APPROVE`) but cannot see the attendance screens (no `attendance` grant).

**Expected Result**

- Attendance oversight is behind `employee` + HRMS; an employee sees only their own.
- An exception, once approved, corrects the attendance record and is auditable.
- **Detect from attendance** proposes overtime from the records rather than requiring manual entry, and a detected claim still needs approval.
- Approval authority: `hr_admin` org-wide, `site_manager` by branch, `dept_manager` by team, `finance_admin` for overtime only.

**Negative Scenarios**

| What to try                                                        | Expected                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| Approve an overtime claim twice                                    | Refused                                                |
| An overtime claim of negative hours                                | Refused                                                |
| An overtime claim of 24 hours in a day                             | Record the behaviour; a plausible ceiling should apply |
| T9 approving their own overtime                                    | 403                                                    |
| T2 (`hr_executive`) approving overtime                             | 403 — `overtime:CREATE` but no APPROVE                 |
| An exception approved for an employee outside the approver's scope | 404                                                    |
| **Scan the last 30 days** run twice                                | No duplicate claims                                    |

**Evidence** — The attendance row before and after the exception; the detected overtime proposals; a table of role → approval outcome.

---

## HR-SHIFT-001 — Shifts, rosters and holidays

|                     |                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | HRMS                                                                                                                     |
| **User Role**       | HR Manager, then Employee                                                                                                |
| **Feature**         | Shifts, rosters, holiday calendar                                                                                        |
| **Test Scenario**   | A shift is defined, assigned on a roster, copied forward, and visible to the employee                                    |
| **Priority**        | P1                                                                                                                       |
| **Preconditions**   | Signed in as T1. T9 has an employee record                                                                               |
| **Test Data**       | Shift `QA Day`, opening time `09:00`, closing time `18:00`. A holiday `QA National Day` on a date inside the roster week |
| **Navigation Path** | **People → Attendance & Leave → Shifts / Rosters / Holidays**                                                            |
| **Code Reference**  | `people/shifts/page.tsx`, `people/roster/page.tsx`, `people/holidays/page.tsx`                                           |

**Test Steps**

1. Sign in as T1. Open **Shifts** (`/manath-homes/people/shifts`). Confirm the title **Shifts**.
2. Create `QA Day` with **Opening time** `09:00` and **Closing time** `18:00`.
3. Open **Rosters** (`/manath-homes/people/roster`). Assign `QA Day` to T9 for the coming week using **Assign shifts**.
4. Use **Copy to next week**. Confirm the following week is populated.
5. Use the roster's remove control (the **×** button; confirm it has an accessible name that says what it removes, not "multiplication sign").
6. Open **Holidays** (`/manath-homes/people/holidays`). Confirm the title **Holidays**. Create `QA National Day` inside the roster week.
7. Reload the roster. Confirm the holiday is reflected.
8. Sign in as T9. Open **People → My HR → My Roster** (`/manath-homes/people/roster`). Confirm the tab is labelled **My Roster** and shows T9's own shifts only.
9. Confirm T9 can see the holiday calendar (`holidays:VIEW @ ORGANIZATION` — the public holiday calendar is the same for everyone).
10. On the day of the shift, as T9, check in before `09:00` and then after `09:00`, and compare how each is recorded.
11. Sign in as T7 (`site_manager`). Confirm they can create and edit shifts for branch BB.
12. Sign in as T6 (`dept_manager`). Confirm they can **edit** shifts for their team but not create them (`shifts:VIEW/EDIT @ TEAM`, no CREATE).

**Expected Result**

- Shifts and rosters are HR configuration; an employee reads their own.
- **Holidays are organisation-wide for every role, including `employee`** — a public holiday calendar is the same for everyone.
- Late and early check-ins are recorded against the shift, and the attendance status reflects it.
- `dept_manager` can adjust a roster, not invent shifts.

**Negative Scenarios**

| What to try                                        | Expected                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A closing time before the opening time             | Record the behaviour — an overnight shift may be legitimate; confirm which the product intends |
| Two overlapping shifts for one employee on one day | Refused, or flagged — record which                                                             |
| A holiday with no date                             | Refused                                                                                        |
| Two holidays on the same date                      | Record the behaviour                                                                           |
| T9 editing their own roster                        | 403                                                                                            |
| **Copy to next week** run twice                    | No duplicate assignments                                                                       |

**Evidence** — The roster before and after the copy; T9's **My Roster**; the attendance record for the early and late check-ins.

---

## HR-PAY-001 — Prepare a payroll run

|                     |                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                            |
| **User Role**       | Payroll Officer (`payroll_officer`)                                                                             |
| **Feature**         | Payroll run preparation                                                                                         |
| **Test Scenario**   | A run is opened, calculated and submitted for approval, and the preparer cannot approve it                      |
| **Priority**        | **P0**                                                                                                          |
| **Preconditions**   | T3 exists as `payroll_officer`. At least two employees have a recorded salary. T4 exists as `finance_admin`     |
| **Test Data**       | Period start: the first of this month; period end: the last of this month; note `QA run`                        |
| **Navigation Path** | **People → Payroll → Payroll Runs** (`/manath-homes/people/payroll`)                                            |
| **Code Reference**  | `people/payroll/page.tsx`, `src/services/hr/payroll.ts` (`isPayrollOfficer`, `isPayrollApprover`, `approveRun`) |

**Test Steps**

1. Sign in as T3. Open **People → Payroll**.
2. Confirm the **Open a run** section, and read its note: **Whoever prepares a run cannot approve it.**
3. Confirm its fields: **Period start** (required, date), **Period end** (required, date), **Note**, and the submit button **Open run**.
4. Before opening a run, go to **Record compensation**. Read its note: _"A raise is a new record, never an edit. Past runs keep the salary that was in force when they were calculated."_
5. Confirm its fields: **Employee** (required), **Effective from** (required, date), **Basic** (required, number), **Housing allowance**, **Transport allowance**, **Other allowances**, **Reason for the change**, and the submit button **Record salary**.
6. Record a salary for one employee: basic `10000`, housing `5000`, transport `1000`.
7. Go to **One-off adjustment**. Read its note: _"A bonus, commission, reimbursement or deduction, paid once by the run that covers its date."_
8. Add an **Addition** adjustment for that employee, effective inside the period, using **Add adjustment**.
9. Open a run with the test data. Click **Open run**.
10. Under **Runs**, confirm the table has columns **Period**, **Status**, **Payslips**, **Gross**, **Net**, **Prepared by**, **Approved by** and **Actions**.
11. Confirm the new run's **Status** is **DRAFT** and **Prepared by** names T3.
12. Click **Calculate**. Confirm payslips are produced and **Gross** and **Net** are populated.
13. Check one payslip's arithmetic by hand: basic + allowances + the adjustment, less deductions. Confirm it matches.
14. Click **Submit for approval**. Confirm the status becomes **PENDING_APPROVAL**.
15. Confirm **Approve**, **Send back**, **Lock** and **Mark paid** are **not** offered to T3.
16. Send the payroll-approval request directly to the API as T3. **Record the status and the message.**
17. Confirm no **WPS file** link is active while the run is PENDING_APPROVAL.

**Expected Result**

- `payroll_officer` is `payroll:EDIT` at ORGANIZATION — enough to open, calculate and submit.
- **Status flows DRAFT → PENDING_APPROVAL → APPROVED → LOCKED → PAID.** Only the approver moves it past PENDING_APPROVAL.
- Step 16: refused with _"Your role does not allow approving payroll."_ — `payroll_officer` holds **no APPROVE anywhere, on purpose**.
- A raise is a **new compensation record**, never an edit. Past runs keep the salary in force when they were calculated: changing a salary must not retroactively alter a calculated run.
- The arithmetic in step 13 matches, with rounding to two decimal places, half up.

**Negative Scenarios**

| What to try                                           | Expected                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Basic pay of `0`                                      | Refused: _"Basic pay must be greater than zero."_                            |
| A negative housing, transport or other allowance      | Refused: _"{Label} cannot be negative."_                                     |
| Period end before period start                        | Refused                                                                      |
| Two runs covering the same period                     | Refused, or flagged — record which                                           |
| **Calculate** on a run already PENDING_APPROVAL       | Refused                                                                      |
| **Calculate** twice on a DRAFT run                    | Recalculates; it must not double the figures                                 |
| An employee with no recorded salary                   | Excluded, or listed as an error — never silently paid zero without saying so |
| A compensation record effective **after** the period  | Not used by this run                                                         |
| A compensation record effective **inside** the period | Record how the product prorates — and check the arithmetic                   |
| As `hr_admin` (T1)                                    | `payroll:VIEW` only: can read runs, cannot open or calculate one             |
| As `hr_executive` (T2)                                | Refused entirely                                                             |
| As `employee` (T9)                                    | Sees only their **own** payslips, via **People → My HR → My Payslips**       |

**Evidence** — The run at each status with **Prepared by** / **Approved by**; your hand-checked payslip arithmetic; the exact message from step 16.

---

## HR-PAY-008 — Only the approver releases a run, and never their own

|                     |                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                                                                                          |
| **User Role**       | Finance Administrator (`finance_admin`), then Payroll Officer                                                                                                                                 |
| **Feature**         | Payroll approval, separation of duty                                                                                                                                                          |
| **Test Scenario**   | The approver signs off a run they did not prepare, and cannot sign off one they did                                                                                                           |
| **Priority**        | **P0**                                                                                                                                                                                        |
| **Preconditions**   | `HR-PAY-001` has left a run at PENDING_APPROVAL, prepared by T3. T4 exists as `finance_admin`. The WPS identifiers are **not** yet set in HR policy                                           |
| **Navigation Path** | **People → Payroll → Payroll Runs**                                                                                                                                                           |
| **Code Reference**  | `src/services/hr/payroll.ts` (`approveRun`) — the guard is _"on the person rather than on the role — an officer who also holds the approval permission still cannot approve their own work."_ |

**Test Steps**

1. Sign in as T4. Open **People → Payroll**.
2. Confirm **Open a run**, **Record compensation** and **One-off adjustment** are **absent** (T4 is not an officer).
3. Find the PENDING_APPROVAL run. Confirm **Approve** and **Send back** are offered.
4. Click **Send back**. Confirm the status returns to **DRAFT** and a note can be recorded.
5. Sign in as T3, recalculate, and submit for approval again.
6. Sign in as T4. Click **Approve**. Confirm the status becomes **APPROVED** and **Approved by** names T4.
7. Confirm **Lock** is now offered. Click it. Confirm the status becomes **LOCKED**.
8. Confirm **Mark paid** is now offered. Click it. Confirm the status becomes **PAID**.
9. On the APPROVED, LOCKED and PAID run, find the **WPS file** control.
10. With the WPS identifiers unset, confirm the control is **disabled** with the tooltip **Set the WPS identifiers in HR policy first**, and that clicking it does nothing.
11. As Admin, set the WPS identifiers in **Administration → Settings → HR Policies** (`/manath-homes/people/settings`).
12. Reload. Confirm **WPS file** is now an active download, titled **Download the WPS salary file**. Download it and confirm it is a file, not a JSON error document.
13. **Now the separation-of-duty test.** As Admin, temporarily grant T3 `payroll:APPROVE` at ORGANIZATION as well as `payroll:EDIT`.
14. Sign in as T3. Open a **new** run, calculate it, and submit it for approval.
15. As T3 — who now holds the approval permission — click **Approve** on the run **T3 prepared**.
16. **Record the exact message.**
17. Sign in as T4 and approve that run instead. Confirm it succeeds.
18. As Admin, remove the temporary `payroll:APPROVE` from T3 and confirm it is gone.

**Expected Result**

- `finance_admin` approves and releases; it cannot prepare.
- The full status chain works: DRAFT → PENDING_APPROVAL → APPROVED → LOCKED → PAID.
- Step 10: the **WPS file** control is offered **only once it can actually produce a file**. _(It once rendered regardless, and on a workspace that had not set its WPS identifiers — the default — clicking it replaced the whole application with a raw JSON problem document the user had to use the browser's Back button to escape. If you see that, it has regressed.)_
- Step 16: refused with _"You prepared this run, so somebody else must approve it."_ **The guard is on the person, not the role.** A role-only check would let a single account with both permissions prepare and release its own payroll — and if step 15 succeeds, that is the most serious defect in this suite.
- Only a run **awaiting approval** can be decided: approving an APPROVED or DRAFT run is refused with _"Only a run awaiting approval can be decided."_
- Every transition is audited.

**Negative Scenarios**

| What to try                                                 | Expected                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Approve a run in DRAFT                                      | Refused                                                                               |
| Approve a run in PAID                                       | Refused                                                                               |
| **Lock** a run that is not APPROVED                         | Refused                                                                               |
| **Mark paid** a run that is not LOCKED                      | Refused                                                                               |
| Edit a payslip on a LOCKED run                              | Refused                                                                               |
| Delete a PAID run                                           | Refused                                                                               |
| `POST` the approval endpoint for a run in another workspace | 404                                                                                   |
| As `auditor` (T11)                                          | `payroll:VIEW` only, and salary figures should be masked (no `VIEW_SENSITIVE_FIELDS`) |
| The WPS download as an employee                             | 403                                                                                   |

**Evidence** — The run's status and **Approved by** at each step; a screenshot of the disabled **WPS file** control with its tooltip, and of the working download; the **exact wording** from step 16.

---

## HR-EMP-001 — Employee directory, onboarding and offboarding

|                     |                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                                        |
| **User Role**       | HR Manager                                                                                                                                  |
| **Feature**         | Employee lifecycle                                                                                                                          |
| **Test Scenario**   | An employee is onboarded with a checklist and offboarded with a notice period and a last working day                                        |
| **Priority**        | P1                                                                                                                                          |
| **Preconditions**   | Signed in as T1. An employee record exists for a disposable test account                                                                    |
| **Test Data**       | Notice given on today; notice period `30` days; last working day 30 days hence                                                              |
| **Navigation Path** | **People → Employees → Directory / Onboarding / Offboarding / Lifecycle / Departments / Compliance**                                        |
| **Code Reference**  | `people/employees/`, `people/onboarding/page.tsx`, `people/offboarding/page.tsx`, `people/lifecycle/page.tsx`, `people/compliance/page.tsx` |

**Test Steps**

1. Sign in as T1. Open **People → Employees → Directory** (`/manath-homes/people/employees`).
2. Use **Search employees**. Confirm it filters.
3. Open an employee. Confirm the record shows **Department**, **Designation**, **Branch / office**, **Employment type**, **Reporting manager**, **Phone** and **Account status**.
4. Open **Onboarding** (`/manath-homes/people/onboarding`). Confirm the title **Onboarding**.
5. Use **Start onboarding checklist** on the test employee. Confirm tasks appear with a **Task** column and an **Acknowledge** action.
6. Complete one checklist item.
7. Open **Lifecycle** (`/manath-homes/people/lifecycle`). Confirm the title **People** and that the employee's stage is visible.
8. Open **Departments** (`/manath-homes/people/departments`). Confirm the title **Departments**. Create `QA Department` and assign the test employee to it.
9. Open **Compliance** (`/manath-homes/people/compliance`). Confirm the title **Compliance**. Note what it tracks (document expiry, visa, and similar) and whether the test employee has outstanding items.
10. Open **Documents** (`/manath-homes/people/documents`). Upload a document against the employee with an **Expires** date in the past.
11. Return to **Compliance** and confirm the expired document is flagged.
12. Open **Offboarding** (`/manath-homes/people/offboarding`). Confirm the title **Offboarding**.
13. Confirm the fields **Notice given on**, **Notice period (days)** and **Last working day (optional)**.
14. Offboard the test employee with the test data.
15. Confirm their status moves towards **EXITED**, and note the **Exits** figure.
16. Confirm their open work (leads, tasks) is identified so it can be handed over — cross-check `ADMIN-USER-002`.
17. On the last working day (or by setting it to today), confirm the account's access ends.
18. Confirm the employee's historic records survive: their past attendance, leave, payslips and the leads they owned.

**Expected Result**

- Onboarding is a checklist with acknowledgements, not a single flag.
- Compliance surfaces expiring and expired documents.
- Offboarding records the notice and the last working day; access ends on the last working day, not on the day the notice is entered.
- **Historic records survive an exit.** Losing an exited employee's payslips, attendance or audit entries is a **P0 data-loss defect**.
- Open work is surfaced for hand-over rather than silently orphaned.

**Negative Scenarios**

| What to try                                   | Expected                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A last working day **before** the notice date | Refused                                                                                             |
| A negative notice period                      | Refused                                                                                             |
| Offboard an already-exited employee           | Refused                                                                                             |
| Offboard yourself                             | Record the behaviour; locking the last HR administrator out is a defect                             |
| Re-activate an exited employee                | Record whether it is possible, and what happens to their history                                    |
| As T2 (`hr_executive`)                        | Can create and edit employee records; confirm whether offboarding is allowed (no `employee:DELETE`) |
| As T6 (`dept_manager`)                        | Sees their team's records only; cannot offboard                                                     |
| As `recruiter` (T10)                          | `employee:VIEW` only                                                                                |

**Evidence** — The onboarding checklist; the compliance flag for the expired document; the offboarding record; the exited employee's surviving history.

---

## HR-REC-001 — Recruitment pipeline

|                     |                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                            |
| **User Role**       | Recruiter, then HR Manager                                                                                      |
| **Feature**         | Requisitions, candidates, stages, interviews, offers                                                            |
| **Test Scenario**   | A requisition is raised, a candidate moves through the pipeline, and an offer is created                        |
| **Priority**        | P2                                                                                                              |
| **Preconditions**   | T10 exists as `recruiter`. T1 exists as `hr_admin`                                                              |
| **Test Data**       | Requisition for `QA Analyst` in `QA Department`; candidate `QA Candidate One`, email `qa.candidate@example.com` |
| **Navigation Path** | **People → Recruitment** (`/manath-homes/people/recruitment`)                                                   |
| **Code Reference**  | `people/recruitment/page.tsx`, `src/services/hr/`                                                               |

**Test Steps**

1. Sign in as T10. Open **People → Recruitment**. Confirm the title **Recruitment**.
2. Use **Create requisition** for `QA Analyst`.
3. Use **Add candidate** to add `QA Candidate One`.
4. Use **Move stage** to advance the candidate one stage. Confirm the stage changes.
5. Use **Schedule** to schedule an interview.
6. Use **Submit feedback** to record interview feedback.
7. Use **Create offer**. Confirm the offer is created in a pending state.
8. Confirm the offer states **Accepted** / **Declined** / **Mark sent** actions where applicable.
9. Attempt to **approve** the offer as T10. Record the result.
10. Sign in as T1. Approve the offer (`recruitment:APPROVE`).
11. Mark the offer sent, then accepted.
12. Confirm the accepted candidate can be converted into an employee, or that the next step is clearly signposted.
13. Attempt to open the candidate's sensitive fields as T10 and as T1. Compare.

**Expected Result**

- `recruiter` holds `recruitment:VIEW/CREATE/EDIT/EXPORT` — enough to run the pipeline.
- **`recruiter` holds no APPROVE.** Step 9 is refused: _the recruiter who moves a candidate cannot decide the offer_ — the offer decision is HR policy.
- `hr_admin` holds `recruitment:APPROVE`.
- `recruitment` carries `VIEW_SENSITIVE_FIELDS`; confirm which role sees candidate sensitive data. `recruiter`'s seeded grants do **not** include it, so expect masking for T10.

**Negative Scenarios**

| What to try                                 | Expected                                           |
| ------------------------------------------- | -------------------------------------------------- |
| An offer on a candidate with no requisition | Refused                                            |
| Two offers on one candidate                 | Refused, or the first is superseded — record which |
| Move a candidate backwards                  | Record whether it is allowed                       |
| Accept an offer that was never sent         | Refused                                            |
| As `hr_executive` (T2)                      | Create and edit, no approve                        |
| As `employee`                               | Refused; Recruitment is absent                     |

**Evidence** — The candidate at each stage; the refusal from step 9; the approved offer.

---

## HR-PERF-001 — Performance cycles and reviews

|                     |                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                                                                |
| **User Role**       | HR Manager, Department Manager, Employee                                                                            |
| **Feature**         | Performance management                                                                                              |
| **Test Scenario**   | A cycle is opened, goals set, self-assessment and manager review submitted, calibration and a final rating recorded |
| **Priority**        | P2                                                                                                                  |
| **Preconditions**   | T1, T6 and T9 exist. T6 manages T9                                                                                  |
| **Navigation Path** | **People → Performance** (`/manath-homes/people/performance`)                                                       |
| **Code Reference**  | `people/performance/page.tsx`                                                                                       |

**Test Steps**

1. Sign in as T1. Open **People → Performance**. Confirm the title **Performance**.
2. Use **Seed competency framework** if the workspace has none.
3. Use **Create cycle**, then **Open cycle**.
4. Use **Add goal** to set a goal for T9.
5. Sign in as T9. Confirm the goal is visible and that **Submit self-assessment** is offered.
6. Submit a self-assessment.
7. Sign in as T6. Confirm **Submit manager review** is offered for T9 and submit one.
8. Sign in as T1. Use **Move to calibration**.
9. Use **Set final rating** to record a rating.
10. Use **Close cycle**.
11. Sign in as T9. Confirm they can read their own rating and cannot change it after the cycle closed.
12. Attempt, as T9, to read another employee's rating.

**Expected Result**

- `employee` holds `performance:VIEW/EDIT @ OWN` — enough for a self-assessment, not for anyone else's.
- `dept_manager` holds `performance:VIEW/CREATE/EDIT @ TEAM` — enough to review their own people.
- `hr_admin` holds APPROVE — the calibration and final rating.
- After a cycle closes, the record is read-only.
- Step 12 returns 404.

**Negative Scenarios**

| What to try                                 | Expected                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| A manager review before a self-assessment   | Record whether the order is enforced                       |
| A final rating outside the scale            | Refused                                                    |
| Reopen a closed cycle                       | Record whether it is possible, and whether ratings survive |
| T6 reviewing an employee outside their team | 404                                                        |
| T9 setting their own final rating           | 403                                                        |

**Evidence** — The cycle at each stage; T9's read-only closed rating; the status from step 12.

---

## HR-SCOPE-003 — A manager with no team sees only themselves and their reports

|                    |                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**         | HRMS                                                                                                                                 |
| **User Role**      | Team-scoped manager with **no team** (T16)                                                                                           |
| **Feature**        | Scope resolution edge case                                                                                                           |
| **Test Scenario**  | TEAM scope with no team resolves to the user plus anyone reporting to them                                                           |
| **Priority**       | P1                                                                                                                                   |
| **Preconditions**  | T16 exists with a TEAM-scoped role and **no team membership and no direct reports**                                                  |
| **Code Reference** | `src/lib/security/visibility.ts` — `case 'TEAM'`: _"if (ctx.actor.teamIds.length === 0) return [self, ...ctx.actor.managedUserIds]"_ |

**Test Steps**

1. Confirm T16 is in no team and has no direct reports.
2. Sign in as T16. Open every list screen their role reaches.
3. Record each count.
4. As Admin, make T9 report to T16 (set T9's **Reporting manager** to T16) — but still put T16 in **no team**.
5. In T16's session, reload.
6. Record the counts again.
7. As Admin, add T16 to a team with three members. Reload T16's lists.
8. As Admin, add a **child** team under that team with one more member. Reload.

**Expected Result**

- Step 3: T16 sees **only their own** records. An empty list is correct.
- Step 6: T9's records now appear — TEAM scope with no team is **self plus everyone you manage**.
- Step 7: the three team members appear.
- Step 8: the child team's member appears too, because TEAM resolves through descendant teams.
- All four states are correct behaviour. Report a defect only if a count includes somebody none of the four rules reaches.

**Negative Scenarios**

| What to try                                 | Expected                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T16 in two teams at once                    | The union of both teams and their descendants                                                          |
| A team cycle (A parent of B, B parent of A) | Prevented at creation (`ADMIN-TEAM-001`); if it exists, the resolution must terminate rather than hang |

**Evidence** — T16's team and reporting configuration beside their record counts, at each of the four states.

---

## HR-REP-001 — HR reports

|                     |                                                                             |
| ------------------- | --------------------------------------------------------------------------- |
| **Module**          | HRMS                                                                        |
| **User Role**       | HR Manager, Payroll Officer, Finance Admin, Auditor, Department Manager     |
| **Feature**         | HR reporting and export                                                     |
| **Test Scenario**   | HR reports are scoped to the reader and export the same values they display |
| **Priority**        | P1                                                                          |
| **Preconditions**   | Attendance, leave and payroll data exist                                    |
| **Navigation Path** | **Insights → Reports → HR** (`/manath-homes/people/reports`)                |
| **Code Reference**  | `people/reports/page.tsx`                                                   |

**Test Steps**

1. Sign in as T1. Open **Insights → Reports → HR**.
2. Note every report offered and the period controls.
3. Export one report. Confirm the file matches the screen.
4. Sign in as T3 (`payroll_officer`). Confirm **HR reports** is available (`hr_reports:VIEW/VIEW_REPORTS/EXPORT`) and that salary figures are **visible** (T3 holds `payroll:VIEW_SENSITIVE_FIELDS`).
5. Sign in as T4 (`finance_admin`). Confirm the same.
6. Sign in as T11 (`auditor`). Confirm reports are readable and exportable, and check whether salary figures are **masked** (no `VIEW_SENSITIVE_FIELDS`).
7. Sign in as T6 (`dept_manager`). Confirm reports cover **their team only** (`hr_reports:VIEW @ TEAM`) and are **not** exportable (no EXPORT).
8. Sign in as T7 (`site_manager`). Confirm reports cover **branch BB only**.
9. Sign in as T9 (`employee`). Confirm **Insights** is absent.
10. For each role, send the report export endpoint directly and record the status.

**Expected Result**

| Role              | Reports      | Export                          | Salary visible    |
| ----------------- | ------------ | ------------------------------- | ----------------- |
| `hr_admin`        | organisation | yes                             | yes               |
| `payroll_officer` | organisation | yes                             | yes               |
| `finance_admin`   | organisation | yes                             | yes               |
| `auditor`         | organisation | yes                             | **masked**        |
| `dept_manager`    | team         | **no**                          | no                |
| `site_manager`    | branch       | **no**                          | no                |
| `hr_executive`    | organisation | **no** (`hr_reports:VIEW` only) | no                |
| `employee`        | **none**     | no                              | own payslips only |

- The export carries exactly what the screen shows, masking included.

**Negative Scenarios** — Any role seeing a salary it should not, in a report **or** in an export, is a P0 defect. Record the role, the report and the field.

**Evidence** — A table of role → reports visible → export status → salary visibility, with a screenshot of the salary column for each.

---

## HR-NOHRMS-001 — What works without an HRMS subscription

|                    |                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**         | HRMS / entitlement                                                                                                                                                                                                                                                 |
| **User Role**      | Employee, in a workspace **without** HRMS                                                                                                                                                                                                                          |
| **Feature**        | Self-service outside the HRMS entitlement                                                                                                                                                                                                                          |
| **Test Scenario**  | Check-in and own attendance work; everything else in People does not                                                                                                                                                                                               |
| **Priority**       | **P0**                                                                                                                                                                                                                                                             |
| **Preconditions**  | A workspace entitled to **SALES or REAL_ESTATE or LEAD_EAGLE but not HRMS**. Use `QA Brokerage One` from `PLAT-WS-001` with HRMS removed, or `leadersfort` with HRMS swapped for SALES. A user of it has an employee record and an active work-location assignment |
| **Code Reference** | `check-in/page.tsx` (the long comment on why it asserts no module), `admin/users/new/page.tsx`, `src/lib/nav/workspaceNav.ts`                                                                                                                                      |

**Test Steps**

1. Confirm the workspace does **not** hold HRMS.
2. Sign in as a user of it.
3. Confirm the **People** section is **absent** from the sidebar.
4. Confirm **Home → My Workspace** instead carries **Check-in**, **Attendance**, **Attendance Requests** and **Face Activity**.
5. Open **Check-in** (`/{slug}/check-in`). Confirm it **works**.
6. Check in and out successfully.
7. Open **Attendance** (`/{slug}/attendance`). Confirm it shows the user's own attendance.
8. Open **Attendance Requests** (`/{slug}/attendance/requests`). Confirm it works for a user holding `employee:VIEW`.
9. Open **Face Activity** (`/{slug}/attendance/face-activity`). Confirm it works for the same.
10. Navigate to `/{slug}/people/employees`. Record the refusal.
11. Navigate to `/{slug}/people/payroll`, `/{slug}/people/leave`, `/{slug}/people/shifts`. Record each refusal.
12. As that workspace's administrator, open **Administration → Settings → Users → add a user** (`/{slug}/admin/users/new`). Confirm it **works** and creates an employee record.
13. Confirm **Administration → Settings → Work Locations** (`/{slug}/admin/work-locations`) and **Holidays** (`/{slug}/admin/holidays`) are available to a user holding `employee:EDIT`.
14. Call `/{slug}/people/check-in` (the old People-folder path). Record what happens.

**Expected Result**

- **Check-in and own attendance work without HRMS.** Clocking yourself in is not an HR privilege. The API behind the screen is self-service with **no module gate**, deliberately.
- The page used to assert HRMS and live under `people/`, whose layout asserts it for everything beneath — so a brokerage licensing Sales or Real Estate without People **could not open the one screen its agents need every morning**, and the dashboard's own "Open check-in" link bounced them. If that returns, it is a P0 regression.
- **Add user** works without HRMS too (the page asserts no module), so a workspace without HRMS can create the employee record check-in needs.
- **Work Locations** and **Holidays** appear under Administration, gated on `employee:EDIT` rather than on HRMS, for the same reason.
- Everything else under `people/` is refused with the entitlement panel: **"{Screen} is part of HR. This workspace's plan does not include it."**
- Step 14: the old `people/check-in` path should send the viewer to the working one rather than refusing — the refusal panel redirects when the plan has the same screen under another folder.

**Negative Scenarios**

| What to try                                                          | Expected                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/v1/workspaces/{slug}/hr/actions/...` (the oversight verbs) | 403 — those are gated on `employee:VIEW`, which an ordinary employee does not hold |
| `GET /api/v1/workspaces/{slug}/hr/self/...` (the self-service verbs) | **Works** — no HR directory permission needed                                      |
| Payroll, leave or shift endpoints                                    | 403, naming HR                                                                     |

**Evidence** — The sidebar without People but with Check-in under Home; a successful check-in; the exact refusal for each `people/` URL; the result of step 14.
