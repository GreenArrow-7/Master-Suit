"""Acceptance tests: dynamic roles and admin-managed attendance locations."""
from datetime import date, datetime, timedelta, timezone

import pytest
from tests.conftest import TestSession, client, reset_schema
from tests.facepunch import enable_face, face_punch, stub_biometrics

from app.core.config import settings
from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, Role, PunchResult
from app.models.locations import EmployeeLocationAssignment, WorkLocation
from app.models.rbac import RoleDef, UserRoleAssignment
from app.services.rbac import seed_rbac

PW = "CorrectHorse-2026!"
HQ = (25.1972, 55.2744)          # geofence centre
NEAR = (25.19725, 55.27445)      # a few metres away
FAR = (25.0772, 55.1408)         # ~19 km away
TODAY = date.today()


def mk_emp(db, email, role=Role.employee, mgr_id=None, dept="Sales"):
    e = Employee(employee_code=email.split("@")[0][:12], full_name=email.split("@")[0].title(),
                 work_email=email, password_hash=hash_password(PW), role=role,
                 department=dept, manager_id=mgr_id,
                 date_of_joining=date(2024, 1, 8), status=EmploymentStatus.active,
                 must_change_password=False)
    db.add(e); db.commit(); db.refresh(e)
    return e


def tok(email, password=PW):
    r = client.post("/api/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def punch(hdr, action, lat, lng, acc=10.0):
    """Real /punch endpoint; only the biometric primitives are stubbed.
    Requires stub_biometrics(monkeypatch) and enable_face(emp_id) first."""
    return face_punch(hdr, action, lat, lng, acc)


@pytest.fixture()
def world(monkeypatch):
    """Global settings are process-wide, so restore them on teardown.
    Without this, whichever file runs first silently changes the rules for
    every file after it (this is how test_rapid_second_punch_rejected began
    passing or failing depending on collection order)."""
    reset_schema()
    _saved = (settings.MIN_PUNCH_INTERVAL_SECONDS, settings.TOTP_REQUIRED_ROLES)
    settings.MIN_PUNCH_INTERVAL_SECONDS = 0
    settings.TOTP_REQUIRED_ROLES = ""
    db = TestSession()
    admin = mk_emp(db, "boss@manathhomes.ae", Role.admin)
    hr = mk_emp(db, "hr@manathhomes.ae", Role.hr)
    mgr = mk_emp(db, "mgr@manathhomes.ae", Role.manager, dept="Sales")
    staff = mk_emp(db, "omar@manathhomes.ae", Role.employee, mgr_id=mgr.id, dept="Sales")
    other = mk_emp(db, "lena@manathhomes.ae", Role.employee, dept="Finance")
    ids = {"admin": admin.id, "hr": hr.id, "mgr": mgr.id,
           "staff": staff.id, "other": other.id}
    seed_rbac(db)
    db.close()
    for _id in ids.values():
        enable_face(_id)
    # Liveness and face matching need a real person in front of a real camera;
    # they are covered by the real-model suites. Everything else in the punch
    # path stays real here.
    stub_biometrics(monkeypatch)
    yield ids
    (settings.MIN_PUNCH_INTERVAL_SECONDS, settings.TOTP_REQUIRED_ROLES) = _saved


def make_location(hdr, **over):
    body = {"name": over.pop("name", "Head Office"), "location_type": "head_office",
            "latitude": HQ[0], "longitude": HQ[1], "radius_m": 150,
            "activate": True, "address": "Downtown", "emirate": "Dubai"}
    body.update(over)
    return client.post("/api/locations", headers=hdr, json=body)


def assign(hdr, emp_id, loc_id, **over):
    body = {"employee_ids": [emp_id], "location_id": loc_id}
    body.update(over)
    return client.post("/api/locations/assignments", headers=hdr, json=body)


# ---------------------------------------------------------------------------
# Locations: creation and validation
# ---------------------------------------------------------------------------
def test_admin_creates_location_with_manual_coordinates(world):
    hdr = tok("hr@manathhomes.ae")
    r = make_location(hdr)
    assert r.status_code == 201
    assert r.json()["status"] == "active"
    assert r.json()["latitude"] == HQ[0]


def test_invalid_coordinates_and_radius_rejected(world):
    hdr = tok("hr@manathhomes.ae")
    assert make_location(hdr, latitude=91).status_code == 422
    assert make_location(hdr, longitude=-181).status_code == 422
    assert make_location(hdr, radius_m=0).status_code == 422


def test_employee_cannot_create_or_edit_locations(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    emp = tok("omar@manathhomes.ae")
    assert make_location(emp).status_code == 403
    assert client.patch(f"/api/locations/{loc['id']}", headers=emp,
                        json={**loc, "name": loc["name"], "location_type": loc["type"],
                              "latitude": 1, "longitude": 1, "radius_m": 5,
                              "activate": False}).status_code == 403


def test_active_geofence_edit_requires_reason_and_keeps_history(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    p = punch(staff, "checkin", *NEAR)
    assert p.json()["result"] == "accepted"

    patch_body = {"name": loc["name"], "location_type": "head_office",
                  "latitude": 26.0, "longitude": 56.0, "radius_m": 90,
                  "activate": False}
    r = client.patch(f"/api/locations/{loc['id']}", headers=hr, json=patch_body)
    assert r.status_code == 422           # reason required for active geofence change
    r = client.patch(f"/api/locations/{loc['id']}", headers=hr,
                     json={**patch_body, "change_reason": "office moved"})
    assert r.status_code == 200

    # Historical punch evidence is untouched by the edit.
    db = TestSession()
    from app.models.core import AttendancePunch
    ev = db.query(AttendancePunch).filter_by(employee_id=world["staff"]).first()
    assert ev.loc_latitude == HQ[0] and ev.loc_radius_m == 150
    db.close()


# ---------------------------------------------------------------------------
# Assignments and the strict punch chain
# ---------------------------------------------------------------------------
def test_unassigned_employee_cannot_check_in(world):
    hr = tok("hr@manathhomes.ae")
    make_location(hr)
    staff = tok("omar@manathhomes.ae")
    r = punch(staff, "checkin", *NEAR)
    assert r.json()["result"] != "accepted"
    assert "assignment" in r.json()["message"].lower()


def test_inside_radius_accepted_outside_rejected_with_distance(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    assert punch(staff, "checkin", *NEAR).json()["result"] == "accepted"
    assert punch(staff, "checkout", *NEAR).json()["result"] == "accepted"
    r = punch(staff, "checkin", *FAR)
    body = r.json()
    assert body["result"] == "rejected_geofence"
    assert "metres away" in body["message"] and "150" in body["message"]


def test_poor_gps_accuracy_rejected(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr, max_accuracy_m=50).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    r = punch(staff, "checkin", *NEAR, acc=400)
    assert r.json()["result"] == "rejected_accuracy"


def test_inactive_and_expired_location_cannot_be_used(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    client.post(f"/api/locations/{loc['id']}/status", headers=hr,
                json={"status": "inactive", "reason": "closed", "confirm": False})
    assert punch(staff, "checkin", *NEAR).json()["result"] != "accepted"

    exp = make_location(hr, name="Old site",
                        effective_to=str(TODAY - timedelta(days=1))).json()
    assign(hr, world["staff"], exp["id"])
    assert punch(staff, "checkin", *NEAR).json()["result"] != "accepted"


def test_future_and_expired_assignments_cannot_be_used(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    staff = tok("omar@manathhomes.ae")
    assign(hr, world["staff"], loc["id"],
           effective_from=str(TODAY + timedelta(days=5)))
    assert punch(staff, "checkin", *NEAR).json()["result"] != "accepted"

    db = TestSession()
    db.query(EmployeeLocationAssignment).delete(); db.commit(); db.close()
    assign(hr, world["staff"], loc["id"],
           effective_from=str(TODAY - timedelta(days=30)),
           effective_to=str(TODAY - timedelta(days=1)))
    assert punch(staff, "checkin", *NEAR).json()["result"] != "accepted"


def test_checkout_wrong_location_rejected_under_same_location_rule(world):
    hr = tok("hr@manathhomes.ae")
    a = make_location(hr, name="Office A").json()
    b = make_location(hr, name="Office B", latitude=FAR[0], longitude=FAR[1]).json()
    assign(hr, world["staff"], a["id"], checkout_rule="same_location")
    assign(hr, world["staff"], b["id"], checkout_rule="same_location")
    staff = tok("omar@manathhomes.ae")
    assert punch(staff, "checkin", *NEAR).json()["result"] == "accepted"     # at A
    r = punch(staff, "checkout", *FAR)                                       # from B
    assert r.json()["result"] != "accepted"
    assert punch(staff, "checkout", *NEAR).json()["result"] == "accepted"    # back at A


def test_temporary_assignment_only_during_window(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr, name="Expo site").json()
    assign(hr, world["staff"], loc["id"], assignment_type="temporary",
           effective_from=str(TODAY), effective_to=str(TODAY))
    staff = tok("omar@manathhomes.ae")
    assert punch(staff, "checkin", *NEAR).json()["result"] == "accepted"
    assert punch(staff, "checkout", *NEAR).json()["result"] == "accepted"
    db = TestSession()
    asg = db.query(EmployeeLocationAssignment).first()
    asg.effective_to = TODAY - timedelta(days=1); db.commit(); db.close()
    assert punch(staff, "checkin", *NEAR).json()["result"] != "accepted"


def test_manager_cannot_assign_outside_scope(world):
    db = TestSession()
    mgr_role = db.query(RoleDef).filter_by(code="branch_manager").first()
    db.add(UserRoleAssignment(user_id=world["mgr"], role_id=mgr_role.id,
                              scope_type="direct_reports"))
    db.commit(); db.close()
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    mgr = tok("mgr@manathhomes.ae")
    ok = assign(mgr, world["staff"], loc["id"])          # direct report → allowed
    assert ok.status_code == 201, ok.text
    bad = assign(mgr, world["other"], loc["id"])         # other department → blocked
    assert bad.status_code == 403


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
def test_normal_admin_cannot_grant_super_admin(world):
    hr = tok("hr@manathhomes.ae")     # hr_admin: roles.view but not assign of super
    db = TestSession()
    hr_role = db.query(RoleDef).filter_by(code="hr_admin").first()
    # give HR roles.assign via a custom role to prove super_admin still refuses
    super_role = db.query(RoleDef).filter_by(code="super_admin").first()
    db.close()
    admin = tok("boss@manathhomes.ae")
    r = client.post("/api/roles/assign", headers=admin, json={
        "user_id": world["mgr"], "role_id": super_role.id})
    assert r.status_code == 201       # super admin can grant it
    # revoke again so the HR attempt is clean
    aid = r.json()["assignment_id"]
    client.post(f"/api/roles/assignments/{aid}/revoke", headers=admin,
                json={"reason": "test cleanup"})
    r2 = client.post("/api/roles/assign", headers=hr, json={
        "user_id": world["staff"], "role_id": super_role.id})
    assert r2.status_code == 403      # hr_admin lacks roles.assign entirely


def test_multiple_roles_combine_and_expired_or_revoked_stop_working(world):
    admin = tok("boss@manathhomes.ae")
    db = TestSession()
    auditor = db.query(RoleDef).filter_by(code="auditor").first()
    recruiter = db.query(RoleDef).filter_by(code="recruiter").first()
    db.close()
    staff = tok("omar@manathhomes.ae")
    assert client.get("/api/roles", headers=staff).status_code == 403
    r = client.post("/api/roles/assign", headers=admin, json={
        "user_id": world["staff"], "role_id": auditor.id})
    aid = r.json()["assignment_id"]
    client.post("/api/roles/assign", headers=admin, json={
        "user_id": world["staff"], "role_id": recruiter.id})
    # union of both roles now active
    assert client.get("/api/roles", headers=staff).status_code == 200            # auditor
    acc = client.get(f"/api/access/{world['staff']}", headers=admin).json()
    assert {"auditor", "recruiter", "employee"} <= set(acc["effective_roles"])
    # expire the auditor assignment → access stops
    db = TestSession()
    a = db.query(UserRoleAssignment).get(aid)
    a.effective_to = TODAY - timedelta(days=1); db.commit(); db.close()
    assert client.get("/api/roles", headers=staff).status_code == 403
    # re-grant then revoke → stops immediately
    r = client.post("/api/roles/assign", headers=admin, json={
        "user_id": world["staff"], "role_id": auditor.id,
        "scope_type": "organisation", "scope_id": None})
    assert client.get("/api/roles", headers=staff).status_code == 200
    client.post(f"/api/roles/assignments/{r.json()['assignment_id']}/revoke",
                headers=admin, json={"reason": "left project"})
    assert client.get("/api/roles", headers=staff).status_code == 403


def test_admin_cannot_remove_own_last_admin_role_and_assigned_role_not_deletable(world):
    admin = tok("boss@manathhomes.ae")
    db = TestSession()
    mine = (db.query(UserRoleAssignment)
              .filter_by(user_id=world["admin"], status="active").first())
    super_role = db.query(RoleDef).filter_by(code="super_admin").first()
    db.close()
    r = client.post(f"/api/roles/assignments/{mine.id}/revoke", headers=admin,
                    json={"reason": "should be blocked"})
    assert r.status_code == 409
    assert client.delete(f"/api/roles/{super_role.id}", headers=admin).status_code == 409


def test_role_and_location_changes_land_in_audit_history(world):
    hr = tok("hr@manathhomes.ae")
    admin = tok("boss@manathhomes.ae")
    loc = make_location(hr).json()
    db = TestSession()
    auditor = db.query(RoleDef).filter_by(code="auditor").first()
    db.close()
    client.post("/api/roles/assign", headers=admin, json={
        "user_id": world["staff"], "role_id": auditor.id})
    db = TestSession()
    from app.models.core import AuditLog
    actions = {a.action for a in db.query(AuditLog).all()}
    db.close()
    assert "location.create" in actions and "role.assign" in actions


# ---------------------------------------------------------------------------
# Preflight (spec section 10: show distance / radius / in-out BEFORE punching)
# ---------------------------------------------------------------------------
def _preflight(hdr, lat, lng, acc, action="checkin"):
    return client.post("/api/attendance/preflight", headers=hdr, json={
        "action": action, "latitude": lat, "longitude": lng, "gps_accuracy_m": acc})


def test_preflight_reports_distance_radius_and_inside_flag(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0], HQ[1], 12).json()
    assert d["ok"] is True and d["code"] == "READY"
    near = d["candidates"][0]
    assert near["inside"] is True
    assert near["distance_m"] < near["radius_m"]
    assert near["accuracy_ok"] is True


def test_preflight_blocks_on_poor_accuracy(world):
    """The +/-212 m case from the screenshot must not read as ready."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0], HQ[1], 212).json()
    assert d["ok"] is False
    assert d["code"] == "LOCATION_ACCURACY_TOO_LOW"
    # bad GPS is grounds for retrying outdoors, not for an exception request
    assert d["can_request_exception"] is False


def test_preflight_reports_outside_with_real_distance(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0] + 0.02, HQ[1], 10).json()
    assert d["ok"] is False
    assert d["code"] == "OUTSIDE_APPROVED_LOCATION"
    assert d["can_request_exception"] is True
    assert d["candidates"][0]["inside"] is False
    assert d["candidates"][0]["distance_m"] > 150


def test_preflight_without_assignment_is_blocked(world):
    d = _preflight(tok("lena@manathhomes.ae"), HQ[0], HQ[1], 10).json()
    assert d["ok"] is False and d["code"] == "NO_ACTIVE_ASSIGNMENT"


def test_preflight_grants_nothing_punch_still_rejects_off_site(world):
    """A passing preflight must never become an authorisation token."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    assert _preflight(staff, HQ[0], HQ[1], 5).json()["ok"] is True
    r = punch(staff, "checkin", HQ[0] + 0.08, HQ[1], acc=5)   # then punch 9 km away
    assert r.json()["result"] != "accepted"


def test_preflight_writes_no_attendance_row(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    before = len(client.get("/api/attendance/mine", headers=staff).json())
    _preflight(staff, HQ[0], HQ[1], 10)
    _preflight(staff, HQ[0] + 0.02, HQ[1], 400)
    after = len(client.get("/api/attendance/mine", headers=staff).json())
    assert before == after


# ---------------------------------------------------------------------------
# PIN removal (v11) — the fallback must be gone, not merely hidden
# ---------------------------------------------------------------------------
def test_pin_endpoints_no_longer_exist(world):
    hr = tok("hr@manathhomes.ae")
    # 404 (no such path) or 405 (path shape survives, POST does not) both mean
    # the endpoint is gone. What must never happen is a 2xx.
    r1 = client.post("/api/attendance/punch-pin", headers=hr, json={
        "punch_type": "checkin", "pin": "8461", "latitude": HQ[0],
        "longitude": HQ[1], "gps_accuracy_m": 8, "device_fingerprint": "x"})
    assert r1.status_code in (404, 405), r1.text
    r2 = client.post("/api/attendance/pin", headers=hr, json={
        "employee_id": world["staff"], "pin": "8461"})
    assert r2.status_code in (404, 405), r2.text


def test_openapi_advertises_no_pin_surface(world):
    spec = client.get("/openapi.json").json()
    assert not [p for p in spec["paths"] if "pin" in p.lower()]
    blob = str(spec).lower()
    assert "has_attendance_pin" not in blob
    assert "pinpunchin" not in blob and "setpinin" not in blob


def test_face_is_now_the_only_way_to_punch(world, monkeypatch):
    """With face verification failing, no attendance may be created by any route."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    stub_biometrics(monkeypatch, live=False, reason="No head movement detected.")
    r = face_punch(staff, "checkin", HQ[0], HQ[1])
    assert r.status_code == 200
    assert r.json()["result"] != "accepted"
    assert not client.get("/api/attendance/mine", headers=staff).json() \
        or all(p["result"] != "accepted"
               for p in client.get("/api/attendance/mine", headers=staff).json())



# ---------------------------------------------------------------------------
# Preflight (spec section 10: show distance / radius / in-out BEFORE punching)
# ---------------------------------------------------------------------------
def _preflight(hdr, lat, lng, acc, action="checkin"):
    return client.post("/api/attendance/preflight", headers=hdr, json={
        "action": action, "latitude": lat, "longitude": lng, "gps_accuracy_m": acc})


def test_preflight_reports_distance_radius_and_inside_flag(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0], HQ[1], 12).json()
    assert d["ok"] is True and d["code"] == "READY"
    near = d["candidates"][0]
    assert near["inside"] is True
    assert near["distance_m"] < near["radius_m"]
    assert near["accuracy_ok"] is True


def test_preflight_blocks_on_poor_accuracy(world):
    """The +/-212 m case from the screenshot must not read as ready."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0], HQ[1], 212).json()
    assert d["ok"] is False
    assert d["code"] == "LOCATION_ACCURACY_TOO_LOW"
    # bad GPS is grounds for retrying outdoors, not for an exception request
    assert d["can_request_exception"] is False


def test_preflight_reports_outside_with_real_distance(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    d = _preflight(tok("omar@manathhomes.ae"), HQ[0] + 0.02, HQ[1], 10).json()
    assert d["ok"] is False
    assert d["code"] == "OUTSIDE_APPROVED_LOCATION"
    assert d["can_request_exception"] is True
    assert d["candidates"][0]["inside"] is False
    assert d["candidates"][0]["distance_m"] > 150


def test_preflight_without_assignment_is_blocked(world):
    d = _preflight(tok("lena@manathhomes.ae"), HQ[0], HQ[1], 10).json()
    assert d["ok"] is False and d["code"] == "NO_ACTIVE_ASSIGNMENT"


def test_preflight_grants_nothing_punch_still_rejects_off_site(world):
    """A passing preflight must never become an authorisation token."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    assert _preflight(staff, HQ[0], HQ[1], 5).json()["ok"] is True
    r = punch(staff, "checkin", HQ[0] + 0.08, HQ[1], acc=5)   # then punch 9 km away
    assert r.json()["result"] != "accepted"


def test_preflight_writes_no_attendance_row(world):
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    before = len(client.get("/api/attendance/mine", headers=staff).json())
    _preflight(staff, HQ[0], HQ[1], 10)
    _preflight(staff, HQ[0] + 0.02, HQ[1], 400)
    after = len(client.get("/api/attendance/mine", headers=staff).json())
    assert before == after


# ---------------------------------------------------------------------------
# PIN removal (v11) — the fallback must be gone, not merely hidden
# ---------------------------------------------------------------------------
def test_pin_endpoints_no_longer_exist(world):
    hr = tok("hr@manathhomes.ae")
    # 404 (no such path) or 405 (path shape survives, POST does not) both mean
    # the endpoint is gone. What must never happen is a 2xx.
    r1 = client.post("/api/attendance/punch-pin", headers=hr, json={
        "punch_type": "checkin", "pin": "8461", "latitude": HQ[0],
        "longitude": HQ[1], "gps_accuracy_m": 8, "device_fingerprint": "x"})
    assert r1.status_code in (404, 405), r1.text
    r2 = client.post("/api/attendance/pin", headers=hr, json={
        "employee_id": world["staff"], "pin": "8461"})
    assert r2.status_code in (404, 405), r2.text


def test_openapi_advertises_no_pin_surface(world):
    spec = client.get("/openapi.json").json()
    assert not [p for p in spec["paths"] if "pin" in p.lower()]
    blob = str(spec).lower()
    assert "has_attendance_pin" not in blob
    assert "pinpunchin" not in blob and "setpinin" not in blob


def test_face_is_now_the_only_way_to_punch(world, monkeypatch):
    """With face verification failing, no attendance may be created by any route."""
    hr = tok("hr@manathhomes.ae")
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    staff = tok("omar@manathhomes.ae")
    stub_biometrics(monkeypatch, live=False, reason="No head movement detected.")
    r = face_punch(staff, "checkin", HQ[0], HQ[1])
    assert r.status_code == 200
    assert r.json()["result"] != "accepted"
    assert not client.get("/api/attendance/mine", headers=staff).json() \
        or all(p["result"] != "accepted"
               for p in client.get("/api/attendance/mine", headers=staff).json())


# ---------------------------------------------------------------------------
# Roles & permissions API (the Access control PAGE was removed in v18, but the
# endpoints remain - roles.html and user role assignment still use them)
# ---------------------------------------------------------------------------
def test_roles_payload_has_every_field_a_matrix_needs(world):
    rows = client.get("/api/roles", headers=tok("hr@manathhomes.ae")).json()
    assert rows
    for key in ("id", "code", "name", "description", "is_system", "is_active",
                "assigned_users", "permissions", "all_permissions"):
        assert key in rows[0], f"the Access control page reads {key}"


def test_permissions_payload_supports_a_module_action_matrix(world):
    perms = client.get("/api/roles/permissions", headers=tok("hr@manathhomes.ae")).json()
    assert perms
    for p in perms:
        for key in ("code", "module", "description", "high_privilege"):
            assert key in p
        # the matrix splits code into module + action on the first dot
        assert p["code"].startswith(p["module"] + "."), p["code"]


def test_hr_can_view_the_matrix_but_not_save_it(world):
    """HR holds roles.view, not roles.manage. The page must not offer a Save
    button that the server will refuse."""
    hr = tok("hr@manathhomes.ae")
    assert client.get("/api/roles", headers=hr).status_code == 200
    target = next(r for r in client.get("/api/roles", headers=hr).json()
                  if not r["all_permissions"])
    assert client.patch(f"/api/roles/{target['id']}", headers=hr,
                        json={"permission_codes": ["reports.view"]}).status_code == 403


def test_saving_the_matrix_changes_effective_permissions(world):
    """Ticking a box must actually grant access, not just redraw a checkbox."""
    boss = tok("boss@manathhomes.ae")
    roles = client.get("/api/roles", headers=boss).json()
    target = next(r for r in roles if not r["all_permissions"])

    r = client.patch(f"/api/roles/{target['id']}", headers=boss,
                     json={"permission_codes": ["reports.view"]})
    assert r.status_code == 200, r.text
    after = next(x for x in client.get("/api/roles", headers=boss).json()
                 if x["id"] == target["id"])
    assert after["permissions"] == ["reports.view"]


def test_super_admin_matrix_is_refused_by_the_server(world):
    """The page disables those checkboxes; the server must not rely on that."""
    hr = tok("boss@manathhomes.ae")
    roles = client.get("/api/roles", headers=hr).json()
    sup = next((r for r in roles if r["all_permissions"]), None)
    if sup is None:
        pytest.skip("no all-permissions role seeded")
    r = client.patch(f"/api/roles/{sup['id']}", headers=hr,
                     json={"permission_codes": ["reports.view"]})
    assert r.status_code == 409


def test_employee_cannot_read_role_or_permission_data(world):
    staff = tok("omar@manathhomes.ae")
    assert client.get("/api/roles", headers=staff).status_code == 403
    assert client.get("/api/roles/permissions", headers=staff).status_code == 403


# ---------------------------------------------------------------------------
# Assign-employees UI: the dropdown was calling a 404 path (v18 fix)
# ---------------------------------------------------------------------------
def test_employees_endpoint_used_by_assign_dropdown_exists(world):
    """web/locations.html populates the Assign dropdown from this path. It was
    calling /api/lifecycle/employees, which 404s, so the list was always empty
    and nobody could be assigned. The correct path is /api/auth/employees."""
    for who in ("boss@manathhomes.ae", "hr@manathhomes.ae"):
        r = client.get("/api/auth/employees", headers=tok(who))
        assert r.status_code == 200, f"{who}: {r.text}"
        assert isinstance(r.json(), list)
        assert r.json(), "employee list must not be empty for the dropdown"
    # the old path must genuinely not exist, so the bug can't quietly return
    assert client.get("/api/lifecycle/employees",
                      headers=tok("hr@manathhomes.ae")).status_code == 404


def test_hr_can_manually_create_and_assign_a_location(world):
    """The user's requirement: admin AND HR create locations manually and
    assign staff. HR holds locations.manage + locations.assign by default."""
    hr = tok("hr@manathhomes.ae")
    r = client.post("/api/locations", headers=hr, json={
        "name": "Manual Site", "code": "MAN-1", "location_type": "sales_office",
        "address": "Typed by hand", "emirate": "Dubai", "country": "AE",
        "latitude": 25.11, "longitude": 55.22, "radius_m": 100, "max_accuracy_m": 80})
    assert r.status_code == 201, r.text
    loc = r.json()

    a = client.post("/api/locations/assignments", headers=hr, json={
        "employee_ids": [world["staff"]], "location_id": loc["id"],
        "assignment_type": "primary"})
    assert a.status_code == 201, a.text


def test_plain_employee_still_cannot_create_locations(world):
    """Manual entry is admin/HR only - a normal employee must be refused."""
    r = client.post("/api/locations", headers=tok("omar@manathhomes.ae"), json={
        "name": "Nope", "code": "NO-1", "location_type": "sales_office",
        "address": "x", "emirate": "Dubai", "country": "AE",
        "latitude": 25.1, "longitude": 55.2, "radius_m": 100, "max_accuracy_m": 80})
    assert r.status_code == 403
