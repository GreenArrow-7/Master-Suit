#!/usr/bin/env python3
"""Tests for the model download: only the pinned archive is ever unpacked.

Run it directly — `python3 apps/face/test_download_models.py`. Standard library
only, like test_tokens.py, so CI runs it on a bare runner. The network is faked:
nothing is downloaded.

What it is for: the face service loads whatever ONNX graphs this script unpacks.
A release tag does not pin a file, so the archive is checked against a SHA-256
before it is opened, and a failed or truncated download is retried instead of
taking the container (and CI's face-e2e job) down.
"""

import hashlib
import io
import os
import sys
import tempfile
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import download_models as dm  # noqa: E402

FAILURES: list[str] = []
PINNED = dm.SHA256


def check(label: str, condition: bool) -> None:
    print(("  ok    " if condition else "  FAIL  ") + label)
    if not condition:
        FAILURES.append(label)


def archive() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in dm.NEEDED + ("genderage.onnx",):
            z.writestr(name, f"graph {name}")
    return buf.getvalue()


ZIP = archive()


def run(responses: list, pinned: str) -> tuple[int, Path, int]:
    """Runs main() against a fake network; returns (exit code, model dir, calls)."""
    queue = list(responses)
    calls = 0

    def urlopen(url: str, timeout: int):
        nonlocal calls
        calls += 1
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        body = io.BytesIO(item)
        body.headers = {"content-length": str(len(ZIP))}
        return body

    dest = Path(tempfile.mkdtemp())
    os.environ["FACE_MODEL_DIR"] = str(dest)
    dm.SHA256 = pinned
    dm.urllib = SimpleNamespace(request=SimpleNamespace(urlopen=urlopen))
    dm.time = SimpleNamespace(sleep=lambda seconds: None)
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        code = dm.main()
    return code, dest, calls


def unpacked(dest: Path) -> bool:
    return all((dest / n).read_text() == f"graph {n}" for n in dm.NEEDED)


GOOD = hashlib.sha256(ZIP).hexdigest()

print("the pinned archive")
code, dest, calls = run([ZIP], GOOD)
check("is unpacked", code == 0 and unpacked(dest))
check("leaves no zip behind", not (dest / "buffalo_l.zip").exists())
check("only the two graphs we run", not (dest / "genderage.onnx").exists())

print("any other archive")
code, dest, calls = run([ZIP] * dm.ATTEMPTS, PINNED)
check("is refused", code == 1)
check("is never unpacked", not any((dest / n).exists() for n in dm.NEEDED))
check("is deleted", not (dest / "buffalo_l.zip").exists())
check(f"after {dm.ATTEMPTS} attempts", calls == dm.ATTEMPTS)

print("a bad download is retried")
code, dest, calls = run([ZIP[:-100], ZIP], GOOD)
check("a truncated body", code == 0 and calls == 2 and unpacked(dest))
code, dest, calls = run([OSError("HTTP Error 503"), ZIP], GOOD)
check("a server error", code == 0 and calls == 2 and unpacked(dest))
code, dest, calls = run([OSError("timed out")] * dm.ATTEMPTS, GOOD)
check("but not for ever", code == 1 and calls == dm.ATTEMPTS)

if FAILURES:
    print(f"\n{len(FAILURES)} failed:")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)

print("\nmodel download: all checks passed.")
