from datetime import date, timedelta

import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, Holiday, LeaveType, Role





PW = "CorrectHorse-2026!"

# A fixed Monday well inside the current year, so weekend maths is predictable.
def next_monday(offset_weeks=2):
    d = date.today() + timedelta(weeks=offset_weeks)
    return d + timedelta(days=(7 - d.weekday()) % 7)


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    hr = Employee(employee_code="HR-001", full_name="Aisha Rahman",
                  work_email="hr@company.ae", password_hash=hash_password(PW),
                  role=Role.hr, date_of_joining=date(2020, 1, 1),
                  status=EmploymentStatus.active, must_change_password=False)
    db.add(hr); db.commit(); db.refresh(hr)

    mgr = Employee(employee_code="MGR-001", full_name="Khalid Nasser",
                   work_email="khalid@company.ae", password_hash=hash_password(PW),
                   role=Role.manager, date_of_joining=date(2021, 1, 1),
                   status=EmploymentStatus.active, must_change_password=False)
    db.add(mgr); db.commit(); db.refresh(mgr)

    # Joined years ago, so annual leave is fully accrued.
    db.add(Employee(employee_code="EMP-002", full_name="Omar Farouk",
                    work_email="omar@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, manager_id=mgr.id,
                    date_of_joining=date(2022, 1, 1), status=EmploymentStatus.active, must_change_password=False))
    # Brand new joiner — under 6 months, so zero annual accrual.
    db.add(Employee(employee_code="EMP-003", full_name="Layla Haddad",
                    work_email="layla@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, manager_id=mgr.id,
                    date_of_joining=date.today() - timedelta(days=40),
                    status=EmploymentStatus.active, must_change_password=False))

    db.add(LeaveType(code="ANNUAL", name="Annual leave", annual_entitlement_days=30,
                     is_paid=True, accrues=True, max_carry_forward_days=15))
    db.add(LeaveType(code="SICK_FULL", name="Sick leave (full pay)",
                     annual_entitlement_days=15, is_paid=True, accrues=False,
                     requires_document=True))
    db.add(LeaveType(code="HAJJ", name="Hajj leave", annual_entitlement_days=30,
                     is_paid=False, accrues=False))
    db.commit(); db.close()
    yield


def token(email="omar@company.ae"):
    r = client.post("/api/auth/login", data={"username": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def apply_leave(headers, code="ANNUAL", start=None, end=None, **kw):
    start = start or next_monday()
    end = end or (start + timedelta(days=2))
    payload = {"leave_type_code": code, "start_date": str(start), "end_date": str(end)}
    payload.update(kw)
    return client.post("/api/leave/apply", json=payload, headers=headers)


# --- balances --------------------------------------------------------------
def test_balances_show_full_annual_for_tenured_employee():
    r = client.get("/api/leave/balances", headers=token())
    assert r.status_code == 200
    annual = next(b for b in r.json() if b["leave_type_code"] == "ANNUAL")
    assert annual["available_days"] > 0
    assert annual["entitled_days"] == 30


def test_new_joiner_has_no_annual_accrual_yet():
    r = client.get("/api/leave/balances", headers=token("layla@company.ae"))
    annual = next(b for b in r.json() if b["leave_type_code"] == "ANNUAL")
    assert annual["available_days"] == 0.0


def test_non_accruing_type_is_available_in_full_immediately():
    r = client.get("/api/leave/balances", headers=token("layla@company.ae"))
    sick = next(b for b in r.json() if b["leave_type_code"] == "SICK_FULL")
    assert sick["available_days"] == 15.0


def test_employee_cannot_read_another_persons_balance():
    r = client.get("/api/leave/balances?employee_id=1", headers=token())
    assert r.status_code == 403


def test_manager_reads_own_team_balance():
    db = TestSession()
    omar = db.query(Employee).filter(Employee.work_email == "omar@company.ae").first()
    oid = omar.id
    db.close()
    r = client.get(f"/api/leave/balances?employee_id={oid}", headers=token("khalid@company.ae"))
    assert r.status_code == 200


# --- applying --------------------------------------------------------------
def test_apply_creates_pending_request_routed_to_manager():
    r = apply_leave(token())
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert body["days_count"] == 3.0
    assert body["employee_name"] == "Omar Farouk"


def test_weekend_days_are_not_counted():
    mon = next_monday()
    r = apply_leave(token(), start=mon, end=mon + timedelta(days=6))  # Mon..Sun
    assert r.json()["days_count"] == 5.0


def test_public_holiday_is_not_counted():
    mon = next_monday()
    db = TestSession()
    db.add(Holiday(holiday_date=mon, name="Eid", year=mon.year, is_confirmed=True))
    db.commit(); db.close()
    r = apply_leave(token(), start=mon, end=mon + timedelta(days=2))
    assert r.json()["days_count"] == 2.0


def test_all_holiday_range_is_rejected():
    mon = next_monday()
    db = TestSession()
    for i in range(3):
        db.add(Holiday(holiday_date=mon + timedelta(days=i), name=f"H{i}",
                       year=mon.year, is_confirmed=True))
    db.commit(); db.close()
    r = apply_leave(token(), start=mon, end=mon + timedelta(days=2))
    assert r.status_code == 422


def test_half_day_counts_as_point_five():
    mon = next_monday()
    r = apply_leave(token(), start=mon, end=mon, half_day=True)
    assert r.json()["days_count"] == 0.5


def test_half_day_across_two_dates_rejected():
    mon = next_monday()
    r = apply_leave(token(), start=mon, end=mon + timedelta(days=1), half_day=True)
    assert r.status_code == 422


def test_reversed_dates_rejected():
    mon = next_monday()
    r = apply_leave(token(), start=mon + timedelta(days=3), end=mon)
    assert r.status_code == 422


def test_overlapping_request_rejected():
    apply_leave(token())
    r = apply_leave(token(), start=next_monday() + timedelta(days=1),
                    end=next_monday() + timedelta(days=3))
    assert r.status_code == 409
    assert "already have leave" in r.json()["detail"]


def test_cancelled_request_frees_the_dates():
    first = apply_leave(token()).json()
    client.post(f"/api/leave/{first['id']}/cancel", headers=token())
    assert apply_leave(token()).status_code == 201


def test_insufficient_balance_rejected():
    mon = next_monday()
    r = apply_leave(token("layla@company.ae"), start=mon, end=mon + timedelta(days=4))
    assert r.status_code == 409
    assert "available" in r.json()["detail"]


def test_unpaid_leave_bypasses_balance_check():
    mon = next_monday()
    r = apply_leave(token("layla@company.ae"), code="HAJJ",
                    start=mon, end=mon + timedelta(days=4))
    assert r.status_code == 201


def test_sick_leave_requires_document():
    r = apply_leave(token(), code="SICK_FULL")
    assert r.status_code == 422
    r = apply_leave(token(), code="SICK_FULL", document_path="/docs/note.pdf")
    assert r.status_code == 201


def test_unknown_leave_type_rejected():
    assert apply_leave(token(), code="NONSENSE").status_code == 404


def test_far_backdated_request_rejected():
    old = date.today() - timedelta(days=60)
    r = apply_leave(token(), start=old, end=old + timedelta(days=1))
    assert r.status_code == 422


# --- approval --------------------------------------------------------------
def test_manager_approves_and_balance_drops():
    before = next(b for b in client.get("/api/leave/balances", headers=token()).json()
                  if b["leave_type_code"] == "ANNUAL")["available_days"]
    req = apply_leave(token()).json()
    r = client.post(f"/api/leave/{req['id']}/approve", json={"note": "ok"},
                    headers=token("khalid@company.ae"))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    after = next(b for b in client.get("/api/leave/balances", headers=token()).json()
                 if b["leave_type_code"] == "ANNUAL")["available_days"]
    assert after == before - 3.0


def test_employee_cannot_approve_own_leave():
    req = apply_leave(token()).json()
    r = client.post(f"/api/leave/{req['id']}/approve", json={}, headers=token())
    assert r.status_code == 403


def test_unrelated_manager_cannot_approve():
    req = apply_leave(token()).json()
    db = TestSession()
    db.add(Employee(employee_code="MGR-009", full_name="Other Manager",
                    work_email="other@company.ae", password_hash=hash_password(PW),
                    role=Role.manager, date_of_joining=date(2021, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.commit(); db.close()
    r = client.post(f"/api/leave/{req['id']}/approve", json={},
                    headers=token("other@company.ae"))
    assert r.status_code == 403


def test_hr_can_approve_anything():
    req = apply_leave(token()).json()
    r = client.post(f"/api/leave/{req['id']}/approve", json={}, headers=token("hr@company.ae"))
    assert r.status_code == 200


def test_reject_requires_a_reason():
    req = apply_leave(token()).json()
    r = client.post(f"/api/leave/{req['id']}/reject", json={},
                    headers=token("khalid@company.ae"))
    assert r.status_code == 422
    r = client.post(f"/api/leave/{req['id']}/reject", json={"note": "Peak season"},
                    headers=token("khalid@company.ae"))
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_rejected_leave_does_not_consume_balance():
    before = next(b for b in client.get("/api/leave/balances", headers=token()).json()
                  if b["leave_type_code"] == "ANNUAL")["available_days"]
    req = apply_leave(token()).json()
    client.post(f"/api/leave/{req['id']}/reject", json={"note": "no"},
                headers=token("khalid@company.ae"))
    after = next(b for b in client.get("/api/leave/balances", headers=token()).json()
                 if b["leave_type_code"] == "ANNUAL")["available_days"]
    assert after == before


def test_cannot_decide_twice():
    req = apply_leave(token()).json()
    client.post(f"/api/leave/{req['id']}/approve", json={}, headers=token("khalid@company.ae"))
    r = client.post(f"/api/leave/{req['id']}/approve", json={},
                    headers=token("khalid@company.ae"))
    assert r.status_code == 409


def test_pending_queue_scoped_to_approver():
    apply_leave(token())
    assert len(client.get("/api/leave/pending", headers=token("khalid@company.ae")).json()) == 1
    assert len(client.get("/api/leave/pending", headers=token()).json()) == 0


# --- visibility ------------------------------------------------------------
def test_employee_cannot_read_someone_elses_request():
    req = apply_leave(token()).json()
    db = TestSession()
    db.add(Employee(employee_code="EMP-009", full_name="Nosy Colleague",
                    work_email="nosy@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, date_of_joining=date(2022, 1, 1),
                    status=EmploymentStatus.active, must_change_password=False))
    db.commit(); db.close()
    r = client.get(f"/api/leave/{req['id']}", headers=token("nosy@company.ae"))
    assert r.status_code == 403


def test_team_calendar_shows_approved_leave_to_manager():
    req = apply_leave(token()).json()
    client.post(f"/api/leave/{req['id']}/approve", json={}, headers=token("khalid@company.ae"))
    start = next_monday() - timedelta(days=7)
    r = client.get(f"/api/leave/calendar/team?start={start}&end={start + timedelta(days=30)}",
                   headers=token("khalid@company.ae"))
    assert r.status_code == 200
    assert any(x["employee"] == "Omar Farouk" for x in r.json()["leave"])


# --- holidays / year end ---------------------------------------------------
def test_only_hr_adds_holidays():
    payload = {"holiday_date": str(date(2026, 12, 2)), "name": "National Day"}
    assert client.post("/api/leave/holidays", json=payload, headers=token()).status_code == 403
    assert client.post("/api/leave/holidays", json=payload,
                       headers=token("hr@company.ae")).status_code == 201


def test_duplicate_holiday_rejected():
    payload = {"holiday_date": str(date(2026, 12, 2)), "name": "National Day"}
    client.post("/api/leave/holidays", json=payload, headers=token("hr@company.ae"))
    r = client.post("/api/leave/holidays", json=payload, headers=token("hr@company.ae"))
    assert r.status_code == 409


def test_carry_forward_capped_at_policy_limit():
    db = TestSession()
    from app.models.core import LeaveBalance
    omar = db.query(Employee).filter(Employee.work_email == "omar@company.ae").first()
    annual = db.query(LeaveType).filter(LeaveType.code == "ANNUAL").first()
    db.add(LeaveBalance(employee_id=omar.id, leave_type_id=annual.id,
                        year=date.today().year - 1, entitled_days=30,
                        accrued_days=30, taken_days=2))   # 28 unused, cap is 15
    db.commit(); db.close()
    r = client.post(f"/api/leave/year-end/carry-forward?from_year={date.today().year - 1}",
                    headers=token("hr@company.ae"))
    assert r.status_code == 200
    rolled = [x for x in r.json()["rolled"] if x["leave_type"] == "ANNUAL"]
    assert rolled and rolled[0]["days_carried"] == 15.0


def test_carry_forward_is_hr_only():
    r = client.post("/api/leave/year-end/carry-forward?from_year=2025", headers=token())
    assert r.status_code == 403
