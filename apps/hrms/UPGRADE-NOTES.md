# HRMS v2 — Assignable roles & admin-managed attendance locations

## What changed

### 1. Dynamic RBAC (no more one-role-per-user)
- New tables: `roles`, `permissions`, `role_permissions`, `user_role_assignments`
  (org, scope type + id, effective-from/to, status, assigned/revoked by/at/reason,
  indexed on user_id+status+dates).
- 12 default roles seeded on first start (Super Administrator → Auditor) plus
  custom roles; permissions catalogue in `app/services/rbac.py`.
- Effective permissions = union of all active, in-window assignments, recomputed
  server-side on every request (`require_perm`). The legacy `employees.role`
  column is kept in sync for old endpoints and existing users are migrated to
  real assignments automatically at startup.
- Guard rails: only Super Administrators grant/revoke Super Administrator;
  you cannot revoke your own last administrative role; roles with assignment
  history cannot be deleted (deactivate instead); scoped managers cannot act
  outside their scope. Every change is audited.
- UI: `web/roles.html` (roles list, permission matrix, create/clone/edit,
  scoped + dated assignment, per-role users, history). Per-user access via
  `/api/access/*` (activate/deactivate, revoke sessions, reset MFA, login history).

### 2. Admin-managed attendance locations
- New tables: `work_locations` (full field set incl. emirate, max GPS accuracy,
  effective dates, opening/closing, working days, manager, notes, created/updated
  by/at), `employee_location_assignments`, `temporary_location_requests`,
  `attendance_exception_requests`, `attendance_challenges`, `attendance_days`.
- `web/locations.html`: manual latitude/longitude/radius entry with validation,
  Leaflet map (click, drag marker, geofence circle preview), OSM address search,
  point tester, explicit activation confirmation, reason required to move an
  active geofence, employee assignment (single/bulk, dates, per-assignment
  check-in/out flags and check-out rule), CSV export, temporary-location
  approvals and exception queue.
- Legacy `sites` remain for old data; new punches validate exclusively against
  `work_locations` + assignments.

### 3. Strict server-side punch validation
- The client's `site_id` is now ignored; the server resolves the location from
  the employee's assignments and computes Haversine distance itself
  (`app/services/location_rules.py`) — all 16 spec checks, including day/time
  windows, expiry on both assignment and location, strict accuracy threshold
  (per-location override), duplicate/sequence guards and the configurable
  check-out rule (default: same location as check-in).
- Geofence verdicts for the face flow are applied after the liveness nonce is
  consumed, so a rejected capture can never be replayed from outside the fence.
- Every attempt (accepted or rejected) is stored in `attendance_punches` with a
  snapshot of the geofence in force (lat/lng/radius/max-accuracy), request id and
  server-observed IP. Editing a location later never rewrites this evidence.
- Behaviour change: the old GPS-accuracy "grace" is gone — distance is compared
  strictly against the radius, accuracy is validated separately.

### 4. Exceptions instead of loopholes
- `/api/locations/exceptions`: employee requests with captured coordinates,
  nearest location + distance, reason codes; manager → HR approval; an approved
  exception creates a separate adjusted punch and never overwrites rejections.
- Temporary locations expire automatically via effective dates; requesters can
  never approve their own request.

## PostgreSQL
Set `DATABASE_URL=postgresql+psycopg://user:pass@host/dbname` in `.env`
(add `psycopg[binary]` to requirements). All new tables/columns are created by
the existing startup reconciliation. For scale, add PostGIS and replace
`haversine_m` with `ST_DWithin` on a geography column.

## Tests
`python -m pytest tests/test_locations_rbac.py` — 16 acceptance tests covering
the full checklist (manual coords, invalid coords, unassigned/inside/outside/
accuracy, inactive/expired/future locations and assignments, same-location
check-out, temporary windows, scope limits, super-admin protection, multi-role
union, expiry/revocation, audit trail, snapshot immutability).
Existing suites updated where the contract changed (`test_attendance.py`).
Note: `test_totp.py` / `test_security_hardening.py` have pre-existing,
environment-dependent failures unrelated to this upgrade.
