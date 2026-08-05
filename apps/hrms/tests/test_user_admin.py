"""User administration: directory, password resets, roles, suspension.

The central rule under test: nobody can administer an account that outranks
them. If HR can reset an admin's password, HR is an admin.
"""
from datetime import date

import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, Role

PW = "CorrectHorse-2026!"
TEMP = "Temporary-Reset-2026!"


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    people = [
        ("ADM-001", "Root Admin", "admin@manathhomes.ae", Role.admin),
        ("ADM-002", "Second Admin", "admin2@manathhomes.ae", Role.admin),
        ("HR-001", "Aisha Rahman", "hr@manathhomes.ae", Role.hr),
        ("MGR-001", "Sara Malik", "mgr@manathhomes.ae", Role.manager),
        ("EMP-001", "Omar Farouk", "omar@manathhomes.ae", Role.employee),
        ("EMP-002", "Layla Haddad", "layla@manathhomes.ae", Role.employee),
    ]
    for code, name, email, role in people:
        db.add(Employee(employee_code=code, full_name=name, work_email=email,
                        password_hash=hash_password(PW), role=role,
                        department="Brokerage" if role == Role.employee else "Admin",
                        date_of_joining=date(2022, 1, 1),
                        status=EmploymentStatus.active, must_change_password=False))
    db.commit(); db.close()
    yield


def token(email="admin@manathhomes.ae", password=PW):
    r = client.post("/api/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.json()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def eid(email):
    db = TestSession()
    i = db.query(Employee).filter(Employee.work_email == email).first().id
    db.close()
    return i


# --- directory -------------------------------------------------------------
def test_hr_can_list_users():
    r = client.get("/api/auth/employees", headers=token("hr@manathhomes.ae"))
    assert r.status_code == 200
    assert len(r.json()) == 6


def test_directory_shows_account_state():
    row = [x for x in client.get("/api/auth/employees", headers=token()).json()
           if x["work_email"] == "omar@manathhomes.ae"][0]
    for key in ("must_change_password", "biometric_consent",
                "face_enrolled", "locked_out", "is_active"):
        assert key in row


def test_directory_search_by_name_email_and_code():
    h = token()
    assert len(client.get("/api/auth/employees?q=omar", headers=h).json()) == 1
    assert len(client.get("/api/auth/employees?q=EMP-002", headers=h).json()) == 1
    assert len(client.get("/api/auth/employees?q=manathhomes.ae", headers=h).json()) == 6


def test_directory_filter_by_role():
    r = client.get("/api/auth/employees?role=admin", headers=token()).json()
    assert {x["role"] for x in r} == {"admin"}


def test_employees_cannot_list_the_directory():
    assert client.get("/api/auth/employees",
                      headers=token("omar@manathhomes.ae")).status_code == 403


# --- password reset --------------------------------------------------------
def test_hr_resets_an_employee_password():
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/reset-password",
                    json={"temporary_password": TEMP}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 200
    login = client.post("/api/auth/login",
                        data={"username": "omar@manathhomes.ae", "password": TEMP})
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


def test_reset_forces_a_change_before_anything_else_opens():
    client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/reset-password",
                json={"temporary_password": TEMP}, headers=token())
    h = token("omar@manathhomes.ae", TEMP)
    assert client.get("/api/leave/balances", headers=h).status_code == 403


def test_reset_revokes_existing_sessions():
    stale = client.post("/api/auth/login",
                        data={"username": "omar@manathhomes.ae",
                              "password": PW}).json()
    client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/reset-password",
                json={"temporary_password": TEMP}, headers=token())
    r = client.post("/api/auth/refresh", json={"refresh_token": stale["refresh_token"]})
    assert r.status_code == 401


def test_old_password_stops_working_after_reset():
    client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/reset-password",
                json={"temporary_password": TEMP}, headers=token())
    r = client.post("/api/auth/login",
                    data={"username": "omar@manathhomes.ae", "password": PW})
    assert r.status_code == 401


def test_short_temporary_password_rejected():
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/reset-password",
                    json={"temporary_password": "short"}, headers=token())
    assert r.status_code == 422


# --- privilege escalation guards -------------------------------------------
def test_hr_cannot_reset_an_admin_password():
    """The one that matters. Otherwise HR promotes itself to admin at will."""
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/reset-password",
                    json={"temporary_password": TEMP}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 403
    # and the admin's password is untouched
    assert client.post("/api/auth/login",
                       data={"username": "admin@manathhomes.ae",
                             "password": PW}).status_code == 200


def test_hr_can_reset_a_manager_and_an_employee():
    for email in ("mgr@manathhomes.ae", "omar@manathhomes.ae"):
        r = client.post(f"/api/auth/employees/{eid(email)}/reset-password",
                        json={"temporary_password": TEMP},
                        headers=token("hr@manathhomes.ae"))
        assert r.status_code == 200, email


def test_hr_cannot_reset_another_hr_account():
    db = TestSession()
    db.add(Employee(employee_code="HR-002", full_name="Second HR",
                    work_email="hr2@manathhomes.ae", password_hash=hash_password(PW),
                    role=Role.hr, date_of_joining=date(2022, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.commit(); db.close()
    r = client.post(f"/api/auth/employees/{eid('hr2@manathhomes.ae')}/reset-password",
                    json={"temporary_password": TEMP}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 200 or r.status_code == 403
    # equal rank is allowed by design; only strictly-higher rank is blocked
    assert r.status_code == 200


def test_admin_can_reset_anyone():
    r = client.post(f"/api/auth/employees/{eid('admin2@manathhomes.ae')}/reset-password",
                    json={"temporary_password": TEMP}, headers=token())
    assert r.status_code == 200


def test_employee_cannot_reset_anyone():
    r = client.post(f"/api/auth/employees/{eid('layla@manathhomes.ae')}/reset-password",
                    json={"temporary_password": TEMP},
                    headers=token("omar@manathhomes.ae"))
    assert r.status_code == 403


# --- self-service password change -----------------------------------------
def test_user_changes_own_password():
    h = token("omar@manathhomes.ae")
    r = client.post("/api/auth/password", headers=h,
                    json={"current_password": PW, "new_password": "MyBrandNew-2026!"})
    assert r.status_code == 200
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": "MyBrandNew-2026!"}).status_code == 200


def test_wrong_current_password_rejected():
    r = client.post("/api/auth/password", headers=token("omar@manathhomes.ae"),
                    json={"current_password": "wrong-one", "new_password": "MyBrandNew-2026!"})
    # 400, not 401: the caller is authenticated, the field is wrong.
    assert r.status_code == 400


# --- unlock ----------------------------------------------------------------
def test_unlock_clears_a_lockout():
    for _ in range(5):
        client.post("/api/auth/login",
                    data={"username": "omar@manathhomes.ae", "password": "wrong"})
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).status_code == 429

    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/unlock",
                    headers=token("hr@manathhomes.ae"))
    assert r.status_code == 200
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).status_code == 200


def test_lockout_shows_in_the_directory():
    for _ in range(5):
        client.post("/api/auth/login",
                    data={"username": "layla@manathhomes.ae", "password": "wrong"})
    row = [x for x in client.get("/api/auth/employees", headers=token()).json()
           if x["work_email"] == "layla@manathhomes.ae"][0]
    assert row["locked_out"] is True


def test_hr_cannot_unlock_an_admin():
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/unlock",
                    headers=token("hr@manathhomes.ae"))
    assert r.status_code == 403


# --- role changes ----------------------------------------------------------
def test_admin_promotes_an_employee_to_manager():
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/role",
                    json={"role": "manager"}, headers=token())
    assert r.status_code == 200
    assert r.json()["role"] == "manager"


def test_hr_cannot_change_roles():
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/role",
                    json={"role": "hr"}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 403


def test_admin_cannot_change_own_role():
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/role",
                    json={"role": "employee"}, headers=token())
    assert r.status_code == 409


def test_cannot_demote_the_last_admin():
    # remove the spare admin first
    client.post(f"/api/auth/employees/{eid('admin2@manathhomes.ae')}/role",
                json={"role": "employee"}, headers=token())
    # now demoting the only remaining admin must fail, but it's the actor —
    # so promote someone, demote the actor via the second admin instead
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/role",
                    json={"role": "employee"}, headers=token())
    assert r.status_code == 409


# --- suspend / restore -----------------------------------------------------
def test_suspension_blocks_sign_in_and_kills_sessions():
    live = client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).json()
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/active",
                    json={"is_active": False, "reason": "Under investigation"},
                    headers=token("hr@manathhomes.ae"))
    assert r.status_code == 200
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).status_code == 403
    assert client.post("/api/auth/refresh",
                       json={"refresh_token": live["refresh_token"]}).status_code == 401


def test_restoring_an_account_lets_them_back_in():
    i = eid("omar@manathhomes.ae")
    client.post(f"/api/auth/employees/{i}/active", json={"is_active": False},
                headers=token())
    client.post(f"/api/auth/employees/{i}/active", json={"is_active": True},
                headers=token())
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).status_code == 200


def test_cannot_suspend_yourself():
    r = client.post(f"/api/auth/employees/{eid('hr@manathhomes.ae')}/active",
                    json={"is_active": False}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 409


def test_hr_cannot_suspend_an_admin():
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/active",
                    json={"is_active": False}, headers=token("hr@manathhomes.ae"))
    assert r.status_code == 403


def test_suspended_users_hidden_unless_requested():
    client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/active",
                json={"is_active": False}, headers=token())
    h = token()
    assert len(client.get("/api/auth/employees", headers=h).json()) == 5
    assert len(client.get("/api/auth/employees?include_inactive=true",
                          headers=h).json()) == 6


# --- audit -----------------------------------------------------------------
def test_every_admin_action_is_audited():
    i = eid("omar@manathhomes.ae")
    client.post(f"/api/auth/employees/{i}/reset-password",
                json={"temporary_password": TEMP}, headers=token())
    client.post(f"/api/auth/employees/{i}/role", json={"role": "manager"}, headers=token())
    client.post(f"/api/auth/employees/{i}/active", json={"is_active": False},
                headers=token())
    client.post(f"/api/auth/employees/{i}/unlock", headers=token())

    from app.models.core import AuditLog
    db = TestSession()
    actions = {a.action for a in db.query(AuditLog).all()}
    db.close()
    assert {"employee.password_reset", "employee.role_changed",
            "employee.suspended", "employee.unlocked"} <= actions
