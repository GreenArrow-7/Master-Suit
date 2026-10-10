# A task or follow-up could be changed by id anywhere in the workspace

**What.** `PATCH` and `DELETE /api/v1/tasks/{id}` and `PATCH /api/v1/follow-ups/{id}`
check the record now, not only the permission (#146, after #140).

**Why.** The task routes loaded the task by id and checked nothing about it:
anyone holding `leads:EDIT`, an agent at OWN scope included, could retitle,
reschedule, complete or take any task in the workspace (`ownerId` set to
themselves passed the reassign check), and anyone holding `tasks:DELETE`
could delete it. The follow-up PATCH compared the caller's scope with TEAM
and nothing more, the mistake #136 fixed for activities, so a team manager
could change any follow-up in the workspace. #140 found both in passing; the
owner asked for the fix on 8 Oct.

**Where.**

- `lib/security/record-scope.ts`: `assertOwnerInScope` — yours, or owned by
  someone your scope covers; an ownerless record only at ORGANIZATION scope;
  404 like a missing id.
- `api/v1/tasks/[id]/route.ts`: PATCH and DELETE call it on the task's owner.
- `api/v1/follow-ups/[id]/route.ts`: PATCH calls it instead of comparing the
  scope with TEAM.

**Behaviour.** A task is changed by its owner, or by someone whose `tasks`
scope covers the owner: the rule the task lists apply, since a Task is read
under `tasks` (`services/leads/nextFollowUp.ts`). PATCH checks the `tasks:VIEW`
scope on top of its `leads:EDIT` gate, because seeded managers hold
`tasks:VIEW` and `ASSIGN` but not `tasks:EDIT`, and the Tasks page offers
Complete on every row it lists. DELETE checks the `tasks:DELETE` scope. A task
with no owner is listed only at ORGANIZATION scope, so only that reaches it. A
role with `leads:EDIT` and no `tasks` grant, the seeded Marketing Manager, now
changes only its own tasks. Follow-ups: below TEAM your own only, as before;
from TEAM up, also those owned by someone in your `leads` scope. Out of scope
answers 404, the same as a missing id. Moving either to another lead is still
#140's check.

**Verified.** `tests/permission/task-follow-up-scope.spec.ts`, 6 tests on the
hierarchy fixture, with `tasks:VIEW` and `tasks:DELETE` at the reps' and the
team manager's scope:

- An OWN-scope rep cannot change, complete, take or delete a teammate's task
  (404 with a missing id's detail; the row untouched), and still changes and
  deletes their own.
- A team manager reaches their team's tasks and follow-ups, not another team's.
- A task with no owner is taken by neither a rep nor a team manager; at
  organisation scope it is.

On the old routes 4 of the 6 fail ("expected 200 to be 404"); the two
own-record cases pass on both. Also green: all of `tests/permission`
(`lead-attach-scope` and `activity-scope` among them), `sales/next-follow-up`
and the specs that walk the route tree, 24 files and 436 tests; the browser
spec `e2e/admin-deletes` (the administrator deletes a task) against a dev
server; `tsc`, eslint and prettier.

**Left open.**

- The lead page lists every open task on the lead whatever the viewer's
  `tasks` scope, with Complete on each: the disclosure
  `services/leads/nextFollowUp.ts` warns about, and Complete on a task outside
  the viewer's scope now gets the 404.
- From TEAM up, a new task, or a task or follow-up handed over by PATCH, may go
  to any active user in the workspace, not only someone in the caller's scope.
