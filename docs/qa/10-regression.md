# Section 10 — Regression testing checklist

**Purpose.** Prove that what used to work still works, before a release.
Budget roughly a day for the full list with two testers; a half-day for the
reduced set marked **(core)**.

**Order.** Run [Section 9](09-smoke.md) first. If smoke fails, regression is
pointless.

## 10.1 How to use this list

Each row names a test case in [Section 5](README.md) to [Section 8](08-e2e-workflows.md).
Run that case and record the result here. The point of this section is coverage
and sign-off, not new instructions.

| Column             | Meaning                         |
| ------------------ | ------------------------------- |
| **Core**           | ✓ = in the reduced half-day set |
| **Why it is here** | What breaking it would cost     |

---

## 10.2 Authentication and sessions

| Case             | Core | Why it is here                                                                                                                   | Result |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `PLAT-AUTH-001`  | ✓    | Nobody gets in at all                                                                                                            |        |
| `ADMIN-AUTH-001` | ✓    | Landing and navigation are the first thing every user sees                                                                       |        |
| `LE-AUTH-001`    |      | Lead Eagle's door is a separate code path through the same endpoint                                                              |        |
| `PUB-RESET-001`  | ✓    | **Resets were once inert**: the email arrived, the form succeeded, the old password still worked. Also the identical-answer rule |        |
| `PUB-INVITE-001` | ✓    | The only way into an existing workspace                                                                                          |        |
| `PUB-2FA-001`    |      | Forced enrolment and one-shot recovery codes                                                                                     |        |
| `NEG-SESS-001`   | ✓    | Idle timeout, absolute lifetime, and authority propagation                                                                       |        |
| `E2E-PERM-007`   | ✓    | A revoked permission must bite on the next request                                                                               |        |

## 10.3 Tenancy and authorization — never cut these

| Case             | Core | Why it is here                                                                        | Result |
| ---------------- | ---- | ------------------------------------------------------------------------------------- | ------ |
| `TEN-ISO-001`    | ✓    | One company reading another is the end of the product                                 |        |
| `TEN-ISO-002`    | ✓    | Membership is the whole model                                                         |        |
| `TEN-PLAT-001`   | ✓    | The vendor's console must be unreachable from a workspace                             |        |
| `TEN-SCOPE-001`  | ✓    | OWN scope, on read **and** on write (the IDOR)                                        |        |
| `TEN-SCOPE-002`  | ✓    | TEAM scope, including descendant teams                                                |        |
| `TEN-SCOPE-003`  |      | BRANCH and REGION, and the second-branch assignment                                   |        |
| `TEN-SCOPE-006`  | ✓    | An employee's own HR records and nobody else's                                        |        |
| `TEN-FIELD-001`  | ✓    | A masked number leaking through the API, an export or a note                          |        |
| `TEN-FIELD-003`  | ✓    | HR Executive must see no pay                                                          |        |
| `TEN-FIELD-005`  | ✓    | IT administers accounts and reads no customers — including the import/export question |        |
| `TEN-ENT-001`    | ✓    | A workspace using a module it does not pay for                                        |        |
| `TEN-RLS-001`    | ✓    | The database-level guarantee, and the `BYPASSRLS` question                            |        |
| `TEN-API-001`    |      | An API key escaping its workspace                                                     |        |
| `TEN-ORIGIN-001` |      | Cross-origin writes                                                                   |        |
| `ADMIN-ROLE-004` | ✓    | Nobody grants themselves authority they do not have                                   |        |
| `ADMIN-ROLE-009` | ✓    | HR cannot widen its own authority                                                     |        |
| `PUB-ANON-001`   | ✓    | Everything an unauthenticated visitor must never reach                                |        |

## 10.4 Money and payroll — never cut these either

| Case            | Core | Why it is here                                                                | Result |
| --------------- | ---- | ----------------------------------------------------------------------------- | ------ |
| `HR-PAY-001`    | ✓    | Preparing a run, and the arithmetic                                           |        |
| `HR-PAY-008`    | ✓    | **The preparer must never release.** The guard is on the person, not the role |        |
| `RE-COLL-001`   | ✓    | _"You recorded this receipt. Someone else has to verify it."_                 |        |
| `RE-COMM-001`   | ✓    | Double accrual, clawback, and the payout self-approval guard                  |        |
| `RE-FEE-003`    | ✓    | The proposer cannot decide the amendment                                      |        |
| `RE-RECOV-001`  |      | The proposer cannot approve the resolution                                    |        |
| `RE-BOOK-001`   | ✓    | A booking must say who bought what; plus the SALES-only entitlement finding   |        |
| `NEG-MONEY-001` | ✓    | Rounding, splits summing exactly, over-collection                             |        |
| `NEG-CONC-001`  | ✓    | Money and attendance must never double under concurrency                      |        |

## 10.5 Sales CRM

| Case              | Core | Why it is here                                                | Result |
| ----------------- | ---- | ------------------------------------------------------------- | ------ |
| `SALES-LEAD-001`  | ✓    | The most-used create path in the product                      |        |
| `SALES-LEAD-002`  | ✓    | Scope on every list, and the named filters                    |        |
| `SALES-LEAD-003`  | ✓    | Edit, and the write-side scope re-check                       |        |
| `SALES-LEAD-011`  |      | Ownerless records and who may claim them                      |        |
| `SALES-LEAD-013`  | ✓    | Duplicate detection, including phone normalisation            |        |
| `SALES-LEAD-014`  |      | Import, its dry run, and the three duplicate strategies       |        |
| `SALES-LEAD-015`  | ✓    | A role without CREATE is refused at all three layers          |        |
| `SALES-LEAD-016`  | ✓    | Only an administrator deletes a lead                          |        |
| `SALES-ALLOC-001` | ✓    | Quota, availability, language, shift, and the waiting queue   |        |
| `SALES-CALL-001`  | ✓    | Consent before recording; the ten outcomes                    |        |
| `SALES-CALL-002`  |      | Dialling, and the refusal to dial a mask                      |        |
| `SALES-CALL-003`  |      | The live workspace, and that an AI failure never harms a call |        |
| `SALES-AI-001`    |      | Transcript → analysis chain, and its failures                 |        |
| `SALES-DAILY-001` | ✓    | Every figure a manager looks at each morning                  |        |
| `SALES-FU-001`    |      | Follow-ups, overdue, reminders                                |        |
| `SALES-COLD-001`  |      | Cold data counted once, not twice                             |        |
| `SALES-CAMP-001`  |      | Campaigns and the dialer                                      |        |
| `SALES-EXP-001`   | ✓    | An export must carry only what the exporter may see           |        |
| `SALES-QA-005`    |      | The QA role's boundary, and why Dashboards needs `leads`      |        |
| `SALES-RO-002`    | ✓    | A read-only role writing nothing                              |        |
| `SALES-NAV-004`   | ✓    | Hidden tab ↔ refused page, in both directions                 |        |
| `SALES-SCOPE-004` |      | A manager with no branch sees only themselves                 |        |

## 10.6 People / HRMS

| Case             | Core | Why it is here                                                      | Result |
| ---------------- | ---- | ------------------------------------------------------------------- | ------ |
| `HR-CHECKIN-001` | ✓    | Every agent uses it every morning; the server computes the geofence |        |
| `HR-CHECKIN-002` |      | The three blocked states, and nothing recorded during an outage     |        |
| `HR-LEAVE-001`   | ✓    | Apply, and the day count against holidays                           |        |
| `HR-LEAVE-007`   | ✓    | A department manager approves for their own people only             |        |
| `HR-LEAVE-008`   | ✓    | HR Executive has no approvals and no salaries                       |        |
| `HR-ATT-001`     |      | Oversight, exceptions, overtime detection                           |        |
| `HR-SHIFT-001`   |      | Shifts, rosters, the organisation-wide holiday calendar             |        |
| `HR-EMP-001`     |      | Onboarding, compliance, offboarding, and surviving history          |        |
| `HR-REC-001`     |      | The recruiter cannot decide the offer                               |        |
| `HR-PERF-001`    |      | Cycles, self-assessment, calibration                                |        |
| `HR-SCOPE-003`   |      | A manager with no team                                              |        |
| `HR-REP-001`     | ✓    | Which roles may see pay in a report **and** in its export           |        |
| `HR-NOHRMS-001`  | ✓    | **Check-in must work without HRMS** — a past P0 regression          |        |

## 10.7 Real Estate and Lead Eagle

| Case           | Core | Why it is here                                                         | Result |
| -------------- | ---- | ---------------------------------------------------------------------- | ------ |
| `RE-NAV-001`   | ✓    | One lead register read two ways                                        |        |
| `RE-PROP-001`  |      | Inventory and availability                                             |        |
| `RE-VISIT-001` |      | Visits, approval, the QR pass                                          |        |
| `RE-REQ-001`   | ✓    | The public shortlist must carry nothing internal                       |        |
| `RE-SHARE-001` | ✓    | A shared customer record must be no-indexed and carry nothing internal |        |
| `RE-EVENT-001` |      | Events and RSVP without a session                                      |        |
| `RE-TEST-001`  |      | A testimonial must not appear publicly before approval                 |        |
| `LE-SETUP-001` | ✓    | No seeded plan includes Lead Eagle                                     |        |
| `LE-NAV-001`   |      | The Lead Eagle navigation                                              |        |
| `LE-NAV-002`   |      | Lead Eagle disappears when Real Estate is present                      |        |
| `LE-ENT-001`   | ✓    | Entitlement with every permission held, so only entitlement can refuse |        |
| `LE-LEAD-001`  | ✓    | Lead Eagle must behave identically to Sales                            |        |
| `LE-ROLE-001`  | ✓    | The four personas and their real authority                             |        |
| `LE-MOVE-001`  |      | A second migration run must not double the book                        |        |

## 10.8 Administration and platform

| Case              | Core | Why it is here                                                             | Result |
| ----------------- | ---- | -------------------------------------------------------------------------- | ------ |
| `ADMIN-USER-001`  | ✓    | The temporary password shows once                                          |        |
| `ADMIN-USER-002`  | ✓    | Hand-over, deactivation, and surviving history                             |        |
| `ADMIN-ROLE-001`  | ✓    | A role grants exactly what was set, nothing implicitly                     |        |
| `ADMIN-ROLE-002`  |      | A clone does not share rows with its original                              |        |
| `ADMIN-ROLE-003`  | ✓    | Assignment scope and window; an expired window grants nothing              |        |
| `ADMIN-FIELD-001` | ✓    | Masking at the API, the grid and the CSV                                   |        |
| `ADMIN-SET-001`   |      | Settings, and that a workspace cannot add a module                         |        |
| `ADMIN-SET-002`   |      | Stages, sources, custom fields, and the fixed form fields                  |        |
| `ADMIN-INT-001`   |      | Integrations, the signed/unsigned split, webhook replay                    |        |
| `ADMIN-AUD-001`   | ✓    | The audit trail, including a platform write with its reason                |        |
| `ADMIN-AUD-004`   | ✓    | The auditor writes nothing                                                 |        |
| `ADMIN-RET-001`   | ✓    | Retention must not delete inside its period                                |        |
| `ADMIN-TEAM-001`  | ✓    | Teams, and the descendant-team resolution every scope case rests on        |        |
| `PLAT-WS-001`     | ✓    | Provisioning                                                               |        |
| `PLAT-WS-002`     | ✓    | Entitlement changes take effect within 60 seconds                          |        |
| `PLAT-WS-003`     | ✓    | Platform support is read-only, and People is hidden                        |        |
| `PLAT-BG-001`     | ✓    | Break-glass needs a reason and a clock, both on the customer's audit trail |        |
| `PLAT-BG-002`     | ✓    | **No grant anywhere is unlimited**                                         |        |
| `PLAT-PLAN-001`   |      | A module missing from the plan form makes it unreachable for everyone      |        |
| `PLAT-SUB-001`    | ✓    | A cancelled subscription removes access                                    |        |
| `PLAT-USER-001`   | ✓    | `AI_SERVICE` is read-only by construction and can never elevate            |        |
| `PLAT-AI-001`     |      | AI cost control, enforced in the workspace                                 |        |
| `PLAT-AUDIT-001`  | ✓    | A grant's recorded mode must match what the session could do               |        |
| `PLAT-HEALTH-001` |      | Health must reflect the worker's absence                                   |        |
| `PLAT-SET-001`    |      | The sign-up offer, and never inside the iOS app                            |        |

## 10.9 Public

| Case             | Core | Why it is here                                                   | Result |
| ---------------- | ---- | ---------------------------------------------------------------- | ------ |
| `PUB-FORM-001`   | ✓    | The main inbound path; and no contact detail on an unmasked note |        |
| `PUB-QR-001`     |      | A switched-off link is a 404 that discloses nothing              |        |
| `PUB-LAND-001`   |      | Landing-page attribution, both halves                            |        |
| `PUB-SIGNUP-001` |      | The offer appears only while it is open                          |        |
| `PUB-STATIC-001` |      | The static pages render                                          |        |

## 10.10 Negative, boundary and failure

| Case              | Core | Why it is here                                                  | Result |
| ----------------- | ---- | --------------------------------------------------------------- | ------ |
| `NEG-VAL-001`     | ✓    | Every create form refuses an empty submission, beside the field |        |
| `NEG-BOUND-001`   |      | Limits enforced at the API, not only in the browser             |        |
| `NEG-DUP-001`     | ✓    | Double-click, replay, and true concurrency                      |        |
| `NEG-SESS-001`    | ✓    | _(also in 10.2)_                                                |        |
| `NEG-JOB-001`     | ✓    | The worker asserts rather than hopes; work catches up           |        |
| `NEG-WEBHOOK-001` |      | Signature verification, and the deliberate unsigned vendors     |        |
| `NEG-AI-001`      | ✓    | An AI failure never damages a call, a lead or a transcript      |        |
| `NEG-TIME-001`    | ✓    | Every "today" is the workspace's today                          |        |
| `NEG-SCALE-001`   |      | Large imports and exports                                       |        |
| `NEG-ENT-001`     | ✓    | Cancellation is prompt and complete, and keeps the data         |        |
| `NEG-SEED-001`    | ✓    | The demo seed must refuse every shared environment              |        |

## 10.11 End-to-end

| Case             | Core | Why it is here                        | Result |
| ---------------- | ---- | ------------------------------------- | ------ |
| `E2E-PROV-001`   | ✓    | A new customer must be able to start  |        |
| `E2E-LEAD-002`   | ✓    | The business the product exists for   |        |
| `E2E-CALL-003`   | ✓    | What a manager looks at every morning |        |
| `E2E-HR-004`     | ✓    | People get paid                       |        |
| `E2E-PROP-005`   |      | Inventory to money                    |        |
| `E2E-LE-006`     | ✓    | A whole product line                  |        |
| `E2E-PERM-007`   | ✓    | _(also in 10.2)_                      |        |
| `E2E-CANCEL-008` | ✓    | Entitlement, and that data survives   |        |

---

## 10.12 Targeted regression — run these when the named area changed

Read the change's entry in `changes/` and pick the rows that apply.

| If the change touched…                                                         | Also run                                                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/lib/security/rbac.ts`, `visibility.ts`, `record-scope.ts`                 | **All of 10.3**, plus `ADMIN-TEAM-001` and `HR-SCOPE-003`                                                        |
| `src/lib/security/fieldSecurity.ts`                                            | `TEN-FIELD-001`, `ADMIN-FIELD-001`, `SALES-EXP-001`, `HR-REP-001`, `SALES-CALL-002`                              |
| `src/lib/security/entitlements.ts`                                             | `TEN-ENT-001`, `LE-ENT-001`, `NEG-ENT-001`, `E2E-CANCEL-008`, `HR-NOHRMS-001`                                    |
| `src/lib/nav/workspaceNav.ts`                                                  | `SALES-NAV-004`, `LE-NAV-001`, `LE-NAV-002`, `ADMIN-AUTH-001`, and all of [01](01-inventory.md) §1.3 re-verified |
| `src/lib/api/handler.ts`                                                       | `NEG-DUP-001`, `NEG-VAL-001`, `TEN-ORIGIN-001`, `TEN-API-001`, and the §6.0 status table                         |
| `src/lib/db.ts`                                                                | **`TEN-RLS-001`** and all of 10.3                                                                                |
| `src/lib/auth/*`                                                               | All of 10.2                                                                                                      |
| `prisma/seed/roles.ts` or the permission catalogue                             | `ADMIN-ROLE-001`, all of [03](03-access-matrix.md) re-verified, plus `npm run check:permissions`                 |
| `src/services/money/*` or `src/services/hr/payroll.ts`                         | **All of 10.4**                                                                                                  |
| `src/services/leads/*`                                                         | 10.5 in full                                                                                                     |
| `src/services/targets/dailyBoard.ts`                                           | `SALES-DAILY-001`, `SALES-COLD-001`, `E2E-CALL-003`, `NEG-TIME-001`                                              |
| `src/workers/*`                                                                | `NEG-JOB-001`, `SALES-ALLOC-001`, `SALES-FU-001`, `PLAT-HEALTH-001`                                              |
| A new Prisma model or migration                                                | `TEN-RLS-001` (`npm run check:rls`), and `npm run check:drift`                                                   |
| An integration or provider                                                     | `ADMIN-INT-001`, `NEG-WEBHOOK-001`, `SALES-CALL-002`                                                             |
| Anything in `src/app/(platform)`                                               | 10.8's platform rows                                                                                             |
| Anything public (`src/app/f`, `/c`, `/l`, `/p`, `/s`, `/rsvp`, `/testimonial`) | All of 10.9, plus `RE-SHARE-001` and `RE-REQ-001`                                                                |

---

## Sign-off

|                                |                                            |
| ------------------------------ | ------------------------------------------ |
| Environment                    |                                            |
| Commit / version               |                                            |
| Set run                        | **Full / Core only**                       |
| Tester(s)                      |                                            |
| Dates                          |                                            |
| Total cases run                |                                            |
| Passed                         |                                            |
| Failed                         |                                            |
| Blocked                        |                                            |
| **P0 failures (must be zero)** |                                            |
| **Verdict**                    | **Proceed to UAT / Return to development** |

Any **P0 failure** returns the build to development. There is no "pass with a
known issue" for a case in 10.3 or 10.4.
