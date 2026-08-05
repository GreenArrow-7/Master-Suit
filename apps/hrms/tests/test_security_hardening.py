"""Forced password change, document storage, and config guards."""
import io
from datetime import date

import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.config import INSECURE_SECRET, Settings
from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, Role
from app.services.documents import save_upload, stored_path

PW = "CorrectHorse-2026!"
NEW_PW = "AnotherLong-Pass-2026!"

PNG = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
PDF = b"%PDF-1.7\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    db.add(Employee(employee_code="HR-001", full_name="Aisha Rahman",
                    work_email="hr@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.hr, date_of_joining=date(2020, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    # New hire holding a temporary password
    db.add(Employee(employee_code="EMP-009", full_name="New Hire",
                    work_email="new@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.employee, date_of_joining=date(2026, 1, 1),
                    status=EmploymentStatus.active, must_change_password=True))
    db.commit(); db.close()
    yield


def token(email="hr@manathhomes.ae", password=PW):
    r = client.post("/api/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --- forced password change ------------------------------------------------
def test_login_signals_password_change_required():
    r = client.post("/api/auth/login",
                    data={"username": "new@manathhomes.ae", "password": PW})
    assert r.json()["must_change_password"] is True


def test_temp_password_holder_is_locked_out_of_the_system():
    h = token("new@manathhomes.ae")
    for path in ["/api/leave/balances", "/api/leave/types", "/api/attendance/mine"]:
        r = client.get(path, headers=h)
        assert r.status_code == 403, path
        assert "new password" in r.json()["detail"].lower()


def test_temp_password_holder_can_still_reach_me_and_password():
    h = token("new@manathhomes.ae")
    assert client.get("/api/auth/me", headers=h).status_code == 200
    r = client.post("/api/auth/password", headers=h,
                    json={"current_password": PW, "new_password": NEW_PW})
    assert r.status_code == 200


def test_system_opens_once_password_is_changed():
    h = token("new@manathhomes.ae")
    client.post("/api/auth/password", headers=h,
                json={"current_password": PW, "new_password": NEW_PW})
    h2 = token("new@manathhomes.ae", NEW_PW)
    assert client.get("/api/leave/balances", headers=h2).status_code == 200
    assert client.get("/api/auth/me", headers=h2).json()["must_change_password"] is False


def test_hr_created_employee_starts_flagged():
    r = client.post("/api/auth/employees", headers=token(), json={
        "employee_code": "EMP-100", "full_name": "Fresh Start",
        "work_email": "fresh@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"})
    assert r.status_code == 201
    login = client.post("/api/auth/login",
                        data={"username": "fresh@manathhomes.ae",
                              "password": "TempPass-2026-x!"})
    assert login.json()["must_change_password"] is True


# --- config guards ---------------------------------------------------------
def test_production_refuses_default_secret():
    s = Settings(ENVIRONMENT="production", JWT_SECRET=INSECURE_SECRET)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        s.validate_runtime()


def test_production_refuses_short_secret():
    s = Settings(ENVIRONMENT="production", JWT_SECRET="tooshort")
    with pytest.raises(RuntimeError):
        s.validate_runtime()


def test_development_only_warns():
    s = Settings(ENVIRONMENT="development", JWT_SECRET=INSECURE_SECRET)
    with pytest.warns(UserWarning):
        s.validate_runtime()


# --- document storage ------------------------------------------------------
def test_stored_name_is_generated_not_user_supplied():
    meta = save_upload(PNG, "../../etc/passwd.png", "image/png")
    assert "passwd" not in meta["stored_name"]
    assert ".." not in meta["stored_name"]
    assert meta["original_filename"] == "passwd.png"


def test_content_type_is_sniffed_not_trusted():
    meta = save_upload(PDF, "scan.png", "image/png")
    assert meta["content_type"] == "application/pdf"


def test_executable_disguised_as_image_rejected():
    with pytest.raises(ValueError, match="PDF or an image"):
        save_upload(b"MZ\x90\x00" + b"\x00" * 64, "photo.jpg", "image/jpeg")


def test_empty_file_rejected():
    with pytest.raises(ValueError):
        save_upload(b"", "x.pdf", "application/pdf")


def test_oversized_file_rejected():
    from app.core.config import settings
    big = b"%PDF" + b"\x00" * (settings.MAX_DOCUMENT_BYTES + 1)
    with pytest.raises(ValueError, match="under"):
        save_upload(big, "big.pdf", "application/pdf")


def test_path_traversal_in_stored_name_blocked():
    p = stored_path("../../../etc/passwd")
    assert p.name == "passwd"
    assert "etc" not in str(p.parent)


def test_upload_download_roundtrip_is_audited():
    emp = client.post("/api/auth/employees", headers=token(), json={
        "employee_code": "EMP-200", "full_name": "Doc Holder",
        "work_email": "doc@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"}).json()

    up = client.post("/api/lifecycle/documents/upload", headers=token(),
                     data={"employee_id": emp["id"], "kind": "passport",
                           "number": "P1234567", "expiry_date": "2030-01-01"},
                     files={"file": ("passport.pdf", io.BytesIO(PDF), "application/pdf")})
    assert up.status_code == 201
    doc_id = up.json()["id"]
    assert up.json()["sha256"]

    down = client.get(f"/api/lifecycle/documents/{doc_id}/download", headers=token())
    assert down.status_code == 200
    assert down.content == PDF

    from app.models.core import AuditLog
    db = TestSession()
    actions = {a.action for a in db.query(AuditLog).all()}
    db.close()
    assert "document.uploaded" in actions
    assert "document.downloaded" in actions


def test_document_download_is_hr_only():
    emp = client.post("/api/auth/employees", headers=token(), json={
        "employee_code": "EMP-201", "full_name": "Doc Holder Two",
        "work_email": "doc2@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"}).json()
    up = client.post("/api/lifecycle/documents/upload", headers=token(),
                     data={"employee_id": emp["id"], "kind": "visa"},
                     files={"file": ("v.pdf", io.BytesIO(PDF), "application/pdf")})
    # sign the employee in properly first
    h = token("doc2@manathhomes.ae", "TempPass-2026-x!")
    client.post("/api/auth/password", headers=h,
                json={"current_password": "TempPass-2026-x!", "new_password": NEW_PW})
    h2 = token("doc2@manathhomes.ae", NEW_PW)
    r = client.get(f"/api/lifecycle/documents/{up.json()['id']}/download", headers=h2)
    assert r.status_code == 403


def test_deleting_document_removes_the_file():
    emp = client.post("/api/auth/employees", headers=token(), json={
        "employee_code": "EMP-202", "full_name": "Doc Holder Three",
        "work_email": "doc3@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"}).json()
    up = client.post("/api/lifecycle/documents/upload", headers=token(),
                     data={"employee_id": emp["id"], "kind": "visa"},
                     files={"file": ("v.pdf", io.BytesIO(PDF), "application/pdf")}).json()
    db = TestSession()
    from app.models.core import EmployeeDocument
    stored = db.query(EmployeeDocument).filter(
        EmployeeDocument.id == up["id"]).first().file_path
    db.close()
    assert stored_path(stored).exists()
    assert client.delete(f"/api/lifecycle/documents/{up['id']}",
                         headers=token()).status_code == 200
    assert not stored_path(stored).exists()
