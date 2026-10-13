# Site visits show their time on the workspace's clock

**What.** The Site visits register and a visit's own page print the scheduled,
check-in, check-out and amended times in the workspace's time zone. Branch
`fix/site-visits-workspace-clock`.

**Why.** The owner's evidence check of row M4-18 found a visit booked as 16:30
in an Asia/Dubai workspace (stored correctly as 12:30 UTC) listed as 18:00.
The pages formatted on the server with no time zone, so they showed the
server's clock: 18:00 on an India-zoned machine, 12:30 on a UTC server.

**Where** (under `apps/web/src/app/(workspace)/[workspaceSlug]/sales/site-visits/`)

- `page.tsx`: reads `workspaceTimezone(ctx)` and passes it to the scheduled and
  check-in times.
- `[id]/page.tsx`: the same for scheduled, check-in, check-out and amended.

`/lead-eagle/site-visits` and `/realty/site-visits` re-use these pages.

**Behaviour.** A visit typed as 16:30 reads 16:30 in the list and on its page,
whatever zone the server runs in.

**Verified.** `tests/sales/stage-mini-form.spec.ts` (+1, "the Site visits
register"): books a visit at 16:30 Dubai through the stage dialog's API and
reads it back from both pages. On main it fails with
_expected [ '23 Oct 2026, 18:00' ] to include '23 Oct 2026, 16:30'_; on the
branch the spec passes 17/17.

**Left open.** Lead-page times (timeline, tasks) still use the browser's zone;
round 3's timeline change (`changes/2026-10-13-lead-call-log-timeline.md`)
covers the timeline.
