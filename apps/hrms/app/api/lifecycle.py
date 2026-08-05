from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import active_user, require_roles
from app.models.core import (
    AuditLog, ChecklistPhase, ChecklistTask, DocumentKind, Employee,
    EmployeeDocument, EmploymentStatus, RefreshSession, Role,
)
from app.services.documents import delete_stored, save_upload, stored_path
from app.services.lifecycle import (
    build_checklist, expiring_documents, final_settlement, is_agent,
    outstanding_blockers,
)

router = APIRouter(prefix="/api/lifecycle", tags=["lifecycle"])

# UAE default. Contracts may specify 30–90 days; the contract wins.
DEFAULT_NOTICE_DAYS = 30


def _ip(request: Request):
    return request.client.host if request.client else None


def _employee(db: Session, employee_id: int) -> Employee:
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(404, "No employee with that ID.")
    return emp


def _can_view(actor: Employee, target: Employee) -> bool:
    if actor.role in (Role.hr, Role.admin) or actor.id == target.id:
        return True
    return actor.role == Role.manager and target.manager_id == actor.id


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TaskOut(BaseModel):
    id: int
    phase: ChecklistPhase
    title: str
    owner_department: Optional[str] = None
    due_date: Optional[date] = None
    blocking: bool
    completed: bool
    completed_at: Optional[datetime] = None
    overdue: bool
    notes: Optional[str] = None


class TaskCompleteIn(BaseModel):
    notes: Optional[str] = Field(None, max_length=1000)


class TaskAddIn(BaseModel):
    phase: ChecklistPhase
    title: str = Field(..., min_length=3, max_length=160)
    owner_department: Optional[str] = None
    due_date: Optional[date] = None
    blocking: bool = False


class StartOnboardingIn(BaseModel):
    employee_id: int


class DocumentIn(BaseModel):
    employee_id: int
    kind: DocumentKind
    number: Optional[str] = Field(None, max_length=80)
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None


class ResignIn(BaseModel):
    employee_id: int
    notice_given_on: date
    notice_days: int = Field(DEFAULT_NOTICE_DAYS, ge=0, le=180)
    last_working_day: Optional[date] = None
    resigned: bool = True   # False = termination by employer
    reason: Optional[str] = Field(None, max_length=1000)


class ExitIn(BaseModel):
    employee_id: int
    confirm_settlement_paid: bool = False


def _task_out(t: ChecklistTask) -> TaskOut:
    done = t.completed_at is not None
    return TaskOut(
        id=t.id, phase=t.phase, title=t.title,
        owner_department=t.owner_department, due_date=t.due_date,
        blocking=t.blocking, completed=done, completed_at=t.completed_at,
        overdue=bool(not done and t.due_date and t.due_date < date.today()),
        notes=t.notes,
    )


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------
@router.post("/onboarding/start", status_code=201)
def start_onboarding(body: StartOnboardingIn, request: Request,
                     db: Session = Depends(get_db),
                     actor=Depends(require_roles("hr", "admin"))):
    emp = _employee(db, body.employee_id)
    if emp.status == EmploymentStatus.exited:
        raise HTTPException(409, "This employee has already left.")

    created = build_checklist(db, emp, ChecklistPhase.onboarding, emp.date_of_joining)
    db.add(AuditLog(actor_id=actor.id, action="onboarding.started", entity="employee",
                    entity_id=str(emp.id),
                    detail=f"{len(created)} tasks; agent={is_agent(emp)}",
                    ip_address=_ip(request)))
    db.commit()
    return {"employee_id": emp.id, "tasks_created": len(created),
            "agent_track": is_agent(emp),
            "message": "Onboarding checklist created."
                       if created else "Checklist already exists — no duplicates added."}


@router.post("/{employee_id}/activate")
def activate(employee_id: int, request: Request, db: Session = Depends(get_db),
             actor=Depends(require_roles("hr", "admin"))):
    """Moves onboarding -> active. Blocked while any gating task is open —
    an unstamped visa or missing labour card means they can't legally work."""
    emp = _employee(db, employee_id)
    if emp.status == EmploymentStatus.active:
        raise HTTPException(409, "This employee is already active.")
    if emp.status == EmploymentStatus.exited:
        raise HTTPException(409, "This employee has already left.")

    blockers = outstanding_blockers(db, emp.id, ChecklistPhase.onboarding)
    if blockers:
        raise HTTPException(409, {
            "message": f"{len(blockers)} onboarding steps still open.",
            "outstanding": [t.title for t in blockers],
        })

    emp.status = EmploymentStatus.active
    db.add(AuditLog(actor_id=actor.id, action="employee.activated", entity="employee",
                    entity_id=str(emp.id), ip_address=_ip(request)))
    db.commit()
    return {"employee_id": emp.id, "status": emp.status.value,
            "message": f"{emp.full_name} is now active."}


# ---------------------------------------------------------------------------
# Checklists
# ---------------------------------------------------------------------------
@router.get("/{employee_id}/checklist", response_model=List[TaskOut])
def checklist(employee_id: int, phase: Optional[ChecklistPhase] = None,
              db: Session = Depends(get_db), actor=Depends(active_user)):
    emp = _employee(db, employee_id)
    if not _can_view(actor, emp):
        raise HTTPException(403, "You don't have access to this.")
    q = db.query(ChecklistTask).filter(ChecklistTask.employee_id == emp.id)
    if phase:
        q = q.filter(ChecklistTask.phase == phase)
    return [_task_out(t) for t in q.order_by(ChecklistTask.phase,
                                             ChecklistTask.sequence).all()]


@router.post("/tasks/{task_id}/complete", response_model=TaskOut)
def complete_task(task_id: int, body: TaskCompleteIn, request: Request,
                  db: Session = Depends(get_db),
                  actor=Depends(require_roles("hr", "admin", "manager"))):
    task = db.query(ChecklistTask).filter(ChecklistTask.id == task_id).first()
    if not task:
        raise HTTPException(404, "No task with that ID.")
    if task.completed_at:
        raise HTTPException(409, "This task is already done.")

    task.completed_at = datetime.now(timezone.utc)
    task.completed_by_id = actor.id
    task.notes = body.notes
    db.add(AuditLog(actor_id=actor.id, action="checklist.completed",
                    entity="checklist_task", entity_id=str(task.id),
                    detail=task.title, ip_address=_ip(request)))
    db.commit()
    db.refresh(task)
    return _task_out(task)


@router.post("/tasks/{task_id}/reopen", response_model=TaskOut)
def reopen_task(task_id: int, request: Request, db: Session = Depends(get_db),
                actor=Depends(require_roles("hr", "admin"))):
    """Marking something done by mistake shouldn't need a DB edit. Audited."""
    task = db.query(ChecklistTask).filter(ChecklistTask.id == task_id).first()
    if not task:
        raise HTTPException(404, "No task with that ID.")
    if not task.completed_at:
        raise HTTPException(409, "This task is already open.")
    task.completed_at = None
    task.completed_by_id = None
    db.add(AuditLog(actor_id=actor.id, action="checklist.reopened",
                    entity="checklist_task", entity_id=str(task.id),
                    detail=task.title, ip_address=_ip(request)))
    db.commit()
    db.refresh(task)
    return _task_out(task)


@router.post("/tasks", response_model=TaskOut, status_code=201)
def add_task(body: TaskAddIn, employee_id: int, request: Request,
             db: Session = Depends(get_db),
             actor=Depends(require_roles("hr", "admin"))):
    emp = _employee(db, employee_id)
    last = (db.query(ChecklistTask)
              .filter(ChecklistTask.employee_id == emp.id,
                      ChecklistTask.phase == body.phase)
              .order_by(ChecklistTask.sequence.desc()).first())
    task = ChecklistTask(employee_id=emp.id, phase=body.phase, title=body.title,
                         owner_department=body.owner_department,
                         due_date=body.due_date, blocking=body.blocking,
                         sequence=(last.sequence + 1) if last else 0)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _task_out(task)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
@router.post("/documents", status_code=201)
def add_document(body: DocumentIn, request: Request, db: Session = Depends(get_db),
                 actor=Depends(require_roles("hr", "admin"))):
    """Metadata only. Use /documents/upload to attach the scan."""
    emp = _employee(db, body.employee_id)
    if body.expiry_date and body.issue_date and body.expiry_date < body.issue_date:
        raise HTTPException(422, "Expiry date can't be before the issue date.")

    doc = EmployeeDocument(employee_id=emp.id, kind=body.kind, number=body.number,
                           issue_date=body.issue_date, expiry_date=body.expiry_date)
    db.add(doc)
    if body.kind == DocumentKind.rera_card:
        emp.rera_brn = body.number or emp.rera_brn
        emp.rera_expiry = body.expiry_date or emp.rera_expiry
    db.add(AuditLog(actor_id=actor.id, action="document.added", entity="employee_document",
                    entity_id=str(emp.id), detail=body.kind.value, ip_address=_ip(request)))
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "kind": doc.kind.value, "expiry_date": doc.expiry_date}


@router.post("/documents/upload", status_code=201)
async def upload_document(request: Request,
                          employee_id: int = Form(...),
                          kind: DocumentKind = Form(...),
                          number: Optional[str] = Form(None),
                          issue_date: Optional[date] = Form(None),
                          expiry_date: Optional[date] = Form(None),
                          file: UploadFile = File(...),
                          db: Session = Depends(get_db),
                          actor=Depends(require_roles("hr", "admin"))):
    """Passport and visa scans. Stored under a generated name outside the web root
    and served only through the authorised download endpoint below — never as a
    static path, or the filename becomes the access control."""
    emp = _employee(db, employee_id)
    if expiry_date and issue_date and expiry_date < issue_date:
        raise HTTPException(422, "Expiry date can't be before the issue date.")

    payload = await file.read()
    try:
        meta = save_upload(payload, file.filename or "document",
                           file.content_type or "application/octet-stream")
    except ValueError as e:
        raise HTTPException(422, str(e))

    doc = EmployeeDocument(employee_id=emp.id, kind=kind, number=number,
                           issue_date=issue_date, expiry_date=expiry_date,
                           file_path=meta["stored_name"],
                           original_filename=meta["original_filename"],
                           content_type=meta["content_type"],
                           size_bytes=meta["size_bytes"], sha256=meta["sha256"])
    db.add(doc)
    if kind == DocumentKind.rera_card:
        emp.rera_brn = number or emp.rera_brn
        emp.rera_expiry = expiry_date or emp.rera_expiry
    db.add(AuditLog(actor_id=actor.id, action="document.uploaded",
                    entity="employee_document", entity_id=str(emp.id),
                    detail=f"{kind.value} {meta['size_bytes']}B", ip_address=_ip(request)))
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "kind": doc.kind.value, "expiry_date": doc.expiry_date,
            "size_bytes": doc.size_bytes, "sha256": doc.sha256}


@router.get("/documents/{document_id}/download")
def download_document(document_id: int, request: Request, db: Session = Depends(get_db),
                      actor=Depends(require_roles("hr", "admin"))):
    """HR only, and every download is audited. Passport scans are the highest-value
    data in this system — an unlogged read is not acceptable."""
    doc = db.query(EmployeeDocument).filter(EmployeeDocument.id == document_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "No file is attached to that document.")
    path = stored_path(doc.file_path)
    if not path.exists():
        raise HTTPException(410, "The stored file is missing. Re-upload it.")
    db.add(AuditLog(actor_id=actor.id, action="document.downloaded",
                    entity="employee_document", entity_id=str(doc.id),
                    detail=doc.kind.value, ip_address=_ip(request)))
    db.commit()
    return FileResponse(path, media_type=doc.content_type or "application/octet-stream",
                        filename=doc.original_filename or f"document-{doc.id}")


@router.delete("/documents/{document_id}")
def delete_document(document_id: int, request: Request, db: Session = Depends(get_db),
                    actor=Depends(require_roles("hr", "admin"))):
    doc = db.query(EmployeeDocument).filter(EmployeeDocument.id == document_id).first()
    if not doc:
        raise HTTPException(404, "No document with that ID.")
    if doc.file_path:
        delete_stored(doc.file_path)
    db.add(AuditLog(actor_id=actor.id, action="document.deleted",
                    entity="employee_document", entity_id=str(doc.id),
                    detail=doc.kind.value, ip_address=_ip(request)))
    db.delete(doc)
    db.commit()
    return {"status": "deleted", "id": document_id}


@router.get("/{employee_id}/documents")
def list_documents(employee_id: int, db: Session = Depends(get_db),
                   actor=Depends(active_user)):
    emp = _employee(db, employee_id)
    if not _can_view(actor, emp):
        raise HTTPException(403, "You don't have access to this.")
    rows = (db.query(EmployeeDocument)
              .filter(EmployeeDocument.employee_id == emp.id)
              .order_by(EmployeeDocument.expiry_date).all())
    return [{"id": d.id, "kind": d.kind.value, "number": d.number,
             "issue_date": d.issue_date, "expiry_date": d.expiry_date,
             "has_file": bool(d.file_path), "original_filename": d.original_filename,
             "days_remaining": (d.expiry_date - date.today()).days if d.expiry_date else None}
            for d in rows]


@router.get("/documents/expiring")
def expiring(within_days: int = 90, db: Session = Depends(get_db),
             actor=Depends(require_roles("hr", "admin"))):
    """Feed this to a daily job. 90/60/30-day windows are the useful triggers —
    a residence visa renewal in the UAE realistically needs 30+ days of runway."""
    rows = expiring_documents(db, within_days)
    return {"within_days": within_days, "count": len(rows), "documents": rows}


# ---------------------------------------------------------------------------
# Offboarding
# ---------------------------------------------------------------------------
@router.post("/offboarding/start", status_code=201)
def start_offboarding(body: ResignIn, request: Request, db: Session = Depends(get_db),
                      actor=Depends(require_roles("hr", "admin"))):
    emp = _employee(db, body.employee_id)
    if emp.status == EmploymentStatus.exited:
        raise HTTPException(409, "This employee has already left.")
    if emp.status == EmploymentStatus.notice:
        raise HTTPException(409, "Offboarding is already under way.")

    lwd = body.last_working_day or (body.notice_given_on + timedelta(days=body.notice_days))
    if lwd < body.notice_given_on:
        raise HTTPException(422, "The last working day can't be before notice was given.")

    emp.status = EmploymentStatus.notice
    emp.date_of_exit = lwd
    created = build_checklist(db, emp, ChecklistPhase.offboarding, lwd)

    served = (lwd - body.notice_given_on).days
    shortfall = max(body.notice_days - served, 0)

    db.add(AuditLog(actor_id=actor.id,
                    action="offboarding.started", entity="employee",
                    entity_id=str(emp.id),
                    detail=f"lwd={lwd} resigned={body.resigned} shortfall={shortfall}d",
                    ip_address=_ip(request)))
    db.commit()
    return {"employee_id": emp.id, "status": emp.status.value,
            "last_working_day": lwd, "notice_days_served": served,
            "notice_shortfall_days": shortfall,
            "tasks_created": len(created),
            "message": "Offboarding started."
                       + (f" Notice is {shortfall} days short — check whether the "
                          "contract requires payment in lieu." if shortfall else "")}


@router.get("/{employee_id}/settlement")
def settlement(employee_id: int, notice_shortfall_days: int = 0,
               notice_basis: str = "total", db: Session = Depends(get_db),
               actor=Depends(require_roles("hr", "admin"))):
    """Indicative final settlement. Read-only — nothing here pays anyone."""
    if notice_basis not in ("total", "basic"):
        raise HTTPException(422, "Notice basis must be 'total' or 'basic'.")
    emp = _employee(db, employee_id)
    lwd = emp.date_of_exit or date.today()
    try:
        return final_settlement(db, emp, lwd, resigned=True,
                                notice_shortfall_days=max(notice_shortfall_days, 0),
                                notice_basis=notice_basis)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/{employee_id}/exit")
def finalise_exit(employee_id: int, body: ExitIn, request: Request,
                  db: Session = Depends(get_db),
                  actor=Depends(require_roles("hr", "admin"))):
    """Closes the account. Gated on clearance so nobody walks out with a laptop
    and an active visa. Revokes every session immediately."""
    emp = _employee(db, employee_id)
    if emp.status == EmploymentStatus.exited:
        raise HTTPException(409, "This employee has already left.")
    if emp.status != EmploymentStatus.notice:
        raise HTTPException(409, "Start offboarding before finalising the exit.")

    blockers = outstanding_blockers(db, emp.id, ChecklistPhase.offboarding)
    if blockers:
        raise HTTPException(409, {
            "message": f"{len(blockers)} clearance steps still open.",
            "outstanding": [t.title for t in blockers],
        })
    if not body.confirm_settlement_paid:
        raise HTTPException(409,
                            "Confirm the final settlement has been paid before closing "
                            "the account.")

    emp.status = EmploymentStatus.exited
    emp.is_active = False
    emp.date_of_exit = emp.date_of_exit or date.today()

    revoked = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

    # Biometric data has no lawful purpose once employment ends.
    from app.models.core import FaceTemplate
    templates = db.query(FaceTemplate).filter(FaceTemplate.employee_id == emp.id).delete()
    emp.biometric_consent_at = None

    db.add(AuditLog(actor_id=actor.id, action="employee.exited", entity="employee",
                    entity_id=str(emp.id),
                    detail=f"sessions_revoked={revoked} face_templates_deleted={templates}",
                    ip_address=_ip(request)))
    db.commit()
    return {"employee_id": emp.id, "status": emp.status.value,
            "date_of_exit": emp.date_of_exit,
            "sessions_revoked": revoked, "face_templates_deleted": templates,
            "message": f"{emp.full_name} has been offboarded. Access revoked and "
                       "biometric data deleted."}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db),
              actor=Depends(require_roles("hr", "admin"))):
    """What HR needs on a Monday morning."""
    onboarding = db.query(Employee).filter(
        Employee.status == EmploymentStatus.onboarding).all()
    leaving = db.query(Employee).filter(Employee.status == EmploymentStatus.notice).all()
    overdue = (db.query(ChecklistTask)
                 .filter(ChecklistTask.completed_at.is_(None),
                         ChecklistTask.due_date < date.today())
                 .count())
    docs = expiring_documents(db, 60)
    return {
        "joining": [{"employee_id": e.id, "name": e.full_name,
                     "date_of_joining": e.date_of_joining,
                     "open_blockers": len(outstanding_blockers(
                         db, e.id, ChecklistPhase.onboarding))} for e in onboarding],
        "leaving": [{"employee_id": e.id, "name": e.full_name,
                     "last_working_day": e.date_of_exit,
                     "open_blockers": len(outstanding_blockers(
                         db, e.id, ChecklistPhase.offboarding))} for e in leaving],
        "overdue_tasks": overdue,
        "documents_expiring_60d": len(docs),
        "documents_expired": len([d for d in docs if d["severity"] == "expired"]),
    }
