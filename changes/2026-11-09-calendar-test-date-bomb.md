# The calendar suite books its site visit tomorrow, not on a date that has gone by

## What

`tests/integration/google-calendar-sync.spec.ts` booked a site visit at a fixed
`2026-11-07T08:00:00.000Z`. `POST /api/v1/site-visits` refuses a visit more than
a day in the past — "Log a past visit as an activity; the register is forward."
— so from the morning of 8 November the request answered **422** and `verify`
failed on every branch. The visit is now booked for 08:00 tomorrow, and the
90-minute span the test asserts is computed from that.

## Why

A date written into a test is a fuse: it burns down quietly and then fails
everything at once, with a message that points at the calendar integration
rather than at the clock. This one lit three weeks after it was written and
turned CI red on work that had nothing to do with it.

Only this date moved. Every other fixed date in the file goes through a route
with no forward-dated rule, and they keep each test's event distinct, which is
worth more than uniformity here.

## Where

- `apps/web/tests/integration/google-calendar-sync.spec.ts` — the site-visit
  test computes `startAt` and `endAt` from `Date.now()`, with a comment saying
  why this date is relative when the others are not.

## Behaviour

No change to the application. The assertion is the same: the event carries the
visit's address, its start, and an end 90 minutes later.

## Verified

`npx vitest run tests/integration/google-calendar-sync.spec.ts` — 15 passed,
where the suite had one failure before. `tsc --noEmit` and `prettier --check`
clean.

## Left open

The same class of fuse elsewhere in the suite has not been audited. A check that
fails a test file carrying a hard-coded date near today would catch the next
one, and does not exist.
