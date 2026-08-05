"""Roles & permissions administration + per-user access management.

All changes happen through these APIs, are permission-guarded server-side and
land in the append-only audit log. Role information from the frontend is never
trusted — the effective permission set is recomputed from the database on
every request.
"""
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import active_user
from app.models.core import AuditLog, Employee, LoginAttempt, RefreshSession
from app.models.rbac import (
    AssignmentStatus, PermissionDef, RoleDef, RolePermission, ScopeType,
    UserRoleAssignment,
)
from app.services.rbac import (
    ADMIN_CAPABLE, active_assignments, assert_can_assign_role,
    assert_not_last_admin_self_removal, audit, effective_permissions,
    effective_role_codes, require_perm, sync_legacy_role,
)

router = APIRouter(prefix="/api/roles", tags=["roles"])


def _ip(request: Request):
    return request.client.host if request.client else None


class RoleIn(BaseModel):
    code: str = Field(..., min_length=2, max_length=60, pattern=r"^[a-z0-9_]+$")
    name: str = Field(..., min_length=2, max_length=120)
    description: str = ""
    permission_codes: List[str] = []
    clone_from: Optional[int] = None


class RolePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    permission_codes: Optional[List[str]] = None


class AssignIn(BaseModel):
    user_id: int
    role_id: int
    scope_type: str = ScopeType.organisation.value
    scope_id: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class RevokeIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=240)


@router.get("/permissions")
def list_permissions(db: Session = Depends(get_db),
                     actor=Depends(require_perm("roles.view", "roles.manage"))):
    return [{"id": p.id, "code": p.code, "module": p.module,
             "description": p.description, "high_privilege": p.is_high_privilege}
            for p in db.query(PermissionDef).order_by(PermissionDef.module, PermissionDef.code)]


@router.get("")
def list_roles(db: Session = Depends(get_db),
               actor=Depends(require_perm("roles.view", "roles.manage"))):
    out = []
    for r in db.query(RoleDef).order_by(RoleDef.name):
        perm_ids = [rp.permission_id for rp in
                    db.query(RolePermission).filter_by(role_id=r.id)]
        assigned = db.query(UserRoleAssignment).filter_by(
            role_id=r.id, status=AssignmentStatus.active.value).count()
        out.append({"id": r.id, "code": r.code, "name": r.name,
                    "description": r.description, "is_system": r.is_system,
                    "is_active": r.is_active, "assigned_users": assigned,
                    "permissions": [db.query(PermissionDef).get(i).code for i in perm_ids],
                    "all_permissions": r.code in ADMIN_CAPABLE})
    return out


@router.post("", status_code=201)
def create_role(body: RoleIn, request: Request, db: Session = Depends(get_db),
                actor=Depends(require_perm("roles.manage"))):
    if db.query(RoleDef).filter_by(code=body.code).first():
        raise HTTPException(409, "A role with that code already exists.")
    role = RoleDef(code=body.code, name=body.name, description=body.description,
                   is_system=False, created_by=actor.id)
    db.add(role); db.flush()
    codes = list(body.permission_codes)
    if body.clone_from:
        src = db.query(RoleDef).get(body.clone_from)
        if not src:
            raise HTTPException(404, "Role to clone from not found.")
        codes += [db.query(PermissionDef).get(rp.permission_id).code
                  for rp in db.query(RolePermission).filter_by(role_id=src.id)]
    for pc in set(codes):
        p = db.query(PermissionDef).filter_by(code=pc).first()
        if p:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
    audit(db, actor.id, "role.create", "role", role.id,
          f"code={role.code} perms={sorted(set(codes))}", _ip(request))
    db.commit()
    return {"id": role.id, "code": role.code}


@router.patch("/{role_id}")
def update_role(role_id: int, body: RolePatch, request: Request,
                db: Session = Depends(get_db),
                actor=Depends(require_perm("roles.manage"))):
    role = db.query(RoleDef).get(role_id)
    if not role:
        raise HTTPException(404, "Role not found.")
    before = {"name": role.name, "active": role.is_active}
    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.is_active is not None:
        if role.code in ADMIN_CAPABLE and not body.is_active:
            raise HTTPException(409, "The Super Administrator role cannot be deactivated.")
        role.is_active = body.is_active
    if body.permission_codes is not None:
        if role.code in ADMIN_CAPABLE:
            raise HTTPException(409, "Super Administrator permissions are fixed.")
        db.query(RolePermission).filter_by(role_id=role.id).delete()
        for pc in set(body.permission_codes):
            p = db.query(PermissionDef).filter_by(code=pc).first()
            if p:
                db.add(RolePermission(role_id=role.id, permission_id=p.id))
    role.updated_by = actor.id
    audit(db, actor.id, "role.update", "role", role.id,
          f"before={before} after={{'name': '{role.name}', 'active': {role.is_active}}}"
          + (f" perms={sorted(set(body.permission_codes))}" if body.permission_codes is not None else ""),
          _ip(request))
    db.commit()
    return {"ok": True}


@router.delete("/{role_id}")
def delete_role(role_id: int, request: Request, db: Session = Depends(get_db),
                actor=Depends(require_perm("roles.manage"))):
    role = db.query(RoleDef).get(role_id)
    if not role:
        raise HTTPException(404, "Role not found.")
    if role.is_system:
        raise HTTPException(409, "Default roles cannot be deleted — deactivate instead.")
    if db.query(UserRoleAssignment).filter_by(role_id=role.id).count():
        raise HTTPException(409, "This role has assignment history and cannot be "
                                 "deleted. Deactivate it instead.")
    db.query(RolePermission).filter_by(role_id=role.id).delete()
    db.delete(role)
    audit(db, actor.id, "role.delete", "role", role_id, f"code={role.code}", _ip(request))
    db.commit()
    return {"ok": True}


@router.get("/{role_id}/users")
def role_users(role_id: int, db: Session = Depends(get_db),
               actor=Depends(require_perm("roles.view", "roles.manage"))):
    rows = db.query(UserRoleAssignment).filter_by(role_id=role_id).all()
    out = []
    for a in rows:
        emp = db.query(Employee).get(a.user_id)
        out.append({"assignment_id": a.id, "user_id": a.user_id,
                    "name": emp.full_name if emp else "?",
                    "email": emp.work_email if emp else "?",
                    "scope_type": a.scope_type, "scope_id": a.scope_id,
                    "effective_from": a.effective_from, "effective_to": a.effective_to,
                    "status": a.status, "assigned_at": a.assigned_at,
                    "revoked_at": a.revoked_at, "revocation_reason": a.revocation_reason})
    return out


@router.post("/assign", status_code=201)
def assign_role(body: AssignIn, request: Request, db: Session = Depends(get_db),
                actor=Depends(require_perm("roles.assign"))):
    role = db.query(RoleDef).get(body.role_id)
    if not role or not role.is_active:
        raise HTTPException(404, "Role not found or inactive.")
    target = db.query(Employee).get(body.user_id)
    if not target:
        raise HTTPException(404, "User not found.")
    if body.scope_type not in [s.value for s in ScopeType]:
        raise HTTPException(422, "Unknown scope type.")
    if body.effective_from and body.effective_to and body.effective_to < body.effective_from:
        raise HTTPException(422, "effective_to is before effective_from.")
    assert_can_assign_role(db, actor, role)      # privilege-escalation guard
    today = datetime.now(timezone.utc).date()
    dup = [a for a in db.query(UserRoleAssignment).filter_by(
               user_id=target.id, role_id=role.id,
               status=AssignmentStatus.active.value,
               scope_type=body.scope_type, scope_id=body.scope_id)
           if a.effective_to is None or a.effective_to >= today]
    if dup:
        raise HTTPException(409, "That user already holds this role with the same scope.")
    a = UserRoleAssignment(user_id=target.id, role_id=role.id,
                           scope_type=body.scope_type, scope_id=body.scope_id,
                           effective_from=body.effective_from,
                           effective_to=body.effective_to, assigned_by=actor.id)
    db.add(a)
    sync_legacy_role(db, target)
    audit(db, actor.id, "role.assign", "user_role_assignment", target.id,
          f"role={role.code} scope={body.scope_type}:{body.scope_id or '-'} "
          f"window={body.effective_from}..{body.effective_to}", _ip(request))
    db.commit()
    return {"assignment_id": a.id}


@router.post("/assignments/{assignment_id}/revoke")
def revoke_assignment(assignment_id: int, body: RevokeIn, request: Request,
                      db: Session = Depends(get_db),
                      actor=Depends(require_perm("roles.assign"))):
    a = db.query(UserRoleAssignment).get(assignment_id)
    if not a or a.status != AssignmentStatus.active.value:
        raise HTTPException(404, "Active assignment not found.")
    role = db.query(RoleDef).get(a.role_id)
    assert_can_assign_role(db, actor, role)       # revoking super_admin needs super_admin
    assert_not_last_admin_self_removal(db, actor, a)
    a.status = AssignmentStatus.revoked.value
    a.revoked_by = actor.id
    a.revoked_at = datetime.now(timezone.utc)
    a.revocation_reason = body.reason
    target = db.query(Employee).get(a.user_id)
    if target:
        sync_legacy_role(db, target)
    audit(db, actor.id, "role.revoke", "user_role_assignment", a.id,
          f"role={role.code if role else a.role_id} user={a.user_id} reason={body.reason}",
          _ip(request))
    db.commit()
    return {"ok": True}


@router.get("/assignments/history")
def assignment_history(user_id: Optional[int] = None, role_id: Optional[int] = None,
                       db: Session = Depends(get_db),
                       actor=Depends(require_perm("roles.view", "roles.manage", "audit.view"))):
    q = db.query(UserRoleAssignment)
    if user_id:
        q = q.filter_by(user_id=user_id)
    if role_id:
        q = q.filter_by(role_id=role_id)
    rows = q.order_by(UserRoleAssignment.assigned_at.desc()).limit(500).all()
    return [{"id": a.id, "user_id": a.user_id,
             "user": (db.query(Employee).get(a.user_id) or Employee(full_name="?")).full_name,
             "role": (db.query(RoleDef).get(a.role_id) or RoleDef(code="?")).code,
             "scope_type": a.scope_type, "scope_id": a.scope_id,
             "effective_from": a.effective_from, "effective_to": a.effective_to,
             "status": a.status,
             "assigned_by": a.assigned_by, "assigned_at": a.assigned_at,
             "revoked_by": a.revoked_by, "revoked_at": a.revoked_at,
             "revocation_reason": a.revocation_reason} for a in rows]


# ---------------------------------------------------------------------------
# Per-user access management (User Access tab)
# ---------------------------------------------------------------------------
access = APIRouter(prefix="/api/access", tags=["access"])


@access.get("/{user_id}")
def user_access(user_id: int, db: Session = Depends(get_db),
                actor=Depends(require_perm("access.manage", "roles.view"))):
    emp = db.query(Employee).get(user_id)
    if not emp:
        raise HTTPException(404, "User not found.")
    return {
        "user_id": emp.id, "email": emp.work_email, "is_active": emp.is_active,
        "must_change_password": emp.must_change_password,
        "totp_enabled": emp.totp_enabled,
        "effective_roles": sorted(effective_role_codes(db, emp.id)),
        "effective_permissions": sorted(effective_permissions(db, emp.id)),
        "assignments": [{"id": a.id,
                         "role": db.query(RoleDef).get(a.role_id).code,
                         "scope_type": a.scope_type, "scope_id": a.scope_id,
                         "effective_from": a.effective_from,
                         "effective_to": a.effective_to}
                        for a in active_assignments(db, emp.id)],
    }


class ActiveIn(BaseModel):
    is_active: bool
    reason: str = Field(..., min_length=3, max_length=240)


@access.post("/{user_id}/active")
def set_active(user_id: int, body: ActiveIn, request: Request,
               db: Session = Depends(get_db),
               actor=Depends(require_perm("access.manage"))):
    emp = db.query(Employee).get(user_id)
    if not emp:
        raise HTTPException(404, "User not found.")
    if emp.id == actor.id and not body.is_active:
        raise HTTPException(409, "You cannot deactivate your own account.")
    emp.is_active = body.is_active
    if not body.is_active:
        db.query(RefreshSession).filter_by(employee_id=emp.id).delete()
    audit(db, actor.id, "access.active" if body.is_active else "access.deactivate",
          "employee", emp.id, body.reason, _ip(request))
    db.commit()
    return {"ok": True}


@access.post("/{user_id}/revoke-sessions")
def revoke_sessions(user_id: int, request: Request, db: Session = Depends(get_db),
                    actor=Depends(require_perm("access.manage"))):
    n = db.query(RefreshSession).filter_by(employee_id=user_id).delete()
    audit(db, actor.id, "access.revoke_sessions", "employee", user_id,
          f"sessions_revoked={n}", _ip(request))
    db.commit()
    return {"revoked": n}


@access.post("/{user_id}/reset-mfa")
def reset_mfa(user_id: int, request: Request, db: Session = Depends(get_db),
              actor=Depends(require_perm("access.manage"))):
    emp = db.query(Employee).get(user_id)
    if not emp:
        raise HTTPException(404, "User not found.")
    emp.totp_secret_encrypted = None
    emp.totp_enabled = False
    emp.totp_confirmed_at = None
    emp.totp_last_timestep = None
    audit(db, actor.id, "access.reset_mfa", "employee", emp.id,
          "MFA reset — user must re-enrol", _ip(request))
    db.commit()
    return {"ok": True}


@access.get("/{user_id}/logins")
def login_history(user_id: int, db: Session = Depends(get_db),
                  actor=Depends(require_perm("access.manage", "audit.view"))):
    emp = db.query(Employee).get(user_id)
    if not emp:
        raise HTTPException(404, "User not found.")
    rows = (db.query(LoginAttempt)
              .filter(LoginAttempt.work_email == emp.work_email)
              .order_by(LoginAttempt.at.desc()).limit(50).all())
    return [{"at": r.at, "success": r.succeeded, "ip": r.ip_address} for r in rows]
