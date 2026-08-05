"""Seeds Manath Homes: admin, site, leave types, holidays.

Run once:
    python seed.py
Requires SEED_ADMIN_PASSWORD to be set — no default admin password is ever created.
"""
import os
import secrets
import sys
from datetime import date

from app.core.db import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models.core import (
    Employee, EmploymentStatus, Holiday, LeaveType, Role, Site,
)
from app.models import locations as _loc_models, rbac as _rbac_models  # noqa: F401
from app.models.locations import EmployeeLocationAssignment, WorkLocation

Base.metadata.create_all(bind=engine)

from app.core.migrate import reconcile_schema  # noqa: E402
reconcile_schema(engine)
db = SessionLocal()

email = os.getenv("SEED_ADMIN_EMAIL", "admin@manathhomes.ae").lower()
password = os.getenv("SEED_ADMIN_PASSWORD")
if not password:
    sys.exit("Set SEED_ADMIN_PASSWORD first.\n"
             f"  PowerShell:  $env:SEED_ADMIN_PASSWORD = \"{secrets.token_urlsafe(16)}\"\n"
             f"  bash:        export SEED_ADMIN_PASSWORD='{secrets.token_urlsafe(16)}'")
if len(password) < 12:
    sys.exit(
        f"SEED_ADMIN_PASSWORD is {len(password)} characters — it must be at least 12.\n"
        "Nothing was created. Set a longer one and run this again:\n\n"
        f'  PowerShell:  $env:SEED_ADMIN_PASSWORD = "{secrets.token_urlsafe(16)}"\n'
        f"  bash:        export SEED_ADMIN_PASSWORD='{secrets.token_urlsafe(16)}'\n\n"
        "This account can read every passport scan and salary in the system, so a\n"
        "short or guessable password isn't worth the convenience.")

if not db.query(Employee).filter(Employee.work_email == email).first():
    db.add(Employee(
        employee_code="ADM-001", full_name="System Administrator", work_email=email,
        password_hash=hash_password(password), role=Role.admin,
        designation="Administrator", department="IT",
        date_of_joining=date.today(), status=EmploymentStatus.active,
        must_change_password=False,   # the seeder chose this password themselves
    ))
    print(f"  admin: {email}")
else:
    # Loud, because the obvious assumption is that re-running the seed applies
    # the new password. It doesn't — and quietly ignoring it wastes an afternoon.
    print(f"  admin already exists: {email}")
    print("     SEED_ADMIN_PASSWORD was NOT applied — the existing password is unchanged.")
    print("     To set a new one:  python reset_admin.py")

# Update these to Manath Homes' real coordinates before going live.
SITES = [
    ("Manath Homes — Head Office", 25.1972, 55.2744, 150),
    ("Manath Homes — Sales Gallery", 25.0760, 55.1330, 120),
]
for name, lat, lon, radius in SITES:
    if not db.query(Site).filter(Site.name == name).first():
        db.add(Site(name=name, latitude=lat, longitude=lon, radius_m=radius))
        print(f"  site: {name}")

# v2: authoritative attendance locations (admin-managed geofences)
for name, lat, lon, radius in SITES:
    if not db.query(WorkLocation).filter(WorkLocation.name == name).first():
        db.add(WorkLocation(name=name, location_type="head_office",
                            latitude=lat, longitude=lon, radius_m=radius,
                            status="active", country="United Arab Emirates"))
        print(f"  work location: {name}")
db.flush()

LEAVE = [
    ("ANNUAL",     "Annual leave",           30, True,  True,  15, False),
    ("SICK_FULL",  "Sick leave (full pay)",  15, True,  False,  0, True),
    ("SICK_HALF",  "Sick leave (half pay)",  30, True,  False,  0, True),
    ("SICK_UNPAID","Sick leave (unpaid)",    45, False, False,  0, True),
    ("MATERNITY",  "Maternity leave",        60, True,  False,  0, True),
    ("PARENTAL",   "Parental leave",          5, True,  False,  0, True),
    ("BEREAVE",    "Bereavement leave",       5, True,  False,  0, True),
    ("HAJJ",       "Hajj leave",             30, False, False,  0, False),
    ("STUDY",      "Study leave",            10, True,  False,  0, True),
]
for code, name, days, paid, accrues, cf, doc in LEAVE:
    if not db.query(LeaveType).filter(LeaveType.code == code).first():
        db.add(LeaveType(code=code, name=name, annual_entitlement_days=days,
                         is_paid=paid, accrues=accrues,
                         max_carry_forward_days=cf, requires_document=doc))

# Gregorian dates are fixed. Islamic dates shift with the moon — HR confirms yearly.
YEAR = date.today().year
for d, name in [(date(YEAR, 1, 1), "New Year's Day"),
                (date(YEAR, 12, 1), "Commemoration Day"),
                (date(YEAR, 12, 2), "National Day"),
                (date(YEAR, 12, 3), "National Day holiday")]:
    if not db.query(Holiday).filter(Holiday.holiday_date == d,
                                    Holiday.name == name).first():
        db.add(Holiday(holiday_date=d, name=name, year=d.year, is_confirmed=True))

db.commit()
db.close()
print(f"  leave types and {YEAR} fixed holidays seeded")
print("\nSeed complete. Lunar holidays (Eid, Islamic New Year, Mawlid) must be")
print("added by HR each year — they aren't fixed dates.")

# v2: default roles, permission catalogue, and legacy-role migration.
from app.services.rbac import seed_rbac  # noqa: E402
seed_rbac(db)

# Give the admin a primary location assignment so check-in works immediately.
_admin = db.query(Employee).filter(Employee.work_email == email).first()
_hq = db.query(WorkLocation).first()
if _admin and _hq and not db.query(EmployeeLocationAssignment).filter_by(
        employee_id=_admin.id).first():
    db.add(EmployeeLocationAssignment(employee_id=_admin.id, location_id=_hq.id,
                                      assignment_type="primary",
                                      checkout_rule="same_location"))
    print("  assignment: admin -> " + _hq.name)
db.commit()
print("Seed complete.")
