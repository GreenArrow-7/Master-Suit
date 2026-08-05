# Release notes — HRMS 28/28 functional baseline

Tag: `hrms-28of28-baseline`
Milestone: Pre-Production Hardening and UAT

## Status

The HRMS functional migration is **code-complete**: all 28 rows of
`docs/FUNCTIONAL-PRESERVATION-MATRIX.md` are implemented and covered by
automated checks.

**This release is not production-ready.** It is a baseline for hardening and
user-acceptance testing. See `docs/KNOWN-LIMITATIONS.md` for the full list and
the assessment at the end of these notes.

## What is included

Attendance with server-side face verification and geofencing; leave with
accrual, balances and an approval chain; employee lifecycle from onboarding
checklist to gated exit and UAE final settlement; work locations with temporary
sites and attendance exceptions; employee documents with malware scanning;
identity administration including password lifecycle, TOTP, roles, the
permission matrix and effective-dated role assignment; a workspace-editable HR
policy covering all 30 tunable parameters; and an audit log spanning every
domain.

## What is NOT included

### Payroll is out of scope

**This product does not calculate or pay anyone.** Specifically excluded:

- payroll calculation of any kind
- statutory and contractual deductions
- payslip generation or distribution
- salary disbursement, bank files, and UAE **WPS SIF export**
- tax and end-of-year payroll reporting
- pension, gratuity *payment* (the system calculates an indicative final
  settlement figure; it does not pay it)

No placeholder payroll screens, routes, models or menu items exist, and none
should be added to imply otherwise. The final-settlement calculation in the
lifecycle module is **indicative only** — it is a figure for a human to check
against the signed MOHRE contract before any payment is made, and the product
states this on screen.

Any customer expecting payroll needs either a separate payroll product or a new
project with its own scope, legal review and testing.

### Other exclusions

- Commission tracking and agent KPIs (absent from the original system too).
- Biometric device ingestion from dedicated hardware terminals.
- Rich HR analytics beyond the dashboards described in the matrix.
- External billing: plans and limits are enforced, but no payment provider is
  connected.

## Release blockers addressed in this milestone

| Blocker | Status |
|---|---|
| Mock-only antivirus | **Resolved in code.** ClamAV integration, quarantine-until-clean, download gated on CLEAN, fails closed, records provider/timestamp/signature. Mock retained for tests only and blocked in production by the env schema. |
| `/auth/refresh` not used by the client | **Resolved in code.** Single-flight refresh, one retry, auth state cleared on failure, no token in `localStorage`. |
| Real-device validation | **Checklist prepared, zero devices tested.** |
| Real-staff biometric trial | **Protocol prepared, no human has been through it.** |
| Payroll scope | **Stated above.** |
| Role-based UAT | **Matrix prepared, not executed as a UAT pass.** |
| Operational readiness | **Checklist prepared, nothing rehearsed.** |

## Readiness assessment

**Pilot with a friendly customer: conditionally suitable**, provided that

1. the real-staff biometric trial is completed first, or face check-in is
   disabled and the non-biometric alternative used;
2. a real malware scanner is deployed and monitored — with `ANTIVIRUS_PROVIDER`
   unset or `mock`, document uploads fail closed and are unusable;
3. backups are configured **and a restore has been rehearsed**;
4. someone is on call, because there is currently no alerting.

**Full production: not suitable.** The blocking gaps are the untested biometric
pipeline, the absence of monitoring and alerting, unrehearsed backup/restore,
and no incident-response or breach-notification procedure.
