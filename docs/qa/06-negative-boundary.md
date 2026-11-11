# Section 6 — Module-wise negative and boundary test cases

Most negative scenarios live beside the feature they belong to, in
[Section 5](README.md). This section holds the ones that are **cross-cutting** —
the ones a tester would otherwise never run, because they belong to no single
screen.

## 6.0 What every API refusal should look like

Every route goes through one kernel, so refusals are uniform. A refusal that
does not fit this table is itself a finding.

| Status  | Means                                                             | Body                                         |
| ------- | ----------------------------------------------------------------- | -------------------------------------------- |
| 401     | No session, or an expired one                                     | —                                            |
| 403     | Module not in the plan, or the permission is absent               | A sentence naming the product or the action  |
| **404** | The record exists but is out of your scope, **or** does not exist | Deliberately the same for both               |
| 409     | A conflict: a duplicate, or an action the record's state forbids  | A sentence a user can act on                 |
| **422** | The body failed validation                                        | A **per-field** list: field, code, message   |
| 429     | A rate limit                                                      | With `Retry-After`                           |
| 500     | A bug                                                             | Should never be reachable from any case here |

Two Prisma errors are mapped deliberately so a constraint violation is never a
500: **`P2002` → 409** _"This {noun} already exists."_, **`P2025` → 404**. A 500
from a duplicate key or a missing row is a defect.

A 422 reads the same **whichever path produced it** — JSON or multipart.

---

## NEG-VAL-001 — Mandatory fields, across every create form

|                    |                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **Module**         | All                                                                                                       |
| **User Role**      | A role with CREATE on each module                                                                         |
| **Feature**        | Required-field validation                                                                                 |
| **Test Scenario**  | Every create form refuses an empty submission with per-field errors, not a browser bubble and not a crash |
| **Priority**       | P1                                                                                                        |
| **Preconditions**  | Accounts with CREATE on each module                                                                       |
| **Code Reference** | `src/components/forms/useFormErrors.ts`, `src/components/forms/Field.tsx`, `src/lib/api/handler.ts`       |

**Test Steps**

For **each** form below: open it, click the submit button with every field
empty, and record (a) whether an error appears, (b) whether it appears **beside
the field** rather than as a browser tooltip, and (c) whether the page stayed
put.

| Form            | Path                              | Known required fields                                    |
| --------------- | --------------------------------- | -------------------------------------------------------- |
| Add lead        | `/{slug}/sales/leads/new`         | Full name (+ any required custom field)                  |
| Add contact     | `/{slug}/sales/contacts/new`      | — record them                                            |
| Add account     | `/{slug}/sales/accounts/new`      | Account name                                             |
| Add opportunity | `/{slug}/sales/opportunities/new` | — record them                                            |
| New call        | `/{slug}/sales/calls/new`         | Phone Number (when no lead chosen)                       |
| New listing     | `/{slug}/sales/listings/new`      | — record them                                            |
| New project     | `/{slug}/sales/projects/new`      | — record them                                            |
| New event       | `/{slug}/sales/events/new`        | — record them                                            |
| Request a visit | `/{slug}/sales/site-visits/new`   | — record them                                            |
| Add user        | `/{slug}/admin/users/new`         | Full name, Employee code, Work email, Role, joining date |
| New role        | `/{slug}/admin/roles`             | name, Key                                                |
| Apply for leave | `/{slug}/people/leave`            | Leave type, First day, Last day                          |
| Open run        | `/{slug}/people/payroll`          | Period start, Period end                                 |
| Record salary   | `/{slug}/people/payroll`          | Employee, Effective from, Basic                          |
| Add adjustment  | `/{slug}/people/payroll`          | Employee, Effective on, kind                             |
| Public web form | `/f/{slug}/{formKey}`             | whatever the form marks required                         |
| QR capture      | `/c/{slug}/{key}`                 | Your name, Mobile number                                 |

**Expected Result**

- Every form refuses, **nothing is created**, and the message is beside the field.
- The forms are deliberately `noValidate`: the design system draws the error, not the browser. **A native browser tooltip is a defect**, because it bypasses the product's own error styling and is not announced to screen readers consistently.
- A required marker is on the **label**, not only on the control. _(A `required` attribute that reached the control but never the label meant every required field looked optional until submit failed — if you find a starred control with an unstarred label, or the reverse, report it.)_
- For each form, also submit the same empty body **by API** and confirm a **422** with a per-field list.

**Negative Scenarios** — A form that submits an empty record successfully is a P1 defect. Name the form and what it created.

**Evidence** — One row per form: error shown? beside the field? API status? Record this as a table.

---

## NEG-BOUND-001 — String and number boundaries

|                    |                                                                               |
| ------------------ | ----------------------------------------------------------------------------- |
| **Module**         | Sales CRM (the lead is the reference implementation)                          |
| **User Role**      | Sales Agent                                                                   |
| **Feature**        | Field limits                                                                  |
| **Test Scenario**  | Each field refuses one character over its limit and accepts exactly its limit |
| **Priority**       | P1                                                                            |
| **Preconditions**  | `leads:CREATE`                                                                |
| **Code Reference** | `src/app/api/v1/leads/route.ts` (`createBody`)                                |

**Test Steps**

For each field: submit **exactly** the limit, then the limit **plus one**.

| Field                              | Limit               | At the limit    | One over                                      |
| ---------------------------------- | ------------------- | --------------- | --------------------------------------------- |
| `fullName`                         | 160                 | accepted        | 422                                           |
| `firstName` / `lastName`           | 80                  | accepted        | 422                                           |
| `email`                            | 254                 | accepted        | 422                                           |
| `phone`                            | 32                  | accepted        | 422                                           |
| `company`                          | 160                 | accepted        | 422                                           |
| `jobTitle`                         | 120                 | accepted        | 422                                           |
| `country` / `city` / `nationality` | 80                  | accepted        | 422                                           |
| `campaignName`                     | 120                 | accepted        | 422                                           |
| `sourceDetail`                     | 160                 | accepted        | 422                                           |
| `tags` — count                     | 20                  | accepted        | 422                                           |
| `tags` — each                      | 40                  | accepted        | 422                                           |
| list `q`                           | 200                 | accepted        | 422                                           |
| list `limit`                       | the route's maximum | accepted        | clamped, **not** honoured                     |
| `Idempotency-Key`                  | 255                 | accepted        | 422: _"Use a key of at most 255 characters."_ |
| public form answer                 | 2000                | accepted        | 422                                           |
| public form answers — count        | 40                  | accepted        | 422                                           |
| booking `notes`                    | 4000                | accepted        | 422                                           |
| booking `currency`                 | exactly 3           | `AED` accepted  | `AE` and `AEDX` both 422                      |
| booking `saleValue`                | positive            | `1` accepted    | `0` and `-1` both 422                         |
| booking `agencyFee`                | non-negative        | `0` accepted    | `-1` 422                                      |
| cancel `reason`                    | 4–1000              | 4 accepted      | 3 and 1001 both 422                           |
| payroll `basic`                    | > 0                 | `0.01` accepted | `0` refused                                   |
| recovery / collection amounts      | > 0                 | —               | `0` and negative refused                      |

**Expected Result**

- Exactly at the limit: accepted. One over: **422 naming the field**.
- A limit enforced only by the browser's `maxlength` and not by the API is a defect — test every row **by API**, not only through the form.
- A silently truncated value is worse than a refusal: record any field that truncates rather than refusing.

**Negative Scenarios**

| What to try                                                                            | Expected                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A field of exactly its limit in **multi-byte characters** (e.g. 160 Arabic characters) | Record the behaviour. A limit counted in bytes rather than characters would refuse a legitimate Arabic name — a real-world problem for this product's market |
| A value padded with trailing spaces to exceed the limit                                | Record whether it is trimmed first                                                                                                                           |
| A numeric field given a string                                                         | 422                                                                                                                                                          |
| A numeric field given `1e999`                                                          | 422, not a 500                                                                                                                                               |
| A date field given `0000-00-00`                                                        | 422                                                                                                                                                          |
| A date field given `2026-02-30`                                                        | 422                                                                                                                                                          |

**Evidence** — The table filled in, with the API status for each at-limit and over-limit value.

---

## NEG-DUP-001 — Duplicate submissions and idempotency

|                    |                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Module**         | All                                                                                   |
| **User Role**      | Any with CREATE                                                                       |
| **Feature**        | Idempotency, double submission                                                        |
| **Test Scenario**  | A retried write does not duplicate, and a double-clicked button creates one record    |
| **Priority**       | **P0**                                                                                |
| **Preconditions**  | Any create form                                                                       |
| **Code Reference** | `src/lib/api/handler.ts` (the `Idempotency-Key` block), `src/services/idempotency.ts` |

**Test Steps**

1. Double-click the submit button on **each** of these: Add lead, Add user, New call, Apply for leave, Record salary, Add adjustment, a booking, a collection receipt. Count the records created each time.
2. Submit a form, then press the browser's **Back** button and submit again.
3. Via the API, `POST /api/v1/leads` with an `Idempotency-Key` of `qa-idem-001`. Note the response.
4. Send the **identical** request with the **same** key again.
5. Confirm the response **matches the first** and carries the header **`Idempotent-Replay: true`**.
6. Confirm only **one** lead exists.
7. Send a **different** body with the **same** key.
8. Record what happens.
9. Send the same body with a **new** key. Confirm a second lead is created.
10. Send a request with an `Idempotency-Key` of 256 characters.
11. Send a `POST` with an `Idempotency-Key` and an **empty body**.
12. Wait 25 hours (or, if you cannot, note that you could not) and resend the original key.

**Expected Result**

- One click or two: **one record**.
- An idempotent replay returns the first response with `Idempotent-Replay: true` and creates nothing.
- The key is remembered for **24 hours**.
- Step 10: 422 — _"Use a key of at most 255 characters."_
- Step 11: **works.** _(An empty body once produced the same fingerprint for every request, so the mobile outbox's honest resend met a 409 and was dropped — a follow-up completed offline stayed open. If an empty-body resend is now refused with a 409, that defect has returned.)_
- **The replay check is not atomic.** A write that must never double hands its key to the service itself rather than relying on the kernel — bookings, payroll, collections and commissions all have their own guards, tested in [05e](05e-real-estate.md) and [05d](05d-people.md). So for those, the double-click test in step 1 matters more than the idempotency header.

**Negative Scenarios**

| What to try                                                       | Expected                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The same key from a **different user**                            | Keys are per actor; record the behaviour                                                                                                                          |
| The same key against a **different endpoint**                     | A separate record is created                                                                                                                                      |
| Two identical requests sent **simultaneously** (true concurrency) | One record, or a 409 on the second — **never two records**. This is the test the non-atomic replay check cannot guarantee, so run it: fire both at once and count |
| A `GET` with an `Idempotency-Key`                                 | Ignored                                                                                                                                                           |

**Evidence** — The record count after each double-click; the `Idempotent-Replay: true` header; the count after the simultaneous pair in the last negative row.

---

## NEG-CONC-001 — Concurrent updates

|                    |                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ |
| **Module**         | All                                                                                  |
| **User Role**      | Two users with EDIT on the same record                                               |
| **Feature**        | Concurrency                                                                          |
| **Test Scenario**  | Two people editing one record leave it consistent, and money is never double-counted |
| **Priority**       | **P0**                                                                               |
| **Preconditions**  | Two browsers, two accounts both able to edit the same record                         |
| **Code Reference** | `src/lib/db.ts` (`withTx`), the money services' own guards                           |

**Test Steps**

1. Open the same lead in two browsers as two users with EDIT. Change a **different** field in each. Save both.
2. Confirm both changes survived, or record which was lost.
3. Change the **same** field in both. Save both.
4. Record the final value and whether either user was told their change was overwritten.
5. Open the same confirmed booking in two finance browsers. Accrue commission in **both** at once.
6. Count the commission rows.
7. Open the same payroll run in two browsers as the officer. Click **Calculate** in both at once.
8. Compare the gross and net against a single calculation.
9. As two approvers, approve the **same** payroll run at once.
10. As two finance users, verify the **same** collection receipt at once.
11. As one agent in two tabs, check in twice at once.
12. Assign the **same** unassigned lead to two different agents at once.

**Expected Result**

- Field-level concurrency on an ordinary record may be last-write-wins; that is acceptable **if the record is never left half-written**. Record what happens and whether the user is informed.
- **Money and attendance must never double.** Steps 5–11 must each produce **one** outcome:
  - one commission accrual (the second meets _"This booking has already accrued. Adjust the split instead."_);
  - one calculation, with correct figures;
  - one approval;
  - one verification;
  - one attendance record;
  - one lead owner.
- Any doubling in steps 5–11 is a **P0 defect** and a release blocker.

**Negative Scenarios**

| What to try                                            | Expected                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit a record while another user deletes it            | The edit fails cleanly (404 or 409), not a 500                                                                                                            |
| Two users creating the **same** lead simultaneously    | The duplicate check catches one, or two leads exist — record which, and note that the duplicate check is a read followed by a write and is therefore racy |
| Two users importing the **same** file simultaneously   | Record the duplicate handling                                                                                                                             |
| Two approvers approving two **different** runs at once | Both succeed                                                                                                                                              |

**Evidence** — For each of steps 5–11, the record count before and after, with the timestamps of the two simultaneous requests.

---

## NEG-SESS-001 — Expired sessions, idle timeout and role changes mid-session

|                    |                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Authentication                                                                                                                                                             |
| **User Role**      | Any                                                                                                                                                                        |
| **Feature**        | Session lifetime and authority propagation                                                                                                                                 |
| **Test Scenario**  | A session ends when it should, and a permission change takes effect without waiting for it                                                                                 |
| **Priority**       | **P0**                                                                                                                                                                     |
| **Preconditions**  | Two browsers. An administrator in one, a test user in the other                                                                                                            |
| **Code Reference** | `src/lib/auth/session.ts`, `src/lib/env.ts` (`SESSION_TTL_MINUTES` 480, `SESSION_IDLE_TIMEOUT_MINUTES` 60, `SERVICE_SESSION_TTL_MINUTES` 30), `src/lib/auth/actorCache.ts` |

**Test Steps**

1. Sign in as the test user. Note the time.
2. Leave the session completely idle for **61 minutes**. Then click a link.
3. Record what happens.
4. Sign in again. Use the session actively, at least once every 30 minutes, for **over 8 hours**.
5. Record when it ends.
6. Sign in as the test user. In the administrator's browser, **remove a permission** the user is currently using (for example `leads:VIEW`).
7. In the user's browser, **immediately** perform that action.
8. Record the result and the delay.
9. If it still works, wait 60 seconds and retry.
10. In the administrator's browser, **change the user's role entirely**.
11. In the user's browser, reload. Confirm the navigation changes.
12. In the administrator's browser, **deactivate** the user.
13. In the user's browser, act. Record the result.
14. Sign in as a platform **service** identity through `/service-login`. Leave it 31 minutes. Act.
15. Sign in on a mobile device session. Confirm it is valid for 90 days.
16. Use **Logout all** (`POST /api/v1/auth/logout-all`) from one browser with the same account signed in in two others. Confirm both others are ended.

**Expected Result**

- Step 3: the idle timeout is **60 minutes**; after 61 idle minutes the session is over.
- Step 5: the absolute lifetime is **480 minutes (8 hours)**; an actively used session still ends then.
- Steps 7–9: **a permission change takes effect on the user's next request.** Any write to a model that feeds a user's authority invalidates the cache for the whole tenant automatically, so no call site has to remember. The 60-second TTL is only a **backstop for changes made outside the application**. So expect it immediately; allow up to 60 seconds before recording a Fail; **more than 60 seconds is a defect**.
- Step 13: deactivation ends access the same way.
- Step 14: a service session lives **30 minutes**, capped at 480.
- Step 15: a device session lives **90 days**.
- Step 16: every other session for the account ends.

**Negative Scenarios**

| What to try                                                              | Expected                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Keep a tab open with a polling request, to hold the session past 8 hours | The absolute limit still applies                                                                     |
| Copy the session cookie to another browser and another IP                | Record the behaviour and raise it as a security finding if it works without challenge                |
| Act with a session whose user was deleted                                | 401                                                                                                  |
| Act with a session whose **workspace** was suspended                     | Refused                                                                                              |
| A role change that **widens** authority                                  | Also effective on the next request — confirm, because only the narrowing direction is usually tested |

**Evidence** — Timestamps for every step; the exact delay between the permission change and the first refusal.

---

## NEG-JOB-001 — Failed and missing background work

|                    |                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | All (background processing)                                                                                                   |
| **User Role**      | Company Admin                                                                                                                 |
| **Feature**        | Queues and schedules                                                                                                          |
| **Test Scenario**  | With the worker stopped, deferred work does not happen and the UI does not claim it did; when it returns, the work catches up |
| **Priority**       | **P0**                                                                                                                        |
| **Preconditions**  | You can stop and start the worker process                                                                                     |
| **Code Reference** | `src/workers/index.ts`, `src/workers/jobs.ts`, `src/workers/maintenance.ts`, `src/lib/queue.ts`                               |

**Test Steps**

1. With the worker **running**, create a lead. Confirm it is distributed and a first-contact task appears within five minutes.
2. **Stop the worker.**
3. Create another lead. Wait ten minutes.
4. Confirm the lead exists, is **not** assigned, and has **no** first-contact task.
5. Confirm the UI **never claimed** it was assigned or notified.
6. Upload a transcript and click **Run AI Analysis**. Confirm the analysis never arrives and the UI does not show a false success.
7. Create a follow-up due in two minutes. Confirm no reminder arrives.
8. Trigger a retention run. Confirm nothing is deleted.
9. Open `/platform/system-health` as the platform owner. **Record whether it reports the worker's absence.**
10. **Restart the worker.**
11. Confirm the worker **asserts rather than hopes**: watch its output and confirm it refuses to start, exiting with a failure, if it cannot attach a consumer to every queue.
12. Confirm the schedulers are armed **only after** every consumer has attached.
13. Within five to fifteen minutes, confirm the work from steps 3, 6 and 7 catches up.
14. Confirm the retired schedule `reminders-quarter-hourly` does **not** appear anywhere.
15. Break one job deliberately if you can (for example, configure an invalid AI credential), and run it. Confirm the failure is visible and bounded, and that it retries according to its policy rather than forever.

**Expected Result**

- Deferred work is genuinely deferred: with no worker, it does not happen, and **the UI does not pretend otherwise**.
- Step 11: the worker **exits with a failure** if it cannot attach, rather than starting half-attached. A worker that starts and silently drains nothing is the failure mode this is built to prevent.
- Step 12: schedules are armed after the consumers, so a scheduled job never fires into a queue with no consumer.
- Work queued during the outage catches up.
- Step 14: `reminders-quarter-hourly` is retired. Its reappearance is a regression.
- Step 15: a failing job retries per its policy and then stops. An endless retry loop is a defect.

**Negative Scenarios**

| What to try                                        | Expected                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue the **same** job twice with the same payload | **One** job: the BullMQ job id is a hash of the payload, so repeat work needs an explicit `fresh` flag. This is why a legitimate re-run may appear to do nothing — record it rather than failing it |
| Start **two** worker processes                     | Each queue has its consumers; no job runs twice. Confirm by counting the outcome                                                                                                                    |
| Stop Redis                                         | The worker fails loudly; the web process degrades. Record exactly what a user sees                                                                                                                  |
| A job whose payload references a deleted record    | Fails cleanly, does not block the queue                                                                                                                                                             |
| Flood the `ai` queue from one workspace            | Fair-share scheduling means another workspace's AI work still runs. This is the only queue with fair share and its own concurrency setting — confirm                                                |

**Evidence** — The lead unassigned after ten minutes with the worker's state noted; the worker's startup output; the catch-up timestamps; the system-health reading from step 9.

---

## NEG-WEBHOOK-001 — Webhook and provider callback failures

|                    |                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Integrations                                                                                                                          |
| **User Role**      | Company Admin                                                                                                                         |
| **Feature**        | Inbound webhooks, provider callbacks                                                                                                  |
| **Test Scenario**  | Signed webhooks are verified, duplicates do not double, and the unsigned vendors are handled deliberately                             |
| **Priority**       | P1                                                                                                                                    |
| **Preconditions**  | A `custom_webhook` integration configured with its secret. Optionally an `inbound_email` integration                                  |
| **Code Reference** | `src/lib/integrations/registry.ts` (`unsignedCallbacks`, `issuesSecret`), `src/app/api/v1/webhooks/`, `src/lib/security/ratelimit.ts` |

**Test Steps**

1. Configure `custom_webhook` and note its secret.
2. Send a valid signed payload. Confirm the record is created.
3. Send the **same** signed payload again. Confirm no duplicate.
4. Send a payload with **no signature**. Record the status.
5. Send one with a **wrong** signature.
6. Send one with a signature computed over a **different** body.
7. Send a payload for an integration that is switched **off**.
8. Send 601 payloads within a minute.
9. Send a payload with a 10 MB body.
10. Send malformed JSON.
11. Send a payload whose fields are all absent.
12. If a telephony integration is configured, send an **unsigned** Exotel or Knowlarity callback.
13. Send the **same** telephony callback twice.
14. Send a telephony callback for a call ID that does not exist.

**Expected Result**

- Steps 4–6: rejected. `custom_webhook` and `inbound_email` **issue a secret**, so an unsigned or wrongly signed call must be refused.
- Step 7: rejected.
- Step 8: the 601st is **429** (600 / minute per integration).
- Steps 9–11: refused cleanly — **422 or 413, never a 500**.
- Step 12: **accepted.** Exotel and Knowlarity are recorded in the registry as `unsignedCallbacks` because those vendors do not sign. This is a deliberate, documented exception — **do not log it as a defect**, but do note it in the test report so the owner can see it was exercised.
- Step 13: no double-counting of the call.
- Step 14: refused, and does not create a stray call.

**Negative Scenarios**

| What to try                                                  | Expected                                               |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| A callback claiming to be `custom_webhook` but sent unsigned | Rejected                                               |
| A callback with a replayed old timestamp                     | Record whether a timestamp window applies              |
| A callback for another tenant's integration key              | Rejected                                               |
| A webhook that creates a lead already in the workspace       | Attached to the existing lead, as the public form does |

**Evidence** — The status for each of the fourteen steps; the record count after the duplicate sends.

---

## NEG-AI-001 — AI failures never damage the business record

|                    |                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM / AI                                                                                                                                                   |
| **User Role**      | Sales Agent                                                                                                                                                      |
| **Feature**        | AI failure handling                                                                                                                                              |
| **Test Scenario**  | Every way AI can fail leaves the call, the lead and the transcript intact                                                                                        |
| **Priority**       | **P0**                                                                                                                                                           |
| **Preconditions**  | A completed call with consent and a transcript. You can change the AI configuration                                                                              |
| **Code Reference** | `src/workers/liveStream.ts` (the failure posture), `src/app/api/v1/calls/[id]/analysis/`, `src/app/api/v1/calls/[id]/coach/`, `src/lib/integrations/registry.ts` |

**Test Steps**

1. Note the call's transcript, notes and outcome.
2. Configure an **invalid** AI credential. Run analysis. Record what the user sees.
3. Confirm the call, the transcript, the notes and the outcome are **unchanged**.
4. Remove the AI configuration entirely. Run analysis.
5. Set a token limit of zero for the user in the platform console. Run analysis.
6. Start a **live** call. Mid-call, make the AI provider unreachable.
7. Confirm the transcript stops and **the call continues**.
8. End the call. Confirm it ends cleanly.
9. Start a live call and, mid-call, stop the worker (which hosts the WebSocket server).
10. Confirm the call is not harmed and can be ended.
11. Run analysis on a call whose transcript is a single character.
12. Run analysis on a transcript of 200,000 characters.
13. Run analysis 20 times in quick succession.
14. Restore a valid configuration and confirm analysis works again.

**Expected Result**

- Every failure is **surfaced to the user** with a message naming what went wrong, and **nothing is lost**.
- Step 7: _the live stream swallows the audio, and the call is never harmed._ The coaching layer failing must never take the call with it.
- Step 10: the same.
- Step 5: refused naming the limit, with the call untouched.
- Step 12: refused or truncated with a message — not a timeout and not a 500.
- Step 13: queued or rate-limited, not 20 concurrent jobs.
- **A call record corrupted, a transcript lost, or a call that cannot be ended because the AI failed is a P0 defect.**

**Negative Scenarios**

| What to try                                          | Expected                                        |
| ---------------------------------------------------- | ----------------------------------------------- |
| An AI provider returning a 200 with nonsense         | Handled; the analysis panel says so             |
| An AI provider that hangs                            | Times out; the job fails and retries per policy |
| An AI response that is valid JSON of the wrong shape | Rejected, not stored                            |
| Analysis on a call whose lead was deleted mid-job    | Fails cleanly                                   |

**Evidence** — The call's transcript, notes and outcome before and after each failure; the message shown each time.

---

## NEG-MONEY-001 — Money arithmetic and invalid calculations

|                    |                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| **Module**         | Real Estate / Finance / HRMS                                                                          |
| **User Role**      | Finance Administrator, Payroll Officer                                                                |
| **Feature**        | Monetary arithmetic                                                                                   |
| **Test Scenario**  | Every computed figure matches a hand calculation, rounds as documented, and refuses impossible inputs |
| **Priority**       | **P0**                                                                                                |
| **Preconditions**  | A confirmed booking, a commission plan, a payroll run with recorded salaries                          |
| **Code Reference** | `src/services/money/*.ts`, `src/services/hr/payroll.ts` (`round2`: two decimal places, **half up**)   |

**Test Steps**

1. For a booking of `1,850,000` AED at a `2%` agency fee, confirm the fee is `37,000.00`.
2. For a commission slab, compute the commission by hand and compare.
3. For a payroll run with basic `10,000`, housing `5,000`, transport `1,000` and an addition of `1,234.567`, confirm the gross and net, and confirm **rounding is to two decimal places, half up** — so `.565` becomes `.57`, not `.56`.
4. Split a commission three ways on an amount that does not divide evenly (for example `10,000 / 3`). Confirm the three shares sum **exactly** to the total — no lost or invented fils.
5. Record a collection of `18,500` against the `37,000` fee. Confirm the outstanding sum is `18,500.00`.
6. Record a second collection of `18,500`. Confirm the outstanding sum is `0.00` and not `-0.00` or a tiny residue.
7. Attempt a third collection.
8. Change the currency on a booking after a collection exists.
9. Create a booking in a currency other than AED and run the whole chain.
10. Run a payroll period of a single day, and of a whole year.
11. Run a payroll period containing a **leap day**.
12. Set a salary effective **mid-period** and confirm how the run prorates it. Check the arithmetic.

**Expected Result**

- Every figure matches a hand calculation.
- Rounding is **two decimal places, half up**, consistently — in the figure shown, the figure exported and the figure stored.
- Step 4: **splits sum exactly to the total.** A rounding remainder that disappears, or appears, is a P0 defect in a commission ledger.
- Step 7: refused, or flagged — over-collection must never be silently accepted.
- Steps 8–9: a currency mismatch between a booking and its money must be refused, not silently mixed.
- Step 12: the documented proration is applied. **A raise is a new record, never an edit, and past runs keep the salary that was in force when they were calculated** — so a mid-period raise must not retroactively change a previous run.

**Negative Scenarios**

| What to try                                   | Expected                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A fee of `0.001`                              | Rounded or refused — record which                                                             |
| A sale value of `999,999,999,999`             | Record the behaviour; no overflow, no silent truncation                                       |
| A commission rate of `100%`                   | Record                                                                                        |
| A commission rate of `101%`                   | Refused                                                                                       |
| A negative adjustment larger than the gross   | Record what the net becomes. A negative net must be refused or explicitly flagged, never paid |
| A payroll run with zero employees             | Produces an empty run, not an error                                                           |
| Two salaries with the **same** effective date | Record which wins                                                                             |

**Evidence** — A worksheet: for each figure, your hand calculation and the system's, side by side. This worksheet is the deliverable for this case.

---

## NEG-TIME-001 — Time zones and date boundaries

|                    |                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | All                                                                                                                                                                   |
| **User Role**      | Sales Agent, Employee                                                                                                                                                 |
| **Feature**        | The working day                                                                                                                                                       |
| **Test Scenario**  | Every "today" in the product means the workspace's today, not the tester's                                                                                            |
| **Priority**       | **P0**                                                                                                                                                                |
| **Preconditions**  | The workspace's time zone is `Asia/Dubai` (UTC+4). **If your machine is not on UTC+4, say so in every Actual Result here** — several steps cannot be judged otherwise |
| **Code Reference** | `src/services/targets/dailyBoard.ts` (`dayBounds`, `dayKey`), `src/services/hr/payroll.ts` (`periodLabel`)                                                            |

**Test Steps**

1. Note the workspace's time zone under **Administration → Settings → Company**.
2. At **23:55 Gulf Standard Time**, complete a call. Open **CRM → Daily Activity → Today**. Confirm it counts for **today**.
3. At **00:05 GST** the next day, reload. Confirm today's board is empty of it and yesterday's figure holds it.
4. At 23:55 GST, check in. At 00:05 GST, check out. Confirm how the attendance record spans the boundary and which day it is attributed to.
5. Set your machine's time zone to UTC−8 (or any zone several hours behind). Reload the daily board. Confirm the figures are **unchanged**.
6. Create a lead at 23:59 GST and confirm its created date.
7. Open a payroll period of `1 Feb – 29 Feb` in a leap year. Confirm it is accepted.
8. Open a payroll period of `1 Feb – 29 Feb` in a non-leap year. Confirm it is refused or corrected.
9. Apply for leave spanning a month boundary. Confirm the day count.
10. Apply for leave spanning a public holiday. Confirm the day count excludes it.
11. Set a follow-up due at 00:00 GST. Confirm which day's overdue list it joins.
12. Run a report for "this month" on the 1st of the month at 00:05 GST.
13. Change the workspace's time zone. Reload the daily board. Record whether historic figures shift.

**Expected Result**

- Every day boundary is the **workspace's**, computed server-side. Step 5 is the proof: changing the tester's time zone must change nothing.
- The attendance record spanning midnight is attributed consistently and is visible to HR as such.
- Step 8: an impossible date is refused.
- Leave day counts exclude the workspace's holidays and weekends.
- Step 13: changing the time zone may change how historic days are bucketed. **Record what happens** and flag it for the owner — it is a product decision, not obviously a defect, but it must be known before it surprises someone.

**Negative Scenarios**

| What to try                                               | Expected                                               |
| --------------------------------------------------------- | ------------------------------------------------------ |
| A date in the year 1900 or 2200                           | Accepted or refused consistently; never a crash        |
| A daylight-saving transition in another zone              | The UAE has none; confirm no code assumes one          |
| A date sent as `2026-11-06T00:00:00Z` versus `2026-11-06` | Both interpreted in the workspace's zone, consistently |
| A report period whose end is before its start             | Refused                                                |

**Evidence** — Screenshots either side of midnight GST with the machine's time zone noted; the daily board before and after step 5.

---

## NEG-SCALE-001 — Large imports, exports and lists

|                    |                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Module**         | Sales CRM                                                                                                                       |
| **User Role**      | Branch Manager                                                                                                                  |
| **Feature**        | Volume                                                                                                                          |
| **Test Scenario**  | Large operations complete, report progress, and do not hang the browser or the server                                           |
| **Priority**       | P1                                                                                                                              |
| **Preconditions**  | `leads:IMPORT` and `leads:EXPORT`. A workspace you may fill with test data                                                      |
| **Code Reference** | `sales/leads/LeadImport.tsx` (chunked progress), `src/app/api/v1/exports/`, `src/app/api/v1/leads/route.ts` (keyset pagination) |

**Test Steps**

1. Import 1,000 leads. Record the time and whether progress was shown (**Importing… n/1000**).
2. Import 10,000. Record the time.
3. Import 50,000. Record the time, the browser's responsiveness, and whether it completed.
4. Run **Check first** on the 50,000-row file. Confirm nothing is saved and the reference sequence has not advanced.
5. Page through the resulting lead list to page 20 and back. Confirm no lead is repeated or skipped.
6. Export the full list. Record the time and the row count.
7. Request 11 exports within an hour.
8. Sort and filter the large list. Record the response time.
9. Open the daily board with 50,000 leads and many calls. Record the time.
10. Open a lead with 500 activities on its timeline.
11. Create a lead while the 50,000-row import is running.

**Expected Result**

- Imports run in chunks with visible progress, and **do not lock the browser**.
- Paging uses a keyset cursor, so results stay stable — no repeats, no skips.
- Exports complete; the 11th in an hour is **429**.
- Nothing times out with an unexplained error. Where there is a limit, the product states it.
- The application remains usable for other users during a large import.

**Negative Scenarios**

| What to try                            | Expected                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A 500,000-row file                     | Refused with a stated limit, or completes — record which. A silent failure halfway is a defect |
| A file with one 10 MB cell             | Refused                                                                                        |
| Cancel an import halfway               | Record what was created and whether it is identifiable                                         |
| Export while a large import is running | Both complete                                                                                  |
| Two 50,000-row imports at once         | Record the behaviour and the timing                                                            |

**Evidence** — A table of volume → time → outcome; the lead count after each cancelled or failed operation.

---

## NEG-ENT-001 — Missing module subscriptions, from the inside

|                    |                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ |
| **Module**         | Entitlement                                                                          |
| **User Role**      | Company Admin of a workspace whose module was removed                                |
| **Feature**        | Entitlement enforcement after cancellation                                           |
| **Test Scenario**  | Removing a module stops the screens and the API, promptly and completely             |
| **Priority**       | **P0**                                                                               |
| **Preconditions**  | A workspace you can change the modules of, with data in the module you will remove   |
| **Code Reference** | `src/lib/security/entitlements.ts`, `src/components/workspace/RecheckOnNavigate.tsx` |

**Test Steps**

1. In the workspace, confirm the module's screens work and note some data.
2. Keep a tab open **on a screen of that module**.
3. As the platform owner, remove the module.
4. In the open tab, click something that triggers a navigation.
5. Record how long until the refusal appears.
6. Reload the page directly.
7. Call the module's main API endpoint. Record the status.
8. Call it again every ten seconds for two minutes. Record when it starts refusing, if it did not immediately.
9. Confirm the data is **not deleted** — re-add the module and confirm everything is still there.
10. While the module is removed, confirm the data does not appear anywhere it should not: in another module's reports, in an export, in search results.

**Expected Result**

- Removing a module **clears the entitlement cache key outright**, so it does not wait for the 60-second TTL. Step 8 must show the refusal **within 60 seconds at the very worst**, and in practice immediately.
- The API returns **403** with a body naming the product.
- **Data is retained, not deleted** — a customer who re-subscribes gets their records back. Deleting a customer's data on cancellation would be a catastrophic defect.
- While removed, the data does not leak through another module's screens.

**Negative Scenarios**

| What to try                                        | Expected                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A deep link straight into the module's record page | Refused                                                                                |
| A saved bookmark of a filtered list                | Refused                                                                                |
| A mobile API endpoint for the module               | Refused                                                                                |
| An API key scoped to that module                   | Refused                                                                                |
| A scheduled report covering that module            | Record the behaviour — it should stop producing, not fail loudly every fifteen minutes |

**Evidence** — The time of removal and the time of the first refusal; the API status; the data intact after re-adding.

---

## NEG-SEED-001 — The seed's three guards

|                    |                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **Module**         | Environment                                                                                 |
| **User Role**      | Whoever runs the seed                                                                       |
| **Feature**        | Demo-seed safety                                                                            |
| **Test Scenario**  | The demo seed refuses every shared environment, and none of its guards relies on the others |
| **Priority**       | **P0**                                                                                      |
| **Preconditions**  | A **local** database. Never point any of this at a real environment                         |
| **Code Reference** | `apps/web/prisma/seed/index.ts` (the three gates)                                           |

**Test Steps**

1. Run `npm run db:seed` with **no** `ALLOW_DEMO_SEED`. Confirm it refuses.
2. Run it with `NODE_ENV=production`. **Record the exact message.**
3. Run it with `APP_ENV=production`. Record the message.
4. Run it with `APP_ENV=staging`. Record the message.
5. Create a **local** database named `qa_demo_staging` and point `DATABASE_URL` at it, with `NODE_ENV=development`, `APP_ENV=development` and `ALLOW_DEMO_SEED=yes`. Run the seed.
6. **Record the message.**
7. Repeat with a local database named `qa_demo_prod`, then `qa_demo_production`, then `qa_demo_stage`, then `qa_demo_prod2`.
8. Run it against a local database named `youhan_dev` with all three declarations correct. Confirm it **succeeds**.
9. Confirm the demo password is printed **once** and is different from the previous run's.
10. Set `DEMO_PASSWORD` explicitly and re-run. Confirm it is honoured.

**Expected Result**

- Step 1: refused — `ALLOW_DEMO_SEED=yes` is required **every time**.
- Step 2: _"Refusing to seed demo data: NODE_ENV is production."_
- Steps 3–4: refused, with a message saying demo personas, fake leads and published passwords must never reach a shared environment, and pointing at `docs/ENVIRONMENTS.md`.
- Steps 5–7: **refused on the database's name alone**, even though every declaration says it is a laptop. The message quotes the database name and says the guard reads the connection string itself, so it holds when the declarations are still laptop defaults. **This is the guard that matters most**: the likeliest accident is a production connection string pasted into a shell whose declarations are stale.
- The three gates are **independent**: none of them trusts the other two. Confirm each fires on its own.
- The demo password is generated per run and printed once.

**Negative Scenarios**

| What to try                                                                        | Expected                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A database named `prod_youhan` (prefix, not suffix)                                | **Record what happens.** The guard matches a name _ending_ in those words; a prefix may slip through. If it does, that is a finding worth raising |
| A database named `youhan-production` (hyphen)                                      | Refused — the pattern allows `-` as well as `_`                                                                                                   |
| `MIGRATION_DATABASE_URL` pointing at a protected name while `DATABASE_URL` is safe | Refused — the guard reads `MIGRATION_DATABASE_URL` first                                                                                          |
| `ALLOW_DEMO_SEED=true` instead of `yes`                                            | Record whether it is accepted. It should require exactly `yes`                                                                                    |

**Evidence** — The exact refusal message for each of the three gates and for every database name tried. This case's deliverable is that list of messages.
