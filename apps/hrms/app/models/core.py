import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum, Float, ForeignKey, Integer,
    LargeBinary, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.db import Base


def utcnow():
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    employee = "employee"
    manager = "manager"
    hr = "hr"
    admin = "admin"


class EmploymentStatus(str, enum.Enum):
    onboarding = "onboarding"
    active = "active"
    notice = "notice"
    exited = "exited"


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True)
    employee_code = Column(String(20), unique=True, nullable=False, index=True)
    full_name = Column(String(160), nullable=False)
    work_email = Column(String(160), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(Role), default=Role.employee, nullable=False)

    designation = Column(String(120))
    department = Column(String(120))
    manager_id = Column(Integer, ForeignKey("employees.id"))
    home_site_id = Column(Integer, ForeignKey("sites.id"))

    date_of_joining = Column(Date, nullable=False)
    date_of_exit = Column(Date)
    status = Column(Enum(EmploymentStatus), default=EmploymentStatus.onboarding, nullable=False)
    basic_salary = Column(Float, default=0.0)      # drives gratuity + leave encashment
    total_salary = Column(Float, default=0.0)

    # Real-estate specific
    rera_brn = Column(String(40))
    rera_expiry = Column(Date)

    is_active = Column(Boolean, default=True, nullable=False)
    must_change_password = Column(Boolean, default=True, nullable=False)
    biometric_consent_at = Column(DateTime(timezone=True))
    # Fallback for anyone who declines face check-in. Never store the PIN itself.
    # RETIRED. PIN check-in was removed: face verification is the only path.
    # The column is retained because dropping it requires a full table rebuild
    # on SQLite and it holds no value once unreferenced. Nothing reads or writes
    # it. Drop it in a dedicated migration when you next rebuild the table.
    attendance_pin_hash = Column(String(255))

    # Two-factor authentication (authenticator app). The secret is encrypted at
    # rest; totp_last_timestep blocks replay of a code inside its 30s window.
    totp_secret_encrypted = Column(Text)
    totp_enabled = Column(Boolean, default=False, nullable=False)
    totp_confirmed_at = Column(DateTime(timezone=True))
    totp_last_timestep = Column(Integer)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    manager = relationship("Employee", remote_side=[id])
    face_templates = relationship("FaceTemplate", back_populates="employee")


class Site(Base):
    """A geofenced work location: head office, sales gallery, project site."""
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True)
    name = Column(String(140), nullable=False, unique=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_m = Column(Integer, default=150, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)


class FaceTemplate(Base):
    """Stores embeddings only. Raw face images are never persisted."""
    __tablename__ = "face_templates"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    embedding = Column(LargeBinary, nullable=False)   # float32 vector, np.tobytes()
    dim = Column(Integer, nullable=False, default=512)
    model_version = Column(String(40), nullable=False, default="buffalo_l")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    employee = relationship("Employee", back_populates="face_templates")


class PunchType(str, enum.Enum):
    checkin = "checkin"
    checkout = "checkout"


class PunchResult(str, enum.Enum):
    accepted = "accepted"
    rejected_face = "rejected_face"
    rejected_liveness = "rejected_liveness"
    rejected_geofence = "rejected_geofence"
    rejected_accuracy = "rejected_accuracy"
    rejected_duplicate = "rejected_duplicate"
    rejected_stale_sync = "rejected_stale_sync"
    flagged_review = "flagged_review"


class AttendancePunch(Base):
    __tablename__ = "attendance_punches"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    punch_type = Column(Enum(PunchType), nullable=False)
    # Server-side clock is authoritative. Client time kept only for drift forensics.
    server_time = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    client_time = Column(DateTime(timezone=True))

    site_id = Column(Integer, ForeignKey("sites.id"))
    latitude = Column(Float)
    longitude = Column(Float)
    gps_accuracy_m = Column(Float)
    distance_from_site_m = Column(Float)

    face_score = Column(Float)
    liveness_score = Column(Float)
    method = Column(String(20), default="face")   # face | pin
    client_punch_uid = Column(String(64), index=True)   # dedupe key for offline sync
    device_fingerprint = Column(String(120))
    mock_location_flag = Column(Boolean, default=False)

    # Relative path inside the encrypted attendance vault (see face_vault.py).
    # The image itself is never stored in the database or in the clear.
    capture_path = Column(String(255))

    result = Column(Enum(PunchResult), nullable=False)
    reject_reason = Column(String(240))
    reject_code = Column(String(50))
    synced_offline = Column(Boolean, default=False)

    # Location evidence snapshot — the geofence values in force at punch time.
    # Editing a work location later must NEVER change these.
    location_id = Column(Integer, ForeignKey("work_locations.id"))
    loc_latitude = Column(Float)
    loc_longitude = Column(Float)
    loc_radius_m = Column(Integer)
    loc_max_accuracy_m = Column(Integer)
    server_ip = Column(String(64))
    request_id = Column(String(36))


class AuditLog(Base):
    """Append-only. Never update or delete rows here."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("employees.id"))
    action = Column(String(80), nullable=False)
    entity = Column(String(60), nullable=False)
    entity_id = Column(String(40))
    detail = Column(Text)
    ip_address = Column(String(64))


class LeaveType(Base):
    __tablename__ = "leave_types"

    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)
    name = Column(String(90), nullable=False)
    annual_entitlement_days = Column(Float, default=0)
    is_paid = Column(Boolean, default=True)
    accrues = Column(Boolean, default=False)
    max_carry_forward_days = Column(Float, default=0)
    requires_document = Column(Boolean, default=False)


class LeaveStatus(str, enum.Enum):
    draft = "draft"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    # No unique constraint on (employee, start_date, type): a cancelled or rejected
    # request must not block re-applying for the same dates. Overlap is enforced in
    # the service layer, which is status-aware.

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    leave_type_id = Column(Integer, ForeignKey("leave_types.id"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    half_day = Column(Boolean, default=False)
    days_count = Column(Float, nullable=False)
    reason = Column(Text)
    status = Column(Enum(LeaveStatus), default=LeaveStatus.pending, nullable=False)
    approver_id = Column(Integer, ForeignKey("employees.id"))
    decided_at = Column(DateTime(timezone=True))
    decision_note = Column(Text)
    document_path = Column(String(255))
    created_at = Column(DateTime(timezone=True), default=utcnow)


class LeaveBalance(Base):
    __tablename__ = "leave_balances"
    __table_args__ = (UniqueConstraint("employee_id", "leave_type_id", "year",
                                       name="uq_balance"),)

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    leave_type_id = Column(Integer, ForeignKey("leave_types.id"), nullable=False)
    year = Column(Integer, nullable=False)
    entitled_days = Column(Float, default=0)
    accrued_days = Column(Float, default=0)
    taken_days = Column(Float, default=0)
    carried_forward_days = Column(Float, default=0)


class DocumentKind(str, enum.Enum):
    passport = "passport"
    visa = "visa"
    emirates_id = "emirates_id"
    labour_card = "labour_card"
    rera_card = "rera_card"
    contract = "contract"
    other = "other"


class EmployeeDocument(Base):
    __tablename__ = "employee_documents"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    kind = Column(Enum(DocumentKind), nullable=False)
    number = Column(String(80))
    issue_date = Column(Date)
    expiry_date = Column(Date, index=True)
    file_path = Column(String(255))          # opaque stored name, never user-supplied
    original_filename = Column(String(255))
    content_type = Column(String(100))
    size_bytes = Column(Integer)
    sha256 = Column(String(64))
    uploaded_at = Column(DateTime(timezone=True), default=utcnow)


class ChecklistPhase(str, enum.Enum):
    onboarding = "onboarding"
    offboarding = "offboarding"


class ChecklistTask(Base):
    __tablename__ = "checklist_tasks"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    phase = Column(Enum(ChecklistPhase), nullable=False)
    title = Column(String(160), nullable=False)
    owner_department = Column(String(80))
    sequence = Column(Integer, default=0)
    due_date = Column(Date)
    completed_at = Column(DateTime(timezone=True))
    completed_by_id = Column(Integer, ForeignKey("employees.id"))
    blocking = Column(Boolean, default=False)   # blocks final settlement if incomplete
    notes = Column(Text)


class LoginAttempt(Base):
    """Append-only. Feeds lockout and gives HR a trail for disputed access."""
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True)
    at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    work_email = Column(String(160), nullable=False, index=True)
    succeeded = Column(Boolean, default=False, nullable=False)
    ip_address = Column(String(64))
    user_agent = Column(String(255))


class RefreshSession(Base):
    """One row per issued refresh token. Lets us revoke on exit or password change."""
    __tablename__ = "refresh_sessions"

    id = Column(Integer, primary_key=True)
    jti = Column(String(64), unique=True, nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    issued_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    device_fingerprint = Column(String(120))
    user_agent = Column(String(255))


class Holiday(Base):
    """UAE public holidays. Islamic dates are moon-dependent — HR confirms each year."""
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True)
    holiday_date = Column(Date, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    year = Column(Integer, nullable=False, index=True)
    is_confirmed = Column(Boolean, default=False)   # false = provisional lunar estimate

    __table_args__ = (UniqueConstraint("holiday_date", "name", name="uq_holiday"),)


class RecoveryCode(Base):
    """Single-use backup codes for when the phone is lost.

    Stored hashed — a valid recovery code is a full second factor, so a readable
    one is the same liability as a readable password.
    """
    __tablename__ = "recovery_codes"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    code_hash = Column(String(64), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=utcnow)

    employee = relationship("Employee")
