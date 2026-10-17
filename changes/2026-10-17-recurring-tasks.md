# Tasks can repeat

**17 Oct 2026** · feature · Tasks (audit M8-10)

- New task → "Repeat": every day, week or month (`repeat` on `POST /api/v1/tasks`, stored in `Task.recurrenceRule`).
- Completing a repeating task creates the next one, due one interval after the completed one was due, with the same title, owner, lead and priority, linked by `parentTaskId`. Completing it again does not create a second copy.
- Three fixed intervals, not a full calendar rule; noted in `lib/tasks/recurrence.ts`.
- Test: `tests/sales/recurring-tasks.spec.ts`; tasks and record-scope suites 341/341.
