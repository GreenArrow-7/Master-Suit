# An assigned lead never commits with a WAITING triage episode

## What
A deferred constraint trigger on `Lead` (`lead_close_triage_on_owner`) closes any
WAITING `LeadTriageEntry` as `ASSIGNED` ("Lead was assigned outside the queue")
at commit, when the lead's `ownerId` was set to someone.

## Why
Main went red on `triage-completion.spec.ts > cannot leave an assigned lead
carrying a WAITING episode` (CI 38553703778). The offending lead is the test's
own: the query is tenant-scoped. `importBacklog` re-checks `ownerId IS NULL ...
FOR UPDATE` before opening an episode, but an owner write that arrives while that
row lock is held waits, then commits the owner *after* the episode. No app-side
check can see that write, so the episode stayed WAITING until the stale sweep.
Intermittent because it needs that exact interleaving. Any real assignment path
racing the backlog import had the same window.

## Where
- `apps/web/prisma/migrations/20261016130000_triage_close_on_owner/migration.sql`
- `apps/web/tests/sales/triage-completion.spec.ts` (new case)
- `apps/web/tests/sales/lead-triage.spec.ts` (the "assigned by some other path" case now expects the episode closed at commit)

## Behaviour
Deferred to commit, so the app's own `resolveTriageEntry` (actor, resolution,
escalation answer, idempotency) runs first and wins; the trigger only closes what
is left. Runs as the invoking role, so tenant RLS applies. The stale sweep stays
for deleted leads.

## Verified
Failing first: the new case failed on main (episode still WAITING after an owner
write). After: triage-completion + lead-triage 66/66; tests/sales + tests/permission
105 files / 1868 tests green; tsc clean; eslint/prettier clean; DB-wide invariant
query after the broad run returned [].

## Left open
An immediate (non-deferred) trigger broke 18 manual-assignment tests that resolve
after writing the owner; do not switch it to immediate.
