# Security remediation register

## Completed in this integration workspace

- HR/admin mandatory 2FA returns only a short-lived `2fa_enrollment` credential.
- Normal HRMS APIs reject enrollment credentials; setup/status/enable alone accept them.
- Enrollment credentials expire cryptographically and become invalid after enrollment.
- Telephony mock verification no longer accepts HTTP callbacks.
- Telephony callbacks require HMAC, freshness, integration identity and webhook ID.
- Call lookup is scoped by tenant, provider and external identifier.
- `Call.externalCallId` was removed from the database guard's global exceptions.
- Production Sales configuration rejects mock providers.
- Forwarded IP headers are ignored unless trusted-proxy mode is explicitly enabled.
- Production CSP no longer contains `unsafe-eval`.

## Release blockers still open

- Replace the two password stores with one platform identity and membership model.
- Complete PostgreSQL RLS policies and ensure every application request uses a
  transaction-local tenant context under a non-`BYPASSRLS` role.
- Convert every HRMS-owned record to a tenant-owned PostgreSQL record.
- Implement server-side HR/Sales module entitlements and subscription enforcement.
- Replace remaining mock email, WhatsApp, AI and antivirus integrations for production.
- Repair aspirational Sales integration tests whose request helper still contains
  unimplemented endpoint stubs and run them against disposable PostgreSQL/Redis.
- Complete dependency vulnerability scans, backup restoration and incident exercises.

No production-readiness claim may be made while any item above remains open.
