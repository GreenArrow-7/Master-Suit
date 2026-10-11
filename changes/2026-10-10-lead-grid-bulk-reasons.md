# The lead grid said only how many bulk moves failed, never why

**What.** The lead list's bulk bar now names each lead a bulk action refused
and repeats the server's own sentence, grouped when several leads share it;
the leads that worked are refreshed to their new state and only the refused
ones stay selected; a refused bulk Delete is shown at all.

**Why.** Lead Eagle phase 3 (2026-10-07) claimed the server's refusal sentence
is shown on the lead screen *and* the grid. The grid's `run()` kept only
`res.ok` per request and said `N of M could not be completed.` — the 422
"<Stage> needs: email.", the 403 role sentence and the 404 were all dropped.
It also returned before `router.refresh()` and left the whole selection in
place, so the leads that did move still showed the old stage and a retry
re-sent them (a second task under Add task). The error element sat inside the
action panel, which a bulk Delete never opens, so a refused delete showed
nothing. Found by the Lead Eagle gap audit (entry 2).

**Where.**

- `apps/web/src/lib/grid/bulkOutcomes.ts` — `summarizeBulk`: count, "the other
  N were", and one group per distinct `detail` naming the leads by reference
  and name from the rows the grid already shows.
- `apps/web/src/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid.tsx` —
  `run()` reads each refusal's problem+json `detail`, narrows the selection to
  the failures, refreshes, and renders the outcome as `role="alert"` outside
  the action panel. Every bulk action (Change stage, Add task, Close out,
  Delete) routes through it; Assign is one transactional request and keeps
  showing its own `detail`.
- `apps/web/tests/unit/bulk-outcomes.spec.ts`,
  `apps/web/tests/sales/bulk-stage-move.spec.ts`,
  `apps/web/tests/e2e/lead-bulk-stage.spec.ts`.

**Behaviour.** Moving three leads where one lacks the stage's required email
now reads "1 of 3 could not be completed; the other 2 were." followed by
"Viewing booked needs: email. — LD-12 (Sara Khan)". The two that moved show
the new stage; only LD-12 stays ticked. A lead the user cannot see still reads
"Lead not found." — only the server's `detail` is repeated, never `errors[]`
or any lead field from the response. Smart Views and the Lead Eagle and Real
Estate lists use the same component.

**Verified.** `tests/unit/bulk-outcomes.spec.ts` (4 cases) and
`tests/sales/bulk-stage-move.spec.ts` (2 cases: each PATCH is its own
transaction, a refusal rolls back only itself; 422 and 404 details — another
tenant's lead and an in-tenant lead outside the actor's edit scope — with no
lead fields in the body) pass on the rig. The unit spec fails on the old code
(no module); the sales spec pins the server contract the grid relays and
passes either way. `tests/e2e/lead-bulk-stage.spec.ts` (partial move: alert
text, grouped sentence with the refused lead's reference and not the moved
one's, selection narrowed, stages checked in the database) is written and
fails on the old grid (no `role="alert"`, the text has no sentence or
reference, both rows stay ticked); not run here. Its workspace is keyed on
`RUN_TAG` (a pinned tag reuses it) while each run's leads carry a `uniq()`
suffix, so a rerun neither hits `createLead`'s email duplicate rule nor leaves
two `Bulk A` rows for the row locator. Prettier and ESLint clean.

**Left open.** The grid relays whichever sentence the server sends and never
rephrases it; on this branch `updateLead` and `closeOutLead` go through
`assertLeadInScope` (a sibling entry in this batch), so an in-tenant lead
outside the actor's edit scope reads "Lead not found." like another tenant's.
Nothing else.
