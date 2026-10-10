# One date field everywhere: type it or pick it

**What.** Every date and date-time field in the app (95 of them) now uses one
shared field, `components/forms/DateInput.tsx`. People type DD/MM/YYYY (or 8
digits, or YYYY-MM-DD), or press the calendar button beside it, which opens the
browser's own picker. Impossible dates (31/04, 29/02/2027) and implausible years
(0026) are refused with a reason, and the form does not submit. Native controls
now follow the theme (`color-scheme`), so the calendar and clock icons are
visible on the dark themes. Plus the input-side bugs a catalogue of the fields
found (below).

**Why.** The owner (10 Oct): date setting did not work properly in any module,
and people typed dates by hand. Three causes, proven in a browser:
- No CSS set `color-scheme`, so on Dark Classic, Glassy and the dark console the
  native calendar icon was drawn dark on dark — invisible.
- A date field given a full timestamp shows blank, so some edit forms opened
  empty and saved nothing or wiped the date.
- The native field's order follows the browser's language (MM/DD/YYYY on an
  English-US browser) and phones allow no typing at all.

**Where** (under `apps/web/src/`)
- `components/forms/DateInput.tsx` — `DateInput` and `DateTimeInput`. The form
  receives exactly what the native inputs sent (YYYY-MM-DD; "YYYY-MM-DDTHH:mm")
  in a hidden input, so no API changed. They follow `form.reset()`.
- `lib/dates.ts` — parsing, formatting and the reasons; `tests/unit/dates.spec.ts`.
- `styles/tokens.css` — `color-scheme` per theme; `app/globals.css` — `.lf-date`.
- The three shared form builders (`WorkspaceRecordForm`, `RowActions`,
  `PlatformRowActions`) and 26 screens across HR, Sales, Real Estate and the
  platform console.

**Behaviour, beyond the field itself**
- An end date cannot be before its start: leave, targets, campaigns, events,
  workspace trials, AI allowance windows, notice periods.
- "Today" defaults use the local date, not UTC (they showed yesterday between
  00:00 and 04:00 Dubai): new user, notice given, AI price, target week (which is
  now Monday–Sunday, not today+6).
- No more silent failures: tasks and follow-ups say what is missing; the
  targets form no longer says "Could not reach the server" for a bad date; an
  opportunity's close date is no longer wiped by a half-typed edit; an AI
  allowance window is prefilled instead of erased on the next save; the
  console's subscription dates and inline row edits stop on a bad date instead
  of dropping it.

**Verified.** Unit: the parser, 6 cases. Browser (`tests/e2e/date-input.spec.ts`,
3): a typed date and a calendar pick submit YYYY-MM-DD and come back as
DD/MM/YYYY; 31/04/2026 is refused with its reason and the form does not submit;
on the dark theme the page's `color-scheme` is dark and the field fits a 390px
phone. Typecheck, lint, format; the full unit/integration and E2E suites — see
the PR. Screens checked by eye in light and dark at 1280 and 390 px.

**Left open**
- Date-times are still stored 4 hours late where a form sends the time without
  its zone (site visits, events, attendance corrections, interviews, follow-ups
  from the call page): the server reads it as UTC. Fixing that changes how
  existing records display; it waits on the owner's decision about the records
  already saved.
- Server-side day boundaries are still UTC in places: a trial or offer ends at
  04:00 Dubai on its last day, "Today"/"This month" filters and reports cut days
  at 04:00, campaigns start at 04:00. A follow-up change will use the
  workspace's time zone (`workspaceTimezone`, `dayBounds`, `todayKey` exist).
- Changing "Trial ends" on the console's Subscriptions page still does not move
  module access.
