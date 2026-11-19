# Six business roles: current-state audit and simplification design

Audited against `main` at `babbaa06` on 7 November 2026. Every claim below was
read from the source named beside it, not from the QA document. Where the QA
suite and the code disagree, the code is reported and the difference is called
out.

Nothing in this document has been implemented. It is Phase 1 (audit) and
Phase 2 (design), for approval before Phase 3.

---

## A. Current state — what is actually there

### A1. There is no role-template system at all

Three separate things create roles, and none of them is a template a customer
picks from:

| Where                                                      | What it creates                                                                                                  | When                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/services/platform/createWorkspace.ts:172`             | **One** role, `company_admin` "Company Administrator", holding the entire permission catalogue at `ORGANIZATION` | Every new workspace                                                            |
| `src/services/platform/provisioning.ts:52` `STARTER_ROLES` | Five lead-desk roles: `manager`, `team_lead`, `agent`, `telecaller`, `viewer`                                    | **Only when Lead Eagle is switched on** (`provisioning.ts:246`)                |
| `prisma/seed/roles.ts` `ROLES`                             | **26** roles, from `super_admin` to `executive_read_only`                                                        | The demo seed only, plus `scripts/seed-role-defaults.ts` repairing empty roles |

The consequence, and it is the heart of the complaint: **a Sales-only or
Real-Estate-only workspace is provisioned with exactly one role.** The
administrator must hand-build Sales Manager, Sales Agent, HR and everything
else in the role editor, permission by permission, across 64 modules. A
Lead-Eagle workspace gets five roles named for a lead desk — `telecaller`,
`viewer` — which are not the six business roles a brokerage recognises.

So the six templates are not a reduction of 26. The 26 are demo data. **They
are the first templates the product will have ever offered.** That reframes the
work: it is additive, which is why it can be done without touching a single
existing role assignment.

### A2. The 26 seeded roles, and what they are for

`prisma/seed/roles.ts`, ranked: `super_admin`(0), `org_admin`(10),
`sales_director`(20), `regional_manager`(30), `branch_manager`(40),
`team_manager`(50), `sales_rep`(60), `field_rep`(65), `marketing_manager`(70),
`marketing_exec`(75), `service_manager`(80), `service_agent`(85),
`analyst`(90), `hr_admin`(100), `hr_executive`(105), `payroll_officer`(110),
`recruiter`(115), `dept_manager`(120), `site_manager`(125), `it_admin`(130),
`finance_admin`(140), `auditor`(150), `employee`(200), `read_only`(210),
`call_qa`(220), `executive_read_only`(230).

These are a demonstration catalogue. They are not what customers run on, and
none of them is deleted by this work.

### A3. The three mystery roles in the demo are test leftovers — confirmed

The brief asks whether `Journey Rep …`, `Seller …` and `Scope probe …` are
business roles. They are not. Each is created by a Playwright spec with a
run-tag suffix:

| Role name           | Created by                              |
| ------------------- | --------------------------------------- |
| `Journey Rep <run>` | `tests/e2e/business-journey.spec.ts:96` |
| `Seller <run>`      | `tests/e2e/business-journey.spec.ts:62` |
| `Scope probe <run>` | `tests/e2e/record-scope.spec.ts:39`     |

They are rows a run-tag teardown missed in the demo database. **No migration
needed and no business decision to make**: they are deletable from the demo
workspace alone, by run tag, and they must not be touched in any customer
workspace without the same check. This is a cleanup, not a role decision.

### A4. Separation of duties is enforced on the record, not on the role

This is the single most important finding for safety, because it means a
simplified role set **cannot** weaken these controls:

| Control                 | Where                                     | How                                                                                                                                                                      |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payroll maker-checker   | `src/services/hr/payroll.ts:650`          | `run.preparedById === actor.id` is refused even when the actor holds `payroll:APPROVE`. The comment states the intent: "enforced on the record rather than on the role". |
| Collection verification | `src/services/money/collections.ts:457`   | "You recorded this receipt. Someone else has to verify it."                                                                                                              |
| Payout release          | `src/services/money/payouts.ts:192`       | "You built this run. Someone else has to approve it."                                                                                                                    |
| Agency-fee amendment    | `src/services/money/feeAmendments.ts:335` | `agencyfee:APPROVE` with booking scope, separate from `agencyfee:CREATE`                                                                                                 |
| Recruitment offers      | `src/services/hr/recruitment.ts:62`       | `isHiringApprover` = `recruitment:APPROVE` at `ORGANIZATION`                                                                                                             |

The role-level split is `EDIT` prepares / `APPROVE` decides. A template that
grants HR Administrator `payroll:EDIT` and withholds `payroll:APPROVE` is
therefore safe **and** belt-and-braces: even a misconfigured role cannot
self-approve.

### A5. The permission model is sound and must not be replaced

64 modules × up to 12 actions (`src/lib/security/permissionCatalogue.ts`), five
scopes `OWN < TEAM < BRANCH < REGION < ORGANIZATION`, checked with
`atLeast(ctx, module, action, scope)` (`src/lib/security/rbac.ts`). Roles are
database rows; a revoked permission **deletes** its row rather than storing
`false`, which is why `seed-role-defaults.ts` only ever fills a role holding
zero grants. Any migration design has to respect that: _a gap is not
necessarily an omission._

### A6. Navigation is already permission-driven; its problem is duplication

`src/lib/nav/workspaceNav.ts` (1,535 lines) is one pure model feeding sidebar,
tab strip and ⌘K, and every tab names the permission and module its route
asserts server-side. 11 sections, 31 areas. Hiding a tab is presentation only —
the route still refuses.

The real defect is duplication across lead modules. A workspace entitled to
Sales **and** Real Estate **and** Lead Eagle gets:

- "Leads" in the CRM section, in Real Estate, and in Lead Eagle — three entries
  onto the same `Lead` rows (`realty/` and `lead-eagle/` pages are one-line
  re-exports of `sales/` pages, per `changes/PROJECT.md`).
- "Dashboard" twice, "Inventory" twice.

### A7. The mobile tab bar ignores permissions entirely

`src/components/workspace/MobileTabBar.tsx:56` takes `{ slug, modules }` and
nothing else. Tabs are chosen from module ownership and the current path. There
is **no permission input**, so:

- an Employee-role user in a Sales workspace sees **Leads** and **Calls** tabs
  that 403 server-side;
- in a People context, the fourth tab is **People** (the employee directory),
  shown to employees who cannot view it.

The fix is small and reuses what exists: pass `permitted` and filter through
`tabAllowed` from `workspaceNav.ts`.

### A8. The landing dashboard is well built but has no live-call entry

`src/app/(workspace)/[workspaceSlug]/dashboard/page.tsx` (795 lines) gates every
panel independently (`showPeople`, `showSales`, `showOpportunities`,
`showTasks`, `showTeamFollowUps`, `showSubscription`), runs them in one
transaction, and is deliberately uncached. A sales representative already does
not see headcount or the plan.

What is missing against the brief: **no link to the live AI call workspace**
anywhere on the landing page. The only AI element is an `AiInsight` panel. The
dialer lives at `dialer:VIEW` and is reachable only through Calls.

### A9. AI inventory — what exists, and what gates it

Ten metered features (`src/lib/ai/features.ts`): call analysis, call audit
scoring, live coaching, live coaching actions, workspace assistant, social post
drafting, follow-up email drafting, follow-up WhatsApp drafting, practice
conversation, practice scoring. Supporting libraries: `allowance`, `budgets`,
`guardrails`, `cascade`/`routing` (model fallback), `redact`, `usage`,
`pricing`, `simulated`, `liveCoach`, `practice`, `provider`, `gemini`.

Permissions actually enforced:

| Surface                      | Route                               | Gate                             |
| ---------------------------- | ----------------------------------- | -------------------------------- |
| Workspace assistant          | `api/v1/assistant`                  | `leads:VIEW` + `SALES`           |
| Live coaching (write)        | `api/v1/calls/[id]/coach`           | `calls:EDIT` + `LEAD_MODULES`    |
| Coaching read                | `api/v1/calls/[id]/coaching`        | `calls:VIEW` + `LEAD_MODULES`    |
| Call audit scoring           | `api/v1/calls/[id]/audit`           | `calls:EDIT` + `LEAD_MODULES`    |
| Follow-up email drafting     | `api/v1/calls/[id]/follow-up-email` | `calls:EDIT` + `LEAD_MODULES`    |
| Live call workspace / dialer | `api/v1/dialer/[sessionId]`         | `dialer:VIEW` + **`SALES` only** |
| Coaching overview            | `api/v1/coaching`                   | `calls:VIEW` + `SALES`           |

Two findings follow, both reported rather than silently fixed:

1. **The live call workspace is Sales-only.** `productModule: 'SALES'` on the
   dialer routes, while coaching and audit accept any lead module. A
   Lead-Eagle-only or Real-Estate-only workspace has agents who can be coached
   on a call they cannot place from the product. The brief assigns live
   AI-assisted calling to Sales Agent without qualification; whether that
   should hold in a Lead-Eagle workspace is a product decision (§H3).
2. **There is no distinct "audit capability" permission.** The brief wants call
   quality analysis restricted to "Sales Manager with explicit review
   permission", but the only gate is `calls:EDIT` plus record scope. An agent
   with `calls:EDIT@OWN` can audit their own call — which is defensible — but
   there is no way to grant auditing to a manager _without_ also granting call
   editing. §8 forbids introducing another permission system, so the design
   below uses **scope** as the control and says so plainly (§H2).

### A10. Where the QA document differs from the code

The brief warns the QA suite describes an earlier commit. Confirmed
differences, by inspection:

- The QA document's role inventory reflects the 26-role **demo seed**. No
  customer workspace is provisioned that way (§A1).
- The role editor already shows per-role **user counts** and scope, including
  "up to <widest>" when a grant reaches further than the default scope
  (`admin/roles/page.tsx:148`). Any QA expectation that these are missing is
  stale.

---

## B. The six-role templates — proposed matrix

Names are what a brokerage says out loud. Keys are new and collide with
nothing in `STARTER_ROLES` or the demo seed.

| #   | Name                   | Key                        | Rank | Default scope | One-line description shown in the UI                                                            |
| --- | ---------------------- | -------------------------- | ---- | ------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Company Administrator  | `company_admin` _(exists)_ | 10   | ORGANIZATION  | Runs the whole workspace: people, roles, settings, subscriptions and every module.              |
| 2   | Sales Manager          | `sales_manager`            | 30   | TEAM          | Runs a sales team: assigns leads, watches the pipeline, sets targets, audits calls and coaches. |
| 3   | Sales Agent            | `sales_agent`              | 50   | OWN           | Works their own leads, calls, follow-ups and viewings, with live AI call assistance.            |
| 4   | Real Estate Operations | `realestate_ops`           | 40   | ORGANIZATION  | Property inventory, listings, viewings, bookings and transaction coordination.                  |
| 5   | HR Administrator       | `hr_administrator`         | 35   | ORGANIZATION  | Employees, attendance, leave, shifts, recruitment, performance and payroll preparation.         |
| 6   | Employee               | `employee_self`            | 90   | OWN           | Their own work: check-in, attendance, leave, tasks, payslips and personal records.              |

**Default scope TEAM for Sales Manager**, deliberately. The brief says not to
grant organization-wide access merely for holding the title; `TEAM` is the
smallest scope that lets a manager do the job, and an administrator widens it
to BRANCH/REGION/ORGANIZATION per workspace in the editor.

### B1. Grants per template

`A`=ORGANIZATION, `B`=BRANCH, `T`=TEAM, `O`=OWN. Only grants listed are given;
everything else is absent, and absence is refusal.

**1. Company Administrator** — unchanged from today: the whole catalogue at `A`.
It is already created by `createWorkspace.ts` and this work does not alter it.
Entitlement, tenant isolation, immutable audit logs and the record-level
maker-checker controls still bind it (§A4).

**2. Sales Manager** (`T` unless shown)

```
leads        VIEW CREATE EDIT ASSIGN REASSIGN BULK_UPDATE EXPORT IMPORT VIEW_SENSITIVE_FIELDS
contacts     VIEW CREATE EDIT        accounts  VIEW CREATE EDIT
opportunities VIEW CREATE EDIT EXPORT
activities   VIEW CREATE             tasks     VIEW CREATE EDIT ASSIGN
calls        VIEW CREATE EDIT EXPORT VIEW_SENSITIVE_FIELDS
dialer       VIEW                    visits    VIEW CREATE EDIT APPROVE
requirements VIEW CREATE EDIT        allocation VIEW CREATE
campaigns    VIEW                    smartviews VIEW CREATE
reports      VIEW VIEW_REPORTS EXPORT   dashboards VIEW
distribution VIEW
projects     VIEW (A)                listings  VIEW (A)
employee     VIEW (T)   attendance   VIEW APPROVE (T)   leave VIEW APPROVE (T)
```

Withheld on purpose: `allocation:APPROVE` (pool allocation does not narrow by
scope — see the `STARTER_ROLES` comment at `provisioning.ts:46`), every
`collections`/`commissions`/`payouts`/`agencyfee` action, `users`, `roles`,
`settings`, `integrations`, `payroll`.

**3. Sales Agent** (`O` throughout)

```
leads        VIEW CREATE EDIT VIEW_SENSITIVE_FIELDS
contacts     VIEW CREATE EDIT        accounts  VIEW
opportunities VIEW CREATE EDIT
activities   VIEW CREATE             tasks     VIEW CREATE EDIT
calls        VIEW CREATE EDIT        dialer    VIEW
visits       VIEW CREATE EDIT        requirements VIEW CREATE EDIT
documents    VIEW CREATE             communications CREATE
projects     VIEW   listings VIEW    clientprofiles VIEW CREATE EDIT
attendance   VIEW CREATE   leave VIEW CREATE   employee VIEW (own)
```

`calls:EDIT` is what carries live coaching, post-call analysis and follow-up
drafting (§A9), so the whole AI-assisted calling experience the brief
enumerates — Live Call workspace, consent, microphone, transcription, coaching
hints, Ask Next, Handle Objection, Recommend Property, Payment Plan, Closing
Line, Summarize Customer, notes, End Call, outcome, transcript, scorecards —
follows from these grants with no new permission.

**4. Real Estate Operations** (`A` unless shown)

```
projects   VIEW CREATE EDIT DELETE EXPORT
listings   VIEW CREATE EDIT DELETE EXPORT VIEW_SENSITIVE_FIELDS
bookings   VIEW CREATE EDIT        visits VIEW CREATE EDIT APPROVE MANAGE_USERS
requirements VIEW CREATE EDIT      events VIEW CREATE EDIT
leads      VIEW                    contacts VIEW        accounts VIEW
documents  VIEW CREATE             tasks VIEW CREATE EDIT
collections VIEW                   commissions VIEW
reports    VIEW VIEW_REPORTS EXPORT
attendance VIEW CREATE (O)   leave VIEW CREATE (O)
```

`collections:VIEW` and `commissions:VIEW` only — **status visibility, never
approval**, exactly as §2 Role 4 requires. No `APPROVE` on either, no
`payouts`, no `agencyfee`.

**5. HR Administrator** (`A` unless shown)

```
employee     VIEW CREATE EDIT MANAGE_USERS   departments VIEW CREATE EDIT
attendance   VIEW CREATE EDIT APPROVE MANAGE_CONFIGURATION
leave        VIEW CREATE EDIT APPROVE MANAGE_CONFIGURATION
shifts       VIEW CREATE EDIT APPROVE        overtime VIEW CREATE EDIT APPROVE
holidays     VIEW CREATE EDIT                work_locations VIEW CREATE EDIT
hr_documents VIEW CREATE EDIT                hr_reports VIEW CREATE
recruitment  VIEW CREATE EDIT                performance VIEW CREATE EDIT
payroll      VIEW CREATE EDIT EXPORT
hrms         VIEW
```

Three deliberate withholdings, each named in the brief:

- **No `payroll:APPROVE`** — preparation only. Approval and release stay with
  Company Administrator, and the record-level maker-checker at
  `payroll.ts:650` holds even if a workspace later grants both.
- **No `recruitment:APPROVE`** — offer decisions stay with an authorized
  approver (`isHiringApprover`, `recruitment.ts:62`).
- **No `hr_documents:VIEW_SENSITIVE_FIELDS`** — salary stays behind
  field-level permission, granted explicitly per workspace.

**6. Employee** — no business module grants at all. Self-service is already
reachable without permissions (`SELF_SERVICE` in `src/lib/workspace-page.ts`,
and the `personal` areas in the nav model carry no permission token). Grants:

```
attendance VIEW CREATE (O)    leave VIEW CREATE (O)    tasks VIEW EDIT (O)
```

Nothing else. The brief's list — personal dashboard, profile, check-in,
attendance history, leave, balance, my tasks, notifications, roster, payslips,
HR documents, holidays, performance, account security, role visibility — is
served by the self-service routes, not by module permissions. **This is the
template that must be verified hardest**: it is the one where a stray grant is
a data leak.

---

## C. Current → target mapping, and the migration stance

**The stance: nothing is migrated.** No existing role is renamed, deleted,
deactivated, re-keyed or re-granted, and no user's assignment changes. The six
templates are _offered_ to administrators; adoption is a choice, per workspace,
per user.

That is not timidity, it is forced by §A5: a revoked permission deletes its
row, so there is no way to tell a deliberately trimmed role from an
unfinished one. Any automatic re-granting would silently reverse
administrators' considered revocations.

| Existing role                                     | Nearest template                                 | Action                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `company_admin`                                   | 1. Company Administrator                         | **Is** the template. Untouched.                                                                                                     |
| `manager` (starter)                               | 2. Sales Manager                                 | Left in place. Offered as a rename suggestion only, never applied.                                                                  |
| `team_lead` (starter)                             | 2. Sales Manager at TEAM                         | Left in place.                                                                                                                      |
| `agent` (starter)                                 | 3. Sales Agent                                   | Left in place.                                                                                                                      |
| `telecaller` (starter)                            | 3. Sales Agent minus EXPORT and sensitive fields | Left in place — it is a real distinction a brokerage uses.                                                                          |
| `viewer` (starter)                                | —                                                | Left in place. No template equivalent; read-only desk oversight.                                                                    |
| 26 demo roles                                     | various                                          | Demo data. Untouched. Still seeded, so the demo keeps demonstrating the full model.                                                 |
| `Journey Rep …`, `Seller …`, `Scope probe …`      | —                                                | Test leftovers (§A3). Deleted **from the demo workspace only**, matched by run-tag suffix, in a separate commit with its own check. |
| `super_admin`, platform staff, service identities | —                                                | Out of scope by §5. They are platform-side (`src/lib/auth/support-actor.ts`), not workspace roles, and stay separate.               |

For a workspace that wants to adopt a template, the safe operation is
**create the template role, assign it, verify, then deactivate the old role** —
`isActive: false` keeps history (schema comment on `Role.isActive`). Never
delete.

---

## D. Where the templates live — no migration, no new permission system

`Role` already has `description`, `isSystem`, `isActive`, `rank` and
`defaultScope` (`prisma/schema.prisma`). The templates need **no schema change
and no migration**:

- a new module `src/lib/roles/templates.ts` holding the six specs in the same
  shape `STARTER_ROLES` already uses;
- `provisionStarterRoles` generalised so a workspace gets the six templates for
  the modules it owns, instead of the five lead-desk roles only when Lead Eagle
  arrives. Keyed the same way it is now — a role whose key or name is already
  taken is never touched (`provisioning.ts:139`), so this cannot disturb an
  existing workspace;
- the role editor and the Add-user form read the same specs to show
  description, modules and scope.

Reuses `at()` / `only()` helpers already in `provisioning.ts`. No new
dependency. No second permission model.

---

## E. Dashboard simplification plan

Keep every calculation, data source and panel. Change ordering, emphasis and
one missing link. All inside the existing `dashboard/page.tsx` and its
components.

| Role                   | First thing on screen                                 | Then                                                                           | Removed |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------- |
| Company Administrator  | Pending approvals and security alerts                 | Company health, users, sales, people, financial summary, plan                  | Nothing |
| Sales Manager          | Team follow-ups due and overdue                       | Pipeline, conversions, targets, call performance, AI coaching insight          | Nothing |
| Sales Agent            | **Today's follow-ups, with a Start live call action** | My leads, calls, meetings, tasks, opportunities                                | Nothing |
| Real Estate Operations | Viewings today and booking status                     | Available properties, active listings, transaction status, tasks               | Nothing |
| HR Administrator       | Leave approvals pending                               | Headcount, absences today, onboarding, recruitment, payroll preparation status | Nothing |
| Employee               | **Check-in / check-out**                              | My attendance, leave balance, my tasks, notifications                          | Nothing |

Two concrete changes, not a rebuild:

1. **A live-call entry for agents** (§A8). On the sales panel, for a viewer
   holding `dialer:VIEW`, a primary action onto the live call workspace. This is
   the brief's "prominent access to Live AI Call Assistance" and it is a link,
   not a feature.
2. **Panel order by widest scope held.** The panels already exist and are
   already gated; ordering them by `scopeFor(ctx, …)` puts a manager's team
   panel above their own work and an agent's own work first. No query changes.

Mobile: the four tab destinations become permission-filtered (§A7) and the
agent's fourth slot becomes the live call workspace where `dialer:VIEW` is
held, falling back to today's choice otherwise.

Explicitly **not** done: no new dashboard framework, no new components where an
existing one fits, no card removals that would hide an unresolved alert.

---

## F. Navigation simplification plan

1. **Collapse duplicate lead entries.** Where a workspace owns more than one
   lead module, show one "Leads" area for the active product rather than three
   onto the same rows (§A6). `activeModule()` already computes which product
   the viewer is in — this is applying it to section visibility, not new logic.
2. **Stop showing implementation keys.** The role list's second line reads
   `role.key · N users` (`admin/roles/page.tsx:157`). Show the description
   there and keep the key in a title attribute for administrators who need it.
3. **Permission-filter the mobile bar** (§A7).

Navigation hiding is never the control. Every route keeps its server-side
assertion, and the point is re-tested (§G).

---

## G. Tests this needs

Nothing is marked passed until it has run. Planned, per phase:

- `tests/unit/role-templates.spec.ts` — the six specs name only real
  `(module, action)` pairs from `PERMISSION_CATALOGUE`; Employee grants no
  business module; HR Administrator holds no `payroll:APPROVE` and no
  `recruitment:APPROVE`; Real Estate Operations holds no `APPROVE` on
  `collections` or `commissions`.
- `tests/unit/workspace-nav.spec.ts` additions — one "Leads" area for a
  multi-lead-module workspace; the mobile bar drops tabs whose permission is
  absent.
- `tests/tenant/role-template-provisioning.spec.ts` — provisioning a workspace
  twice adds nothing the second time; a workspace whose administrator renamed a
  role keeps the rename.
- `tests/e2e/six-role-journey.spec.ts` — create one user per template through
  the product, sign in as each, assert the dashboard each sees and that a
  direct API call to a module the template withholds is refused.
- Re-run existing suites unchanged: `record-scope`, `business-journey`,
  `admin-deletes`, the payroll and collections separation specs, and the AI
  call specs. Any expectation that changes must change because the behaviour
  did, not to make a test pass.

---

## H. Security conflicts and decisions needed before Phase 3

### H1. "Keep only six templates" vs the five Lead Eagle starter roles

`telecaller` and `viewer` have no template equivalent and are genuinely
useful — a telecaller deliberately lacks `EXPORT` and `VIEW_SENSITIVE_FIELDS`,
a viewer reads the desk without full contact details. Deleting them would
remove capability the brief says to preserve; keeping them means a Lead Eagle
workspace sees eight role choices, not six.

**Proposed:** the six templates are the _primary_ choices, shown first and
labelled as such; `telecaller` and `viewer` remain available under "More
roles". No deletion. Needs your word, because it is the one place the six-role
rule bends.

### H2. Call-quality auditing has no permission of its own

The brief wants auditing restricted to a Sales Manager with explicit review
permission. The code gates it on `calls:EDIT` + record scope and nothing else
(§A9.2), and §8 forbids a second permission system.

**Proposed:** use scope as the control — an agent audits their own calls at
`OWN`, a manager audits the team's at `TEAM`+. This needs no backend change.
The alternative, a real `calls:AUDIT` action, is a catalogue addition plus a
migration plus a CI catalogue-gate update; I have not done it and would want
your approval first.

### H3. Live AI calling is Sales-only

`dialer` routes assert `productModule: 'SALES'` (§A9.1). A Lead-Eagle-only
brokerage therefore cannot place an AI-assisted call, though its agents can be
coached and audited on calls logged another way. The brief assigns live
AI-assisted calling to Sales Agent unconditionally.

**Proposed:** report, do not change. Widening the dialer to `LEAD_MODULES` is a
product and licensing decision, not a simplification, and it would hand a
capability to workspaces that have not bought it.

### H4. The Employee template is the risk

Everything else widens nothing. The Employee template is where a single
mistaken grant exposes colleagues' records. It gets the narrowest grants in
§B1.6 and the heaviest test (§G), including a direct-API refusal check per
withheld module.

---

## I. What I propose to do, in order

1. `src/lib/roles/templates.ts` — the six specs, plus the unit spec in §G.
   Nothing wired up yet; nothing changes for anyone.
2. Generalise `provisionStarterRoles` to the templates, key-safe, with the
   tenant spec.
3. Role editor and Add-user form: descriptions, module summary, scope,
   effective-permission preview before assignment; stop surfacing `role.key`.
4. Dashboard ordering and the live-call entry.
5. Mobile tab permission filter and the duplicate-lead-area collapse.
6. The e2e six-role journey, then the full regression.
7. One `changes/` entry per commit, and `changes/PROJECT.md` corrected where
   this makes it wrong.

Steps 1–2 change nothing a user sees and are safe to land first. Steps 3–5 are
the visible simplification. Nothing in the list deletes a role, alters an
assignment, touches production data or adds a dependency.

**Awaiting your decisions on H1, H2 and H3 before Phase 3.**
