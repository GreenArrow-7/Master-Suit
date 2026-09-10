# Next-action and reminder contracts

Specification only. Nothing in this document is implemented in the Foundation
Closeout: no schema migration, no `FollowUpTask` consolidation, no change to the
reminder sweep. It replaces the earlier draft contract in
[`WORKFLOW-BLUEPRINT.md`](WORKFLOW-BLUEPRINT.md) §D, which was wrong in a way
worth stating plainly before anything is built on it.

**What the earlier draft got wrong.** It specified _"at most one open obligation
per lead per kind"_ and made that the uniqueness rule. That is not a contract,
it is a data-loss policy. A buyer can legitimately owe a callback _and_ a site
visit _and_ a document chase on the same day; two agents can legitimately each
owe something on a shared account; a manager can legitimately add a second
obligation without replacing the first. A uniqueness rule at
`(lead, kind, open)` silently refuses or overwrites the second one. Worse, the
system already behaves this way in one place by accident — see §3.2 — and it is
a defect there, not a design.

The corrected position: **an obligation is unique by its own identity. Nothing
about a lead or a kind constrains how many may be open.** Deduplication is a
property of _how an obligation was requested_, not of _what it is about_.

### Revision 2 — what this revision corrects

Seven points, each marked **Corrected** where it appears. Recorded here because
an earlier revision of this document was reviewed, and a reader who saw it needs
to know what moved:

| #   | Was                                                                  | Now                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "a human action never carries a `sourceKey`"                         | every create carries a `requestKey`, people included — a double-submitted form is a retry, not a second commitment (§2.2)                                                                                |
| 2   | dedupe keys named the source _event_                                 | they name the _action or occurrence_ within it, so one event can deliberately create several obligations (§2.2)                                                                                          |
| 3   | a replayed key silently returned success                             | a replayed key with materially different input is an explicit **conflict**, and authorization runs **before** the idempotency lookup (§2.2)                                                              |
| 4   | one aggregate `UPDATE … SET = (SELECT MIN(…))` was called sufficient | it is not: `READ COMMITTED` takes no lock and the subquery snapshots. A `Lead` row lock with a stated global ordering, or bounded `SERIALIZABLE` retry with fresh reads (§2.6)                           |
| 5   | derive `nextFollowUpAt` from `Task`                                  | derive from the **union** while `FollowUpTask` still holds open rows; deriving from `Task` alone would _erase_ real work. Four-step transition (§2.6)                                                    |
| 6   | reminder identity keyed on `dueAtRaised`                             | keyed on a monotonic `scheduleRevision` plus recipient and channel, so 09:00 → 14:00 → 09:00 does not lose the third reminder (§3.3)                                                                     |
| 7   | delivery followed the claim                                          | delivery **re-reads** and drops on completion, cancellation, reassignment or reschedule; and the guarantee is stated honestly as exactly-once _claiming_, at-least-once _delivery attempts_ (§3.4, §3.5) |

Point 5 also separates two questions the earlier revision merged: a lead-wide
"next obligation" and an agent's "your next action" are different values and
cannot share a column.

---

## 1. Ground truth: what exists today

Everything below is read from the tree at the closeout commit, not assumed.

### 1.1 Two obligation tables

| Model          | Fields that matter here                                                                                                                      | Read by                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Task`         | `typeId`, `category`, `dueAt`, `remindAt`, `recurrenceRule`, `parentTaskId`, `status`, `ownerId`, `teamId`, `escalatedAt`, `completionNotes` | tasks screens, sales dashboards, **the reminder sweep** |
| `FollowUpTask` | `title`, `dueAt`, `priority`, `status`, `outcome`, `ownerId`, `leadId`, `callId`, `campaignId`                                               | dashboard, calendar, call detail, follow-ups screen     |

Both are live. `Task` is the richer model and the only one the reminder sweep
reads; `FollowUpTask` is the one four sales surfaces read. An obligation created
on one is invisible to the other. This split is the subject of backlog item
P1-3 and is **not** resolved here.

### 1.2 `Lead.nextFollowUpAt` has no writer

`nextFollowUpAt` is declared on `Lead`, indexed as `@@index([tenantId, nextFollowUpAt])`,
and read by six surfaces:

- `sales/leads/page.tsx:23` — the **Overdue** filter (`nextFollowUpAt < now`)
- `sales/leads/LeadGrid.tsx:389` — the sortable _Next follow-up_ column
- `sales/leads/[id]/LeadDetail.tsx:179` — the overdue flag on lead detail
- `sales/page.tsx:388` — the overdue count on the sales landing page
- `sales/smart-views/page.tsx:51` — the built-in _Overdue follow-ups_ view
- `services/leadership/rollups.ts:356` — the leadership exception queue

A search of `src/` for any write finds none: every occurrence is a `select`, an
`orderBy`, a filter predicate, or a formatter. **The field is populated only by
seed and import.** Creating a task with a due date does not set it; completing
one does not clear it.

So today, every "overdue" surface in Sales is driven by a column the product
never updates. This is the single highest-value item in this document: the
contract below is what makes those six existing surfaces mean something, and it
needs no new UI.

### 1.3 `Activity` is the history table

`Activity` carries `occurredAt`, `outcome`, `notes`, `nextAction` (free text),
`followUpAt`, `source`, and a soft-delete. It is append-mostly and already
indexed for reverse-chronological reads per lead, per owner and per type. It is
the timeline the customer detail screen renders.

**`Activity` stays as history.** It is not the obligation store and must not
become one. An obligation _produces_ activity rows; it is not itself one. The
distinction that matters: an `Activity` answers "what happened", an obligation
answers "what is still owed". Merging them makes it impossible to ask either
question cleanly, and destroys the timeline the moment an obligation is edited.

---

## 2. The obligation contract

### 2.1 Identity

> **An obligation has exactly one identity: its own primary key.**

There is no natural key. Not `(lead, kind)`, not `(lead, owner, kind)`, not
`(lead, kind, dueDate)`. Any of those forbids a legitimate second obligation.

Consequences:

- Any number of obligations may be open against one lead, in any combination of
  kinds, owners and due dates.
- Two obligations of the same kind, same owner, same lead, same due date are
  **valid and distinct** if they were requested twice deliberately. They are a
  duplicate only if they came from the same request — which §2.2 decides, not
  the shape of the row.
- Closing one obligation has no effect on any other.

### 2.2 Idempotency: request identity, and provenance, are two more things

**Corrected.** An earlier draft of this section said _"a human action never
carries a `sourceKey`"_, and folded deduplication and provenance into one
column. Both were wrong, and the first was wrong in the dangerous direction: it
made every double-submitted form a second commitment.

Three questions, three keys. Conflating any two of them produces a bug that
looks like a feature:

| Question                                         | Key          | Scope                                           |
| ------------------------------------------------ | ------------ | ----------------------------------------------- |
| _Which obligation is this?_                      | `id`         | §2.1 — the primary key, always                  |
| _Have I already carried out this exact request?_ | `requestKey` | unique per tenant, **required on every create** |
| _What caused it, and can I trace it back?_       | `sourceRef`  | not unique, never a dedupe key                  |

#### `requestKey` — required, for people too

> **Every create supplies a `requestKey`, unique per tenant. A create whose
> `requestKey` is already recorded returns the existing obligation. Retries of
> one request are safe; a deliberately new action mints a new key.**

```
@@unique([tenantId, requestKey])
```

A person's double-submitted form, a browser retry after a dropped response, a
mobile client replaying a queued action offline — these are _retries of one
request_, and the previous draft would have created a second commitment for each.
So the client mints the key when the user opens the form or presses the button,
and reuses it for every retry of that same press. Pressing _Add follow-up_ a
second time is a new press, so it mints a new key and creates a second
obligation, which is correct and is the case §2.1 exists to protect.

The rule generalises: **a new key means a new intention; a reused key means the
same intention, delivered again.** It does not matter whether the intention came
from a person or a worker.

#### One event, several obligations

A single source event may deliberately produce more than one obligation — an
enquiry that must produce both a callback and a document chase, a stage change
that opens three onboarding steps. Keying on the event alone would create the
first and silently swallow the rest.

**So a machine-minted `requestKey` names the action or occurrence, not only the
event:**

| Cause                      | `requestKey`                               | Note                                                                                                   |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Automation rule action     | `rule:<ruleId>:<eventId>:<actionId>`       | `actionId` is the action's position/id **within** the rule — three actions on one event are three keys |
| Webhook / portal intake    | `intake:<provider>:<messageId>:<actionId>` |                                                                                                        |
| Recurrence expansion       | `recur:<parentTaskId>:<occurrenceISO>`     | the occurrence _is_ the action                                                                         |
| SLA escalation             | `sla:<leadId>:<episodeId>:<stepN>`         | an episode, not a wall-clock time — a re-entry is a new episode (§3.4)                                 |
| A person pressing a button | `ui:<clientMintedUuid>`                    | minted once per press, reused for every retry of that press                                            |

The general shape is `<origin>:<cause>:<action>`. Omitting the action segment is
the specific mistake that turns "create three tasks" into "create one".

#### Conflicting reuse is a conflict, not a silent win

> **A `requestKey` replayed with input that differs materially from the recorded
> request is rejected with an explicit conflict. It never overwrites, never
> creates, and never returns a success the caller can misread.**

"Materially" means the fields that define the commitment: owner, due time, kind,
subject, lead. Cosmetic differences (a re-typed title, a trimmed note) do not
conflict. The response carries the stored obligation alongside the refusal, so a
client can show _"this was already created, as follows"_ rather than guessing.

Two properties this must not lose:

- **Authorization runs before the idempotency lookup, always.** A replayed key is
  not a bypass. An actor who may not create an obligation for that lead is
  refused with the same 403 whether the key is new or replayed — otherwise a
  leaked key becomes a capability. The idempotent return is a _result_ cache, not
  an _authorization_ cache.
- **The recorded request stores the actor.** A replay by a different actor is a
  conflict even when every field matches, because "who committed to this" is part
  of the commitment.

#### `sourceRef` — provenance, and nothing else

Separately, and non-uniquely, an obligation records where it came from:
`{ origin, eventId, ruleId, actorId, ... }`. It answers "why does this exist",
supports "show me everything this rule created", and survives a `requestKey`
scheme changing. **It is never consulted to decide whether to create.** Keeping
it out of the unique constraint is what allows one event to produce many
obligations while each remains individually idempotent.

### 2.3 Rescheduling and replacement

Two operations, deliberately not the same one.

**Reschedule** — the obligation persists, its due time moves:

- `dueAt` is updated in place. `id` and `sourceKey` are unchanged.
- The row keeps its history: the previous `dueAt` is written to the timeline
  (§2.5), not overwritten and forgotten.
- Every reminder already emitted for the old time is invalidated (§3.4).
- Rescheduling an obligation that is not `OPEN` is refused. A completed
  obligation is not moved; a new one is created if something is still owed.

**Replace** — one obligation supersedes another:

- The superseded obligation transitions to a terminal state that is _not_
  `COMPLETED` — it was not done — and records which obligation replaced it.
  `CANCELLED` with a `replacedById` pointer is sufficient; a `SUPERSEDED` state
  is clearer if the enum is being touched anyway.
- The replacement is a new row with a new `id`. It links back via
  `replacesId`.
- Neither row is deleted, and neither loses its timeline.

The distinction matters for measurement: a rescheduled obligation is one piece
of work that moved, a replaced obligation is two pieces of work where the first
was abandoned. Collapsing them makes "how often do we move commitments?"
unanswerable, and that is a question this business asks.

### 2.4 States

`OPEN → COMPLETED` (the work was done, `outcome` recorded)
`OPEN → CANCELLED` (the work is no longer owed; `replacedById` set if superseded)
`OPEN → OPEN` (rescheduled; `dueAt` moved)

Terminal states are terminal. Reopening is a _new_ obligation with
`replacesId` pointing at the closed one — not a state flip — so that "was this
ever completed?" has one answer forever.

Overdue is **derived, never stored**: `status = OPEN AND dueAt < now()`. A
stored `isOverdue` flag is a second source of truth that goes stale the moment a
clock ticks without a sweep running.

### 2.5 History is preserved, and it is `Activity`

Every transition in §2.3 and §2.4 appends an `Activity` row:

- `leadId` copied from the obligation (where it has one), so the customer
  timeline shows the commitment being made, moved, and closed.
- `occurredAt` is the time of the transition.
- `outcome` carries the transition (`created`, `rescheduled`, `completed`,
  `cancelled`, `superseded`).
- `notes` carries the human-readable delta — for a reschedule, both the old and
  the new time.
- `ownerId` is the actor.

The obligation row holds _current_ state; `Activity` holds _what happened to
it_. Neither is derivable from the other, and the timeline must not be
reconstructed by diffing `updatedAt`.

`Activity.followUpAt` and `Activity.nextAction` are **not** obligations and must
not be treated as such. They are what a person typed into a call note. If an
intent recorded there should become an obligation, the code that reads the note
creates one explicitly, with a `sourceKey` of `activity:<activityId>` so the
same note cannot mint two.

### 2.6 `Lead.nextFollowUpAt` is derived — and it is not the agent's next action

> **`Lead.nextFollowUpAt` = the earliest `dueAt` among all `OPEN`, non-deleted
> obligations linked to that lead, across every owner and every kind, **over
> every store still holding live obligations**; `NULL` when there are none.**

The minimum of a set of any size is one value, so this needs no one-per-lead
rule (§2.1).

#### Two different questions, and only one of them is this column

**Corrected.** An earlier draft treated "the lead's next obligation" and "what
this agent does next" as the same value. They are not, and a single column
cannot answer both:

| Question                                            | Answer                                        | Where it lives                           |
| --------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| _When is this lead next owed something, by anyone?_ | earliest open `dueAt` across all owners       | `Lead.nextFollowUpAt` — a lead-wide fact |
| _What do I do next on this lead?_                   | earliest open `dueAt` **owned by the viewer** | computed per request, never stored       |

A lead with a rep's callback due Thursday and a manager's review due Tuesday is
"waiting on us since Tuesday" on a manager's exception queue, and "your callback
is Thursday" in the rep's own list. Storing one number and rendering it in both
places tells the rep they are late for something that is not theirs.

So: the column is lead-wide and owner-independent, and every _agent-facing_
"your next action" is a scoped query at read time. The existing six read sites
divide accordingly — the leadership exception queue and the sales overdue count
are lead-wide; the agent's grid column and lead-detail flag are per-viewer. That
split is a task in its own right and is recorded in the backlog.

#### It cannot be populated from `Task` alone while `FollowUpTask` is live

**Corrected, and this is a sequencing constraint rather than a preference.**
Both stores currently hold open obligations (§1.1). Deriving the column from
`Task` alone would set `NULL` on every lead whose only open obligation is a
`FollowUpTask` row — silently _removing_ real work from the Overdue surfaces
that read it. That is worse than the current state, where the column is merely
stale.

The transition, in order:

1. **Map before deriving.** Establish, for every open `FollowUpTask`, whether an
   equivalent `Task` exists. Produce a reconciliation report: mapped, unmapped,
   ambiguous. This is a read-only step and must run clean before step 2.
2. **Derive from the union.** Until consolidation completes, the derivation
   reads _both_ stores — `MIN` over open `Task` ∪ open `FollowUpTask` for the
   lead. It is more expensive and it is correct, which is the right trade for a
   transitional period.
3. **Consolidate** (P1-3), carrying `requestKey` across.
4. **Narrow the derivation to `Task`** only once step 1's report shows zero
   unmapped open rows, and never before.

Skipping to step 4 is the failure this section exists to prevent.

#### Concurrency: the aggregate UPDATE is not sufficient on its own

**Corrected.** An earlier draft claimed a single
`UPDATE … SET nextFollowUpAt = (SELECT MIN(…))` statement was enough because it
"never reads a value into application code". That is wrong. Under `READ
COMMITTED` the subquery takes a snapshot at statement start and takes no lock on
the obligation rows; a concurrent transaction that inserts, completes,
reschedules or soft-deletes an obligation for the same lead is invisible to it,
and the two recomputes can interleave so that the last writer stores a value
that was already stale when it was computed. Atomicity of one statement is not
isolation from another transaction.

**The rule:**

> **Every operation that can change a lead's set of open obligations —
> create, complete, cancel, reschedule, delete, reassign — takes a row lock on
> the `Lead` before recomputing, in the same transaction as the obligation
> write.**

```sql
-- 1. serialise on the lead. Every writer takes this first.
SELECT id FROM "Lead" WHERE id = $1 AND "tenantId" = $2 FOR UPDATE;

-- 2. write the obligation (insert / update / soft-delete)

-- 3. recompute from a read that is now guaranteed fresh for this lead
UPDATE "Lead" l SET "nextFollowUpAt" = (
    SELECT MIN(d."dueAt") FROM (
      SELECT "dueAt" FROM "Task"
        WHERE "leadId" = l.id AND "tenantId" = l."tenantId"
          AND status = 'OPEN' AND "deletedAt" IS NULL
      UNION ALL
      SELECT "dueAt" FROM "FollowUpTask"
        WHERE "leadId" = l.id AND "tenantId" = l."tenantId"
          AND status = 'OPEN' AND "deletedAt" IS NULL
    ) d)
  WHERE l.id = $1 AND l."tenantId" = $2;
```

**Lock ordering.** The `Lead` row is taken **first**, before any obligation row
and before any `User` row. An operation touching several leads locks them in
ascending `id` order. This is the single ordering rule for this subsystem and it
is what keeps it deadlock-free against the assignment path, which takes
`User` then `Lead` — see the note below.

> **The one exception, stated so it is not discovered as a deadlock.** Lead
> _assignment_ locks `User` before `Lead`, because it must serialise an agent's
> capacity across concurrently-assigned leads. An obligation write must
> therefore never take a `User` lock while holding a `Lead` lock. If a future
> operation genuinely needs both, it adopts the assignment order (`User`, then
> `Lead`) and this section is amended rather than worked around.

**Serializable as the alternative.** A caller may instead run at `SERIALIZABLE`
and retry on `40001`, provided the retry is bounded, logged, and re-reads
everything it depends on — a retry that reuses values read in the failed attempt
reintroduces exactly the staleness it was meant to remove. Locking is the
default because the contention here is per-lead and low.

**The four operations, explicitly:**

| Operation            | Lock              | Recompute | Note                                                              |
| -------------------- | ----------------- | --------- | ----------------------------------------------------------------- |
| Create               | `Lead` FOR UPDATE | yes       | the new `dueAt` may be earlier than the current value             |
| Complete             | `Lead` FOR UPDATE | yes       | may move the value later, or to `NULL`                            |
| Reschedule           | `Lead` FOR UPDATE | yes       | may move it either direction                                      |
| Cancel / soft-delete | `Lead` FOR UPDATE | yes       | the deleted row must be excluded by the _same_ transaction's read |

Because it remains a cache, a reconciliation sweep must be able to rebuild the
column tenant-wide and **report rows that disagreed** rather than only fixing
them. A cache with no drift detection is indistinguishable from corruption.

---

## 3. The reminder contract

### 3.1 What a reminder is

> **A reminder is one logical notification about one obligation at one due
> time. It is created once. Delivering it may be attempted many times, over
> several channels. Those attempts are not reminders.**

The current model conflates the two: `Notification` carries `emailedAt` and
`emailError` — a single delivery outcome — and the reminder sweep writes a
notification row per sweep decision. There is nowhere to record that email
succeeded and push failed, and no way to retry one without re-notifying.

The separation:

- **Reminder** (one row): tenant, recipient, `kind`, the obligation it is about,
  the `dueAt` it was raised for, when it was raised.
- **Delivery attempt** (many rows, or a JSON column if a table is too much
  today): channel, attempt number, status, provider message id, error.

"Was the rep told?" is answered by the reminder. "Did the email land?" is
answered by the attempts. Today only the second question is answerable, and only
for email.

### 3.2 The uniqueness defect in the current sweep

`src/services/crm/reminders.ts` decides whether to send by embedding a
`NOT EXISTS` subquery in its `SELECT`:

```sql
AND NOT EXISTS (
      SELECT 1 FROM "Notification" n
       WHERE n."tenantId" = t."tenantId"
         AND n."userId"   = t."ownerId"
         AND n.kind       = 'follow_up.due'
         AND n."recordId" = COALESCE(t."leadId", t.id)
         AND n."createdAt" > now() - ($2 || ' hours')::interval)
```

and then inserts in a **separate transaction** (`writeReminders` calls
`withPlatformTx` again, at line 164). The file's own header argues this is
idempotent under overlapping runs. It is not, for three independent reasons:

1. **The check and the insert are not atomic.** Two sweeps that both `SELECT`
   before either `INSERT` both see no notification and both write one. Two
   reminders for one obligation.
2. **Even in one transaction it would not hold.** Under `READ COMMITTED`, which
   is PostgreSQL's default and what this code runs at, `NOT EXISTS` takes no
   lock and does not see an uncommitted concurrent insert. Serialising the check
   requires either `SERIALIZABLE` with retry, an advisory lock on the key, or a
   unique index. An existence check is not one of them.
3. **`Notification` has no unique constraint at all.** Nothing in the database
   would refuse the duplicate even if the application asked it to. There is no
   backstop under any of the above.

And a fourth issue, which is the §2 error showing up in running code: the dedupe
key uses `recordId = COALESCE(t."leadId", t.id)`. **Two open tasks on the same
lead collapse to one reminder**, because both produce the same `recordId`. The
rep is told about one of them and never about the other. That is the
one-obligation-per-lead assumption, already shipped, already losing reminders.

### 3.3 Atomic claiming, and a schedule that survives A → B → A

> **The database enforces reminder uniqueness with a unique index, and the sweep
> claims by inserting against it.**

**Corrected.** An earlier draft keyed the index on `dueAtRaised` — the due time
itself. That breaks on a return trip. Move an obligation from **09:00 → 14:00 →
09:00** and the third state collides with the first: the reminder for 09:00 was
already claimed and cancelled, so the row exists, `ON CONFLICT DO NOTHING`
suppresses the new claim, and **the rep is never reminded**. A timestamp is not
a version.

#### Schedule revision

Every obligation carries a monotonically increasing `scheduleRevision`,
incremented **inside the same transaction** by any change to what is being
reminded about — the due time, the owner, or the reminder offset. It never
decreases and it never resets, so A → B → A is revisions 1 → 2 → **3**, all
distinct.

```
@@unique([tenantId, obligationId, kind, scheduleRevision, recipientId, channel])
```

| Segment            | Why it is in the key                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `obligationId`     | not the lead — §3.2 (4): two obligations on one lead are two reminders                               |
| `kind`             | a due-soon reminder and an overdue escalation are different notifications                            |
| `scheduleRevision` | survives A → B → A; a re-run over an _unchanged_ schedule is the same revision and correctly dedupes |
| `recipientId`      | reassignment sends to the new owner without the old owner's row suppressing it                       |
| `channel`          | in-app and email are separate logical notifications, each with its own delivery record (§3.1)        |

`dueAtRaised` is still **stored** — it is what the notification says and what the
audit needs — but it is no longer part of the identity.

#### Recipient and channel

- **Recipient** is resolved at claim time, not at arm time. An obligation
  reassigned between arming and firing reminds the _current_ owner; the previous
  owner's already-delivered reminder stands as history and their undelivered one
  is cancelled (§3.4).
- **Channel** is decided per recipient from their notification preferences at
  claim time. In-app is always claimed, because it is the only channel with no
  provider between the system and the person. Additional channels are separate
  rows sharing everything but `channel`, so one failing does not suppress the
  other.

#### The claim

```sql
INSERT INTO "Reminder" (...)
SELECT ... FROM "Task" t WHERE <due window> AND <open>
    ON CONFLICT ("tenantId", "obligationId", kind, "scheduleRevision",
                 "recipientId", channel) DO NOTHING
RETURNING id, ...
```

- Concurrent sweeps are safe: the loser's rows are dropped by the index, not by
  a race it happened to win.
- The claim _is_ the write; there is no window between deciding and doing.
- `RETURNING` yields exactly what this sweep claimed, so delivery is enqueued for
  those and only those.
- The 24-hour suppression window disappears, with its side effect of suppressing
  legitimately re-raised reminders.

`ON CONFLICT DO NOTHING` **replaces** the existence check rather than backing it
up. Keeping both invites the reading that the check provides the correctness.

### 3.4 State is re-read at delivery, not assumed from claim time

**Corrected and expanded.** An earlier draft handled rescheduling only. Claiming
and delivering are separated in time — by the queue, by backoff, by a worker
restart — and in that window the obligation can be completed, cancelled,
reassigned or moved. **Delivery re-reads the obligation and decides again.**

| Changed between claim and delivery  | Delivery does                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Completed**                       | drop. Telling somebody to do what they have just done is how people learn to ignore the bell.                              |
| **Cancelled / soft-deleted**        | drop.                                                                                                                      |
| **Rescheduled** (revision moved on) | drop this one; the next sweep claims the new revision. A stale reminder states a time that is no longer true.              |
| **Reassigned**                      | drop for the old recipient; the next sweep claims for the new one. Never re-target in place — the key names the recipient. |
| **Unchanged**                       | deliver.                                                                                                                   |

A dropped reminder is marked dropped **with its reason**, not deleted: "why was
I not reminded?" must be answerable. Already-**delivered** reminders are never
retracted — deleting them makes the audit lie.

The same rule applies at claim time, which is why the sweep's `SELECT` filters on
open, non-deleted obligations rather than trusting the armed job's payload.

### 3.5 Retry, and the limits of delivery

Retry belongs to delivery, never to the reminder.

- A failed attempt is retried with bounded backoff, each attempt recorded. The
  reminder row is untouched and is **not** re-created.
- Exhausting retries marks that _channel_ undelivered and leaves the in-app
  reminder standing.
- A worker crash mid-batch is safe: claimed reminders are found by the delivery
  sweep, unclaimed ones by the next claim sweep, and the unique index makes
  replaying a whole batch harmless.

#### What cannot be promised

> **This system provides exactly-once _claiming_ and at-least-once _delivery
> attempts_. It does not provide exactly-once delivery, and no document, test or
> UI copy may state that it does.**

The unique index makes the _decision_ to remind happen once. Everything past the
process boundary is outside that guarantee:

- **In-app** is the strongest channel: the row is written in the same database,
  so claim and delivery commit together. Treat it as the channel of record.
- **Email** — SMTP acknowledges receipt by the relay, not delivery to a person.
  A crash between the provider accepting and the attempt being recorded produces
  a retry the provider has already accepted, so **a duplicate email is possible
  and acceptable**; a lost one is not.
- **Push (APNs/FCM)** — best-effort by the vendors' own documentation. Tokens go
  stale silently; a delivered receipt is not a displayed notification.
- **WhatsApp / SMS** — carrier-dependent, with provider-side deduplication that
  varies by vendor and cannot be relied on.

The honest statement, and the one to put in front of users: _"we decide to
remind you exactly once, and we try hard to deliver it."_ Where a provider does
offer an idempotency key, pass it and record its id — that reduces duplicates on
that channel and still does not make delivery exactly-once.

### 3.6 What must not be built

- **No `remindedAt` column on the obligation.** It is a second source of truth
  for something the reminder table already answers, and it cannot represent more
  than one reminder per obligation — the constraint this document exists to
  remove.
- **No `dueAtRaised` in the uniqueness key.** §3.3: a timestamp is not a
  version, and A → B → A silently loses the third reminder.
- **No dedupe on notification title or body text.** Text is a rendering of the
  state, not a key for it.
- **No suppression window as the correctness mechanism.** A time window is a rate
  limit; it is reasonable to _also_ have, and it is not a uniqueness guarantee.
- **No claim of exactly-once delivery** (§3.5) anywhere: not in code comments,
  not in tests, not in UI copy.
- **No delivery that trusts the armed job's payload.** State is re-read at
  delivery (§3.4).

---

## 4. Consequences for the backlog

None of this is implemented here. It changes these backlog items:

| Item                                | Change                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-3** (task-model consolidation) | Must reconcile `Task` and `FollowUpTask` under §2.1 identity and carry `requestKey` and `sourceRef` across. The one-per-lead uniqueness previously specified is withdrawn.                                                               |
| **P1-4** (reminder reliability)     | Was scoped as "add `remindedAt`". Rescoped to §3.3: `scheduleRevision` on the obligation, a six-column unique index, an `ON CONFLICT` claim, and §3.4 re-read at delivery. §3.6 forbids the original approach and the `dueAtRaised` key. |
| **New — A**                         | Reconciliation report: for every open `FollowUpTask`, whether an equivalent open `Task` exists (§2.6 step 1). Read-only, no migration. Blocks the derivation below.                                                                      |
| **New — B**                         | Derive `Lead.nextFollowUpAt` from the **union** of both stores (§2.6 step 2), with the `Lead` row lock. Independently valuable, unblocks six surfaces reading a column nothing writes. Precedes P1-3.                                    |
| **New — C**                         | Split the six read sites into lead-wide and per-viewer (§2.6). The agent grid column and lead-detail flag become viewer-scoped queries; the leadership queue and overdue count stay lead-wide.                                           |
| **New — D**                         | Add `requestKey` (unique per tenant) and `sourceRef` to the obligation stores, and a conflict response for a replayed key with differing input (§2.2). Authorization runs before the idempotency lookup.                                 |

## 5. Open decisions

These need a business answer before implementation, and are recorded in
[`DECISIONS-REQUIRED.md`](DECISIONS-REQUIRED.md) as D-13 to D-17:

1. **Whose obligations set a lead's `nextFollowUpAt`?** §2.6 specifies
   owner-independent for the lead-wide column, with per-viewer computed
   separately. The alternative folds them into one number, which is what the
   earlier draft did.
2. **Does a completed obligation on a lead with nothing else open leave the lead
   absent from every follow-up surface?** Under §2.6, yes. If a lead should
   remain visible until somebody closes it out, that is a state on the lead, not
   a lingering timestamp.
3. **How long are delivered reminders retained?** They are the evidence for "we
   told them", which argues for the audit window rather than the notification
   one.
4. **How long is a `requestKey` honoured?** A replay a year later is almost
   certainly a new intention, not a retry. A bounded window (24h is the usual
   choice) needs an answer, along with what happens past it.
5. **Which channels count as "reminded"?** §3.5 treats in-app as the channel of
   record. If a workspace considers an email that was never opened to be
   insufficient notice, that is a policy with consequences for SLA measurement.
