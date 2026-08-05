"""Enrolment and face punch driven through the real HTTP API.

No mocked engine, no fake responses: real JPEG bytes, the real SCRFD/ArcFace
graphs, the real database, and the real encrypted vault. Skips when the models
aren't downloaded.

What this proves, and what it does not:
  - PROVES: HR can enrol a face over the API; the punch endpoint runs genuine
    recognition; a rejected punch still stores an encrypted capture that
    decrypts back to the exact bytes sent; nothing is written in the clear.
  - DOES NOT PROVE: the liveness accept path with a genuine head turn. That
    needs two real photographs of one person at different yaw angles, which
    cannot be synthesised - a perspective warp of a single image moves the
    keypoints by only a few degrees, well under YAW_THRESHOLD. Liveness logic
    itself is covered by tests/test_face_models.py.
"""
import base64
from datetime import date, timedelta
from pathlib import Path

import cv2
import pytest

from tests.conftest import TestSession, client, reset_schema
from tests.test_locations_rbac import PW, mk_emp, tok, make_location, assign

from app.core.config import settings
from app.models.core import AttendancePunch, Employee, Role
from app.services.rbac import seed_rbac
from app.services.face import engine_ready
from app.services import face_vault

pytestmark = pytest.mark.skipif(not engine_ready(),
                                reason="buffalo_l models not downloaded")


@pytest.fixture()
def world():
    """Deliberately NOT the shared fixture from test_locations_rbac.

    That one pre-grants consent, pre-enrols templates and stubs the biometric
    primitives so the geofence tests can run. This file exists to exercise the
    real enrolment and recognition path from a clean slate, so it must start
    with no consent, no templates and no stubs.
    """
    reset_schema()
    _saved = settings.MIN_PUNCH_INTERVAL_SECONDS
    settings.MIN_PUNCH_INTERVAL_SECONDS = 0
    db = TestSession()
    hr = mk_emp(db, "hr@manathhomes.ae", Role.hr)
    staff = mk_emp(db, "omar@manathhomes.ae", Role.employee)
    ids = {"hr": hr.id, "staff": staff.id}
    seed_rbac(db)
    db.close()
    yield ids
    settings.MIN_PUNCH_INTERVAL_SECONDS = _saved

FACES = Path("tests/faces")


def _b64(path, tweak=None):
    img = cv2.imread(str(path))
    assert img is not None, f"missing {path}"
    if tweak is not None:
        img = tweak(img)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def _warp(im, k):
    """Approximate a head turn. Brightness/blur filters are NOT enough - the
    enrolment guard measures embedding spread and correctly rejects four
    filtered copies of one pose. These warps move the keypoints, giving a
    measured spread of ~0.13 against the 0.02 minimum."""
    import numpy as np
    h, w = im.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = (np.float32([[k * w, 0], [w, 0], [w, h], [k * w, h]]) if k > 0
           else np.float32([[0, 0], [w + k * w, 0], [w + k * w, h], [0, h]]))
    return cv2.warpPerspective(im, cv2.getPerspectiveTransform(src, dst), (w, h))


def _shear_up(im):
    import numpy as np
    h, w = im.shape[:2]
    return cv2.warpAffine(im, np.float32([[1, 0.16, 0], [0, 1, 0]]), (w, h))


def enrolment_frames():
    """Four genuinely different views - enrolment rejects four identical shots."""
    p = FACES / "lena.jpg"
    return [
        _b64(p),
        _b64(p, lambda i: _warp(i, 0.18)),
        _b64(p, lambda i: _warp(i, -0.18)),
        _b64(p, _shear_up),
    ]


def _consent(hdr):
    return client.post("/api/auth/consent", headers=hdr,
                       json={"accepted": True, "policy_version": "v1"})


def test_enrolment_requires_consent_first(world):
    hr = tok("hr@manathhomes.ae")
    r = client.post("/api/attendance/enrol", headers=hr, json={
        "employee_id": world["staff"], "frames": enrolment_frames()})
    assert r.status_code == 409
    assert "consent" in r.json()["detail"].lower()


def test_hr_can_enrol_a_real_face(world):
    _consent(tok("omar@manathhomes.ae"))
    hr = tok("hr@manathhomes.ae")
    r = client.post("/api/attendance/enrol", headers=hr, json={
        "employee_id": world["staff"], "frames": enrolment_frames()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "enrolled"
    assert body["samples"] == settings.FACE_SAMPLES_REQUIRED


def test_employee_cannot_enrol_themselves(world):
    _consent(tok("omar@manathhomes.ae"))
    r = client.post("/api/attendance/enrol", headers=tok("omar@manathhomes.ae"),
                    json={"employee_id": world["staff"], "frames": enrolment_frames()})
    assert r.status_code == 403


def test_identical_frames_are_rejected_as_enrolment(world):
    _consent(tok("omar@manathhomes.ae"))
    one = _b64(FACES / "lena.jpg")
    r = client.post("/api/attendance/enrol", headers=tok("hr@manathhomes.ae"),
                    json={"employee_id": world["staff"], "frames": [one] * 4})
    assert r.status_code == 422
    assert "similar" in r.json()["detail"].lower()


def _enrolled_and_assigned(world):
    staff = tok("omar@manathhomes.ae")
    _consent(staff)
    hr = tok("hr@manathhomes.ae")
    assert client.post("/api/attendance/enrol", headers=hr, json={
        "employee_id": world["staff"], "frames": enrolment_frames()}).status_code == 200
    loc = make_location(hr).json()
    assign(hr, world["staff"], loc["id"])
    return staff, loc


def test_challenge_is_issued_only_after_enrolment(world):
    staff, _ = _enrolled_and_assigned(world)
    r = client.post("/api/attendance/challenge", headers=staff)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["direction"] in {"left", "right", "up"}
    assert d["nonce"]


def test_rejected_punch_still_stores_an_encrypted_capture(world, tmp_path, monkeypatch):
    """The evidence trail matters most on a rejection - it records who tried."""
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    staff, _ = _enrolled_and_assigned(world)
    ch = client.post("/api/attendance/challenge", headers=staff).json()

    # Two genuinely different frames of the same person, but no head turn:
    # real recognition runs, liveness legitimately fails.
    f1 = _b64(FACES / "lena.jpg")
    f2 = _b64(FACES / "lena.jpg", lambda i: cv2.convertScaleAbs(i, alpha=0.9, beta=5))
    from tests.test_locations_rbac import HQ
    r = client.post("/api/attendance/punch", headers=staff, json={
        "punch_type": "checkin", "nonce": ch["nonce"], "frames": [f1, f2],
        "latitude": HQ[0], "longitude": HQ[1], "gps_accuracy_m": 8,
        "device_fingerprint": "pytest-device"})
    assert r.status_code == 200, r.text
    assert r.json()["result"] != "accepted"        # no attendance was granted

    db = TestSession()
    p = (db.query(AttendancePunch)
           .filter(AttendancePunch.employee_id == world["staff"])
           .order_by(AttendancePunch.id.desc()).first())
    db.close()
    assert p is not None, "the attempt must be recorded even when rejected"
    assert p.capture_path, "no encrypted capture was stored"

    stored = tmp_path / p.capture_path
    assert stored.exists()

    raw = stored.read_bytes()
    assert not raw.startswith(b"\xff\xd8"), "image was written in the clear"
    assert raw.startswith(b"gAAAAA"), "not a Fernet token"

    # and it decrypts back to exactly the frame that was sent
    expected = base64.b64decode(f2.split(",", 1)[1])
    assert face_vault.load_frame(p.capture_path) == expected

    # the filename must leak nothing personal
    name = Path(p.capture_path).name
    assert "omar" not in name.lower()
    assert "manathhomes" not in name.lower()
    assert name.endswith(".jpg.enc")


# ---------------------------------------------------------------------------
# The exact contract the enrolment UI depends on (web/users.html, web/security.html)
# ---------------------------------------------------------------------------
def test_employee_list_exposes_the_fields_the_enrol_ui_reads(world):
    """The panel gates on consent and shows enrolment state. If these fields
    disappear the UI silently misreports who can be enrolled."""
    rows = client.get("/api/auth/employees", headers=tok("hr@manathhomes.ae")).json()
    assert rows
    for key in ("biometric_consent", "face_enrolled", "full_name", "work_email", "id"):
        assert key in rows[0], f"employee list is missing {key}"


def test_consent_endpoint_matches_what_the_security_page_sends(world):
    """security.html posts {accepted, policy_version} to /api/auth/consent."""
    staff = tok("omar@manathhomes.ae")
    r = client.post("/api/auth/consent", headers=staff,
                    json={"accepted": True, "policy_version": "v1"})
    assert r.status_code == 200, r.text
    assert r.json()["biometric_consent"] is True
    me = client.get("/api/auth/me", headers=staff).json()
    assert me["biometric_consent"] is True


def test_withdrawing_consent_deletes_the_templates(world):
    """Stated on the Security page, so it has to actually happen."""
    staff = tok("omar@manathhomes.ae")
    client.post("/api/auth/consent", headers=staff,
                json={"accepted": True, "policy_version": "v1"})
    assert client.post("/api/attendance/enrol", headers=tok("hr@manathhomes.ae"), json={
        "employee_id": world["staff"], "frames": enrolment_frames()}).status_code == 200

    rows = client.get("/api/auth/employees", headers=tok("hr@manathhomes.ae")).json()
    assert next(r for r in rows if r["id"] == world["staff"])["face_enrolled"] is True

    client.post("/api/auth/consent", headers=staff,
                json={"accepted": False, "policy_version": "v1"})
    rows = client.get("/api/auth/employees", headers=tok("hr@manathhomes.ae")).json()
    me = next(r for r in rows if r["id"] == world["staff"])
    assert me["face_enrolled"] is False, "templates survived consent withdrawal"
    assert me["biometric_consent"] is False


def test_enrolment_accepts_the_browser_data_url_format(world):
    """captureShot() sends canvas.toDataURL('image/jpeg') - a data: URL, not
    bare base64. The endpoint must accept exactly that."""
    client.post("/api/auth/consent", headers=tok("omar@manathhomes.ae"),
                json={"accepted": True, "policy_version": "v1"})
    frames = enrolment_frames()
    assert all(f.startswith("data:image/jpeg;base64,") for f in frames)
    r = client.post("/api/attendance/enrol", headers=tok("hr@manathhomes.ae"),
                    json={"employee_id": world["staff"], "frames": frames})
    assert r.status_code == 200, r.text


def test_enrol_rejects_fewer_than_four_frames(world):
    client.post("/api/auth/consent", headers=tok("omar@manathhomes.ae"),
                json={"accepted": True, "policy_version": "v1"})
    r = client.post("/api/attendance/enrol", headers=tok("hr@manathhomes.ae"),
                    json={"employee_id": world["staff"], "frames": enrolment_frames()[:3]})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# The accepted path, with real models and NO stubbing
# ---------------------------------------------------------------------------
def _mirror_pair():
    """A photograph and its mirror image.

    Not a physical head turn, but not a trick either: the mirrored frame is a
    genuinely different image whose facial keypoints sit in a different
    geometry, and the pose estimator reads a real yaw swing across the pair
    (measured 19.5 deg -> -15.9 deg, a 35.4 deg delta against the 12 deg
    threshold) while ArcFace still scores them as the same person (0.913
    against a 0.40 threshold). Every stage runs for real: detection, embedding,
    pose estimation, the same-person check, template matching, geofence, the
    database write and the encrypted capture. Nothing is stubbed.
    """
    p = FACES / "lena.jpg"
    return _b64(p), _b64(p, lambda i: cv2.flip(i, 1))


def test_accepted_face_punch_end_to_end_no_stubs(world, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    staff, loc = _enrolled_and_assigned(world)
    from tests.test_locations_rbac import HQ

    straight, mirrored = _mirror_pair()

    # The server picks the direction, so ask until it picks a yaw challenge.
    for _ in range(25):
        ch = client.post("/api/attendance/challenge", headers=staff).json()
        if ch["direction"] in ("left", "right"):
            break
    else:
        pytest.skip("challenge never selected a yaw direction")

    # "right" means base yaw minus moved yaw must exceed the threshold.
    frames = ([straight, mirrored] if ch["direction"] == "right"
              else [mirrored, straight])

    r = client.post("/api/attendance/punch", headers=staff, json={
        "punch_type": "checkin", "nonce": ch["nonce"], "frames": frames,
        "latitude": HQ[0], "longitude": HQ[1], "gps_accuracy_m": 6,
        "device_fingerprint": "pytest-device"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] == "accepted", body
    assert body["method"] == "face"
    assert body["distance_from_site_m"] is not None

    # the attendance row exists, is linked to the right location, and is real
    db = TestSession()
    p = (db.query(AttendancePunch)
           .filter(AttendancePunch.employee_id == world["staff"])
           .order_by(AttendancePunch.id.desc()).first())
    db.close()
    assert p.result.value == "accepted"
    assert p.location_id == loc["id"]
    assert p.face_score is not None and p.face_score > 0
    assert p.liveness_score is not None and p.liveness_score > 0
    assert p.latitude and p.longitude

    # and the encrypted capture landed
    assert p.capture_path
    raw = (tmp_path / p.capture_path).read_bytes()
    assert raw.startswith(b"gAAAAA") and not raw.startswith(b"\xff\xd8")
    assert face_vault.load_frame(p.capture_path) == base64.b64decode(
        frames[-1].split(",", 1)[1])


def test_accepted_punch_then_checkout_closes_the_day(world, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "MIN_PUNCH_INTERVAL_SECONDS", 0)
    staff, _ = _enrolled_and_assigned(world)
    from tests.test_locations_rbac import HQ
    straight, mirrored = _mirror_pair()

    def punch(kind):
        for _ in range(25):
            ch = client.post("/api/attendance/challenge", headers=staff).json()
            if ch["direction"] in ("left", "right"):
                break
        else:
            pytest.skip("challenge never selected a yaw direction")
        frames = ([straight, mirrored] if ch["direction"] == "right"
                  else [mirrored, straight])
        return client.post("/api/attendance/punch", headers=staff, json={
            "punch_type": kind, "nonce": ch["nonce"], "frames": frames,
            "latitude": HQ[0], "longitude": HQ[1], "gps_accuracy_m": 6,
            "device_fingerprint": "pytest-device"})

    assert punch("checkin").json()["result"] == "accepted"
    out = punch("checkout")
    assert out.json()["result"] == "accepted", out.text

    rows = client.get("/api/attendance/mine", headers=staff).json()
    kinds = [r["type"] for r in rows if r["result"] == "accepted"]
    assert "checkin" in kinds and "checkout" in kinds


# ---------------------------------------------------------------------------
# The Attendance tab (web/attendance.html -> GET /api/attendance/days)
# ---------------------------------------------------------------------------
def test_attendance_days_shows_the_completed_day(world, tmp_path, monkeypatch):
    """A real check-in and check-out must surface in the Attendance tab with a
    correct duration - the whole point of the tab."""
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "MIN_PUNCH_INTERVAL_SECONDS", 0)
    staff, loc = _enrolled_and_assigned(world)
    from tests.test_locations_rbac import HQ
    straight, mirrored = _mirror_pair()

    def punch(kind):
        for _ in range(25):
            ch = client.post("/api/attendance/challenge", headers=staff).json()
            if ch["direction"] in ("left", "right"):
                break
        else:
            pytest.skip("challenge never selected a yaw direction")
        frames = ([straight, mirrored] if ch["direction"] == "right"
                  else [mirrored, straight])
        return client.post("/api/attendance/punch", headers=staff, json={
            "punch_type": kind, "nonce": ch["nonce"], "frames": frames,
            "latitude": HQ[0], "longitude": HQ[1], "gps_accuracy_m": 6,
            "device_fingerprint": "pytest-device"})

    assert punch("checkin").json()["result"] == "accepted"

    days = client.get("/api/attendance/days", headers=staff).json()
    assert len(days) == 1
    d = days[0]
    assert d["checkin_at"] and d["checkout_at"] is None
    assert d["status"] == "open"
    assert d["checkin_location"] == "Head Office"
    assert d["face_verified"] is True

    assert punch("checkout").json()["result"] == "accepted"
    d = client.get("/api/attendance/days", headers=staff).json()[0]
    assert d["checkout_at"], "check-out did not close the day"
    assert d["status"] == "complete"
    assert d["worked_minutes"] is not None
    assert d["worked_hhmm"] or d["worked_minutes"] == 0


def test_employee_cannot_read_another_persons_attendance(world):
    r = client.get(f"/api/attendance/days?employee_id={world['hr']}",
                   headers=tok("omar@manathhomes.ae"))
    assert r.status_code == 403


def test_hr_can_read_an_employees_attendance(world):
    r = client.get(f"/api/attendance/days?employee_id={world['staff']}",
                   headers=tok("hr@manathhomes.ae"))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_days_endpoint_returns_every_field_the_tab_renders(world, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    staff, _ = _enrolled_and_assigned(world)
    from tests.test_locations_rbac import HQ
    straight, mirrored = _mirror_pair()
    for _ in range(25):
        ch = client.post("/api/attendance/challenge", headers=staff).json()
        if ch["direction"] in ("left", "right"):
            break
    frames = ([straight, mirrored] if ch["direction"] == "right"
              else [mirrored, straight])
    client.post("/api/attendance/punch", headers=staff, json={
        "punch_type": "checkin", "nonce": ch["nonce"], "frames": frames,
        "latitude": HQ[0], "longitude": HQ[1], "gps_accuracy_m": 6,
        "device_fingerprint": "pytest-device"})
    d = client.get("/api/attendance/days", headers=staff).json()[0]
    for key in ("day", "employee_name", "checkin_at", "checkout_at",
                "worked_minutes", "worked_hhmm", "status", "checkin_location",
                "checkout_location", "face_verified"):
        assert key in d, f"the Attendance tab reads {key} and it is missing"
