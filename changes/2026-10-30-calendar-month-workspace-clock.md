# The calendar specs ask for a month on the workspace's clock

**What** — two permission specs read the calendar's month from the server's time
zone while the screen windows it by the workspace's. Both now use `todayKey` with
the workspace's zone, as the screen does. Tests only; no application code
changed. Found by CI on #239.

**Why** — the specs seed an event a day ahead and then ask the calendar for
"that month". At 21:27 UTC on 30 October the event lands at 2026-10-31T21:27Z,
which `getMonth()` reads as October but which is **1 November** in Asia/Dubai,
the default workspace zone. `CalendarPage` bounds October with
`dayBounds('2026-10-31', timeZone).to` — 31 October 19:59:59 UTC — so the event
was correctly outside the window and the calendar was correctly empty. The
screen was right; the tests were asking the wrong question. They fail for the
hours at each month's end where the two zones disagree, which is why CI was
green on 19 October and red on the 30th with nothing between them touching
events.

**Where**

- `tests/permission/event-invitee-scope.spec.ts` — `eventMonth` is
  `todayKey(await workspaceTimezone({ tenantId }), startAt).slice(0, 7)`.
- `tests/permission/lead-record-scope.spec.ts` — the local `month()` helper
  resolves the workspace zone once and formats through `todayKey`.

**Behaviour** — nothing a user sees. The calendar already grouped by the
workspace's clock; that is what the specs disagreed with.

**Verified** — reproduced on the failing date: before the change,
`event-invitee-scope` fails with `expected [] to deeply equal [ …(2) ]`, the
same assertion CI reported. After it, both specs pass — 354 tests — on that same
date, which is the one that breaks the old code. `npx tsc --noEmit`,
`prettier --check` and `eslint` clean.

**Left open** — the same pattern is worth a sweep: any spec that builds a date
key with `getMonth()` or `getFullYear()` and compares it against a screen reading
the workspace's clock has this bug waiting for the end of a month. These two were
the ones CI caught.
