# Handover guide — YOUHAN ONE / Master Suite

For the people who will use the system on day one, and the people supporting
them. Short on purpose.

---

## 1. Accounts

**Every person gets their own account.** The `demo@…` accounts created by the
seed are **not** for production use: they are shared credentials with broad
permissions, every action they take is attributed to "demo" in the audit trail,
and anyone who has ever seen the demo can sign in as one.

| Role | Who | What they can reach |
| --- | --- | --- |
| Sales Representative | Agents | Their own leads, their own tasks |
| Team Manager | Team leads | Their team's leads and tasks, reassignment |
| Branch / Regional Manager | Branch and region heads | Their branch or region |
| Sales Director | Head of sales | The whole workspace |
| HR Administrator | HR | Employee records, leave, payroll |
| Employee | Everyone with an HR record | Their own attendance, leave and payslips |

**First login for every account:** the administrator issues a temporary
password, and the person is taken straight to "set your own password" and cannot
go anywhere else until they have. That is intended — do not work around it by
sharing one account.

---

## 2. Agents — your day

**Your leads list is the start.** `Leads` in the sidebar.

The **Follow-up** column is now **your** next action on that lead — not the
team's, not your manager's. It reads one of three ways:

| It says | It means |
| --- | --- |
| A date in red | You are late |
| A date in grey | That is when you next owe something |
| **No action assigned to you** | You have nothing scheduled here. Somebody else may or may not — the system does not tell you, because that is their business. |

**The chips above the list:**

- **Overdue** — leads where *you* are late.
- **No next action** — live leads with nothing scheduled by you. **These are the
  ones that quietly go cold.** Work this list once a day.
- **Mine**, **Unassigned**, **SLA breached**, **High score** — as before.

**On a phone**, the follow-up state is now visible on the lead card. You no
longer have to open each lead to see what you owe.

**To schedule your next action:** open the lead → add a task or a follow-up with
a due date. The Follow-up column updates immediately — you do not have to set a
date on the lead separately, and there is no longer a field that lets you.

**Rescheduling** is changing the due date on the task or follow-up. **Completing**
it clears the column, unless you have something else open on that lead.

---

## 3. Managers — your day

Everything above, plus:

**Two Overdue chips, and they are different questions:**

- **Overdue · team** — anything late across the people you manage.
- **Overdue · mine** — only your own commitments.

Counts, filters, dates and the list all use the same definition, so the number
on your dashboard and the rows you get when you click it agree.

**The unassigned-lead queue** (`Sales → Allocation → Waiting`) lists leads the
system could not allocate, with the reason. Leads that were already unassigned
when the system went live show **"Unknown"** for how long they have been waiting
— that is deliberate. The system does not know, and inventing "3 minutes" for a
lead that has sat for eight months would be worse than saying nothing.

**Reassignment** is audited. A deactivated employee can no longer receive a new
lead — if allocation skips someone, that is why.

---

## 4. HR

Employee self-service, attendance, leave, overtime and payroll work as before.
Two things to know:

1. **Approved leave now blocks lead allocation.** An agent on approved leave will
   not be given new leads. **A half-day of leave currently blocks the whole
   day** — the system cannot yet tell which half. If that matters, tell support
   and record it as a business requirement; do not work around it by cancelling
   the leave.
2. **Leave reasons and medical details never reach Sales.** A sales manager
   seeing that an agent is unavailable sees only "unavailable", never why.

---

## 5. Known limitations to tell people about on day one

**Booking a unit changed.** Confirming a sale now takes the flat in the same
moment: the unit moves to **Booked** and nobody else can confirm against it.
Three consequences people will notice on day one:

- **A sale cannot be confirmed until it names the unit.** A draft can still be
  vague — that is what a draft is for — but confirmation asks which flat. This
  is the client's own rule; it is not the system being fussy.
- **"This unit is held by someone else"** on confirm means exactly that: another
  agent has a live hold. Ask them to release it. It is not a glitch, and
  confirming anyway is the double-sale this release exists to stop.
- **Cancelling a confirmed sale puts the flat back on the market**, and it can
  be sold again immediately. If the unit has since been moved by hand, the
  cancellation is refused and names the unit's actual state — escalate that
  rather than forcing it, because inventory and the ledger disagreeing is
  exactly what should be looked at by a person.

| Thing | What people will see | What to say |
| --- | --- | --- |
| Recording **how much** agency fee was collected | A "collected" tick with a date, and no amount anywhere | The tick means somebody pressed the button, **not** that a known sum arrived. Do not report off it. Recording amounts is a decided-and-scheduled change, not a bug to work around |
| The person who confirms a sale can also tick it collected | No second pair of eyes on collection | Agree locally who does it until the system enforces it |
| A saved view built on "next follow-up date" | An explicit notice, and an unfiltered list | Use the **Overdue** or **No next action** view, or rebuild the saved view |
| Sorting by Follow-up | Sorts the page you are on, not all results | Filter first, then sort |
| Reminders | Do not fire for follow-ups, only tasks, and only when `OPEN` | Do not rely on reminders yet |

---

## 6. Support and escalation

| Level | Who | For what |
| --- | --- | --- |
| 1 | Workspace administrator (client-side) | Passwords, permissions, "I cannot see a lead" |
| 2 | Production operator | Anything needing the server: a failed deployment, a stuck queue, a restore |
| 3 | Client owner | Any decision about scope, data or policy |

**Escalate immediately, do not wait for a pattern:** a lead assigned to two
people; a sign-in loop; an employee seeing another employee's HR record; a
number on a dashboard that disagrees with the list behind it.

---

## 7. First-day monitoring checklist

Run at **start of day, midday and end of day** on day one. Ten minutes each.

| # | Check | Where | Healthy looks like |
| --- | --- | --- | --- |
| 1 | Application answering | `GET /api/health` | `{"status":"ok","checks":{"database":"up","redis":"up"}}` |
| 2 | Running version | container `BUILD_COMMIT` | the release SHA, not `unknown` |
| 3 | Workers alive | worker container logs | `workers started`, 9 queues |
| 4 | Nothing stuck in the queues | BullMQ / logs | no growing backlog |
| 5 | **Notifications delivering** | `NotificationOutbox` | no row `PENDING` for more than 10 minutes; `ABANDONED` is 0 |
| 6 | **Follow-up drift** | worker log at 03:20, or `rc-preflight.mjs` | **0 after the backfill.** Non-zero means a write path is not recomputing — escalate, do not "fix" by re-running the backfill |
| 7 | Unassigned queue not growing | `Sales → Allocation → Waiting` | stable or falling |
| 8 | Errors | web container logs | no `"level":50` entries you cannot explain |
| 9 | Sign-ins working | ask two real users | no reports |
| 10 | Mail arriving | ask one person who was invited | received, and the link works |

Stop and consider rollback (runbook §9) if 1, 2, 3 or 9 fails, or if 5 shows
notifications piling up.

---

## 8. What "done" looks like at the end of day one

- Every client user has signed in with their own account and set their own
  password.
- At least one lead has gone capture → assign → follow-up → complete.
- At least one leave request has gone request → approve.
- The drift canary reports zero.
- No `ABANDONED` notifications.
- Nobody has needed the demo account.
