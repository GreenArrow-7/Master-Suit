"""Strict server-side attendance validation.

The browser only reports raw coordinates; every decision below happens here.
Each rejection carries a machine code and a human message, and every attempt
(accepted or rejected) is recorded by the caller in attendance_punches.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.core import AttendancePunch, Employee, EmploymentStatus, PunchResult, PunchType
from app.models.locations import (
    AttendanceDay, EmployeeLocationAssignment, WorkLocation,
)
from app.services.rules import haversine_m

DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class PunchRejected(Exception):
    def __init__(self, code: str, message: str, result: PunchResult,
                 location: Optional[WorkLocation] = None,
                 distance: Optional[float] = None):
        self.code, self.message, self.result = code, message, result
        self.location, self.distance = location, distance
        super().__init__(message)


@dataclass
class PunchContext:
    assignment: EmployeeLocationAssignment
    location: WorkLocation
    distance_m: float


def _now():
    return datetime.now(timezone.utc)


def _in_date_window(frm: Optional[date], to: Optional[date], today: date) -> bool:
    if frm and frm > today:
        return False
    if to and to < today:
        return False
    return True


def _parse_hm(s: Optional[str]):
    if not s:
        return None
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _day_allowed(csv: Optional[str], today: date) -> bool:
    if not csv:
        return True
    return DAY_KEYS[today.weekday()] in [d.strip() for d in csv.split(",")]


def _time_allowed(start: Optional[str], end: Optional[str], now: datetime) -> bool:
    s, e = _parse_hm(start), _parse_hm(end)
    if s is None or e is None:
        return True
    cur = now.hour * 60 + now.minute
    if s <= e:
        return s <= cur <= e
    return cur >= s or cur <= e            # overnight window


def location_valid_now(loc: WorkLocation, now: datetime) -> tuple[bool, str]:
    if loc.status != "active":
        return False, "This location is not active."
    if not _in_date_window(loc.effective_from, loc.effective_to, now.date()):
        return False, "This location is outside its validity dates."
    return True, ""


def assignment_valid_now(a: EmployeeLocationAssignment, action: PunchType,
                         now: datetime) -> tuple[bool, str]:
    if a.status != "active":
        return False, "assignment inactive"
    if not _in_date_window(a.effective_from, a.effective_to, now.date()):
        return False, "assignment outside dates"
    if action == PunchType.checkin and not a.allowed_checkin:
        return False, "check-in disabled on this assignment"
    if action == PunchType.checkout and not a.allowed_checkout:
        return False, "check-out disabled on this assignment"
    return True, ""


def candidate_assignments(db: Session, emp: Employee, action: PunchType,
                          now: datetime) -> list[tuple[EmployeeLocationAssignment, WorkLocation]]:
    rows = (db.query(EmployeeLocationAssignment)
              .filter(EmployeeLocationAssignment.employee_id == emp.id).all())
    out = []
    for a in rows:
        ok, _ = assignment_valid_now(a, action, now)
        if not ok:
            continue
        loc = db.query(WorkLocation).get(a.location_id)
        if not loc:
            continue
        ok, _ = location_valid_now(loc, now)
        if not ok:
            continue
        if not _day_allowed(a.allowed_days or loc.working_days, now.date()):
            continue
        if not _time_allowed(a.allowed_start or loc.opening_time,
                             a.allowed_end or loc.closing_time, now):
            continue
        out.append((a, loc))
    return out


def open_checkin(db: Session, emp: Employee) -> Optional[AttendancePunch]:
    """Latest accepted punch today (or yesterday for overnight) that is a
    check-in without a later accepted check-out."""
    last = (db.query(AttendancePunch)
              .filter(AttendancePunch.employee_id == emp.id,
                      AttendancePunch.result == PunchResult.accepted)
              .order_by(AttendancePunch.server_time.desc()).first())
    if last and last.punch_type == PunchType.checkin:
        return last
    return None


def validate_punch(db: Session, emp: Employee, action: PunchType,
                   lat: float, lng: float, accuracy_m: float,
                   enforce_geofence: bool = True) -> PunchContext:
    now = _now()

    # 1-2. account + employment
    if not emp.is_active:
        raise PunchRejected("ACCOUNT_INACTIVE", "Your account is inactive.",
                            PunchResult.rejected_duplicate)
    if emp.status not in (EmploymentStatus.active, EmploymentStatus.notice,
                          EmploymentStatus.onboarding):
        raise PunchRejected("EMPLOYMENT_INACTIVE",
                            "You have no active employment record.",
                            PunchResult.rejected_duplicate)

    # 15-16. sequence rules
    open_p = open_checkin(db, emp)
    if action == PunchType.checkin and open_p:
        raise PunchRejected("ALREADY_CHECKED_IN",
                            "You already have an open check-in. Check out first.",
                            PunchResult.rejected_duplicate)
    if action == PunchType.checkout and not open_p:
        raise PunchRejected("NO_OPEN_CHECKIN",
                            "There is no open check-in to close. If you forgot to "
                            "check in, submit an attendance exception request.",
                            PunchResult.rejected_duplicate)

    # 3-10. assignments and locations
    cands = candidate_assignments(db, emp, action, now)
    if not cands:
        raise PunchRejected("NO_ACTIVE_ASSIGNMENT",
                            "You have no active work-location assignment valid "
                            "right now. Contact HR, or submit an exception request.",
                            PunchResult.rejected_geofence)

    # Check-out rule: restrict candidates before measuring distance.
    if action == PunchType.checkout and open_p:
        in_loc_id = open_p.location_id
        in_asg = next((a for a, _ in cands if a.location_id == in_loc_id), None)
        rule = (in_asg.checkout_rule if in_asg else "same_location")
        if rule == "exception_only":
            raise PunchRejected("CHECKOUT_REQUIRES_EXCEPTION",
                                "Check-out from this assignment requires an approved "
                                "attendance exception.", PunchResult.rejected_geofence)
        if rule == "same_location":
            same = [(a, l) for a, l in cands if l.id == in_loc_id]
            if not same:
                raise PunchRejected("CHECKOUT_WRONG_LOCATION",
                                    "Check-out must happen at the same location you "
                                    "checked in from.", PunchResult.rejected_geofence)
            cands = same

    # 12. accuracy — strictest applicable threshold
    best = None
    for a, loc in cands:
        max_acc = loc.max_accuracy_m or settings.MAX_GPS_ACCURACY_M
        dist = haversine_m(lat, lng, loc.latitude, loc.longitude)
        if best is None or dist < best[2]:
            best = (a, loc, dist, max_acc)
    a, loc, dist, max_acc = best
    if accuracy_m and accuracy_m > max_acc:
        raise PunchRejected(
            "LOCATION_ACCURACY_TOO_LOW",
            f"Your GPS location is not accurate enough (±{accuracy_m:.0f} m, "
            f"allowed ±{max_acc} m). Move to an open area and try again.",
            PunchResult.rejected_accuracy, loc, dist)

    # 13. geofence — nearest candidate decides the message. When the caller
    # defers enforcement (face flow: the liveness nonce must be consumed before
    # the geofence verdict so rejected payloads are never replayable), the
    # nearest candidate is returned and geofence_rejection() is applied later.
    inside = [(x, l, haversine_m(lat, lng, l.latitude, l.longitude))
              for x, l in cands
              if haversine_m(lat, lng, l.latitude, l.longitude) <= l.radius_m]
    if not inside:
        if enforce_geofence:
            raise geofence_rejection(loc, dist)
        return PunchContext(assignment=a, location=loc, distance_m=dist)
    a, loc, dist = min(inside, key=lambda t: t[2])
    return PunchContext(assignment=a, location=loc, distance_m=dist)


def geofence_rejection(loc: WorkLocation, dist: float) -> PunchRejected:
    return PunchRejected(
        "OUTSIDE_APPROVED_LOCATION",
        f"You are {dist:.0f} metres away from {loc.name}. The permitted "
        f"radius is {loc.radius_m} metres. Move inside the approved location "
        "and try again, or submit an attendance exception request.",
        PunchResult.rejected_geofence, loc, dist)


def upsert_day(db: Session, emp: Employee, punch: AttendancePunch):
    d = punch.server_time.date()
    row = (db.query(AttendanceDay)
             .filter_by(employee_id=emp.id, day=d).first())
    if punch.punch_type == PunchType.checkin:
        if not row:
            row = AttendanceDay(employee_id=emp.id, day=d)
            db.add(row)
        row.checkin_at = punch.server_time
        row.checkin_location_id = punch.location_id
        row.status = "open"
    else:
        if not row:
            # overnight shift: close yesterday's open day
            row = (db.query(AttendanceDay)
                     .filter_by(employee_id=emp.id, status="open")
                     .order_by(AttendanceDay.day.desc()).first())
        if row and row.checkin_at:
            row.checkout_at = punch.server_time
            row.checkout_location_id = punch.location_id
            ci, co = row.checkin_at, punch.server_time
            if ci.tzinfo is None:
                ci = ci.replace(tzinfo=timezone.utc)
            if co.tzinfo is None:
                co = co.replace(tzinfo=timezone.utc)
            row.worked_minutes = int((co - ci).total_seconds() // 60)
            row.status = "complete"
