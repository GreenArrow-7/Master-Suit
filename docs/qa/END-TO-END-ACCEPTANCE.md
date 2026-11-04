# YOUHAN ONE — end-to-end functional acceptance

A QA-led acceptance run of the complete business journey: admin creates five
users → they onboard → leads are captured and assigned → agents call and follow
up → a manager tracks results → HR manages availability → an employee exits and
the work is handed over.

## A. Test setup

### Environment

|                                       |                                                                       |
| ------------------------------------- | --------------------------------------------------------------------- |
| Production release under test         | `8c3a41ec0bea9d16262af6560b933ce31de7676f`                            |
| Rig branch (fixes raised by this run) | `fix/ai-error-diagnosis`                                              |
| Rig commit                            | `fd0a1f5979c025c607ae84c4ac1fbbf6ed1345d2`                            |
| Rig                                   | `C:\ymw\fix`, `next dev` on `http://127.0.0.1:3300`, worker running   |
| Database                              | Postgres 5432 / `master_suite_fix`, 126 migrations applied            |
| Redis                                 | 6379, logical DB 12 (reserved for tests)                              |
| Object storage                        | MinIO (container) · Mail: Mailpit (controlled inbox)                  |
| Email provider                        | `mock` → Mailpit; no mail leaves the machine                          |
| Node                                  | v24.18.0 · Browser: Chromium (Playwright) · Desktop + emulated mobile |
| Timezone                              | Workspace Asia/Dubai (UTC+4); the rig clock reports UTC               |
| Run started                           | 2026-11-04 18:14 UTC (22:14 Dubai)                                    |

### QA tester agent

**There is no QA tester agent in this project.** `.claude/agents/` does not
exist in the repository and no agent definition declares a QA role. This run was
executed directly, not delegated. Where a scenario is already covered by the
repository's own Playwright suite, that suite is the independent check — it was
written before this run and was not modified to make anything pass.

### Workspaces and actors

The seeded demo workspace `manath-homes` carries the supported role catalogue.
Synthetic users are mapped to real roles, not to admin:

|     | Intended role   | Role key used   | Why                                                    |
| --- | --------------- | --------------- | ------------------------------------------------------ |
| U1  | Sales Manager   | `team_manager`  | Owns a team, assigns and reassigns leads, sets targets |
| U2  | Sales Agent A   | `sales_rep`     | Own leads only                                         |
| U3  | Sales Agent B   | `sales_rep`     | Own leads only; receives U2's work at offboarding      |
| U4  | HR Officer      | `hr_executive`  | Attendance, leave, employee records; no sales pipeline |
| U5  | Finance Officer | `finance_admin` | Collections, commission; no HR records                 |

Tenant isolation is checked against a second workspace created by the same run.

### Safety

No real employee or customer record was created, modified, contacted or
deleted. No real payment was initiated. No live telephony was dialled. No key,
password, session cookie or customer record appears in this document or in any
evidence it cites.

## B. Status key

`PASS` observed working · `FAIL` observed broken · `BLOCKED` cannot be run here,
with the exact action required · `NOT IMPLEMENTED` the feature does not exist ·
`NOT APPLICABLE` the scenario does not apply, with the reason · `NOT RUN`.

A scenario is not PASS because its page loaded, its unit test passed, or a mock
provider answered.

## C. Scenarios

Columns: **ID · Priority · Actor · Preconditions / test data · Steps · Expected · Actual · Status · Evidence · Defect · Retest · Tested SHA**. The definition tables below carry the first six; results are recorded in section D against the same IDs.

### Onboarding and access

| ID    | Pri | Actor           | Preconditions / data                               | Steps                                                    | Expected                                                            |
| ----- | --- | --------------- | -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| ON-01 | P1  | Workspace admin | Fresh QA workspace, 5 role keys exist              | Create/invite U1-U5 with the mapped roles                | Five accounts exist, each with the intended role, none admin        |
| ON-02 | P1  | U1-U5           | Mailpit controlled inbox                           | Open each invitation, set a password, sign in            | Invitation arrives; first login completes; account becomes active   |
| ON-03 | P1  | Attacker/U2     | One expired, one already-used, one malformed token | Open each invitation link                                | All three refused with a clear reason; no session issued            |
| ON-04 | P1  | U2              | MFA policy on                                      | Request a password reset; complete it; enrol and use MFA | Reset link single-use; MFA required and accepted; old password dead |
| ON-05 | P1  | U1-U5           | Each signed in                                     | Compare navigation and record lists                      | Each sees only their workspace, their menus, their record scope     |
| ON-06 | P0  | U2, U4          | Known restricted URLs and API paths                | Request a page and an API endpoint the role lacks        | 403/404, no data in the body, no partial render                     |
| ON-07 | P1  | Admin + U2      | U2 signed in on an open session                    | Change U2's role while the session is live               | The new role takes effect per policy; no stale permission           |
| ON-08 | P2  | Admin           | U1 set as U2/U3 reporting manager                  | Open the employee records                                | Employee-to-user link and manager chain correct both ways           |

### Lead capture and ownership

| ID    | Pri | Actor       | Preconditions / data                                   | Steps                                                 | Expected                                                           |
| ----- | --- | ----------- | ------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
| LD-01 | P0  | U2          | —                                                      | Create a lead; omit required fields; then complete it | Validation names each missing field; the complete lead saves       |
| LD-02 | P0  | U1          | Spreadsheet: valid rows plus deliberately invalid rows | Import with column mapping                            | Valid rows land; invalid rows are reported with the reason         |
| LD-03 | P0  | U1          | The same file again                                    | Re-run the import                                     | Failures identified accurately; successful rows are not duplicated |
| LD-04 | P1  | U2          | A lead whose phone/email already exists                | Create it                                             | The documented identity rule applies, not silent duplication       |
| LD-05 | P1  | System      | Round-robin / eligibility configured                   | Submit new leads                                      | Only eligible agents are selected                                  |
| LD-06 | P1  | U1          | A batch of leads                                       | Assign one; bulk-reassign several                     | Ownership moves; history records who, when, from whom              |
| LD-07 | P1  | U1          | U3 deactivated / at capacity / on leave                | Trigger assignment                                    | The excluded agent receives nothing                                |
| LD-08 | P1  | System      | No eligible agent                                      | Submit a lead                                         | It lands in an accountable unassigned queue, not nowhere           |
| LD-09 | P0  | Two clients | One lead, concurrent assignment plus retry             | Fire both at once                                     | One owner, capacity not exceeded, no duplicate assignment          |
| LD-10 | P0  | U2          | U3 owns restricted leads                               | List, open, search and export as U2                   | U3 leads appear in none of the four                                |
| LD-11 | P1  | U2 then U1  | One disposable lead                                    | Attempt deletion as each                              | Only the authorized role may; retention rules observed             |

### Calls and follow-ups

Native-phone calling is reported in three distinct states: _dialler opened_, _agent logged an outcome_, _verified connected call_.

| ID    | Pri | Actor | Preconditions / data             | Steps                                                   | Expected                                                   |
| ----- | --- | ----- | -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| CL-01 | P1  | U2    | An assigned lead                 | Open it and start the calling flow                      | The supported flow starts and is recorded as started       |
| CL-02 | P0  | U2    | Consenting test number           | Place one controlled call                               | The call connects and is attributed to U2 and the lead     |
| CL-03 | P1  | U2    | —                                | Log answered, no-answer, busy, invalid-number, callback | Each outcome stored distinctly and visible afterwards      |
| CL-04 | P1  | U2    | A logged call                    | Reload the page                                         | Notes, actor, timestamps and duration survive the reload   |
| CL-05 | P0  | U2    | A cancelled and a failed call    | Check the counters                                      | Neither counts as a completed conversation                 |
| CL-06 | P1  | U2    | A call with an outcome           | Complete the call                                       | The correct next follow-up is created or updated           |
| CL-07 | P1  | U2    | An open follow-up                | Reschedule, complete, cancel                            | Every affected view agrees after each action               |
| CL-08 | P1  | U2    | Follow-up due at a boundary hour | Compare due vs overdue                                  | Overdue follows the workspace timezone, not the server's   |
| CL-09 | P1  | U2    | Reminder channels configured     | Let a reminder fire; restart the worker                 | The reminder arrives; restart does not lose the obligation |
| CL-10 | P1  | U2    | A lead with several activities   | Open the timeline                                       | Correct order, no duplicates, no missing entries           |

### Targets and manager tracking

| ID    | Pri | Actor  | Preconditions / data                   | Steps                                          | Expected                                                                   |
| ----- | --- | ------ | -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| MG-01 | P1  | U1     | U2 and U3                              | Assign daily targets to both                   | Both targets stored and visible to the manager                             |
| MG-02 | P1  | U2, U3 | A target set                           | Open the agent's own view                      | Each sees own target, progress and remaining work                          |
| MG-03 | P0  | U2     | A duplicate submission of one activity | Submit twice                                   | Only qualifying activity counts; the total does not inflate                |
| MG-04 | P1  | U1     | Activity by both agents                | Open the manager views                         | Assigned leads, call outcomes, follow-ups and target progress per agent    |
| MG-05 | P0  | U1     | —                                      | Reconcile dashboard totals against the records | The figures agree with the underlying rows                                 |
| MG-06 | P1  | U1     | Overdue and stalled records seeded     | Use the manager views                          | Overdue leads, stalled opportunities and missing next actions identifiable |
| MG-07 | P1  | U1     | A lead with history under U2           | Reassign to U3                                 | Responsibility moves; historical attribution preserved                     |
| MG-08 | P2  | U2     | —                                      | Attempt check-out with an incomplete target    | Enforcement and its authorized exception, or NOT IMPLEMENTED               |

### Sales journey

| ID    | Pri | Actor  | Preconditions / data    | Steps                                                      | Expected                                                |
| ----- | --- | ------ | ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| SL-01 | P1  | U2     | A qualified lead        | Move it through the allowed stages                         | Disallowed jumps refused; required information enforced |
| SL-02 | P1  | U2     | A lead                  | Create a site visit; reschedule; complete; cancel; no-show | Each state recorded and reflected everywhere            |
| SL-03 | P0  | U2     | A lead ready to convert | Convert to customer plus opportunity                       | History preserved; no unintended duplicate customer     |
| SL-04 | P1  | U2     | Two opportunities       | Record one won, one lost                                   | Required reasons enforced and stored                    |
| SL-05 | P1  | U2, U3 | One unit, two agents    | Reserve the same unit concurrently                         | One reservation wins; the other is refused clearly      |
| SL-06 | P1  | U1     | A reservation           | Cancel it                                                  | Inventory released only as the defined workflow says    |

### HRMS and availability

| ID    | Pri | Actor             | Preconditions / data     | Steps                                                     | Expected                                                                  |
| ----- | --- | ----------------- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| HR-01 | P1  | U4                | A synthetic employee     | Complete onboarding tasks; upload and download a document | Tasks complete; the document round-trips intact                           |
| HR-02 | P1  | U2                | —                        | Check in and out; then deny location/camera               | Both succeed; the denied case gives a usable outcome                      |
| HR-03 | P2  | Consenting tester | Face attendance enabled  | Enrol and check in                                        | Recognised, or refused with a usable reason. No public-person fixtures    |
| HR-04 | P1  | U2 to U4          | Leave balance seeded     | Request leave; approve one, reject one                    | Both decisions recorded and visible to the employee                       |
| HR-05 | P1  | U1                | An approved leave        | Trigger assignment during it                              | Allocation respects the configured policy                                 |
| HR-06 | P2  | U2, U4            | —                        | Partial-day leave; cancellation; return to work           | Each behaves as documented                                                |
| HR-07 | P0  | U2                | HR/payroll records exist | Attempt access by page and by API                         | Refused in both                                                           |
| HR-08 | P1  | U4, U5            | Synthetic records        | Validate inputs, approval separation, self-view           | Invalid input refused; maker is not checker; employee sees only their own |

### Finance

No real payment is initiated in any finance scenario.

| ID    | Pri | Actor            | Preconditions / data          | Steps                                      | Expected                                                               |
| ----- | --- | ---------------- | ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| FN-01 | P1  | U5               | A booking                     | Create a booking fee / invoice             | Created with the correct amount and linkage                            |
| FN-02 | P1  | U5               | That invoice                  | Record a partial, then a full collection   | Outstanding reconciles at each step                                    |
| FN-03 | P1  | U5               | A stored commission agreement | Calculate commission on a won deal         | Uses the applicable stored agreement, not a default                    |
| FN-04 | P0  | U5 plus approver | —                             | Submit for approval; attempt self-approval | Maker-checker enforced; payout eligibility correct                     |
| FN-05 | P1  | U5               | A collected invoice           | Cancel / amend it                          | Historical amounts not changed silently; the trail shows the amendment |

### ONE AI — the open defect

| ID    | Pri | Actor  | Preconditions / data       | Steps                                                           | Expected                                                   |
| ----- | --- | ------ | -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| AI-01 | P0  | U2     | The reported failure       | Ask "Show my overdue follow-ups"                                | A grounded answer, or an error that names its cause        |
| AI-02 | P0  | U2     | —                          | Ask "Which leads have breached SLA?"                            | As AI-01                                                   |
| AI-03 | P0  | QA     | A failing request          | Capture reference, HTTP status, server error, provider category | All four obtainable without exposing the key               |
| AI-04 | P0  | QA     | —                          | Verify credential resolution, provider, model, budget           | Each resolves to a known value; the failing one identified |
| AI-05 | P1  | Admin  | —                          | Test the integration connection separately from the assistant   | The two are independently diagnosable                      |
| AI-06 | P0  | U2     | A live key                 | Obtain a genuine provider response through ONE AI               | A real vendor response, explicitly not a stub              |
| AI-07 | P1  | QA     | AI-01/02 answers           | Compare against the authorized underlying rows                  | The returned records match the database                    |
| AI-08 | P0  | U2     | U3 leads, second workspace | Ask for them through the assistant                              | Neither is retrievable                                     |
| AI-09 | P1  | U2     | A query with no matches    | Ask it                                                          | An honest empty result; nothing invented                   |
| AI-10 | P1  | QA     | Provider forced to fail    | Ask a question                                                  | Actionable safe error; retries bounded                     |
| AI-11 | P2  | QA     | A successful request       | Check usage attribution                                         | Attributed to the right workspace and user                 |
| AI-12 | P1  | U2, U3 | Two users                  | Reload; start a new chat                                        | No conversation leaks between users                        |

### Offboarding and handover

| ID    | Pri | Actor    | Preconditions / data                                    | Steps                                                  | Expected                                                         |
| ----- | --- | -------- | ------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| OF-01 | P1  | U4/Admin | Synthetic Agent A (U2) only                             | Initiate offboarding                                   | Started for U2 alone; no other account touched                   |
| OF-02 | P0  | Admin    | U2 owns leads, tasks, follow-ups, visits, opportunities | List everything owned                                  | All five kinds identified, none missed                           |
| OF-03 | P0  | Admin    | U3 available                                            | Transfer the work to U3                                | Every item moves; nothing is orphaned                            |
| OF-04 | P0  | QA       | After transfer                                          | Inspect history and commission                         | Activity history and earned-commission attribution still name U2 |
| OF-05 | P0  | QA       | U2 live session and refresh token                       | Disable access, then reuse both                        | Both refused immediately                                         |
| OF-06 | P1  | U1       | After offboarding                                       | Attempt to assign a new lead to U2                     | Not offerable and not accepted via the API                       |
| OF-07 | P1  | QA       | U2 pending reminders                                    | Let them fire                                          | They no longer route to U2                                       |
| OF-08 | P2  | QA       | —                                                       | Check the retained records                             | They follow the existing retention policy                        |
| OF-09 | P1  | Admin    | A single remaining admin; an interrupted handover       | Attempt to remove the last admin; interrupt a handover | Last-admin protection holds; the interrupted handover recovers   |

### Cross-cutting

| ID    | Pri | Actor | Preconditions / data           | Steps                                                           | Expected                                                    |
| ----- | --- | ----- | ------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| XC-01 | P1  | U2    | Desktop and mobile widths      | Repeat the critical journeys; use keyboard and back             | Usable at both; keyboard reachable; back does not lose work |
| XC-02 | P1  | QA    | —                              | Force loading, empty, error, long-name and narrow-screen states | Each renders legibly; nothing overflows or blanks           |
| XC-03 | P0  | QA    | A business action of each kind | Inspect the audit records                                       | Present, attributed, and free of secrets                    |
| XC-04 | P0  | QA    | Two workspaces                 | Cross pages, APIs, search, downloads and the assistant          | No leakage on any of the five                               |
| XC-05 | P0  | U2    | Key mutations                  | Double-click; refresh mid-submit; interrupt the network; retry  | Exactly one record; safe retry                              |
| XC-06 | P1  | U2    | A notification                 | Follow its link                                                 | Lands on the correct record the user may see                |
| XC-07 | P2  | QA    | Core journeys                  | Measure                                                         | Timings recorded                                            |
| XC-08 | P0  | QA    | After fixes                    | Re-run the affected journeys on the release candidate           | Green on the actual candidate, SHA recorded                 |
