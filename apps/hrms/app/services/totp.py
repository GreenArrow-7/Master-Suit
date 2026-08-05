"""Two-factor authentication with authenticator apps (TOTP, RFC 6238).

Design notes, because the failure modes here are subtle:

*Secrets are encrypted at rest.* A TOTP secret sitting in a readable column is a
permanent authentication bypass for anyone who can read the table — a database
backup, a support export, a SQL injection. The encryption key is derived from
JWT_SECRET via HKDF, so there's one secret to protect, not two.

*Replay is blocked.* A code is valid for a 30-second window, so shoulder-surfing
or a proxy could reuse it within that window. We record the last accepted
timestep and refuse anything at or before it.

*Recovery codes are hashed like passwords.* They ARE passwords — a valid recovery
code is a full second factor. Storing them in plaintext so HR can read them back
defeats the point.

*Clock drift is tolerated by exactly one step.* valid_window=1 accepts the codes
either side of now, covering roughly 30 seconds of phone clock drift. Widening it
multiplies the guess space for an attacker.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

TOTP_INTERVAL = 30
VALID_WINDOW = 1          # one step either side of now
RECOVERY_CODE_COUNT = 8
RECOVERY_CODE_BYTES = 5   # 8 base32 chars per code


def _fernet() -> Fernet:
    """Derives a stable encryption key from JWT_SECRET.

    Rotating JWT_SECRET therefore invalidates every stored TOTP secret. That's a
    real operational consequence: rotate it and everyone must re-enrol their
    authenticator. Set TOTP_ENCRYPTION_KEY explicitly if you need them decoupled.
    """
    explicit = getattr(settings, "TOTP_ENCRYPTION_KEY", "") or ""
    if explicit:
        material = explicit.encode()
    else:
        material = settings.JWT_SECRET.encode()

    derived = HKDF(algorithm=hashes.SHA256(), length=32,
                   salt=b"manath-homes-totp-v1",
                   info=b"totp-secret-encryption").derive(material)
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(blob: str) -> str:
    try:
        return _fernet().decrypt(blob.encode()).decode()
    except InvalidToken as e:
        raise ValueError(
            "The stored authenticator secret can't be decrypted. This usually "
            "means JWT_SECRET changed. The user must re-enrol their authenticator."
        ) from e


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, work_email: str) -> str:
    """The otpauth:// URI an authenticator app scans."""
    return pyotp.TOTP(secret, interval=TOTP_INTERVAL).provisioning_uri(
        name=work_email, issuer_name=settings.COMPANY_NAME)


def qr_png_base64(uri: str) -> str:
    """QR as a base64 PNG so the API stays JSON and the browser can render it
    inline. Never log or cache this — it contains the shared secret."""
    import io

    import qrcode

    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def current_timestep(at: float | None = None) -> int:
    return int((at if at is not None else time.time()) // TOTP_INTERVAL)


@dataclass
class VerifyResult:
    ok: bool
    timestep: int | None
    reason: str = ""


def verify_code(secret: str, code: str, last_timestep: int | None,
                at: float | None = None) -> VerifyResult:
    """Checks a 6-digit code and refuses replays of an already-used timestep."""
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return VerifyResult(False, None, "Enter the 6-digit code from your authenticator app.")

    totp = pyotp.TOTP(secret, interval=TOTP_INTERVAL)
    now = at if at is not None else time.time()
    if not totp.verify(code, for_time=now, valid_window=VALID_WINDOW):
        return VerifyResult(False, None, "That code isn't right. Check your app and try again.")

    # Identify which step matched so we can pin it and block reuse.
    base = current_timestep(now)
    matched = None
    for offset in range(-VALID_WINDOW, VALID_WINDOW + 1):
        step = base + offset
        if totp.verify(code, for_time=step * TOTP_INTERVAL, valid_window=0):
            matched = step
            break
    if matched is None:
        matched = base

    if last_timestep is not None and matched <= last_timestep:
        return VerifyResult(False, None,
                            "That code has already been used. Wait for the next one.")
    return VerifyResult(True, matched)


# ---------------------------------------------------------------------------
# Recovery codes
# ---------------------------------------------------------------------------
def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Human-transcribable: base32, no padding, grouped for readability."""
    codes = []
    for _ in range(count):
        raw = base64.b32encode(secrets.token_bytes(RECOVERY_CODE_BYTES)).decode().rstrip("=")
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def hash_recovery_code(code: str) -> str:
    """SHA-256 rather than bcrypt: these are high-entropy random strings, not
    user-chosen passwords, so there's nothing to brute-force offline. Bcrypt on
    eight codes per login attempt would also be needlessly slow."""
    return hashlib.sha256(_normalise_recovery(code).encode()).hexdigest()


def _normalise_recovery(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "").replace("-", "")


def recovery_matches(code: str, stored_hash: str) -> bool:
    return secrets.compare_digest(hash_recovery_code(code), stored_hash)
