# The dashboards read in one transaction; the Audit Log keeps the workspace's clock; a lead's delete is one row on the lead; the Undo toast and Cold Data on a phone

**What.** Follow-up fixes from the evidence passes on the Lead Eagle M4/M5/M6
build. Branch `fix/fanout-audit-clock-ui`, from origin/main bab4f408 (#184).

- The screens that asked the connection pool for more connections than it
  holds read in one tenant transaction, or in rounds: the workspace dashboard,
  the Sales home, Sales → Dashboards, the leadership page (daily board, value
  and productivity tabs, through `dailyBoard`, `workspaceValue`, `funnel`,
  `conversion` and `productivity`), Admin → Integrations and its Meta page, and
  the assistant's My day.
- Admin → Audit log prints its times on the workspace's clock and names the zone.
- Deleting a lead stores and audits one instant, as one `RECORD_DELETED` row on
  the lead, beside its restore's and a Move to Data's.
- The Undo toast and the bulk bar have an edge in the dark theme; the toast
  sits clear of the assistant's button; Undo stands off its sentence.
- Cold Data at 390 px labels each value on a card, and marks the list it was
  opened on (`?list=`).

**Why.** PR #180 found the mechanism behind an intermittent P2028 ("Unable to
start a transaction in the given time"): outside `withTx` each tenant query is a
batched transaction on a pooled connection of its own (`runPinned`,
`src/lib/db.ts`), and the pool is node-postgres' default of 10, so a
`Promise.all` of N reads asks for N connections at once. #180 fixed the lead
page and listed the other fan-outs as left open. Measured with #180's method,
one render of each screen below asked for:

| Screen | Before | After |
| --- | --- | --- |
| Workspace dashboard, administrator with every panel | 31 | 1 |
| Workspace dashboard, TEAM-scoped viewer | 12 | 1 |
| Sales home (a manager's) | 7 | 1 |
| Sales → Dashboards | 9 | 1 |
| Leadership, daily board | 14 | 4 |
| Leadership, value | 18 | 4 |
| Leadership, productivity | 19 | 4 |
| Admin → Integrations | 10 | 4 |
| Admin → Integrations → Meta | 8 | 1 |
| Assistant, My day | 7 | 1 |

The other four were found by the same evidence passes: the Audit Log formatted
in UTC with no zone (the global rule is the workspace's clock); `deleteLead`
called `new Date()` twice, once for the row and once for its audit; a lead's
delete was audited by the route as `objectType` `leads` (and a second
`RECORD_UPDATED` row on `lead`) while its restore and Move to Data write
`lead` rows in the service; the toast, the bulk bar and Cold Data's cards as
described under Behaviour.

**Where** (under `apps/web/`)

- `src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx`: each panel is a
  function of the transaction's client, and one
  `withTx(tenantId, (tx) => Promise.all([...]))` runs them all, the scope reads
  (`leadScope`, `visibilityWhere`, `callScope`, `myEmployee`) through `tx` too.
  The team follow-ups' owner names (`names`, the replica) are read after it.
- `src/lib/security/record-scope.ts`: `callScope(ctx, action, db?)`.
- `src/app/(workspace)/[workspaceSlug]/sales/page.tsx` (ManagerHome),
  `sales/dashboards/page.tsx`, `src/lib/ai/assistant/tools.ts` (`getMyDay`):
  the reads in one `withTx`; the scopes before it.
- `src/services/targets/dailyBoard.ts`, `src/services/leadership/rollups.ts`
  (`funnel`, `conversion`, `productivity`, `workspaceValue`),
  `src/services/meta/config.ts`, `src/services/integrations/channelState.ts`:
  each function's parallel reads in one `withTx` (credentials and scopes read
  before it, on the global client, as before).
- `sales/leadership/page.tsx`: the panels in two rounds (funnel, conversion,
  board and people; then the chasing queue and the tab), not one.
- `admin/audit/page.tsx`: `workspaceTimezone(ctx)`, the zone in the description.
- `src/services/leads/updateLead.ts` (`deleteLead`), `src/app/api/v1/leads/[id]/route.ts`:
  one `deletedAt` instant, audited as `RECORD_DELETED` on `lead`
  (`fieldKey` `deletedAt`) in the delete's transaction; the DELETE route no
  longer declares `auditEvent`.
- `src/app/globals.css`, `src/styles/redesign-mobile.css`: `.lf-toast` border
  (`--lf-line-2`); `.lf-outbox` right gutter `--lf-fab-gutter` above the phone
  tier; an action in an outbox row is set apart, with room inside its focus
  ring; a hand-written `.lf-table` cell with no `data-label` has no empty label
  column on a phone; `.lf-table tbody tr[aria-current='true']` is a tint and a
  keyline, on desktop and as a phone card.
- `sales/cold-data/page.tsx`: `data-label` on every cell, the list and the name
  as each card's title (`data-priority="primary"`).
- Tests: `tests/sales/screen-connections.spec.ts` (new);
  `tests/sales/lead-bulk-actions.spec.ts`, `tests/sales/lead-audit-trail.spec.ts`,
  `tests/e2e/lead-bulk-actions.spec.ts` (+1, +1, +2);
  `tests/security/assistant-guardrails.spec.ts` (reads through `tx` count as
  reads), `tests/security/p2-regressions.spec.ts` (the dashboard's one round is
  now one transaction).

**Behaviour.** For customers on production:

- The same figures on every screen above, under the same scope and masking. A
  render now asks for at most 4 connections (most for 1), so two renders at
  once fit the pool. The dashboard's ~36 counts run one after another on one
  connection instead of side by side.
- Admin → Audit log reads "Times are in Asia/Dubai." (the workspace's zone) and
  prints every time on that clock: a row at 09:05 UTC reads 13:05 in Dubai.
- A lead's delete leaves one audit row: `RECORD_DELETED`, `objectType` `lead`,
  `deletedAt` from null to the instant stored. It left two (`RECORD_DELETED` on
  `leads` from the route, and `RECORD_UPDATED` `deletedAt` on `lead`). Restore
  (`RECORD_RESTORED`) and Move to Data (`lead.moved_to_data`) are unchanged, so
  the three read in one place by `objectType` and `recordId`.
- The Undo toast and the offline outbox notice end 80 px from the right above
  the phone tier, clear of the assistant's button (at 1440 px the toast
  covered it). Every toast and the bulk bar has a hairline edge
  (`--lf-line-2`): in the dark theme the midnight toast on the midnight canvas
  had none. Undo, Send now and Dismiss stand 8 px further from their sentence
  ("1 lead deleted.  Undo"), so the focus ring no longer touches the text.
- Cold Data on a phone: each list and each record is a card titled by its name,
  with each value under its label (Contacts, Still to work, Interested,
  Converted, Assign to; Phone, Company, List, Agent, Outcome). The list it was
  opened on (`?list=`, as Move to Data's link does) is tinted with a blue
  keyline, on a phone and on a desktop.
- Every other table written by hand (the 11 screens Left open lists) loses its
  empty left column on a phone; its values still have no labels.

**Decisions taken**

- None by the owner: the brief marks no DECISION for these follow-ups.
- Design choices, not the owner's:
  - One transaction per screen where every read can go through `tx` (the
    dashboard's scope reads included, `visibilityWhere` takes a `db`). Where a
    screen's helpers read on the global client or the replica (the
    leadership page's `performerBoard` → `names`, `chasingQueue` →
    `scopedNextFollowUp`), each helper groups its own reads and the page reads
    in two rounds: inside a `withTx` those helpers would read with no tenant
    set (#184).
  - The bound is half the pool for one render (the coordinator's), asserted by
    the test; the pool's size is untouched.
  - The delete's audit moved into the service (in its transaction, like the
    restore's) rather than the restore and Move to Data gaining route rows:
    the route row cannot name the field or the instant, and no route-level
    row is written for every route.
  - The Audit Log names its zone in the page description rather than in each
    cell.
  - The toast's edge is the theme's strong line token on every toast: in the
    light theme it is the canvas's colour and does not show.

**Verified.** On the rig (master_suite_pt), after merging origin/main (#180, #181, #183,
#184, #185): migrations applied; `tsc` clean; eslint (0 errors) and prettier
on the changed files. `screen-connections`, `lead-bulk-actions`,
`lead-audit-trail`, `assistant-guardrails`, `p2-regressions`: 81 passed. On
the base's code the leadership tabs peaked at 20, 10 and 19 of a pool of 10
(the test fails there). `tests/sales` and `tests/permission`: 1777 passed,
23 skipped; `cold-data`, `lead-calendar` and `screen-connections` failed in
the full run under load (fixture timeouts) and passed alone (17, 8, 6). E2E
`tests/e2e/lead-bulk-actions.spec.ts` alone: 10 passed.

**Left open**

- The pool is 10 (`connection_limit` in `DATABASE_URL` does nothing under the
  pg adapter); sizing `max` on `PrismaPg` is the owner's operations decision.
- The workspace dashboard's "today" (its attendance, sign-in and call counts),
  the Sales home's date line and My day's "today" use the server's midnight,
  not the workspace's (the global rule); unchanged here, since it changes
  figures.
- Reading the dashboard's counts one after another adds their times; a slow
  database could bring the transaction near Prisma's 5 s interactive timeout.
  Not seen on the rig; splitting the panels into two transactions is the
  next step if it is.
- A lead's PATCH still writes a route row on `leads` beside the service's
  field rows on `lead`.
- Hand-written tables still without labels on a phone: monitoring,
  platform workspaces (and the new-workspace form), realty properties,
  collections (three files), the lead import preview, portals, proposals.
- Not measured: other screens with five or fewer parallel reads (the Sales
  home of a seller reads five).
