from datetime import date

import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, Role





PW = "CorrectHorse-2026!"


@pytest.fixture(autouse=True)
def fresh_db():
    reset_schema()
    db = TestSession()
    db.add(Employee(employee_code="HR-001", full_name="Aisha Rahman",
                    work_email="hr@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.hr, date_of_joining=date(2023, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.add(Employee(employee_code="EMP-002", full_name="Omar Farouk",
                    work_email="omar@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.employee, date_of_joining=date(2024, 6, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.commit()
    db.close()
    yield


def login(email=..., password=PW):
    email = "hr@manathhomes.ae" if email is ... else email
    return client.post("/api/auth/login", data={"username": email, "password": password})


def test_login_returns_tokens():
    r = login()
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_login_is_case_insensitive_on_email():
    assert login("HR@ManathHomes.AE").status_code == 200


def test_wrong_password_rejected_generically():
    r = login(password="wrong-password-here")
    assert r.status_code == 401
    assert "incorrect" in r.json()["detail"].lower()


def test_unknown_email_gives_same_message_as_wrong_password():
    unknown = login("nobody@manathhomes.ae")
    wrong = login(password="wrong-password-here")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_lockout_after_five_failures():
    for _ in range(5):
        login(password="nope-nope-nope")
    r = login()  # correct password, but locked
    assert r.status_code == 429


def test_exited_employee_cannot_sign_in():
    db = TestSession()
    emp = db.query(Employee).filter(Employee.work_email == "omar@manathhomes.ae").first()
    emp.status = EmploymentStatus.exited
    db.commit()
    db.close()
    assert login("omar@manathhomes.ae").status_code == 403


def test_me_requires_token():
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_profile():
    token = login().json()["access_token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["employee_code"] == "HR-001"
    assert body["biometric_consent"] is False
    assert body["face_enrolled"] is False


def test_refresh_rotates_and_old_token_is_dead():
    tokens = login().json()
    first = tokens["refresh_token"]
    r = client.post("/api/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    assert r.json()["refresh_token"] != first
    # replaying the rotated token must fail
    assert client.post("/api/auth/refresh", json={"refresh_token": first}).status_code == 401


def test_refresh_replay_revokes_the_new_token_too():
    tokens = login().json()
    old = tokens["refresh_token"]
    new = client.post("/api/auth/refresh", json={"refresh_token": old}).json()["refresh_token"]
    client.post("/api/auth/refresh", json={"refresh_token": old})   # replay
    assert client.post("/api/auth/refresh", json={"refresh_token": new}).status_code == 401


def test_access_token_rejected_at_refresh_endpoint():
    access = login().json()["access_token"]
    assert client.post("/api/auth/refresh", json={"refresh_token": access}).status_code == 401


def test_consent_grant_and_withdraw():
    token = login().json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/auth/consent", json={"accepted": True, "policy_version": "v1"}, headers=h)
    assert r.json()["biometric_consent"] is True
    assert client.get("/api/auth/me", headers=h).json()["biometric_consent"] is True

    r = client.post("/api/auth/consent", json={"accepted": False, "policy_version": "v1"}, headers=h)
    assert r.json()["biometric_consent"] is False
    assert "deleted" in r.json()["message"].lower()


def test_password_change_kills_other_sessions():
    tokens = login().json()
    h = {"Authorization": f"Bearer {tokens['access_token']}"}
    r = client.post("/api/auth/password",
                    json={"current_password": PW, "new_password": "AnotherLong-Pass-2026!"},
                    headers=h)
    assert r.status_code == 200
    assert client.post("/api/auth/refresh",
                       json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert login(password="AnotherLong-Pass-2026!").status_code == 200


def test_password_change_rejects_wrong_current():
    token = login().json()["access_token"]
    r = client.post("/api/auth/password",
                    json={"current_password": "not-it-at-all", "new_password": "Whatever-Long-1234!"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_short_password_rejected():
    token = login().json()["access_token"]
    r = client.post("/api/auth/password",
                    json={"current_password": PW, "new_password": "short"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422


def test_employee_cannot_create_employees():
    token = login("omar@manathhomes.ae").json()["access_token"]
    r = client.post("/api/auth/employees", headers={"Authorization": f"Bearer {token}"},
                    json={"employee_code": "EMP-003", "full_name": "New Hire",
                          "work_email": "new@manathhomes.ae",
                          "temporary_password": "TempPass-2026-x!",
                          "date_of_joining": "2026-08-01"})
    assert r.status_code == 403


def test_hr_creates_employee_who_can_sign_in():
    token = login().json()["access_token"]
    r = client.post("/api/auth/employees", headers={"Authorization": f"Bearer {token}"},
                    json={"employee_code": "EMP-003", "full_name": "Layla Haddad",
                          "work_email": "layla@manathhomes.ae",
                          "temporary_password": "TempPass-2026-x!",
                          "designation": "Sales Agent", "department": "Brokerage",
                          "date_of_joining": "2026-08-01", "basic_salary": 8000,
                          "rera_brn": "BRN-44821"})
    assert r.status_code == 201
    assert login("layla@manathhomes.ae", "TempPass-2026-x!").status_code == 200


def test_hr_cannot_create_admin():
    token = login().json()["access_token"]
    r = client.post("/api/auth/employees", headers={"Authorization": f"Bearer {token}"},
                    json={"employee_code": "ADM-009", "full_name": "Sneaky",
                          "work_email": "sneaky@manathhomes.ae", "role": "admin",
                          "temporary_password": "TempPass-2026-x!",
                          "date_of_joining": "2026-08-01"})
    assert r.status_code == 403


def test_duplicate_email_rejected():
    token = login().json()["access_token"]
    payload = {"employee_code": "EMP-004", "full_name": "Dup",
               "work_email": "omar@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
               "date_of_joining": "2026-08-01"}
    r = client.post("/api/auth/employees", headers={"Authorization": f"Bearer {token}"},
                    json=payload)
    assert r.status_code == 409


def test_logout_all_ends_sessions():
    a = login().json()
    b = login().json()
    client.post("/api/auth/logout-all", headers={"Authorization": f"Bearer {a['access_token']}"})
    assert client.post("/api/auth/refresh",
                       json={"refresh_token": b["refresh_token"]}).status_code == 401
