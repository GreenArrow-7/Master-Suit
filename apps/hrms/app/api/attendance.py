import base64
import binascii
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import active_user, hash_password, require_roles, verify_password
from app.models.core import (
    AttendancePunch, AuditLog, Employee, FaceTemplate, PunchResult, PunchType, Role, Site,
)
from app.services.face import (
    FaceEngineUnavailable, challenges, cosine, diagnose, embed_for_enrolment, engine_ready,
    verify_liveness,
)
from app.services.rules import best_match, inside_geofence, to_bytes
from app.services.location_rules import (
    PunchRejected, geofence_rejection, upsert_day, validate_punch,
)
import uuid

router = APIRouter(prefix="/api/attendance", tags=["attendance"])

MAX_FRAME_BYTES = 3 * 1024 * 1024


def _decode_frames(frames_b64: List[str]) -> List[bytes]:
    out = []
    for f in frames_b64:
        payload = f.split(",", 1)[1] if f.startswith("data:") else f
        try:
            raw = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, "A camera frame couldn't be read. Try again.")
        if len(raw) > MAX_FRAME_BYTES:
            raise HTTPException(413, "Camera frames are too large. Lower the capture quality.")
        if not raw:
            raise HTTPException(422, "An empty camera frame was received.")
        out.append(raw)
    return out


def _ip(request: Request):
    return request.client.host if request.client else None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChallengeOut(BaseModel):
    nonce: str
    direction: str
    instruction: str
    expires_in_seconds: int


class PunchIn(BaseModel):
    punch_type: PunchType
    site_id: Optional[int] = None   # legacy — ignored; the server resolves the location
    nonce: str
    frames: List[str] = Field(..., min_length=2, max_length=6,
                              description="Base64 JPEG frames: neutral first, then moved")
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    gps_accuracy_m: float = Field(0.0, ge=0)
    device_fingerprint: str = Field(..., min_length=4, max_length=120)
    mock_location_flag: bool = False
    client_time: Optional[datetime] = None
    client_punch_uid: Optional[str] = Field(None, max_length=64)
    synced_offline: bool = False


class PunchOut(BaseModel):
    result: PunchResult
    message: str
    server_time: datetime
    distance_from_site_m: Optional[float] = None
    method: str = "face"


class EnrolIn(BaseModel):
    employee_id: int
    frames: List[str] = Field(..., min_length=4, max_length=10)


INSTRUCTIONS = {
    "left": "Turn your head slowly to your left.",
    "right": "Turn your head slowly to your right.",
    "up": "Tilt your head slowly upwards.",
}


def _record(db: Session, emp: Employee, body, result: PunchResult,
            reason: Optional[str], face_score: Optional[float],
            liveness: Optional[float], distance: Optional[float], method: str,
            location=None, code: Optional[str] = None,
            request: Optional[Request] = None):
    punch = AttendancePunch(
        employee_id=emp.id, punch_type=body.punch_type, client_time=body.client_time,
        site_id=None, latitude=body.latitude, longitude=body.longitude,
        gps_accuracy_m=body.gps_accuracy_m, distance_from_site_m=distance,
        face_score=face_score, liveness_score=liveness,
        device_fingerprint=body.device_fingerprint,
        mock_location_flag=body.mock_location_flag, result=result,
        reject_reason=reason, reject_code=code,
        synced_offline=body.synced_offline, method=method,
        client_punch_uid=body.client_punch_uid,
        request_id=str(uuid.uuid4()),
        server_ip=_ip(request) if request else None,
        location_id=location.id if location else None,
        loc_latitude=location.latitude if location else None,
        loc_longitude=location.longitude if location else None,
        loc_radius_m=location.radius_m if location else None,
        loc_max_accuracy_m=location.max_accuracy_m if location else None,
    )
    db.add(punch)
    db.commit()
    db.refresh(punch)
    return punch


def _preflight(db: Session, emp: Employee, body, request: Request):
    """Checks that apply to every punch method.

    Returns (ctx, early_response). ctx is a PunchContext whose location is the
    server-resolved assignment location — the client's site_id is never
    trusted. Every rejection is recorded with full location evidence.
    """
    # Idempotent replays first: the same offline punch synced twice must
    # short-circuit before any validation runs again.
    if body.client_punch_uid:
        dupe = (db.query(AttendancePunch)
                  .filter(AttendancePunch.client_punch_uid == body.client_punch_uid,
                          AttendancePunch.employee_id == emp.id).first())
        if dupe:
            return None, PunchOut(result=dupe.result, server_time=dupe.server_time,
                                  message="Already recorded.",
                                  distance_from_site_m=dupe.distance_from_site_m)

    try:
        # Geofence enforcement is deliberately deferred to _finish so the face
        # flow consumes its liveness nonce first — a rejected payload can then
        # never be replayed from outside the fence.
        ctx = validate_punch(db, emp, body.punch_type, body.latitude,
                             body.longitude, body.gps_accuracy_m,
                             enforce_geofence=False)
    except PunchRejected as e:
        p = _record(db, emp, body, e.result, e.message, None, None,
                    e.distance, "face", location=e.location, code=e.code,
                    request=request)
        return None, PunchOut(result=p.result, server_time=p.server_time,
                              distance_from_site_m=e.distance,
                              message=e.message)

    # Offline replays must be recent, or a queued punch from last week lands today.
    if body.synced_offline and body.client_time:
        ct = body.client_time
        if ct.tzinfo is None:
            ct = ct.replace(tzinfo=timezone.utc)
        age_h = (datetime.now(timezone.utc) - ct).total_seconds() / 3600
        if age_h > settings.MAX_OFFLINE_SYNC_HOURS:
            p = _record(db, emp, body, PunchResult.rejected_stale_sync,
                        f"Offline punch {age_h:.0f}h old", None, None, None, "face")
            return None, PunchOut(result=p.result, server_time=p.server_time,
                                  message="This queued check-in is too old to sync. "
                                          "Ask HR to record it manually.")

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.MIN_PUNCH_INTERVAL_SECONDS)
    recent = (db.query(AttendancePunch)
                .filter(AttendancePunch.employee_id == emp.id,
                        AttendancePunch.result == PunchResult.accepted,
                        AttendancePunch.server_time >= cutoff).first())
    if recent:
        p = _record(db, emp, body, PunchResult.rejected_duplicate,
                    "Within minimum interval", None, None, None, "face")
        return None, PunchOut(result=p.result, server_time=p.server_time,
                              message="You just checked in. Wait a moment and retry.")

    return ctx, None


def _finish(db: Session, emp: Employee, body, ctx, request: Request,
            face_score: Optional[float], liveness: Optional[float],
            method: str, frames=None) -> PunchOut:
    site, distance = ctx.location, ctx.distance_m
    if distance > site.radius_m:
        e = geofence_rejection(site, distance)
        p = _record(db, emp, body, e.result, e.message, face_score, liveness,
                    distance, method, location=site, code=e.code, request=request)
        _keep_capture(db, emp, p, frames)
        return PunchOut(result=p.result, server_time=p.server_time, method=method,
                        distance_from_site_m=distance, message=e.message)
    result = PunchResult.flagged_review if body.mock_location_flag else PunchResult.accepted
    p = _record(db, emp, body, result,
                "Mock location reported by device" if body.mock_location_flag else None,
                face_score, liveness, distance, method,
                location=site, request=request)
    upsert_day(db, emp, p)
    db.add(AuditLog(actor_id=emp.id, action=f"attendance.{body.punch_type.value}",
                    entity="attendance_punch", entity_id=str(p.id),
                    detail=f"location={site.name} assignment={ctx.assignment.id} "
                           f"method={method} "
                           f"score={face_score if face_score is not None else '-'} "
                           f"dist={distance:.0f}m radius={site.radius_m}m",
                    ip_address=_ip(request)))
    db.commit()
    _keep_capture(db, emp, p, frames)

    msg = "Checked in." if body.punch_type == PunchType.checkin else "Checked out."
    if result == PunchResult.flagged_review:
        msg += " Sent to HR for review — your device reported a simulated location."
    return PunchOut(result=result, server_time=p.server_time, method=method,
                    distance_from_site_m=distance, message=msg)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/my-locations")
def my_locations(db: Session = Depends(get_db), emp: Employee = Depends(active_user)):
    """The employee's currently valid assignments. Coordinates stay server-side;
    only names and radii are exposed for the status display."""
    from app.services.location_rules import candidate_assignments, open_checkin
    from app.models.core import PunchType as PT
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    cin = candidate_assignments(db, emp, PT.checkin, now)
    op = open_checkin(db, emp)
    return {
        "locations": [{"assignment_id": a.id, "location_id": l.id, "name": l.name,
                       "radius_m": l.radius_m, "type": l.location_type,
                       "checkout_rule": a.checkout_rule,
                       "assignment_type": a.assignment_type} for a, l in cin],
        "open_checkin": bool(op),
        "open_checkin_location_id": op.location_id if op else None,
    }


class PreflightIn(BaseModel):
    action: PunchType
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    gps_accuracy_m: float = Field(..., ge=0)


@router.post("/preflight")
def preflight(body: PreflightIn, db: Session = Depends(get_db),
              emp: Employee = Depends(active_user)):
    """Read-only. Tells the employee where they stand BEFORE they punch:
    which assigned location is nearest, the server-measured distance, the
    permitted radius and whether GPS accuracy is good enough (spec section 10).

    This writes nothing and grants nothing. validate_punch() re-derives every
    one of these values at punch time — a stale or forged preflight cannot
    let anyone through.
    """
    from app.services.location_rules import candidate_assignments, open_checkin
    from app.services.rules import haversine_m

    now = datetime.now(timezone.utc)
    cands = candidate_assignments(db, emp, body.action, now)
    if not cands:
        return {"ok": False, "code": "NO_ACTIVE_ASSIGNMENT",
                "message": "You have no active work-location assignment for this "
                           "action right now. Contact HR.",
                "can_request_exception": True, "candidates": []}

    op = open_checkin(db, emp)
    rows = []
    for a, loc in cands:
        d = haversine_m(body.latitude, body.longitude, loc.latitude, loc.longitude)
        max_acc = loc.max_accuracy_m or settings.MAX_GPS_ACCURACY_M
        rows.append({
            "assignment_id": a.id, "location_id": loc.id, "name": loc.name,
            "distance_m": round(d, 1), "radius_m": loc.radius_m,
            "inside": d <= loc.radius_m,
            "max_accuracy_m": max_acc,
            "accuracy_ok": body.gps_accuracy_m <= max_acc,
            "checkout_rule": a.checkout_rule,
        })
    rows.sort(key=lambda r: r["distance_m"])

    # Under same-location checkout, only the location of the open check-in counts.
    required_id = None
    if body.action == PunchType.checkout and op:
        match = next((r for r in rows if r["location_id"] == op.location_id), None)
        if match and match["checkout_rule"] == "same_location":
            required_id = op.location_id
            rows = [match]

    nearest = rows[0]
    if not nearest["accuracy_ok"]:
        return {"ok": False, "code": "LOCATION_ACCURACY_TOO_LOW",
                "message": f"Your GPS is accurate to about "
                           f"\u00b1{round(body.gps_accuracy_m)} m. This location "
                           f"requires {nearest['max_accuracy_m']} m or better. Move to "
                           "an open area, away from glass and covered parking, "
                           "and retry.",
                "can_request_exception": False,
                "required_location_id": required_id, "candidates": rows}

    if not any(r["inside"] for r in rows):
        return {"ok": False, "code": "OUTSIDE_APPROVED_LOCATION",
                "message": f"You are {round(nearest['distance_m'])} metres away from "
                           f"{nearest['name']}. The permitted radius is "
                           f"{nearest['radius_m']} metres. Move inside the approved "
                           "location and try again, or submit an attendance "
                           "exception request when you are working at an "
                           "authorised external site.",
                "can_request_exception": True,
                "required_location_id": required_id, "candidates": rows}

    ok_row = next(r for r in rows if r["inside"])
    return {"ok": True, "code": "READY",
            "message": f"Inside {ok_row['name']} \u2014 "
                       f"{round(ok_row['distance_m'])} m from centre, "
                       f"radius {ok_row['radius_m']} m.",
            "can_request_exception": False,
            "required_location_id": required_id, "candidates": rows}


@router.get("/sites")
def list_sites(db: Session = Depends(get_db), emp: Employee = Depends(active_user)):
    """Sites the check-in screen can offer. Coordinates stay server-side — the
    client has no business knowing where the geofence centre is, since that's
    exactly what you'd need to fake a location convincingly."""
    rows = (db.query(Site).filter(Site.is_active.is_(True))
              .order_by(Site.name).all())
    return [{"id": s.id, "name": s.name} for s in rows]


@router.get("/engine")
def engine_status(emp: Employee = Depends(active_user)):
    ready = engine_ready()
    return {"face_engine_ready": ready,
            "message": "Face check-in is available." if ready else
                       diagnose()}


@router.post("/challenge", response_model=ChallengeOut)
def issue_challenge(db: Session = Depends(get_db), emp: Employee = Depends(active_user)):
    """The server picks the movement, not the client. A client-chosen challenge
    is no challenge at all — an attacker just always picks the one they recorded."""
    if not emp.biometric_consent_at:
        raise HTTPException(403, "Record your biometric consent before using face check-in.")
    enrolled = db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).count()
    if enrolled < settings.FACE_SAMPLES_REQUIRED:
        raise HTTPException(409, "Finish face enrolment with HR before checking in.")
    if not engine_ready():
        raise HTTPException(503, diagnose())

    ch = challenges.issue(emp.id)
    from app.services.face import CHALLENGE_TTL_SECONDS
    return ChallengeOut(nonce=ch.nonce, direction=ch.direction,
                        instruction=INSTRUCTIONS[ch.direction],
                        expires_in_seconds=CHALLENGE_TTL_SECONDS)


def _keep_capture(db: Session, emp: Employee, punch, frames_raw) -> None:
    """Persist the presented frame as encrypted evidence, for accepted AND
    rejected punches. A rejected punch is exactly when you most want the
    picture: it is the record of who tried."""
    if punch is None or not frames_raw:
        return
    from app.services.face_vault import store_frame
    rel = store_frame(emp.id, punch.id, frames_raw[-1], punch.server_time)
    if rel:
        punch.capture_path = rel
        db.commit()


@router.post("/punch", response_model=PunchOut)
def punch(body: PunchIn, request: Request, db: Session = Depends(get_db),
          emp: Employee = Depends(active_user)):
    if not emp.biometric_consent_at:
        raise HTTPException(403, "Record your biometric consent before using face check-in.")

    # Cheap checks first: site, offline age, duplicate interval, GPS accuracy.
    # These run before the nonce is consumed on purpose — a weak GPS fix or a
    # too-soon retry shouldn't burn the challenge and force the whole capture
    # again. The nonce is spent only once we actually look at the frames.
    ctx, early = _preflight(db, emp, body, request)
    if early:
        return early

    try:
        ch = challenges.consume(body.nonce, emp.id)
    except ValueError as e:
        raise HTTPException(409, str(e))

    frames = _decode_frames(body.frames)

    try:
        live = verify_liveness(frames, ch.direction)
    except FaceEngineUnavailable:
        raise HTTPException(503, diagnose())
    except ValueError as e:
        p = _record(db, emp, body, PunchResult.rejected_liveness, str(e),
                    None, None, None, "face")
        _keep_capture(db, emp, p, frames)
        return PunchOut(result=p.result, server_time=p.server_time, message=str(e))

    if not live.passed:
        p = _record(db, emp, body, PunchResult.rejected_liveness, live.reason,
                    None, live.score, None, "face")
        _keep_capture(db, emp, p, frames)
        return PunchOut(result=p.result, server_time=p.server_time, message=live.reason)

    templates = [t.embedding for t in
                 db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).all()]
    if len(templates) < settings.FACE_SAMPLES_REQUIRED:
        raise HTTPException(409, "Finish face enrolment with HR before checking in.")

    score = best_match(live.embedding, templates)
    if score < settings.FACE_MATCH_THRESHOLD:
        p = _record(db, emp, body, PunchResult.rejected_face, f"Score {score:.3f}",
                    score, live.score, None, "face")
        _keep_capture(db, emp, p, frames)
        return PunchOut(result=p.result, server_time=p.server_time,
                        message="We couldn't confirm it's you. Try again or contact HR.")

    return _finish(db, emp, body, ctx, request, score, live.score, "face",
                   frames=frames)


@router.post("/enrol")
def enrol(body: EnrolIn, request: Request, db: Session = Depends(get_db),
          actor=Depends(require_roles("hr", "admin"))):
    """HR-only, done in person. Stores embeddings; raw images are never persisted."""
    emp = db.query(Employee).filter(Employee.id == body.employee_id).first()
    if not emp:
        raise HTTPException(404, "No employee with that ID.")
    if not emp.biometric_consent_at:
        raise HTTPException(409, "Capture written biometric consent before enrolling.")
    if len(body.frames) < settings.FACE_SAMPLES_REQUIRED:
        raise HTTPException(422, f"Capture at least {settings.FACE_SAMPLES_REQUIRED} samples.")

    frames = _decode_frames(body.frames)
    try:
        embeddings = embed_for_enrolment(frames)
    except FaceEngineUnavailable as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Four shots of the identical pose give a brittle template that fails the
    # moment the person tilts their head. Force genuine variation.
    spread = 1.0 - min(cosine(embeddings[i], embeddings[j])
                       for i in range(len(embeddings))
                       for j in range(i + 1, len(embeddings)))
    if spread < settings.FACE_ENROLMENT_MIN_SPREAD:
        raise HTTPException(422,
                            "The samples are too similar. Capture different angles: "
                            "straight on, slight left, slight right, slight up.")

    db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).delete()
    for vec in embeddings:
        db.add(FaceTemplate(employee_id=emp.id, embedding=to_bytes(vec),
                            dim=len(vec), model_version="buffalo_l"))
    db.add(AuditLog(actor_id=actor.id, action="face.enrol", entity="employee",
                    entity_id=str(emp.id), detail=f"{len(embeddings)} samples",
                    ip_address=_ip(request)))
    db.commit()
    return {"status": "enrolled", "samples": len(embeddings),
            "sample_spread": round(spread, 4)}


@router.get("/mine")
def my_punches(limit: int = 30, db: Session = Depends(get_db),
               emp: Employee = Depends(active_user)):
    rows = (db.query(AttendancePunch)
              .filter(AttendancePunch.employee_id == emp.id)
              .order_by(AttendancePunch.server_time.desc())
              .limit(min(limit, 200)).all())
    return [{"id": p.id, "type": p.punch_type.value, "at": p.server_time,
             "result": p.result.value, "method": p.method,
             "site_id": p.site_id, "distance_m": p.distance_from_site_m,
             "reason": p.reject_reason} for p in rows]


@router.get("/days")
def attendance_days(start: Optional[date] = None, end: Optional[date] = None,
                    employee_id: Optional[int] = None, limit: int = 100,
                    db: Session = Depends(get_db),
                    emp: Employee = Depends(active_user)):
    """Daily attendance for the Attendance tab.

    An employee sees only their own days. HR and admin may pass employee_id to
    see anyone's; a plain employee passing someone else's id is refused rather
    than silently shown their own.
    """
    from app.models.locations import AttendanceDay, WorkLocation

    target = emp.id
    if employee_id is not None and employee_id != emp.id:
        if emp.role not in (Role.hr, Role.admin):
            raise HTTPException(403, "You can only view your own attendance.")
        target = employee_id

    q = db.query(AttendanceDay).filter(AttendanceDay.employee_id == target)
    if start:
        q = q.filter(AttendanceDay.day >= start)
    if end:
        q = q.filter(AttendanceDay.day <= end)
    rows = q.order_by(AttendanceDay.day.desc()).limit(min(limit, 366)).all()

    who = db.query(Employee).filter(Employee.id == target).first()
    loc_names = {l.id: l.name for l in db.query(WorkLocation).all()}

    out = []
    for d in rows:
        # Face verification is a property of the punches that built the day.
        verified = (db.query(AttendancePunch)
                      .filter(AttendancePunch.employee_id == target,
                              AttendancePunch.result == PunchResult.accepted,
                              AttendancePunch.face_score.isnot(None))
                      .filter(func.date(AttendancePunch.server_time) == d.day)
                      .count() > 0)
        mins = d.worked_minutes or 0
        out.append({
            "day": d.day,
            "employee_id": target,
            "employee_name": who.full_name if who else None,
            "checkin_at": d.checkin_at,
            "checkout_at": d.checkout_at,
            "worked_minutes": mins,
            "worked_hhmm": f"{mins // 60}h {mins % 60:02d}m" if mins else None,
            "status": d.status,
            "checkin_location": loc_names.get(d.checkin_location_id),
            "checkout_location": loc_names.get(d.checkout_location_id),
            "face_verified": verified,
        })
    return out


@router.get("/review")
def review_queue(db: Session = Depends(get_db),
                 actor=Depends(require_roles("hr", "admin"))):
    """Punches HR should look at: simulated locations and repeated face failures."""
    rows = (db.query(AttendancePunch, Employee)
              .join(Employee, Employee.id == AttendancePunch.employee_id)
              .filter(AttendancePunch.result.in_([PunchResult.flagged_review,
                                                  PunchResult.rejected_face,
                                                  PunchResult.rejected_liveness]))
              .order_by(AttendancePunch.server_time.desc()).limit(200).all())
    return [{"id": p.id, "employee": e.full_name, "employee_code": e.employee_code,
             "at": p.server_time, "result": p.result.value, "method": p.method,
             "reason": p.reject_reason, "face_score": p.face_score,
             "mock_location": p.mock_location_flag} for p, e in rows]
