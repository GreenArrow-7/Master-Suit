# LeadFlow CRM — Automation Engine

## 1. Model

An automation is a **directed acyclic graph** stored as JSON on an immutable
`AutomationVersion`. Editing a published automation creates a new version; records
already enrolled continue running the version they started on. This is what makes
"publish a fix at 3 pm" safe.

```
Automation ──< AutomationVersion (immutable graph + trigger spec)
                  └──< AutomationEnrollment (one per record)
                          └──< AutomationExecution (one per node attempt)
```

## 2. Graph format

```json
{
  "nodes": [
    { "id": "n1", "type": "trigger", "spec": { "event": "record.created", "object": "LEAD" } },
    {
      "id": "n2",
      "type": "condition",
      "spec": {
        "filter": {
          "op": "AND",
          "children": [
            { "field": "source", "cmp": "eq", "value": "PUBLIC_FORM" },
            { "field": "score", "cmp": "gte", "value": 50 }
          ]
        }
      },
      "branches": { "true": "n3", "false": "n7" }
    },
    { "id": "n3", "type": "action", "spec": { "action": "distribute", "ruleId": "dr_hot" }, "next": "n4" },
    {
      "id": "n4",
      "type": "action",
      "spec": { "action": "create_task", "taskTypeKey": "call", "title": "First contact", "dueInMinutes": 30 },
      "next": "n5"
    },
    { "id": "n5", "type": "wait", "spec": { "durationMinutes": 60 }, "next": "n6" },
    {
      "id": "n6",
      "type": "condition",
      "spec": { "filter": { "field": "firstContactedAt", "cmp": "is_null" } },
      "branches": { "true": "n8", "false": "n9" }
    },
    { "id": "n7", "type": "action", "spec": { "action": "add_tag", "tag": "nurture" }, "next": null },
    { "id": "n8", "type": "action", "spec": { "action": "notify_manager", "template": "sla_warning" }, "next": null },
    { "id": "n9", "type": "stop", "spec": {} }
  ],
  "entry": "n1"
}
```

Validation on publish: single entry, no cycles, every `next`/branch target exists,
no orphan nodes, every action's required parameters present, referenced templates
and rules exist and belong to the tenant.

## 3. Triggers

| Trigger                                                         | Fired by                                  |
| --------------------------------------------------------------- | ----------------------------------------- |
| `record.created` `record.updated` `field.changed`               | service-layer domain events, after commit |
| `stage.changed` `owner.changed`                                 | stage/assignment services                 |
| `activity.added` `task.created` `task.completed` `task.overdue` | activity/task services + SLA sweeper      |
| `opportunity.won` `opportunity.lost`                            | close service                             |
| `form.submitted`                                                | public form intake                        |
| `email.opened` `link.clicked`                                   | messaging provider callbacks              |
| `ticket.created` `sla.warning`                                  | service module + SLA sweeper              |
| `schedule.reached`                                              | maintenance queue, tenant-local cron      |
| `webhook.received`                                              | inbound webhook route                     |
| `manual.enrollment`                                             | user action on a grid selection           |

Domain events publish **after the transaction commits**, never inside it. An
automation must never observe a state that was rolled back.

## 4. Execution semantics

- **One enrollment per record per automation**, unless `allowReEnrollment` is set.
  Enforced by `@@unique([automationId, recordId, idempotencyKey])`.
- **Step-at-a-time.** Each node is one queue job. The worker loads the enrollment,
  executes exactly one node, persists `currentNodeId` plus an `AutomationExecution`
  row, and enqueues the next node. A crash loses at most one in-flight node.
- **Waits are not sleeps.** A wait node sets `status = WAITING` and `resumeAt`, and
  the record leaves the queue entirely. A delayed job re-enqueues it. A 30-day wait
  costs one row, not a held worker.
- **Actions are idempotent by key.** `jobId = sha256(enrollmentId:nodeId:attempt)`.
  Re-delivery cannot double-send an email or create a duplicate task.
- **Retries** follow the queue policy (5 attempts, exponential 2 s → 5 m). Terminal
  failure sets `status = FAILED`, writes the error to `AutomationExecution`, notifies
  the automation owner, and does **not** silently drop the record.
- **Exit conditions** are evaluated before every node. A record that no longer
  matches exits with `exitReason`, rather than continuing to receive messages.
- **Suppression** blocks enrolment for records on a suppression list, opted out of
  the relevant channel, or inside quiet hours (messaging actions defer to the next
  allowed window instead of failing).
- **Concurrency limit** per automation prevents one workflow from monopolising the
  queue.

## 5. Actions

| Group    | Actions                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------- |
| Record   | update field · change stage · assign owner · distribute · add/remove tag · increase/decrease score |
| Create   | task · activity · opportunity · ticket                                                             |
| Message  | send email · SMS · WhatsApp · in-app notification · notify manager                                 |
| List     | add to list · remove from list                                                                     |
| Flow     | wait duration · wait until date · stop · start another automation                                  |
| External | call webhook · invoke API                                                                          |

Every action executes through the **same service functions the UI calls**, with a
`Ctx` whose actor is the automation's owning user. An automation therefore cannot do
anything its owner could not do by hand — including crossing a tenant boundary. This
is asserted in `tests/permission/automation.spec.ts`.

## 6. Test mode and simulation

Test mode runs the full graph against real records with every side-effecting action
replaced by a recorder. The result is an execution log identical in shape to a live
run, marked `isTestMode`, so an author can diff a change before publishing.

Trigger simulation answers the other question — "which records would enter this
automation today?" — by compiling the trigger filter and returning a count plus a
100-row sample.

## 7. Observability

Per automation: enrollments started, completed, exited, failed; median time to
completion; per-node success rate and p95 duration; top failure codes. A node whose
failure rate crosses 5% over 100 executions raises an alert to the automation owner.
