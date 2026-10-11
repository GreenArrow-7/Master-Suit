# Team leads see their team's follow-ups and tasks

**What.** The Follow-ups list and `GET /api/v1/follow-ups` list everyone the
caller's `leads:VIEW` scope covers, and the Tasks list everyone their
`tasks:VIEW` scope covers, with a Mine switch for the caller's own. A new
`GET /api/v1/tasks` lists tasks the same way, a page at a time. Tasks is a
screen of Lead Eagle and Real Estate too, under Leads in their menus.

**Why.** M2 evidence pack, rows M2-05 1d and 1e (owner, 11 Oct):

- The Follow-ups page and its API filtered `ownerId = ctx.actor.id`, so Team
  Lead A saw "0 records in your scope" while team A had two open follow-ups.
  Nothing leaked; the team was simply invisible, under a line saying "in your
  scope".
- A Lead-Eagle-only workspace had no team task list: the Tasks page asserted
  `SALES`, its menu offered only "My Tasks" (the caller's own), and there was
  no tasks list API. Team A's task showed only on its lead's Tasks tab. A
  Real-Estate-only workspace had the same gap.

**Where** (under `apps/web/src/`)

- `lib/security/record-scope.ts`: `workListScope(ctx, module, mine)` — the
  caller's own, or `visibilityWhere(module, VIEW)`: TEAM, BRANCH and REGION
  the resolved owners, ORGANIZATION all, an ownerless row only there, as
  `assertOwnerInScope` reaches them by id. `ownerReach(ctx, module, action)`
  — whose rows a route reaches, for showing a row's buttons only where it
  takes them. `leadsInScope(ctx, ids)` — the related leads' names, only for
  leads the caller may open (the lead page's own rule).
- `components/workspace/WhoseWork.tsx`: `whoseWork(scope, view)` — Mine and
  Team, Branch, Region or Everyone (none at OWN), and the count line ("3
  follow-ups in your team", "of yours").
- `sales/follow-ups/page.tsx`: the scope, the switch, the Owner column when
  the view spans people (was platform actors only), and Complete and
  Reschedule only on rows the viewer's `leads:EDIT` reaches
  (`components/workspace/gridCells.tsx` reads `canAct`).
- `sales/tasks/page.tsx`: `LEAD_MODULES`, the switch and the count line; it
  already listed the `tasks:VIEW` scope. A row's Complete, Cancel and Reopen
  show only where `leads:EDIT` reaches its owner and Delete only where
  `tasks:DELETE` does, as `tasks/{id}` checks them. Each cell carries
  `data-label` and `data-priority`, with a Details fold, as `ConfigurableGrid`
  does, so a phone shows a labelled card.
- Both lists name a related lead only through `leadsInScope`.
- `api/v1/follow-ups/route.ts` (GET `?view=mine`), `api/v1/tasks/route.ts`
  (new GET: `limit`, `cursor`, `status`, `view=mine`; newest change first).
- `lead-eagle/tasks/page.tsx`, `realty/tasks/page.tsx`: re-exports;
  `lib/nav/realtyShared.ts` adds `tasks` to both shared-root lists;
  `lib/nav/workspaceNav.ts` adds Tasks after Follow-ups in both Leads areas.
- Links that count the caller's own follow-ups or tasks open Mine: the Sales
  overview (`sales/page.tsx`), the calendar, and the assistant's follow-up
  and overdue-task sources (`lib/nav/entityRoute.ts`).

**Behaviour.**

- Follow-ups (Sales, Real Estate, Lead Eagle): a team, branch or regional
  manager now opens on their team's, branch's or region's follow-ups with an
  Owner column; an ORGANIZATION-scope role (administrators, the Lead Eagle
  Manager and Viewer) on the workspace's. Mine is one click away and
  keeps the due filter; the due filters keep the view. Agents at OWN see no
  change except the line "N follow-ups of yours". `GET /api/v1/follow-ups`
  answers the same set by default; `?view=mine` gives the old answer.
- Complete and Reschedule show only where the PATCH would succeed: a role
  that reads further than it edits (the seeded Marketing Manager; the Lead
  Eagle Viewer, which edits nothing) sees the other rows without buttons.
- Tasks: the list already showed the `tasks:VIEW` scope in Sales; it now has
  Mine and a truthful count line, and opens in Lead Eagle and Real Estate
  workspaces (Leads → Tasks; `/sales/tasks` redirects there).
  `GET /api/v1/tasks` is new. The page's row buttons follow PATCH and DELETE:
  a role that reads further than it edits or deletes (a task desk with
  `tasks:VIEW` at ORGANIZATION and `leads:EDIT` at OWN) no longer gets
  buttons that answer "Task not found". On a phone each task is a card:
  the title, then Due, Priority, Status and the buttons, the rest under
  Details.
- A follow-up or task in scope whose lead has left the viewer's lead scope
  (a reassignment moves only open work, so completed rows stay behind) shows
  "—" for the lead, not its name; the lead's page answered 404 anyway.
- Nothing outside a caller's scope is listed; an ownerless task only at
  ORGANIZATION, as before.

**Verified.** On the rig's scratch database:

- `tests/permission/lead-record-scope.spec.ts`, 19 new cases on the
  hierarchy fixture. For a team manager (TEAM), an agent (OWN) and the
  director (ORGANIZATION): the follow-ups API and page, and the tasks API and
  page, list exactly the rows of the people in scope (team A only; their own;
  both teams and the ownerless task), with and without the overdue filter;
  Mine lists only their own on all four, filter included; the switch offers
  Mine and Team, Mine and Everyone, or nothing at OWN; Follow-ups shows the
  Owner column only on a view spanning people. Also: the tasks API pages two at a time
  through the same rows; a role reading every lead and editing its team's gets
  Complete and Reschedule only on the team's rows; the Sales overview, the
  calendar and the assistant's follow-up and overdue-task links open Mine;
  with the workspace switched to Lead Eagle alone, the team manager's Tasks
  page and the tasks API list the team's tasks. After review: a task's
  buttons only where PATCH and DELETE reach its owner (the task desk sees
  none on others' rows; a role deleting only its own tasks gets Delete only
  there); a team-A row on a team-B lead names the lead for the director,
  not the team manager; every task cell has its phone label and rank.
- Fail-before, with `apps/web/src` stashed back to main: 14 of the 16 fail
  ("teamManagerA’s: expected false to be true" on the follow-ups list,
  "Unrecognized key(s) in object: 'view'" on the follow-ups API, "handler is
  not a function" for the missing tasks API, "expected [] to deeply equal
  [ 'Mine', 'Team' ]", "expected undefined to be true" for `canAct`,
  "expected [ '/follow-ups?due=overdue', …(3) ] to include
  '/follow-ups?view=mine&due=overdue'", and "Sales is not enabled for this
  company." on the Lead-Eagle-only Tasks page). The two that pass on both are
  the agent's own list and its absent switch. The three review cases and the
  overdue-task link fail on the first commit's source
  (`C:/ymw/logs/fx-lists-before5.log`): "expected { …(3) } to be
  undefined" (the desk's buttons on a teammate's task), "expected 'repB1
  lead' to be undefined", "expected [ [ undefined, undefined ], …(7) ] to
  deeply equal [ [ 'Task', 'primary' ], …(7) ]", and
  "'/…/sales/tasks?tab=o…' to be '/…/sales/tasks?view=…'".
  `tests/unit/workspace-nav.spec.ts`
  (Lead Eagle's Leads tabs now include Tasks) fails there too: "expected
  [ Array(8) ] to deeply equal [ Array(9) ]".
- Also green after review: `tests/permission`, `sales`, `tenant`, `unit`,
  `ai` (160 files, 2,805 tests, 2 skipped); `tests/security`, `integration`,
  `identity`, `platform` (70 files, 798 of 799; the one failure,
  `self-serve-signup` answering 500 for 409 under load, touches nothing here
  and passed 8 of 8 alone); `tsc`; eslint (no errors) and prettier on the
  changed files. Browser, on the rig's dev server: `lead-eagle-workspace`
  (its new step: Leads → Tasks in a Lead-Eagle-only workspace lists the task,
  offers Mine and Everyone, `GET /api/v1/tasks` answers 200, and at 390px
  the row is a labelled card with the lead under Details) and
  `workspace-navigation` (9 passed); `follow-up-mobile`, `crm-lifecycle`,
  `admin-deletes`, `user-deactivate-hand-over`, `daily-target-workflow` (13
  passed; the last two specs' demo-login tests skip without demo
  credentials).

**Left open.**

- `GET /api/v1/follow-ups` still returns the first 100 by due date with no
  cursor and no sign it was cut short, as `GET /api/v1/events` does. Since
  it now answers the caller's scope, an ORGANIZATION API key gets the
  workspace's 100 earliest. Paging it changes its order and size, so it
  waits on the owner; the release notes should name the new default for
  API-key users.
- No index for the new lists' orderings: `GET /api/v1/tasks` pages by
  `updatedAt, id` but `Task` has no `(tenantId, updatedAt DESC, id DESC)`
  index as the other paged models do, and the follow-ups list at
  ORGANIZATION has no `(tenantId, status, dueAt)` on `FollowUpTask`. Both
  tables are small today; a migration is deferred.
- The assistant's `getTasks` names the related leads of in-scope tasks
  without the lead check the lists now apply (unchanged here).
- The workspace-level "My Tasks" (`/{slug}/tasks`) stays as it was, the
  caller's own, beside the new Tasks entry.
- Sales managers and administrators now open Follow-ups on their team or
  the workspace rather than their own queue (the old code kept the own
  queue on purpose); Mine is one click away. The owner decides whether that
  default stays for Sales.
