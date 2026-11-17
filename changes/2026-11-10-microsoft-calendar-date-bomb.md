# The second calendar date bomb, and the check that stops a third

## What

`tests/integration/microsoft-calendar-sync.spec.ts` booked a site visit at a
fixed `2026-11-09T08:00:00.000Z`. `POST /api/v1/site-visits` refuses a visit
more than a day in the past — "Log a past visit as an activity; the register is
forward." — so from 11 November the request answered **422** and `verify` failed
on every branch. The visit is now booked relative to the clock.

`tests/unit/no-dated-site-visit.spec.ts` fails on any `scheduledAt` literal in
any spec.

## Why

This is the same fuse that burned in `google-calendar-sync.spec.ts` on
8 November. That change's own "Left open" said: "The same class of fuse
elsewhere in the suite has not been audited. A check that fails a test file
carrying a hard-coded date near today would catch the next one, and does not
exist."

Three days later it caught nothing, because it did not exist. So it exists now.
Writing down that an audit is outstanding is not the same as doing it.

The check matches on `scheduledAt`, which belongs to the site-visit route alone,
rather than on lines near the route call. The `dueAt` literals of the follow-ups
and tasks a few lines away go through routes with no forward-dated rule, and
their fixed dates keep each event distinct on purpose.

## Where

- `apps/web/tests/integration/microsoft-calendar-sync.spec.ts` — the site-visit
  date and the end-time assertion computed from it.
- `apps/web/tests/unit/no-dated-site-visit.spec.ts` — new.

## Behaviour

No change to the application.

## Verified

- `npx vitest run tests/integration/microsoft-calendar-sync.spec.ts` —
  **11 passed**, where CI had one failure at `2a1a6311`.
- The guard passes, and **fails on the old literal** — confirmed by restoring
  the spec from `HEAD` and re-running, which reported line 302 as the offender.

## Left open

Only the site-visit route is guarded. Any other route that grows a
forward-dated rule will need its field adding to the check.
