from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import (
    active_user, create_enrollment_token, create_mfa_token, decode_mfa_token,
    create_access_token, create_refresh_token, current_user, decode_token,
    hash_password, require_roles, two_factor_user, verify_password,
)
from app.models.core import (
    AuditLog, Employee, EmploymentStatus, FaceTemplate, LoginAttempt,
    RecoveryCode, RefreshSession, Role,
)
from app.services.totp import (
    decrypt_secret, encrypt_secret, generate_recovery_codes, hash_recovery_code,
    new_secret, provisioning_uri, qr_png_base64, recovery_matches, verify_code,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_WINDOW_MINUTES = 15

# Generic on purpose. Distinguishing "no such user" from "wrong password" hands
# an attacker a way to enumerate staff emails.
BAD_CREDENTIALS = "Email or password is incorrect."


def _client(request: Request) -> tuple[Optional[str], Optional[str]]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent", "")[:255]


def _log_attempt(db: Session, email: str, ok: bool, request: Request):
    ip, ua = _client(request)
    db.add(LoginAttempt(work_email=email.lower(), succeeded=ok, ip_address=ip, user_agent=ua))
    db.commit()


def _is_locked(db: Session, email: str) -> bool:
    since = datetime.now(timezone.utc) - timedelta(minutes=LOCKOUT_WINDOW_MINUTES)
    recent = (db.query(LoginAttempt)
                .filter(LoginAttempt.work_email == email.lower(),
                        LoginAttempt.at >= since)
                .order_by(LoginAttempt.at.desc())
                .limit(MAX_FAILED_ATTEMPTS)
                .all())
    return len(recent) == MAX_FAILED_ATTEMPTS and all(not a.succeeded for a in recent)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TokenOut(BaseModel):
    access_token: str = ""
    refresh_token: str = ""
    token_type: str = "bearer"
    expires_in: int
    must_change_password: bool = False
    mfa_required: bool = False
    mfa_token: Optional[str] = None
    enrollment_token: Optional[str] = None
    must_enrol_2fa: bool = False


class MeOut(BaseModel):
    id: int
    employee_code: str
    full_name: str
    work_email: str
    role: Role
    designation: Optional[str] = None
    department: Optional[str] = None
    status: EmploymentStatus
    date_of_joining: date
    biometric_consent: bool
    face_enrolled: bool
    must_change_password: bool

    class Config:
        from_attributes = True


class RefreshIn(BaseModel):
    refresh_token: str


class ConsentIn(BaseModel):
    accepted: bool
    policy_version: str = Field(..., min_length=1, max_length=40)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=12, max_length=128)


class EmployeeCreateIn(BaseModel):
    employee_code: str = Field(..., min_length=2, max_length=20)
    full_name: str = Field(..., min_length=2, max_length=160)
    work_email: EmailStr
    temporary_password: str = Field(..., min_length=12, max_length=128)
    role: Role = Role.employee
    designation: Optional[str] = None
    department: Optional[str] = None
    manager_id: Optional[int] = None
    home_site_id: Optional[int] = None
    date_of_joining: date
    basic_salary: float = 0.0
    total_salary: float = 0.0
    rera_brn: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/login", response_model=TokenOut)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(),
          db: Session = Depends(get_db)):
    email = form.username.strip().lower()

    if _is_locked(db, email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed attempts. Try again in {LOCKOUT_WINDOW_MINUTES} minutes "
            "or ask HR to reset your password.")

    emp = db.query(Employee).filter(Employee.work_email == email).first()

    # Run the hash comparison even when the account is missing so response time
    # doesn't reveal whether the email exists.
    stored = emp.password_hash if emp else hash_password("dummy-timing-equaliser")
    ok = verify_password(form.password, stored)

    if not emp or not ok:
        _log_attempt(db, email, False, request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS,
                            headers={"WWW-Authenticate": "Bearer"})

    if not emp.is_active or emp.status == EmploymentStatus.exited:
        _log_attempt(db, email, False, request)
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "This account is closed. Contact HR.")

    _log_attempt(db, email, True, request)
    ip, ua = _client(request)

    # Password alone is only the first factor. When an authenticator is enrolled
    # we hand back a short-lived token that unlocks nothing except /2fa/verify.
    if emp.totp_enabled:
        db.add(AuditLog(actor_id=emp.id, action="auth.password_ok_awaiting_2fa",
                        entity="employee", entity_id=str(emp.id), ip_address=ip))
        db.commit()
        return TokenOut(
            access_token="", refresh_token="", expires_in=0,
            mfa_required=True,
            mfa_token=create_mfa_token(str(emp.id)),
            must_change_password=emp.must_change_password)

    # Roles that handle other people's data must enrol before they can work.
    if (emp.role.value in settings.totp_required_roles
            and not emp.totp_enabled and not emp.must_change_password):
        db.add(AuditLog(actor_id=emp.id, action="auth.2fa_enrollment_required",
                        entity="employee",
                        entity_id=str(emp.id), ip_address=ip))
        db.commit()
        return TokenOut(expires_in=settings.MFA_TOKEN_MINUTES * 60,
                        enrollment_token=create_enrollment_token(
                            str(emp.id), emp.role.value),
                        must_change_password=emp.must_change_password,
                        must_enrol_2fa=True)

    access = create_access_token(str(emp.id), emp.role.value)
    refresh, jti, expires_at = create_refresh_token(str(emp.id), emp.role.value)

    db.add(RefreshSession(jti=jti, employee_id=emp.id, expires_at=expires_at, user_agent=ua))
    db.add(AuditLog(actor_id=emp.id, action="auth.login", entity="employee",
                    entity_id=str(emp.id), ip_address=ip))
    db.commit()

    return TokenOut(access_token=access, refresh_token=refresh,
                    expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
                    must_change_password=emp.must_change_password)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    """Rotates the refresh token. Reusing a rotated token revokes the whole
    family — that's the signal a token was stolen."""
    data = decode_token(body.refresh_token)
    if data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")

    session = db.query(RefreshSession).filter(RefreshSession.jti == data.get("jti")).first()
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")

    if session.revoked_at:
        # Replay of an already-rotated token. Kill every live session for this user.
        db.query(RefreshSession).filter(
            RefreshSession.employee_id == session.employee_id,
            RefreshSession.revoked_at.is_(None)
        ).update({"revoked_at": datetime.now(timezone.utc)})
        db.add(AuditLog(actor_id=session.employee_id, action="auth.refresh_replay",
                        entity="refresh_session", entity_id=session.jti,
                        detail="Rotated token reused — all sessions revoked",
                        ip_address=_client(request)[0]))
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Your session was ended for security. Sign in again.")

    emp = db.query(Employee).filter(Employee.id == session.employee_id).first()
    if not emp or not emp.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account is no longer active.")

    session.revoked_at = datetime.now(timezone.utc)
    access = create_access_token(str(emp.id), emp.role.value)
    new_token, jti, expires_at = create_refresh_token(str(emp.id), emp.role.value)
    ip, ua = _client(request)
    db.add(RefreshSession(jti=jti, employee_id=emp.id, expires_at=expires_at, user_agent=ua))
    db.commit()

    return TokenOut(access_token=access, refresh_token=new_token,
                    expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
                    must_change_password=emp.must_change_password)


@router.post("/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db), emp=Depends(current_user)):
    session = db.query(RefreshSession).filter(
        RefreshSession.jti == decode_token(body.refresh_token).get("jti"),
        RefreshSession.employee_id == emp.id).first()
    if session and not session.revoked_at:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "signed out"}


@router.post("/logout-all")
def logout_all(db: Session = Depends(get_db), emp=Depends(current_user)):
    n = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    return {"status": "signed out everywhere", "sessions_ended": n}


@router.get("/me", response_model=MeOut)
def me(db: Session = Depends(get_db), emp=Depends(current_user)):
    from app.models.core import FaceTemplate
    enrolled = (db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).count()
                >= settings.FACE_SAMPLES_REQUIRED)
    return MeOut(
        id=emp.id, employee_code=emp.employee_code, full_name=emp.full_name,
        work_email=emp.work_email, role=emp.role, designation=emp.designation,
        department=emp.department, status=emp.status,
        date_of_joining=emp.date_of_joining,
        biometric_consent=emp.biometric_consent_at is not None,
        face_enrolled=enrolled,
        must_change_password=emp.must_change_password,
    )


@router.post("/consent")
def biometric_consent(body: ConsentIn, request: Request,
                      db: Session = Depends(get_db), emp=Depends(active_user)):
    """UAE PDPL treats face data as sensitive. Consent is recorded per employee,
    per policy version, and is withdrawable — withdrawal deletes the templates."""
    ip, _ = _client(request)
    if body.accepted:
        emp.biometric_consent_at = datetime.now(timezone.utc)
        action, detail = "consent.granted", f"policy={body.policy_version}"
    else:
        from app.models.core import FaceTemplate
        emp.biometric_consent_at = None
        db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).delete()
        action, detail = "consent.withdrawn", f"policy={body.policy_version}; templates deleted"

    db.add(AuditLog(actor_id=emp.id, action=action, entity="employee",
                    entity_id=str(emp.id), detail=detail, ip_address=ip))
    db.commit()
    return {"biometric_consent": body.accepted,
            "message": "Consent recorded." if body.accepted
                       else "Consent withdrawn and your face data has been deleted. "
                            "You will not be able to record attendance until "
                            "you consent again."}


@router.post("/password")
def change_password(body: PasswordChangeIn, request: Request,
                    db: Session = Depends(get_db), emp=Depends(current_user)):
    if not verify_password(body.current_password, emp.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a password you haven't used here.")

    emp.password_hash = hash_password(body.new_password)
    emp.must_change_password = False
    db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.add(AuditLog(actor_id=emp.id, action="auth.password_changed", entity="employee",
                    entity_id=str(emp.id), ip_address=_client(request)[0]))
    db.commit()
    return {"status": "password changed", "message": "Signed out on other devices."}


@router.post("/employees", status_code=201)
def create_employee(body: EmployeeCreateIn, request: Request,
                    db: Session = Depends(get_db),
                    actor=Depends(require_roles("hr", "admin"))):
    email = body.work_email.lower()
    if db.query(Employee).filter(Employee.work_email == email).first():
        raise HTTPException(409, "That work email is already in use.")
    if db.query(Employee).filter(Employee.employee_code == body.employee_code).first():
        raise HTTPException(409, "That employee code is already in use.")
    if body.role == Role.admin and actor.role != Role.admin:
        raise HTTPException(403, "Only an admin can create another admin.")

    if not settings.email_allowed(body.work_email):
        allowed = ", ".join("@" + d for d in settings.allowed_domains)
        raise HTTPException(
            422, f"Accounts must use a company email address ({allowed}). "
                 "Personal addresses can't be provisioned.")

    emp = Employee(
        employee_code=body.employee_code, full_name=body.full_name, work_email=email,
        password_hash=hash_password(body.temporary_password), role=body.role,
        designation=body.designation, department=body.department,
        manager_id=body.manager_id, home_site_id=body.home_site_id,
        date_of_joining=body.date_of_joining, basic_salary=body.basic_salary,
        total_salary=body.total_salary, rera_brn=body.rera_brn,
        status=EmploymentStatus.onboarding, must_change_password=True,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    db.add(AuditLog(actor_id=actor.id, action="employee.created", entity="employee",
                    entity_id=str(emp.id), detail=f"role={body.role.value}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"id": emp.id, "employee_code": emp.employee_code,
            "message": "Employee created. They must change the temporary password at first sign-in."}


# ---------------------------------------------------------------------------
# User administration
#
# The rule that governs this whole section: you can never act on an account that
# outranks you. If HR could reset an admin's password, HR would simply become
# admin whenever they liked, and the role split would be decoration.
# ---------------------------------------------------------------------------
RANK = {Role.employee: 0, Role.manager: 1, Role.hr: 2, Role.admin: 3}


def _target(db: Session, employee_id: int) -> Employee:
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(404, "No employee with that ID.")
    return emp


def _may_administer(actor: Employee, target: Employee) -> None:
    if RANK[target.role] > RANK[actor.role]:
        article = "an" if target.role.value[0] in "aeiou" else "a"
        raise HTTPException(403,
                            f"You can't administer {article} {target.role.value} "
                            "account. Ask an admin.")


def _last_admin_guard(db: Session, target: Employee) -> None:
    """Stops the system being locked out of itself."""
    if target.role != Role.admin:
        return
    remaining = (db.query(Employee)
                   .filter(Employee.role == Role.admin,
                           Employee.is_active.is_(True),
                           Employee.id != target.id).count())
    if remaining == 0:
        raise HTTPException(409,
                            "This is the last active admin. Promote another admin first.")


class EmployeeRow(BaseModel):
    id: int
    employee_code: str
    full_name: str
    work_email: str
    role: Role
    department: Optional[str] = None
    designation: Optional[str] = None
    status: EmploymentStatus
    is_active: bool
    must_change_password: bool
    biometric_consent: bool
    face_enrolled: bool
    locked_out: bool


class ResetPasswordIn(BaseModel):
    temporary_password: str = Field(..., min_length=12, max_length=128)


class RoleChangeIn(BaseModel):
    role: Role


class ActiveIn(BaseModel):
    is_active: bool
    reason: Optional[str] = Field(None, max_length=500)


@router.get("/employees", response_model=List[EmployeeRow])
def list_employees(q: Optional[str] = None, role: Optional[Role] = None,
                   include_inactive: bool = False, limit: int = 200,
                   db: Session = Depends(get_db),
                   actor=Depends(require_roles("hr", "admin"))):
    """The user directory HR works from."""
    query = db.query(Employee)
    if not include_inactive:
        query = query.filter(Employee.is_active.is_(True))
    if role:
        query = query.filter(Employee.role == role)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.filter(
            func.lower(Employee.full_name).like(like)
            | func.lower(Employee.work_email).like(like)
            | func.lower(Employee.employee_code).like(like))

    rows = query.order_by(Employee.full_name).limit(min(limit, 500)).all()
    enrolled = {r[0] for r in db.query(FaceTemplate.employee_id).distinct().all()}
    return [EmployeeRow(
        id=e.id, employee_code=e.employee_code, full_name=e.full_name,
        work_email=e.work_email, role=e.role, department=e.department,
        designation=e.designation, status=e.status, is_active=e.is_active,
        must_change_password=e.must_change_password,
        biometric_consent=e.biometric_consent_at is not None,
        face_enrolled=e.id in enrolled,
        locked_out=_is_locked(db, e.work_email),
    ) for e in rows]


@router.post("/employees/{employee_id}/reset-password")
def reset_password(employee_id: int, body: ResetPasswordIn, request: Request,
                   db: Session = Depends(get_db),
                   actor=Depends(require_roles("hr", "admin"))):
    """For the Monday-morning 'I've forgotten my password' call.

    Sets a temporary password, forces a change at next sign-in, and kills every
    existing session — because if the account was taken over, leaving the
    attacker's refresh token alive makes the reset pointless.
    """
    emp = _target(db, employee_id)
    _may_administer(actor, emp)

    emp.password_hash = hash_password(body.temporary_password)
    emp.must_change_password = True
    revoked = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

    # Clear the failed-attempt history so the reset isn't blocked by the lockout.
    db.query(LoginAttempt).filter(
        LoginAttempt.work_email == emp.work_email,
        LoginAttempt.succeeded.is_(False)).delete()

    db.add(AuditLog(actor_id=actor.id, action="employee.password_reset",
                    entity="employee", entity_id=str(emp.id),
                    detail=f"sessions_revoked={revoked}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"employee_id": emp.id, "work_email": emp.work_email,
            "sessions_revoked": revoked,
            "message": f"Temporary password set for {emp.full_name}. They must "
                       "change it at next sign-in."}


@router.post("/employees/{employee_id}/unlock")
def unlock_account(employee_id: int, request: Request, db: Session = Depends(get_db),
                   actor=Depends(require_roles("hr", "admin"))):
    """Clears a lockout without changing the password — for the person who
    fat-fingered it five times and now remembers it correctly."""
    emp = _target(db, employee_id)
    _may_administer(actor, emp)
    cleared = db.query(LoginAttempt).filter(
        LoginAttempt.work_email == emp.work_email,
        LoginAttempt.succeeded.is_(False)).delete()
    db.add(AuditLog(actor_id=actor.id, action="employee.unlocked", entity="employee",
                    entity_id=str(emp.id), detail=f"cleared={cleared}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"employee_id": emp.id, "failed_attempts_cleared": cleared,
            "message": f"{emp.full_name} can sign in again."}


@router.post("/employees/{employee_id}/role")
def change_role(employee_id: int, body: RoleChangeIn, request: Request,
                db: Session = Depends(get_db),
                actor=Depends(require_roles("admin"))):
    """Admin only. Handing out HR or admin decides who can see salaries and
    reset other people's passwords, so it isn't an HR-level action."""
    emp = _target(db, employee_id)
    if emp.id == actor.id:
        raise HTTPException(409, "You can't change your own role. Ask another admin.")
    if emp.role == Role.admin and body.role != Role.admin:
        _last_admin_guard(db, emp)

    previous = emp.role
    emp.role = body.role
    db.add(AuditLog(actor_id=actor.id, action="employee.role_changed",
                    entity="employee", entity_id=str(emp.id),
                    detail=f"{previous.value} -> {body.role.value}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"employee_id": emp.id, "previous_role": previous.value,
            "role": emp.role.value,
            "message": f"{emp.full_name} is now {body.role.value}."}


@router.post("/employees/{employee_id}/active")
def set_active(employee_id: int, body: ActiveIn, request: Request,
               db: Session = Depends(get_db),
               actor=Depends(require_roles("hr", "admin"))):
    """Suspend or restore an account. Suspension revokes sessions immediately —
    a suspended account with a live token is not suspended.

    This is not offboarding: it leaves biometrics and employment status alone.
    Use the lifecycle exit flow when someone actually leaves.
    """
    emp = _target(db, employee_id)
    _may_administer(actor, emp)
    if emp.id == actor.id:
        raise HTTPException(409, "You can't suspend your own account.")
    if not body.is_active:
        _last_admin_guard(db, emp)

    emp.is_active = body.is_active
    revoked = 0
    if not body.is_active:
        revoked = db.query(RefreshSession).filter(
            RefreshSession.employee_id == emp.id,
            RefreshSession.revoked_at.is_(None)
        ).update({"revoked_at": datetime.now(timezone.utc)})

    db.add(AuditLog(actor_id=actor.id,
                    action="employee.activated" if body.is_active else "employee.suspended",
                    entity="employee", entity_id=str(emp.id), detail=body.reason,
                    ip_address=_client(request)[0]))
    db.commit()
    return {"employee_id": emp.id, "is_active": emp.is_active,
            "sessions_revoked": revoked,
            "message": f"{emp.full_name} has been "
                       f"{'restored' if body.is_active else 'suspended'}."}


# ---------------------------------------------------------------------------
# Two-factor authentication (authenticator app)
# ---------------------------------------------------------------------------
class TotpSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_png_base64: str
    instructions: str


class TotpCodeIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class TotpEnableOut(BaseModel):
    enabled: bool
    recovery_codes: List[str]
    warning: str


class TotpVerifyIn(BaseModel):
    mfa_token: str
    code: str = Field(..., min_length=6, max_length=14)   # 6-digit or recovery


class TotpDisableIn(BaseModel):
    current_password: str
    code: str = Field(..., min_length=6, max_length=14)


class SelfResetIn(BaseModel):
    work_email: EmailStr
    code: str = Field(..., min_length=6, max_length=14)
    new_password: str = Field(..., min_length=12, max_length=128)


def _consume_recovery_code(db: Session, emp: Employee, code: str) -> bool:
    for rc in db.query(RecoveryCode).filter(
            RecoveryCode.employee_id == emp.id,
            RecoveryCode.used_at.is_(None)).all():
        if recovery_matches(code, rc.code_hash):
            rc.used_at = datetime.now(timezone.utc)
            return True
    return False


def _check_second_factor(db: Session, emp: Employee, code: str) -> str:
    """Returns 'totp' or 'recovery'. Raises 401 with a usable message otherwise."""
    if not emp.totp_enabled or not emp.totp_secret_encrypted:
        raise HTTPException(409, "No authenticator is set up on this account.")

    normalised = (code or "").strip()
    if normalised.replace(" ", "").isdigit() and len(normalised.replace(" ", "")) == 6:
        try:
            secret = decrypt_secret(emp.totp_secret_encrypted)
        except ValueError as e:
            raise HTTPException(500, str(e))
        result = verify_code(secret, normalised, emp.totp_last_timestep)
        if not result.ok:
            raise HTTPException(401, result.reason)
        emp.totp_last_timestep = result.timestep
        return "totp"

    if _consume_recovery_code(db, emp, normalised):
        return "recovery"
    raise HTTPException(401, "That code isn't right. Check your app, or use a recovery code.")


@router.post("/2fa/setup", response_model=TotpSetupOut)
def totp_setup(request: Request, db: Session = Depends(get_db),
               emp=Depends(two_factor_user)):
    """Generates a secret and QR. Nothing is enabled until a code is confirmed —
    enabling on generation would lock out anyone who closes the tab."""
    if emp.totp_enabled:
        raise HTTPException(409,
                            "An authenticator is already set up. Remove it first if "
                            "you're switching phones.")
    secret = new_secret()
    emp.totp_secret_encrypted = encrypt_secret(secret)
    emp.totp_confirmed_at = None
    db.add(AuditLog(actor_id=emp.id, action="2fa.setup_started", entity="employee",
                    entity_id=str(emp.id), ip_address=_client(request)[0]))
    db.commit()

    uri = provisioning_uri(secret, emp.work_email)
    return TotpSetupOut(
        secret=secret, otpauth_uri=uri, qr_png_base64=qr_png_base64(uri),
        instructions="Scan the QR code with Google Authenticator, Microsoft "
                     "Authenticator or 1Password, then enter the 6-digit code to "
                     "finish. Keep this screen open until you've confirmed.")


@router.post("/2fa/enable", response_model=TotpEnableOut)
def totp_enable(body: TotpCodeIn, request: Request, db: Session = Depends(get_db),
                emp=Depends(two_factor_user)):
    """Confirms the app is working before switching 2FA on, then issues recovery
    codes once. They're shown here and never again."""
    if emp.totp_enabled:
        raise HTTPException(409, "Two-factor authentication is already on.")
    if not emp.totp_secret_encrypted:
        raise HTTPException(409, "Start setup first.")

    secret = decrypt_secret(emp.totp_secret_encrypted)
    result = verify_code(secret, body.code, None)
    if not result.ok:
        raise HTTPException(401, result.reason)

    emp.totp_enabled = True
    emp.totp_confirmed_at = datetime.now(timezone.utc)
    emp.totp_last_timestep = result.timestep

    db.query(RecoveryCode).filter(RecoveryCode.employee_id == emp.id).delete()
    codes = generate_recovery_codes()
    for c in codes:
        db.add(RecoveryCode(employee_id=emp.id, code_hash=hash_recovery_code(c)))

    db.add(AuditLog(actor_id=emp.id, action="2fa.enabled", entity="employee",
                    entity_id=str(emp.id), ip_address=_client(request)[0]))
    db.commit()
    return TotpEnableOut(
        enabled=True, recovery_codes=codes,
        warning="Save these somewhere safe and offline. Each works once, and this "
                "is the only time they're shown. Without them, a lost phone means "
                "asking an admin to remove your authenticator.")


@router.post("/2fa/verify", response_model=TokenOut)
def totp_verify(body: TotpVerifyIn, request: Request, db: Session = Depends(get_db)):
    """Second step of sign-in. Exchanges the short-lived MFA token plus a code
    for real session tokens."""
    employee_id = decode_mfa_token(body.mfa_token)
    emp = db.query(Employee).filter(Employee.id == int(employee_id)).first()
    if not emp or not emp.is_active:
        raise HTTPException(401, BAD_CREDENTIALS)

    method = _check_second_factor(db, emp, body.code)

    access = create_access_token(str(emp.id), emp.role.value)
    refresh, jti, expires_at = create_refresh_token(str(emp.id), emp.role.value)
    ip, ua = _client(request)
    db.add(RefreshSession(jti=jti, employee_id=emp.id, expires_at=expires_at,
                          user_agent=ua))
    db.add(AuditLog(actor_id=emp.id, action=f"auth.login_2fa_{method}",
                    entity="employee", entity_id=str(emp.id), ip_address=ip))
    db.commit()

    remaining = db.query(RecoveryCode).filter(
        RecoveryCode.employee_id == emp.id, RecoveryCode.used_at.is_(None)).count()
    if method == "recovery" and remaining <= 2:
        pass   # surfaced to the user by the client via /2fa/status

    return TokenOut(access_token=access, refresh_token=refresh,
                    expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
                    must_change_password=emp.must_change_password)


@router.post("/2fa/disable")
def totp_disable(body: TotpDisableIn, request: Request, db: Session = Depends(get_db),
                 emp=Depends(current_user)):
    """Needs both the password and a live code — otherwise a stolen session could
    quietly strip the second factor off the account."""
    if not verify_password(body.current_password, emp.password_hash):
        raise HTTPException(400, "That password isn't right.")
    _check_second_factor(db, emp, body.code)

    if emp.role.value in settings.totp_required_roles:
        raise HTTPException(
            403, f"{emp.role.value.upper()} accounts must keep two-factor "
                 "authentication on. Ask an admin if you're changing phones.")

    emp.totp_enabled = False
    emp.totp_secret_encrypted = None
    emp.totp_confirmed_at = None
    emp.totp_last_timestep = None
    db.query(RecoveryCode).filter(RecoveryCode.employee_id == emp.id).delete()
    db.add(AuditLog(actor_id=emp.id, action="2fa.disabled", entity="employee",
                    entity_id=str(emp.id), ip_address=_client(request)[0]))
    db.commit()
    return {"enabled": False, "message": "Two-factor authentication is off."}


@router.get("/2fa/status")
def totp_status(db: Session = Depends(get_db), emp=Depends(two_factor_user)):
    remaining = db.query(RecoveryCode).filter(
        RecoveryCode.employee_id == emp.id, RecoveryCode.used_at.is_(None)).count()
    return {"enabled": emp.totp_enabled,
            "confirmed_at": emp.totp_confirmed_at,
            "recovery_codes_remaining": remaining,
            "required_for_your_role": emp.role.value in settings.totp_required_roles,
            "low_recovery_codes": emp.totp_enabled and remaining <= 2}


@router.post("/2fa/recovery/regenerate", response_model=TotpEnableOut)
def regenerate_recovery(body: TotpCodeIn, request: Request,
                        db: Session = Depends(get_db), emp=Depends(current_user)):
    """Replaces all codes. Old ones stop working immediately."""
    _check_second_factor(db, emp, body.code)
    db.query(RecoveryCode).filter(RecoveryCode.employee_id == emp.id).delete()
    codes = generate_recovery_codes()
    for c in codes:
        db.add(RecoveryCode(employee_id=emp.id, code_hash=hash_recovery_code(c)))
    db.add(AuditLog(actor_id=emp.id, action="2fa.recovery_regenerated",
                    entity="employee", entity_id=str(emp.id),
                    ip_address=_client(request)[0]))
    db.commit()
    return TotpEnableOut(enabled=True, recovery_codes=codes,
                         warning="Your previous recovery codes no longer work.")


@router.post("/password/self-reset")
def self_reset_password(body: SelfResetIn, request: Request,
                        db: Session = Depends(get_db)):
    """Reset your own password with an authenticator code — no HR call needed.

    This is the whole point of enrolling: the authenticator proves it's you
    without anyone handing a temporary password over the phone. Deliberately
    unauthenticated, because the person can't sign in — the code IS the proof.
    """
    email = body.work_email.strip().lower()
    emp = db.query(Employee).filter(Employee.work_email == email).first()

    # Same generic failure whether or not the account exists, so this endpoint
    # can't be used to enumerate staff emails.
    generic = HTTPException(401, "That code isn't right, or the account can't be reset here.")
    if not emp or not emp.is_active or not emp.totp_enabled:
        _log_attempt(db, email, False, request)
        db.commit()
        raise generic
    if _is_locked(db, email):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")

    try:
        _check_second_factor(db, emp, body.code)
    except HTTPException:
        _log_attempt(db, email, False, request)
        db.commit()
        raise generic

    emp.password_hash = hash_password(body.new_password)
    emp.must_change_password = False
    revoked = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.query(LoginAttempt).filter(LoginAttempt.work_email == email,
                                  LoginAttempt.succeeded.is_(False)).delete()

    db.add(AuditLog(actor_id=emp.id, action="auth.self_password_reset",
                    entity="employee", entity_id=str(emp.id),
                    detail=f"sessions_revoked={revoked}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"message": "Password changed. Sign in with your new password.",
            "sessions_revoked": revoked}


@router.post("/employees/{employee_id}/2fa/remove")
def admin_remove_2fa(employee_id: int, request: Request, db: Session = Depends(get_db),
                     actor=Depends(require_roles("hr", "admin"))):
    """Last resort for a lost phone with no recovery codes left.

    This is a genuine downgrade of that account's security, so it's audited and
    it forces a password change too — if someone social-engineered HR into
    running this, the old password shouldn't survive either.
    """
    emp = _target(db, employee_id)
    _may_administer(actor, emp)

    emp.totp_enabled = False
    emp.totp_secret_encrypted = None
    emp.totp_confirmed_at = None
    emp.totp_last_timestep = None
    emp.must_change_password = True
    db.query(RecoveryCode).filter(RecoveryCode.employee_id == emp.id).delete()
    revoked = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

    db.add(AuditLog(actor_id=actor.id, action="2fa.removed_by_admin",
                    entity="employee", entity_id=str(emp.id),
                    detail=f"sessions_revoked={revoked}",
                    ip_address=_client(request)[0]))
    db.commit()
    return {"employee_id": emp.id, "enabled": False,
            "message": f"Authenticator removed for {emp.full_name}. They must set a "
                       "new password and re-enrol at next sign-in."}
