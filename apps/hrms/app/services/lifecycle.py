"""Onboarding and offboarding orchestration.

Checklist templates are UAE-specific: visa, Emirates ID, labour card and WPS are
sequenced because each one gates the next. RERA/BRN steps only apply to agents.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Sequence

from sqlalchemy.orm import Session

from app.models.core import (
    ChecklistPhase, ChecklistTask, DocumentKind, Employee, EmployeeDocument,
    EmploymentStatus, LeaveBalance, LeaveType,
)
from app.services.rules import gratuity_uae

# (title, owner_department, offset_days_from_anchor, blocking)
# blocking=True means the employee cannot be activated / cannot be paid out
# until it's done. Everything else is tracked but not gating.
ONBOARDING_TEMPLATE = [
    ("Signed offer letter returned",        "HR",      -7,  True),
    ("MOHRE offer letter submitted",        "PRO",     -5,  True),
    ("Entry permit / employment visa",      "PRO",     -3,  True),
    ("Medical fitness test",                "PRO",      2,  True),
    ("Emirates ID application",             "PRO",      3,  True),
    ("Residence visa stamped",              "PRO",     10,  True),
    ("Labour card issued",                  "PRO",     14,  True),
    ("WPS bank account opened",             "Finance",  7,  True),
    ("Signed employment contract on file",  "HR",       0,  True),
    ("Personal documents collected",        "HR",       0,  True),
    ("Laptop and phone issued",             "IT",       0, False),
    ("Email and system accounts created",   "IT",      -1, False),
    ("HRMS account and face enrolment",     "IT",       1, False),
    ("Health insurance enrolment",          "HR",       5,  True),
    ("Induction and policy briefing",       "HR",       1, False),
    ("Desk and access card",                "Admin",    0, False),
]

# Agents only — a broker who sells without a valid BRN exposes the firm to RERA penalties.
ONBOARDING_AGENT_EXTRAS = [
    ("RERA certified practitioner course",  "HR",      14,  True),
    ("BRN card issued and recorded",        "HR",      30,  True),
    ("Listing portal accounts created",     "Marketing", 3, False),
    ("Commission structure acknowledged",   "Finance",  0,  True),
]

OFFBOARDING_TEMPLATE = [
    ("Resignation / termination letter on file", "HR",       0,  True),
    ("Handover document completed",              "Line Mgr", 0,  True),
    ("Active deals and pipeline reassigned",     "Line Mgr", 0,  True),
    ("Laptop, phone and access card returned",   "IT",       0,  True),
    ("System and email access revoked",          "IT",       0,  True),
    ("HRMS sessions revoked",                    "IT",       0,  True),
    ("Company credit card and petty cash cleared", "Finance", 0, True),
    ("Outstanding advances and loans settled",   "Finance",  0,  True),
    ("Commission reconciliation signed off",     "Finance",  0,  True),
    ("Final leave balance agreed",               "HR",       0,  True),
    ("Gratuity calculation approved",            "Finance",  0,  True),
    ("Visa cancellation submitted",              "PRO",      0,  True),
    ("Labour card cancelled",                    "PRO",      0,  True),
    ("Health insurance cancelled",               "HR",       0, False),
    ("Experience certificate issued",            "HR",       0, False),
    ("Exit interview completed",                 "HR",       0, False),
]

AGENT_DEPARTMENTS = {"brokerage", "sales", "leasing"}


def is_agent(employee: Employee) -> bool:
    if employee.rera_brn:
        return True
    dept = (employee.department or "").strip().lower()
    return dept in AGENT_DEPARTMENTS


def build_checklist(db: Session, employee: Employee, phase: ChecklistPhase,
                    anchor: date) -> list[ChecklistTask]:
    """Anchor is the joining date for onboarding, the last working day for exit."""
    if phase == ChecklistPhase.onboarding:
        template = list(ONBOARDING_TEMPLATE)
        if is_agent(employee):
            template += ONBOARDING_AGENT_EXTRAS
    else:
        template = list(OFFBOARDING_TEMPLATE)

    existing = {t.title for t in db.query(ChecklistTask)
                .filter(ChecklistTask.employee_id == employee.id,
                        ChecklistTask.phase == phase).all()}

    created = []
    for seq, (title, dept, offset, blocking) in enumerate(template):
        if title in existing:
            continue
        task = ChecklistTask(employee_id=employee.id, phase=phase, title=title,
                             owner_department=dept, sequence=seq,
                             due_date=anchor + timedelta(days=offset),
                             blocking=blocking)
        db.add(task)
        created.append(task)
    db.flush()
    return created


def outstanding_blockers(db: Session, employee_id: int,
                         phase: ChecklistPhase) -> list[ChecklistTask]:
    return (db.query(ChecklistTask)
              .filter(ChecklistTask.employee_id == employee_id,
                      ChecklistTask.phase == phase,
                      ChecklistTask.blocking.is_(True),
                      ChecklistTask.completed_at.is_(None))
              .order_by(ChecklistTask.sequence)
              .all())


def expiring_documents(db: Session, within_days: int = 90,
                       employee_id: int | None = None) -> list[dict]:
    """Visa, EID and BRN expiries. An expired BRN means the agent must stop selling."""
    horizon = date.today() + timedelta(days=within_days)
    q = (db.query(EmployeeDocument, Employee)
           .join(Employee, Employee.id == EmployeeDocument.employee_id)
           .filter(EmployeeDocument.expiry_date.isnot(None),
                   EmployeeDocument.expiry_date <= horizon,
                   Employee.is_active.is_(True)))
    if employee_id:
        q = q.filter(EmployeeDocument.employee_id == employee_id)

    out = []
    for doc, emp in q.order_by(EmployeeDocument.expiry_date).all():
        days = (doc.expiry_date - date.today()).days
        out.append({
            "employee_id": emp.id,
            "employee_code": emp.employee_code,
            "employee_name": emp.full_name,
            "kind": doc.kind.value,
            "number": doc.number,
            "expiry_date": doc.expiry_date,
            "days_remaining": days,
            "severity": "expired" if days < 0 else
                        "urgent" if days <= 30 else
                        "soon" if days <= 60 else "watch",
        })
    return out


# ---------------------------------------------------------------------------
# Final settlement
# ---------------------------------------------------------------------------
def unused_leave_days(db: Session, employee: Employee, as_of: date) -> float:
    """Only accruing paid types are encashable. Sick leave is not paid out."""
    total = 0.0
    types = db.query(LeaveType).filter(LeaveType.accrues.is_(True),
                                       LeaveType.is_paid.is_(True)).all()
    for lt in types:
        bal = (db.query(LeaveBalance)
                 .filter(LeaveBalance.employee_id == employee.id,
                         LeaveBalance.leave_type_id == lt.id,
                         LeaveBalance.year == as_of.year)
                 .first())
        if bal:
            total += max(bal.accrued_days + bal.carried_forward_days - bal.taken_days, 0.0)
    return round(total, 2)


def notice_pay_in_lieu(basic_monthly: float, total_monthly: float,
                       shortfall_days: int, basis: str = "total") -> dict:
    """Compensation for notice not served.

    UAE practice pays in lieu on TOTAL remuneration, not basic — this is the
    opposite of the gratuity basis, which catches people out. `basis` is settable
    because a minority of contracts specify basic. Read the contract.
    """
    if shortfall_days <= 0:
        return {"days": 0, "basis": basis, "amount": 0.0}
    monthly = total_monthly if basis == "total" else basic_monthly
    return {"days": shortfall_days, "basis": basis,
            "amount": round((monthly / 30.0) * shortfall_days, 2)}


def final_settlement(db: Session, employee: Employee, last_working_day: date,
                     resigned: bool = True, notice_shortfall_days: int = 0,
                     notice_basis: str = "total") -> dict:
    """Gratuity + leave encashment + notice shortfall.

    Leave encashment is on BASIC salary, matching the gratuity basis. Some
    contracts encash on gross — check yours before running payouts.
    """
    if not employee.date_of_joining:
        raise ValueError("This employee has no joining date on record.")

    grat = gratuity_uae(employee.basic_salary or 0.0, employee.date_of_joining,
                        last_working_day, resigned=resigned)
    daily_basic = (employee.basic_salary or 0.0) / 30.0
    leave_days = unused_leave_days(db, employee, last_working_day)
    leave_amount = round(leave_days * daily_basic, 2)

    notice = notice_pay_in_lieu(employee.basic_salary or 0.0,
                                employee.total_salary or employee.basic_salary or 0.0,
                                notice_shortfall_days, notice_basis)

    blockers = outstanding_blockers(db, employee.id, ChecklistPhase.offboarding)

    return {
        "employee_id": employee.id,
        "employee_code": employee.employee_code,
        "last_working_day": last_working_day,
        "service_years": grat["years"],
        "basic_salary": employee.basic_salary,
        "gratuity_days": grat["days"],
        "gratuity_amount": grat["amount"],
        "gratuity_capped": grat.get("capped_at_two_years", False),
        "unused_leave_days": leave_days,
        "leave_encashment_amount": leave_amount,
        "notice_shortfall_days": notice["days"],
        "notice_pay_basis": notice["basis"],
        "notice_deduction_amount": notice["amount"],
        "total_payable": round(grat["amount"] + leave_amount - notice["amount"], 2),
        "clearance_complete": not blockers,
        "outstanding_clearances": [t.title for t in blockers],
        "note": "Indicative only. Confirm against the signed MOHRE contract and any "
                "outstanding advances before payment. Gratuity and leave encashment "
                "are on basic salary; notice in lieu is on total unless the contract "
                "says otherwise.",
    }
