# Lead Eagle, phase 4: assignment that explains itself and keeps hours; two reports

**What.** Gaps 6 and 7 of the [plan](2026-10-05-lead-eagle-plan.md), PR #133,
stacked on phase 5 (#132). For every lead module.

**Why.** The approved plan. `DistributionRule.respectWorkingHours` was on every
rule and honoured by nothing — "no working-hours schedule exists to consult;
ignored" — and an automatic assignment recorded the rule but not why that
person.

**Where** (under `apps/web/`)
- `src/services/distribution/eligibility.ts` — `respectWorkingHours` in the policy; the `OFF_SHIFT` blocker from the roster and the attendance record.
- `src/services/distribution/assignLead.ts` — the sentence on each automatic assignment (`LeadAssignmentHistory.note`, migration `20261007200000_assignment_note`).
- Lead detail — the sentence under the owner.
- `src/services/leadership/reports.ts`, the Reports menu — Follow-up Adherence, Source to Booking.

**Behaviour**
- **Working hours.** A rule that respects working hours (the default on every
  rule) passes over an agent who is rostered today on shifts none of which
  covers now, in the workspace's timezone, or who checked out today and has not
  checked back in. An agent with no roster entry and no check-out has no
  verdict, so a workspace that keeps neither assigns exactly as before. A
  manager assigning from the waiting queue is not held to the hour, and
  neither is a leader's allocation. The "Ignored configuration" note in the
  waiting queue, and the code behind it, are gone.
- **Why this agent.** Each automatic assignment carries a sentence — "Next in
  turn on Portal leads; passed over Sara (off shift (19:00–23:00)), Omar (daily
  quota 10/10)." — shown under the lead's owner while that assignment stands.
  HR reasons read "unavailable", as in the waiting queue.
- **Follow-up adherence** (Team & Users): per agent, follow-ups due in the
  period, done, on time (done no later than due), late, still overdue, and the
  on-time rate. Ported from Lead Eagle's report.
- **Source to booking** (Marketing): per source — each portal by name (from the
  intake's `sourceDetail`), Facebook lead ads, QR capture, cold data, then the
  record sources — the period's leads, how many visited a property, bookings
  (cancelled ones left out), booked value and the lead-to-booking rate. Both
  reports export to CSV like the others.

**Verified.** `tests/sales/assignment-working-hours.spec.ts` (4, real
database, a fixed 11:00 Dubai instant): off shift and checked out passed over,
no schedule not; a check-in after the check-out is back at work; ignored when
the rule does not ask; an assignment past the off-shift agent carries the
sentence. `tests/sales/lead-eagle-reports.spec.ts` (2): adherence's on time,
late, overdue, not yet due and cancelled; source to booking's portal names,
visits, bookings and the cancelled booking left out. The triage spec's case
that asserted the setting was ignored is removed. Full suite 3497 passed (the 2
seed-dependent skips as before). In a browser on the rig, 14 checks at 1280 and
390 px: a lead assigned by the real distribution shows "Next in turn on …;
passed over … (unavailable)" under its owner; both reports render and are in
the menu; the waiting queue has no "Ignored configuration"; no sideways scroll,
no page errors.

**Left open**
- A roster pattern without dated entries (a shift's `workingDays` alone) is not
  read; only dated roster entries are.
- The sentence is written by the distribution worker only; a manual or bulk
  assignment has none.
