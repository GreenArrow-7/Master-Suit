# The board-filters test reads the board at the moment its data was made

**18 Oct 2026** · test · CI (flake)

- `tests/sales/lead-eagle-dashboard-filters.spec.ts` seeded two follow-ups "due in a minute" and read the board later with a fresh clock. A run around 20:00 UTC — midnight in Dubai, the test workspace's zone — seeded them into one day and read the board in another, so "Due today" came back 0 (seen on #212).
- The board is now read at the seeding moment, and those follow-ups are due a minute later or at the day's last millisecond, whichever is earlier, so they stay on the same day.
- No product code changed.
