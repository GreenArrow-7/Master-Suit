# The Sales Agent's Today: a ranked day instead of a backlog count

## What

`My priorities` on the workspace landing page: at most seven of the viewer's
own records, each with the fact that put it there and one action, plus a
pre-call brief for the first. Branch `feat/agent-today-pilot`. Pilot — not
deployed, not extended to other roles.

## Why

The landing page said "12 overdue follow-ups" and linked to a list. That is a
number, not a decision, and deciding which of the twelve matters was the
morning this gives back.

## Where

- `src/services/today/priorities.ts` — the candidates and the ranking.
- `src/services/today/brief.ts` — the pre-call brief, from `leadCallContext`.
- `src/components/today/MyPriorities.tsx` — the rows. Writes nothing.
- `dashboard/page.tsx` — loads both inside the page's existing transaction.
- `globals.css` — `.lf-today__*`.

## Behaviour

Bands that do not overlap — SLA breach, overdue promise, promise due today,
never contacted, quiet warm lead — and within a band, whatever has waited
longest. **The order is arithmetic on recorded facts; no model chooses
anything**, and the reasons are written in code so the screen reads the same
with no AI configured. One row per lead, deduplicated before the cap.

Nothing here writes. Every action is a link to the screen that already does the
job, with its own permission check, its own confirmation and its own place in
the offline outbox.

## What walking it found, that review had not

1. **A follow-up of mine on someone else's lead named that lead.** Follow-ups
   were filtered by the *follow-up's* `ownerId` and the row rendered
   `lead.fullName` through the relation, so a representative whose `leads:VIEW`
   is OWN read a colleague's lead by name at number one, with a button beside
   it that answered 404. `agentToday` now takes `leadScope(ctx, 'VIEW')`.
   Regression test: `tests/permission/today-priorities-scope.spec.ts`.
2. **A terminal lead ranked first.** Its `Lead.status` was null, so close-out
   did not catch it; its `LeadStage.category` was `TERMINAL_JUNK`. That enum is
   the workspace's configured pipeline behaviour and `namedFilters.untouched`,
   allocation, recycling and scoring already gate on `OPEN`. This does too.
   Stage *names* still mean nothing.
3. **The action button rendered off the side of a 375px screen**, auto-placed
   into the 28px first column of a third row. Every cell is placed explicitly
   now, and the reason wraps to its own line rather than being hidden the way
   `lf-attn` hides its hint — here the reason is the content.

## Also fixed, on the same page

The overdue chip disagreed with the list it links to, in both directions:
`dueAt < new Date()` (over-counts: a 09:00 follow-up counted from 09:01, while
the list waits for the day to pass) and `status in (OPEN, IN_PROGRESS)`
(under-counts: `RESCHEDULED` is stamped on any open follow-up whose date moves).
Measured on the seed: chip 2, list 1. `overdueFollowUpsWhere` is now the single
predicate. `tests/unit/overdue-follow-ups.spec.ts`.

"Today" on that page was midnight in the *server's* zone, so a UTC container
serving an Asia/Dubai workspace started the day four hours late.

## Verified

Against an isolated seeded workspace (`manath-homes`, 500 leads), on the
**production bundle** — `npm run start:local`, which serves `.next-prod/standalone`
the way the Dockerfile does.

- Agent (`leads:VIEW` OWN): seven ranked rows, correct bands and order; opened
  the first; logged a connected call; the lead recorded it (timeline 2→3,
  tasks 1→2, score 6→9, last activity 25 Oct→16 Nov); Today then dropped that
  lead and promoted the next, brief following. Desktop and 375px.
- Team manager (`leads:VIEW` TEAM): team KPIs, and the rows are his own 12
  untouched open leads, top three by age — matching SQL exactly.
- An owned lead renders. A lead outside scope and a non-existent id are
  **indistinguishable**: the same 404, "The record may have been deleted, or it
  may be outside your access."
- 22 tests across three files; tsc clean; lint 0 errors.

## Left open

- **No offline test.** The actions are links to forms that already use the
  outbox; Pending-sync behaviour was not exercised this session.
- **Property matches are deliberately out of the brief.** `leadCallContext`
  assembles them for a model prompt and does not filter them to the stock this
  viewer may see. They need that filter first.
- **No phone number in the brief**, for the same reason: a number on screen has
  to go through field security and `dialable()`, which the lead page already does.
- **Manager, HR, Finance and Employee cards are not built.** A manager gets the
  agent-shaped list of their own work.
- **The follow-up list semantics are unchanged, on purpose.** Today hides a
  follow-up whose lead sits in a terminal stage; the Overdue chip and the
  Follow-ups list still count it. They answer different questions and both
  answers are right, so the card now says which is which: *"What to act on now.
  The queues below count every open follow-up, including those on leads nobody
  is working."*

  The example, measured on the seed for `joel.fernandes@example.com`:

  | | |
  | --- | --- |
  | Follow-up | "Send payment plan", due 11 Nov |
  | Lead | Ritika Dcruz |
  | Stage | Invalid — `TERMINAL_JUNK` |
  | `Lead.status` | null, so close-out does not catch it |
  | Overdue chip / Follow-ups list | counts it — **1** |
  | My priorities | hides it — no overdue row |

  Whether the shared list should also exclude terminal-stage leads is a product
  decision affecting five surfaces, and it is not this pilot's to take.
- Lead pages took around nine seconds to settle on this laptop build.
