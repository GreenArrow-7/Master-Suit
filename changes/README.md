# Changes

The project's working memory: what exists, what changed, why, and where. It
lets a new session learn the project by reading this folder rather than the
code and the git history, so it has to stay short and current.

## Read in this order

1. [`PROJECT.md`](PROJECT.md) — the current state: modules, the rules every
   change follows, where code lives, how to test, verify and release, and what
   waits on a decision.
2. The index below, newest first. Open an entry only when the task touches it.

## Adding an entry

One file per change, committed in the same PR as the change, named
`YYYY-MM-DD-short-name.md`. Keep each section to a few lines:

- **What** — the change, and its PR.
- **Why** — the requirement or the defect, and who decided.
- **Where** — the files that matter, one line each.
- **Behaviour** — what users or operators now see differently.
- **Verified** — the tests (say which fail on the old code) and any browser check.
- **Left open** — follow-ups and decisions still needed.

Then add a row to the index and correct `PROJECT.md` wherever it is now wrong.

## Index

| Date | Entry | PR | Area |
|---|---|---|---|
| 2026-10-06 | [source-map-js 1.2.2 for a new advisory](2026-10-06-source-map-js-advisory.md) | #128 | dependencies |
| 2026-10-06 | [A Real-Estate-only workspace could not take a lead; the Visits tab had no icon](2026-10-06-lead-work-provisioning.md) | #128 | fix |
| 2026-10-05 | [Lead Eagle, phase 1: live in the platform portal](2026-10-05-lead-eagle-phase-1.md) | #128 | Lead Eagle |
| 2026-10-05 | [Lead Eagle inside YOUHAN ONE — plan](2026-10-05-lead-eagle-plan.md) | — | plan, approved |
| 2026-10-05 | [Release 0ae7e9d](2026-10-05-release-0ae7e9d.md) | #117, #124–#126 | release |
| 2026-10-05 | [Lead Eagle: build it inside YOUHAN ONE](2026-10-05-lead-eagle-decision.md) | — | decision |
| 2026-10-05 | [Attendance in every workspace](2026-10-05-attendance-every-workspace.md) | #117, #124 | attendance |
| 2026-10-05 | [Two specs that failed only in parallel](2026-10-05-parallel-flaky-specs.md) | #125 | tests |
| 2026-10-05 | [Release 9f7e89b](2026-10-05-release-9f7e89b.md) | #114–#122 | release |
