# Follow-ups coming due ring the bell

**17 Oct 2026** · fix · Lead Eagle, follow-ups (audit M8-02, M17-06)

- The reminder sweep read `Task` and `Call.followUpAt` but not the Follow-ups register (`FollowUpTask`), so a follow-up due in 20 minutes raised nothing. `sweepDueTasks` now reads both tables; same kind (`follow_up.due`), same once-per-recipient check.
- Test: `tests/integration/follow-up-reminder.spec.ts` (fails on the old code; two sweeps write one notice).
