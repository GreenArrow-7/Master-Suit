# Workflow blueprint

The target shape of YOUHAN ONE / Master Suite as a connected workflow product for
real-estate lead management and employee sales activity.

**Phase 1, specification only.** Nothing here has been built. Every statement
about what exists today is traced in `CURRENT-CODE-MAP.md`; every statement about
company policy is marked **PROPOSED — NOT APPROVED** and listed in
`DECISIONS-REQUIRED.md`.

## The question the product must answer

> **Who owns this customer, what happened, what must happen next, and who
> intervenes when work is neglected?**

Everything below is subordinate to that sentence. A screen that does not help
answer one of its four clauses is not part of the core product.

Four invariants follow, and they are the acceptance bar for the whole blueprint:

1. **Ownership.** Every active enquiry has an accountable owner — or an explicit
   `UNASSIGNED` state with a named responsible queue and a review deadline.
   "Nobody" is not a permitted answer.
2. **History.** Every material event is on one timeline, with its provenance
   (human, provider-confirmed, or AI-suggested) visible.
3. **Next action.** Every active enquiry has exactly one authoritative next
   action, with an owner and a due time — from **one** store, not four.
4. **Intervention.** Every breach of 1–3 appears in a manager queue with an action
   attached, not merely a number on a report.

---

## 1. The three daily experiences

### Sales agent — default screen `/{slug}/sales`

Today `sales/page.tsx:136-141` already branches by scope into `EmployeeHome` /
`ManagerHome`. That seam is retained; the content is what changes.

One page, ordered by what must happen soonest:

| Band          | Contents                                                                  | Source of truth              |
| ------------- | ------------------------------------------------------------------------- | ---------------------------- |
| **Now**       | Overdue actions, oldest first                                             | unified work queue (§C)      |
| **Today**     | Calls and follow-ups due, viewings scheduled today                        | unified work queue           |
| **New**       | Newly assigned enquiries not yet contacted, with first-response countdown | `Lead.slaDueAt` / `slaState` |
| **In flight** | Active negotiations and booking tasks                                     | `Opportunity`, `Booking`     |
| **Ahead**     | Upcoming viewings beyond today                                            | `SiteVisit`                  |

Selecting any row opens the customer, not a sub-app: identity, timeline,
requirements, properties discussed, and the next action, on one screen.

**Explicitly not on this page:** login duration, call counts as a score, or any
metric the agent cannot act on.

### Sales manager — default screen `/{slug}/sales` (manager variant)

An **exception queue**, not a dashboard. Every row is a problem with an action
attached; a row with no available action does not belong here.

| Exception                  | Detection                                  | Actions offered                      |
| -------------------------- | ------------------------------------------ | ------------------------------------ |
| Unassigned beyond deadline | `UNASSIGNED` past its review deadline      | assign, extend, close                |
| Missed first response      | `slaState = BREACHED`                      | reassign, request update, coach      |
| Neglected lead             | next action overdue, or none and lead open | request update, reassign, set action |
| Repeatedly postponed       | reschedule count over threshold            | coach, reassign                      |
| Viewing without feedback   | `SiteVisit COMPLETED`, no outcome          | request update                       |
| Capacity / availability    | headroom exhausted, on leave, exiting      | arrange coverage, rebalance          |
| Handover required          | owner suspended / exited                   | hand over                            |

Below the queue: team performance and coaching needs, with the comparison caveats
of §I attached to the numbers rather than hidden.

### Company owner — default screen `/{slug}/sales/leadership`

| Band            | Contents                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inflow**      | Enquiries by period, by source, channel, campaign                                                                                                         |
| **Progression** | Cohort conversion by stage; period activity shown separately and labelled                                                                                 |
| **Results**     | By source, team, agent, project/property                                                                                                                  |
| **Money**       | Booking (transaction) value **and** agency fee shown as separate lines; collected vs outstanding **where the data supports it**; costs only when complete |
| **Exceptions**  | The manager queue, aggregated                                                                                                                             |

Every metric drills through to the records behind it. Every metric is defined in
the metric dictionary (§K). A metric whose inputs are incomplete shows **unknown**,
never a number — the pattern `pl.ts:150-152` already uses.

---

## 2. Workflow specifications

Each workflow follows the same ten headings. "Today" cites
`CURRENT-CODE-MAP.md`; "Change" states what this blueprint asks for.

---

### A. Enquiry intake and customer identity

**1. Objective / roles.** Capture an enquiry from any channel, attach it to the
right customer, and preserve where it came from. Roles: agent, manager,
integration, public form.

**2. Trigger / entry.** Manual entry (`sales/leads/new`), CSV import
(`api/v1/leads/import`), public form (`api/v1/public/forms`), landing page, Meta
lead ad (`webhooks/meta/[key]`), social comment, referral.

**3. Inputs.** Required: one contact method (phone or email) and a name.
Optional: source detail, campaign, requirement fields, consent.

**4. States.** Customer identity: `ACTIVE | MERGED`. Enquiry:
`NEW → ASSIGNED → IN_PROGRESS → QUALIFIED → CONVERTED | LOST | DORMANT`, plus
`UNASSIGNED` as an explicit holding state (§B).

**5. Preconditions / validation / permissions.** Phone normalised
(`normalizePhone.ts`) before duplicate search. `leads:CREATE` for authenticated
paths; public paths are rate-limited and unauthenticated by design.

**6. Automatic actions.** Duplicate check → source attribution → score →
assignment → SLA timer → automation trigger. All five already fire from
`createLead.ts:132-146`.

**7. Exceptions.** Ambiguous duplicate → review queue rather than silent merge or
hard block. Invalid contact → enquiry still recorded, flagged, not assigned to an
agent's call queue. Integration replay → idempotent on the provider's event id.

**8. Audit / history.** Original source fields are **immutable** after creation.
Merges keep both references; `duplicateOfId` / `isMerged` already exist.

**9. Today → change.**
_Today:_ channels, normalisation, source attribution, consent flags, duplicate
detection and stage history all exist. `Lead` is simultaneously the person and the
enquiry; a returning customer creates a second `Lead` with no shared identity.
_Change:_ **CONNECT** — establish the customer of record so a person with three
enquiries over two years is one customer with three enquiries. Two options are
costed in `DECISIONS-REQUIRED.md` (D-1); the blueprint does not pick one, because
it changes the migration shape.

**10. Acceptance scenarios.**

- Same phone, second enquiry, six months later → one customer, two enquiries, both
  sources preserved.
- Meta webhook delivered twice → one enquiry.
- Two enquiries, same email, different names → ambiguous-duplicate review, neither
  auto-merged nor blocked.
- Public form with an invalid phone → enquiry recorded, flagged, not queued for a call.

---

### B. Assignment and reassignment

**1. Objective / roles.** Put every enquiry in the hands of someone who can act on
it now. Roles: system (auto), manager (bulk/direct), agent (accept/handback).

**2. Trigger / entry.** Enquiry created without an owner; manager bulk allocation;
direct assign; reassignment; handover (§J).

**3. Inputs.** Candidate pool, counts, filters, reason (required for reassignment).

**4. States.** `UNASSIGNED → ASSIGNED → REASSIGNED → HANDED_OVER`. `UNASSIGNED`
carries `responsibleQueue` and `reviewDueAt`.

**5. Preconditions — one eligibility rule, used by every path.**

A user is eligible if **all** hold:

| Check                                             | Field                               | Today                               |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Active account                                    | `User.status = ACTIVE`              | only `nextDistributionOwner`        |
| Not deleted                                       | `User.deletedAt IS NULL`            | `allocate`, `nextDistributionOwner` |
| Available                                         | `User.isAvailable`                  | `allocate` only                     |
| Not on approved leave **for the assignment date** | derived from `HrLeaveRequest`       | **nothing**                         |
| Within quota                                      | daily / weekly / monthly / capacity | `allocate` only                     |
| Team-eligible                                     | rule's candidate pool               | all paths                           |

**6. Automatic actions.** Assignment notification; SLA timer start; history row.

**7. Exceptions.**

- _Empty eligible pool_ → the enquiry enters `UNASSIGNED` with a responsible queue
  and review deadline, and the manager queue shows it. It is **not** assigned to an
  ineligible agent, and it is not silently dropped.
- _Concurrency_ → quota must hold under simultaneous requests; the rotation pointer
  must advance once per assignment.
- _Manual override_ → permitted for a manager, with a reason, recorded.

**8. Audit.** `LeadAssignmentHistory` already records from/to/method/reason/by.
Historical attribution is never rewritten by a later transfer.

**9. Today → change.**
_Today:_ three paths, three different eligibility policies; `assignLead()` enforces
none; approved leave has no effect because `User.isAvailable` / `onLeaveUntil` have
no writer; concurrency demonstrated to exceed quota (4 against 2) and to
mis-advance the rotation.
_Change:_ **REPAIR** — one `isEligible()` used by all paths; re-check headroom
inside the claim transaction; move the rule read and pointer advance inside the
transaction. **ADD** — `UNASSIGNED` as a real state; leave-derived availability.

**10. Acceptance scenarios.**

- Auto-assignment with the only pool member on approved leave today → `UNASSIGNED`,
  queued, deadline set, manager notified. Not assigned.
- Two managers allocate 2 each to an agent with a daily quota of 2 → total assigned
  is 2, the other request reports the quota as the reason.
- Two enquiries arrive simultaneously, pool of two → one each.
- Agent suspended → no new assignments, existing work appears in the handover queue.

---

### C. Agent work queue

**1. Objective / roles.** One ordered list of everything the agent must do today.

**2. Trigger / entry.** Default screen on sign-in.

**3. Inputs.** None — it is a read model.

**4. States (per item).** `OPEN → IN_PROGRESS → COMPLETED | CANCELLED`, plus
`RESCHEDULED` which records the previous due time rather than overwriting it.

**5. Permissions.** Own items; managers see their subtree.

**6. Automatic actions.** Reminder before due; overdue marking; escalation (§F).

**7. Exceptions.** Overdue; agent absent → coverage (§J); duplicate task for the
same commitment → prevented at creation.

**8. Audit.** Reschedule history is a list, not a mutated field.

**9. Today → change.**
_Today:_ **four** competing stores (`Task`, `FollowUpTask`, `Lead.nextFollowUpAt`,
`Activity.followUpAt`); reminders cover two of them and **not** the one the agent's
own page counts; "overdue" is defined differently for agent and manager on the same
page.
_Change:_ **CONNECT, not ADD.** Choose one authoritative commitment store —
`Task` is the stronger candidate: it already has type, category, recurrence,
`escalatedAt`, team and reminder fields, and it is what `crm/reminders.ts` already
sweeps. `FollowUpTask` becomes a projection or is migrated into `Task`;
`Lead.nextFollowUpAt` becomes a **derived** convenience column maintained from the
authoritative store, not an independent input. **No fifth store is created.**

**10. Acceptance scenarios.**

- A follow-up created from a call appears in the agent's queue **and** produces a
  reminder. (Today it does the first and not the second.)
- Agent and manager see the same lead as overdue at the same moment.
- Rescheduling twice leaves two history entries and one open item.
- Creating the same commitment twice produces one queue item.

---

### D. Contact and qualification

**1. Objective / roles.** Record what happened on contact, separately from where
the sale has reached, and capture requirements progressively.

**2. Trigger.** Call, message, meeting.

**3. Inputs.** Contact outcome; optional requirement fields.

**4. States — two independent axes.**

_Contact outcome (per attempt):_ `CONNECTED`, `NO_ANSWER`, `BUSY`,
`CALLBACK_REQUESTED`, `INVALID_CONTACT`, `NOT_INTERESTED`, `DO_NOT_CONTACT`.

_Sales stage (per enquiry):_ configurable via `LeadStage`, which already supports
`requiredFields`, `allowedNextStages`, `slaMinutes` and `StageCategory`.

**PROPOSED — NOT APPROVED** default stage set: `New → Contacted → Qualified →
Viewing → Negotiation → Booked → Won | Lost`.

**5. Validation.** `DO_NOT_CONTACT` sets the consent flags and removes the customer
from every call and messaging queue. Stage advance honours `requiredFields`.

**6. Automatic actions.** `CALLBACK_REQUESTED` creates the next action at the
requested time. `NO_ANSWER` schedules a retry per policy (D-4).

**7. Exceptions.** Repeated `NO_ANSWER` → attempt ceiling, then manager exception.

**8. Audit.** Every attempt is retained; the stage change is a separate history row.

**9. Today → change.**
_Today:_ `Call` outcomes and `LeadStage` already exist and are already separate
models; `Lead.status` is a free-text `String?` beside `stageId`, inviting a third
overlapping notion. Requirements capture exists.
_Change:_ **CONNECT** — bind outcome → next action. **REPAIR** — retire or define
`Lead.status`. **VERIFY** — that do-not-contact is enforced at the dialer and
messaging send paths.

**10. Acceptance scenarios.**

- `DO_NOT_CONTACT` → customer disappears from every dialer and campaign queue.
- `CALLBACK_REQUESTED` at 16:00 → exactly one queue item at 16:00.
- Stage advance missing a required field → refused, with the field named.
- Outcome recorded without a stage change → timeline shows the attempt, stage
  unchanged.

---

### E. Customer timeline

**1. Objective.** One place that answers "what happened".

**2–3.** Read model over calls, messages, notes, requirements, properties
discussed, viewings, ownership changes, offers, bookings.

**4. States.** Entries are immutable; corrections are new entries referencing the
original.

**5. Permissions.** Entry visibility follows the record's own permission; sensitive
fields follow `lib/security/fieldSecurity.ts`.

**6–7.** No automatic actions. Missing provider confirmation is shown as pending,
not as fact.

**8. Provenance — three classes, always visible.**

| Class                | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `HUMAN`              | a person entered it                                      |
| `PROVIDER_CONFIRMED` | a telephony/messaging provider confirmed it              |
| `AI_SUGGESTED`       | generated, and **not** accepted until a human accepts it |

**9. Today → change.** _Today:_ every constituent record exists; `RecordSource`
carries some provenance; no single reader joins them; AI output is not marked as a
distinct class. _Change:_ **CONNECT** the reader; **ADD** the provenance class.

**10. Acceptance.** A correction leaves both entries visible. An AI summary is
labelled and is not counted as customer contact. A user without call-recording
permission sees the call happened but not its recording.

---

### F. Follow-up and commitments

**1–3.** Objective: no commitment is silently missed. Inputs: what, who, when, why.

**4. States.** As §C, plus `ESCALATED`.

**5–6.** Reminder before due → overdue at due → escalation to manager after the
escalation window (**PROPOSED — NOT APPROVED**, D-3).

**7. Exceptions.** Customer waiting period (a deliberate pause, not neglect, and
must be distinguishable); overdue; agent absent → coverage; notification failure →
`Notification.emailError` already exists; repeated delivery → already prevented by
the existence check in `crm/reminders.ts:16-23`.

**8. Audit.** Reschedule history retained.

**9. Today → change.** _Today:_ good idempotency design; reminders miss
`FollowUpTask`; SLA is a single delayed job that is not re-swept; no escalation on
absence. _Change:_ **REPAIR** reminder coverage; **ADD** a periodic sweep and
absence-aware escalation.

**10. Acceptance.** A follow-up due at 15:00 reminds once, not three times, even
across overlapping worker runs. A follow-up whose owner is on leave escalates to
their manager rather than going overdue silently. A deliberate "customer will
revert in 3 weeks" does not appear as neglect.

---

### G. Property matching and viewings

**1. Objective.** Show the customer property that is actually available, then run
the viewing to a recorded outcome.

**4. States.** `SiteVisit`: `REQUESTED → APPROVED → CHECKED_IN → COMPLETED`, plus
`REJECTED`, `CANCELLED`, `NO_SHOW` — already implemented.

**5. Validation.** Matching filters to marketable inventory. Availability freshness
is asserted at scheduling **and re-asserted at confirmation**.

**7. Exceptions.** Agent or calendar conflict → refuse with the clash named.
Property becomes unavailable between scheduling and viewing → the customer is
notified and alternatives are offered rather than the viewing silently proceeding.
`NO_SHOW` → next action, not a dead end.

**9. Today → change.** _Today:_ `SiteVisit` and `moveUnit` are both strong;
`matchesForRequirement` filters to marketable listings. Viewing feedback does not
create a next action. `moveUnit` allows `HELD → BOOKED` over another agent's hold.
_Change:_ **REPAIR** the hold guard; **CONNECT** outcome → next action;
**VERIFY** whether matching covers project units as well as listings.

**10. Acceptance.** A viewing completed without feedback appears in the manager
queue. A unit that sells between scheduling and viewing surfaces before the
customer travels. Two agents cannot both hold the same unit.

---

### H. Negotiation and booking

**1. Objective.** Turn an agreed deal into a booking without ever selling the same
unit twice, and track the money as **three separate events**.

**4. States.**

_Reservation:_ `NONE → HELD (owner, expiry) → RELEASED | CONVERTED`.
_Booking:_ `DRAFT → CONFIRMED → CANCELLED`.
_Property completion:_ a separate event on the unit.
_Agency collection:_ a separate event with an amount and evidence.

> **These three are not the same event.** Confirming a booking does not complete
> the property; collecting the agency fee does not mark a unit `SOLD`. No such
> rule is proposed here, and none should be inferred.

**5. Preconditions.** Confirmation must, in **one transaction**: verify the unit is
reservable by this agent, move it, and write the booking. The service that does the
first two already exists (`moveUnit`, row-locked) and is simply not called.

**6–7. Exceptions.** Competing requests → exactly one wins. Reservation expiry →
released. Cancellation → unit returns to market, commissions clawed back first (the
existing guard). Reopening → explicit, audited.

**8. Audit.** Booking placement (`teamId`/`branchId`/`regionId`) is frozen at
confirmation — already correct — and must never be re-derived later.

**9. Today → change.** _Today:_ API exists and works; **no UI at all**; the booking
flow never touches inventory; no database constraint; two concurrent confirmations
both succeeded; collection needs only `bookings:EDIT` and records only a timestamp.
_Change:_ **ADD** the booking UI and a collection event with an amount and
evidence; **REPAIR** atomicity, with a partial unique index as the database
backstop; apply the maker-checker pattern that `payouts.ts:168,174` already
implements.

**10. Acceptance.** Two simultaneous confirmations against one unit → one succeeds,
one is refused with the reason. Confirming moves the unit in the same transaction.
An expired hold releases. Collecting an agency fee does **not** change the unit's
status.

---

### I. Employee activity and manager intervention

**1. Objective.** Show useful business activity and let a manager act on
exceptions — without treating presence as productivity.

**4–6.** Exceptions are the states; each carries: request an update, coach,
reassign, arrange coverage, resolve.

**9. Today → change.** _Today:_ `funnel`, `conversion`, `activityCompliance`,
`performerBoard`, `rank`, `chasingQueue` all exist as _reports_. No action is
attached to an exception. Nothing normalises comparisons.
_Change:_ **CONNECT** actions to exceptions; **ADD** comparison caveats.

**Comparison honesty.** Ranking agents on raw counts is misleading when they differ
in source quality, assignment age or sales-cycle length. Every comparison must
either segment on those, or state that it does not.

**10. Acceptance.** Resolving an exception records who resolved it and why. An
agent with older, colder leads is not ranked as underperforming without the caveat
shown. Login duration appears nowhere as a performance metric.

---

### J. HRMS connections

**1. Objective.** HR events change sales access and workload correctly, without
leaking confidential HR data into sales management.

**4. Events → effects.**

| HR event       | Sales effect                                                      |
| -------------- | ----------------------------------------------------------------- |
| Joining        | eligible for assignment once active                               |
| Approved leave | ineligible **for the leave dates**; coverage arranged             |
| Team transfer  | future attribution moves; **historical attribution does not**     |
| Suspension     | no new work; existing work to handover queue                      |
| Exit           | access removed; open leads, tasks, viewings and deals handed over |

**5. Confidentiality.** A sales manager sees _availability_, never the reason.
Medical, disciplinary and salary information stay inside HR permissions.

**9. Today → change.** _Today:_ exit sets `User.status = 'DEACTIVATED'`
(`hr/lifecycle.ts:535-537`) and **nothing else** — no handover exists anywhere.
Leave does not affect availability. HR's permission split is well designed, but the
reports layer discards scope and the HR actions route blocks the payroll approver.
_Change:_ **ADD** handover; **ADD** leave→availability; **REPAIR** the scope and
gate defects.

**10. Acceptance.** An exiting agent's 40 open leads appear in a handover queue
before their access is removed, and last quarter's performance still shows their
name. A sales manager sees "unavailable 3–10 Oct", not the leave type.

---

### K. Owner reporting

**1. Objective.** Numbers the owner can trust and drill into.

**Metric dictionary.** Every metric carries all ten attributes:

| Attribute                    | Rule                                                 |
| ---------------------------- | ---------------------------------------------------- |
| Business definition          | one sentence, no jargon                              |
| Source records/fields        | model and column                                     |
| Included / excluded statuses | explicit list, both sides                            |
| Date basis + timezone        | which timestamp, whose clock                         |
| Numerator / denominator      | for every rate                                       |
| Currency handling            | one currency per report; minority excluded and named |
| Visibility scope             | whose records are counted                            |
| Drill-down                   | the list of records behind the number                |
| Missing data                 | **unknown**, never zero                              |

**Cohort vs period.** Cohort conversion (of enquiries received in March, how many
converted, ever) and period activity (how many conversions happened in March,
whenever received) are different questions and are never shown as one number.

**Money separation.** Transaction value, agency fee, collected income, commission
cost and other costs are five separate lines. **Incomplete costs are never
presented as company profit** — the existing `null`-margin-plus-caveat pattern is
the model.

**9. Today → change.** _Today:_ the P&L's structure is right (caveats, null
margin, currency exclusion) and four of its queries are wrong. No dictionary
exists. _Change:_ **ADD** the dictionary; **REPAIR** the four queries.

**10. Acceptance.** Draft bookings do not appear as revenue. A cancelled payroll
run is not a cost. Moving an employee does not restate last quarter. Every metric
drills to its records. A metric missing an input shows unknown.

---

### L. AI assistance

**Six prioritised features.** For each: permitted data, source references, output,
human review, validation, audit, cost limit, failure handling.

| Feature                   | Permitted data                                            | Output                                                          | Human review                                                             |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Pre-call briefing         | this customer's timeline, within the caller's permissions | summary + suggested talking points, each citing a source record | read-only; no writes                                                     |
| Call / voice-note summary | the recording/transcript the user may access              | summary, labelled `AI_SUGGESTED`                                | accepted before it enters the timeline as fact                           |
| Suggested CRM updates     | as above                                                  | proposed field changes                                          | **required** — applied through application services, never direct writes |
| Message drafts            | customer context + approved templates                     | draft only                                                      | required before send                                                     |
| Explainable matching      | requirements + marketable inventory                       | ranked matches **with the reason for each**                     | agent selects                                                            |
| Manager exception summary | the manager's own subtree                                 | grouped exceptions                                              | read-only                                                                |

**Non-negotiable boundaries.**

- Retrieval happens **through the user's existing permissions**. AI is not a
  permission bypass, and must never widen what a caller can see.
- Writes go through application services, so validation, permission and audit all
  still apply.
- Financial calculations are **deterministic**, never generated.
- Customer content and uploaded documents are **untrusted input**. Instructions
  found inside them are data, never commands.
- AI must not make property or financial commitments to a customer.
- Every call is metered against the tenant budget; over budget, the feature
  degrades visibly rather than failing silently.
- Unavailable or low-confidence output says so; it does not guess.

**9. Today → change.** _Today:_ a genuinely good foundation — provider abstraction
with a simulated mode, per-tenant budget (`assertAiBudget`), redaction, audit.
_Change:_ **VERIFY** first — that assistant tools retrieve through the caller's
permissions rather than merely declaring which modules they read. That check gates
everything else in this section. Then **ADD** the six features as workflow-attached
capabilities.

---

## 3. Target structure

### Navigation

| Role    | Default screen               | Primary                                         | Secondary             |
| ------- | ---------------------------- | ----------------------------------------------- | --------------------- |
| Agent   | `/{slug}/sales` — my day     | Customers, Properties, Viewings, Bookings       | Calendar, Documents   |
| Manager | `/{slug}/sales` — exceptions | Team, Customers, Allocation, Performance        | Reports, Coaching     |
| Owner   | `/{slug}/sales/leadership`   | Inflow, Progression, Results, Money, Exceptions | Reports, Targets      |
| HR      | `/{slug}/people`             | Employees, Leave, Attendance, Lifecycle         | Payroll, HR reports   |
| Finance | `/{slug}/sales/commissions`  | Commissions, Payouts, Collections               | Slabs, Reconciliation |
| Admin   | `/{slug}/admin`              | Users, Roles, Integrations, Settings            | Audit                 |

**Bookings joins the sales navigation.** Its absence is the reason the whole
negotiation-to-money chain is unreachable in the UI today.

### Entity relationship map

```
Customer ──1:N── Enquiry(Lead) ──1:N── Opportunity ──1:1── Booking
   │                  │                     │                │
   │                  │                     │                ├── Commission ──N:1── Payout
   │                  │                     │                └── Collection (ADD)
   │                  │                     │
   │                  ├── Activity / Call / Communication      (timeline)
   │                  ├── Commitment (Task)                    (one next-action store)
   │                  ├── Requirement ──match──> Listing / UnitInventory
   │                  └── SiteVisit ──> Project / Unit / Listing
   │
   └── consent, identity, contact methods

User ──owns──> Enquiry, Task, SiteVisit, Opportunity, Booking
 │
 └──1:1── WorkspaceMembership ──1:1── EmployeeProfile ──> leave, payroll, lifecycle
```

`Customer` and `Collection` are the two additions. Everything else exists.

### State transition tables

**Enquiry**

| From             | To          | Guard                            |
| ---------------- | ----------- | -------------------------------- |
| NEW              | UNASSIGNED  | no eligible owner                |
| NEW / UNASSIGNED | ASSIGNED    | eligible owner (§B)              |
| ASSIGNED         | IN_PROGRESS | first contact recorded           |
| IN_PROGRESS      | QUALIFIED   | stage `requiredFields` satisfied |
| QUALIFIED        | CONVERTED   | opportunity created              |
| any open         | LOST        | reason required                  |
| any open         | DORMANT     | inactivity threshold             |
| LOST / DORMANT   | ASSIGNED    | reopen, audited                  |

**Commitment (next action)**

| From        | To                                  | Guard                           |
| ----------- | ----------------------------------- | ------------------------------- |
| OPEN        | IN_PROGRESS / COMPLETED / CANCELLED | owner or manager                |
| OPEN        | RESCHEDULED                         | new due time; previous retained |
| OPEN        | ESCALATED                           | overdue past escalation window  |
| RESCHEDULED | OPEN                                | automatic                       |

**Viewing** — as implemented: `REQUESTED → APPROVED → CHECKED_IN → COMPLETED`,
`REJECTED`, `CANCELLED`, `NO_SHOW`. Retained unchanged.

**Booking**

| From      | To        | Guard                                                         |
| --------- | --------- | ------------------------------------------------------------- |
| DRAFT     | CONFIRMED | unit reservable **and** moved in the same transaction         |
| CONFIRMED | CANCELLED | commissions clawed back first (existing guard); unit released |

Reservation, property completion and agency collection each have their own
transitions and are **not** derived from the booking state.

### Event and notification responsibility map

| Event                                             | Emitter                 | Consumers                     |
| ------------------------------------------------- | ----------------------- | ----------------------------- |
| `lead.created`                                    | `createLead`            | distribution, sla, automation |
| `lead.assigned`                                   | assignment paths        | notification, history         |
| `lead.unassigned_overdue`                         | sweep (**ADD**)         | manager queue                 |
| `sla.first_response_breached`                     | `checkLeadFirstContact` | automation, manager queue     |
| `commitment.due_soon` / `.overdue` / `.escalated` | reminder sweep          | agent, then manager           |
| `visit.completed_without_feedback`                | sweep (**ADD**)         | manager queue                 |
| `booking.confirmed`                               | booking service         | commission accrual, inventory |
| `collection.recorded` (**ADD**)                   | collection service      | commission eligibility        |
| `hr.leave_approved`                               | `decideLeave`           | availability (**ADD**)        |
| `hr.exit_initiated`                               | lifecycle               | handover queue (**ADD**)      |

### Deterministic vs AI boundary

| Always deterministic                           | AI may assist                                   |
| ---------------------------------------------- | ----------------------------------------------- |
| Permissions and visibility                     | Summarising what a user may already see         |
| Assignment eligibility and quotas              | Suggesting who to assign and why                |
| Inventory state transitions                    | Explaining why a property matches               |
| Money: fees, commissions, collections, payroll | Drafting the message about them                 |
| SLA timers and escalation                      | Summarising the exception queue                 |
| Audit history                                  | Proposing a timeline entry for human acceptance |

The left column is never generated. The right column is never authoritative.

### Architecture

**No architectural change is proposed.** Next.js App Router, Prisma, PostgreSQL
with RLS, BullMQ workers and the existing API route kernel are sufficient for
everything above. No microservices, no new framework, no replacement CRM. The two
schema additions (`Customer`, `Collection`) and one consolidation (commitments) are
the only structural moves, and each is justified by a named workflow requirement.
