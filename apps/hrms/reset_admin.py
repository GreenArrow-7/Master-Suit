"""Reset an account's password and clear any lockout.

For the case seed.py deliberately won't handle: an account already exists and
nobody remembers its password. seed.py only ever CREATES an admin — it never
overwrites an existing password, because a seed script that silently resets
credentials on every run is a foot-gun.

Usage:
    python reset_admin.py
    python reset_admin.py --email someone@manathhomes.ae

You'll be prompted for the new password. It is never echoed, never stored in
shell history, and never written to a log.

This is a local-console tool. Anyone who can run it already has the database
file, so it grants nothing they couldn't do with a SQLite editor — but every
reset is still written to the audit log.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from datetime import datetime, timezone

from app.core.db import Base, SessionLocal, engine
from app.core.migrate import reconcile_schema
from app.core.security import hash_password
from app.models.core import (
    AuditLog, Employee, LoginAttempt, RecoveryCode, RefreshSession,
)

MIN_LENGTH = 12


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset an account password.")
    parser.add_argument("--email", default="admin@manathhomes.ae",
                        help="Account to reset (default: admin@manathhomes.ae)")
    parser.add_argument("--clear-2fa", action="store_true",
                        help="Also remove the authenticator app (lost phone).")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    reconcile_schema(engine)

    db = SessionLocal()
    email = args.email.strip().lower()
    emp = db.query(Employee).filter(Employee.work_email == email).first()

    if not emp:
        existing = db.query(Employee).all()
        print(f"No account found for {email}.")
        if existing:
            print("\nAccounts in this database:")
            for e in existing:
                print(f"  {e.work_email}  ({e.role.value})")
        else:
            print("\nThe database has no accounts at all. Run seed.py first:")
            print('  $env:SEED_ADMIN_PASSWORD = "AtLeast12Chars!"')
            print("  python seed.py")
        db.close()
        return 1

    print(f"Resetting: {emp.full_name} <{emp.work_email}>  ({emp.role.value})")

    try:
        new = getpass.getpass("New password (at least 12 characters): ")
        again = getpass.getpass("Confirm: ")
    except (EOFError, KeyboardInterrupt):
        print("\nCancelled. Nothing changed.")
        db.close()
        return 1

    if new != again:
        print("The passwords don't match. Nothing changed.")
        db.close()
        return 1
    if len(new) < MIN_LENGTH:
        print(f"That's {len(new)} characters — it must be at least {MIN_LENGTH}. "
              "Nothing changed.")
        db.close()
        return 1

    emp.password_hash = hash_password(new)
    emp.must_change_password = False
    emp.is_active = True

    # Clear the lockout. Otherwise a correct new password still returns 429
    # until the window expires, which looks exactly like the reset not working.
    cleared = db.query(LoginAttempt).filter(
        LoginAttempt.work_email == email,
        LoginAttempt.succeeded.is_(False)).delete()

    revoked = db.query(RefreshSession).filter(
        RefreshSession.employee_id == emp.id,
        RefreshSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

    removed_2fa = False
    if args.clear_2fa and emp.totp_enabled:
        emp.totp_enabled = False
        emp.totp_secret_encrypted = None
        emp.totp_confirmed_at = None
        emp.totp_last_timestep = None
        db.query(RecoveryCode).filter(RecoveryCode.employee_id == emp.id).delete()
        removed_2fa = True

    db.add(AuditLog(actor_id=emp.id, action="auth.password_reset_console",
                    entity="employee", entity_id=str(emp.id),
                    detail=f"failed_attempts_cleared={cleared} "
                           f"sessions_revoked={revoked} 2fa_removed={removed_2fa}"))

    # Read anything needed for the summary BEFORE closing — attributes on a
    # detached instance raise DetachedInstanceError when SQLAlchemy tries to
    # refresh them post-commit.
    still_has_2fa = bool(emp.totp_enabled)

    db.commit()
    db.close()

    print(f"\nDone. Sign in as {email} with the new password.")
    if cleared:
        print(f"  Lockout cleared ({cleared} failed attempts removed).")
    if revoked:
        print(f"  {revoked} existing session(s) signed out.")
    if removed_2fa:
        print("  Authenticator removed — set it up again from the Security page.")
    elif still_has_2fa:
        print("  Two-factor is still on: you'll need your authenticator code too.")
        print("  Lost the phone? Re-run with --clear-2fa")
    return 0


if __name__ == "__main__":
    sys.exit(main())
