"""Leave engine: entitlement, accrual, balance, overlap.

Baseline is UAE Federal Decree-Law 33/2021. Company policy can be more generous
but never less. Confirm carry-forward and encashment against your HR policy doc.
"""
from __future__ import annotations

from datetime import date
from typing import Sequence

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.core import (
    Employee, Holiday, LeaveBalance, LeaveRequest, LeaveStatus, LeaveType,
)
from app.services.rules import annual_leave_accrued, working_days

# Statuses that consume balance or block an overlapping request.
BLOCKING_STATUSES = (LeaveStatus.pending, LeaveStatus.approved)


def holidays_for(db: Session, start: date, end: date) -> list[date]:
    rows = (db.query(Holiday)
              .filter(Holiday.holiday_date >= start, Holiday.holiday_date <= end)
              .all())
    return [h.holiday_date for h in rows]


def count_leave_days(db: Session, start: date, end: date, half_day: bool) -> float:
    """Weekends and public holidays don't consume leave balance."""
    if half_day:
        if start != end:
            raise ValueError("A half day must start and end on the same date.")
        return 0.5 if working_days(start, end, holidays_for(db, start, end)) else 0.0
    return working_days(start, end, holidays_for(db, start, end))


def find_overlap(db: Session, employee_id: int, start: date, end: date,
                 exclude_id: int | None = None) -> LeaveRequest | None:
    q = (db.query(LeaveRequest)
           .filter(LeaveRequest.employee_id == employee_id,
                   LeaveRequest.status.in_(BLOCKING_STATUSES),
                   LeaveRequest.start_date <= end,
                   LeaveRequest.end_date >= start))
    if exclude_id:
        q = q.filter(LeaveRequest.id != exclude_id)
    return q.first()


def ensure_balance_row(db: Session, employee_id: int, leave_type_id: int,
                       year: int) -> LeaveBalance:
    bal = (db.query(LeaveBalance)
             .filter(LeaveBalance.employee_id == employee_id,
                     LeaveBalance.leave_type_id == leave_type_id,
                     LeaveBalance.year == year)
             .first())
    if bal:
        return bal
    lt = db.query(LeaveType).filter(LeaveType.id == leave_type_id).first()
    bal = LeaveBalance(employee_id=employee_id, leave_type_id=leave_type_id, year=year,
                       entitled_days=lt.annual_entitlement_days if lt else 0.0)
    db.add(bal)
    db.flush()
    return bal


def recompute_accrual(db: Session, employee: Employee, leave_type: LeaveType,
                      as_of: date | None = None) -> LeaveBalance:
    """Accruing types (annual) build up monthly. Non-accruing types (sick,
    maternity) are available in full from day one — they're event-driven, not earned."""
    as_of = as_of or date.today()
    bal = ensure_balance_row(db, employee.id, leave_type.id, as_of.year)
    if leave_type.accrues:
        bal.accrued_days = annual_leave_accrued(employee.date_of_joining, as_of)
    else:
        bal.accrued_days = leave_type.annual_entitlement_days
    db.flush()
    return bal


def available_days(db: Session, employee: Employee, leave_type: LeaveType,
                   as_of: date | None = None) -> float:
    as_of = as_of or date.today()
    bal = recompute_accrual(db, employee, leave_type, as_of)
    taken = (db.query(LeaveRequest)
               .filter(LeaveRequest.employee_id == employee.id,
                       LeaveRequest.leave_type_id == leave_type.id,
                       LeaveRequest.status.in_(BLOCKING_STATUSES))
               .all())
    consumed = sum(r.days_count for r in taken
                   if r.start_date.year == as_of.year)
    bal.taken_days = consumed
    db.flush()
    return round(bal.accrued_days + bal.carried_forward_days - consumed, 2)


def approver_for(db: Session, employee: Employee) -> Employee | None:
    """Line manager first. If there is none, or they've left, HR picks it up."""
    if employee.manager_id:
        mgr = db.query(Employee).filter(Employee.id == employee.manager_id,
                                        Employee.is_active.is_(True)).first()
        if mgr:
            return mgr
    return (db.query(Employee)
              .filter(Employee.role == "hr", Employee.is_active.is_(True))
              .order_by(Employee.id)
              .first())


def carry_forward(db: Session, employee: Employee, leave_type: LeaveType,
                  from_year: int) -> float:
    """Run at year end. Unused annual leave rolls over up to the policy cap."""
    if not leave_type.accrues:
        return 0.0
    prev = (db.query(LeaveBalance)
              .filter(LeaveBalance.employee_id == employee.id,
                      LeaveBalance.leave_type_id == leave_type.id,
                      LeaveBalance.year == from_year)
              .first())
    if not prev:
        return 0.0
    unused = max(prev.accrued_days + prev.carried_forward_days - prev.taken_days, 0.0)
    rolled = min(unused, leave_type.max_carry_forward_days or 0.0)
    nxt = ensure_balance_row(db, employee.id, leave_type.id, from_year + 1)
    nxt.carried_forward_days = rolled
    db.flush()
    return round(rolled, 2)
