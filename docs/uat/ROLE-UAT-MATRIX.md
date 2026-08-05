# Role-based UAT matrix

**Status: NOT EXECUTED as a UAT pass.** Many of the underlying rules are covered
by automated tests (noted per row), but nobody has sat down as each role and
worked through the product. Automated coverage of a rule is not the same as a
human confirming the role behaves correctly in the UI.

## Roles under test

| Role | Rank | Represented by |
|---|---|---|
| Platform Super Admin | — | `PlatformUser.platformRole = OWNER`, control plane at `/platform` |
| Organization Administrator | 10 | `org_admin` / `company_admin` |
| HR Administrator | 10 | ORGANIZATION scope on `hrms` |
| Manager | 50 | `team_manager`, or any role that is a line manager |
| Employee | 60 | `sales_rep` / `employee` |
| Auditor | 45 | `analyst`, or a role holding `auditlogs:VIEW` and little else |

**Note on the model:** HR Administrator is not a separate role key — it is
whoever holds ORGANIZATION scope on `hrms`. In the seeded data that is the same
accounts as Organization Administrator. If the customer needs HR who cannot
administer billing or roles, that is a **new role to create** in
`/{slug}/admin/roles`, and this matrix should be re-run against it.

## A. Allowed actions

| ID | Role | Action | Expected | Auto-covered | Result | Evidence |
|---|---|---|---|---|---|---|
| A1 | Super Admin | Create a workspace, set plan and limits | Succeeds | `integration/unified-saas` | | |
| A2 | Org Admin | Create a department and an employee | Succeeds | `integration/unified-saas` | | |
| A3 | HR Admin | Approve leave, run carry-forward | Succeeds | — | | |
| A4 | HR Admin | Upload and download a document | Succeeds | manual smoke (deleted) | | |
| A5 | HR Admin | Enrol an employee's face | Succeeds | — | | |
| A6 | Manager | Approve leave for a direct report | Succeeds | — | | |
| A7 | Manager | Endorse an attendance exception for a report | Succeeds | manual smoke (deleted) | | |
| A8 | Employee | Apply for leave, check in, view own documents | Succeeds | — | | |
| A9 | Employee | Change own password, enrol own 2FA | Succeeds | manual smoke (deleted) | | |
| A10 | Auditor | View the audit log | Succeeds | — | | |

## B. Denied actions — the rows that matter

| ID | Role | Action | Expected | Auto-covered | Result | Evidence |
|---|---|---|---|---|---|---|
| B1 | Org Admin | Create a platform workspace | **403** | `integration/unified-saas` | | |
| B2 | Employee | Reset another employee's password | **403** | manual smoke (deleted) | | |
| B3 | Employee | View a colleague's document | **404**, not 403 | manual smoke (deleted) | | |
| B4 | Employee | List all leave requests | Own only | `[resource]` route scoping | | |
| B5 | Manager | Decide the HR stage of an exception | **403** | manual smoke (deleted) | | |
| B6 | Manager | Approve their own leave | **403** | — | | |
| B7 | HR Admin | Administer an account at or above their own rank | **403** | manual smoke (deleted) | | |
| B8 | HR Admin | Grant a permission scope wider than their own | **403** | manual smoke (deleted) | | |
| B9 | Org Admin | Edit their own role | **403** | manual smoke (deleted) | | |
| B10 | Auditor | Change any HR record | **403** | — | | |
| B11 | Employee | Reach `/admin/roles` or `/people/settings` | Read-only or refused | — | | |
| B12 | Any | Download a document that has not cleared malware scanning | **409** | `hr/antivirus` + manual smoke | | |

## C. Object ownership

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| C1 | Employee sees only their own leave, attendance, documents, exceptions | Own records only | | |
| C2 | Manager sees their reports' exceptions but not another manager's team | Reporting line only | | |
| C3 | Approver sees leave assigned to them plus their own | Both, nothing else | | |
| C4 | Nobody can approve or decide their own request | Refused in every workflow | | |

## D. Organization isolation

| ID | Scenario | Expected | Auto-covered | Result | Evidence |
|---|---|---|---|---|---|
| D1 | Workspace A admin reads workspace B's employees | **404** | `integration/unified-saas`, `tenant/isolation` | | |
| D2 | Cross-tenant row visible under RLS as `master_saas_app` | Zero rows | `tenant/rls` | | |
| D3 | Cross-tenant insert with a foreign tenantId | Refused by `WITH CHECK` | `tenant/rls` | | |
| D4 | A user in two workspaces switches between them | Sees only the active workspace's data | | |
| D5 | Document storage keys are tenant-sharded | `clean/t-{tenantId}/…` | manual smoke (deleted) | | |

## E. Document access

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| E1 | HR downloads any employee's document | Succeeds, one audit row | | |
| E2 | Employee downloads their own | Succeeds, one audit row | | |
| E3 | Colleague attempts the same document | 404 | | |
| E4 | Download while `scanStatus = PENDING` | 409 | | |
| E5 | Download after an INFECTED verdict | 409, bytes already destroyed | | |
| E6 | Every download appears in the audit log with the reader's name | Yes | | |

## F. Session revocation

| ID | Scenario | Expected | Auto-covered | Result | Evidence |
|---|---|---|---|---|---|
| F1 | Password reset by admin | All target sessions revoked | manual smoke (deleted) | | |
| F2 | Role change | Target's sessions revoked | — | | |
| F3 | Permission-matrix change | Everyone on the role signed out | — | | |
| F4 | Account suspended | Sessions revoked immediately | manual smoke (deleted) | | |
| F5 | Employee exit finalised | Sessions revoked, biometrics withdrawn | phase-1 smoke (deleted) | | |
| F6 | `logout-all` | Every device including the caller | `integration/session-lifecycle` | | |
| F7 | Replayed rotated token | Every session for the account revoked | `integration/session-lifecycle` | | |

## G. Audit-event accuracy

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| G1 | Each action in A and B produces exactly one audit row | No duplicates, no gaps | | |
| G2 | The actor recorded is the person who acted, not the subject | Correct attribution | | |
| G3 | Refusals are recorded, not only successes | Present | | |
| G4 | Audit rows carry the specific domain action, not just RECORD_UPDATED | Present | | |
| G5 | No secret ever appears in an audit row | Confirmed by inspection | | |

## Method

For each row: sign in genuinely as that role (not by editing the database),
attempt the action through the UI, record the observed result and attach
evidence. **Where the expected result is a refusal, confirm the message is
usable** — a correct 403 with an unintelligible message still generates a
support call.

| Role | Name | Date | Signature |
|---|---|---|---|
| UAT lead | | | |
| Security reviewer | | | |
