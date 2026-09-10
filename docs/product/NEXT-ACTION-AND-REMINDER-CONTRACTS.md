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

### 2.2 Idempotency: a separate identity, for a different question

Identity answers _"which obligation is this?"_. Idempotency answers _"have I
already acted on this request?"_. These are different questions and need
different keys.

> **Every obligation carries a nullable `sourceKey`, unique per tenant when
> present. A create that supplies a `sourceKey` already recorded returns the
> existing obligation unchanged; it does not create, and it does not error.**

```
@@unique([tenantId, sourceKey])
```

The `sourceKey` is minted by whatever _caused_ the obligation, and it must be
derived from the cause rather than from the moment of writing:

| Cause                              | `sourceKey` shape                       | Why                                                               |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Automation rule firing on an event | `rule:<ruleId>:<eventId>`               | The same event redelivered must not produce a second task         |
| Webhook / portal lead intake       | `intake:<provider>:<providerMessageId>` | Providers retry; the retry is the same instruction                |
| Recurrence expansion               | `recur:<parentTaskId>:<occurrenceISO>`  | A sweep that runs twice must expand each occurrence once          |
| SLA escalation                     | `sla:<leadId>:<breachAtISO>`            | One breach, one escalation, however many times the worker retries |
| A person clicking _Add follow-up_  | **`null`**                              | See below                                                         |

**A human action never carries a `sourceKey`.** If an agent adds a callback
twice, they meant two callbacks — or they made a mistake that is theirs to
correct, visibly, in a UI that shows both. Silently collapsing a person's second
click into their first is the failure mode where somebody believes they have
scheduled something and has not. Machine-originated requests dedupe; human
requests do not.

**Retry vs deliberate-new.** The whole distinction is carried by whether the
caller supplies a `sourceKey` and whether it is the same one:

- _Retry of the same request_ — same `sourceKey` → returns the existing row.
  Safe to call any number of times; the job may crash and re-run freely.
- _A genuinely new instruction from the same source_ — the source mints a new
  `sourceKey` (new event id, next occurrence, later breach time) → a new
  obligation. The source is the only party that knows the difference, so the
  source is where the decision belongs.
- _A human adding another_ — no `sourceKey` → always a new obligation.

An endpoint must never infer "this looks like a retry" from field similarity.
Similarity is not evidence.

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

### 2.6 `Lead.nextFollowUpAt` is derived — with multiple open obligations

> **`Lead.nextFollowUpAt` = the earliest `dueAt` among all `OPEN`, non-deleted
> obligations linked to that lead, across every owner and every kind; `NULL`
> when there are none.**

This is the definition that makes multiple open obligations work. It does not
require, imply, or benefit from a one-per-lead rule — the minimum of a set of
any size is still one value.

Explicitly:

- **Owner-independent.** A lead with a rep's callback due Thursday and a
  manager's review due Tuesday has `nextFollowUpAt = Tuesday`. The column is
  about the _lead_, not about any one person's queue. Per-person queues are the
  task list, which filters by owner; they are a different question with a
  different answer.
- **Kind-independent.** The earliest thing owed is the earliest thing owed.
- Completing the Tuesday obligation moves the column to Thursday, not to `NULL`.
- Completing the last one sets `NULL`, and the lead leaves every Overdue
  surface.
- Rescheduling the earliest one past the second recomputes to the second.

**It is a cache, and it must be treated as one.** Two obligations opening
concurrently against one lead can interleave a naive read-min-then-write and
leave the column holding the later of the two. Recompute must therefore be a
single statement that derives the value in the database rather than in
application memory:

```sql
UPDATE "Lead" l
   SET "nextFollowUpAt" = (
         SELECT MIN(t."dueAt") FROM "Task" t
          WHERE t."leadId" = l.id AND t."tenantId" = l."tenantId"
            AND t.status = 'OPEN' AND t."deletedAt" IS NULL)
 WHERE l.id = $1 AND l."tenantId" = $2
```

run inside the same transaction as the obligation write, after it. It reads
whatever the transaction can see, so it cannot compute a minimum that excludes
the row being written; and because it never reads a value into application code,
there is no read-modify-write window to lose.

Because it is a cache, a periodic reconciliation sweep must be able to rebuild
the column for every lead in a tenant and report rows that disagreed. A cache
with no way to detect drift is indistinguishable from corruption.

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

### 3.3 Atomic claiming

> **The database enforces reminder uniqueness with a unique index, and the sweep
> claims by inserting against it.**

```
@@unique([tenantId, obligationId, kind, dueAtRaised])
```

- `obligationId` — the obligation's own id, **not** the lead's. This is what
  fixes §3.2 (4): two obligations on one lead are two reminders.
- `dueAtRaised` — the `dueAt` the reminder was raised for. This is what makes
  rescheduling work (§3.4): a moved obligation has a different `dueAtRaised`
  and is therefore a different reminder, while a _re-run over the same schedule_
  is the same one.

The sweep then does one statement per batch:

```sql
INSERT INTO "Reminder" (...)
SELECT ... FROM "Task" t WHERE <due window> AND <open>
    ON CONFLICT ("tenantId", "obligationId", kind, "dueAtRaised") DO NOTHING
RETURNING id, ...
```

Properties this buys, none of which the existence check has:

- Concurrent sweeps are safe: the second one's conflicting rows are dropped by
  the index, not by a race it happened to win.
- The claim _is_ the write. There is no window between deciding and doing.
- `RETURNING` yields exactly the rows this sweep actually claimed, so delivery
  is enqueued for those and only those. A crash after the insert and before
  enqueue is recovered by a delivery-side sweep over undelivered reminders, not
  by re-running the claim.
- The 24-hour suppression window disappears, along with its side effect of
  suppressing legitimately re-raised reminders.

The `ON CONFLICT DO NOTHING` is not belt-and-braces around the existence check —
it _replaces_ it. Keeping both invites the reading that the check is what
provides correctness.

### 3.4 Rescheduling invalidates

When an obligation's `dueAt` moves (§2.3):

- Any reminder for the **old** `dueAtRaised` that has not yet been delivered is
  cancelled. It describes a time that is no longer true, and delivering it tells
  the rep something false.
- Any reminder for the old time that **has** been delivered stays. It is a
  record of something that genuinely happened; deleting it makes the audit lie.
  The rep will simply be reminded again at the new time, which is correct
  behaviour and not a duplicate — different `dueAtRaised`, different reminder.
- The new time is reminded on the next sweep. Nothing needs to run at
  reschedule time except the cancellation.

When an obligation is completed or cancelled, every undelivered reminder for it
is cancelled by the same rule.

### 3.5 Retry

Retry belongs to delivery, never to the reminder.

- A failed delivery attempt is retried with backoff, bounded, recording each
  attempt. The reminder row is untouched and is _not_ re-created.
- Exhausting retries marks the reminder undelivered-on-that-channel and leaves
  it visible in-app. In-app is the channel with no provider between the system
  and the person, so it is the one that must not depend on a retry succeeding.
- A worker crash mid-batch is safe: reminders already claimed are found by the
  delivery sweep; reminders not yet claimed are claimed by the next sweep. The
  unique index makes replaying the whole batch harmless.

### 3.6 What must not be built

- **No `remindedAt` column on the obligation.** It is a second source of truth
  for something the reminder table already answers, and it cannot represent more
  than one reminder per obligation — which is exactly the constraint this
  document exists to remove.
- **No dedupe on notification title or body text.** Text is a rendering of the
  state, not a key for it.
- **No suppression window as the correctness mechanism.** A time window is a
  rate limit; it is a reasonable thing to _also_ have, and it is not a
  uniqueness guarantee.

---

## 4. Consequences for the backlog

None of this is implemented here. It changes three backlog items:

| Item                                | Change                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-3** (task-model consolidation) | Must reconcile `Task` and `FollowUpTask` under §2.1 identity and preserve `sourceKey` on migration. The one-per-lead uniqueness previously specified is withdrawn.                                    |
| **P1-4** (reminder reliability)     | Was scoped as "add `remindedAt`". Rescoped to §3.3: a unique index and an `ON CONFLICT` claim. §3.6 forbids the original approach.                                                                    |
| **New**                             | Derive `Lead.nextFollowUpAt` (§2.6). Independently valuable, small, and unblocks six existing surfaces that are currently reading a column nothing writes. Should precede P1-3 rather than follow it. |

## 5. Open decisions

These need a business answer before implementation, and are added to
[`DECISIONS-REQUIRED.md`](DECISIONS-REQUIRED.md):

1. **Whose obligations set a lead's `nextFollowUpAt`?** §2.6 specifies
   owner-independent (earliest across everyone). The alternative — earliest
   among the lead owner's own obligations — makes the Overdue queue mean "the
   owner is behind" rather than "this lead is waiting on us". Both are
   defensible; they are different reports.
2. **Does a completed obligation on a lead with nothing else open leave the lead
   absent from every follow-up surface?** Under §2.6, yes. If a lead should
   remain visible until someone explicitly closes it out, that needs a separate
   state on the lead, not a lingering `nextFollowUpAt`.
3. **How long are delivered reminders retained?** They are the evidence for "we
   told them", which argues for the audit retention period rather than the
   notification one.
