# Section 5c — Sales CRM

Workspace: `manath-homes` (holds SALES). Accounts, from
[04](04-environment-and-data.md) §4.5:

| Shorthand                | Account                                        | Role                  | Scope           |
| ------------------------ | ---------------------------------------------- | --------------------- | --------------- |
| **Agent**                | `sales.rep@manathhomes.ae` (Sara Khan)         | `sales_rep`           | OWN, branch BB  |
| **Agent 2**              | `sdr@manathhomes.ae` (Rayan Malik)             | `sales_rep`           | OWN, branch BB  |
| **Agent (other branch)** | `account.manager@manathhomes.ae` (Nadia Ahmed) | `sales_rep`           | OWN, branch DT  |
| **Team Leader**          | `sales.manager@manathhomes.ae` (Omar Hassan)   | `team_manager`        | TEAM, branch BB |
| **Branch Manager**       | `sofia.marchetti@example.com`                  | `branch_manager`      | BRANCH BB       |
| **Regional Manager**     | `elena.petrova@example.com`                    | `regional_manager`    | REGION DXB      |
| **Sales Manager**        | `dhruv.menon@example.com`                      | `sales_director`      | ORGANIZATION    |
| **Telecaller**           | T12                                            | `Telecaller` (custom) | OWN             |
| **QA Manager**           | `qa.manager@manathhomes.ae` (Daniel Joseph)    | `call_qa`             | ORGANIZATION    |
| **Read-Only**            | `auditor@example.com`                          | `read_only`           | TEAM            |
| **Admin**                | `admin@manathhomes.ae`                         | `org_admin`           | ORGANIZATION    |

Run `ADMIN-TEAM-001` first, so Omar actually manages Sara and Rayan. Without a
team, every TEAM-scope expectation here collapses to the manager's own records.

---

## SALES-LEAD-001 — Create a new lead

|                     |                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                                                                                                                                                                                   |
| **User Role**       | Sales Agent (`sales_rep`, holds `leads:CREATE @ OWN`)                                                                                                                                                                                                                                                                                       |
| **Feature**         | Lead creation                                                                                                                                                                                                                                                                                                                               |
| **Test Scenario**   | An agent creates a lead; it is saved, owned by them, in the workspace's default stage, and visible in their list                                                                                                                                                                                                                            |
| **Priority**        | P0                                                                                                                                                                                                                                                                                                                                          |
| **Preconditions**   | SALES is entitled. The agent's account is ACTIVE. At least one lead source is active and at least one lead stage is marked default. The agent is signed into `manath-homes`                                                                                                                                                                 |
| **Test Data**       | Full name `QA Rehana Mahmood`; email `qa.rehana.001@example.com`; phone `+971501234501`; **On WhatsApp** left ticked; company `QA Marina Holdings`; job title `Investor`; country `United Arab Emirates`; city `Dubai`; nationality `Indian`; source any active entry; campaign `QA Marina launch`; tags `vip, investor`; priority `Medium` |
| **Navigation Path** | `/login` → `/manath-homes/dashboard` → **CRM → Leads → All Leads** (`/manath-homes/sales/leads`) → **Add lead** (`/manath-homes/sales/leads/new`)                                                                                                                                                                                           |
| **Code Reference**  | `sales/leads/new/page.tsx`, `sales/leads/new/LeadForm.tsx`, `src/app/api/v1/leads/route.ts` (`createBody`), `src/services/leads/createLead.ts`, `src/lib/leads/formLayout.ts`                                                                                                                                                               |

**Test Steps**

1. Open the application in a browser.
2. Navigate to `/login`.
3. Enter `sales.rep@manathhomes.ae` in **Email**.
4. Enter the demo password in **Password**.
5. Click **Sign in**.
6. Confirm the **Workspace Summary** dashboard appears at `/manath-homes/dashboard`.
7. In the sidebar, open **CRM → Leads**. Confirm the tab strip shows **All Leads**, **My Leads**, **Unassigned**, **Saved Views**, **QR Capture**, **Cold Data**.
8. Confirm you are on **All Leads** (`/manath-homes/sales/leads`) and the page is titled **Leads**.
9. Click **Add lead**.
10. Confirm you are at `/manath-homes/sales/leads/new`, the heading reads **Add lead**, and there is a **← Leads** link above it.
11. Confirm the first field is **Full name**, marked required with a star.
12. Enter `QA Rehana Mahmood` in **Full name**.
13. Enter `qa.rehana.001@example.com` in **Email**.
14. Enter `+971501234501` in **Phone**.
15. Confirm the **On WhatsApp** checkbox below Phone is **ticked by default**. Leave it ticked.
16. Enter `QA Marina Holdings` in **Company**.
17. Enter `Investor` in **Job title**.
18. Enter `United Arab Emirates` in **Country**.
19. Enter `Dubai` in **City**.
20. Enter `Indian` in **Nationality**.
21. In the source picker, choose an active source. If it offers a sub-source, choose one.
22. Enter `QA Marina launch` in **Campaign**.
23. Enter `vip, investor` in **Tags** (the hint reads _Comma-separated, e.g. vip, investor_).
24. Confirm **Priority** is a dropdown with **Low**, **Medium**, **High**, **Urgent**, defaulting to **Medium**. Leave it.
25. Complete any workspace custom field marked required.
26. Click **Create lead**. Confirm the button shows **Creating…**.
27. Confirm you are taken to the new lead's page.
28. Note the lead's **reference** (e.g. `LEAD-00123`).
29. Confirm the Details card shows every value you entered, and that the fields appear in the workspace's configured order.
30. Confirm the owner is **Sara Khan**.
31. Confirm the stage is the workspace's default stage.
32. Confirm the tags appear as two separate tags, `vip` and `investor`, not as one string.
33. Navigate to **CRM → Leads → My Leads** (`/manath-homes/sales/leads?filter=mine`).
34. Search for `QA Rehana`. Confirm the lead appears.
35. Open it again and confirm the data is unchanged.
36. Wait up to five minutes with the worker running, then reload. Confirm a first-contact task or follow-up has been created for the lead.

**Expected Result**

- The lead is created and the browser lands on it.
- **Only `fullName` is unconditionally required** by the API; everything else is optional unless the workspace made a custom field required.
- The owner is the creating agent. An agent without `leads:ASSIGN` cannot hand the lead to anyone, and it stays theirs.
- The stage is the workspace's configured default; if no default stage exists the request fails with **404 Lead stage** — that is a configuration problem, not a code defect.
- `assignedAt` is stamped, a stage-history row is written, and an assignment-history row is written.
- If the chosen stage has an SLA in minutes, an SLA due time is set.
- The lead's reference is the next number in the workspace's own sequence.
- Tags are stored as a list, maximum 20, each maximum 40 characters.
- The record is committed fast; **assignment, scoring, notification, the first-contact task and the SLA timer run on queues afterwards**. With the worker stopped, step 36 must be recorded **Blocked**, not Failed.

**Negative Scenarios**

| What to try                                                                 | Expected                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit with **Full name** blank                                             | Refused. The error appears **beside the field** (the form is `noValidate`, so there must be no browser bubble)                                        |
| **Full name** of 200 characters                                             | Refused (maximum 160)                                                                                                                                 |
| Email `qa.rehana` (no `@`)                                                  | Refused with a field-level message                                                                                                                    |
| Email of 260 characters                                                     | Refused (maximum 254)                                                                                                                                 |
| Phone of 40 characters                                                      | Refused (maximum 32)                                                                                                                                  |
| Company of 200 characters                                                   | Refused (maximum 160)                                                                                                                                 |
| Job title of 200 characters                                                 | Refused (maximum 120)                                                                                                                                 |
| Country, city or nationality of 100 characters                              | Refused (maximum 80)                                                                                                                                  |
| Campaign of 200 characters                                                  | Refused (maximum 120)                                                                                                                                 |
| 21 tags                                                                     | Refused (maximum 20)                                                                                                                                  |
| One tag of 50 characters                                                    | Refused (maximum 40)                                                                                                                                  |
| Choose a **Referral** source and leave **Referred by** blank                | Refused: _"Say who referred this lead."_ A referral attributed to nobody is not one                                                                   |
| Double-click **Create lead**                                                | **Exactly one** lead is created                                                                                                                       |
| Submit the same form again from the browser's back button                   | Blocked by the duplicate check — see `SALES-LEAD-013`                                                                                                 |
| A `sourceId` belonging to `leadersfort`, by API                             | **404** — the source must belong to this workspace                                                                                                    |
| An `ownerId` of another agent, by API, as `sales_rep`                       | The lead is created **owned by the caller**, not by the named user. `sales_rep` holds no `leads:ASSIGN`, so the field is ignored rather than honoured |
| An `ownerId` of a user outside the caller's ASSIGN scope, as `team_manager` | **404**                                                                                                                                               |
| An unknown field in the body, by API                                        | **422** — the schema is strict                                                                                                                        |
| `priority: "CRITICAL"` by API                                               | 422                                                                                                                                                   |
| As `Telecaller` (T12)                                                       | **Refused**: no `leads:CREATE`. The **Add lead** button is absent, and `/sales/leads/new` redirects to `/sales/leads`                                 |
| As `read_only`                                                              | Refused, the same way                                                                                                                                 |
| As `call_qa`                                                                | Refused: `leads:VIEW` only                                                                                                                            |
| In a workspace without SALES, REAL_ESTATE or LEAD_EAGLE                     | 403: _"Sales, Real Estate or Lead Eagle is not enabled for this company."_                                                                            |

**Evidence** — The created lead page with its reference; a screenshot of each field-level validation message; the HTTP status and body for each API negative.

---

## SALES-LEAD-002 — View and search the lead list

|                     |                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                                                     |
| **User Role**       | Sales Agent, then Team Leader, then Branch Manager                                                                                                                                                            |
| **Feature**         | Lead list, named filters, search                                                                                                                                                                              |
| **Test Scenario**   | Each role sees exactly the leads its scope allows, and the named filters behave                                                                                                                               |
| **Priority**        | P0                                                                                                                                                                                                            |
| **Preconditions**   | Sara, Rayan and Nadia each own at least two leads. At least one lead is unassigned. At least one lead is closed out (invalid, duplicate or archived)                                                          |
| **Navigation Path** | **CRM → Leads**                                                                                                                                                                                               |
| **Code Reference**  | `src/app/api/v1/leads/route.ts` (the reference list implementation), `src/lib/security/record-scope.ts` (`leadScope`), `src/services/leads/closeOut.ts` (`OPEN_LEADS_WHERE`), `src/lib/leads/namedFilters.ts` |

**Test Steps**

1. Sign in as **Agent** (Sara).
2. Open **CRM → Leads → All Leads**. Count the leads. Note their owners.
3. Open **My Leads**. Compare the count.
4. Open **Unassigned**. Note the count.
5. Search for a lead you know belongs to Rayan, by name.
6. Search by a partial phone number of one of **your own** leads.
7. Confirm a closed-out lead (invalid / duplicate / archived) does **not** appear in All Leads.
8. Use the filter control to ask for closed-out leads explicitly, and confirm they appear.
9. Page through the list to the second page and back. Confirm no lead appears twice and none is skipped.
10. Sign in as **Team Leader** (Omar) and repeat steps 2–4.
11. Sign in as **Branch Manager** (Sofia) and repeat.
12. Sign in as **Sales Manager** (Dhruv) and repeat.
13. Sign in as **Agent (other branch)** (Nadia) and confirm she sees none of Sara's leads.

**Expected Result**

| Role                                 | All Leads shows                                    | Unassigned shows |
| ------------------------------------ | -------------------------------------------------- | ---------------- |
| Agent (Sara, OWN)                    | only Sara's own leads                              | **empty**        |
| Team Leader (Omar, TEAM)             | Omar's, Sara's, Rayan's, and any descendant team's | unassigned leads |
| Branch Manager (Sofia, BRANCH BB)    | every BB owner's leads                             | unassigned leads |
| Regional Manager (Elena, REGION DXB) | every DXB branch's leads                           | unassigned leads |
| Sales Manager (Dhruv, ORGANIZATION)  | every lead in the workspace                        | unassigned leads |

- **The Unassigned tab is empty for an agent at OWN scope.** Ownerless records appear only to someone who may claim them — `ASSIGN` or `REASSIGN` at wider than OWN. This is correct, and is a frequent false defect report.
- Searching for a lead outside your scope returns **nothing** — not a "no permission" message, which would confirm the lead exists.
- Closed-out leads are excluded by default and included only when explicitly asked for.
- Paging uses a keyset cursor, so results are stable while you page.

**Negative Scenarios**

| What to try                                                 | Expected                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/leads?limit=10000`                             | Clamped to the maximum page size, not honoured            |
| `GET /api/v1/leads?filter=<a filter naming a masked field>` | Refused — filtering on a field you cannot see is rejected |
| `GET /api/v1/leads?filter=<malformed base64>`               | 422, not a 500                                            |
| `GET /api/v1/leads?cursor=<another tenant's record id>`     | Returns this tenant's data only                           |
| `GET /api/v1/leads?includeUnassigned=true` as Sara          | Still no unassigned leads                                 |
| `q` of 300 characters                                       | 422 (maximum 200)                                         |
| As `it_admin`                                               | 403: no `leads` grant                                     |
| 1201 requests in one minute from one signed-in user         | The 1201st is 429                                         |

**Evidence** — Lead counts per role with owners listed; the API status for each negative.

---

## SALES-LEAD-003 — Edit a lead

|                     |                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                     |
| **User Role**       | Sales Agent                                                                                                                                                   |
| **Feature**         | Lead editing                                                                                                                                                  |
| **Test Scenario**   | An owner edits their own lead; the change is saved, audited, and refused on a lead they do not own                                                            |
| **Priority**        | P0                                                                                                                                                            |
| **Preconditions**   | `SALES-LEAD-001` has been run; `QA Rehana Mahmood` exists and Sara owns it. Rayan owns at least one lead, and you know its ID                                 |
| **Test Data**       | Change the city to `Abu Dhabi`, the priority to `High`, and add the tag `qa-edited`                                                                           |
| **Navigation Path** | **CRM → Leads → My Leads** → open the lead                                                                                                                    |
| **Code Reference**  | `src/app/api/v1/leads/[id]/route.ts`, `src/lib/security/visibility.ts` (`assertRecordVisible`), `src/lib/security/fieldSecurity.ts` (`stripUneditableFields`) |

**Test Steps**

1. Sign in as Sara. Open `QA Rehana Mahmood`.
2. Edit the city to `Abu Dhabi`. Save.
3. Confirm the change appears without a reload.
4. Edit the priority to `High`. Save.
5. Add the tag `qa-edited`. Save.
6. Reload the page. Confirm all three changes persisted.
7. Attempt to edit the **owner** field. Record whether it is offered.
8. Note Rayan's lead ID. In Sara's session, navigate directly to `/manath-homes/sales/leads/{Rayan's lead id}`.
9. Record what happens.
10. From Sara's session, send `PATCH /api/v1/leads/{Rayan's lead id}` with `{"city":"Hacked"}`. Record the status.
11. Sign in as Rayan and confirm his lead's city is **unchanged**.
12. As **Admin**, open **Administration → Settings → Audit Log** and find the three edits from steps 2–5.

**Expected Result**

- Each edit saves and persists.
- The **owner** field is not editable by `sales_rep`: no `leads:ASSIGN`.
- Step 9: Sara gets **404** — the lead is out of her scope. **A 403 here is a defect**, because 403 confirms the record exists.
- Step 10: **404**, and Rayan's lead is untouched. Scope is re-applied on write by loading the record inside the transaction; checking only on read is the classic IDOR, and a PATCH never passes through the list query.
- Every edit appears in the audit log with Sara as the actor.

**Negative Scenarios**

| What to try                                              | Expected                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PATCH` with `{"ownerId":"<Rayan's id>"}` as Sara        | The field is stripped before validation; the owner does not change                                       |
| `PATCH` with `{"reference":"LEAD-99999"}`                | Stripped or refused; the reference is not user-editable                                                  |
| `PATCH` with an unknown field                            | 422                                                                                                      |
| `PATCH` with `{"email":"not-an-email"}`                  | 422 naming `email`                                                                                       |
| `PATCH` a lead in `leadersfort`                          | 404                                                                                                      |
| Two browsers editing the same lead's city simultaneously | Last write wins, or a conflict is raised — record which, and confirm the record is not left half-written |
| As `read_only`                                           | Refused; no edit controls, and `PATCH` returns 403                                                       |
| As `call_qa`                                             | Refused on leads (`leads:VIEW` only), **allowed** on calls                                               |

**Evidence** — Each saved value after reload; the HTTP status from steps 9 and 10; the audit entries.

---

## SALES-LEAD-011 — Claim an unassigned lead

|                     |                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **Module**          | Sales CRM                                                                                  |
| **User Role**       | Team Leader, then Sales Agent                                                              |
| **Feature**         | Ownerless records                                                                          |
| **Test Scenario**   | A manager can see and claim an unassigned lead; an agent at OWN scope cannot see it at all |
| **Priority**        | P1                                                                                         |
| **Preconditions**   | At least one lead with no owner exists. Create one as Admin if needed                      |
| **Navigation Path** | **CRM → Leads → Unassigned**                                                               |
| **Code Reference**  | `src/lib/security/visibility.ts` (`mayClaim`)                                              |

**Test Steps**

1. Sign in as **Agent** (Sara). Open **Unassigned**. Confirm it is empty.
2. Call `GET /api/v1/leads?includeUnassigned=true` from Sara's session. Confirm no ownerless lead is returned.
3. Sign in as **Team Leader** (Omar). Open **Unassigned**. Confirm the lead appears.
4. Assign it to Sara.
5. In Sara's session, open **My Leads** and confirm the lead now appears.
6. Confirm an assignment-history entry exists on the lead.

**Expected Result**

- `mayClaim` is true only for a role holding `ASSIGN` or `REASSIGN` at wider than OWN. Omar (TEAM) qualifies; Sara (OWN) does not.
- Sara cannot see the ownerless lead by UI **or** by API, even asking for it explicitly.
- Assignment is recorded in history.

**Negative Scenarios**

| What to try                                                  | Expected                                     |
| ------------------------------------------------------------ | -------------------------------------------- |
| Omar assigns the lead to Nadia (branch DT, outside his team) | **404** — outside his ASSIGN scope           |
| Sara `PATCH`es the ownerless lead to herself                 | 404                                          |
| As `marketing_manager` (`leads:ASSIGN` absent)               | Cannot assign, though they can view org-wide |

**Evidence** — Sara's empty Unassigned tab and the raw API response; Omar's list; the assignment-history entry.

---

## SALES-LEAD-013 — Duplicate detection

|                     |                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                 |
| **User Role**       | Sales Agent                                                                                                                                               |
| **Feature**         | Lead deduplication                                                                                                                                        |
| **Test Scenario**   | A lead matching an existing one on email, normalised phone or full name is blocked by default, and the refusal names the match                            |
| **Priority**        | P0                                                                                                                                                        |
| **Preconditions**   | SALES entitled. The agent may create leads                                                                                                                |
| **Test Data**       | First: `QA Dup One`, email `qa.dup@example.com`, phone `+971501234599`. Then three attempts: same email; same phone (written differently); same full name |
| **Navigation Path** | **CRM → Leads → Add lead**                                                                                                                                |
| **Code Reference**  | `src/services/leads/createLead.ts` (step 1, `findDuplicates`), `src/app/api/v1/leads/route.ts` (`onDuplicate`)                                            |

**Test Steps**

1. Sign in as Sara. Create `QA Dup One` with the test data. Note its reference.
2. Create a second lead with full name `QA Dup Two` and the **same email** `qa.dup@example.com`.
3. Read the refusal. Note whether it names the matched field and the existing lead's reference.
4. Create a third with name `QA Dup Three` and phone `00971501234599` (the same number, written differently: no `+`, international prefix spelled out).
5. Create a fourth with name `QA Dup Four` and phone `050 123 4599` (local form, with spaces).
6. Create a fifth with full name **exactly** `QA Dup One` and no email or phone.
7. From the API, `POST /api/v1/leads` with the duplicate email and `"onDuplicate": "WARN"`.
8. Confirm the lead is created.
9. From the API, `POST` with the duplicate email and no `onDuplicate`.

**Expected Result**

- Steps 2, 4, 5 and 6 are all refused with **409 Conflict** and a message of the form _"A lead with this {matchedOn} already exists ({reference})."_
- **Phone matching uses a normalised form**, so `+971501234599`, `00971501234599` and `050 123 4599` are the same number. If any of steps 4–5 succeeds, normalisation is broken — a P1 defect, because it creates two leads for one customer.
- Full name is also a duplicate signal.
- `onDuplicate: "WARN"` lets a caller proceed past a match; **`BLOCK` is the default**, so step 9 is refused. A default of WARN would be a defect.
- A duplicate refusal must not create a partial record: confirm no lead named `QA Dup Two` exists afterwards.

**Negative Scenarios**

| What to try                                                     | Expected                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A duplicate in `leadersfort`'s data                             | **Not** a duplicate here. Deduplication is per tenant                                                    |
| A closed-out (archived) lead with the same email                | Record whether it still blocks. Either behaviour is defensible; note which, because it affects recycling |
| `onDuplicate: "DELETE"` or any other value, by API              | 422                                                                                                      |
| The same duplicate `POST` twice with the same `Idempotency-Key` | The second replays the first response and carries `Idempotent-Replay: true`                              |

**Evidence** — The exact refusal text for each of steps 2, 4, 5 and 6; the lead list showing no partial records.

---

## SALES-LEAD-014 — Import leads from a spreadsheet

|                     |                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Sales CRM                                                                                                                                                                                                                            |
| **User Role**       | Branch Manager (holds `leads:IMPORT @ BRANCH`)                                                                                                                                                                                       |
| **Feature**         | Lead import                                                                                                                                                                                                                          |
| **Test Scenario**   | A spreadsheet is mapped, checked without saving, then imported; duplicates are handled by the chosen strategy and rejected rows are downloadable                                                                                     |
| **Priority**        | P1                                                                                                                                                                                                                                   |
| **Preconditions**   | Signed in as Sofia (`branch_manager`). A CSV of 10 rows, first row headings, columns: `Name,Email,Mobile,Company,City`. Two rows deliberately duplicate `qa.dup@example.com`. One row has a blank name. One row has an invalid email |
| **Navigation Path** | **CRM → Leads → All Leads** → **Import**                                                                                                                                                                                             |
| **Code Reference**  | `sales/leads/LeadImport.tsx`, `src/app/api/v1/imports/`, `src/services/leads/createLead.ts` (`dryRun`)                                                                                                                               |

**Test Steps**

1. Sign in as Sofia. Open **CRM → Leads → All Leads**.
2. Click **Import**.
3. Read the instruction: **First row must be the column headings. Columns are matched automatically; you confirm the mapping before anything is imported.**
4. Choose your CSV in the file control (accessible label **Spreadsheet file**; it accepts `.csv`, `.xlsx`, `.xls`).
5. Confirm a mapping table appears with the columns **Column in file**, **Example** and **Import as**.
6. Confirm the automatic mapping, and confirm **Skip this column** is available for each.
7. Confirm the full-name column is mapped; if not, the panel says **Choose which column holds the full name.**
8. In **Rows that match a lead already in the workspace**, confirm the three options: **Skip them (listed in the report)**, **Update that lead**, **Import them as new leads**.
9. Select **Update that lead**. Confirm the extra note appears: _"A row's filled-in columns replace the lead's; its empty ones change nothing."_
10. Change the selection back to **Skip them (listed in the report)**.
11. Click **Check first**. Confirm the button shows **Checking… n/10** while it works.
12. Read the result. Confirm it reads **Checked, nothing saved:** followed by how many would be created and how many updated.
13. Confirm a per-row table appears listing the **Line** of each problem row, and that the blank-name row and the invalid-email row are both listed.
14. Confirm the lead count in the workspace is **unchanged** at this point.
15. Click **Download rejected rows**. Confirm a file downloads containing the rejected rows.
16. Click **Import 10 leads** (the label carries the count). Confirm it shows **Importing… n/10**.
17. Confirm the report: created, updated, skipped, failed.
18. Open **All Leads** and confirm the imported leads are present and owned appropriately.
19. Re-run the **same** import with **Skip them (listed in the report)**. Confirm every row is skipped and nothing is duplicated.
20. Re-run it with **Update that lead** and one column changed. Confirm the existing leads are updated and no new leads are created.
21. Re-run with **Import them as new leads**. Confirm duplicates **are** created.
22. Click **Choose another file** and confirm the panel resets.

**Expected Result**

- **Check first** runs the whole import inside a transaction that is rolled back: every check and write is the same, except that each lead takes a stand-in reference rather than consuming the next number. **Nothing is saved**, and the reference sequence does not advance.
- The counts from **Check first** match what the real import then does.
- Each duplicate strategy behaves as its label says.
- Rejected rows are downloadable, with the line numbers, so they can be corrected and re-imported.
- Imported leads respect the importer's scope: Sofia's import must not create leads owned outside branch BB unless she explicitly assigns them.

**Negative Scenarios**

| What to try                                         | Expected                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A file with headings and **no rows**                | _"That file has a header but no rows."_                                                                          |
| A file with no heading row                          | The mapping is nonsense; the tester must be able to recover by **Choose another file**                           |
| A `.txt` or `.pdf` file                             | Rejected by the file control                                                                                     |
| A 50,000-row file                                   | Record the behaviour and the time. Chunked progress must not lock the UI; a browser hang is a defect             |
| A row with a 200-character name                     | That row fails; the others import                                                                                |
| A row whose source does not exist in this workspace | That row fails                                                                                                   |
| Import while the worker is stopped                  | Leads are created; assignment and notification do **not** run. Record as expected, with the worker's state noted |
| As `sales_rep`                                      | **Refused**: no `leads:IMPORT`. The **Import** button is absent                                                  |
| As `team_manager`                                   | **Refused**: `team_manager` holds no `leads:IMPORT` either                                                       |
| As `marketing_manager`                              | **Allowed** at ORGANIZATION                                                                                      |

**Evidence** — The mapping table; the **Checked, nothing saved** panel with counts; the lead count before and after each re-run; the rejected-rows file.

---

## SALES-LEAD-015 — Telecaller cannot create a lead

|                     |                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                            |
| **User Role**       | Telecaller (custom role)                                                                             |
| **Feature**         | Permission enforcement on creation                                                                   |
| **Test Scenario**   | A role built without `leads:CREATE` is refused in the UI, on the page, and at the API                |
| **Priority**        | P0                                                                                                   |
| **Preconditions**   | T12 holds the `Telecaller` role built in [02](02-roles-and-personas.md) §2.6                         |
| **Navigation Path** | **CRM → Leads**                                                                                      |
| **Code Reference**  | `sales/leads/new/page.tsx` (re-checks `leads:CREATE` and redirects), `src/app/api/v1/leads/route.ts` |

**Test Steps**

1. Sign in as T12.
2. Open **CRM → Leads → All Leads**.
3. Confirm the **Add lead** button is **absent**.
4. Navigate directly to `/manath-homes/sales/leads/new`.
5. Record where you land.
6. Send `POST /api/v1/leads` from T12's session with a valid body. Record the status.
7. Confirm no lead was created.
8. Confirm T12 **can** open a lead they own and edit it (`leads:EDIT @ OWN` is granted).

**Expected Result**

- The button is hidden (presentation), the page **redirects to `/sales/leads`** (the page re-checks the permission itself), and the API returns **403** (the real enforcement).
- All three layers must refuse. A page that renders the form and only fails on submit is a usability defect; an API that accepts the POST is a **P0 defect**.

**Negative Scenarios** — As above; additionally confirm `POST /api/mobile/...` equivalents, if any, also refuse.

**Evidence** — The absent button, the landing URL from step 5, and the HTTP status from step 6.

---

## SALES-LEAD-016 — Nobody below administrator deletes a lead

|                    |                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                 |
| **User Role**      | Sales Agent, Team Leader, Branch Manager, Sales Manager                                   |
| **Feature**        | Deletion authority                                                                        |
| **Test Scenario**  | `leads:DELETE` is granted only to `super_admin` and `org_admin`                           |
| **Priority**       | P0                                                                                        |
| **Preconditions**  | A disposable lead exists                                                                  |
| **Code Reference** | `prisma/seed/roles.ts` — no role other than the two administrators carries `leads:DELETE` |

**Test Steps**

1. For each of Sara, Omar, Sofia, Elena and Dhruv in turn: sign in, open a lead in scope, and look for a delete control.
2. For each, send `DELETE /api/v1/leads/{id}` and record the status.
3. Sign in as Admin and delete the disposable lead through the UI.
4. Confirm the audit log records the deletion and the actor.
5. Confirm related records (calls, activities, tasks) behave as designed — note whether they are removed, detached or retained.

**Expected Result**

- Every role in step 1 is refused: **403**.
- Only `org_admin` (and `super_admin`) may delete.
- The deletion is audited.
- No orphaned child records are left in a broken state.

**Negative Scenarios** — Any successful deletion by a role in step 1 is a P0 defect.

**Evidence** — A table of role → HTTP status for step 2.

---

## SALES-ALLOC-001 — Automatic lead allocation

|                     |                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                 |
| **User Role**       | Company Admin (configures), then Sales Agent (receives)                                                                                                                   |
| **Feature**         | Lead allocation rules, quotas, languages, rotation and the waiting queue                                                                                                  |
| **Test Scenario**   | A new lead is assigned automatically by the configured rule, and a lead that cannot be assigned waits in the queue                                                        |
| **Priority**        | P0                                                                                                                                                                        |
| **Preconditions**   | **The worker must be running.** Signed in as Admin. Sara, Rayan and Nadia are available for new leads                                                                     |
| **Navigation Path** | **Administration → Settings → Allocation** (`/manath-homes/sales/allocation`)                                                                                             |
| **Code Reference**  | `sales/allocation/RulesPanel.tsx`, `sales/allocation/WaitingQueue.tsx`, `src/app/api/v1/allocation/route.ts`, `src/app/api/v1/distribution-rules/`, `src/workers/jobs.ts` |

**Test Steps**

1. Sign in as Admin. Open `/manath-homes/sales/allocation`. Confirm the page is titled **Allocation**.
2. Note the existing rules, and the **Waiting queue** panel.
3. Open each agent's account page (**Administration → Settings → Users** → the user) and note the **Lead work** section: **Daily lead quota** (_New leads a day at most. Blank for no limit._), **Languages** (e.g. `Arabic, English`), and availability (**Available for new leads** / **No — passed over by automatic assignment**).
4. Set Sara's daily quota to `1`. Set Rayan to **No — passed over by automatic assignment**. Leave Nadia available with no quota.
5. Create a distribution rule that routes new leads from one source to the BB branch, by rotation.
6. Create a lead from that source — through the public form (`PUB-FORM-001`) or as Admin.
7. Within five minutes, confirm the lead is assigned. Note to whom.
8. Create a second lead from the same source.
9. Confirm Sara is **skipped** (quota of 1 is spent) and Rayan is **skipped** (unavailable), so Nadia receives it — or, if the rule is branch-scoped to BB and Nadia is in DT, the lead goes to the **waiting queue**.
10. Open the **Waiting queue** panel. Confirm the lead appears, with the reason.
11. Use **Assign to** to assign it manually. Confirm the button shows **Assigning…** and then the lead shows **Assigned from the waiting queue**.
12. In the receiving agent's session, confirm a notification arrived.
13. Set a language requirement on the rule and an agent whose languages do not match. Create a lead. Confirm the mismatch is respected.
14. Set a shift window on the rule that does not include now. Create a lead. Confirm it waits.

**Expected Result**

- Assignment happens **on a queue**, not in the request. A lead that is not assigned the instant it is created is correct; one that is never assigned with the worker running is a defect.
- Quota, availability, language and shift are all honoured, and a lead that satisfies no agent **waits in the queue with a stated reason** rather than being silently dropped or force-assigned.
- Manual assignment from the queue works and is recorded as such.
- The receiving agent is notified.

**Negative Scenarios**

| What to try                                          | Expected                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A quota of `0`                                       | The agent is never auto-assigned                                                                                                                       |
| A negative quota                                     | Refused                                                                                                                                                |
| Every agent unavailable                              | Every new lead waits; nothing is lost                                                                                                                  |
| Two rules matching the same lead                     | One wins deterministically. Record which, and confirm the lead is assigned **once**                                                                    |
| 50 leads created at once                             | Rotation distributes them; no agent exceeds their quota. Record the distribution                                                                       |
| `POST /api/v1/allocation` as `sales_rep`             | 403                                                                                                                                                    |
| Approve an allocation as anyone but an administrator | 403 — `allocation:APPROVE` is `super_admin` / `org_admin` only                                                                                         |
| The worker stopped                                   | Every lead waits unassigned. **Blocked**, not Failed — and record it, because a UI that claims assignment while the worker is down would be the defect |

**Evidence** — The rule configuration; each agent's Lead work settings; who received each lead and when; the waiting-queue reason.

---

## SALES-CALL-001 — Create a call and complete it with an outcome

|                     |                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module**          | Sales CRM                                                                                                                                                                                  |
| **User Role**       | Telecaller, then Sales Agent                                                                                                                                                               |
| **Feature**         | Call creation, consent, outcome, notes                                                                                                                                                     |
| **Test Scenario**   | A call is created against a lead, consent is recorded, the call is completed with an outcome, and the lead's activity reflects it                                                          |
| **Priority**        | P0                                                                                                                                                                                         |
| **Preconditions**   | T12 (`Telecaller`) owns at least one lead with a phone number. `calls:CREATE @ OWN` is granted                                                                                             |
| **Test Data**       | Lead `QA Rehana Mahmood`; direction `Outbound`; pre-call notes `QA first attempt`; consent `verbal`; outcome `connected`; post-call notes `QA: interested in Marina 2BR`                   |
| **Navigation Path** | **CRM → Calls & Coaching → Calls** (`/manath-homes/sales/calls`) → **New call** (`/manath-homes/sales/calls/new`)                                                                          |
| **Code Reference**  | `sales/calls/new/NewCallForm.tsx`, `sales/calls/[id]/CallActions.tsx`, `src/app/api/v1/calls/route.ts`, `src/app/api/v1/calls/[id]/route.ts`, `src/app/api/v1/calls/[id]/consent/route.ts` |

**Test Steps**

1. Sign in as T12.
2. Open **CRM → Calls & Coaching → Calls**. Confirm the page is titled **Calls**.
3. Open the new-call form. Confirm the heading **New Call**.
4. In the **Lead** field, type at least two characters of `Rehana` in the box labelled **Search leads** (placeholder _Search leads by name…_).
5. Confirm a dropdown lists matching leads with name, company and phone, and that **Searching…** appears while it looks.
6. Select the lead. Confirm it is shown as a chip with a **Change** button, and the hint _Optional — linking a lead attaches the call to their timeline._
7. Confirm **Phone Number** is pre-filled or placeholdered with the lead's number, and that it is **not** marked required once a lead with a phone is chosen.
8. Confirm **Direction** is a dropdown with **Outbound** (default) and **Inbound**.
9. Enter `QA first attempt` in **Notes** (placeholder _Pre-call notes..._).
10. Click **Create Call**. Confirm the button shows **Creating…**.
11. Confirm you land on the call's page, titled **Call Detail**.
12. In the **Actions** card, confirm a **Record Consent** group with three buttons: **verbal**, **electronic**, **pre authorized**.
13. Click **verbal**.
14. Confirm the consent group is replaced by **Withdraw Consent**.
15. Confirm a **Complete Call** form appears with a required **Select outcome…** dropdown, a **Post-call notes…** textarea, and a **Complete** button.
16. Confirm the outcome options are exactly: **connected**, **no answer**, **busy**, **voicemail**, **wrong number**, **callback requested**, **not interested**, **interested**, **qualified**, **converted**.
17. Select **connected**. Enter `QA: interested in Marina 2BR`. Click **Complete**.
18. Confirm the call's status becomes completed and the consent and outcome controls disappear (they show only while the call is SCHEDULED, RINGING or IN_PROGRESS).
19. Open the lead. Confirm the call appears on its timeline with the outcome and notes.
20. Open **CRM → Daily Activity → Today**. Confirm the call is counted — see `SALES-DAILY-001`.
21. Repeat steps 3–17 **without** recording consent, choosing outcome **no answer**.
22. On that second call, confirm the hint _"Recordings and transcripts need recorded consent first."_ appears and that no upload control is offered.

**Expected Result**

- A call can be created with or without a linked lead; linking attaches it to the lead's timeline.
- **Consent is recorded against the call before anything is recorded or transcribed.** Without consent, the recording and transcript controls are absent and the hint explains why.
- Consent methods offered in the UI are `VERBAL`, `ELECTRONIC` and `PRE_AUTHORIZED`.
- The ten outcomes match the `CallOutcome` enum exactly.
- Completing the call writes the outcome and notes, and updates the lead.
- Consent and completion controls appear **only** for an active call (SCHEDULED, RINGING, IN_PROGRESS).

**Negative Scenarios**

| What to try                                                   | Expected                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Complete** with no outcome chosen                           | Refused; the dropdown is required                                                                                                   |
| No lead chosen **and** no phone number                        | Refused; **Phone Number** becomes required                                                                                          |
| A phone number of 40 characters                               | Refused                                                                                                                             |
| A lead outside T12's scope, selected by API                   | 404                                                                                                                                 |
| `POST /api/v1/calls/{id}/consent` for a call T12 does not own | 404                                                                                                                                 |
| Record consent twice                                          | The second returns 409 and is treated as already-consented, not as an error the user sees                                           |
| Complete a call that is already completed                     | Refused (409)                                                                                                                       |
| Upload a recording without consent, by API                    | **403 or 409** — the server's consent gate must mirror the UI's. A recording accepted without consent is a **P0 compliance defect** |
| Withdraw consent after a recording exists                     | Record the behaviour — note whether the recording becomes inaccessible                                                              |
| As `read_only`                                                | Refused                                                                                                                             |
| As `call_qa`                                                  | **Can view and edit** calls org-wide, but holds no `leads:CREATE`; confirm they can audit this call                                 |

**Evidence** — Screenshots of the consent buttons, the outcome dropdown with all ten values, the completed call, and the lead timeline. For the recording-without-consent negative, the HTTP status.

---

## SALES-CALL-002 — Dial through a telephony provider

|                     |                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                                                             |
| **User Role**       | Sales Agent                                                                                                                                                                                                           |
| **Feature**         | Outbound dialling                                                                                                                                                                                                     |
| **Test Scenario**   | With a provider configured, a dial places a real call; without one, the refusal is clear                                                                                                                              |
| **Priority**        | P1                                                                                                                                                                                                                    |
| **Preconditions**   | **Needs credentials.** A telephony integration (e.g. Exotel or Knowlarity) configured under **Administration → Settings → Integrations**, with an agent number set. If none is configured, run only the negative half |
| **Navigation Path** | A call's page → the dial control                                                                                                                                                                                      |
| **Code Reference**  | `src/app/api/v1/calls/[id]/dial/route.ts`, `src/lib/integrations/registry.ts` (`TELEPHONY_SETTINGS`), `src/lib/security/fieldSecurity.ts` (`dialable`)                                                                |

**Test Steps**

1. **Without** a provider: create a call and attempt to dial. Record the exact refusal.
2. Configure a telephony provider as Admin. Set the agent number.
3. As the agent, create a call against a lead with a real number.
4. Record consent.
5. Dial.
6. Confirm the call's status moves through RINGING to IN_PROGRESS.
7. Confirm the provider was told to record **only after** consent was checked.
8. Hang up. Confirm the call reaches COMPLETED or the appropriate failure status.
9. As Sara, who **cannot** see the lead's full phone number, attempt to dial that lead.
10. Create a call with a deliberately invalid number and dial.

**Expected Result**

- With no provider, the refusal **names what is missing** and points at **Administration → Integrations**. A crash or a silent failure is a defect.
- Consent is checked **before** the vendor is told to record. The order matters legally, not just logically.
- Step 9: dialling is **refused**, because `dialable()` refuses a masked value rather than dialling the mask. This is the field-security rule enforced at the action, not just the display.
- Step 10: the provider's failure is surfaced as _"The provider could not place the call."_ and the call reaches FAILED — the record is not left stuck in RINGING.

**Negative Scenarios**

| What to try                                             | Expected                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dial a call in COMPLETED status                         | Refused                                                                                                              |
| Dial without consent                                    | Refused                                                                                                              |
| Dial with no agent number configured                    | Refused, naming the missing setting                                                                                  |
| Dial a call belonging to another agent                  | 404                                                                                                                  |
| An unsigned provider callback from Exotel or Knowlarity | **Accepted** — those vendors do not sign, and the registry records them as `unsignedCallbacks`. This is not a defect |
| An unsigned callback claiming to be `custom_webhook`    | Rejected                                                                                                             |
| The same provider callback delivered twice              | The call is not double-counted                                                                                       |

**Evidence** — The no-provider refusal text; the call's status transitions with timestamps; the refusal in step 9.

---

## SALES-CALL-003 — Live AI call workspace, and ending a call

|                     |                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                                                                                                                   |
| **User Role**       | Sales Agent                                                                                                                                                                                                                                                                 |
| **Feature**         | Live transcription, live coaching, ending the call                                                                                                                                                                                                                          |
| **Test Scenario**   | The live workspace streams a transcript and coaching hints, and ending the call closes it cleanly                                                                                                                                                                           |
| **Priority**        | P1                                                                                                                                                                                                                                                                          |
| **Preconditions**   | **Needs credentials.** The live-stream WebSocket server is running (`LIVE_STREAM_WS_URL` is set and the worker process started it) and an AI provider is configured. Without them, the workspace runs in **demo simulation** and the positive steps become observation only |
| **Navigation Path** | **CRM → Calls & Coaching → Calls** → **New call** → **Create & open live workspace**, or a call's page → **Live Call** (`/manath-homes/sales/calls/{id}/live`)                                                                                                              |
| **Code Reference**  | `sales/calls/[id]/live/LiveCallWorkspace.tsx`, `src/workers/liveStream.ts`, `src/app/api/v1/calls/[id]/live-audio/route.ts`, `src/app/api/v1/calls/[id]/coach/route.ts`                                                                                                     |

**Test Steps**

1. Sign in as the agent. Open the new-call form, select a lead, and click **Create & open live workspace**.
2. Confirm you land on the live workspace, titled **Live Call**, showing the lead's name (or the recipient number).
3. Read the banner. If no provider is configured, confirm it says the workspace is a **demo simulation — no real phone call is placed**, and that it points at **Administration → Integrations** for live calls while noting the coaching feed works the same way.
4. Confirm the transcript panel reads **Start the call to see the live transcript.** before you begin.
5. Click the start control. Confirm a confirmation asks you to **confirm you have told the customer this call is recorded and they have consented** and says this is recorded against the call.
6. Accept. Confirm the browser asks for microphone permission; grant it.
7. Confirm the transcript panel changes to **Listening…**.
8. If a provider is configured, confirm the second control reads **Place call with AI assistance** and shows **Placing…** while it works. Before placing, confirm the separate confirmation that the customer **has already agreed to a recorded, AI-assisted call**.
9. Speak. Confirm transcript lines appear.
10. Confirm coaching hints appear, each labelled with its source: **Gemini**, **Your playbook**, or **heuristic**.
11. Use the hint controls. Confirm they are: **Ask next**, **Handle objection**, **Recommend property**, **Payment plan**, **Closing line**, **Summarize customer**.
12. If property matches are suggested, click **Request viewing** on one and confirm it shows **…** while it works and then creates a site-visit request.
13. Type notes in the notes panel and click the save control.
14. Click the danger-styled **End call** button (or **Stop watching** if the workspace is in vendor mode).
15. Confirm the call closes, a closing summary is sent, and you can open the call's detail page via the remaining button.
16. Open the call's page and confirm the transcript, notes and outcome are attached.
17. Revoke microphone permission in the browser and start again.
18. Mid-call, stop the worker process (which hosts the WebSocket server), then speak.

**Expected Result**

- Consent is confirmed **twice and separately**: once for recording, once for placing an AI-assisted call. Both are recorded against the call.
- The transcript streams while listening; hints are attributed to their source, so a heuristic is never presented as the AI's judgement.
- **End call** releases the microphone and closes the call.
- Step 15: if the closing summary cannot be sent, the message is _"The call ended, but the closing summary could not be sent."_ — the call still ends.
- Step 17: the refusal is _"Microphone access was refused."_ and nothing is recorded.
- Step 18: **the call is never harmed by the AI layer failing.** The live stream swallows the audio and the call continues; the transcript simply stops. If ending the call becomes impossible, or the call record is corrupted, that is a P0 defect.
- If the recorder stops unexpectedly, the message says so and adds that **the microphone has been released; the call was not recorded** — it must not claim a recording exists.

**Negative Scenarios**

| What to try                                                                          | Expected                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Open the live workspace for another agent's call                                     | 404                                                                 |
| Decline the consent confirmation                                                     | Nothing starts; no consent is recorded                              |
| Start the call twice                                                                 | Only one session; no duplicate transcript                           |
| `POST /api/v1/calls/{id}/live-audio` with no session                                 | Refused                                                             |
| `POST /api/v1/calls/{id}/coach` beyond an AI token limit set in the platform console | Refused naming the limit; the call is unaffected                    |
| An AI provider returning an error                                                    | The hint panel says so; the call continues                          |
| Close the browser tab mid-call                                                       | The call does not stay IN_PROGRESS forever. Record how it is closed |

**Evidence** — Screenshots of both consent confirmations, the live transcript, the attributed hints, and the end-of-call state. For step 18, the exact moment the worker stopped and what the UI did.

---

## SALES-AI-001 — Post-call AI analysis and scorecard

|                     |                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                                                |
| **User Role**       | Sales Agent, then Call Quality Manager                                                                                                                                                                   |
| **Feature**         | AI analysis, scorecards, failure handling                                                                                                                                                                |
| **Test Scenario**   | AI analysis runs from a transcript, produces a summary and a score, and fails safely                                                                                                                     |
| **Priority**        | P1                                                                                                                                                                                                       |
| **Preconditions**   | **Needs credentials.** An AI provider configured. A completed call with **recorded consent**                                                                                                             |
| **Navigation Path** | A call's page → **Actions**                                                                                                                                                                              |
| **Code Reference**  | `sales/calls/[id]/CallActions.tsx`, `sales/calls/[id]/AnalysisPanel.tsx`, `src/app/api/v1/calls/[id]/analysis/route.ts`, `src/app/api/v1/calls/[id]/transcript/`, `src/workers/jobs.ts` (the `ai` queue) |

**Test Steps**

1. Open a completed call with consent recorded.
2. Confirm **Run AI Analysis** is **not** offered yet (it appears only once a transcript exists).
3. Click **Upload Transcript**.
4. Confirm a panel headed **Transcript** with a required textarea (placeholder _Paste call transcript here…_) and a language field defaulting to `en` (placeholder _Language code (e.g. en, ar)_).
5. Paste a realistic transcript. Click **Save Transcript**. Confirm it shows **Saving…**.
6. Confirm the button now reads **Update Transcript**.
7. Confirm **Run AI Analysis** now appears. Click it. Confirm it shows **Analyzing…**.
8. Wait for the analysis. Confirm a summary and a score appear in the analysis panel.
9. Confirm the button now reads **Re-run AI Analysis**.
10. Re-run it. Confirm the result is replaced, not duplicated.
11. Open the **Temperature** panel and confirm it reflects the call.
12. Sign in as **QA Manager** (`call_qa`). Open **CRM → Calls & Coaching → Call Audits**.
13. Confirm the call appears and that the QA manager can record a human audit over the AI score.
14. Confirm the QA manager can export calls (`calls:EXPORT`).
15. Stop the worker. Upload a transcript to another call and click **Run AI Analysis**.
16. Restart the worker and re-check.
17. Configure an invalid AI credential as Admin, then run analysis.

**Expected Result**

- **Analysis requires a transcript, and a transcript requires consent.** The chain is enforced, not merely implied by the UI.
- Analysis runs on the `ai` queue, which is the only queue with fair-share scheduling and a concurrency setting of its own — so one workspace cannot starve another.
- Re-running replaces the analysis.
- The QA manager's human audit is a write on the audit, over the AI's score. That is why `call_qa` holds `calls:EDIT`.
- Step 15: with the worker stopped, nothing happens. Record **Blocked**, and confirm the UI does not claim success.
- Step 17: the failure is surfaced on the call, and **the call record and its transcript are unharmed**.

**Negative Scenarios**

| What to try                                            | Expected                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Upload a transcript with the textarea empty            | Refused (required)                                         |
| A language code of 50 characters                       | Refused                                                    |
| Upload a transcript to a call with no consent          | Refused — the control is absent, and the API refuses too   |
| Run analysis on a call with no transcript, by API      | Refused                                                    |
| Run analysis 20 times in a row                         | Rate-limited or queued; it must not run 20 concurrent jobs |
| As a user beyond their AI token budget (`PLAT-AI-001`) | Refused naming the limit                                   |
| As `read_only`                                         | Refused                                                    |

**Evidence** — The call before and after analysis; the QA audit; the behaviour with the worker stopped and with a bad credential.

---

## SALES-DAILY-001 — Daily Activity board and daily targets

|                     |                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                    |
| **User Role**       | Team Leader (manager view), then Sales Agent (own view)                                                                                      |
| **Feature**         | Daily Activity / daily targets                                                                                                               |
| **Test Scenario**   | Today's board counts what each seller has done, against their target, from the records themselves                                            |
| **Priority**        | P0                                                                                                                                           |
| **Preconditions**   | SALES entitled. The role holds `reports`. Sara has a daily target set, and has made at least five calls today with mixed outcomes            |
| **Test Data**       | Set Sara's daily target to `5`. Make calls with outcomes: `connected`, `no answer`, `not interested`, `callback requested`, `interested`     |
| **Navigation Path** | **CRM → Daily Activity → Today** (`/manath-homes/sales/leadership?view=daily`)                                                               |
| **Code Reference**  | `src/services/targets/dailyBoard.ts`, `sales/leadership/page.tsx`, `sales/leadership/daily/[userId]/page.tsx`, `src/lib/nav/workspaceNav.ts` |

**Test Steps**

1. Sign in as Admin and set Sara's daily target to `5` (**Insights → Reports → Targets**, or the Daily targets control on the Daily Activity board — **Needs UI Verification** for the exact placement).
2. Sign in as Sara. Make five calls against five **different** leads, completing each with one of the test outcomes.
3. Log one cold-data call as an activity on a cold record.
4. Sign in as **Team Leader** (Omar).
5. Confirm **Daily Activity** is its own area in the sidebar, **not** a tab under Reports.
6. Open **Daily Activity → Today**.
7. Confirm the board lists each seller in Omar's scope with columns for **Called**, **Connected**, **No answer**, and classifications for cold, warm and interested, plus **Daily target**, achievement and what is pending, and a check-in time.
8. Check each number against the definitions:
   - **Called** — distinct leads with a completed or attempted call by that seller today, **plus** distinct cold records they called. A record that was made a lead and then called counts **once**.
   - **Connected** — completed calls whose outcome says someone answered.
   - **No answer** — outcomes `NO_ANSWER`, `BUSY`, `VOICEMAIL`.
   - **Cold** — `NOT_INTERESTED`, `WRONG_NUMBER`.
   - **Warm** — `CALLBACK_REQUESTED`, `CONNECTED`.
   - **Interested** — `INTERESTED`, `QUALIFIED`, `CONVERTED`.
   - **Pending** — target minus leads called, never below zero. With **no** target, it is the seller's assigned leads not yet called today.
9. Confirm Sara's **Called** count is 6 (five leads plus one cold record), not 5 and not 7.
10. Click into Sara's row. Confirm the per-seller page (`/manath-homes/sales/leadership/daily/{userId}`) is titled **Daily target** and shows her day.
11. Confirm the board shows **Behind target** / **Achieved** / **No target** states correctly.
12. Sign in as Sara. Open **Daily Activity → Today**.
13. Confirm she sees **her own** row only.
14. Open **Check-in** (`/manath-homes/check-in`). Confirm the panel shows **Today's target: {called} of {target} leads called** and either **— met** or **— {n} to go**, with a progress bar labelled **Today's calling target**.
15. Call the same lead a second time today. Reload the board.
16. At 23:55 local time, complete a call. At 00:05 the next day, reload the board.

**Expected Result**

- Every number is **counted from the records**, not from a stored aggregate, so it cannot drift.
- Step 9: `called` counts **distinct leads and records**, so a lead called twice counts once (step 15 must not increase **Called**).
- `CONNECTED` appears in **both** the connected count and the **warm** classification — that is intentional, not double counting.
- Scope applies: Omar sees his team, Sara sees herself, Dhruv sees everyone.
- Step 16: the 23:55 call counts against **today**; after midnight the board shows a fresh day and yesterday's call is no longer on it. The working day is the **workspace's** time zone (Asia/Dubai by default), not the tester's browser.
- The check-in screen shows the same target as the board.

**Negative Scenarios**

| What to try                                           | Expected                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Set a daily target of `0`                             | Record the behaviour: pending should be 0, not negative                                     |
| A negative target, by API                             | Refused: _"Enter a whole number above zero."_                                               |
| A seller with no target                               | **Pending** is their assigned leads not yet called today, and the state reads **No target** |
| A seller with no calls                                | Zeroes, not a broken row                                                                    |
| As a role without `reports` (e.g. `Telecaller`)       | The Daily Activity area is absent, and `/sales/leadership?view=daily` is refused            |
| In a workspace without SALES                          | Refused with the entitlement panel                                                          |
| `/sales/leadership/daily/{another user's id}` as Sara | 404                                                                                         |

**Evidence** — The board with every count legible; your own tally of the underlying calls beside it; the check-in screen's target line; screenshots either side of midnight for step 16.

---

## SALES-FU-001 — Follow-ups, tasks and reminders

|                     |                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                       |
| **User Role**       | Sales Agent, then Team Leader                                                                                                                                   |
| **Feature**         | Tasks, follow-ups, overdue handling, reminders                                                                                                                  |
| **Test Scenario**   | A follow-up is created, appears in the right list, becomes overdue, and generates a reminder                                                                    |
| **Priority**        | P1                                                                                                                                                              |
| **Preconditions**   | **The worker must be running** for reminders. Sara owns a lead                                                                                                  |
| **Test Data**       | Follow-up title `QA call back Rehana`; due in 10 minutes; priority `High`                                                                                       |
| **Navigation Path** | **CRM → Activities → Tasks & Follow-ups** (`/manath-homes/sales/follow-ups`); **My Tasks** (`/manath-homes/tasks`); **All Tasks** (`/manath-homes/sales/tasks`) |
| **Code Reference**  | `sales/follow-ups/page.tsx`, `src/services/leads/nextFollowUp.ts`, `src/workers/maintenance.ts` (`reminders-five-minutely`, `follow-up-drift-daily`)            |

**Test Steps**

1. Sign in as Sara. Open a lead, or a completed call.
2. On the call's page, click **Create Follow-up**.
3. Confirm the panel headed **New Follow-up** with a required title (placeholder _Follow-up title_), a required date-time labelled **Due**, and a **Priority** dropdown defaulting to **Medium**.
4. Enter the test data with priority **High**. Submit.
5. Open **CRM → Activities → Tasks & Follow-ups**. Confirm the follow-up appears, and note the **Due filter** and **Due in (minutes)** controls.
6. Open **My Tasks** (`/manath-homes/tasks`). Confirm the task appears there too.
7. Set the due time to 10 minutes in the **past**. Save.
8. Reload the follow-ups list. Confirm the item is marked overdue.
9. Filter the lead list by `overdue` (**CRM → Leads**, the overdue named filter). Confirm the lead appears.
10. Wait up to five minutes. Confirm a reminder notification arrives in **Inbox → All** (`/manath-homes/notifications`).
11. Mark the follow-up done. Confirm it leaves the overdue list.
12. Sign in as **Team Leader** (Omar). Open **All Tasks**. Confirm Sara's follow-up is visible within his TEAM scope.
13. Confirm Omar can assign a task to Sara (`tasks:ASSIGN @ TEAM`).
14. Open **Insights → Reports → Team Activity** and confirm the follow-up compliance view reflects it.

**Expected Result**

- Due dates are stored and compared in the workspace's time zone.
- A follow-up's due time drives the overdue named filter **and** the lead's next-follow-up derivation. The payload carries **the caller's own derivation**, not the stored aggregate over every owner — so a lead with follow-ups owned by two people shows each owner their own next action.
- Reminders arrive from the `reminders-five-minutely` schedule. With the worker stopped, no reminder arrives: **Blocked**, not Failed. (Note `reminders-quarter-hourly` is **retired** and must not appear.)
- `follow-up-drift-daily` runs at 03:20 and reports drift; you will not see it within a test session unless you trigger it.

**Negative Scenarios**

| What to try                                           | Expected                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Submit with the title blank                           | Refused                                                                                      |
| Submit with **Due** blank                             | Refused                                                                                      |
| A due date in the distant past, e.g. 1990             | Record the behaviour; it should be allowed and immediately overdue, not rejected as nonsense |
| A due date in 2099                                    | Allowed                                                                                      |
| `tasks:ASSIGN` to a user outside the assigner's scope | 404                                                                                          |
| Sara assigning a task to Rayan                        | Refused — `sales_rep` holds `tasks:CREATE/EDIT @ OWN`, not ASSIGN                            |
| Mark another agent's task done                        | 404                                                                                          |

**Evidence** — The follow-up in each list; the overdue state; the reminder notification with its arrival time and the worker's state.

---

## SALES-QA-005 — The Call Quality Manager does not work the pipeline

|                    |                                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                       |
| **User Role**      | Call Quality Manager (`call_qa`)                                                |
| **Feature**        | Role boundary                                                                   |
| **Test Scenario**  | `call_qa` reads leads, works calls and audits, and holds no opportunities grant |
| **Priority**       | P1                                                                              |
| **Preconditions**  | `qa.manager@manathhomes.ae` exists as `call_qa`                                 |
| **Code Reference** | `prisma/seed/roles.ts` — the `call_qa` block's comment                          |

**Test Steps**

1. Sign in as the QA Manager.
2. Confirm the sidebar shows **CRM → Leads**, **CRM → Calls & Coaching**, **CRM → Activities**, **Insights → Reports**, **Insights → Dashboards**, and **Account**.
3. Confirm **Opportunities** is **absent**.
4. Navigate directly to `/manath-homes/sales/opportunities`. Record the result.
5. Open **CRM → Leads**. Confirm every lead in the workspace is visible (ORGANIZATION scope), **read-only**.
6. Attempt to edit a lead. Confirm it is refused.
7. Attempt to create a lead. Confirm it is refused.
8. Open **CRM → Calls & Coaching → Call Audits**. Record an audit on a call. Confirm it saves.
9. Export calls. Confirm it works.
10. Open **Insights → Dashboards** (`/manath-homes/sales/dashboards`). Confirm it loads.
11. Create and edit a task. Confirm both work.

**Expected Result**

- Reading a lead is deliberate and read-only: it is what makes a call audit legible — the reviewer needs the record the call was about.
- **Dashboards works because `call_qa` holds `leads:VIEW`.** Dashboards is gated on `leads`, not `reports`; without the lead grant the link would appear and the page would refuse — a promise the navigation could not keep. If Dashboards refuses here, something has removed that grant.
- No `opportunities` grant: QA does not work the pipeline. Step 4 is refused.
- `calls:EDIT` exists because reviewing **is** a write action on audits — the human pass over the AI scores.

**Negative Scenarios** — `POST /api/v1/opportunities` returns 403; `POST /api/v1/leads` returns 403; `PATCH` a lead returns 403.

**Evidence** — The sidebar; the result of step 4; the saved audit; the Dashboards page.

---

## SALES-RO-002 — Read-Only User modifies nothing

|                    |                                                                     |
| ------------------ | ------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                           |
| **User Role**      | Read-Only User (`read_only`, TEAM scope)                            |
| **Feature**        | Read-only role integrity                                            |
| **Test Scenario**  | Every write is refused, while team-scoped reads work                |
| **Priority**       | P0                                                                  |
| **Preconditions**  | `auditor@example.com` exists as `read_only`, in a team with records |
| **Code Reference** | `prisma/seed/roles.ts` — `read_only` holds VIEW only, at TEAM       |

**Test Steps**

1. Sign in as `auditor@example.com`.
2. Confirm the sidebar offers Leads, Opportunities, Customers (Contacts, Accounts, Service), Activities, Reports, Dashboards, Saved Views, Products, Account.
3. On each list screen, confirm no create button is offered.
4. Open one lead, one opportunity, one contact, one account and one ticket. Attempt an edit on each.
5. Send each of these from the session and record the status: `POST /api/v1/leads`, `PATCH /api/v1/leads/{id}`, `DELETE /api/v1/leads/{id}`, `POST /api/v1/opportunities`, `PATCH /api/v1/contacts/{id}`, `POST /api/v1/tasks`.
6. Confirm the records visible are limited to the user's team.
7. Confirm **Products** is visible org-wide (`products:VIEW @ ORGANIZATION`), unlike the rest.

**Expected Result**

- Every write is 403.
- Reads are limited to TEAM — except `products`, which is organisation-wide for every CRM role.
- **Note the distinction from `executive_read_only`:** that role reads the whole organisation, because an executive owns nothing and leads no team, so TEAM scope would show them an empty CRM. If your "read-only" persona sees an empty CRM, check which of the two roles they hold before logging a defect.

**Negative Scenarios** — Any successful write is a P0 defect.

**Evidence** — A table of endpoint → status for step 5.

---

## SALES-NAV-004 — Navigation reflects permissions, and hiding is not enforcement

|                    |                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Module**         | Sales CRM                                                                                                                      |
| **User Role**      | Telecaller, then several                                                                                                       |
| **Feature**        | Navigation model                                                                                                               |
| **Test Scenario**  | Hidden tabs correspond to refused pages, and every hidden tab's URL is also refused                                            |
| **Priority**       | P0                                                                                                                             |
| **Preconditions**  | T12 holds `Telecaller`                                                                                                         |
| **Code Reference** | `src/lib/nav/workspaceNav.ts` — _"hiding a tab here is only presentation: the page still refuses a role that cannot open it."_ |

**Test Steps**

1. Sign in as T12.
2. Write down every section, area and tab the sidebar shows.
3. Compare it against the full table in [01](01-inventory.md) §1.3 and list every tab that is **missing**.
4. For **each** missing tab, navigate to its URL directly and record what happens.
5. In particular: `/manath-homes/sales/opportunities`, `/manath-homes/sales/contacts`, `/manath-homes/sales/accounts`, `/manath-homes/sales/reports`, `/manath-homes/sales/smart-views`, `/manath-homes/sales/products`, `/manath-homes/sales/leadership?view=daily`, `/manath-homes/admin/users`, `/manath-homes/admin/roles`, `/manath-homes/people/employees`.
6. For each, also call the corresponding API endpoint and record the status.
7. Repeat steps 2–6 for `read_only` and for `Custom Minimal` (T14).

**Expected Result**

- Every hidden tab's URL is refused, by the page **and** by the API.
- **A hidden tab whose URL works is a P0 defect** — the entire point of the model is that the nav is presentation and the server is enforcement.
- Equally, a **visible** tab whose page refuses is a defect of the opposite kind: the nav promised something the page would not keep. Report both.

**Negative Scenarios** — Record every mismatch in either direction with its URL and status.

**Evidence** — A table: tab name | URL | shown in nav? | page result | API status. This table is the deliverable for this case.

---

## SALES-SCOPE-004 — A manager with no branch sees only themselves

|                    |                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                         |
| **User Role**      | Branch Manager with **no branch set** (T15)                                                       |
| **Feature**        | Scope resolution edge case                                                                        |
| **Test Scenario**  | BRANCH scope with no branch resolves to the user alone, and an empty CRM is correct               |
| **Priority**       | P1                                                                                                |
| **Preconditions**  | T15 exists as `branch_manager` with the branch field deliberately **empty**                       |
| **Code Reference** | `src/lib/security/visibility.ts` — `case 'BRANCH'`: _"if (branchIds.length === 0) return [self]"_ |

**Test Steps**

1. Confirm T15's branch field is empty on their account page.
2. Sign in as T15.
3. Open **CRM → Leads → All Leads**.
4. Record the count.
5. Open **Unassigned**. Record the count.
6. As Admin, set T15's branch to `BB`.
7. In T15's session, reload the lead list.
8. Record the count.
9. As Admin, instead of a branch, give T15 a BRANCH-scoped **role assignment** naming `JLT` (`ADMIN-ROLE-003`).
10. Reload T15's lead list.

**Expected Result**

- Step 4: T15 sees **only their own** leads — an empty list if they own none. **This is correct behaviour, not a bug.** It is the single most-misreported condition in this product.
- Step 5: unassigned leads **are** visible, because `branch_manager` holds `ASSIGN` wider than OWN and so may claim them.
- Step 8: the whole of branch BB appears.
- Step 10: `JLT` appears **as well as** their own branch — a manager covering a second branch sees it without being moved there.
- The same edge case applies to REGION. For TEAM, see `HR-SCOPE-003`.

**Negative Scenarios**

| What to try                                                    | Expected                                              |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| A branch-scoped assignment naming a branch that does not exist | Refused, or resolves to nothing — never to everything |
| A branch-scoped assignment with the branch blank               | Resolves to nothing wider than self                   |

**Evidence** — T15's branch field beside their lead count, at each step.

---

## SALES-COLD-001 — Cold data: bought lists, calling and conversion

|                     |                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                           |
| **User Role**       | Sales Agent, then Team Leader                                                                                                                       |
| **Feature**         | Cold data                                                                                                                                           |
| **Test Scenario**   | Cold records are imported, called, counted on the daily board, and converted into leads                                                             |
| **Priority**        | P1                                                                                                                                                  |
| **Preconditions**   | SALES entitled. `leads` granted                                                                                                                     |
| **Navigation Path** | **CRM → Leads → Cold Data** (`/manath-homes/sales/cold-data`)                                                                                       |
| **Code Reference**  | `sales/cold-data/page.tsx`, `src/app/api/v1/cold-data/`, `src/lib/security/record-scope.ts` (`coldDataScope`), `src/services/targets/dailyBoard.ts` |

**Test Steps**

1. Sign in as Sara. Open **CRM → Leads → Cold Data**. Confirm the page is titled **Cold data**.
2. Import a small list of cold records (the import panel behaves as `SALES-LEAD-014`; the keywords on this tab are _cold data lists expo bought list calling convert_).
3. Confirm the records appear, scoped to Sara.
4. Log a call against one cold record as an activity.
5. Open **CRM → Daily Activity → Today**. Confirm the cold call is counted in **Called**.
6. Convert one cold record into a lead.
7. Confirm the lead exists and the cold record is marked converted.
8. Call the **lead** the same day.
9. Reload the daily board.
10. Sign in as Omar and confirm he sees Sara's cold records within TEAM scope.

**Expected Result**

- A cold call is a logged call: **one row per (caller, record) per day**, counted when it was logged.
- Step 9: **the record counts once**, not twice. A record made a lead and then called the same day must count once on **Called** — this is stated explicitly in the daily board's own definitions, and double counting is a P1 defect because it inflates every seller's day.
- Cold-data visibility follows its own scope helper, which should match the lead scope for the same role.

**Negative Scenarios**

| What to try                             | Expected                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Convert the same cold record twice      | The second is refused                                                                                      |
| Open another agent's cold record by URL | 404                                                                                                        |
| A cold record with no phone number      | Record whether it can be called at all                                                                     |
| As `Telecaller`                         | Confirm against the role's grants: with `leads:VIEW @ OWN` the tab appears; confirm what they can do on it |

**Evidence** — The daily board's **Called** count before and after step 8, with the underlying records listed.

---

## SALES-CAMP-001 — Campaigns and the dialer

|                     |                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**          | Sales CRM                                                                                                                                                                  |
| **User Role**       | Marketing Manager, then Telecaller                                                                                                                                         |
| **Feature**         | Campaigns, campaign dialer                                                                                                                                                 |
| **Test Scenario**   | A campaign is created, leads are attached, and the dialer works a list                                                                                                     |
| **Priority**        | P2                                                                                                                                                                         |
| **Preconditions**   | `marketing_manager` account (`noor.alhashimi@example.com`). SALES entitled                                                                                                 |
| **Navigation Path** | **Marketing → Campaigns** (`/manath-homes/sales/campaigns`) → a campaign (`/manath-homes/sales/campaigns/{id}`) → **Dialer** (`/manath-homes/sales/campaigns/{id}/dialer`) |
| **Code Reference**  | `sales/campaigns/`, `src/app/api/v1/campaigns/`, `src/app/api/v1/dialer/`                                                                                                  |

**Test Steps**

1. Sign in as the marketing manager. Open **Marketing → Campaigns**. Confirm the title **Campaigns**.
2. Create a campaign named `QA Marina launch`.
3. Confirm it appears in the list and on the campaign detail page (**Campaign Detail**).
4. Attach leads to it — through the Add lead form's **Campaign** field, or from the campaign screen.
5. Open the campaign's **Dialer** page. Confirm the title **Dialer**.
6. Sign in as T12 (`Telecaller`) and open the same dialer. Record whether it is reachable — `dialer` is its own permission module (`CREATE`, `EDIT`, `MANAGE_USERS`, `VIEW`) and is **not** in the `Telecaller` configuration, so expect a refusal. **Needs UI Verification** for the dialer's exact entry point for an agent.
7. As a role with `dialer:VIEW`, work two records from the dialer: call, outcome, next.
8. Confirm each call appears on its lead and on the daily board.
9. Confirm the campaign's figures update.

**Expected Result**

- Campaign membership is visible from the lead and from the campaign.
- The dialer is gated on `dialer`, separately from `calls`. A role with `calls` but not `dialer` can make calls one at a time and cannot work a dialer list.
- Calls made from the dialer are ordinary calls: same outcomes, same daily-board counting.

**Negative Scenarios**

| What to try                           | Expected                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| A campaign with a blank name          | Refused                                                                              |
| A campaign name of 200 characters     | Refused (maximum 120 on the lead's `campaignName`; confirm the campaign's own limit) |
| Delete a campaign with leads attached | Record the behaviour; the leads must not be deleted with it                          |
| As `sales_rep`                        | Campaigns are absent (`campaigns` is not granted)                                    |
| As `marketing_exec`                   | Own campaigns only (OWN scope)                                                       |

**Evidence** — The campaign, its leads, and the dialer with two worked records.

---

## SALES-EXP-001 — Export, and what an export may contain

|                     |                                                                    |
| ------------------- | ------------------------------------------------------------------ |
| **Module**          | Sales CRM                                                          |
| **User Role**       | Branch Manager, then Sales Agent                                   |
| **Feature**         | Export                                                             |
| **Test Scenario**   | An export carries exactly the rows and fields the exporter may see |
| **Priority**        | P0                                                                 |
| **Preconditions**   | Sofia holds `leads:EXPORT @ BRANCH`. Sara holds none               |
| **Navigation Path** | **CRM → Leads** → the export control                               |
| **Code Reference**  | `src/app/api/v1/exports/`, `src/lib/security/fieldSecurity.ts`     |

**Test Steps**

1. Sign in as Sofia. Open **CRM → Leads → All Leads**.
2. Export the list.
3. Open the file. Count the rows and compare against the on-screen count.
4. Check the phone column. Confirm it carries the **real** numbers (Sofia holds `VIEW_SENSITIVE_FIELDS @ BRANCH`).
5. Confirm no lead from outside branch BB is present.
6. Sign in as Sara. Confirm no export control is offered.
7. Call the export endpoint from Sara's session. Record the status.
8. Sign in as Omar (`team_manager`, no `leads:EXPORT`). Attempt an export.
9. As Sofia, request 11 exports within an hour.

**Expected Result**

- The export's rows match the exporter's scope exactly — no extra row, no missing row.
- The export's **fields** match the exporter's field security. **A CSV that carries a value the screen masks is a P0 data-leak defect**: the API, the grid and the CSV are all egress paths and must agree.
- Sara and Omar are refused (403).
- The 11th export in an hour is 429 (limit: 10 / hour per user).

**Negative Scenarios**

| What to try                                             | Expected                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Export with a filter naming a masked field              | Refused                                                       |
| Export 100,000 rows                                     | Record the behaviour and timing; it must not hang the browser |
| Download another user's export file by guessing its URL | Refused                                                       |

**Evidence** — The exported file's row count beside the screen's; the phone column for each of Sofia and (attempted) Sara; the 429.
