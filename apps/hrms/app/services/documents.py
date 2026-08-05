"""File storage for HR documents.

Two rules drive this design:
  1. The stored filename is generated, never derived from what the user uploaded.
     User-supplied names carry `../`, null bytes and 400-character unicode; a
     generated name makes path traversal structurally impossible.
  2. Files live outside any statically served directory. The only way out is the
     authorised download endpoint, so access control can't be bypassed by
     guessing a URL.

Not done here: encryption at rest. If you store passport scans on a shared or
cloud host, put them on encrypted storage (S3 SSE-KMS, LUKS volume, or similar)
before this goes anywhere near real employee data.
"""
from __future__ import annotations

import hashlib
import secrets
from pathlib import Path

from app.core.config import settings

ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/webp": ".webp",
}

# Magic bytes. A file claiming image/png while starting with "MZ" is not a scan.
SIGNATURES = {
    b"%PDF": "application/pdf",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"RIFF": "image/webp",
}


def storage_dir() -> Path:
    d = Path(settings.DOCUMENT_STORAGE_DIR).resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def stored_path(stored_name: str) -> Path:
    """Resolves inside the storage directory or raises. Belt and braces — the
    stored name is generated, but this stops a corrupted DB row escaping."""
    base = storage_dir()
    p = (base / Path(stored_name).name).resolve()
    if base not in p.parents and p.parent != base:
        raise ValueError("Invalid document path.")
    return p


def _sniff(payload: bytes) -> str | None:
    for magic, mime in SIGNATURES.items():
        if payload.startswith(magic):
            if magic == b"RIFF" and payload[8:12] != b"WEBP":
                continue
            return mime
    if payload[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1"):
        return "image/heic"
    return None


def save_upload(payload: bytes, original_filename: str, content_type: str) -> dict:
    if not payload:
        raise ValueError("The file is empty.")
    if len(payload) > settings.MAX_DOCUMENT_BYTES:
        mb = settings.MAX_DOCUMENT_BYTES // (1024 * 1024)
        raise ValueError(f"Files must be under {mb} MB.")

    sniffed = _sniff(payload)
    if sniffed is None:
        raise ValueError("Upload a PDF or an image (JPEG, PNG, WebP, HEIC).")
    # Trust the bytes over the declared header.
    content_type = sniffed
    ext = ALLOWED_TYPES[content_type]

    stored_name = f"{secrets.token_urlsafe(24)}{ext}"
    path = storage_dir() / stored_name
    path.write_bytes(payload)
    try:
        path.chmod(0o600)
    except OSError:
        pass   # Windows ignores POSIX modes; NTFS ACLs are the control there.

    return {
        "stored_name": stored_name,
        "original_filename": Path(original_filename).name[:255],
        "content_type": content_type,
        "size_bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def delete_stored(stored_name: str) -> bool:
    try:
        p = stored_path(stored_name)
    except ValueError:
        return False
    if p.exists():
        p.unlink()
        return True
    return False
