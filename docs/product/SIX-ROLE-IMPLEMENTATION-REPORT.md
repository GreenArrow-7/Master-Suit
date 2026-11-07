# Six business roles: implementation report

Branch `simplify/six-roles-audit`, cut from `main` at `babbaa06`. Seven
commits, no rebuild, no new dependency, no schema change, no migration.

The design and the current-state audit are in
[`SIX-ROLE-SIMPLIFICATION.md`](SIX-ROLE-SIMPLIFICATION.md); this is what was
built against it.

---

## 1. The six-role matrix

`A`=ORGANIZATION, `T`=TEAM, `O`=OWN. Everything not listed is withheld, and
withheld means refused.

| Role | Key | Rank | Scope | Reaches | Deliberately cannot |
| --- | --- | --- | --- | --- | --- |
| Company Administrator | `company_admin` | 10 | A | The whole catalogue — unchanged, created by `createWorkspace.ts` | Bypass entitlement, tenant isolation, audit or the record-level approval controls |
| Sales Manager | `sales_manager` | 30 | T | Leads with assignment and import, pipeline, calls with AI coaching and review, visits, targets, reports; inventory read-only at A | Approve pool allocation; any money module; users, roles, settings, integrations |
| HR Administrator | `hr_administrator` | 35 | A | Employees, departments, attendance, leave, shifts, overtime, holidays, documents, recruitment, performance, **payroll preparation** | Approve payroll; decide recruitment offers; read salary; reach any sales or money module |
| Real Estate Operations | `realestate_ops` | 40 | A | Projects, listings, bookings, visits with approval, requirements, events, reports; collection and commission **status** | Approve collections or commissions; any payout or agency fee; payroll |
| Sales Agent | `sales_agent` | 50 | O | Their own leads, contacts, opportunities, tasks, calls, **dialer**, visits, requirements, documents | Assign, reassign, bulk-update, import or export leads; any administrative or money module |
| Employee | `employee_self` | 90 | O | Their own attendance, leave and tasks — everything else is self-service, which needs no permission | Read another employee, a lead, a call, payroll, HR documents or any money record |

Templates are offered by entitlement: HR Administrator with HRMS, the sales
pair with any lead module, Real Estate Operations with Real Estate or Sales,
Employee always. `src/lib/roles/templates.ts`.

## 2. Changes made

| Commit | Change |
| --- | --- |
| `33cf8668` | The six specs and their grants. Wired to nothing — no behaviour change. |
| `5c4575a9` | Provisioning, at all three paths that create a workspace or change its modules. |
| `b07959a1` | Both role pickers: business roles first, descriptions, scope, module count, effective-permissions preview. |
| `67748630` | Permission-filtered phone tabs; the Start AI-assisted call action. |
| `f519a50e` | The suite stops leaving test roles in a workspace it did not create. |
| `29fdb8e1` | The `changes/` entry. |
| `24092ef1` | Payroll's maker-checker, tested. |

### Files modified

Product: `lib/roles/templates.ts` (new), `services/platform/provisioning.ts`,
`services/platform/createWorkspace.ts`,
`api/v1/platform/workspaces/[workspaceId]/route.ts`,
`api/v1/platform/subscriptions/[subscriptionId]/route.ts`,
`services/identity/roles.ts`, `admin/roles/page.tsx`,
`people/users/new/page.tsx`, `people/users/new/NewUserForm.tsx`,
`components/workspace/MobileTabBar.tsx`, `[workspaceSlug]/layout.tsx`,
`[workspaceSlug]/dashboard/page.tsx`, `app/globals.css`.

Tests: four new specs, three existing ones updated where the behaviour changed,
and `tests/e2e/globalTeardown.ts`.

**Database changes: none.** `Role` already carried `description`, `isSystem`,
`isActive`, `rank` and `defaultScope`.

## 3. Existing functionality preserved

Nothing was renamed, deleted, re-keyed, re-granted, deactivated or reassigned.
No user's role changed. The 26 demo roles, the five Lead Eagle starter roles
and every custom role are exactly as they were.

Three properties make that true, and each is tested rather than asserted:

1. **A key or name already in use is skipped.** Verified on a workspace holding
   26 roles: the templates named "HR Administrator" and "Employee" were not
   created, because roles with those names already existed.
2. **Nothing is re-widened.** A role an administrator trimmed — `leads:VIEW_SENSITIVE_FIELDS`
   revoked — stays trimmed. This matters because revoking *deletes* the row, so
   a gap cannot be told apart from a deliberate revocation.
3. **Nothing appears underneath an existing workspace.** Templates arrive only
   with a module that has just been switched on. The console editor sends the
   full module list on every save, so the first version of this change
   resurrected deleted roles — `provision-lead-work.spec.ts` caught it, and the
   rule now keys on what is new.

Every module in §5 of the brief — Sales CRM, Lead Eagle, Real Estate, HRMS,
Marketing, Finance, Collections, Commissions, Payroll, Recruitment, Customer
Service, Campaigns, Events, Reporting, Automation, Integrations, public forms,
landing pages, QR capture, mobile APIs, workers, dashboards — is untouched. No
route, API or deep link was removed.

## 4. AI functionality

**No AI code was changed.** What was added is one link.

The audit established what gates each feature, and the templates grant those
permissions rather than inventing new ones:

| Feature | Gate | Who holds it |
| --- | --- | --- |
| Live call workspace | `dialer:VIEW` + SALES | Sales Agent, Sales Manager |
| Live coaching, Ask Next, Handle Objection, Recommend Property, Payment Plan, Closing Line, Summarize Customer | `calls:EDIT` | Sales Agent (own), Sales Manager (team) |
| Recording, consent, transcripts | `calls:VIEW` / `calls:EDIT` | as above |
| Post-call analysis, AI summaries | `calls:EDIT` | as above |
| Call audit scoring | `calls:EDIT` + record scope | Sales Agent (own), Sales Manager (team) |
| Follow-up drafting | `calls:EDIT` | as above |
| Workspace assistant | `leads:VIEW` + SALES | every sales template |
| Provider configuration, usage and budgets | `integrations:*`, `settings:*` | Company Administrator only |

Consent, microphone handling, WebSocket streaming, the queues, the workers,
simulation and failure handling are all untouched.

**The new entry point.** The dashboard offers *Start AI-assisted call* to a
viewer holding `calls:CREATE` and `dialer:VIEW`. It links to
`/sales/calls/new`, whose "Create & open live workspace" button creates a real
call and then opens `/calls/{id}/live`. It does **not** link to a
`/calls/<id>/live` with an invented id, which would 404 the feature it is meant
to surface.

## 5. Dashboard and navigation

Panel ordering already followed the role: `workerView` puts a representative's
own work first and an administrator's business panels first
(`dashboard/page.tsx:491`). That was left alone — the brief asks for reordering
and the product already does it.

What changed:

- **The live-call action** (§4).
- **The phone's tabs follow permissions.** The bar took the workspace's modules
  and the current path and nothing else, so an employee in a Sales workspace
  was given Leads and Calls tabs the server refused, and the People bar offered
  the employee directory to someone who cannot read it. Each tab now names the
  permission its page asserts, and what is left is topped up with self-service
  screens: that employee gets Home, Check in, My Leave, My Tasks.
- **Role lists read as roles.** Business roles first, descriptions where the
  implementation key used to be, scope and module count on every row.

Navigation hiding remains presentation only: every route keeps its server-side
assertion.

## 6. Security findings

| Control | State | Evidence |
| --- | --- | --- |
| Payroll maker-checker | **Holds, and is on the record** | `payroll-separation-of-duties.spec.ts` — an account holding both `payroll:EDIT` and `payroll:APPROVE` is still refused its own run; a second holder approves it |
| Independent approver exists under the six roles | **Yes** | Same spec: HR Administrator prepares, Company Administrator approves |
| Collection verification | Holds | `tests/sales/collections.spec.ts` — "the recorder cannot verify their own entry — not even with the approve permission" |
| Payout approval | Holds | `tests/sales/payouts.spec.ts` |
| Agency fee | Separate CREATE and APPROVE | `feeAmendments.ts:335`; no template holds either |
| Recruitment offers | `recruitment:APPROVE` withheld from HR Administrator | `role-templates.spec.ts` |
| Salary masking | `hr_documents:VIEW_SENSITIVE_FIELDS` granted by no template | `role-templates.spec.ts` |
| Tenant isolation, RLS | Untouched | The tenant guard refused a cross-tenant `Role.deleteMany` during this work — the control working on me |
| Privilege escalation | Unchanged | The Add-user list is still cut by `rank > actor.roleRank`, and the server re-checks |

**One limitation, stated plainly as required.** `calls:EDIT` is **not** a
dedicated independent-audit permission. Live coaching, post-call analysis,
audit scoring and follow-up drafting all gate on it plus record scope, so a
Sales Agent can request an audit of their own call and there is no way to grant
auditing to a manager without also granting call editing. The templates use
scope as the control — agent at OWN, manager at TEAM. Making this a real
reviewer permission needs a `calls:AUDIT` catalogue entry, a migration and a CI
catalogue-gate change; proposed, not done, and not silently approximated.

## 7. Licensing limitation

The live AI dialer asserts `productModule: 'SALES'`. A Lead-Eagle-only or
Real-Estate-only workspace therefore cannot place an AI-assisted call, though
its agents can be coached and audited on calls logged another way. Left exactly
as it is: widening it would hand paid functionality to workspaces that have not
bought it. The dashboard action is hidden where the module is absent, so nobody
is shown a door they cannot open.

## 8. Rollback

Every commit is independent and additive.

- **All of it:** `git revert 24092ef1 29fdb8e1 f519a50e 67748630 b07959a1 5c4575a9 33cf8668`,
  or simply do not merge the branch. Nothing in any customer database changes
  on revert, because nothing was migrated.
- **Keep the templates, drop the UI:** revert `67748630` and `b07959a1`.
- **Stop provisioning without removing anything:** revert `5c4575a9`. Templates
  already created in a workspace stay, as ordinary roles an administrator may
  edit or deactivate.
- **A workspace that does not want a template:** deactivate it
  (`isActive: false`, which keeps its history) or delete it in the role editor.
  It will not come back unless the module that brings it is switched off and on
  again.

There is no data migration to reverse and no destructive step to undo.
