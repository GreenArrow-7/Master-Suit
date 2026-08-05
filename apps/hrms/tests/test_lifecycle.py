from datetime import date, timedelta

import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.security import hash_password
from app.models.core import (
    ChecklistPhase, ChecklistTask, Employee, EmploymentStatus, LeaveBalance,
    LeaveType, Role,
)

PW = "CorrectHorse-2026!"


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    hr = Employee(employee_code="HR-001", full_name="Aisha Rahman",
                  work_email="hr@company.ae", password_hash=hash_password(PW),
                  role=Role.hr, date_of_joining=date(2020, 1, 1),
                  status=EmploymentStatus.active, must_change_password=False)
    db.add(hr); db.commit(); db.refresh(hr)

    # Back-office new joiner
    db.add(Employee(employee_code="EMP-010", full_name="Rami Saleh",
                    work_email="rami@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, department="Finance",
                    date_of_joining=date.today() + timedelta(days=14),
                    status=EmploymentStatus.onboarding, basic_salary=9000, must_change_password=False))
    # Agent — should get the RERA track
    db.add(Employee(employee_code="AGT-001", full_name="Nadia Kassem",
                    work_email="nadia@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, department="Brokerage",
                    date_of_joining=date.today() + timedelta(days=7),
                    status=EmploymentStatus.onboarding, basic_salary=12000, must_change_password=False))
    # Long-tenured, still active — the one we offboard
    db.add(Employee(employee_code="EMP-020", full_name="Omar Farouk",
                    work_email="omar@company.ae", password_hash=hash_password(PW),
                    role=Role.employee, department="Operations",
                    date_of_joining=date(2019, 1, 1),
                    status=EmploymentStatus.active, basic_salary=10000, must_change_password=False))
    db.add(LeaveType(code="ANNUAL", name="Annual leave", annual_entitlement_days=30,
                     is_paid=True, accrues=True, max_carry_forward_days=15))
    db.commit(); db.close()
    yield


def token(email="hr@company.ae"):
    r = client.post("/api/auth/login", data={"username": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def emp_id(email):
    db = TestSession()
    e = db.query(Employee).filter(Employee.work_email == email).first()
    i = e.id
    db.close()
    return i


def start_onboarding(email="rami@company.ae"):
    return client.post("/api/lifecycle/onboarding/start",
                       json={"employee_id": emp_id(email)}, headers=token())


def complete_all_blockers(eid, phase):
    db = TestSession()
    ids = [t.id for t in db.query(ChecklistTask)
           .filter(ChecklistTask.employee_id == eid,
                   ChecklistTask.phase == phase,
                   ChecklistTask.blocking.is_(True)).all()]
    db.close()
    for tid in ids:
        client.post(f"/api/lifecycle/tasks/{tid}/complete", json={}, headers=token())


# --- onboarding ------------------------------------------------------------
def test_onboarding_creates_checklist():
    r = start_onboarding()
    assert r.status_code == 201
    assert r.json()["tasks_created"] > 10
    assert r.json()["agent_track"] is False


def test_agent_gets_rera_tasks():
    r = start_onboarding("nadia@company.ae")
    assert r.json()["agent_track"] is True
    tasks = client.get(f"/api/lifecycle/{emp_id('nadia@company.ae')}/checklist",
                       headers=token()).json()
    titles = [t["title"] for t in tasks]
    assert any("BRN" in t for t in titles)
    assert any("RERA" in t for t in titles)


def test_back_office_does_not_get_rera_tasks():
    start_onboarding()
    tasks = client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                       headers=token()).json()
    assert not any("BRN" in t["title"] for t in tasks)


def test_restarting_onboarding_does_not_duplicate():
    start_onboarding()
    first = len(client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                           headers=token()).json())
    r = start_onboarding()
    assert r.json()["tasks_created"] == 0
    second = len(client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                            headers=token()).json())
    assert first == second


def test_only_hr_starts_onboarding():
    r = client.post("/api/lifecycle/onboarding/start",
                    json={"employee_id": emp_id("rami@company.ae")},
                    headers=token("omar@company.ae"))
    assert r.status_code == 403


def test_activation_blocked_while_visa_outstanding():
    start_onboarding()
    eid = emp_id("rami@company.ae")
    r = client.post(f"/api/lifecycle/{eid}/activate", headers=token())
    assert r.status_code == 409
    assert any("visa" in t.lower() for t in r.json()["detail"]["outstanding"])


def test_activation_succeeds_once_blockers_clear():
    start_onboarding()
    eid = emp_id("rami@company.ae")
    complete_all_blockers(eid, ChecklistPhase.onboarding)
    r = client.post(f"/api/lifecycle/{eid}/activate", headers=token())
    assert r.status_code == 200 and r.json()["status"] == "active"


def test_non_blocking_tasks_do_not_prevent_activation():
    start_onboarding()
    eid = emp_id("rami@company.ae")
    complete_all_blockers(eid, ChecklistPhase.onboarding)
    tasks = client.get(f"/api/lifecycle/{eid}/checklist", headers=token()).json()
    assert any(not t["completed"] and not t["blocking"] for t in tasks)
    assert client.post(f"/api/lifecycle/{eid}/activate", headers=token()).status_code == 200


def test_task_cannot_be_completed_twice():
    start_onboarding()
    tid = client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                     headers=token()).json()[0]["id"]
    client.post(f"/api/lifecycle/tasks/{tid}/complete", json={}, headers=token())
    r = client.post(f"/api/lifecycle/tasks/{tid}/complete", json={}, headers=token())
    assert r.status_code == 409


def test_hr_can_reopen_a_mistaken_completion():
    start_onboarding()
    tid = client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                     headers=token()).json()[0]["id"]
    client.post(f"/api/lifecycle/tasks/{tid}/complete", json={}, headers=token())
    r = client.post(f"/api/lifecycle/tasks/{tid}/reopen", headers=token())
    assert r.status_code == 200 and r.json()["completed"] is False


def test_employee_cannot_read_another_persons_checklist():
    start_onboarding()
    r = client.get(f"/api/lifecycle/{emp_id('rami@company.ae')}/checklist",
                   headers=token("omar@company.ae"))
    assert r.status_code == 403


def test_employee_can_read_own_checklist():
    start_onboarding("nadia@company.ae")
    r = client.get(f"/api/lifecycle/{emp_id('nadia@company.ae')}/checklist",
                   headers=token("nadia@company.ae"))
    assert r.status_code == 200


# --- documents -------------------------------------------------------------
def add_doc(email, kind, expiry, number="X-1"):
    return client.post("/api/lifecycle/documents", headers=token(), json={
        "employee_id": emp_id(email), "kind": kind, "number": number,
        "issue_date": str(date.today() - timedelta(days=365)), "expiry_date": str(expiry)})


def test_document_expiry_severity_buckets():
    add_doc("omar@company.ae", "visa", date.today() + timedelta(days=20), "V-1")
    add_doc("omar@company.ae", "passport", date.today() + timedelta(days=50), "P-1")
    add_doc("omar@company.ae", "emirates_id", date.today() - timedelta(days=5), "E-1")
    r = client.get("/api/lifecycle/documents/expiring?within_days=90", headers=token()).json()
    sev = {d["kind"]: d["severity"] for d in r["documents"]}
    assert sev["visa"] == "urgent"
    assert sev["passport"] == "soon"
    assert sev["emirates_id"] == "expired"


def test_far_future_document_not_flagged():
    add_doc("omar@company.ae", "passport", date.today() + timedelta(days=800))
    r = client.get("/api/lifecycle/documents/expiring?within_days=90", headers=token()).json()
    assert r["count"] == 0


def test_rera_card_updates_employee_brn():
    add_doc("nadia@company.ae", "rera_card", date.today() + timedelta(days=200), "BRN-44821")
    db = TestSession()
    e = db.query(Employee).filter(Employee.work_email == "nadia@company.ae").first()
    assert e.rera_brn == "BRN-44821"
    db.close()


def test_expiry_before_issue_rejected():
    r = client.post("/api/lifecycle/documents", headers=token(), json={
        "employee_id": emp_id("omar@company.ae"), "kind": "visa",
        "issue_date": str(date.today()), "expiry_date": str(date.today() - timedelta(days=10))})
    assert r.status_code == 422


def test_only_hr_adds_documents():
    r = client.post("/api/lifecycle/documents", headers=token("omar@company.ae"), json={
        "employee_id": emp_id("omar@company.ae"), "kind": "visa"})
    assert r.status_code == 403


def test_expiring_report_is_hr_only():
    assert client.get("/api/lifecycle/documents/expiring",
                      headers=token("omar@company.ae")).status_code == 403


# --- offboarding -----------------------------------------------------------
def resign(email="omar@company.ae", **kw):
    payload = {"employee_id": emp_id(email),
               "notice_given_on": str(date.today()), "notice_days": 30}
    payload.update(kw)
    return client.post("/api/lifecycle/offboarding/start", json=payload, headers=token())


def test_offboarding_sets_notice_and_builds_clearance():
    r = resign()
    assert r.status_code == 201
    assert r.json()["status"] == "notice"
    assert r.json()["tasks_created"] > 10
    assert r.json()["notice_shortfall_days"] == 0


def test_short_notice_is_flagged():
    r = resign(last_working_day=str(date.today() + timedelta(days=10)))
    assert r.json()["notice_shortfall_days"] == 20
    assert "short" in r.json()["message"].lower()


def test_last_working_day_before_notice_rejected():
    r = resign(last_working_day=str(date.today() - timedelta(days=5)))
    assert r.status_code == 422


def test_cannot_start_offboarding_twice():
    resign()
    assert resign().status_code == 409


def test_exit_blocked_while_clearance_open():
    resign()
    eid = emp_id("omar@company.ae")
    r = client.post(f"/api/lifecycle/{eid}/exit",
                    json={"employee_id": eid, "confirm_settlement_paid": True},
                    headers=token())
    assert r.status_code == 409
    assert any("laptop" in t.lower() for t in r.json()["detail"]["outstanding"])


def test_exit_blocked_without_settlement_confirmation():
    resign()
    eid = emp_id("omar@company.ae")
    complete_all_blockers(eid, ChecklistPhase.offboarding)
    r = client.post(f"/api/lifecycle/{eid}/exit",
                    json={"employee_id": eid, "confirm_settlement_paid": False},
                    headers=token())
    assert r.status_code == 409


def test_exit_requires_offboarding_started_first():
    eid = emp_id("omar@company.ae")
    r = client.post(f"/api/lifecycle/{eid}/exit",
                    json={"employee_id": eid, "confirm_settlement_paid": True},
                    headers=token())
    assert r.status_code == 409


def test_exit_revokes_sessions_and_deletes_biometrics():
    # give Omar a live session and a face template
    omar_headers = token("omar@company.ae")
    login = client.post("/api/auth/login",
                        data={"username": "omar@company.ae", "password": PW}).json()
    db = TestSession()
    from app.models.core import FaceTemplate
    import numpy as np
    oid = db.query(Employee).filter(Employee.work_email == "omar@company.ae").first().id
    for _ in range(4):
        db.add(FaceTemplate(employee_id=oid,
                            embedding=np.random.rand(512).astype("float32").tobytes(),
                            dim=512))
    db.commit(); db.close()

    resign()
    complete_all_blockers(oid, ChecklistPhase.offboarding)
    r = client.post(f"/api/lifecycle/{oid}/exit",
                    json={"employee_id": oid, "confirm_settlement_paid": True},
                    headers=token())
    assert r.status_code == 200
    assert r.json()["face_templates_deleted"] == 4
    assert r.json()["sessions_revoked"] >= 1
    # refresh token is dead
    assert client.post("/api/auth/refresh",
                       json={"refresh_token": login["refresh_token"]}).status_code == 401
    # and they can't sign in
    assert client.post("/api/auth/login",
                       data={"username": "omar@company.ae", "password": PW}).status_code == 403


# --- settlement ------------------------------------------------------------
def test_settlement_includes_gratuity_and_leave_encashment():
    eid = emp_id("omar@company.ae")
    db = TestSession()
    annual = db.query(LeaveType).filter(LeaveType.code == "ANNUAL").first()
    db.add(LeaveBalance(employee_id=eid, leave_type_id=annual.id,
                        year=date.today().year, entitled_days=30,
                        accrued_days=30, taken_days=18))   # 12 unused
    db.commit(); db.close()

    resign()
    r = client.get(f"/api/lifecycle/{eid}/settlement", headers=token()).json()
    assert r["service_years"] > 6
    assert r["gratuity_amount"] > 0
    assert r["unused_leave_days"] == 12.0
    assert r["leave_encashment_amount"] == round(12 * (10000 / 30), 2)
    assert r["total_payable"] == round(r["gratuity_amount"] + r["leave_encashment_amount"], 2)


def test_settlement_reports_outstanding_clearances():
    resign()
    r = client.get(f"/api/lifecycle/{emp_id('omar@company.ae')}/settlement",
                   headers=token()).json()
    assert r["clearance_complete"] is False
    assert len(r["outstanding_clearances"]) > 5


def test_settlement_is_hr_only():
    assert client.get(f"/api/lifecycle/{emp_id('omar@company.ae')}/settlement",
                      headers=token("omar@company.ae")).status_code == 403


# --- dashboard -------------------------------------------------------------
def test_dashboard_summarises_joiners_and_leavers():
    start_onboarding()
    resign()
    add_doc("omar@company.ae", "visa", date.today() + timedelta(days=20), "V-9")
    r = client.get("/api/lifecycle/dashboard", headers=token()).json()
    assert len(r["joining"]) == 2          # rami + nadia still onboarding
    assert len(r["leaving"]) == 1
    assert r["joining"][0]["open_blockers"] > 0
    assert r["documents_expiring_60d"] == 1


def test_dashboard_is_hr_only():
    assert client.get("/api/lifecycle/dashboard",
                      headers=token("omar@company.ae")).status_code == 403


# --- notice pay in lieu ----------------------------------------------------
def test_notice_shortfall_is_deducted_on_total_salary():
    db = TestSession()
    omar = db.query(Employee).filter(Employee.work_email == "omar@company.ae").first()
    omar.total_salary = 15000     # basic 10000, total 15000
    db.commit(); db.close()
    resign()
    eid = emp_id("omar@company.ae")
    r = client.get(f"/api/lifecycle/{eid}/settlement?notice_shortfall_days=10",
                   headers=token()).json()
    assert r["notice_shortfall_days"] == 10
    assert r["notice_pay_basis"] == "total"
    assert r["notice_deduction_amount"] == round(10 * (15000 / 30), 2)


def test_notice_basis_can_be_switched_to_basic():
    db = TestSession()
    omar = db.query(Employee).filter(Employee.work_email == "omar@company.ae").first()
    omar.total_salary = 15000
    db.commit(); db.close()
    resign()
    r = client.get(f"/api/lifecycle/{emp_id('omar@company.ae')}/settlement"
                   "?notice_shortfall_days=10&notice_basis=basic", headers=token()).json()
    assert r["notice_deduction_amount"] == round(10 * (10000 / 30), 2)


def test_invalid_notice_basis_rejected():
    resign()
    r = client.get(f"/api/lifecycle/{emp_id('omar@company.ae')}/settlement"
                   "?notice_shortfall_days=5&notice_basis=gross", headers=token())
    assert r.status_code == 422


def test_notice_deduction_reduces_total_payable():
    resign()
    eid = emp_id("omar@company.ae")
    without = client.get(f"/api/lifecycle/{eid}/settlement", headers=token()).json()
    with_short = client.get(f"/api/lifecycle/{eid}/settlement?notice_shortfall_days=15",
                            headers=token()).json()
    assert with_short["total_payable"] < without["total_payable"]
    assert with_short["notice_deduction_amount"] > 0


def test_no_shortfall_means_no_deduction():
    resign()
    r = client.get(f"/api/lifecycle/{emp_id('omar@company.ae')}/settlement",
                   headers=token()).json()
    assert r["notice_deduction_amount"] == 0.0
