"""Encrypted storage for attendance capture photos.

Every accepted or rejected face punch keeps the frame that was actually
presented to the camera. That is the evidence trail: without it, a disputed
punch is one person's word against a row in a table.

Raw JPEGs on disk would be a serious problem - they are biometric data about
identifiable people, readable by anyone with filesystem or backup access. So
each frame is encrypted with Fernet (AES-128-CBC + HMAC-SHA256) before it
touches the disk, using a key derived from JWT_SECRET exactly as TOTP secrets
are. A stolen backup yields ciphertext.

Note what this does and does not protect:
  - Protects against: stolen disks, leaked backups, support exports, anyone
    browsing the storage volume.
  - Does NOT protect against: an attacker who already has JWT_SECRET, since
    the key is derived from it. Rotating JWT_SECRET makes existing photos
    unreadable - see UPGRADE-NOTES.md before rotating.

Retention is bounded. Biometric images should not accumulate forever; call
purge_expired() from a scheduled job.
"""
from __future__ import annotations

import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

VAULT_VERSION = 1
_SUFFIX = ".jpg.enc"


def vault_root() -> Path:
    return Path(getattr(settings, "ATTENDANCE_PHOTO_DIR", "storage/attendance"))


def _fernet() -> Fernet:
    """Key derived from JWT_SECRET, same construction as the TOTP vault.

    The salt differs so that a photo key and a TOTP key are never the same
    value even though both come from JWT_SECRET.
    """
    digest = hashlib.pbkdf2_hmac(
        "sha256", settings.JWT_SECRET.encode("utf-8"),
        b"manath-attendance-photo-v1", 200_000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(digest))


def _path_for(employee_id: int, when: datetime, punch_id: int) -> Path:
    # Shard by employee and month so no single directory grows without bound.
    return (vault_root() / f"emp-{employee_id}" / when.strftime("%Y-%m")
            / f"punch-{punch_id}{_SUFFIX}")


def store_frame(employee_id: int, punch_id: int, jpeg: bytes,
                when: Optional[datetime] = None) -> Optional[str]:
    """Encrypt and write one frame. Returns the relative path, or None.

    Never raises: a storage fault must not turn a valid attendance punch into
    an error for the employee standing at the door. Losing the photo is bad;
    blocking the punch is worse, and the punch row itself is still written.
    """
    if not jpeg:
        return None
    when = when or datetime.now(timezone.utc)
    try:
        path = _path_for(employee_id, when, punch_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        token = _fernet().encrypt(jpeg)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "wb") as fh:
            fh.write(token)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)                     # atomic: no half-written file
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass                                   # Windows: ACLs govern instead
        return str(path.relative_to(vault_root()))
    except Exception:                              # noqa: BLE001
        return None


def load_frame(relative_path: str) -> bytes:
    """Decrypt one frame. HR/audit use only - callers must check permissions."""
    full = vault_root() / relative_path
    resolved = full.resolve()
    root = vault_root().resolve()
    if not str(resolved).startswith(str(root)):    # path traversal guard
        raise ValueError("Refusing to read outside the attendance vault.")
    if not resolved.exists():
        raise FileNotFoundError("That attendance photo is no longer stored.")
    try:
        return _fernet().decrypt(resolved.read_bytes())
    except InvalidToken as e:
        raise ValueError(
            "This photo can't be decrypted. JWT_SECRET has changed since it "
            "was stored, so the derived key no longer matches.") from e


def purge_expired(days: Optional[int] = None) -> int:
    """Delete photos older than the retention window. Returns the count."""
    days = days or getattr(settings, "ATTENDANCE_PHOTO_RETENTION_DAYS", 180)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    root = vault_root()
    if not root.is_dir():
        return 0
    removed = 0
    for path in root.rglob(f"*{_SUFFIX}"):
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            continue
    return removed
