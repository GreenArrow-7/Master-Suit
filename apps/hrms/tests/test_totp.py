"""Two-factor authentication and company-domain restriction."""
import time
from datetime import date, datetime, timedelta, timezone

import jwt
import pyotp
import pytest
from tests.conftest import TestSession, client, reset_schema

from app.core.config import settings
from app.core.security import hash_password
from app.models.core import Employee, EmploymentStatus, RecoveryCode, Role
from app.services import totp as T

PW = "CorrectHorse-2026!"


@pytest.fixture(autouse=True)
def db_setup():
    reset_schema()
    db = TestSession()
    for code, name, email, role in [
        ("ADM-001", "Root Admin", "admin@manathhomes.ae", Role.admin),
        ("HR-001", "Aisha Rahman", "hr@manathhomes.ae", Role.hr),
        ("EMP-001", "Omar Farouk", "omar@manathhomes.ae", Role.employee),
        ("EMP-002", "Layla Haddad", "layla@manathhomes.ae", Role.employee),
    ]:
        db.add(Employee(employee_code=code, full_name=name, work_email=email,
                        password_hash=hash_password(PW), role=role,
                        date_of_joining=date(2022, 1, 1),
                        status=EmploymentStatus.active, must_change_password=False))
    db.commit(); db.close()
    yield


def login(email="omar@manathhomes.ae", password=PW):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def token(email="omar@manathhomes.ae", password=PW):
    signed_in = login(email, password).json()
    if signed_in.get("access_token"):
        return {"Authorization": f"Bearer {signed_in['access_token']}"}

    # Test helpers that need a full HR/admin session finish mandatory enrollment
    # first. Application code never performs this automatically.
    enrollment = signed_in.get("enrollment_token")
    assert enrollment, signed_in
    restricted = {"Authorization": f"Bearer {enrollment}"}
    setup = client.post("/api/auth/2fa/setup", headers=restricted).json()
    secret = setup["secret"]
    enabled = client.post("/api/auth/2fa/enable", headers=restricted,
                          json={"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200, enabled.json()
    challenge = login(email, password).json()["mfa_token"]
    verified = client.post("/api/auth/2fa/verify", json={
        "mfa_token": challenge, "code": next_code(secret),
    }).json()
    return {"Authorization": f"Bearer {verified['access_token']}"}


def enrol(email="omar@manathhomes.ae"):
    """Full enrolment; returns (headers, secret, recovery_codes)."""
    signed_in = login(email).json()
    enrollment_mode = bool(signed_in.get("enrollment_token"))
    credential = signed_in.get("enrollment_token") or signed_in.get("access_token")
    h = {"Authorization": f"Bearer {credential}"}
    setup = client.post("/api/auth/2fa/setup", headers=h).json()
    secret = setup["secret"]
    code = pyotp.TOTP(secret).now()
    out = client.post("/api/auth/2fa/enable", json={"code": code}, headers=h)
    assert out.status_code == 200, out.json()
    if enrollment_mode:
        challenge = login(email).json()["mfa_token"]
        verified = client.post("/api/auth/2fa/verify", json={
            "mfa_token": challenge, "code": next_code(secret),
        })
        assert verified.status_code == 200, verified.json()
        h = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    return h, secret, out.json()["recovery_codes"]


def next_code(secret, steps=1):
    """A code from a later 30s window.

    Enabling 2FA burns the timestep of the confirming code, so the very next code
    generated within the same 30 seconds is a replay and is correctly refused.
    valid_window=1 means a code one step ahead is still accepted, so this gives a
    fresh, valid, non-replayed code without sleeping.
    """
    return pyotp.TOTP(secret).at(time.time() + (T.TOTP_INTERVAL * steps))


def eid(email):
    db = TestSession()
    i = db.query(Employee).filter(Employee.work_email == email).first().id
    db.close()
    return i


# --- setup and enable ------------------------------------------------------
def test_setup_returns_qr_and_uri():
    h = token()
    r = client.post("/api/auth/2fa/setup", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["otpauth_uri"].startswith("otpauth://totp/")
    assert "Manath%20Homes" in d["otpauth_uri"] or "Manath Homes" in d["otpauth_uri"]
    assert len(d["qr_png_base64"]) > 100


def test_setup_alone_does_not_enable():
    h = token()
    client.post("/api/auth/2fa/setup", headers=h)
    assert client.get("/api/auth/2fa/status", headers=h).json()["enabled"] is False
    # login still single-step
    assert login().json()["mfa_required"] is False


def test_enable_requires_a_correct_code():
    h = token()
    client.post("/api/auth/2fa/setup", headers=h)
    r = client.post("/api/auth/2fa/enable", json={"code": "000000"}, headers=h)
    assert r.status_code == 401


def test_enable_issues_recovery_codes_once():
    _, _, codes = enrol()
    assert len(codes) == 8
    assert all("-" in c for c in codes)


def test_cannot_setup_twice_without_disabling():
    h, _, _ = enrol()
    assert client.post("/api/auth/2fa/setup", headers=h).status_code == 409


# --- two-step login --------------------------------------------------------
def test_login_returns_mfa_token_not_access_token():
    enrol()
    r = login().json()
    assert r["mfa_required"] is True
    assert r["access_token"] == ""
    assert r["mfa_token"]


def test_mfa_token_cannot_be_used_as_an_access_token():
    """The whole point of a separate token type."""
    enrol()
    mfa = login().json()["mfa_token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {mfa}"})
    assert r.status_code == 401


def test_verify_exchanges_code_for_real_tokens():
    _, secret, _ = enrol()
    mfa = login().json()["mfa_token"]
    r = client.post("/api/auth/2fa/verify",
                    json={"mfa_token": mfa, "code": next_code(secret)})
    assert r.status_code == 200
    assert r.json()["access_token"]
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200


def test_wrong_code_rejected_at_verify():
    enrol()
    mfa = login().json()["mfa_token"]
    r = client.post("/api/auth/2fa/verify", json={"mfa_token": mfa, "code": "000000"})
    assert r.status_code == 401


def test_password_alone_no_longer_grants_access():
    enrol()
    assert login().json()["access_token"] == ""


# --- replay protection -----------------------------------------------------
def test_the_same_code_cannot_be_used_twice():
    """A code is valid for 30 seconds; without this guard it works repeatedly."""
    _, secret, _ = enrol()
    code = next_code(secret)

    first = client.post("/api/auth/2fa/verify",
                        json={"mfa_token": login().json()["mfa_token"], "code": code})
    assert first.status_code == 200

    second = client.post("/api/auth/2fa/verify",
                         json={"mfa_token": login().json()["mfa_token"], "code": code})
    assert second.status_code == 401
    assert "already been used" in second.json()["detail"].lower()


def test_verify_code_unit_blocks_replayed_timestep():
    secret = T.new_secret()
    now = time.time()
    code = pyotp.TOTP(secret).at(now)
    first = T.verify_code(secret, code, None, at=now)
    assert first.ok
    again = T.verify_code(secret, code, first.timestep, at=now)
    assert not again.ok


def test_non_numeric_code_rejected_cleanly():
    secret = T.new_secret()
    r = T.verify_code(secret, "abcdef", None)
    assert not r.ok and "6-digit" in r.reason


# --- recovery codes --------------------------------------------------------
def test_recovery_code_works_when_phone_is_lost():
    _, _, codes = enrol()
    r = client.post("/api/auth/2fa/verify",
                    json={"mfa_token": login().json()["mfa_token"], "code": codes[0]})
    assert r.status_code == 200


def test_recovery_code_is_single_use():
    _, _, codes = enrol()
    client.post("/api/auth/2fa/verify",
                json={"mfa_token": login().json()["mfa_token"], "code": codes[0]})
    again = client.post("/api/auth/2fa/verify",
                        json={"mfa_token": login().json()["mfa_token"], "code": codes[0]})
    assert again.status_code == 401


def test_recovery_codes_are_not_stored_in_plaintext():
    _, _, codes = enrol()
    db = TestSession()
    stored = [r.code_hash for r in db.query(RecoveryCode).all()]
    db.close()
    for c in codes:
        assert c not in stored
    assert all(len(h) == 64 for h in stored)


def test_recovery_code_accepted_in_any_case_or_spacing():
    _, _, codes = enrol()
    messy = f"  {codes[0].lower().replace('-', ' ')}  "
    r = client.post("/api/auth/2fa/verify",
                    json={"mfa_token": login().json()["mfa_token"], "code": messy})
    assert r.status_code == 200


def test_status_warns_when_recovery_codes_run_low():
    h, secret, codes = enrol()
    for c in codes[:6]:
        client.post("/api/auth/2fa/verify",
                    json={"mfa_token": login().json()["mfa_token"], "code": c})
    st = client.get("/api/auth/2fa/status", headers=h).json()
    assert st["recovery_codes_remaining"] == 2
    assert st["low_recovery_codes"] is True


def test_regenerating_invalidates_old_codes():
    h, secret, old = enrol()
    r = client.post("/api/auth/2fa/recovery/regenerate",
                    json={"code": next_code(secret)}, headers=h)
    assert r.status_code == 200
    new = r.json()["recovery_codes"]
    assert set(new).isdisjoint(set(old))
    dead = client.post("/api/auth/2fa/verify",
                       json={"mfa_token": login().json()["mfa_token"], "code": old[0]})
    assert dead.status_code == 401


# --- self-service password reset ------------------------------------------
def test_reset_own_password_with_authenticator_code():
    _, secret, _ = enrol()
    r = client.post("/api/auth/password/self-reset", json={
        "work_email": "omar@manathhomes.ae", "code": next_code(secret),
        "new_password": "MyBrandNewPass-2026!"})
    assert r.status_code == 200, r.json()
    after = client.post("/api/auth/login", data={"username": "omar@manathhomes.ae",
                                                 "password": "MyBrandNewPass-2026!"})
    assert after.status_code == 200
    assert after.json()["mfa_required"] is True


def test_self_reset_revokes_existing_sessions():
    """Uses a recovery code for the reset: two TOTP codes can't be spent inside
    the same 30-second window, which is the replay guard behaving correctly."""
    _, secret, codes = enrol()
    mfa = login().json()["mfa_token"]
    tokens = client.post("/api/auth/2fa/verify",
                         json={"mfa_token": mfa, "code": next_code(secret)}).json()
    reset = client.post("/api/auth/password/self-reset", json={
        "work_email": "omar@manathhomes.ae", "code": codes[0],
        "new_password": "MyBrandNewPass-2026!"})
    assert reset.status_code == 200, reset.json()
    r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


def test_self_reset_with_wrong_code_fails():
    enrol()
    r = client.post("/api/auth/password/self-reset", json={
        "work_email": "omar@manathhomes.ae", "code": "000000",
        "new_password": "MyBrandNewPass-2026!"})
    assert r.status_code == 401
    assert client.post("/api/auth/login",
                       data={"username": "omar@manathhomes.ae",
                             "password": PW}).status_code == 200


def test_self_reset_does_not_leak_whether_an_account_exists():
    enrol()
    unknown = client.post("/api/auth/password/self-reset", json={
        "work_email": "nobody@manathhomes.ae", "code": "000000",
        "new_password": "MyBrandNewPass-2026!"})
    no_2fa = client.post("/api/auth/password/self-reset", json={
        "work_email": "layla@manathhomes.ae", "code": "000000",
        "new_password": "MyBrandNewPass-2026!"})
    assert unknown.status_code == no_2fa.status_code == 401
    assert unknown.json()["detail"] == no_2fa.json()["detail"]


def test_self_reset_unavailable_without_2fa():
    r = client.post("/api/auth/password/self-reset", json={
        "work_email": "layla@manathhomes.ae", "code": "123456",
        "new_password": "MyBrandNewPass-2026!"})
    assert r.status_code == 401


# --- disable and admin removal --------------------------------------------
def test_disable_needs_password_and_code():
    h, secret, _ = enrol()
    bad = client.post("/api/auth/2fa/disable", headers=h,
                      json={"current_password": "wrong", "code": next_code(secret)})
    assert bad.status_code == 400
    good = client.post("/api/auth/2fa/disable", headers=h,
                       json={"current_password": PW, "code": next_code(secret)})
    assert good.status_code == 200
    assert login().json()["mfa_required"] is False


def test_hr_and_admin_cannot_disable_their_own_2fa():
    h, secret, _ = enrol("hr@manathhomes.ae")
    r = client.post("/api/auth/2fa/disable", headers=h,
                    json={"current_password": PW, "code": next_code(secret)})
    assert r.status_code == 403


def test_admin_removes_2fa_for_a_lost_phone():
    enrol()
    r = client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/2fa/remove",
                    headers=token("admin@manathhomes.ae"))
    assert r.status_code == 200
    after = login().json()
    assert after["mfa_required"] is False
    assert after["must_change_password"] is True


def test_admin_2fa_removal_is_audited():
    enrol()
    client.post(f"/api/auth/employees/{eid('omar@manathhomes.ae')}/2fa/remove",
                headers=token("admin@manathhomes.ae"))
    from app.models.core import AuditLog
    db = TestSession()
    actions = {a.action for a in db.query(AuditLog).all()}
    db.close()
    assert "2fa.removed_by_admin" in actions


def test_hr_cannot_remove_2fa_from_an_admin():
    enrol("admin@manathhomes.ae")
    r = client.post(f"/api/auth/employees/{eid('admin@manathhomes.ae')}/2fa/remove",
                    headers=token("hr@manathhomes.ae"))
    assert r.status_code == 403


# --- secret storage --------------------------------------------------------
def test_secret_is_encrypted_at_rest():
    _, secret, _ = enrol()
    db = TestSession()
    stored = db.query(Employee).filter(
        Employee.work_email == "omar@manathhomes.ae").first().totp_secret_encrypted
    db.close()
    assert secret not in stored
    assert T.decrypt_secret(stored) == secret


def test_role_requiring_2fa_is_flagged_at_login():
    r = login("hr@manathhomes.ae").json()
    assert r["must_enrol_2fa"] is True
    assert r["access_token"] == ""
    assert r["refresh_token"] == ""
    assert r["enrollment_token"]
    assert login("omar@manathhomes.ae").json()["must_enrol_2fa"] is False


def test_enrollment_token_cannot_access_normal_apis_and_expires_after_use():
    signed_in = login("hr@manathhomes.ae").json()
    h = {"Authorization": f"Bearer {signed_in['enrollment_token']}"}
    assert client.get("/api/auth/me", headers=h).status_code == 401

    setup = client.post("/api/auth/2fa/setup", headers=h)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    enabled = client.post("/api/auth/2fa/enable", headers=h,
                          json={"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200

    # Enrollment credentials are one-purpose: once 2FA is enabled they cannot
    # be reused, even on another approved enrollment endpoint.
    assert client.get("/api/auth/2fa/status", headers=h).status_code == 401


def test_tampered_and_expired_enrollment_tokens_are_rejected():
    valid = login("hr@manathhomes.ae").json()["enrollment_token"]
    tampered = valid[:-1] + ("A" if valid[-1] != "A" else "B")
    assert client.get("/api/auth/2fa/status", headers={
        "Authorization": f"Bearer {tampered}",
    }).status_code == 401

    now = datetime.now(timezone.utc)
    expired = jwt.encode({
        "sub": str(eid("hr@manathhomes.ae")), "role": "hr",
        "type": "2fa_enrollment", "iat": now - timedelta(minutes=10),
        "exp": now - timedelta(minutes=5),
    }, settings.JWT_SECRET, algorithm=settings.JWT_ALG)
    assert client.get("/api/auth/2fa/status", headers={
        "Authorization": f"Bearer {expired}",
    }).status_code == 401


# --- company domain restriction -------------------------------------------
def test_personal_email_cannot_be_provisioned():
    r = client.post("/api/auth/employees", headers=token("admin@manathhomes.ae"), json={
        "employee_code": "EMP-500", "full_name": "Outside Person",
        "work_email": "someone@gmail.com", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"})
    assert r.status_code == 422
    assert "manathhomes.ae" in r.json()["detail"]


def test_company_email_is_accepted():
    r = client.post("/api/auth/employees", headers=token("admin@manathhomes.ae"), json={
        "employee_code": "EMP-501", "full_name": "Inside Person",
        "work_email": "inside@manathhomes.ae", "temporary_password": "TempPass-2026-x!",
        "date_of_joining": "2026-08-01"})
    assert r.status_code == 201


def test_domain_check_is_case_insensitive():
    assert settings.email_allowed("Person@ManathHomes.AE") is True
    assert settings.email_allowed("person@manathhomes.ae.evil.com") is False
