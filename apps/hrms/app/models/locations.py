"""Admin-managed attendance locations, employee assignments, temporary
locations, exception requests and day summaries.

The authoritative geofence lives in this database, never in the browser.
Attendance events snapshot the coordinates/radius that were in force at punch
time, so editing a location later never rewrites historical evidence.
"""
import enum
from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint, Index,
)
from app.core.db import Base
from app.models.core import utcnow

LOCATION_TYPES = ["head_office", "branch_office", "sales_office", "property",
                  "construction_site", "project_site", "temporary_site",
                  "client_site", "warehouse", "remote_approved"]


class WorkLocation(Base):
    __tablename__ = "work_locations"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    name = Column(String(140), nullable=False)
    code = Column(String(30), unique=True, index=True)
    location_type = Column(String(30), default="branch_office", nullable=False)
    address = Column(String(300), default="")
    emirate = Column(String(60), default="")
    country = Column(String(60), default="United Arab Emirates")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_m = Column(Integer, nullable=False)
    max_accuracy_m = Column(Integer)               # null = system default
    effective_from = Column(Date)
    effective_to = Column(Date)
    opening_time = Column(String(5))               # "08:00"; null = any time
    closing_time = Column(String(5))
    working_days = Column(String(30))              # "Mon,Tue,..."; null = all days
    manager_id = Column(Integer, ForeignKey("employees.id"))
    status = Column(String(20), default="draft", nullable=False)  # draft|active|inactive|expired
    notes = Column(Text, default="")
    created_by = Column(Integer, ForeignKey("employees.id"))
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_by = Column(Integer, ForeignKey("employees.id"))
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_workloc_org_status", "organisation_id", "status"),)


ASSIGNMENT_TYPES = ["primary", "secondary", "temporary", "project", "property", "emergency"]
CHECKOUT_RULES = ["same_location", "any_assigned", "exception_only"]


class EmployeeLocationAssignment(Base):
    __tablename__ = "employee_location_assignments"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("work_locations.id"), nullable=False, index=True)
    assignment_type = Column(String(20), default="primary", nullable=False)
    effective_from = Column(Date)
    effective_to = Column(Date)
    allowed_checkin = Column(Boolean, default=True, nullable=False)
    allowed_checkout = Column(Boolean, default=True, nullable=False)
    allowed_days = Column(String(30))              # null = inherit location
    allowed_start = Column(String(5))              # null = inherit location opening
    allowed_end = Column(String(5))
    checkout_rule = Column(String(20), default="same_location", nullable=False)
    assigned_by = Column(Integer, ForeignKey("employees.id"))
    assigned_at = Column(DateTime(timezone=True), default=utcnow)
    status = Column(String(20), default="active", nullable=False)  # active|revoked|expired
    notes = Column(String(300), default="")

    __table_args__ = (
        Index("ix_ela_emp_active", "employee_id", "status", "effective_from", "effective_to"),
    )


class TemporaryLocationRequest(Base):
    __tablename__ = "temporary_location_requests"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    name = Column(String(140), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_m = Column(Integer, nullable=False)
    valid_from = Column(DateTime(timezone=True), nullable=False)
    valid_to = Column(DateTime(timezone=True), nullable=False)
    reason = Column(String(400), nullable=False)
    employee_ids = Column(String(600), nullable=False)   # CSV of employee ids
    requested_by = Column(Integer, ForeignKey("employees.id"), nullable=False)
    requested_at = Column(DateTime(timezone=True), default=utcnow)
    status = Column(String(20), default="pending", nullable=False)  # pending|approved|rejected|expired
    approver_id = Column(Integer, ForeignKey("employees.id"))
    decided_at = Column(DateTime(timezone=True))
    decision_note = Column(String(300))
    created_location_id = Column(Integer, ForeignKey("work_locations.id"))


class AttendanceExceptionRequest(Base):
    __tablename__ = "attendance_exception_requests"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    requested_action = Column(String(10), nullable=False)      # checkin|checkout
    requested_for = Column(DateTime(timezone=True), nullable=False)
    latitude = Column(Float)
    longitude = Column(Float)
    nearest_location_id = Column(Integer, ForeignKey("work_locations.id"))
    distance_m = Column(Float)
    reason_code = Column(String(40), nullable=False)
    reason_text = Column(String(500), default="")
    attachment_name = Column(String(200))
    status = Column(String(30), default="pending_manager", nullable=False)
    manager_id = Column(Integer, ForeignKey("employees.id"))
    manager_comment = Column(String(300))
    manager_at = Column(DateTime(timezone=True))
    hr_id = Column(Integer, ForeignKey("employees.id"))
    hr_comment = Column(String(300))
    hr_at = Column(DateTime(timezone=True))
    created_punch_id = Column(Integer, ForeignKey("attendance_punches.id"))
    created_at = Column(DateTime(timezone=True), default=utcnow)


class AttendanceChallenge(Base):
    """Persisted liveness challenges (previously in-memory)."""
    __tablename__ = "attendance_challenges"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    nonce = Column(String(64), unique=True, nullable=False)
    direction = Column(String(10), nullable=False)
    issued_at = Column(DateTime(timezone=True), default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True))


class AttendanceDay(Base):
    __tablename__ = "attendance_days"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    day = Column(Date, nullable=False)
    checkin_at = Column(DateTime(timezone=True))
    checkout_at = Column(DateTime(timezone=True))
    checkin_location_id = Column(Integer, ForeignKey("work_locations.id"))
    checkout_location_id = Column(Integer, ForeignKey("work_locations.id"))
    worked_minutes = Column(Integer, default=0)
    status = Column(String(30), default="open")    # open|complete|adjusted
    __table_args__ = (UniqueConstraint("employee_id", "day"),)
