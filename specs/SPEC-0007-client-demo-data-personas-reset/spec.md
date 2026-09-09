# SPEC-0007 — Client Demo: Sales and HRMS Data, Personas and Reset

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0007` |
| Title | Client Demo — Sales + HRMS Data, Personas and Reset |
| Status | `IMPLEMENTING` |
| Risk | `R3` |
| Owner | Product Owner |
| Created | 2026-09-08 |
| Last updated | 2026-09-08 |
| Supersedes | none |
| Superseded by | none |

## Problem

A sales representative cannot today give a complete client demonstration of
YOUHAN ONE. The Sales half is well served: the demo seed builds a populated
brokerage with hundreds of records and eleven role personas. The HRMS half is
empty. The seed creates departments, branches and employee profiles and stops
there — no attendance, no leave, no shifts, no holidays, no leave types. A
prospect asked to look at People sees a directory and then a succession of
blank screens.

Second problem, in the same area: the demo reset restores only what the seed
built when the reset was written. It predates the HR tables, so a demonstration
that modifies HR records cannot be returned to a known baseline at all.

## Goal

A demonstrator can log in as a Sales, an HR or a Management persona, walk the
whole Sales and HRMS product surface against realistic synthetic data with no
critical screen empty, and an authorised operator can restore the whole
workspace — Sales and HRMS — to a known baseline afterwards.

## Background and context

`apps/web/prisma/seed/index.ts` and `apps/web/prisma/seed/crm.ts` build two
workspaces of synthetic data and are gated by four independent refusals
(`NODE_ENV`, `APP_ENV`, the target database's name, and an explicit
`ALLOW_DEMO_SEED` opt-in). `docs/ENVIRONMENTS.md` names the demo environment as
the intended home for this data. `docs/DEMO.md` documents the demonstration
personas that exist today.

Authorization is unchanged by this work and is cited rather than restated:
tenant scoping via the Prisma extension in `apps/web/src/lib/db.ts`, database
enforcement via row-level security, module entitlement via
`apps/web/src/lib/security/entitlements.ts`, and role scope via
`apps/web/src/lib/security/rbac.ts` against the catalogue in
`apps/web/prisma/seed/roles.ts`.

## Scope

- Audit and reuse of the existing Sales demo dataset, filling only genuine gaps.
- A synthetic HRMS dataset for the demo workspace.
- Three demonstration personas drawn from the existing role catalogue.
- Extension of the existing demo reset to cover HRMS tenant-scoped tables.
- A deterministic coverage check for reset completeness.
- Synthetic-data controls.
- Tenant-isolation and role-isolation verification for the demonstration personas.
- Verification that a demonstration cannot dispatch to a real external recipient.
- Demonstration documentation.

## Out of scope

- Any deployed environment, infrastructure, CI/CD, DNS, TLS, environment secret
  or monitoring work. That is `SPEC-0008`, at its own risk level.
- Any demo tenant inside the production customer database.
- Any change to the production mailer architecture.
- Payroll, payslips, compensation and the WPS bank-file export as demonstrable
  surfaces. See `CL-004`.
- Live telephony, WhatsApp or AI-provider traffic during a demonstration.
- Any change to the role catalogue, permission model, RLS policy or session
  handling.
- Any schema change or database migration.

## Actors

- **Demonstrator** — a sales representative driving the demonstration.
- **Prospect** — watching, sometimes holding the keyboard. Untrusted.
- **Demo Sales persona** — a workspace user on the existing `sales_rep` role.
- **Demo HR persona** — a workspace user on the existing `hr_admin` role.
- **Demo Management persona** — a workspace user on the existing `org_admin`
  role, tenant-scoped, never a platform role.
- **Operator** — runs seed and reset against a disposable database.

## User stories

- As a demonstrator, I need populated HR screens, so that a prospect sees a
  working HRMS rather than empty tables.
- As a demonstrator, I need to log in as three personas with visibly different
  scope, so that role enforcement is a feature of the demonstration.
- As an operator, I need one command that returns the workspace to a known
  baseline, so that the next demonstration starts clean.
- As a security owner, I need proof the demonstration cannot reach a real
  tenant or a real recipient, so that a demonstration is not an incident.

## Functional requirements

- `FR-001` — The demo dataset provides five departments, each with a name and
  code, in the demo workspace.
- `FR-002` — Every **active** employee profile in the demo workspace receives a
  coherent HR dataset: a department, a designation and a position in the
  reporting hierarchy, with the leave and attendance coverage the requirements
  below describe. No active profile is left partially populated. The workspace
  holds at least 24 such profiles; the current fixture expectation is 40, which
  is an expectation of the seed and not an architectural maximum. *(Amended by
  `CHG-001`; the original wording capped the population at 30.)*
- `FR-003` — Employee records form a reporting hierarchy at least two levels
  deep, so that a manager view resolves to real reports.
- `FR-004` — The demo dataset provides at least two shifts and a holiday
  calendar for the current year.
- `FR-005` — The demo dataset provides leave types, and leave balances for each
  employee where the data model supports them.
- `FR-006` — The demo dataset provides leave requests in approved, pending and
  rejected states, such that an approval queue is not empty.
- `FR-007` — The demo dataset provides between 30 and 60 working days of
  attendance history per employee, including present, late, absent and
  half-day states where the data model supports them.
- `FR-008` — Every HR screen reachable by the HR persona renders populated
  data, or renders an empty state that is correct because the feature is
  deliberately out of scope.
- `FR-009` — The existing Sales dataset is reused without rebuilding. Additions
  are made only where a client-facing Sales screen would otherwise be empty,
  and each addition names the screen that required it.
- `FR-010` — Three demonstration personas exist as ordinary workspace
  memberships holding the existing catalogue roles `sales_rep`, `hr_admin` and
  `org_admin`.
- `FR-011` — The demo reset reliably removes every resettable tenant-scoped
  record of the demo workspace through the existing tenant-cascade mechanism,
  with `PlatformAuditEvent` excluded by design because audit history must
  outlive the tenant it describes. No redundant explicit deletion is added.
  *(Amended by `CHG-002`; the original wording assumed HR records survived a
  reset, which the repository contradicts.)*
- `FR-012` — The demo reset restores the Sales baseline, the HRMS baseline and
  the demonstration personas.
- `FR-013` — Seed and reset are idempotent: running either twice leaves one
  baseline, not a duplicated or partial one.
- `FR-014` — The generated dataset is deterministic under the existing seed key,
  so that a screenshot, a defect report and a rehearsal describe the same rows.
- `FR-015` — A coverage check enumerates tenant-scoped models and fails when a
  model is neither cleared by the reset nor listed in a reviewed exclusion list.
- `FR-016` — Demonstration documentation states the personas, the walkthrough,
  the seed command and the reset command.
- `FR-017` — Exactly one persona is designated the **client-facing**
  demonstration credential. A single authenticated session of that account
  reaches both the Sales and the HRMS module without re-authentication and
  without a workspace switch, and the account holds no platform role. The other
  personas remain as security fixtures and are not client-facing credentials.
  *(Added by `CHG-003`.)*

## Non-functional requirements

- `NFR-001` — Seed and reset introduce no new runtime or build dependency.
- `NFR-002` — Seed and reset behave identically on Windows and Linux, the two
  hosts this repository supports.
- `NFR-003` — Seed and reset complete without manual intervention. No duration
  threshold is asserted here; see `CL-005`.
- `NFR-004` — The dataset volume stays within the demo workspace limits already
  configured for it.

## Security requirements

- `SEC-001` — The four existing environment refusal gates on the demo seed are
  preserved unweakened. This specification adds no bypass, no override flag and
  no environment exemption.
- `SEC-002` — The demo reset fails closed: it refuses to run where the
  environment declarations or the target database name do not both mark a
  disposable environment, and the refusal happens before any deletion.
- `SEC-003` — The demonstration personas hold only the existing catalogue
  grants for their roles. No permission is added, widened or created, and the
  Management persona holds no platform role.
- `SEC-004` — Tenant isolation is preserved and proven in both directions: a
  demonstration persona reaches no other workspace, and no other workspace
  reaches the demo workspace.
- `SEC-005` — Role boundaries are proven at the API rather than the navigation,
  positively and negatively, for the Sales and HR personas.
- `SEC-006` — No action available to a demonstration persona dispatches a
  message, webhook or document to a real external recipient.
- `SEC-007` — No credential value appears in source, in an evidence file, in
  test output or in an application log.

## Data and privacy requirements

- `DATA-001` — The dataset contains no real person's name, email address,
  telephone number or employee identifier.
- `DATA-002` — The dataset contains no biometric record, face template,
  biometric consent or attendance capture image.
- `DATA-003` — The dataset contains no bank account, IBAN, WPS identifier,
  compensation record, payroll run or payslip.
- `DATA-004` — No record is copied, derived or transformed from production data.
- `DATA-005` — Every **generated** electronic address sits on a domain reserved
  for demonstration use, so that a misdirected message cannot reach a real
  mailbox. Exactly one address is exempt: the single client-facing login named
  in `FR-017`, which must sit on a domain the organisation controls. No
  generated record may use that domain. *(Amended by `CHG-004`, approved
  2026-09-09. The exemption is one named address, not a pattern.)*

## Observability requirements

- `OBS-001` — Seed and reset report per-model record counts on completion, so
  an operator can see what was built or removed.
- `OBS-002` — A refused reset states which gate refused it, without printing a
  connection string or a credential.

## Failure behaviour

A refused seed or reset exits non-zero and changes nothing. A reset that fails
part way leaves the workspace in a state a re-run repairs, because the reset is
followed by a re-seed and both are idempotent (`FR-013`). A missing demo
workspace is a refusal, not an implicit creation. A model absent from both the
reset and the exclusion list fails the coverage check (`FR-015`) rather than
being silently skipped.

## Edge cases

First run against an empty database; a second run over an already-seeded
workspace; a reset run twice; a workspace where only one product module is
entitled; an employee with no manager, at the top of the hierarchy; a leave
request whose approver is the requester's manager; attendance spanning a
holiday; a persona whose membership has been deactivated; a model added to the
schema after this specification is written.

## Acceptance criteria

- `AC-001` — The HR persona can open every HR screen in the walkthrough and
  each renders populated data. *(covers `FR-001`, `FR-002`, `FR-003`, `FR-004`,
  `FR-005`, `FR-006`, `FR-007`, `FR-008`)*
- `AC-002` — The Sales persona can complete the Sales walkthrough against the
  existing dataset. *(covers `FR-009`)*
- `AC-003` — All three personas authenticate and land in the demo workspace
  with the scope their role grants. *(covers `FR-010`, `SEC-003`)*
- `AC-004` — After a demonstration that modifies Sales and HR records, a reset
  restores the baseline and the personas. *(covers `FR-011`, `FR-012`,
  `FR-013`)*
- `AC-005` — Two seeds from the same key produce identical natural keys and
  counts. *(covers `FR-014`)*
- `AC-006` — The coverage check fails when a tenant-scoped model is added and
  left out of both the reset and the exclusion list. *(covers `FR-015`)*
- `AC-007` — The demo seed and reset are refused against every environment the
  existing gates refuse today. *(covers `SEC-001`, `SEC-002`)*
- `AC-008` — Cross-tenant access is denied in both directions at the API.
  *(covers `SEC-004`)*
- `AC-009` — The Sales persona is refused HR routes and the HR persona is
  refused Sales routes, each asserted as a status. *(covers `SEC-005`)*
- `AC-010` — No demonstration action dispatches to a real external recipient.
  *(covers `SEC-006`)*
- `AC-011` — The dataset contains no prohibited class of data. *(covers
  `DATA-001`, `DATA-002`, `DATA-003`, `DATA-004`, `DATA-005`)*
- `AC-012` — No credential value appears in source, evidence or logs. *(covers
  `SEC-007`)*
- `AC-013` — Seed and reset report counts, and a refusal names its gate.
  *(covers `OBS-001`, `OBS-002`)*
- `AC-014` — Seed and reset behave identically on both supported hosts and add
  no dependency. *(covers `NFR-001`, `NFR-002`, `NFR-003`, `NFR-004`)*
- `AC-015` — Demonstration documentation is current. *(covers `FR-016`)*

## Dependencies

- `SPEC-0008` provides the environment this dataset is intended to run in. This
  specification does not depend on it for development or verification, which
  happen locally, but a client demonstration needs both.
- The existing seed, role catalogue, tenant guard, RLS policies and rate limits,
  all unchanged.

## Assumptions

- The demonstration runs against a disposable database, never the production
  customer database. Recorded as a business decision, not an inference.
- The existing Sales dataset is adequate for a client demonstration. `FR-009`
  makes this falsifiable rather than assumed: the audit names any gap found.
- The role catalogue's `hr_admin`, `sales_rep` and `org_admin` grants are the
  intended demonstration scopes. Verified against `apps/web/prisma/seed/roles.ts`.

## Open questions

`CL-001` to `CL-006` in `clarifications.md`. None is open at a level that
blocks approval; each carries a recommendation and a stated default.

## Risks

- The dataset makes the product look better than it is on HR screens that are
  thin in reality. Mitigated by `FR-008`, which requires an empty state to be
  correct rather than merely populated.
- A future tenant-scoped model escapes the reset. This is the failure the
  coverage check in `FR-015` exists to prevent.
- `EVC-004` is an open conflict in this area: documentation describes row-level
  security as not yet in force, while the migrations and CI gates indicate it
  is. This specification neither restates nor amends that entry; it cites it,
  and its isolation tests are written against observed behaviour rather than
  against either document.

## Rollback and reversibility expectations

Reversible in full. The change adds seed and test code and touches no schema,
no migration and no production system. Reverting the commit removes the HR
dataset and restores the previous reset. Nothing in a customer environment is
affected, because nothing in this specification runs there.

## Implementation constraints

- The four environment refusal gates in `apps/web/prisma/seed/index.ts` are a
  security contract and may not be weakened, parameterised or bypassed.
- The role catalogue is a contract. Personas use existing roles; this
  specification may not add or edit a role or permission.
- No schema change and no migration. If implementation shows one is required,
  work stops and raises a change record.

## Evidence and existing-system references

- `VERIFIED` — `apps/web/prisma/seed/index.ts` — builds two workspaces, gates
  the run behind four independent environment refusals, generates 500 leads and
  1000 activities, creates departments, branches and employee profiles, and
  contains a reset branch of 47 ordered deletions. **Preserves**; `FR-011`
  extends the reset branch.
- `VERIFIED` — `apps/web/prisma/seed/index.ts` — contains no attendance, leave,
  leave-type, holiday or shift generation. **Changes**: `FR-004` to `FR-007`
  add them.
- `VERIFIED` — `apps/web/prisma/seed/crm.ts` — accounts, contacts, pipeline,
  opportunities, calls, transcripts, analyses, audits, follow-ups, targets,
  campaigns, forms and landing pages. **Preserves**.
- `VERIFIED` — `apps/web/prisma/seed/roles.ts` — the role catalogue containing
  `sales_rep`, `hr_admin` and `org_admin`. **Preserves**.
- `VERIFIED` — `apps/web/src/lib/db.ts` — tenant-guard Prisma extension and its
  exemption list. **Preserves**.
- `VERIFIED` — `apps/web/src/lib/security/entitlements.ts` — per-workspace
  module entitlement. **Preserves**.
- `VERIFIED` — `apps/web/src/lib/startup-check.ts` — cross-checks the declared
  environment against the database name. **Preserves**.
- `VERIFIED` — `apps/web/tests/tenant/isolation.spec.ts` and
  `apps/web/tests/tenant/rls.spec.ts` — existing isolation proofs at the
  application and database layers. **Preserves**; extended with persona cases.
- `DOCUMENTED` — `docs/ENVIRONMENTS.md` — names the demo environment and its
  database, and states that the demo seed is refused in staging and production.
- `DOCUMENTED` — `docs/DEMO.md` — the current demonstration personas.
- `DOCUMENTED` — `docs/TEST-DATA-POLICY.md` — the prohibition this
  specification's data requirements restate for its own dataset.
- `UNKNOWN — requires runtime/infrastructure verification` — whether row-level
  security is active in any deployed environment. Established here only from
  migrations, boot checks and CI gates, which is repository evidence, not
  runtime evidence. See `EVC-004`.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| 2026-09-08 | Created | Agent, PLANNER role | — |

## Approval

| Gate | Role | Decision | Date | Scope of what was approved |
|---|---|---|---|---|
| Specification approval | Product Owner | approved | 2026-09-08 | The scope in `spec.md` §Scope, at R3. Excludes `SPEC-0008`, infrastructure, DNS, TLS, deployment, production and staging access, production credentials, RLS changes and any new permission or role. |
| Architecture approval | Solution Architect | not required unless a new pattern is introduced | — | — |
| Security risk acceptance | Application Security | self-check at R3; see `threat-model.md` | — | — |
| Implementation readiness | not required at R3 | — | — | — |
