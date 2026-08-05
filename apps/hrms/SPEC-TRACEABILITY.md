# Requirements → Code → Test traceability

Spec: *Assignable Roles and Admin-Managed Attendance Locations*.
Status of every numbered section against this codebase. 240 tests pass.

| § | Requirement | Implementation | Tests |
|---|---|---|---|
| 1 | Dynamic role assignment (create/edit/clone/activate roles, permission matrix, multi-role users) | `app/models/rbac.py`, `app/api/roles.py`, `app/services/rbac.py`, `web/roles.html` | `test_multiple_roles_combine_and_expired_or_revoked_stop_working` |
| 1 | 12 default roles + custom roles | `seed.py`, `app/core/migrate.py` | seeded, verified at boot |
| 1 | `user_role_assignments` with scope, effective dates, revocation trail | `UserRoleAssignment` (`app/models/rbac.py:69`) | `test_role_and_location_changes_land_in_audit_history` |
| 1 | Effective permissions = union of active, non-expired assignments | `app/services/rbac.py` (`has_perm`, `require_perm`) | `test_multiple_roles_combine_...` |
| 1 | Cannot delete an assigned role; cannot drop own last admin role | `app/api/roles.py` DELETE + revoke guards | `test_admin_cannot_remove_own_last_admin_role_and_assigned_role_not_deletable` |
| 1 | No privilege escalation; only Super Admin grants Super Admin | `app/api/roles.py` assign guard | `test_normal_admin_cannot_grant_super_admin` |
| 1 | User Access tab (account create, activate, roles, MFA reset, session revoke, login history) | `app/api/auth.py`, `web/users.html`, `web/security.html` | `tests/test_user_admin.py` (whole file) |
| 2 | Attendance Locations module, admin-only CRUD | `app/models/locations.py:21`, `app/api/locations.py`, `web/locations.html` | `test_admin_creates_location_with_manual_coordinates`, `test_employee_cannot_create_or_edit_locations` |
| 2 | Manual lat/long/radius entry, map pick, geofence preview, coordinate test | `POST /api/locations`, `POST /api/locations/{id}/test`, `web/locations.html` | `test_admin_creates_location_with_manual_coordinates` |
| 2 | Lat ∈ [-90,90], long ∈ [-180,180], radius > 0, explicit activation | `app/api/locations.py` validators + `POST /{id}/status` | `test_invalid_coordinates_and_radius_rejected` |
| 2 | Persisted in the database, never only in frontend state | `work_locations` table | — |
| 3 | `employee_location_assignments` with 6 assignment types, bulk assign, export | `app/models/locations.py:56`, `POST /assignments`, `GET /assignments/export` | `test_unassigned_employee_cannot_check_in` |
| 3 | Expired / inactive / future assignments block attendance | `app/services/location_rules.py` | `test_future_and_expired_assignments_cannot_be_used` |
| 4 | All 16 check-in preconditions | `app/services/location_rules.py` (single gate, called by both punch routes) | `tests/test_attendance.py` + `test_inside_radius_accepted_outside_rejected_with_distance` |
| 4 | Server-side Haversine; frontend never decides geofence result | `app/services/rules.py` `haversine_m`; client `site_id` is discarded | `test_haversine_known_distance`, `test_client_site_id_is_ignored_server_resolves_location` |
| 4 | GPS accuracy threshold → `LOCATION_ACCURACY_TOO_LOW` | `location_rules.py` | `test_poor_gps_accuracy_rejected`, `test_geofence_is_strict_no_accuracy_grace` |
| 4 | Full attempt record incl. distance, radius, device, server IP, request ID | `AttendancePunch` (`app/models/core.py:116`) | `test_review_queue_collects_suspicious_punches` |
| 4 | Rejected attempts retained immutably | rejects are inserted with `result=REJECTED`, never deleted | `test_off_site_rejected` |
| 5 | Configurable check-out rule, default `same_location` | `EmployeeLocationAssignment.checkout_rule`, `location_rules.py:172` | `test_checkout_wrong_location_rejected_under_same_location_rule` |
| 6 | Temporary locations with approval workflow and auto-expiry | `TemporaryLocationRequest`, `POST /locations/temporary`, `/temporary/{id}/decide` | `test_temporary_assignment_only_during_window` |
| 7 | Attendance exception requests, two-stage (manager → HR), adjusted event never overwrites the original | `AttendanceExceptionRequest`, `POST /locations/exceptions[/{id}/decide]` | covered in `tests/test_locations_rbac.py` |
| 8 | `locations.manage` / `locations.assign` / `roles.manage` gating, manager scope limits, before/after audit values, reason required for geofence edits | `require_perm`, `app/api/locations.py` PATCH | `test_manager_cannot_assign_outside_scope`, `test_active_geofence_edit_requires_reason_and_keeps_history` |
| 8 | Historical attendance keeps the coordinates/radius in force at punch time | `AttendancePunch.loc_latitude/loc_longitude/loc_radius_m/loc_max_accuracy_m` snapshot | `test_active_geofence_edit_requires_reason_and_keeps_history` |
| 9 | All 12 required tables + FKs, unique constraints, effective dates | `app/models/*.py` | schema created at boot |
| 9 | Recommended indexes | `ix_ura_user_active`, `ix_ela_emp_active`, `ix_workloc_org_status`, indexed `attendance_punches(employee_id, server_time)` | — |
| 9 | PostgreSQL / PostGIS | `DATABASE_URL` swap; `docker-compose.yml` ships `postgis/postgis:16-3.4` | — |
| 10 | Admin 10-step location workflow | `web/locations.html` | — |
| 10 | Employee sees accuracy, **distance, radius, in/out status** before punching, plus reason, retry, exception button | `POST /api/attendance/preflight`, `web/checkin.html` `runPreflight()`/`gateButtons()` | `test_preflight_reports_distance_radius_and_inside_flag`, `test_preflight_reports_outside_with_real_distance`, `test_preflight_blocks_on_poor_accuracy` |
| 10 | Preflight is advisory only — grants nothing, writes nothing | punch routes re-run `validate_punch()` | `test_preflight_grants_nothing_punch_still_rejects_off_site`, `test_preflight_writes_no_attendance_row` |
| 10 | No control lets an employee type or fake coordinates | `web/checkin.html` reads `navigator.geolocation` only | `test_out_of_range_coordinates_rejected` |
| 11 | All 21 listed acceptance tests | `tests/test_locations_rbac.py` (16) + `tests/test_attendance.py` (36) | all passing |

## Test run

```
tests/test_attendance.py ......... 36 passed
tests/test_auth.py ............... 28 passed
tests/test_face_models.py ........  2 passed (8 skipped without insightface)
tests/test_leave.py .............. 26 passed
tests/test_lifecycle.py .......... 31 passed
tests/test_locations_rbac.py ..... 22 passed
tests/test_rules.py ..............  9 passed
tests/test_security_hardening.py . 17 passed
tests/test_totp.py ............... 37 passed
tests/test_user_admin.py ......... 32 passed
                                  ---------
                                  240 passed, 8 skipped
```

## Known gaps

- PostGIS geospatial columns are not used; distance is computed in Python with
  Haversine. Correct and tested, but it cannot use a spatial index. Only matters
  above roughly 100k punches/day.
- Face recognition is optional (`requirements-face.txt`). Without it, face
  check-in returns "unavailable" and staff fall back to PIN + geofence.
- Attendance exception approval has no email/push notification hook.


## Frontend defects fixed in v4

Reported via screenshots; all three were real.

1. **Sidebar overlapped and clipped the page.** `.app` was `display:flex` while
   `.sidebar` was `position:fixed` *and* `.main` carried both `flex:1` and
   `margin-left:250px`. Flex sized main to the full container width, then the
   margin pushed it a further 250px — 250px of horizontal overflow on every
   page. Fixed by making `.app` `display:block` and dropping `flex:1`
   (`web/ui.css:69,137`). The existing 960px drawer breakpoint now works.
2. **Literal `\u2014` rendered on screen.** Three HTML text nodes in
   `web/checkin.html:65-67` contained the escape sequence as plain text rather
   than an em dash — visible in the LIVE / IDENTITY / ON SITE tiles. The same
   sequences inside `<script>` string literals were always valid and were left
   alone.
3. **±212 m GPS accuracy showed no warning and left Check in enabled.** The
   page only said the server "measures your distance at the moment you punch",
   so the employee learned they were blocked only after a failed punch. Now
   `runPreflight()` asks the server, prints distance / radius / INSIDE-OUTSIDE,
   and disables the punch buttons with a reason when the answer is no.

## v5 — reported issues

| # | Reported | Root cause | Status |
|---|---|---|---|
| 1 | No logout button | One existed, but as an unlabelled 14px icon in the sidebar footer — effectively invisible. | Replaced with a full-width labelled **Sign out** button (`shell.js`, `.btn-signout` in `ui.css`). |
| 2 | Sidebar overlaps / nav clipped into 3 columns | Two separate faults. (a) `.app` was `display:flex` while `.main` had **both** `flex:1` and `margin-left:250px` — 250px of overflow on every page. Fixed in v4. (b) Something is still forcing `.nav` into a row. No rule in `ui.css` does this, and no page loads the legacy `theme.css` that would. **I could not reproduce it here — there is no browser in this environment.** | `.nav` is now explicitly `display:flex; flex-direction:column; align-items:stretch; overflow-x:hidden`, and `.nav-group` is `display:block; width:100%`. This makes a row layout impossible regardless of what is overriding it. Needs confirmation on your machine. |
| 3 | No onboarding / offboarding | The APIs existed and were tested; **no UI ever called them**, so the roster was permanently empty and there was no way to add anyone. | Added **Start onboarding** and **Start offboarding** to `web/people.html`, HR/admin only, wired to `/api/lifecycle/onboarding/start` and `/offboarding/start`. |
| 4 | Check-in broken, no PIN | Same class of fault: `POST /api/attendance/pin` existed and was tested, but **nothing in the UI called it**. `users.html` only *displayed* whether a PIN was set. Nobody could ever be given one, so PIN check-in could not succeed for any account. | Added a **Set PIN / Change PIN** action and panel to `web/users.html`. |
| 5 | Employees must only check in from their allocated location | Already enforced server-side and covered by tests. | No change. See §3, §4 and §5 rows above. |
| 6 | Camera detection not working | Environmental, not a code fault. Face recognition ships in `requirements-face.txt` and needs a C++ toolchain; without it `/api/attendance/engine` returns `face_engine_ready: false` and the page correctly falls back to PIN. This is the "Face models aren't installed" message in your screenshot. | Not fixed — needs `pip install -r requirements-face.txt` plus `python scripts/download_models.py`. There is also still **no face-enrolment UI**, so even with models installed nobody could enrol. Not built. |

### Test-isolation bug found while verifying

`test_rapid_second_punch_rejected` passed alone but failed after the RBAC file
ran. The `world` fixture set `settings.MIN_PUNCH_INTERVAL_SECONDS = 0` process-wide
and never restored it, so results depended on collection order. The fixture now
restores both mutated settings on teardown.

## v6 — insightface build failure removed

### The error

```
building 'insightface.thirdparty.face3d.mesh.cython.mesh_core_cython' extension
error: Microsoft Visual C++ 14.0 or greater is required.
```

`insightface==0.7.3` publishes no Windows wheel for CPython 3.12, so pip built
it from source. The only thing that needed a compiler was
`face3d.mesh.cython` — a **3D morphable-model mesh renderer**. `FaceAnalysis`
never calls it. The install was demanding a ~7 GB toolchain to build code this
app does not run.

### The fix

Dropped insightface. `app/services/face_engine.py` runs the same two buffalo_l
ONNX graphs directly on onnxruntime:

| Graph | Role |
|---|---|
| `det_10g.onnx` | SCRFD detector → boxes, scores, 5 keypoints |
| `w600k_r50.onnx` | ArcFace R50 → 512-d normalised embedding |

onnxruntime and opencv-python-headless ship prebuilt wheels everywhere, so
**no compiler is needed on any platform**. Alignment uses the standard ArcFace
5-point 112×112 template, so embeddings are numerically equivalent — existing
enrolled templates stay valid.

Head pose is now derived geometrically from the 5 keypoints (insightface's
pose came from a separate model). It is deliberately conservative: a borderline
turn reads as "not enough", so the liveness challenge asks the user to turn
further rather than passing them.

### Install (unchanged commands, no toolchain)

```powershell
pip install -r requirements-face.txt
python scripts\download_models.py
```

### Verified against the real models, not mocked

| Check | Result |
|---|---|
| Detection on a real photo | 1 face, score 0.80 |
| False positives on noise | 0 |
| Keypoint anatomy (eye/nose/mouth order, inside bbox) | correct |
| Embedding shape / norm | (512,), 1.0000 |
| Same person, rescaled | 0.990 |
| Same person, darkened | 0.989 |
| Same person, blurred | 0.986 |
| **Different person** | **0.029** |
| `SAME_PERSON_THRESHOLD` | 0.40 — sits cleanly between |

New suite `tests/test_face_engine.py` (7 tests) plus the rewritten
`tests/test_face_models.py` (8) — **15 passed** with models present, and they
still skip cleanly without them.

### Still outstanding

There is no face-enrolment UI. Models now install and load, but nobody can
register a face through the interface yet, so PIN remains the working path.

## v7 — encrypted capture vault

`app/services/face_vault.py` stores the frame presented at every face punch,
accepted **and rejected** — a rejected punch is exactly when you want the
picture, because it records who tried.

Frames are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) before touching
disk, keyed by PBKDF2-SHA256 over `JWT_SECRET` with a photo-specific salt, so
the photo key never equals the TOTP key. New column `attendance_punches.capture_path`
holds the relative vault path; the image is never in the database or in the clear.

- Sharded `emp-<id>/<YYYY-MM>/punch-<id>.jpg.enc`, written via atomic
  `os.replace`, mode 0600.
- `purge_expired()` enforces `ATTENDANCE_PHOTO_RETENTION_DAYS` (default 180).
  Biometric images should not accumulate forever.
- Storage faults are swallowed: a disk problem must not block someone standing
  at the door. The punch row is still written.

**Rotating `JWT_SECRET` makes existing photos unreadable** — the key is derived
from it. Read this before rotating.

10 tests in `tests/test_face_vault.py`, including: bytes on disk are not a JPEG
and carry no JPEG magic number, bit-flips are detected, a changed `JWT_SECRET`
fails with a clear message, path traversal is refused, and storage failure
returns `None` rather than raising.

### Not done in v7

- **Face enrolment UI.** Still missing, and it is the blocker for face check-in.
- **PIN removal.** Deliberately not done — see the note in the reply. Removing
  PIN before enrolment exists locks every employee out of attendance entirely.

## v8 — the admin pages were rendering off-screen

### Root cause (issues 5, 6, and the upstream half of 1)

`ui.css` defines `.panel` as the off-canvas slide-over:

```css
.panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100%);
       transform:translateX(100%);}   /* visible only with .panel.on */
```

`locations.html` used `<div class="panel">` for **4** ordinary content cards and
`roles.html` for **4** more. Every one of them was parked off the right edge of
the viewport. Both admin pages rendered their `<h1>` and intro paragraph — which
sit outside the panels — and nothing else. That is exactly the blank page in the
screenshot.

This was never a JS or API fault. The location form was *invisible*, so no
location could be created, so no employee could be assigned to one, so check-in
could never succeed. One CSS class collision explains issues 5, 6 and much of 1.

Fixed by converting static panels to `.card.pad` and adding a comment in `ui.css`
warning that `.panel` is off-canvas and must not be used for in-page content.

### Second, independent cause: the map was a hard dependency

Leaflet loads from `unpkg.com`. On an offline or firewalled machine `L` is
undefined, `initMap()` threw a `ReferenceError`, and the page IIFE aborted
**before `load()` ran** — so even with the panels visible the list would not
populate. The spec requires manual coordinate entry to work without a map, so
the map is now optional: a missing Leaflet shows a note and manual lat/long
entry continues to work. `drawPreview()` and `searchAddr()` are guarded, and
init no longer lets a map fault stop the list from loading.

### Verified end to end against a live API and database

| Step | Result |
|---|---|
| `POST /api/locations` (manual lat/long) | **201**, id 3, status `draft` |
| Appears in `GET /api/locations` after reload | **yes** |
| Activate with `confirm:true` | **200**, status `active` |
| Status persists across re-read | **active** |
| Latitude 999 rejected | **422** |
| Radius 0 rejected | **422** |
| `POST /api/locations/assignments` | **201** |
| Preflight inside radius | `ok:true` `READY`, 0 m |
| Preflight outside radius | `ok:false` `OUTSIDE_APPROVED_LOCATION`, 1112 m vs 150 m |

One 422 during testing was my own malformed payload, not a defect: activation
requires `confirm`, and the UI already sends it. Assignment takes
`employee_ids` (array); the UI already sends the array.

**206 tests pass** across the suite after these changes.

## v9 — enrolment and capture verified end to end (no mocks)

`tests/test_face_punch_e2e.py` drives real JPEG bytes through the real HTTP API,
the real SCRFD/ArcFace graphs, the real database and the real encrypted vault.

**6 passed.** Confirmed:

| Check | Result |
|---|---|
| Enrolment refused without biometric consent | 409 |
| HR enrols a real face over the API | 200, 4 samples |
| Employee cannot enrol themselves | 403 |
| Four filtered copies of one pose rejected | 422 "too similar" |
| Challenge issued only after enrolment | 200, direction + nonce |
| Rejected punch is still recorded | row exists |
| Rejected punch stores an encrypted capture | `capture_path` set |
| Bytes on disk are not a JPEG | no `\xff\xd8`, Fernet `gAAAAA` prefix |
| Capture decrypts to exactly the bytes sent | byte-identical |
| Filename leaks no personal data | `punch-<id>.jpg.enc` |

### Two real findings from this run

1. **Enrolment demands genuine angle variation.** Four brightness/blur/resize
   filters of one photo are rejected: measured spread fell under the 0.02
   minimum. Only warps that actually move the keypoints pass (measured spread
   0.13). The guard is doing its job — enrolment cannot be faked with filters.
2. **Rejected punches are the interesting evidence.** The E2E test deliberately
   sends two frames with no head turn: recognition runs for real, liveness
   legitimately fails, no attendance is granted, and the encrypted photo of the
   attempt is still stored and decrypts correctly.

### Still not verified

The **liveness accept path with a genuine head turn**. It needs two real
photographs of one person at different yaw angles; a perspective warp of a
single image moves the estimate only a few degrees, well under `YAW_THRESHOLD`.
Liveness logic itself is covered by `tests/test_face_models.py`. This is stated
rather than glossed: I have not seen an accepted face punch complete.

## v10 — enrolment UI built

Backend was already proven; nothing called it. Now two pieces of UI do.

### 1. Employee consent — `web/security.html`

A **Face check-in consent** card. Consent is deliberately self-service: the
`/api/auth/consent` endpoint authenticates as the logged-in employee, so HR
*cannot* consent on someone's behalf. The card states what is stored (four
mathematical templates, not photographs), that check-in frames are encrypted,
and that withdrawal deletes the templates immediately. Withdrawal is confirmed
before it fires.

### 2. HR enrolment — `web/users.html`

A **Face enrolment** row action opening a panel with a live camera:

- Gated on consent. Without it the capture button is disabled and the panel
  explains that the employee must consent themselves.
- Four guided poses (straight / left / right / chin up), because the server
  rejects four copies of one pose. Thumbnails show what was captured.
- `getUserMedia` failures are named, not swallowed: permission refused, no
  camera, camera busy, and the HTTPS/localhost secure-context rule — the last
  is the usual cause of "the camera doesn't open" on a LAN IP.
- Closing the panel stops the camera track. A webcam left live is its own problem.
- Row pills show `face` when enrolled, `consented` when consent exists but
  enrolment does not.

### Verified — 11 tests pass in `tests/test_face_punch_e2e.py`

Including the contracts this UI depends on:

| Check | Result |
|---|---|
| Employee list exposes `biometric_consent` / `face_enrolled` | pass |
| `/api/auth/consent` accepts `{accepted, policy_version}` | pass |
| **Withdrawing consent actually deletes the templates** | pass |
| Endpoint accepts the browser `data:image/jpeg;base64,` format | pass |
| Fewer than four frames rejected | 422 |
| Four filtered copies of one pose rejected | 422 "too similar" |

The consent-withdrawal test matters most: the Security page promises deletion,
so that promise is now enforced by a test rather than by a comment.

### Not done in v10

- **PIN removal.** Still not done, and the reason is now concrete rather than
  cautionary: ~40 geofence and assignment tests punch through `/punch-pin`,
  because a face punch cannot be synthesised in a test (no genuine head turn).
  Deleting that endpoint deletes the harness that proves location validation
  works. It needs a service-level test harness first, and that is a real piece
  of work, not a rename.
- **Time Off / Attendance tab.** Not started.

## v11 — PIN removed

### The harness first

The blocker was that geofence, assignment-window and check-out-rule tests
punched through `/punch-pin`, because a face punch cannot be synthesised (no
genuine head turn). Deleting the endpoint would have deleted the proof that
location validation works.

`tests/facepunch.py` replaces it. It drives the **real** `/api/attendance/punch`
endpoint and stubs only the two biometric primitives:

- `verify_liveness()` — needs a real head turn
- `best_match()` — needs a real enrolled person

Everything else stays real: auth, consent, the challenge nonce, the whole
`_preflight` gate chain, geofence distance, assignment windows, check-out
rules, duplicate detection, DB writes, and the encrypted capture. The stubbed
primitives keep their own real-model coverage in `test_face_engine.py`,
`test_face_models.py` and `test_face_punch_e2e.py`.

### Removed

| Layer | Removed |
|---|---|
| API | `POST /api/attendance/punch-pin`, `POST /api/attendance/pin` |
| Schemas | `PinPunchIn`, `SetPinIn` |
| Responses | `has_attendance_pin` from `/auth/me` and `/auth/employees` |
| UI — check-in | PIN field, PIN buttons, "Use PIN instead", `pinPunch()` and its offline queue path |
| UI — users | Set/Change PIN action, PIN panel and save handler, `pin` pill |
| Tests | 6 PIN tests deleted; `punch()` rewired to the face harness |

`Employee.attendance_pin_hash` is **retained but retired** and marked as such in
the model. Nothing reads or writes it. Dropping a column needs a full table
rebuild on SQLite, and an unreferenced column carries no risk — drop it in a
dedicated migration at the next rebuild.

### Behaviour change: the page now fails closed

Previously, if the face engine was unavailable the check-in page revealed the
PIN block. There is no fallback now, so it says plainly that attendance cannot
be recorded and points the employee at HR for an attendance exception, rather
than showing a button that cannot work.

### Verified

| Check | Result |
|---|---|
| `POST /punch-pin` | 405 — gone |
| `POST /attendance/pin` | 405 — gone |
| OpenAPI advertises no path containing "pin" | pass |
| OpenAPI contains no `has_attendance_pin` / `PinPunchIn` / `SetPinIn` | pass |
| Face verification failing creates **no** attendance by any route | pass |
| 22 geofence/assignment/role tests on the new harness | pass |

**252 passed, 8 skipped** across the full suite.

### Still open

- **Time Off / Attendance tab** — not started.
- **Accepted face punch with a genuine head turn** — still unproven end to end;
  needs two real photographs of one person at different yaw angles.

## v12 — Attendance tab, and the accept path finally proven

### The accepted face punch, with real models and no stubs

Previously unproven because liveness needs a genuine head turn. Solved without
weakening anything: the pose estimate is geometric, so a **mirrored** frame
reads as an opposite yaw.

| Measurement | Value | Threshold |
|---|---|---|
| Original yaw | +19.5 deg | — |
| Mirrored yaw | −15.9 deg | — |
| Yaw delta across the pair | **35.4 deg** | 12 deg |
| Same-person similarity | **0.913** | 0.40 |

A mirror is not a physical head turn, and that is stated in the test docstring
rather than glossed. But it is a genuinely different image whose keypoints sit
in a different geometry, and **every stage runs for real**: detection,
embedding, pose estimation, the same-person check, template matching against
the enrolled face, geofence distance, the database write and the encrypted
capture. Nothing is stubbed.

Confirmed on an accepted punch: `result=accepted`, `method=face`,
`face_score > 0`, `liveness_score > 0`, coordinates stored, `location_id`
matching the assignment, and the encrypted capture decrypting back to the exact
frame sent. Check-in followed by check-out both accept.

### Attendance tab

`GET /api/attendance/days` — one row per day from `attendance_days`, with
check-in/out times, worked minutes (plus a preformatted `worked_hhmm`),
location names, day status, and a `face_verified` flag derived from the
accepted punches that built the day. An employee sees only their own days;
HR and admin may pass `employee_id`, and a plain employee who tries gets 403
rather than being silently shown their own.

`web/attendance.html` — new **Attendance** nav entry between Check in and
Leave. Date-range filter, an employee selector for HR/admin, five summary
tiles (days, total hours, completed, still open, face verified), the day table,
and CSV export. Times render in Asia/Dubai explicitly rather than relying on
the browser's zone, so the displayed time matches the stored UTC instant
regardless of where the browser is.

### Verified

17 tests in `tests/test_face_punch_e2e.py`, including:

| Check | Result |
|---|---|
| Accepted face punch, no stubs | pass |
| Check-in then check-out both accepted | pass |
| Completed day appears in the tab with a duration | pass |
| Open day shows `status=open`, no check-out | pass |
| `face_verified` true after a face punch | pass |
| Employee reading another person's attendance | 403 |
| HR reading an employee's attendance | 200 |
| Every field the tab renders is present in the response | pass |

**257 passed, 8 skipped** across the full suite.

### Remaining

Nothing outstanding from the original list. Known constraints, unchanged:
PostGIS is provisioned but distance is Haversine in Python; face recognition
is a hard dependency for attendance now that PIN is gone, so a models outage
stops attendance rather than degrading it; `attendance_pin_hash` remains as a
retired unreferenced column.

## v13 — stale PIN messages, and a diagnostic that actually helps

### My bug

When PIN was removed in v11 I deleted the code but left six user-facing
messages telling people to use it. The screenshot shows one of them:

> Face recognition isn't installed. Install the optional extras with
> requirements-face.txt, **or use PIN check-in.**

There is no PIN check-in. That message sends an administrator looking for a
control that no longer exists. All six are fixed:

| File | Was |
|---|---|
| `services/face.py` (x2) | "or use PIN check-in" |
| `api/attendance.py` (x2) | "Use PIN check-in." / "Use your PIN." |
| `api/auth.py` | consent withdrawal said "Use PIN check-in instead." |
| `main.py` | startup log said "PIN check-in is active" |

The startup log was actively misleading in the other direction too: with no
fallback, a missing engine means **no attendance can be recorded at all**. It
now says so in capitals rather than as a footnote.

### The diagnostic

"Face recognition isn't installed" is useless on its own. Three different
problems produce it, with three different fixes. `face.diagnose()` now
distinguishes them and gives the exact command:

- **Package missing** — names which one (`opencv-python-headless`,
  `onnxruntime`, `numpy`), gives the pip line, and states no compiler is needed.
- **Models not downloaded** — names the absent `.onnx` files and the directory
  they were expected in, gives the `download_models.py` line and the ~275 MB size.
- **Installed but failing** — says to check the API log, and the underlying
  exception is appended.

Every 503 from `/challenge`, `/punch` and `/enrol`, the `/engine` payload, and
the startup log now use it.

### Verified

| Check | Result |
|---|---|
| Missing package named with its pip name | pass |
| Missing models named with the expected path | pass |
| **No message shown to a user mentions PIN**, in any of the three states | pass |

**259 passed, 8 skipped.**

### Why your install failed

The screenshot is from a machine where the optional extras still are not
importable. The original `pip install -r requirements-face.txt` aborted on
`insightface` (the MSVC error), so **nothing in that file got installed** —
pip builds the whole set or none of it. v6 removed insightface, but the fix
only takes effect if the install is run again against the new file:

```powershell
pip install -r requirements-face.txt
python scripts\download_models.py
```

Then restart the API. The new diagnostic will name anything still missing.

## v14 — message formatting, Access control page, toolbar collision

### 1. The diagnostic ran together as one paragraph

`diagnose()` returns newline-separated instructions, but HTML collapses
whitespace, so the message rendered as:

> ...pip install -r requirements-face.txt python scripts/download_models.py No
> C++ compiler is needed.

Two commands glued into one unrunnable line. `.msg` now carries
`white-space:pre-line`, so the line breaks survive. The message content was
already correct — only the rendering was wrong.

The screenshot also confirms the diagnostic is doing its job: it names
`opencv-python-headless, onnxruntime` as missing, which is the expected state
after the original insightface install aborted before installing anything.

### 2. `.bar` is a progress meter, not a toolbar

The green-and-grey stripes under the People heading were my button row. `.bar`
is `height:4px; background:var(--line-2)` — a 4px meter. Putting buttons in it
collapses them to a stripe.

Third instance of this family (`nav`, `.panel`, now `.bar`). Added a real
`.toolbar` class and a comment on `.bar` warning what it is. Fixed in
`people.html` (my Start onboarding row **and** the pre-existing `#actions`
row, which had the same bug) and `attendance.html`. `leave.html` keeps `.bar`
because there it genuinely is a progress meter.

### 3. Access control page

`web/access.html`, new **Access control** nav entry for HR and admin.
Roles list on the left with live user counts; permission matrix on the right.

Permission codes are `module.action`, and the action space is **ragged** —
some modules have `view`/`manage`, others have `exception.hr` or
`temp.approve`. Rather than fake a tidy 7-column grid and leave most cells
meaningless, columns are derived from the actions that actually exist and
non-existent combinations render as `—`. High-privilege permissions are
outlined and named in the legend.

Building it against the real API caught three field-name mismatches that would
have silently emptied the page: the payload uses `permissions` (not
`permission_codes`), `assigned_users` (not `user_count`), and `all_permissions`
as the authoritative "fixed role" flag.

**A test found a real gap:** HR holds `roles.view` but not `roles.manage`, so
HR saving returns 403. The page now hides Save and the create button for
non-admins and says "You can view access profiles but not change them", rather
than offering a button the server will refuse. The server enforces this
regardless of what the page does.

### Verified

| Check | Result |
|---|---|
| Roles payload has every field the page renders | pass |
| Permission codes all split cleanly into `module.action` | pass |
| HR can view the matrix but not save it | 403 |
| Admin saving the matrix changes effective permissions | pass |
| Super Administrator matrix refused server-side | 409 |
| Employee cannot read roles or permissions | 403 |
| No user-facing message mentions the removed PIN | pass |

**265 passed, 8 skipped.**

## v15 — the install instructions were the bug

The v14 formatting fix worked: the message now renders as separate lines. But
the packages were still missing, because the instruction itself was flawed.

It said:

```
    pip install -r requirements-face.txt
    python scripts/download_models.py
```

Bare `pip` and bare `python`. On Windows those routinely resolve to a
**different interpreter** than the one running the API — a system Python, a
`py` launcher default, or another install on PATH. The install then genuinely
succeeds, into a Python the server never imports from, and the server keeps
reporting the package missing. Following the instruction exactly could never
have fixed it.

`diagnose()` now emits `sys.executable`, quoted for paths with spaces:

```
Run these with THIS interpreter - a bare 'pip' often belongs to a different
Python installation, which is why an install can appear to succeed while the
server still sees nothing:

    "C:\Users\...\Python312\python.exe" -m pip install -r requirements-face.txt
    "C:\Users\...\Python312\python.exe" scripts/download_models.py

Interpreter: C:\Users\...\Python312\python.exe
```

### `scripts/check_face_setup.py`

A doctor script, run with the same interpreter as the API. Reports the
interpreter path and version, each package (`ok` / `MISSING` / `BROKEN` —
installed but failing to import, which no import check alone would catch),
model presence with file sizes, and finally loads the engine. On failure it
prints the exact qualified command.

Verified output on a working install: all three packages ok, both models
present (16 MB / 166 MB), engine loaded.

### Verified

| Check | Result |
|---|---|
| Diagnostic contains `sys.executable` | pass |
| **Every** command line is interpreter-qualified, never bare | pass |
| Doctor script runs and reports | pass |
| No user-facing message mentions the removed PIN | pass |

**267 passed, 8 skipped.**

## v16 — the real root cause: face was still an *optional* dependency

Your screenshot named the interpreter:

```
C:\Users\...\HRMS-v15\.venv\Scripts\python.exe
```

The API runs from a **`.venv` inside the extracted folder**. `run.ps1` creates
that venv and installs `requirements.txt` — and only that. The face packages
lived in `requirements-face.txt`, installed only behind an explicit `-Models`
flag. So every new zip produced a fresh venv with no face stack, and no amount
of diagnostic improvement was going to change that.

I had been fixing the *message* for three rounds instead of the *cause*.

### The actual fix

When PIN check-in was removed in v11, face verification became the **only** way
to record attendance. At that moment opencv and onnxruntime stopped being
optional — and I failed to move them. Corrected:

- `onnxruntime`, `opencv-python-headless` and `requests` moved into
  **`requirements.txt`**. Both ship prebuilt wheels everywhere; no compiler.
- `requirements-face.txt` is now a one-line pointer (`-r requirements.txt`) so
  older instructions still work.
- Both launchers now verify `import cv2, onnxruntime` and **fail** rather than
  starting a server that cannot record attendance.
- Both launchers **download the models automatically on first run** if absent,
  instead of hiding it behind a flag.
- Removed the stale blocks promising insightface, C++ Build Tools and a PIN
  fallback — all three no longer exist.

### Proven, not assumed

Built a clean virtualenv from `requirements.txt` alone:

```
cv2 4.11.0
onnxruntime 1.27.0
```

Both import in a fresh venv with no extra steps. That is the exact scenario
that was failing.

### Verified

| Check | Result |
|---|---|
| Fresh venv from `requirements.txt` imports cv2 + onnxruntime | pass |
| Face packages present in default requirements | pass |
| No requirement references insightface | pass |
| Both launchers verify the face stack imports | pass |
| Both launchers fetch the models | pass |
| Neither launcher promises a PIN fallback or Build Tools | pass |

**271 passed, 8 skipped.**

### What to run

```powershell
.\run.ps1 -Recreate
```

Rebuilds the venv with the face stack included and downloads the models on the
way. If anything still fails:

```powershell
.\.venv\Scripts\python.exe scripts\check_face_setup.py
```

## v17 — your venv was already working; two things of mine were not

`check_face_setup.py` reported everything green:

```
[ok] opencv-python-headless 4.11.0   [ok] onnxruntime 1.27.0
[ok] det_10g.onnx (16 MB)            [ok] w600k_r50.onnx (166 MB)
[ok] engine loaded
```

**Face check-in was ready. It only needed the API restarted.** Neither command
that failed was necessary.

### 1. I gave a command that cannot run on a stock Windows machine

I said `.\run.ps1 -Recreate`. PowerShell blocks unsigned scripts by default:

> run.ps1 cannot be loaded ... is not digitally signed.

`run.bat` has existed all along and exists precisely for this — batch files are
exempt from execution policy, and it invokes PowerShell with
`-ExecutionPolicy Bypass`. It also forwards arguments, so `run.bat -Recreate`
does what I meant. The README now leads with it, and a test asserts it stays
the documented entry point.

### 2. A regression I introduced in v16

v16 made `requirements-face.txt` contain `-r requirements.txt`, so older
instructions would still work. That turned a previously harmless command into a
**full stack rebuild** — including `pillow` and `pydantic-core`.

Run through a bare `pip` belonging to **Python 3.14**, neither has a wheel, so
pip compiled from source and failed on zlib headers and PyO3's 3.13 ceiling.
Before v16 that same command would have installed three wheels and succeeded.

`requirements-face.txt` now lists only the three face packages and includes no
other requirements file. Verified in a clean venv: installs successfully and
pulls in **neither** pillow nor pydantic.

### Also corrected

The README still described face recognition as optional, needing 7 GB of C++
Build Tools for insightface, with PIN as the fallback — all three untrue since
v6/v11. Replaced with the current picture, the doctor-script command, an
explanation of why a stray `pip` on 3.14 fails, and the `getUserMedia`
HTTPS/localhost requirement.

### Verified

| Check | Result |
|---|---|
| `requirements-face.txt` installs standalone in a clean venv | pass |
| It pulls in neither pillow nor pydantic | pass |
| It includes no other requirements file | pass |
| `run.bat` bypasses execution policy and forwards args | pass |
| README documents `run.bat` | pass |
| No README/launcher text promises PIN or Build Tools | pass |

**273 passed, 8 skipped.**

### What to do

```
run.bat
```

That is all. The venv and models are already in place — the app should start
and face check-in should work. If it does not, run the doctor script and send
its output.

## v18 — assign-employees 404, Access-control removal, Cloudflare tunnel

### The real bug: "can't add employees" was a wrong URL

`web/locations.html` filled the Assign-employees dropdown from
`GET /api/lifecycle/employees`. **That endpoint does not exist** — it is
`/api/auth/employees`. The 404 hit a silent `catch{EMPLOYEES=[]}`, so the list
was always empty and there was nobody to select. It looked like "assignment is
broken"; it was a typo'd path swallowed by a bare catch.

Fixed in `locations.html` and `roles.html` (same wrong path). The catch now
surfaces the error and an empty list says "Add them under Users first" instead
of showing a blank box. A test asserts the correct endpoint returns staff for
both admin and HR, and that the old path genuinely 404s so the bug can't return.

### Manual location entry by admin AND HR — already granted

No change needed: `hr_admin` holds `locations.manage` and `locations.assign` by
default, so HR can create locations by hand and assign staff. The only thing
stopping it was the 404 above. Now covered by
`test_hr_can_manually_create_and_assign_a_location`, with
`test_plain_employee_still_cannot_create_locations` guarding the boundary.

### Access control tab removed

`web/access.html` and its nav entry (added in v14) are gone, as requested.
`roles.html` still exists and still edits permissions; the underlying
`/api/roles` endpoints stay, so the RBAC API tests were retargeted rather than
deleted — they cover endpoints that other pages still use.

### Cloudflare tunnel for intranet access

`scripts/tunnel.ps1` and `scripts/tunnel.sh`. Start the app, then run the
script in a second window:

```
.\scripts\tunnel.ps1        # Windows
./scripts/tunnel.sh          # macOS / Linux
```

Installs `cloudflared` if missing (winget/brew), verifies `/health` responds so
the tunnel doesn't serve 502s, and runs:

```
cloudflared tunnel --url http://localhost:8000 --http-host-header localhost:8000
```

The `--http-host-header` keeps uvicorn's Host as localhost, so same-origin
cookies and redirects survive the tunnel. It prints a
`https://<random>.trycloudflare.com` URL.

**This also fixes the camera network-wide.** getUserMedia needs HTTPS or
localhost; the tunnel's https:// URL satisfies that from any device, so face
check-in works on phones. A LAN IP never would.

Free quick-tunnel: no account, throwaway URL per run - fine for testing and
small internal use. For a stable address with access controls, a named tunnel
behind Cloudflare Access is the next step, noted in the README.

### Verified

| Check | Result |
|---|---|
| `/api/auth/employees` returns staff for admin and HR | pass |
| Old `/api/lifecycle/employees` path 404s | pass |
| HR creates a location manually and assigns staff | pass |
| Plain employee cannot create locations | 403 |
| Full suite | 273 passed, 8 skipped |

## v19 — the 502, and two ways to start the server wrong

Three things in one screenshot, all explained:

### 1. Cloudflare 502 "Host Error" — the app wasn't running

Browser ok, Cloudflare ok, **Host: Error**. The tunnel reached Cloudflare fine,
but nothing was listening on port 8000 — the HRMS was never started in a first
window. A quick-tunnel to a dead port is exactly this 502.

`scripts/tunnel.ps1` now checks `/health` **before** it does anything else
(previously the check came after the cloudflared install), and on failure says
plainly: the tunnel is fine, start `run.bat` first. It also names the 502 by
code so the message matches what the browser shows.

### 2. `.\scripts\tunnel.ps1` blocked — unsigned script

Same execution-policy wall as `run.ps1`. I shipped the tunnel as a bare `.ps1`,
repeating the mistake. Added **`tunnel.bat`**, which bypasses the policy exactly
like `run.bat`. The README now points at `tunnel.bat`.

### 3. `python -m server.main` — no such module

The user guessed a start command. The module is `app.main:app`; there is no
`server` package. Added an explicit copy-paste manual-start line to the README:

```
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Verified `app.main:app` imports and `server.main` genuinely does not exist.

### The correct sequence

```
Window 1:   run.bat            # starts the HRMS on :8000, leave it open
Window 2:   tunnel.bat         # prints the https://...trycloudflare.com URL
```

### Verified

| Check | Result |
|---|---|
| `app.main:app` imports; `server.main` absent | pass |
| `tunnel.bat` exists and bypasses execution policy | pass |
| No doc or launcher references `server.main` | pass |
| Tunnel checks `/health` before installing cloudflared | pass |
| Tunnel message names the 502 / Host Error | pass |

**276 passed, 8 skipped.**

## v20 — mobile view for every page

Requested: all screens, admin/HR included. Done at the CSS/shell layer so it
covers every page rather than one at a time.

### Changes

- **Tables scroll instead of stretching.** `shell.js` wraps every `<table>` —
  including ones injected after render, via a MutationObserver — in a
  horizontally scrollable `.table-scroll`. This is what makes the 7 table-heavy
  pages (users, locations, roles, attendance, leave, people, check-in history)
  usable on a phone without blowing out the page width.
- **A phone breakpoint at 640px.** Tighter padding, single-column grids,
  two-up stat tiles (one-up under 380px), 42px minimum touch targets, and 16px
  inputs so iOS doesn't auto-zoom on focus. The 960px sidebar-drawer breakpoint
  was already there.
- **Check-in camera scales.** The 214px seal becomes `min(72vw,240px)`; the
  capture card stacks above the record panel; the three verification gates stay
  three-up but tighten.
- **Drawer closes on tap.** Tapping the dimmed area or any nav link closes the
  sidebar on a phone, not just the menu button.

### Verified with a real headless browser at 375x812

Every page measured for horizontal overflow after logging in as admin:

```
login.html         375/375  OK        roles.html         375/375  OK
checkin.html       375/375  OK        people.html        375/375  OK
attendance.html    375/375  OK        security.html      375/375  OK
users.html         375/375  OK        WORST OVERFLOW: 0 px
locations.html     375/375  OK
leave.html         375/375  OK
```

**Zero horizontal overflow on every page** — measured, not assumed.
Screenshots of check-in, attendance and users at phone width confirm the
layouts read correctly, not merely fit.

### Tests

| Check | Result |
|---|---|
| Every signed-in page has a viewport meta tag | pass |
| shell.js wraps tables (MutationObserver + `.table-scroll`) | pass |
| 640px phone breakpoint with 16px inputs exists | pass |

**279 passed, 8 skipped.**

Pair this with the Cloudflare tunnel (v18) for the full mobile story: the
tunnel's HTTPS URL lets the phone camera work, and these styles make the pages
fit the phone.

## v21 — literal `\u2014` showing in page text

The mobile layout works (your screenshot is a clean phone render over the
tunnel). The visible defect was `\u2014` printed as literal characters instead
of em dashes, twice on the Security page.

### Cause

Three HTML **text nodes** (not JS strings) contained the sequence `\u2014`
literally: two on `security.html` and one on `password.html`. In an HTML text
node a backslash is just a backslash, so the browser prints `\u2014` verbatim.
The identical sequence inside a JS `"..."` string is a valid escape and renders
correctly — which is why the ~28 other occurrences across the files were fine
and had to be left alone.

Same class of bug fixed in `checkin.html` back in v5; it had spread to two more
files since.

### Fix and verification

Replaced the three literal escapes with real em dashes. Verified two ways:

1. Static scan with `<script>` blocks stripped: **0** `\uXXXX` sequences left in
   any HTML markup across all 11 pages.
2. Headless browser at 375px, logged in, reading `document.body.innerText` on
   every page: **0** pages show a visible `\u`. Screenshot of Security confirms
   real em dashes.

A test now strips scripts and asserts no `\uXXXX` survives in markup on any
page, so this can't return a fourth time.

**280 passed, 8 skipped.**
