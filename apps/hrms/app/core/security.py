import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import bcrypt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

BCRYPT_ROUNDS = 12
_MAX_BCRYPT_BYTES = 72


def _prepare(raw: str) -> bytes:
    """bcrypt silently ignores anything past 72 bytes. Truncate explicitly so the
    behaviour is visible here rather than surprising someone later."""
    return raw.encode("utf-8")[:_MAX_BCRYPT_BYTES]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_prepare(raw), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(raw), hashed.encode())
    except (ValueError, TypeError):
        return False


def _token(sub: str, role: str, kind: str, delta: timedelta, jti: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": sub, "role": role, "type": kind, "iat": now, "exp": now + delta}
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def create_access_token(sub: str, role: str) -> str:
    return _token(sub, role, "access", timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))


def create_refresh_token(sub: str, role: str) -> tuple[str, str, datetime]:
    """Returns (token, jti, expires_at). The jti is persisted so it can be revoked."""
    jti = uuid.uuid4().hex
    delta = timedelta(days=settings.REFRESH_TOKEN_DAYS)
    token = _token(sub, role, "refresh", delta, jti=jti)
    return token, jti, datetime.now(timezone.utc) + delta


def create_enrollment_token(sub: str, role: str) -> str:
    """Create a short-lived credential that can only finish mandatory 2FA setup.

    It is intentionally a different JWT type from an access token. The common
    ``current_user`` dependency therefore rejects it on every normal API.
    """
    return _token(sub, role, "2fa_enrollment",
                  timedelta(minutes=settings.MFA_TOKEN_MINUTES),
                  jti=uuid.uuid4().hex)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Sign in again.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)):
    from app.models.core import Employee

    data = decode_token(token)
    if data.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")
    emp = db.query(Employee).filter(Employee.id == int(data["sub"])).first()
    if not emp or not emp.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account is no longer active.")
    return emp


def two_factor_user(token: str = Depends(oauth2), db: Session = Depends(get_db)):
    """Accept full access or restricted mandatory-enrollment credentials.

    Only 2FA setup/status endpoints use this dependency. Enrollment credentials
    become unusable as soon as enrollment succeeds.
    """
    from app.models.core import Employee

    data = decode_token(token)
    token_type = data.get("type")
    if token_type not in {"access", "2fa_enrollment"}:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")
    try:
        employee_id = int(data["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")

    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp or not emp.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "This account is no longer active.")
    if token_type == "2fa_enrollment":
        if (emp.must_change_password or emp.totp_enabled or
                emp.role.value not in settings.totp_required_roles):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                                "This enrollment session is no longer valid.")
    return emp


def active_user(user=Depends(current_user)):
    """Use this on every endpoint except /auth/me, /auth/password and /auth/logout.

    While must_change_password is set, the account is holdable by whoever issued
    the temporary password. Nothing else in the system opens until it's cleared.
    """
    if user.must_change_password:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Set a new password before using the system.")
    return user


def require_roles(*roles: str):
    allowed: Iterable[str] = roles

    def _guard(user=Depends(active_user)):
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this.")
        return user

    return _guard


# ---------------------------------------------------------------------------
# Half-authenticated token for the gap between password and authenticator code
# ---------------------------------------------------------------------------
def create_mfa_token(subject: str) -> str:
    """Proves the password was correct and nothing else.

    Deliberately a distinct token type: if this were an access token with a short
    life, a bug anywhere that forgot to check the type would let a password alone
    reach protected endpoints. type="mfa" fails closed against current_user,
    which only accepts type="access".
    """
    now = datetime.now(timezone.utc)
    payload = {"sub": subject, "type": "mfa", "iat": now,
               "exp": now + timedelta(minutes=settings.MFA_TOKEN_MINUTES)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_mfa_token(token: str) -> str:
    data = decode_token(token)
    if data.get("type") != "mfa":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Start again from the sign-in screen.")
    return data["sub"]
