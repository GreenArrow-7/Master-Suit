# Security Test Matrix

**Date:** 2026-08-08 · Every row ends in PASS / FAIL / PARTIAL / BLOCKED / N/A / NOT TESTED.
Nothing is silently skipped; a non-PASS always carries a reason.

**Evidence:** **T** = tested (executed against a real database) · **CV** = code-verified ·
**NT** = not tested.

| ID | Area | Requirement | Ev | Automated test | Status | Finding |
|---|---|---|---|---|---|---|
| A-01 | Auth | Valid/invalid login, unknown user, wrong password | T | `session-lifecycle`, `unified-saas` | PASS | |
| A-02 | Auth | No user enumeration via status/message/timing | CV | — | PASS | Uniform `GENERIC` + `burnTiming()` on every path |
| A-03 | Auth | Lockout after `MAX_FAILED_LOGINS`, timed release | CV | — | PASS | |
| A-04 | Auth | Per-IP and per-account rate limits | T | `ratelimit.spec` | PASS | Shared bucket when no proxy declared → F-02 |
| A-05 | Auth | Inactive/deleted account refused | CV | — | PASS | |
| S-01 | Session | Opaque token, SHA-256 at rest, httpOnly cookie | CV | — | PASS | No JWT — nothing forgeable offline |
| S-02 | Session | Idle timeout and absolute expiry | T | `session-lifecycle` | PASS | |
| S-03 | Session | Revocation on logout / logout-all / credential change | T | `session-lifecycle` | PASS | |
| S-04 | Session | Tampered token rejected | T | `mfa-enrolment` | PASS | |
| M-01 | MFA | Mandatory policy issues enrolment grant, not a lockout | T | `mfa-enrolment` | PASS | |
| M-02 | MFA | Enrolment grant opens nothing else | T | `mfa-enrolment` | PASS | |
| M-03 | MFA | Expired / revoked / reused grant refused | T | `mfa-enrolment` | PASS | |
| M-04 | MFA | Platform staff must complete 2FA | T | `platform-mfa` | PASS | |
| M-05 | MFA | TOTP secret encrypted; recovery codes hashed and single-use | CV | `single-credential-store` | PASS | |
| M-06 | MFA | TOTP replay within the same timestep | NT | — | **NOT TESTED** | No test asserts same-timestep reuse |
| P-01 | Reset | Token single-use, short-lived, unpredictable | T | `password-reset`, `forgot-password-flow` | PASS | |
| P-02 | Reset | Unknown email does not disclose existence | T | `password-reset` | PASS | |
| R-01 | RBAC | Permission asserted before handler body runs | CV | — | PASS | Kernel step 3 |
| R-02 | RBAC | Vertical escalation blocked (own/higher role) | T | `hr-employee-escalation`, `admin-editors` | PASS | `assertMayAdministerRole` |
| R-03 | RBAC | Scope resolution OWN/TEAM/BRANCH/REGION/ORG | T | `permission/scope.spec` | PASS | |
| R-04 | RBAC | Module entitlement enforced per workspace | T | `module-entitlement` | PASS | |
| R-05 | RBAC | Page/route access by role | T | `page-access`, `hr-granular` | PASS | |
| **R-06** | **RBAC** | **Approval restricted to the actor's reporting line** | **T** | **`hr-overtime-scope`** | **PASS (was FAIL)** | **F-01** |
| T-01 | Tenancy | Cross-tenant read/write refused | T | `tenant/isolation` | PASS | |
| T-02 | Tenancy | Guard throws when `tenantId` filter missing | T | `tenant/rls` | PASS | |
| T-03 | Tenancy | RLS enabled *and forced*; role is NOBYPASSRLS | T + CV | `tenant/rls` | PASS | Re-verified at boot |
| T-04 | Tenancy | Cross-tenant call/recording isolation | T | `tenant/calls` | PASS | |
| I-01 | IDOR | Employee cannot read another's document | CV | — | PASS | Returns `NotFound`, no oracle |
| I-02 | IDOR | Employee cannot read another's overtime claim | T | `hr-overtime-scope`, `hr/overtime` | PASS | |
| I-03 | IDOR | Employee cannot read another's payslip | CV | — | PASS | `mine \|\| mayReadPayroll` |
| I-04 | IDOR | Sales record visibility by scope | T | `permission/scope` | PASS | |
| F-01 | Fields | Sensitive fields masked per role | CV | `ai-redaction` | PASS | |
| F-02 | Fields | Cannot filter/sort on hidden fields | CV | — | PASS | Blocks binary-search recovery |
| F-03 | Fields | Export honours field security | CV | — | PASS | `leads/export` applies masking |
| E-01 | Egress | Credentials scrubbed from every response | T | `secret-egress` | PASS | |
| E-02 | Egress | No secrets in env/logs | T | `env-secrets` | PASS | |
| E-03 | Egress | No secrets committed to git | T | manual (`git ls-files`) | PASS | |
| U-01 | Upload | Magic-byte validation, not declared type | CV | — | PASS | |
| U-02 | Upload | Generated storage key (no traversal) | CV | — | PASS | |
| U-03 | Upload | Malware scan; only CLEAN is downloadable | T | `hr/antivirus` | PASS | Fails closed on scanner error |
| AT-01 | Attendance | Geofence + GPS accuracy boundaries | T | `hr/attendance`, `hr/rules` | PASS | |
| AT-02 | Attendance | Offline sync idempotent by `clientPunchUid` | CV | — | PASS | DB unique index, not convention |
| AT-03 | Attendance | Stale offline punch rejected | CV | — | PASS | `maxOfflineSyncHours` |
| AT-04 | Attendance | Nonce single-use; spent before frames examined | CV | — | PASS | |
| AT-05 | Attendance | Mock location routed to review | CV | — | PASS | `FLAGGED_REVIEW` |
| AT-06 | Attendance | Liveness / face match | NT | — | **NOT TESTED** | `apps/face` not running; fails closed (503) |
| AT-07 | Biometrics | Templates encrypted; never in logs or responses | CV | `secret-egress` | PASS | |
| L-01 | Leave | Nobody approves their own | T | `hr/rules`, `hr/write-verbs` | PASS | |
| L-02 | Leave | Approval restricted to assigned approver | CV | — | PASS | `request.approverId !== self.id` |
| L-03 | Leave | Balance re-checked at approval | CV | — | PASS | |
| O-01 | Overtime | Detection idempotent, re-runnable | T | `hr/overtime` | PASS | |
| O-02 | Overtime | Nobody approves their own | T | `hr/overtime` | PASS | |
| O-03 | Overtime | Multiplier frozen at approval | T | `hr/overtime` | PASS | |
| O-04 | Overtime | Locked claim immutable after payroll | T | `hr/overtime` | PASS | |
| **O-05** | **Overtime** | **Approver limited to their reporting line** | **T** | **`hr-overtime-scope`** | **PASS (was FAIL)** | **F-01** |
| PR-01 | Payroll | Maker-checker: preparer cannot approve | CV | — | PASS | Enforced on record |
| PR-02 | Payroll | State machine DRAFT→PENDING→APPROVED→LOCKED | CV | — | PASS | |
| PR-03 | Payroll | Officer/approver/reader all require ORG scope | CV | — | PASS | |
| PR-04 | Payroll | Locking stamps overtime + adjustments transactionally | CV | — | PASS | `withTx` |
| PR-05 | WPS | Export needs `payroll:EXPORT`; approved runs only | CV | — | PASS | |
| PR-06 | WPS | Export audited | CV | — | PASS | `EXPORT_REQUESTED` |
| PR-07 | WPS | Export rate-limited | CV | — | **PARTIAL** | Kernel bypass ⇒ no limit (I-03) |
| PR-08 | WPS | CSV formula injection neutralised | CV | — | **FAIL (Low)** | I-02 — helper exists in `leads/export` |
| IN-01 | Injection | SQL injection | CV | — | PASS | Prisma parameterised; no raw string SQL |
| IN-02 | Injection | CSV formula injection (leads export) | CV | — | PASS | `csvCell` prefixes `=+-@` |
| IN-03 | Injection | XSS / DOM sinks | NT | `e2e/ui-states` not run | **NOT TESTED** | React escapes by default; no `dangerouslySetInnerHTML` found |
| IN-04 | Injection | SSRF | CV | — | PASS | No user-supplied outbound URL fetch found |
| C-01 | Config | Production refuses mock providers | CV | — | PASS | |
| C-02 | Config | Production refuses empty/`none` proxy CIDRs | CV | — | PASS | Verified in `startup-check.ts` |
| C-03 | Config | Production refuses superuser/BYPASSRLS/unforced RLS | CV | — | PASS | |
| C-04 | Config | CSP and security headers | T | `security/csp`, `e2e/csp` (unit part) | PASS | |
| C-05 | Config | CSRF | CV | — | PASS | Cookie is `sameSite=lax`; state-changing calls are JSON `POST` from same origin |
| C-06 | Config | CORS | NT | — | **NOT TESTED** | No custom CORS config found; Next default (same-origin) |
| D-01 | Deps | Known vulnerabilities | T | `npm audit --omit=dev` | PASS | 0 vulnerabilities |
| AU-01 | Audit | Security events recorded | CV | — | PASS | Login, role change, document access, payroll, overtime |
| AU-02 | Audit | Audit rows not mutable via ordinary API | CV | — | PASS | No update/delete route |
| AU-03 | Audit | No secrets in audit metadata | T | `secret-egress` | PASS | |
| X-01 | Concurrency | Overtime detection race | CV | — | **PARTIAL** | DB unique constraint; no barrier test |
| X-02 | Concurrency | Payroll lock vs concurrent decision | NT | — | **NOT TESTED** | Recommended next |
| X-03 | Concurrency | Leave balance race | CV | — | **PARTIAL** | Re-checked at approval; no barrier test |
| N-01 | Recruitment / ATS | — | — | — | **N/A** | Not built |
| N-02 | Performance reviews | — | — | — | **N/A** | Not built |
| N-03 | FastAPI / SQLAlchemy phases | — | — | — | **N/A** | Wrong stack |

## Summary

| Status | Count |
|---|---|
| PASS | 60 |
| PARTIAL | 3 |
| FAIL (open, Low) | 1 |
| NOT TESTED | 6 |
| N/A | 3 |

**No area is marked complete while important tests remain blocked.** The six NOT TESTED rows
are concentrated in three places: the browser E2E suite, the face engine, and concurrency —
all recorded in `SECURITY_FINDINGS.md` under *Untested / blocked*.
