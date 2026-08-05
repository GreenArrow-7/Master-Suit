"""Dynamic role-based access control.

Roles are data, not code. A user's effective permissions are the union of all
active, in-window role assignments — never a hardcoded column. The legacy
employees.role column is kept in sync (highest-privilege equivalent) so older
endpoints keep working during the transition, but new code must use
app.services.rbac.require_perm().
"""
import enum
from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, Index,
)
from app.core.db import Base
from app.models.core import utcnow


class RoleDef(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    code = Column(String(60), nullable=False, unique=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, default="")
    is_system = Column(Boolean, default=False, nullable=False)   # default roles: code immutable
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("employees.id"))
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_by = Column(Integer, ForeignKey("employees.id"))
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PermissionDef(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True)
    code = Column(String(80), nullable=False, unique=True, index=True)
    module = Column(String(40), nullable=False)
    description = Column(String(200), default="")
    is_high_privilege = Column(Boolean, default=False, nullable=False)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False)
    __table_args__ = (UniqueConstraint("role_id", "permission_id"),)


class ScopeType(str, enum.Enum):
    organisation = "organisation"
    department = "department"
    branch = "branch"
    work_location = "work_location"
    project = "project"
    property = "property"
    direct_reports = "direct_reports"
    own_record = "own_record"


class AssignmentStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"


class UserRoleAssignment(Base):
    __tablename__ = "user_role_assignments"

    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, default=1, nullable=False)
    user_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    scope_type = Column(String(30), default=ScopeType.organisation.value, nullable=False)
    scope_id = Column(String(60))                       # dept name / location id / etc.
    effective_from = Column(Date)                       # null = immediately
    effective_to = Column(Date)                         # null = until revoked
    status = Column(String(20), default=AssignmentStatus.active.value, nullable=False)
    assigned_by = Column(Integer, ForeignKey("employees.id"))
    assigned_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_by = Column(Integer, ForeignKey("employees.id"))
    revoked_at = Column(DateTime(timezone=True))
    revocation_reason = Column(String(240))

    __table_args__ = (
        Index("ix_ura_user_active", "user_id", "status", "effective_from", "effective_to"),
    )
