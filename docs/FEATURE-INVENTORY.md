# Verified feature inventory

## HRMS

- Employee provisioning, directory, account state and manager relationships.
- Password enforcement, refresh-token rotation, TOTP and recovery codes.
- Biometric consent, encrypted face templates and face-only attendance.
- Geofenced attendance, offline synchronization, review queues and daily records.
- Locations, assignments, roles, permission matrices and audit history.
- Leave policies, balances, requests, approvals, holidays and team calendar.
- Onboarding/offboarding checklists, document expiry and final settlement support.
- Hardened document storage with content inspection and authorization.

## Sales and CRM

- Leads, contacts, accounts, opportunities, products and pipelines.
- Activities, tasks, follow-ups, targets and smart views.
- Calls, consent, recordings, transcripts, AI analysis and call audits.
- Events, campaigns, qualifications, scripts and talking points.
- Field sales, service, forms, landing pages and communications placeholders.
- Dashboards, reports, audit logs, notifications and retention jobs.
- Session and API-key authentication, RBAC scopes and field-security utilities.
- Redis-backed rate limiting, queues, automation and distribution workers.
- Calendar, WhatsApp and telephony provider abstractions.

## Shared candidates

Company, user, membership, manager hierarchy, role catalogue, permissions,
sessions, TOTP, audit events, notifications, storage, integrations and entitlement
checks must move to the platform layer. Payroll and tax are not currently present.
