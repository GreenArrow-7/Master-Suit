"""Encrypted attendance photo vault."""
import os
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import face_vault


@pytest.fixture()
def vault(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTENDANCE_PHOTO_DIR", str(tmp_path))
    return tmp_path


JPEG = b"\xff\xd8\xff\xe0" + b"fake image bytes" * 40 + b"\xff\xd9"


def test_roundtrip(vault):
    rel = face_vault.store_frame(7, 1234, JPEG)
    assert rel
    assert face_vault.load_frame(rel) == JPEG


def test_bytes_on_disk_are_not_the_image(vault):
    """The whole point: a stolen backup must not yield biometric images."""
    rel = face_vault.store_frame(7, 1, JPEG)
    raw = (vault / rel).read_bytes()
    assert JPEG not in raw
    assert not raw.startswith(b"\xff\xd8")        # no JPEG magic number
    assert raw.startswith(b"gAAAAA")              # Fernet token


def test_tampering_is_detected(vault):
    rel = face_vault.store_frame(7, 1, JPEG)
    path = vault / rel
    blob = bytearray(path.read_bytes())
    blob[-5] ^= 0xFF
    path.write_bytes(bytes(blob))
    with pytest.raises(ValueError):
        face_vault.load_frame(rel)


def test_wrong_key_cannot_decrypt(vault, monkeypatch):
    rel = face_vault.store_frame(7, 1, JPEG)
    monkeypatch.setattr(settings, "JWT_SECRET", "a-completely-different-secret-value")
    with pytest.raises(ValueError, match="JWT_SECRET"):
        face_vault.load_frame(rel)


def test_path_traversal_is_refused(vault):
    with pytest.raises(ValueError, match="outside"):
        face_vault.load_frame("../../../etc/passwd")


def test_storage_failure_never_raises(vault, monkeypatch):
    """A disk fault must not block someone standing at the door."""
    monkeypatch.setattr(face_vault, "_fernet",
                        lambda: (_ for _ in ()).throw(OSError("disk gone")))
    assert face_vault.store_frame(7, 1, JPEG) is None


def test_empty_frame_stores_nothing(vault):
    assert face_vault.store_frame(7, 1, b"") is None


def test_photos_are_sharded_by_employee_and_month(vault):
    when = datetime(2026, 3, 9, tzinfo=timezone.utc)
    rel = face_vault.store_frame(42, 9, JPEG, when=when)
    assert rel.replace("\\", "/").startswith("emp-42/2026-03/")


def test_retention_purge_removes_only_old_photos(vault):
    old = face_vault.store_frame(1, 1, JPEG)
    new = face_vault.store_frame(1, 2, JPEG)
    stale = (vault / old)
    long_ago = (datetime.now(timezone.utc) - timedelta(days=400)).timestamp()
    os.utime(stale, (long_ago, long_ago))

    assert face_vault.purge_expired(days=180) == 1
    assert not stale.exists()
    assert face_vault.load_frame(new) == JPEG


def test_missing_file_is_a_clear_error(vault):
    with pytest.raises(FileNotFoundError):
        face_vault.load_frame("emp-1/2026-01/punch-999.jpg.enc")


# ---------------------------------------------------------------------------
# Engine diagnostics. With no PIN fallback, this message is the only thing
# standing between an administrator and a system that cannot record attendance.
# ---------------------------------------------------------------------------
def test_diagnose_names_the_missing_package(monkeypatch):
    import importlib.util
    from app.services import face as face_mod

    real = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, "find_spec",
                        lambda n, *a, **k: None if n == "cv2" else real(n, *a, **k))
    msg = face_mod.diagnose()
    assert "opencv-python-headless" in msg
    assert "pip install -r requirements-face.txt" in msg
    assert "compiler" in msg.lower()


def test_diagnose_names_missing_models(monkeypatch, tmp_path):
    from app.services import face as face_mod
    from app.services import face_engine
    monkeypatch.setattr(face_engine, "model_root", lambda: tmp_path)
    msg = face_mod.diagnose()
    assert "det_10g.onnx" in msg
    assert "download_models.py" in msg
    assert str(tmp_path) in msg


def test_no_message_shown_to_a_user_mentions_the_removed_pin(monkeypatch, tmp_path):
    """PIN check-in was deleted. Telling someone to use it is worse than
    useless - it sends them looking for a control that no longer exists."""
    import importlib.util
    from app.services import face as face_mod
    from app.services import face_engine

    messages = [face_mod.diagnose()]

    real = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, "find_spec",
                        lambda n, *a, **k: None if n == "cv2" else real(n, *a, **k))
    messages.append(face_mod.diagnose())
    monkeypatch.undo()

    monkeypatch.setattr(face_engine, "model_root", lambda: tmp_path)
    messages.append(face_mod.diagnose())

    for m in messages:
        assert "PIN" not in m, m


def test_diagnostic_names_the_running_interpreter(monkeypatch):
    """A bare 'pip' often belongs to a different Python than the one serving
    the app - the commonest reason an install 'succeeds' while the server still
    reports the package missing. The instruction must be unambiguous."""
    import importlib.util
    import sys
    from app.services import face as face_mod

    real = importlib.util.find_spec
    monkeypatch.setattr(importlib.util, "find_spec",
                        lambda n, *a, **k: None if n == "cv2" else real(n, *a, **k))
    msg = face_mod.diagnose()
    assert sys.executable in msg
    # every command line must be qualified with the interpreter, never bare
    for line in msg.splitlines():
        if "pip install" in line or "download_models" in line:
            assert sys.executable in line, f"unqualified command: {line!r}"


def test_setup_doctor_runs_and_reports(capsys):
    """scripts/check_face_setup.py must be runnable, not just present."""
    import runpy
    import sys
    from pathlib import Path
    script = Path("scripts/check_face_setup.py")
    assert script.exists()
    argv = sys.argv[:]
    sys.argv = [str(script)]
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as e:
        assert e.code in (0, 1)
    finally:
        sys.argv = argv
    out = capsys.readouterr().out
    assert "Interpreter" in out
    assert "opencv-python-headless" in out


# ---------------------------------------------------------------------------
# Face recognition is mandatory, so it must be a mandatory dependency.
# ---------------------------------------------------------------------------
def test_face_packages_are_in_the_default_requirements():
    """PIN check-in is gone, so no face stack means no attendance at all.
    Leaving these in an 'optional extras' file is how a fresh .venv ended up
    without them: the launcher only installs requirements.txt."""
    from pathlib import Path
    req = Path("requirements.txt").read_text(encoding="utf-8")
    for pkg in ("onnxruntime", "opencv-python-headless"):
        assert pkg in req, f"{pkg} must be a default dependency"


def test_face_requirements_do_not_pull_in_the_full_stack():
    """v16 regression: pointing this file at requirements.txt turned a stray
    `pip install -r requirements-face.txt` into a full rebuild, including
    pillow and pydantic-core. On a Python with no wheel for them (3.14) pip
    compiles from source and fails on zlib headers and a PyO3 ceiling - a
    failure that says nothing about this project."""
    from pathlib import Path
    text = Path("requirements-face.txt").read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or not stripped:
            continue
        assert not stripped.startswith("-r "), (
            "requirements-face.txt must not include another requirements file")
        assert not any(p in stripped for p in ("pillow", "pydantic", "fastapi")), (
            f"only face packages belong here: {line}")


def test_windows_launcher_bypasses_execution_policy():
    """PowerShell blocks unsigned scripts by default, so run.bat must exist and
    be the documented entry point - `.\\run.ps1` fails on a stock machine."""
    from pathlib import Path
    bat = Path("run.bat").read_text(encoding="utf-8")
    assert "-ExecutionPolicy Bypass" in bat
    assert "run.ps1" in bat
    readme = Path("README.md").read_text(encoding="utf-8")
    assert "run.bat" in readme


def test_requirements_do_not_reference_insightface():
    """It has no Windows wheel and compiles a 3D mesh renderer we never call."""
    from pathlib import Path
    for f in ("requirements.txt", "requirements-face.txt"):
        text = Path(f).read_text(encoding="utf-8").lower()
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or not stripped:
                continue
            assert "insightface" not in stripped, f"{f}: {line}"


def test_launchers_verify_the_face_stack_imports():
    """Both launchers must fail loudly rather than start a server that cannot
    record attendance."""
    from pathlib import Path
    for f in ("run.ps1", "run.sh"):
        text = Path(f).read_text(encoding="utf-8")
        assert "import cv2, onnxruntime" in text, f"{f} does not verify the face stack"
        assert "download_models.py" in text, f"{f} does not fetch the models"


def test_launchers_no_longer_promise_a_pin_fallback():
    """They used to say 'staff check in with a PIN'. That is now false."""
    from pathlib import Path
    for f in ("run.ps1", "run.sh"):
        text = Path(f).read_text(encoding="utf-8").lower()
        assert "check in with a pin" not in text
        assert "build tools" not in text


def test_tunnel_has_an_execution_policy_safe_launcher():
    """PowerShell blocks unsigned .ps1 by default, so scripts/tunnel.ps1 cannot
    be run directly on a stock machine (the user hit exactly this). A .bat
    wrapper that bypasses the policy must exist, mirroring run.bat."""
    from pathlib import Path
    bat = Path("tunnel.bat")
    assert bat.exists(), "tunnel.bat is missing"
    text = bat.read_text(encoding="utf-8")
    assert "-ExecutionPolicy Bypass" in text
    assert "tunnel.ps1" in text


def test_documented_start_command_matches_the_real_module():
    """The user typed `python -m server.main` (does not exist) and got a
    ModuleNotFoundError. The docs and launchers must all name app.main:app and
    never server.main."""
    from pathlib import Path
    for f in ("README.md", "run.ps1", "run.sh"):
        text = Path(f).read_text(encoding="utf-8")
        assert "app.main:app" in text, f"{f} does not name the real module"
        assert "server.main" not in text.replace("no `server.main`", "").replace(
            "server.main`", ""), f"{f} references a non-existent module"


def test_tunnel_script_checks_app_health_before_installing_anything():
    """A tunnel to a dead port is the 502 'Host Error' the user saw. The script
    must verify /health before downloading cloudflared, so it fails with a clear
    message instead of opening a dead URL."""
    from pathlib import Path
    text = Path("scripts/tunnel.ps1").read_text(encoding="utf-8")
    health_at = text.index("/health")
    install_at = text.index("Have cloudflared")
    assert health_at < install_at, "health check must come before the install"
    assert "502" in text or "Host Error" in text


def test_every_signed_in_page_has_a_viewport_tag():
    """No viewport meta = no mobile scaling, the page renders desktop-wide and
    zoomed out. index.html is exempt: it is a bare redirect."""
    from pathlib import Path
    web = Path("web")
    for html in web.glob("*.html"):
        if html.name == "index.html":
            continue
        text = html.read_text(encoding="utf-8")
        assert 'name="viewport"' in text, f"{html.name} has no viewport meta tag"


def test_shell_wraps_tables_for_mobile():
    """Tables must scroll sideways rather than force the page wide. shell.js
    wraps them (including ones injected after render) via a MutationObserver."""
    from pathlib import Path
    js = Path("web/shell.js").read_text(encoding="utf-8")
    assert "wrapTablesForMobile" in js
    assert "MutationObserver" in js
    assert "table-scroll" in js
    css = Path("web/ui.css").read_text(encoding="utf-8")
    assert ".table-scroll{overflow-x:auto" in css


def test_a_phone_breakpoint_exists():
    from pathlib import Path
    css = Path("web/ui.css").read_text(encoding="utf-8")
    assert "max-width:640px" in css, "no phone breakpoint"
    # 16px inputs prevent iOS auto-zoom on focus
    assert "font-size:16px" in css


def test_no_html_text_shows_literal_unicode_escapes():
    """A backslash-u sequence in HTML text (not a JS string) renders as the
    literal characters '\\u2014' to the user. This bit checkin (v5),
    security and password (v21). Guard every page: strip <script> blocks, then
    assert no \\uXXXX remains in the markup."""
    import re
    from pathlib import Path
    for html in Path("web").glob("*.html"):
        src = html.read_text(encoding="utf-8")
        markup = re.sub(r"<script[\s\S]*?</script>", "", src)
        leaks = re.findall(r"\\u[0-9a-fA-F]{4}", markup)
        assert not leaks, f"{html.name} has literal escapes in HTML text: {leaks}"
