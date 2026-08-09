# M11 — Engagement

The last module, and the one with the least new machinery under it.

## What was already here

| M11 asks for | Status |
|---|---|
| Offsite events with **RSVP** | Already built — `Event` + `EventInvitee`, which carries a `userId`, so an event can invite staff and they answer through the same signed link a client does |
| **Leaderboards** | Already built — M10's `rank()`, now exported |
| Internal social feed with posts and short video | **New** |
| Contests | **New** — a window, a metric, and a frozen result |
| Nominations and team voting | **New** |

A contest computes nothing of its own. It names a window, a metric and who is
in it, then asks the same ranking the leader dashboard uses. Two answers to "who
sold the most" would eventually disagree, and the one on the wall would be the
one nobody could reproduce.

## The feed

`Post` + `PostReaction`. Comments were **not** built — see *Not built* below.

- **A post is edited only by its author.** Moderators hide; they do not rewrite
  somebody's words.
- **Hiding is not deleting.** A row that vanishes is indistinguishable from a
  bug, so a hidden post keeps its content and records who hid it and why. The
  database refuses the halfway state:

  ```sql
  CHECK (
    ("hiddenAt" IS NULL AND "hiddenById" IS NULL AND "hiddenReason" IS NULL)
    OR ("hiddenAt" IS NOT NULL AND "hiddenById" IS NOT NULL AND length(btrim("hiddenReason")) > 0)
  )
  ```

- **The author still sees their own hidden post.** A post that disappears with
  no explanation is how somebody concludes the software ate it.
- **Pinning needs `posts:DELETE`.** Holding a post above everyone else's is a
  leadership act, not a formatting choice.
- **One reaction per person per post**, by unique index. Pressing the one you
  already chose takes it back.

Media is either an object in our bucket or a link, never both. This deliberately
does **not** reuse `assertMediaSource` from the inventory module: that rule says
video is *always* linked, which is right for a developer's marketing reel and
wrong for a clip filmed at the office. Sharing the function would have meant
loosening it for listings too.

## Contests

```
DRAFT ──▶ OPEN ──▶ CLOSED
   └────────┴──▶ CANCELLED
```

Standings are **live** while a contest runs and **frozen** when it closes. A
booking cancelled in March must not quietly change who won February — the same
reasoning as the frozen commission slab and the booking's frozen team.

Closing writes `ContestStanding` rows inside the same transaction that flips the
status, with a compare-and-swap so two people closing at once cannot produce two
results. The board endpoint returns the same shape either way; the caller cannot
tell whether it came from the ranker or from the frozen rows, which is the point.

## Nominations and voting

Nominations hang off an `Event` because that is where the award is given and
where the RSVP already lives. `category` is free text — every company's awards
are different and an enum would need a migration each time somebody invents
"Best Newcomer".

- Nobody nominates themselves, and nobody votes for their own nomination.
- The same person cannot be nominated twice in one category.
- **One vote per person per category**, enforced by a unique index on
  `(eventId, category, voterId)` rather than by a check somebody has to remember
  — two taps racing each other is exactly when a read-then-write loses.
- Changing your mind **moves** the vote. Otherwise the only way to switch is to
  vote twice, which the index refuses, leaving somebody stuck with a misclick.
- **A tie is reported as a tie.** `leaderId` is null and `closeCategory` refuses
  rather than declaring whoever sorted first the winner.

## A bug worth naming

`decideContest` originally called `rank()` inside `withTx`. `rank` reads through
the global client, and inside a transaction that client *skips* setting
`app.tenant_id` — it assumes the surrounding transaction already did, on a
connection these queries do not share. Row-level security then matched nothing
and a contest closed with an **empty frozen result**, silently.

This is the same trap documented on `withTx` and previously hit by
`destinationOf` in the visits module. The fix is to rank before opening the
transaction: the standings are a snapshot by definition, so taking it a moment
earlier costs nothing.

## Permissions

Two modules. `posts:VIEW` and `contests:VIEW` are derived from `tasks:VIEW`, and
`posts:CREATE`/`EDIT` from `tasks:CREATE` — the feed is for everyone with a
seat. `posts:DELETE` is moderation and is **not** derived: taking somebody's
words down is not the same as being on the team. `contests:CREATE`/`EDIT` are
likewise granted to nobody by default.

Voting needs only `contests:VIEW`, because voting is participation, not
administration.

## Checks

`tests/sales/engagement.spec.ts` (24): the empty post, the both-sources clip,
pinning refused to a member, pinned ordering, author-only editing, moderation
requiring a name and a reason, a hidden post staying visible to its author,
one-reaction-per-person and taking it back, reactions refused on a hidden post,
the contest state machine, a backwards window, live ranking, the frozen result
surviving a later cancellation, closing with nobody scored, team restriction,
self-nomination, duplicate nomination, a vote moving rather than doubling,
double-voting, self-voting, a tie reported as a tie, and declaring a winner.

```
npx vitest run tests/sales/engagement.spec.ts
```

## Not built

- **Comments.** Reactions make the feed social enough to ship; threaded
  discussion is a moderation surface of its own and nothing in the spec names
  it. Add it when people start using posts as threads.
- **Video upload.** The schema carries `videoKey` and `posterKey` and the
  storage helpers exist, but the composer only accepts a link. Wiring the
  upload means a presign route, a size cap and the antivirus scan the recordings
  pipeline already uses — worth doing properly rather than half.
- **Nomination windows.** Voting closes when the event does. There is no
  separate "voting opens Friday" schedule.
- **A Playwright happy path**, still missing here as in M10.
