# Attendance in every workspace

**What.** Face ID check-in and check-out, the attendance record and attendance
requests work in every workspace (Sales, Real Estate, and Lead Eagle when it is
built), not only with HRMS. #117 (merged) opened the setup; #124 opens the
record and the requests.

**Why.** Owner, 5 Oct: Sales-type workspaces need attendance monitoring (Face ID
check-in and check-out) and nothing else from HR. An early check-out is approved
by the Company Admin, or by a manager for their own team.

**Where.**

- `attendance/page.tsx`, `attendance/requests/page.tsx` re-export the People
  pages outside the HRMS layout; `admin/work-locations` and `admin/users/new`
  (#117) do the same for setup.
- `people/attendance/page.tsx`, `people/requests/page.tsx` admit any module.
- `services/hr/reads.ts` `attendanceScope`: one rule for the screen and the API —
  everyone for an organisation-wide reader, the reporting line for an attendance
  approver, otherwise your own.
- `services/hr/requests.ts` `decideAttendanceException`: a `work_pending`
  exception is final at the manager's stage and writes no substitute punch.
- `api/v1/workspaces/[workspaceSlug]/hr/self/[action]`: `early-checkout-request`.
  `ATTENDANCE_SETUP` in `hr/actions` and `hr/[resource]` lists what works without HRMS.
- `check-in/CheckInConsole.tsx`: "Ask my manager for an early check-out", one tap.
- `lib/nav/workspaceNav.ts`: Home offers Check-in, Attendance and Attendance
  Requests where HRMS is absent.

**Behaviour.**

- A manager sees their own team's attendance, in HRMS workspaces too. Before,
  any team-level approver saw every employee's days and check-in locations.
- An early check-out takes one approval, and the employee still checks out with
  their face. Other exceptions keep two stages: the manager, then HR.
- A manager role needs `attendance:VIEW` and `attendance:APPROVE` at team scope,
  which the Company Admin grants in the role editor.

**Verified.** `tests/hr/attendance-manager.spec.ts` (two of its five cases fail
on the old code), `module-entitlement.spec`, `every-route.spec`. Checked in a
browser as a workspace without HRMS at 1280 and 390 wide.

**Left open.** After a reload the check-in button shows again, so a second
request is possible; the manager approves one.
