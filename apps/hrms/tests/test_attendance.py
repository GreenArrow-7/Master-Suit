"""Attendance pipeline tests.

The face model itself is exercised in test_face_models.py. Here we control the
analyser so we can drive every branch of the punch pipeline deterministically —
a real camera can't be made to fail liveness on demand.
"""
import base64
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.security import hash_password
from app.models.core import (
    Employee, EmploymentStatus, FaceTemplate, Role, Site,
)
from app.services import face as face_mod
from app.services.rules import to_bytes

PW = "CorrectHorse-2026!"

# Head office in the seed data.
SITE_LAT, SITE_LON = 25.1972, 55.2744

IDENTITY_A = np.random.RandomState(1).randn(512).astype(np.float32)
IDENTITY_B = np.random.RandomState(2).randn(512).astype(np.float32)


def frame(tag: bytes) -> str:
    """Frames only need to be distinct bytes — the analyser is stubbed."""
    return base64.b64encode(b"JPEGFRAME" + tag).decode()


class StubFace:
    """Stands in for services.face.analyse."""

    def __init__(self):
        self.identity = IDENTITY_A
        self.yaw_by_frame = {}     # frame bytes -> yaw
        self.pitch_by_frame = {}
        self.identity_by_frame = {}
        self.raise_on = None

    def install(self, monkeypatch):
        def fake_analyse(image):
            tag = bytes(image)
            if self.raise_on and self.raise_on in tag:
                raise ValueError("No face found in the frame. Move into the light "
                                 "and centre your face.")
            return face_mod.DetectedFace(
                embedding=self.identity_by_frame.get(tag, self.identity),
                det_score=0.95,
                yaw=self.yaw_by_frame.get(tag, 0.0),
                pitch=self.pitch_by_frame.get(tag, 0.0),
                roll=0.0, bbox_area_ratio=0.15, blur_score=250.0)

        monkeypatch.setattr(face_mod, "analyse", fake_analyse)
        monkeypatch.setattr(face_mod, "decode_image", lambda b: b)
        monkeypatch.setattr(face_mod, "engine_ready", lambda: True)
        monkeypatch.setattr("app.api.attendance.engine_ready", lambda: True)
        return self


@pytest.fixture
def stub(monkeypatch):
    return StubFace().install(monkeypatch)


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    db.add(Site(id=1, name="Head Office", latitude=SITE_LAT, longitude=SITE_LON,
                radius_m=150))
    db.add(Site(id=2, name="Disabled Site", latitude=SITE_LAT, longitude=SITE_LON,
                radius_m=150, is_active=False))
    from app.models.locations import WorkLocation, EmployeeLocationAssignment
    from app.core.config import settings as _st
    _st.MIN_PUNCH_INTERVAL_SECONDS = _st.MIN_PUNCH_INTERVAL_SECONDS  # unchanged
    db.add(WorkLocation(id=1, name="Head Office", location_type="head_office",
                        latitude=SITE_LAT, longitude=SITE_LON, radius_m=150,
                        status="active"))
    db.add(Employee(employee_code="HR-001", full_name="Aisha Rahman",
                    work_email="hr@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.hr, date_of_joining=date(2020, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False,
                    biometric_consent_at=datetime.now(timezone.utc)))
    db.add(Employee(employee_code="EMP-002", full_name="Omar Farouk",
                    work_email="omar@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.employee, date_of_joining=date(2022, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False,
                    biometric_consent_at=datetime.now(timezone.utc)))
    db.add(Employee(employee_code="EMP-003", full_name="Layla Haddad",
                    work_email="layla@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.employee, date_of_joining=date(2023, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.commit()
    for e in db.query(Employee).all():
        db.add(EmployeeLocationAssignment(employee_id=e.id, location_id=1,
                                          assignment_type="primary",
                                          checkout_rule="any_assigned"))
    db.commit()
    omar = db.query(Employee).filter(Employee.work_email == "omar@manathhomes.ae").first()
    for i in range(4):
        v = IDENTITY_A + np.random.RandomState(10 + i).randn(512).astype(np.float32) * 0.05
        db.add(FaceTemplate(employee_id=omar.id, embedding=to_bytes(v), dim=512))
    db.commit()
    db.close()
    yield


def token(email="omar@manathhomes.ae"):
    r = client.post("/api/auth/login", data={"username": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def get_challenge(headers):
    r = client.post("/api/attendance/challenge", headers=headers)
    assert r.status_code == 200, r.json()
    return r.json()


def do_punch(stub, headers, *, lat=SITE_LAT, lon=SITE_LON, accuracy=8.0,
             site_id=1, direction_ok=True, punch_type="checkin", **extra):
    ch = get_challenge(headers)
    neutral, moved = b"n1", b"m1"
    stub.yaw_by_frame = {}
    stub.pitch_by_frame = {}
    if direction_ok:
        if ch["direction"] == "left":
            stub.yaw_by_frame = {neutral: 0.0, moved: 25.0}
        elif ch["direction"] == "right":
            stub.yaw_by_frame = {neutral: 0.0, moved: -25.0}
        else:
            stub.pitch_by_frame = {neutral: 0.0, moved: -20.0}
    body = {"punch_type": punch_type, "site_id": site_id, "nonce": ch["nonce"],
            "frames": [base64.b64encode(neutral).decode(),
                       base64.b64encode(moved).decode()],
            "latitude": lat, "longitude": lon, "gps_accuracy_m": accuracy,
            "device_fingerprint": "test-device-01"}
    body.update(extra)
    return client.post("/api/attendance/punch", json=body, headers=headers)


# --- challenge -------------------------------------------------------------
def test_challenge_requires_consent(stub):
    r = client.post("/api/attendance/challenge", headers=token("layla@manathhomes.ae"))
    assert r.status_code == 403


def test_challenge_requires_enrolment(stub):
    r = client.post("/api/attendance/challenge", headers=token("hr@manathhomes.ae"))
    assert r.status_code == 409


def test_challenge_direction_is_server_chosen(stub):
    dirs = {get_challenge(token())["direction"] for _ in range(25)}
    assert len(dirs) > 1, "challenge direction must vary, not be predictable"


def test_challenge_nonce_is_single_use(stub):
    """A recorded punch payload must not be replayable.

    The first punch is deliberately off-site: it is rejected on geofence, so it
    never becomes an accepted punch and the 60-second duplicate guard stays out
    of the way. That leaves the nonce as the only thing that can stop the replay.
    """
    ch = get_challenge(token())
    # The server picks the direction, so the frames have to answer the one asked.
    stub.yaw_by_frame, stub.pitch_by_frame = {}, {}
    if ch["direction"] == "left":
        stub.yaw_by_frame = {b"n1": 0.0, b"m1": 25.0}
    elif ch["direction"] == "right":
        stub.yaw_by_frame = {b"n1": 0.0, b"m1": -25.0}
    else:
        stub.pitch_by_frame = {b"n1": 0.0, b"m1": -20.0}
    body = {"punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
            "frames": [base64.b64encode(b"n1").decode(),
                       base64.b64encode(b"m1").decode()],
            "latitude": 25.2500, "longitude": 55.3200, "gps_accuracy_m": 8,
            "device_fingerprint": "test-device-01"}
    first = client.post("/api/attendance/punch", json=body, headers=token())
    assert first.status_code == 200
    assert first.json()["result"] == "rejected_geofence"

    replay = client.post("/api/attendance/punch", json=body, headers=token())
    assert replay.status_code == 409
    detail = replay.json()["detail"].lower()
    assert "already used" in detail or "expired" in detail


def test_unknown_nonce_rejected(stub):
    body = {"punch_type": "checkin", "site_id": 1, "nonce": "not-a-real-nonce",
            "frames": [base64.b64encode(b"a").decode(), base64.b64encode(b"b").decode()],
            "latitude": SITE_LAT, "longitude": SITE_LON, "gps_accuracy_m": 8,
            "device_fingerprint": "test-device-01"}
    assert client.post("/api/attendance/punch", json=body, headers=token()).status_code == 409


# --- happy path ------------------------------------------------------------
def test_punch_accepted_on_site(stub):
    r = do_punch(stub, token())
    assert r.status_code == 200
    assert r.json()["result"] == "accepted"
    assert r.json()["method"] == "face"


# --- liveness --------------------------------------------------------------
def test_no_head_movement_rejected(stub):
    r = do_punch(stub, token(), direction_ok=False)
    assert r.json()["result"] == "rejected_liveness"
    assert "movement" in r.json()["message"].lower()


def test_identical_frames_rejected(stub):
    ch = get_challenge(token())
    same = base64.b64encode(b"same-frame").decode()
    r = client.post("/api/attendance/punch", headers=token(), json={
        "punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
        "frames": [same, same], "latitude": SITE_LAT, "longitude": SITE_LON,
        "gps_accuracy_m": 8, "device_fingerprint": "test-device-01"})
    assert r.json()["result"] == "rejected_liveness"
    assert "identical" in r.json()["message"].lower()


def test_face_swap_between_frames_rejected(stub):
    ch = get_challenge(token())
    stub.identity_by_frame = {b"n1": IDENTITY_A, b"m1": IDENTITY_B}
    stub.yaw_by_frame = {b"n1": 0.0, b"m1": 25.0}
    stub.pitch_by_frame = {b"n1": 0.0, b"m1": -20.0}
    r = client.post("/api/attendance/punch", headers=token(), json={
        "punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
        "frames": [base64.b64encode(b"n1").decode(), base64.b64encode(b"m1").decode()],
        "latitude": SITE_LAT, "longitude": SITE_LON, "gps_accuracy_m": 8,
        "device_fingerprint": "test-device-01"})
    assert r.json()["result"] == "rejected_liveness"
    assert "changed" in r.json()["message"].lower()


def test_no_face_in_frame_rejected(stub):
    stub.raise_on = b"n1"
    r = do_punch(stub, token())
    assert r.json()["result"] == "rejected_liveness"
    assert "no face" in r.json()["message"].lower()


def test_single_frame_rejected_by_schema(stub):
    ch = get_challenge(token())
    r = client.post("/api/attendance/punch", headers=token(), json={
        "punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
        "frames": [base64.b64encode(b"only").decode()],
        "latitude": SITE_LAT, "longitude": SITE_LON, "gps_accuracy_m": 8,
        "device_fingerprint": "test-device-01"})
    assert r.status_code == 422


# --- identity --------------------------------------------------------------
def test_wrong_person_rejected(stub):
    stub.identity = IDENTITY_B
    r = do_punch(stub, token())
    assert r.json()["result"] == "rejected_face"


# --- geofence --------------------------------------------------------------
def test_off_site_rejected(stub):
    r = do_punch(stub, token(), lat=25.2500, lon=55.3200)
    assert r.json()["result"] == "rejected_geofence"
    assert r.json()["distance_from_site_m"] > 1000


def test_geofence_is_strict_no_accuracy_grace(stub):
    """Policy change: distance is compared strictly against the radius.
    ~160 m away with ±60 m accuracy used to pass on grace; it now rejects,
    and the message states the distance and permitted radius."""
    r = do_punch(stub, token(), lat=SITE_LAT + 0.00144, accuracy=60)
    body = r.json()
    assert body["result"] == "rejected_geofence"
    assert "metres away" in body["message"]


def test_poor_gps_accuracy_rejected(stub):
    r = do_punch(stub, token(), accuracy=500)
    assert r.json()["result"] == "rejected_accuracy"


def test_client_site_id_is_ignored_server_resolves_location(stub):
    """The client can no longer pick the site: site_id is legacy and ignored.
    The punch is judged against the employee's server-side assignment, so a
    made-up site_id changes nothing."""
    r = do_punch(stub, token(), site_id=2)
    assert r.status_code == 200
    assert r.json()["result"] == "accepted"


def test_mock_location_flagged_not_silently_accepted(stub):
    r = do_punch(stub, token(), mock_location_flag=True)
    assert r.json()["result"] == "flagged_review"
    assert "review" in r.json()["message"].lower()


# --- rate limiting / offline ----------------------------------------------
def test_rapid_second_punch_rejected(stub):
    assert do_punch(stub, token()).json()["result"] == "accepted"
    r = do_punch(stub, token(), punch_type="checkout")
    assert r.json()["result"] == "rejected_duplicate"


def test_offline_punch_deduplicated_by_uid(stub):
    r1 = do_punch(stub, token(), client_punch_uid="uid-123", synced_offline=True)
    assert r1.json()["result"] == "accepted"
    r2 = do_punch(stub, token(), client_punch_uid="uid-123", synced_offline=True)
    assert r2.json()["message"] == "Already recorded."
    rows = client.get("/api/attendance/mine", headers=token()).json()
    assert len([p for p in rows if p["result"] == "accepted"]) == 1


def test_stale_offline_punch_rejected(stub):
    old = (datetime.now(timezone.utc) - timedelta(hours=100)).isoformat()
    r = do_punch(stub, token(), synced_offline=True, client_time=old)
    assert r.json()["result"] == "rejected_stale_sync"


# --- enrolment -------------------------------------------------------------
def test_enrolment_rejects_identical_samples(stub, monkeypatch):
    db = TestSession()
    lay = db.query(Employee).filter(Employee.work_email == "layla@manathhomes.ae").first()
    lay.biometric_consent_at = datetime.now(timezone.utc)
    lid = lay.id
    db.commit(); db.close()
    monkeypatch.setattr("app.api.attendance.embed_for_enrolment",
                        lambda frames: [IDENTITY_A for _ in frames])
    r = client.post("/api/attendance/enrol", headers=token("hr@manathhomes.ae"),
                    json={"employee_id": lid,
                          "frames": [frame(b"1"), frame(b"2"), frame(b"3"), frame(b"4")]})
    assert r.status_code == 422
    assert "too similar" in r.json()["detail"].lower()


def test_enrolment_requires_consent(stub, monkeypatch):
    db = TestSession()
    lid = db.query(Employee).filter(Employee.work_email == "layla@manathhomes.ae").first().id
    db.close()
    monkeypatch.setattr("app.api.attendance.embed_for_enrolment",
                        lambda frames: [np.random.randn(512).astype(np.float32)
                                        for _ in frames])
    r = client.post("/api/attendance/enrol", headers=token("hr@manathhomes.ae"),
                    json={"employee_id": lid,
                          "frames": [frame(b"1"), frame(b"2"), frame(b"3"), frame(b"4")]})
    assert r.status_code == 409


def test_enrolment_is_hr_only(stub):
    r = client.post("/api/attendance/enrol", headers=token(),
                    json={"employee_id": 1,
                          "frames": [frame(b"1"), frame(b"2"), frame(b"3"), frame(b"4")]})
    assert r.status_code == 403


# --- review queue ----------------------------------------------------------
def test_review_queue_collects_suspicious_punches(stub):
    do_punch(stub, token(), mock_location_flag=True)
    stub.identity = IDENTITY_B
    do_punch(stub, token())
    r = client.get("/api/attendance/review", headers=token("hr@manathhomes.ae")).json()
    results = {x["result"] for x in r}
    assert "flagged_review" in results and "rejected_face" in results


def test_review_queue_is_hr_only(stub):
    assert client.get("/api/attendance/review", headers=token()).status_code == 403


# --- malformed input -------------------------------------------------------
def test_non_base64_frame_rejected(stub):
    ch = get_challenge(token())
    r = client.post("/api/attendance/punch", headers=token(), json={
        "punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
        "frames": ["!!!not base64!!!", "@@@also not@@@"],
        "latitude": SITE_LAT, "longitude": SITE_LON, "gps_accuracy_m": 8,
        "device_fingerprint": "test-device-01"})
    assert r.status_code == 422


def test_out_of_range_coordinates_rejected(stub):
    ch = get_challenge(token())
    r = client.post("/api/attendance/punch", headers=token(), json={
        "punch_type": "checkin", "site_id": 1, "nonce": ch["nonce"],
        "frames": [frame(b"1"), frame(b"2")],
        "latitude": 999, "longitude": 55.0, "gps_accuracy_m": 8,
        "device_fingerprint": "test-device-01"})
    assert r.status_code == 422


# --- sites -----------------------------------------------------------------
def test_sites_endpoint_lists_active_sites_only(stub):
    rows = client.get("/api/attendance/sites", headers=token()).json()
    names = {s["name"] for s in rows}
    assert "Head Office" in names
    assert "Disabled Site" not in names


def test_sites_endpoint_does_not_leak_coordinates(stub):
    """Publishing the geofence centre would hand an attacker the exact
    coordinates to spoof."""
    rows = client.get("/api/attendance/sites", headers=token()).json()
    for s in rows:
        assert set(s.keys()) == {"id", "name"}


def test_sites_requires_authentication(stub):
    assert client.get("/api/attendance/sites").status_code == 401
