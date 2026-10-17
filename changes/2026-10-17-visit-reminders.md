# Site visits coming up ring the bell

**17 Oct 2026** · feature · Lead Eagle, site visits (audit M8-13)

- The reminder sweep gains a third pass: a requested or approved site visit starting within 45 minutes raises one `visit.reminder` to its agent, pointing at the lead (or the visit when it has no lead). Same once-per-recipient check as the other reminders.
- Test: `tests/integration/follow-up-reminder.spec.ts`.
