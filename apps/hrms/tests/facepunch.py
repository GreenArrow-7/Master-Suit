"""Drive the real /api/attendance/punch endpoint from tests.

Why this exists
---------------
Geofence, assignment-window and check-out-rule tests used to punch through
``/api/attendance/punch-pin`` because a face punch cannot be synthesised: the
liveness check needs a genuine head turn between two frames, and warping one
photograph moves the pose estimate by only a few degrees.

When the PIN was removed, that harness went with it. Rather than lose the
coverage, this module drives the **real** ``/punch`` endpoint and stubs only
the two biometric primitives:

    verify_liveness()  - needs a real head turn
    best_match()       - needs a real enrolled person

Everything else stays real: authentication, consent, the challenge nonce, the
whole ``_preflight`` gate chain, geofence distance, assignment windows,
check-out rules, duplicate detection, DB writes and the encrypted capture.

The stubbed primitives are not left untested - they run against the actual
SCRFD/ArcFace models in ``tests/test_face_engine.py`` and
``tests/test_face_models.py``, and against the live API in
``tests/test_face_punch_e2e.py``. This harness covers the attendance logic
*around* them.
"""
from __future__ import annotations

import base64

import numpy as np

from app.models.core import Employee, FaceTemplate
from app.services.face import LivenessResult
from app.services.rules import to_bytes
from tests.conftest import TestSession, client

# Two distinct non-empty payloads. The endpoint rejects byte-identical frames
# before it reaches the stub, so these must differ.
FRAMES = [
    "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"neutral" * 40).decode(),
    "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"turned" * 40).decode(),
]

_VEC = np.full(512, 1.0 / np.sqrt(512), dtype=np.float32)


def enable_face(employee_id: int, samples: int = 4) -> None:
    """Give an employee consent and enrolled templates, as HR would have."""
    from datetime import datetime, timezone
    db = TestSession()
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    assert emp is not None, f"no employee {employee_id}"
    emp.biometric_consent_at = datetime.now(timezone.utc)
    db.query(FaceTemplate).filter(FaceTemplate.employee_id == employee_id).delete()
    for _ in range(samples):
        db.add(FaceTemplate(employee_id=employee_id, embedding=to_bytes(_VEC),
                            dim=512, model_version="test"))
    db.commit()
    db.close()


def stub_biometrics(monkeypatch, *, live: bool = True, score: float = 0.99,
                    reason: str = "ok") -> None:
    """Make liveness and matching deterministic for this test."""
    import app.api.attendance as att

    def _liveness(frames, direction):
        return LivenessResult(live, 0.9 if live else 0.0, reason,
                              embedding=_VEC if live else None)

    monkeypatch.setattr(att, "verify_liveness", _liveness)
    monkeypatch.setattr(att, "best_match", lambda probe, templates: score)


def face_punch(hdr, action, lat, lng, acc=10.0, *, uid=None, device="pytest-device"):
    """Issue a real challenge, then punch through the real endpoint."""
    ch = client.post("/api/attendance/challenge", headers=hdr)
    assert ch.status_code == 200, ch.text
    body = {
        "punch_type": action,
        "nonce": ch.json()["nonce"],
        "frames": FRAMES,
        "latitude": lat,
        "longitude": lng,
        "gps_accuracy_m": acc,
        "device_fingerprint": device,
    }
    if uid:
        body["client_punch_uid"] = uid
    return client.post("/api/attendance/punch", headers=hdr, json=body)
