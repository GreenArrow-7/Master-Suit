"""Attendance Locations administration: work locations, employee assignments,
temporary locations with approval, exception requests, geofence testing.

Coordinates entered here are the authoritative geofence, stored in the
database. Historical punches keep their own snapshot of these values, so
editing a location never rewrites past evidence — and editing an active
location's coordinates or radius requires a written reason.
"""
import csv
import io
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import active_user
from app.models.core import Employee, PunchType
from app.models.locations import (
    ASSIGNMENT_TYPES, CHECKOUT_RULES, LOCATION_TYPES,
    AttendanceExceptionRequest, EmployeeLocationAssignment,
    TemporaryLocationRequest, WorkLocation,
)
from app.services.location_rules import candidate_assignments
from app.services.rbac import actor_scope_covers, audit, has_perm, require_perm
from app.services.rules import haversine_m

router = APIRouter(prefix="/api/locations", tags=["locations"])


def _ip(request: Request):
    return request.client.host if request.client else None


def _validate_coords(lat: float, lng: float, radius: int):
    if not (-90 <= lat <= 90):
        raise HTTPException(422, "Latitude must be between -90 and 90.")
    if not (-180 <= lng <= 180):
        raise HTTPException(422, "Longitude must be between -180 and 180.")
    if radius is None or radius <= 0:
        raise HTTPException(422, "Radius must be a positive number of metres.")
    if radius > 5000:
        raise HTTPException(422, "Radius above 5000 m is not allowed.")


class LocationIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=140)
    code: Optional[str] = Field(None, max_length=30)
    location_type: str = "branch_office"
    address: str = ""
    emirate: str = ""
    country: str = "United Arab Emirates"
    latitude: float
    longitude: float
    radius_m: int
    max_accuracy_m: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    opening_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    closing_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    working_days: Optional[str] = None
    manager_id: Optional[int] = None
    notes: str = ""
    activate: bool = False          # explicit confirmation required to go live
    change_reason: Optional[str] = None


def _loc_dict(l: WorkLocation, db: Session):
    assigned = db.query(EmployeeLocationAssignment).filter_by(
        location_id=l.id, status="active").count()
    return {"id": l.id, "name": l.name, "code": l.code, "type": l.location_type,
            "address": l.address, "emirate": l.emirate, "country": l.country,
            "latitude": l.latitude, "longitude": l.longitude, "radius_m": l.radius_m,
            "max_accuracy_m": l.max_accuracy_m, "status": l.status,
            "effective_from": l.effective_from, "effective_to": l.effective_to,
            "opening_time": l.opening_time, "closing_time": l.closing_time,
            "working_days": l.working_days, "manager_id": l.manager_id,
            "notes": l.notes, "assigned_employees": assigned}


@router.get("")
def list_locations(db: Session = Depends(get_db),
                   actor=Depends(require_perm("locations.view", "locations.manage"))):
    return [_loc_dict(l, db) for l in
            db.query(WorkLocation).order_by(WorkLocation.name).all()]


@router.get("/types")
def location_types(actor=Depends(active_user)):
    return {"location_types": LOCATION_TYPES, "assignment_types": ASSIGNMENT_TYPES,
            "checkout_rules": CHECKOUT_RULES,
            "default_max_accuracy_m": settings.MAX_GPS_ACCURACY_M}


@router.post("", status_code=201)
def create_location(body: LocationIn, request: Request,
                    db: Session = Depends(get_db),
                    actor=Depends(require_perm("locations.manage"))):
    _validate_coords(body.latitude, body.longitude, body.radius_m)
    if body.code and db.query(WorkLocation).filter_by(code=body.code).first():
        raise HTTPException(409, "That location code is already used.")
    if body.location_type not in LOCATION_TYPES:
        raise HTTPException(422, "Unknown location type.")
    l = WorkLocation(**{k: v for k, v in body.dict().items()
                        if k not in ("activate", "change_reason")},
                     status="active" if body.activate else "draft",
                     created_by=actor.id, updated_by=actor.id)
    db.add(l); db.flush()
    audit(db, actor.id, "location.create", "work_location", l.id,
          f"name={l.name} lat={l.latitude} lng={l.longitude} r={l.radius_m}m "
          f"status={l.status}", _ip(request))
    db.commit()
    return _loc_dict(l, db)


@router.patch("/{loc_id}")
def update_location(loc_id: int, body: LocationIn, request: Request,
                    db: Session = Depends(get_db),
                    actor=Depends(require_perm("locations.manage"))):
    l = db.query(WorkLocation).get(loc_id)
    if not l:
        raise HTTPException(404, "Location not found.")
    _validate_coords(body.latitude, body.longitude, body.radius_m)
    geo_changed = (abs(l.latitude - body.latitude) > 1e-9 or
                   abs(l.longitude - body.longitude) > 1e-9 or
                   l.radius_m != body.radius_m)
    if l.status == "active" and geo_changed and not (body.change_reason or "").strip():
        raise HTTPException(422, "Changing an active location's coordinates or "
                                 "radius requires a reason.")
    before = {"lat": l.latitude, "lng": l.longitude, "radius_m": l.radius_m,
              "status": l.status, "name": l.name}
    for k, v in body.dict().items():
        if k in ("activate", "change_reason"):
            continue
        setattr(l, k, v)
    if body.activate and l.status != "active":
        l.status = "active"
    l.updated_by = actor.id
    after = {"lat": l.latitude, "lng": l.longitude, "radius_m": l.radius_m,
             "status": l.status, "name": l.name}
    audit(db, actor.id, "location.update", "work_location", l.id,
          f"before={before} after={after} reason={body.change_reason or '-'}",
          _ip(request))
    db.commit()
    return _loc_dict(l, db)


class StatusIn(BaseModel):
    status: str = Field(..., pattern="^(active|inactive|expired)$")
    reason: str = Field(..., min_length=3, max_length=240)
    confirm: bool = False


@router.post("/{loc_id}/status")
def set_status(loc_id: int, body: StatusIn, request: Request,
               db: Session = Depends(get_db),
               actor=Depends(require_perm("locations.manage"))):
    l = db.query(WorkLocation).get(loc_id)
    if not l:
        raise HTTPException(404, "Location not found.")
    if body.status == "active" and not body.confirm:
        raise HTTPException(422, "Activating a location requires explicit confirmation.")
    before = l.status
    l.status = body.status
    l.updated_by = actor.id
    audit(db, actor.id, "location.status", "work_location", l.id,
          f"{before} -> {l.status} reason={body.reason}", _ip(request))
    db.commit()
    return {"ok": True, "status": l.status}


class TestPointIn(BaseModel):
    latitude: float
    longitude: float


@router.post("/{loc_id}/test")
def test_point(loc_id: int, body: TestPointIn, db: Session = Depends(get_db),
               actor=Depends(require_perm("locations.manage", "locations.view"))):
    l = db.query(WorkLocation).get(loc_id)
    if not l:
        raise HTTPException(404, "Location not found.")
    _validate_coords(body.latitude, body.longitude, l.radius_m)
    d = haversine_m(body.latitude, body.longitude, l.latitude, l.longitude)
    return {"distance_m": round(d), "radius_m": l.radius_m, "inside": d <= l.radius_m}


# ---------------------------------------------------------------------------
# Employee-location assignments
# ---------------------------------------------------------------------------
class AssignIn(BaseModel):
    employee_ids: List[int] = Field(..., min_length=1)
    location_id: int
    assignment_type: str = "primary"
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    allowed_checkin: bool = True
    allowed_checkout: bool = True
    allowed_days: Optional[str] = None
    allowed_start: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    allowed_end: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    checkout_rule: str = "same_location"
    notes: str = ""


@router.post("/assignments", status_code=201)
def assign_employees(body: AssignIn, request: Request,
                     db: Session = Depends(get_db),
                     actor=Depends(require_perm("locations.assign", "locations.manage"))):
    l = db.query(WorkLocation).get(body.location_id)
    if not l:
        raise HTTPException(404, "Location not found.")
    if body.assignment_type not in ASSIGNMENT_TYPES:
        raise HTTPException(422, "Unknown assignment type.")
    if body.checkout_rule not in CHECKOUT_RULES:
        raise HTTPException(422, "Unknown check-out rule.")
    if body.effective_from and body.effective_to and body.effective_to < body.effective_from:
        raise HTTPException(422, "effective_to is before effective_from.")
    created = []
    for emp_id in set(body.employee_ids):
        target = db.query(Employee).get(emp_id)
        if not target:
            raise HTTPException(404, f"Employee {emp_id} not found.")
        # Managers may only assign inside their authorised scope.
        if not has_perm(db, actor, "locations.manage") and \
           not actor_scope_covers(db, actor, target, "locations.assign"):
            raise HTTPException(403, f"{target.full_name} is outside your "
                                     "authorised scope.")
        a = EmployeeLocationAssignment(
            employee_id=emp_id, location_id=l.id,
            assignment_type=body.assignment_type,
            effective_from=body.effective_from, effective_to=body.effective_to,
            allowed_checkin=body.allowed_checkin,
            allowed_checkout=body.allowed_checkout,
            allowed_days=body.allowed_days, allowed_start=body.allowed_start,
            allowed_end=body.allowed_end, checkout_rule=body.checkout_rule,
            assigned_by=actor.id, notes=body.notes)
        db.add(a); db.flush()
        created.append(a.id)
        audit(db, actor.id, "location.assign", "employee_location_assignment",
              a.id, f"employee={emp_id} location={l.name} type={body.assignment_type} "
                    f"window={body.effective_from}..{body.effective_to}", _ip(request))
    db.commit()
    return {"assignment_ids": created}


@router.get("/assignments")
def list_assignments(employee_id: Optional[int] = None,
                     location_id: Optional[int] = None,
                     db: Session = Depends(get_db),
                     actor=Depends(require_perm("locations.view", "locations.manage",
                                                "locations.assign"))):
    q = db.query(EmployeeLocationAssignment)
    if employee_id:
        q = q.filter_by(employee_id=employee_id)
    if location_id:
        q = q.filter_by(location_id=location_id)
    out = []
    for a in q.order_by(EmployeeLocationAssignment.assigned_at.desc()).limit(1000):
        emp = db.query(Employee).get(a.employee_id)
        loc = db.query(WorkLocation).get(a.location_id)
        out.append({"id": a.id, "employee_id": a.employee_id,
                    "employee": emp.full_name if emp else "?",
                    "location_id": a.location_id,
                    "location": loc.name if loc else "?",
                    "type": a.assignment_type, "status": a.status,
                    "effective_from": a.effective_from, "effective_to": a.effective_to,
                    "allowed_checkin": a.allowed_checkin,
                    "allowed_checkout": a.allowed_checkout,
                    "checkout_rule": a.checkout_rule, "notes": a.notes})
    return out


class RevokeAssignIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=240)


@router.post("/assignments/{assignment_id}/revoke")
def revoke_assignment(assignment_id: int, body: RevokeAssignIn, request: Request,
                      db: Session = Depends(get_db),
                      actor=Depends(require_perm("locations.assign", "locations.manage"))):
    a = db.query(EmployeeLocationAssignment).get(assignment_id)
    if not a or a.status != "active":
        raise HTTPException(404, "Active assignment not found.")
    a.status = "revoked"
    audit(db, actor.id, "location.unassign", "employee_location_assignment",
          a.id, f"reason={body.reason}", _ip(request))
    db.commit()
    return {"ok": True}


@router.get("/assignments/export")
def export_assignments(db: Session = Depends(get_db),
                       actor=Depends(require_perm("locations.manage", "locations.assign"))):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["assignment_id", "employee", "email", "location", "type", "status",
                "from", "to", "checkin", "checkout", "checkout_rule"])
    for a in db.query(EmployeeLocationAssignment).all():
        emp = db.query(Employee).get(a.employee_id)
        loc = db.query(WorkLocation).get(a.location_id)
        w.writerow([a.id, emp.full_name if emp else "?", emp.work_email if emp else "?",
                    loc.name if loc else "?", a.assignment_type, a.status,
                    a.effective_from, a.effective_to, a.allowed_checkin,
                    a.allowed_checkout, a.checkout_rule])
    buf.seek(0)
    return StreamingResponse(iter([buf.read()]), media_type="text/csv",
                             headers={"Content-Disposition":
                                      "attachment; filename=location_assignments.csv"})


# ---------------------------------------------------------------------------
# Temporary locations (request -> approval -> auto-expiring location)
# ---------------------------------------------------------------------------
class TempLocIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=140)
    latitude: float
    longitude: float
    radius_m: int
    valid_from: datetime
    valid_to: datetime
    reason: str = Field(..., min_length=5, max_length=400)
    employee_ids: List[int] = Field(..., min_length=1)


@router.post("/temporary", status_code=201)
def request_temporary(body: TempLocIn, request: Request,
                      db: Session = Depends(get_db),
                      actor=Depends(require_perm("locations.temp.request",
                                                 "locations.temp.approve",
                                                 "locations.manage"))):
    _validate_coords(body.latitude, body.longitude, body.radius_m)
    if body.valid_to <= body.valid_from:
        raise HTTPException(422, "valid_to must be after valid_from.")
    if actor.id in body.employee_ids and not has_perm(db, actor, "locations.temp.approve"):
        # requesters may include themselves, but can never self-approve below
        pass
    t = TemporaryLocationRequest(
        name=body.name, latitude=body.latitude, longitude=body.longitude,
        radius_m=body.radius_m, valid_from=body.valid_from, valid_to=body.valid_to,
        reason=body.reason, employee_ids=",".join(str(i) for i in set(body.employee_ids)),
        requested_by=actor.id)
    db.add(t); db.flush()
    audit(db, actor.id, "location.temp.request", "temporary_location_request",
          t.id, f"name={t.name} window={t.valid_from}..{t.valid_to}", _ip(request))
    db.commit()
    return {"request_id": t.id, "status": t.status}


class TempDecideIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=300)


@router.post("/temporary/{req_id}/decide")
def decide_temporary(req_id: int, body: TempDecideIn, request: Request,
                     db: Session = Depends(get_db),
                     actor=Depends(require_perm("locations.temp.approve",
                                                "locations.manage"))):
    t = db.query(TemporaryLocationRequest).get(req_id)
    if not t or t.status != "pending":
        raise HTTPException(404, "Pending request not found.")
    if t.requested_by == actor.id:
        raise HTTPException(409, "You cannot approve your own temporary-location request.")
    t.approver_id = actor.id
    t.decided_at = datetime.now(timezone.utc)
    t.decision_note = body.note
    if not body.approve:
        t.status = "rejected"
        audit(db, actor.id, "location.temp.reject", "temporary_location_request",
              t.id, body.note, _ip(request))
        db.commit()
        return {"status": t.status}
    l = WorkLocation(name=t.name, location_type="temporary_site",
                     latitude=t.latitude, longitude=t.longitude,
                     radius_m=t.radius_m, status="active",
                     effective_from=t.valid_from.date(),
                     effective_to=t.valid_to.date(),
                     notes=f"Temporary — request #{t.id}: {t.reason}",
                     created_by=actor.id, updated_by=actor.id)
    db.add(l); db.flush()
    for emp_id in t.employee_ids.split(","):
        db.add(EmployeeLocationAssignment(
            employee_id=int(emp_id), location_id=l.id, assignment_type="temporary",
            effective_from=t.valid_from.date(), effective_to=t.valid_to.date(),
            checkout_rule="same_location", assigned_by=actor.id,
            notes=f"Temporary request #{t.id}"))
    t.status = "approved"
    t.created_location_id = l.id
    audit(db, actor.id, "location.temp.approve", "temporary_location_request",
          t.id, f"created_location={l.id}", _ip(request))
    db.commit()
    return {"status": t.status, "location_id": l.id}


@router.get("/temporary")
def list_temporary(db: Session = Depends(get_db),
                   actor=Depends(require_perm("locations.temp.request",
                                              "locations.temp.approve",
                                              "locations.manage"))):
    rows = db.query(TemporaryLocationRequest).order_by(
        TemporaryLocationRequest.requested_at.desc()).limit(200).all()
    return [{"id": t.id, "name": t.name, "status": t.status, "reason": t.reason,
             "valid_from": t.valid_from, "valid_to": t.valid_to,
             "requested_by": t.requested_by, "approver_id": t.approver_id,
             "employee_ids": t.employee_ids} for t in rows]


# ---------------------------------------------------------------------------
# Attendance exception requests
# ---------------------------------------------------------------------------
EXCEPTION_REASONS = ["client_meeting", "emergency_site_visit", "gps_failure",
                     "device_failure", "temporary_assignment", "business_travel",
                     "remote_work_authorised"]


class ExceptionIn(BaseModel):
    requested_action: str = Field(..., pattern="^(checkin|checkout)$")
    requested_for: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    reason_code: str
    reason_text: str = Field("", max_length=500)
    attachment_name: Optional[str] = None


@router.post("/exceptions", status_code=201)
def request_exception(body: ExceptionIn, request: Request,
                      db: Session = Depends(get_db),
                      emp: Employee = Depends(active_user)):
    if body.reason_code not in EXCEPTION_REASONS:
        raise HTTPException(422, "Unknown reason code.")
    nearest_id, dist = None, None
    if body.latitude is not None and body.longitude is not None:
        best = None
        for l in db.query(WorkLocation).filter_by(status="active"):
            d = haversine_m(body.latitude, body.longitude, l.latitude, l.longitude)
            if best is None or d < best[1]:
                best = (l.id, d)
        if best:
            nearest_id, dist = best
    x = AttendanceExceptionRequest(
        employee_id=emp.id, requested_action=body.requested_action,
        requested_for=body.requested_for, latitude=body.latitude,
        longitude=body.longitude, nearest_location_id=nearest_id,
        distance_m=dist, reason_code=body.reason_code,
        reason_text=body.reason_text, attachment_name=body.attachment_name)
    db.add(x); db.flush()
    audit(db, emp.id, "attendance.exception.request",
          "attendance_exception_request", x.id,
          f"action={body.requested_action} reason={body.reason_code} "
          f"nearest={nearest_id} dist={dist and round(dist)}", _ip(request))
    db.commit()
    return {"request_id": x.id, "status": x.status}


class ExceptionDecideIn(BaseModel):
    approve: bool
    comment: str = Field(..., min_length=2, max_length=300)


@router.post("/exceptions/{req_id}/decide")
def decide_exception(req_id: int, body: ExceptionDecideIn, request: Request,
                     db: Session = Depends(get_db),
                     actor=Depends(require_perm("attendance.exception.manager",
                                                "attendance.exception.hr"))):
    from app.models.core import AttendancePunch, PunchResult
    x = db.query(AttendanceExceptionRequest).get(req_id)
    if not x:
        raise HTTPException(404, "Request not found.")
    target = db.query(Employee).get(x.employee_id)
    now = datetime.now(timezone.utc)
    if x.status == "pending_manager":
        is_mgr = target and target.manager_id == actor.id
        if not (is_mgr or has_perm(db, actor, "attendance.exception.hr")):
            raise HTTPException(403, "Only the employee's manager can act at this stage.")
        x.manager_id, x.manager_comment, x.manager_at = actor.id, body.comment, now
        x.status = "pending_hr" if body.approve else "rejected"
    elif x.status == "pending_hr":
        if not has_perm(db, actor, "attendance.exception.hr"):
            raise HTTPException(403, "HR stage requires the HR exception permission.")
        x.hr_id, x.hr_comment, x.hr_at = actor.id, body.comment, now
        if body.approve:
            x.status = "approved"
            # Adjusted event: a separate accepted punch. Original rejections stay.
            p = AttendancePunch(
                employee_id=x.employee_id,
                punch_type=PunchType.checkin if x.requested_action == "checkin"
                           else PunchType.checkout,
                server_time=x.requested_for, latitude=x.latitude,
                longitude=x.longitude, method="exception",
                result=PunchResult.accepted,
                reject_reason=None, reject_code=None,
                location_id=x.nearest_location_id,
                distance_from_site_m=x.distance_m)
            db.add(p); db.flush()
            x.created_punch_id = p.id
        else:
            x.status = "rejected"
    else:
        raise HTTPException(409, f"Request is already {x.status}.")
    audit(db, actor.id, "attendance.exception.decision",
          "attendance_exception_request", x.id,
          f"status={x.status} comment={body.comment}", _ip(request))
    db.commit()
    return {"status": x.status, "created_punch_id": x.created_punch_id}


@router.get("/exceptions")
def list_exceptions(mine: bool = False, db: Session = Depends(get_db),
                    emp: Employee = Depends(active_user)):
    q = db.query(AttendanceExceptionRequest)
    if mine or not (has_perm(db, emp, "attendance.exception.manager")
                    or has_perm(db, emp, "attendance.exception.hr")):
        q = q.filter_by(employee_id=emp.id)
    rows = q.order_by(AttendanceExceptionRequest.created_at.desc()).limit(200).all()
    return [{"id": x.id, "employee_id": x.employee_id,
             "action": x.requested_action, "for": x.requested_for,
             "status": x.status, "reason_code": x.reason_code,
             "reason_text": x.reason_text, "distance_m": x.distance_m,
             "nearest_location_id": x.nearest_location_id} for x in rows]
