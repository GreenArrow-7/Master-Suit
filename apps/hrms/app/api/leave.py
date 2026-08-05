from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import active_user, require_roles
from app.models.core import (
    AuditLog, Employee, EmploymentStatus, Holiday, LeaveRequest, LeaveStatus,
    LeaveType, Role,
)
from app.services.leave import (
    approver_for, available_days, carry_forward, count_leave_days, find_overlap,
    holidays_for,
)

router = APIRouter(prefix="/api/leave", tags=["leave"])

MAX_BACKDATE_DAYS = 30


def _ip(request: Request):
    return request.client.host if request.client else None


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ApplyIn(BaseModel):
    leave_type_code: str
    start_date: date
    end_date: date
    half_day: bool = False
    reason: Optional[str] = Field(None, max_length=1000)
    document_path: Optional[str] = None

    @model_validator(mode="after")
    def check_range(self):
        if self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date.")
        return self


class DecisionIn(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)


class RequestOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str
    leave_type: str
    start_date: date
    end_date: date
    half_day: bool
    days_count: float
    status: LeaveStatus
    reason: Optional[str] = None
    approver_id: Optional[int] = None
    decision_note: Optional[str] = None


class BalanceOut(BaseModel):
    leave_type_code: str
    leave_type: str
    entitled_days: float
    accrued_days: float
    carried_forward_days: float
    taken_days: float
    available_days: float
    is_paid: bool


class HolidayIn(BaseModel):
    holiday_date: date
    name: str = Field(..., max_length=120)
    is_confirmed: bool = False


def _out(r: LeaveRequest, emp: Employee, lt: LeaveType) -> RequestOut:
    return RequestOut(
        id=r.id, employee_id=r.employee_id, employee_name=emp.full_name,
        leave_type=lt.name, start_date=r.start_date, end_date=r.end_date,
        half_day=r.half_day, days_count=r.days_count, status=r.status,
        reason=r.reason, approver_id=r.approver_id, decision_note=r.decision_note,
    )


def _can_view(actor: Employee, target: LeaveRequest) -> bool:
    if actor.role in (Role.hr, Role.admin) or actor.id == target.employee_id:
        return True
    return actor.role == Role.manager and target.approver_id == actor.id


# ---------------------------------------------------------------------------
# Employee-facing
# ---------------------------------------------------------------------------
@router.get("/types")
def list_types(db: Session = Depends(get_db), emp=Depends(active_user)):
    return [{"code": t.code, "name": t.name, "is_paid": t.is_paid,
             "annual_entitlement_days": t.annual_entitlement_days,
             "requires_document": t.requires_document}
            for t in db.query(LeaveType).order_by(LeaveType.id).all()]


@router.get("/balances", response_model=List[BalanceOut])
def balances(employee_id: Optional[int] = None, db: Session = Depends(get_db),
             actor=Depends(active_user)):
    target = actor
    if employee_id and employee_id != actor.id:
        if actor.role not in (Role.hr, Role.admin, Role.manager):
            raise HTTPException(403, "You can only see your own balances.")
        target = db.query(Employee).filter(Employee.id == employee_id).first()
        if not target:
            raise HTTPException(404, "No employee with that ID.")
        if actor.role == Role.manager and target.manager_id != actor.id:
            raise HTTPException(403, "You can only see your own team's balances.")

    from app.services.leave import ensure_balance_row

    out = []
    for lt in db.query(LeaveType).order_by(LeaveType.id).all():
        avail = available_days(db, target, lt)
        row = ensure_balance_row(db, target.id, lt.id, date.today().year)
        out.append(BalanceOut(
            leave_type_code=lt.code, leave_type=lt.name,
            entitled_days=row.entitled_days, accrued_days=row.accrued_days,
            carried_forward_days=row.carried_forward_days, taken_days=row.taken_days,
            available_days=avail, is_paid=lt.is_paid))
    db.commit()
    return out


@router.post("/apply", response_model=RequestOut, status_code=201)
def apply(body: ApplyIn, request: Request, db: Session = Depends(get_db),
          emp: Employee = Depends(active_user)):
    if emp.status == EmploymentStatus.exited:
        raise HTTPException(403, "This account is closed. Contact HR.")

    lt = db.query(LeaveType).filter(LeaveType.code == body.leave_type_code.upper()).first()
    if not lt:
        raise HTTPException(404, "That leave type doesn't exist.")

    if (date.today() - body.start_date).days > MAX_BACKDATE_DAYS:
        raise HTTPException(422,
                            f"You can't apply more than {MAX_BACKDATE_DAYS} days after "
                            "the leave started. Ask HR to record this for you.")

    if lt.requires_document and not body.document_path:
        raise HTTPException(422, f"{lt.name} needs a supporting document.")

    clash = find_overlap(db, emp.id, body.start_date, body.end_date)
    if clash:
        raise HTTPException(409,
                            f"You already have leave from {clash.start_date} to "
                            f"{clash.end_date}. Cancel it first.")

    try:
        days = count_leave_days(db, body.start_date, body.end_date, body.half_day)
    except ValueError as e:
        raise HTTPException(422, str(e))

    if days <= 0:
        raise HTTPException(422,
                            "Those dates are all weekends or public holidays — "
                            "no leave needed.")

    avail = available_days(db, emp, lt)
    if lt.is_paid and days > avail:
        raise HTTPException(409,
                            f"You have {avail} days of {lt.name} available "
                            f"and asked for {days}.")

    approver = approver_for(db, emp)
    if not approver:
        raise HTTPException(409, "No approver is set up. Contact HR.")

    req = LeaveRequest(employee_id=emp.id, leave_type_id=lt.id,
                       start_date=body.start_date, end_date=body.end_date,
                       half_day=body.half_day, days_count=days, reason=body.reason,
                       status=LeaveStatus.pending, approver_id=approver.id,
                       document_path=body.document_path)
    db.add(req)
    db.commit()
    db.refresh(req)
    db.add(AuditLog(actor_id=emp.id, action="leave.applied", entity="leave_request",
                    entity_id=str(req.id),
                    detail=f"{lt.code} {body.start_date}..{body.end_date} ({days}d)",
                    ip_address=_ip(request)))
    db.commit()
    return _out(req, emp, lt)


@router.get("/mine", response_model=List[RequestOut])
def my_requests(db: Session = Depends(get_db), emp: Employee = Depends(active_user)):
    rows = (db.query(LeaveRequest)
              .filter(LeaveRequest.employee_id == emp.id)
              .order_by(LeaveRequest.start_date.desc()).all())
    types = {t.id: t for t in db.query(LeaveType).all()}
    return [_out(r, emp, types[r.leave_type_id]) for r in rows]


@router.post("/{request_id}/cancel", response_model=RequestOut)
def cancel(request_id: int, request: Request, db: Session = Depends(get_db),
           emp: Employee = Depends(active_user)):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "No leave request with that ID.")
    if req.employee_id != emp.id and emp.role not in (Role.hr, Role.admin):
        raise HTTPException(403, "You can only cancel your own leave.")
    if req.status in (LeaveStatus.cancelled, LeaveStatus.rejected):
        raise HTTPException(409, "This request is already closed.")
    if req.status == LeaveStatus.approved and req.end_date < date.today() \
            and emp.role not in (Role.hr, Role.admin):
        raise HTTPException(409, "This leave has already been taken. Ask HR to amend it.")

    req.status = LeaveStatus.cancelled
    req.decided_at = datetime.now(timezone.utc)
    db.add(AuditLog(actor_id=emp.id, action="leave.cancelled", entity="leave_request",
                    entity_id=str(req.id), ip_address=_ip(request)))
    db.commit()
    db.refresh(req)
    owner = db.query(Employee).filter(Employee.id == req.employee_id).first()
    lt = db.query(LeaveType).filter(LeaveType.id == req.leave_type_id).first()
    return _out(req, owner, lt)


# ---------------------------------------------------------------------------
# Approver-facing
# ---------------------------------------------------------------------------
@router.get("/pending", response_model=List[RequestOut])
def pending(db: Session = Depends(get_db), actor=Depends(active_user)):
    q = db.query(LeaveRequest).filter(LeaveRequest.status == LeaveStatus.pending)
    if actor.role not in (Role.hr, Role.admin):
        q = q.filter(LeaveRequest.approver_id == actor.id)
    rows = q.order_by(LeaveRequest.start_date).all()
    emps = {e.id: e for e in db.query(Employee).all()}
    types = {t.id: t for t in db.query(LeaveType).all()}
    return [_out(r, emps[r.employee_id], types[r.leave_type_id]) for r in rows]


def _decide(request_id: int, approve: bool, note: Optional[str],
            request: Request, db: Session, actor: Employee) -> RequestOut:
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "No leave request with that ID.")
    if req.status != LeaveStatus.pending:
        raise HTTPException(409, f"This request is already {req.status.value}.")
    if req.employee_id == actor.id:
        raise HTTPException(403, "You can't approve your own leave.")
    if actor.role not in (Role.hr, Role.admin) and req.approver_id != actor.id:
        raise HTTPException(403, "This request isn't assigned to you.")

    owner = db.query(Employee).filter(Employee.id == req.employee_id).first()
    lt = db.query(LeaveType).filter(LeaveType.id == req.leave_type_id).first()

    if approve and lt.is_paid:
        # Re-check at decision time — balance may have moved since the request.
        avail = available_days(db, owner, lt)
        if req.days_count > avail:
            raise HTTPException(409,
                                f"{owner.full_name} now has only {avail} days of "
                                f"{lt.name} available. Reject or ask them to shorten it.")

    req.status = LeaveStatus.approved if approve else LeaveStatus.rejected
    req.approver_id = actor.id
    req.decided_at = datetime.now(timezone.utc)
    req.decision_note = note
    db.add(AuditLog(actor_id=actor.id,
                    action="leave.approved" if approve else "leave.rejected",
                    entity="leave_request", entity_id=str(req.id),
                    detail=f"employee={owner.employee_code} {req.days_count}d",
                    ip_address=_ip(request)))
    db.commit()
    db.refresh(req)
    return _out(req, owner, lt)


@router.post("/{request_id}/approve", response_model=RequestOut)
def approve(request_id: int, body: DecisionIn, request: Request,
            db: Session = Depends(get_db),
            actor=Depends(require_roles("manager", "hr", "admin"))):
    return _decide(request_id, True, body.note, request, db, actor)


@router.post("/{request_id}/reject", response_model=RequestOut)
def reject(request_id: int, body: DecisionIn, request: Request,
           db: Session = Depends(get_db),
           actor=Depends(require_roles("manager", "hr", "admin"))):
    if not body.note:
        raise HTTPException(422, "Give a reason so the employee knows why.")
    return _decide(request_id, False, body.note, request, db, actor)


@router.get("/{request_id}", response_model=RequestOut)
def get_one(request_id: int, db: Session = Depends(get_db), actor=Depends(active_user)):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "No leave request with that ID.")
    if not _can_view(actor, req):
        raise HTTPException(403, "You don't have access to this.")
    owner = db.query(Employee).filter(Employee.id == req.employee_id).first()
    lt = db.query(LeaveType).filter(LeaveType.id == req.leave_type_id).first()
    return _out(req, owner, lt)


# ---------------------------------------------------------------------------
# Calendar and holidays
# ---------------------------------------------------------------------------
@router.get("/calendar/team")
def team_calendar(start: date, end: date, db: Session = Depends(get_db),
                  actor=Depends(active_user)):
    """Who's out, and when. Managers see their reports; HR sees everyone."""
    q = (db.query(LeaveRequest)
           .filter(LeaveRequest.status == LeaveStatus.approved,
                   LeaveRequest.start_date <= end, LeaveRequest.end_date >= start))
    if actor.role == Role.manager:
        ids = [e.id for e in db.query(Employee).filter(Employee.manager_id == actor.id)]
        q = q.filter(LeaveRequest.employee_id.in_(ids or [-1]))
    elif actor.role not in (Role.hr, Role.admin):
        q = q.filter(LeaveRequest.employee_id == actor.id)

    emps = {e.id: e for e in db.query(Employee).all()}
    types = {t.id: t for t in db.query(LeaveType).all()}
    return {
        "holidays": [{"date": h.holiday_date, "name": h.name, "confirmed": h.is_confirmed}
                     for h in db.query(Holiday)
                                .filter(Holiday.holiday_date >= start,
                                        Holiday.holiday_date <= end).all()],
        "leave": [{"employee": emps[r.employee_id].full_name,
                   "employee_id": r.employee_id,
                   "type": types[r.leave_type_id].name,
                   "start": r.start_date, "end": r.end_date, "days": r.days_count}
                  for r in q.order_by(LeaveRequest.start_date).all()],
    }


@router.get("/holidays/{year}")
def list_holidays(year: int, db: Session = Depends(get_db), actor=Depends(active_user)):
    rows = (db.query(Holiday).filter(Holiday.year == year)
              .order_by(Holiday.holiday_date).all())
    return [{"date": h.holiday_date, "name": h.name, "confirmed": h.is_confirmed}
            for h in rows]


@router.post("/holidays", status_code=201)
def add_holiday(body: HolidayIn, request: Request, db: Session = Depends(get_db),
                actor=Depends(require_roles("hr", "admin"))):
    exists = (db.query(Holiday)
                .filter(Holiday.holiday_date == body.holiday_date,
                        Holiday.name == body.name).first())
    if exists:
        raise HTTPException(409, "That holiday is already on the calendar.")
    h = Holiday(holiday_date=body.holiday_date, name=body.name,
                year=body.holiday_date.year, is_confirmed=body.is_confirmed)
    db.add(h)
    db.add(AuditLog(actor_id=actor.id, action="holiday.added", entity="holiday",
                    entity_id=str(body.holiday_date), detail=body.name,
                    ip_address=_ip(request)))
    db.commit()
    return {"date": h.holiday_date, "name": h.name, "confirmed": h.is_confirmed}


@router.post("/year-end/carry-forward")
def run_carry_forward(from_year: int, request: Request, db: Session = Depends(get_db),
                      actor=Depends(require_roles("hr", "admin"))):
    """Run once at year end. Rolls unused annual leave up to the policy cap."""
    results = []
    types = db.query(LeaveType).filter(LeaveType.accrues.is_(True)).all()
    for emp in db.query(Employee).filter(Employee.is_active.is_(True)).all():
        for lt in types:
            rolled = carry_forward(db, emp, lt, from_year)
            if rolled:
                results.append({"employee_id": emp.id, "leave_type": lt.code,
                                "days_carried": rolled})
    db.add(AuditLog(actor_id=actor.id, action="leave.carry_forward", entity="leave_balance",
                    entity_id=str(from_year), detail=f"{len(results)} balances rolled",
                    ip_address=_ip(request)))
    db.commit()
    return {"from_year": from_year, "rolled": results}
