# A lead's Tasks tab listed tasks the viewer may not see

**What.** A lead's Tasks tab lists only the open tasks the viewer's `tasks`
scope covers, and no deleted ones (#149, after #146). Sales, Real Estate and
Lead Eagle share the page.

**Why.** The page loaded every open task on the lead and applied no `tasks`
scope, so anyone who could open the lead saw each one's title, type and due
date: tasks owned outside their scope, and on a role with no `tasks` grant
(the seeded Marketing Manager) every task. `services/leads/nextFollowUp.ts`
explains why an obligation may only reach someone who could open it directly;
the page applied that to its follow-up date, not to the list. Since #146,
Complete on a task outside the caller's scope answers 404, so the usual case,
a reassigned lead whose previous owner's open tasks stay on it, showed the new
owner buttons that fail. The include also had no `deletedAt` filter, so a
deleted task stayed listed with a Complete that answers 404. #146 found the
first; the brief of 10 Oct proposed the rule, and showing others' tasks
read-only would be the exception `nextFollowUp.ts` rules out.

**Where.**

- `app/(workspace)/[workspaceSlug]/sales/leads/[id]/page.tsx`: the tasks
  include takes `visibilityWhere(tasks, VIEW)`, matches nothing when that
  scope is NONE, and leaves out deleted tasks.
- `tests/permission/lead-task-scope.spec.ts`: renders the page as each viewer.

**Behaviour.** The tab lists what the viewer's Tasks page would: their own
tasks and those of owners their scope covers; a task with no owner only at
ORGANIZATION scope; nothing for a role with no `tasks` grant, not even its own,
as the follow-up date already did. Every listed task passes the PATCH's scope
check. The tab count and "Open tasks" count the same list. After a
reassignment the new owner sees the previous owner's open tasks only if their
scope covers that person; the previous owner keeps them on their Tasks page.

**Verified.** `tests/permission/lead-task-scope.spec.ts`, 4 tests on the
hierarchy fixture:

- An OWN-scope agent sees their own task on a lead, not the previous owner's
  or an ownerless one, and completes it (200).
- A team manager sees their team's task, not another team's or an ownerless
  one; the director sees all three.
- A role with `leads:VIEW` and no `tasks` grant sees none, its own included.
- A deleted task is not listed.

On the old page the first three fail, each listing the hidden tasks; the
fourth fails until its own commit. Also green: all of `tests/permission`,
`sales/next-follow-up`, the realty, Lead Eagle and entity route specs and
`monitoring-conversation-scope`, 25 files and 752 tests; `tsc`, eslint and
prettier. In a browser on the demo seed, the admin reassigned a lead with
three open tasks from the field rep to the sales rep; the tasks stayed with
the field rep. The sales rep's tab showed none of them, with no count and
"Open tasks 0", at desktop and phone width and on the Real Estate route; a
task he added showed with count 1, and Complete answered 200. The admin and
the Reporting Analyst still saw all three.

**Left open.**

- Should reassigning a lead carry its open tasks to the new owner? Nothing
  moves them, so the previous owner keeps tasks on a lead they may no longer
  open, and the new owner does not see them. The owner's decision.
- Complete and New task show to roles that cannot use them. Without
  `leads:EDIT` (the seeded Reporting Analyst, Customer Service and Read-Only
  roles), Complete answers 403 "Your role does not allow edit on leads.", as
  before #146. A role with `leads:EDIT` and no `tasks` grant can add a task
  it then cannot see.
- The assistant's `getLeadTimeline` and `prepareForCall`
  (`lib/ai/assistant/tools.ts`) still list every task, follow-up and call on a
  lead to anyone holding `leads:VIEW`.
- The Timeline tab lists deleted activities: its include has no `deletedAt`
  filter either. A throwaway probe confirmed it.
