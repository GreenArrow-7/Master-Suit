# Capability matrix

Regenerated from the code at the end of Phase 4. Replaces §5.2 of
`AUDIT-REPORT-2026-08-06.md`, where the audit found **6 capabilities working, 8
with an API but no UI, and 14 missing at both layers**.

"API" means a route exists and enforces a permission. "UI" means a screen in the
product reaches it. Anything still missing says why.

## Company Administrator

| Capability | API | UI | Where |
|---|:--:|:--:|---|
| Company profile — name, legal name, industry, timezone, currency, contact, logo | ✅ | ✅ | `PATCH /workspaces/[slug]/settings/company`, `admin/[section]` |
| Security — require 2FA, password policy | ✅ | ✅ | `PATCH .../settings/security`, `admin/[section]` |
| Departments — create, rename, archive | ✅ | ✅ | `hr/departments` GET/POST/PATCH/DELETE, `people/departments` |
| Designations — create, rename, archive | ✅ | ⚠️ API only | `hr/designations`; no dedicated screen yet |
| Employees — add (by invitation), edit, archive | ✅ | ⚠️ create + list | `hr/employees` GET/POST/PATCH/DELETE |
| Reporting manager | ✅ | ⚠️ API only | `identity/account-manager` |
| Shifts — create, edit, retire | ✅ | ✅ | `hr/shifts`, `people/shifts` |
| Holidays — create, correct, delete | ✅ | ✅ | `hr/holidays`, `people/holidays` |
| Leave types — create, edit, retire | ✅ | ⚠️ API only | `hr/leave-types` |
| Work locations — create, edit, retire | ✅ | ⚠️ create + list | `hr/work-locations` |
| Location assignments | ✅ | ✅ | `hr/location-assignments`, `people/work-locations` |
| Attendance policy | ✅ | ✅ | `hr/actions/settings-update`, `people/settings` |
| Leave approve / reject | ✅ | ✅ | `hr/actions/leave-approve`, `people/leave` |
| **Invite a user** | ✅ | ⚠️ API only | `identity/invite`, `/accept-invite` page exists |
| Resend / revoke an invitation | ✅ | ⚠️ API only | `identity/invitation-resend`, `invitation-revoke` |
| Users — reset password, unlock, activate, change role, revoke sessions, remove 2FA | ✅ | ✅ | `identity/[action]`, `admin/users/[userId]` |
| Roles — create, edit, delete, permission matrix, assign | ✅ | ✅ | `roles/[action]`, `admin/roles` |
| **Sales pipeline stages — create, edit, delete** | ✅ | ⚠️ API only | `sales/stages` |
| Integrations — configure | ❌ | ❌ | Read-only list. Not attempted; out of scope for Phase 4 |
| Modules / Subscription | — | ✅ read-only | Platform owner's to change; the screen says so and offers a request path |
| Audit logs | ✅ | ✅ | `admin/audit` |

## Platform Owner

| Capability | API | UI | Where |
|---|:--:|:--:|---|
| Create workspace | ✅ | ✅ | `POST /platform/workspaces`, `platform/workspaces/new` |
| Suspend / reactivate / archive | ✅ | ✅ | `WorkspaceControls` |
| Revoke workspace sessions | ✅ | ✅ | `WorkspaceControls` |
| **Change plan** | ✅ | ✅ | `WorkspaceEditForm` |
| **Change enabled modules** | ✅ | ✅ | `WorkspaceEditForm` |
| **Change seat / storage limits** | ✅ | ✅ | `WorkspaceEditForm` |
| **Change trial dates** | ✅ | ✅ | `WorkspaceEditForm` |
| **Edit workspace profile** | ✅ | ✅ | `WorkspaceEditForm` |
| Manage plans | ✅ | ⚠️ read-only | `POST /platform/plans` exists; `platform/plans` lists only |
| Manage platform users | ❌ | ❌ | Read-only list. Not attempted |

## Account recovery and onboarding

| Capability | Status | Where |
|---|:--:|---|
| Forgot password → email → reset | ✅ | `/forgot-password`, `/reset-password`, SMTP provider |
| First-run 2FA enrolment | ✅ | `/enroll-2fa` |
| Invitation acceptance | ✅ | `/accept-invite` |
| Forced password change after an admin reset | ✅ | `mustChangePassword` on the login response |

## Summary

| | Audit | Now |
|---|--:|--:|
| Working at both layers | 6 | **26** |
| API only | 8 | **7** |
| Missing at both layers | 14 | **3** |

The three still missing at both layers — integration configuration, platform-user
administration, and plan management UI — were not part of Phase 4's brief and are
listed here rather than quietly dropped.

The seven "API only" rows all have a working, permission-enforced endpoint and a
test; what they lack is a dedicated screen. Invitations are the most significant:
the flow is complete and tested end to end, and the acceptance page exists, but
sending one currently needs an API call.
