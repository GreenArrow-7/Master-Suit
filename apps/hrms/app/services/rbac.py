"""Effective-permission engine.

Never trust role information from the frontend: every check runs against the
user_role_assignments table on the server, on every request.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Iterable, Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import active_user
from app.models.core import AuditLog, Employee, Role as LegacyRole
from app.models.rbac import (
    AssignmentStatus, PermissionDef, RoleDef, RolePermission, ScopeType,
    UserRoleAssignment,
)

# ---------------------------------------------------------------------------
# Permission catalogue. code -> (module, description, high_privilege)
# ---------------------------------------------------------------------------
PERMISSIONS: dict[str, tuple[str, str, bool]] = {
    "employees.view":            ("employees", "View employee records", False),
    "employees.manage":          ("employees", "Create and edit employees", False),
    "employees.sensitive":       ("employees", "View identity documents and salary", True),
    "attendance.self":           ("attendance", "Check in and out", False),
    "attendance.team":           ("attendance", "View team attendance", False),
    "attendance.all":            ("attendance", "View all attendance", False),
    "attendance.exception.manager": ("attendance", "Approve exceptions (manager stage)", False),
    "attendance.exception.hr":   ("attendance", "Approve exceptions (HR stage)", False),
    "leave.self":                ("leave", "Request own leave", False),
    "leave.approve":             ("leave", "Approve team leave", False),
    "leave.manage":              ("leave", "Administer all leave", False),
    "locations.view":            ("locations", "View work locations", False),
    "locations.manage":          ("locations", "Create and edit work locations", True),
    "locations.assign":          ("locations", "Assign employees to locations", False),
    "locations.temp.request":    ("locations", "Request temporary locations", False),
    "locations.temp.approve":    ("locations", "Approve temporary locations", True),
    "roles.view":                ("roles", "View roles and assignments", False),
    "roles.manage":              ("roles", "Create and edit roles", True),
    "roles.assign":              ("roles", "Assign roles to users", True),
    "roles.assign.super":        ("roles", "Assign or revoke Super Administrator", True),
    "access.manage":             ("access", "Manage login accounts, MFA, sessions", True),
    "lifecycle.manage":          ("lifecycle", "Onboarding and offboarding", False),
    "payroll.view":              ("payroll", "View payroll-relevant data", False),
    "recruitment.manage":        ("recruitment", "Manage recruitment", False),
    "audit.view":                ("audit", "Read audit logs", False),
    "reports.view":              ("reports", "Run reports", False),
}

_BASE = ["attendance.self", "leave.self"]
DEFAULT_ROLES: dict[str, tuple[str, list[str]]] = {
    "super_admin":    ("Super Administrator", ["*"]),
    "hr_admin":       ("HR Administrator", _BASE + [
        "employees.view", "employees.manage", "employees.sensitive", "attendance.all",
        "attendance.exception.hr", "leave.manage", "leave.approve", "locations.view",
        "locations.manage", "locations.assign", "locations.temp.approve", "roles.view",
        "lifecycle.manage", "reports.view", "access.manage"]),
    "hr_executive":   ("HR Executive", _BASE + [
        "employees.view", "employees.manage", "attendance.all", "leave.approve",
        "locations.view", "lifecycle.manage", "reports.view"]),
    "dept_manager":   ("Department Manager", _BASE + [
        "employees.view", "attendance.team", "attendance.exception.manager",
        "leave.approve", "locations.view", "reports.view"]),
    "site_manager":   ("Site Manager", _BASE + [
        "employees.view", "attendance.team", "attendance.exception.manager",
        "locations.view", "locations.temp.request", "reports.view"]),
    "branch_manager": ("Branch Manager", _BASE + [
        "employees.view", "attendance.team", "attendance.exception.manager",
        "leave.approve", "locations.view", "locations.assign", "reports.view"]),
    "employee":       ("Employee", _BASE),
    "it_admin":       ("IT Administrator", _BASE + [
        "employees.view", "access.manage", "lifecycle.manage"]),
    "finance_admin":  ("Finance Administrator", _BASE + [
        "employees.view", "payroll.view", "reports.view"]),
    "payroll_officer":("Payroll Officer", _BASE + [
        "attendance.all", "payroll.view", "reports.view"]),
    "recruiter":      ("Recruiter", _BASE + ["employees.view", "recruitment.manage"]),
    "auditor":        ("Auditor", [
        "employees.view", "attendance.all", "locations.view", "roles.view",
        "audit.view", "reports.view"]),
}
ADMIN_CAPABLE = {"super_admin"}                # roles that count as "administrative"
LEGACY_EQUIVALENT = {"super_admin": LegacyRole.admin, "hr_admin": LegacyRole.hr,
                     "hr_executive": LegacyRole.hr, "dept_manager": LegacyRole.manager,
                     "site_manager": LegacyRole.manager, "branch_manager": LegacyRole.manager,
                     "it_admin": LegacyRole.manager}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def active_assignments(db: Session, user_id: int) -> list[UserRoleAssignment]:
    t = _today()
    rows = (db.query(UserRoleAssignment)
              .filter(UserRoleAssignment.user_id == user_id,
                      UserRoleAssignment.status == AssignmentStatus.active.value)
              .all())
    out = []
    for a in rows:
        if a.effective_from and a.effective_from > t:
            continue
        if a.effective_to and a.effective_to < t:
            continue
        role = db.query(RoleDef).get(a.role_id)
        if role and role.is_active:
            out.append(a)
    return out


def effective_role_codes(db: Session, user_id: int) -> set[str]:
    codes = set()
    for a in active_assignments(db, user_id):
        role = db.query(RoleDef).get(a.role_id)
        if role:
            codes.add(role.code)
    return codes


def effective_permissions(db: Session, user_id: int) -> set[str]:
    perms: set[str] = set()
    for a in active_assignments(db, user_id):
        role = db.query(RoleDef).get(a.role_id)
        if not role:
            continue
        if role.code in ADMIN_CAPABLE:
            return {"*"}
        for rp in db.query(RolePermission).filter(RolePermission.role_id == role.id):
            p = db.query(PermissionDef).get(rp.permission_id)
            if p:
                perms.add(p.code)
    return perms


def has_perm(db: Session, user: Employee, code: str) -> bool:
    perms = effective_permissions(db, user.id)
    return "*" in perms or code in perms


def require_perm(*codes: str):
    """FastAPI dependency: the user needs ANY of the listed permissions."""
    def _guard(user: Employee = Depends(active_user), db: Session = Depends(get_db)):
        perms = effective_permissions(db, user.id)
        if "*" in perms or any(c in perms for c in codes):
            return user
        raise HTTPException(403, "You don't have permission for this.")
    return _guard


# ---------------------------------------------------------------------------
# Scope checks — does one of the actor's assignments cover this target?
# ---------------------------------------------------------------------------
def scope_covers(db: Session, a: UserRoleAssignment, actor: Employee,
                 target: Employee) -> bool:
    st = a.scope_type
    if st == ScopeType.organisation.value:
        return True
    if st == ScopeType.own_record.value:
        return target.id == actor.id
    if st == ScopeType.direct_reports.value:
        return target.manager_id == actor.id or target.id == actor.id
    if st in (ScopeType.department.value, ScopeType.branch.value):
        return bool(a.scope_id) and (target.department or "").strip().lower() == a.scope_id.strip().lower()
    if st in (ScopeType.work_location.value, ScopeType.project.value, ScopeType.property.value):
        from app.models.locations import EmployeeLocationAssignment
        if not a.scope_id:
            return False
        return db.query(EmployeeLocationAssignment).filter(
            EmployeeLocationAssignment.employee_id == target.id,
            EmployeeLocationAssignment.location_id == int(a.scope_id),
            EmployeeLocationAssignment.status == "active").count() > 0
    return False


def actor_scope_covers(db: Session, actor: Employee, target: Employee,
                       perm: str) -> bool:
    """True when the actor holds `perm` through at least one assignment whose
    scope includes the target employee."""
    for a in active_assignments(db, actor.id):
        role = db.query(RoleDef).get(a.role_id)
        if not role:
            continue
        if role.code in ADMIN_CAPABLE:
            return True
        role_perms = {db.query(PermissionDef).get(rp.permission_id).code
                      for rp in db.query(RolePermission).filter(RolePermission.role_id == role.id)}
        if perm in role_perms and scope_covers(db, a, actor, target):
            return True
    return False


# ---------------------------------------------------------------------------
# Guard rails
# ---------------------------------------------------------------------------
def assert_can_assign_role(db: Session, actor: Employee, role: RoleDef):
    if role.code in ADMIN_CAPABLE:
        actor_codes = effective_role_codes(db, actor.id)
        if not (actor_codes & ADMIN_CAPABLE):
            raise HTTPException(403, "Only a Super Administrator can assign or revoke "
                                     "Super Administrator access.")


def assert_not_last_admin_self_removal(db: Session, actor: Employee,
                                       assignment: UserRoleAssignment):
    role = db.query(RoleDef).get(assignment.role_id)
    if not role or role.code not in ADMIN_CAPABLE or assignment.user_id != actor.id:
        return
    others = [a for a in active_assignments(db, actor.id)
              if a.id != assignment.id
              and db.query(RoleDef).get(a.role_id).code in ADMIN_CAPABLE]
    if not others:
        raise HTTPException(409, "You cannot remove your own last administrative role.")


def sync_legacy_role(db: Session, user: Employee):
    """Keep employees.role coherent for legacy endpoints (highest equivalent)."""
    codes = effective_role_codes(db, user.id)
    order = [LegacyRole.admin, LegacyRole.hr, LegacyRole.manager, LegacyRole.employee]
    best = LegacyRole.employee
    for c in codes:
        eq = LEGACY_EQUIVALENT.get(c, LegacyRole.employee)
        if order.index(eq) < order.index(best):
            best = eq
    user.role = best


def audit(db: Session, actor_id: Optional[int], action: str, entity: str,
          entity_id, detail: str, ip: Optional[str] = None):
    db.add(AuditLog(actor_id=actor_id, action=action, entity=entity,
                    entity_id=str(entity_id), detail=detail[:2000], ip_address=ip))


# ---------------------------------------------------------------------------
# Seeding (idempotent) + migration from the legacy enum column
# ---------------------------------------------------------------------------
def seed_rbac(db: Session):
    for code, (module, desc, high) in PERMISSIONS.items():
        if not db.query(PermissionDef).filter_by(code=code).first():
            db.add(PermissionDef(code=code, module=module, description=desc,
                                 is_high_privilege=high))
    db.flush()
    for code, (name, perms) in DEFAULT_ROLES.items():
        role = db.query(RoleDef).filter_by(code=code).first()
        if not role:
            role = RoleDef(code=code, name=name, is_system=True,
                           description=f"Default {name} role")
            db.add(role)
            db.flush()
            if perms != ["*"]:
                for pc in perms:
                    p = db.query(PermissionDef).filter_by(code=pc).first()
                    if p:
                        db.add(RolePermission(role_id=role.id, permission_id=p.id))
    db.flush()
    # Migrate anyone who has a legacy role but no assignment yet.
    legacy_map = {LegacyRole.admin: "super_admin", LegacyRole.hr: "hr_admin",
                  LegacyRole.manager: "dept_manager", LegacyRole.employee: "employee"}
    for emp in db.query(Employee).all():
        if db.query(UserRoleAssignment).filter_by(user_id=emp.id).count() == 0:
            role = db.query(RoleDef).filter_by(code=legacy_map[emp.role]).first()
            if role:
                db.add(UserRoleAssignment(user_id=emp.id, role_id=role.id,
                                          scope_type=ScopeType.organisation.value,
                                          assigned_by=None))
    db.commit()
