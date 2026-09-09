# SPEC-0007 — Plan

| Field | Value |
|---|---|
| Specification | `SPEC-0007` |
| Risk | `R3` |
| Last updated | 2026-09-08 |

How the requirements in `spec.md` are built. No code exists; nothing here is
authorised until gate 1 is recorded.

## Approach

Three pieces of work, in dependency order: a synthetic HR dataset generator, an
extension to the existing reset, and verification. The Sales half is an audit,
not a build.

The controlling design principle is that this specification adds **data and
tests**, not behaviour. No route, no service, no library, no schema and no
security control is modified. Everything the demonstration relies on for
isolation and authorization already exists and is cited in `spec.md`.

## Architecture decisions

- `AD-001` — The HR generator lives beside the existing seed modules and is
  invoked by the existing seed entry point, rather than becoming a second
  seeding tool. One entry point means one set of environment gates. A separate
  script would need its own copy of the four refusals, and a copied gate is a
  gate that drifts.

- `AD-002` — The HR generator is a new module, not an extension of the CRM
  module. The CRM module is 1560 lines and already single-purpose; HR data
  shares none of its record shapes. New file: apps/web/prisma/seed/hr.ts

- `AD-003` — Generation is deterministic from the existing seed key, using the
  same seeded-sequence approach the CRM module already uses, so that
  screenshots and defect reports stay valid across re-seeds (`FR-014`).

- `AD-004` — Volume records are written with bulk creates and skip-duplicates,
  and configuration records with upserts, which is the pattern the existing
  seed uses for idempotence (`FR-013`). Attendance is the only high-volume
  table here and is generated per employee per working day, excluding the
  seeded holidays.

- `AD-005` — The reset is extended in place rather than rewritten. The existing
  47 ordered deletions stay; HR deletions are added ahead of them in the order
  the foreign keys require, and the demo workspace, its role catalogue and the
  three persona memberships are preserved so that credentials survive a reset.

- `AD-006` — Generated electronic addresses use a domain reserved by standard
  for documentation and testing, so an address cannot resolve to a real
  mailbox. This is defence in depth behind `SEC-006`, not the primary control.

- `AD-007` — The reset coverage check is catalogue-driven rather than a
  hand-maintained list. It reads the tenant-scoped models from the schema and
  compares them against the set the reset clears plus a reviewed exclusion
  list. A hand-maintained list is exactly what produced the gap in `CL-003`.

- `AD-008` — The coverage check is a test, not a runtime guard. It must fail a
  developer's run when a model is added, which is a build-time concern; making
  it a runtime check would move the failure to the operator running a reset,
  who cannot fix it.

- `AD-009` — Employee, department and designation records reuse the models the
  seed already creates for the demo workspace rather than introducing parallel
  records, so the HR module and the Sales module continue to describe the same
  people.

## Affected files and components

Existing files to be modified:

- `apps/web/prisma/seed/index.ts` — invoke the HR generator; extend the reset
  branch with HR deletions.
- `docs/DEMO.md` — personas, walkthrough, seed and reset commands.

New files to be created (named in plain text because they do not exist yet, and
a specification must not cite a document that cannot be resolved):

- apps/web/prisma/seed/hr.ts — the HR dataset generator.
- apps/web/tests/hr/demo-dataset.spec.ts — dataset invariants and determinism.
- apps/web/tests/hr/demo-reset-coverage.spec.ts — the coverage check.
- apps/web/tests/tenant/demo-personas.spec.ts — persona isolation cases.
- apps/web/tests/security/demo-personas.spec.ts — negative authorization and
  external-dispatch cases.
- apps/web/tests/e2e/demo-walkthrough.spec.ts — the three walkthroughs.

Directories used as task scope: `apps/web/prisma/seed/`, `apps/web/tests/hr/`,
`apps/web/tests/tenant/`, `apps/web/tests/security/`, `apps/web/tests/e2e/`.

## Data model impact

**None.** No model is added, altered or removed. No migration is written. Every
record the HR generator writes uses a model that exists today, and the schema is
the evidence: the HR models the generator targets are already declared and
already carry their tenant column and their row-level-security policy.

`npm run check:drift` must remain clean, and it is listed as a required check
precisely because "no schema change" is a claim that should be verified rather
than asserted.

## Security impact

Nothing in the authorization path changes. Specifically unchanged: session
resolution, tenant derivation, the tenant-guard extension in
`apps/web/src/lib/db.ts`, row-level-security policies, module entitlement in
`apps/web/src/lib/security/entitlements.ts`, permission and scope evaluation in
`apps/web/src/lib/security/rbac.ts`, the role catalogue, rate limits, lockout
and password policy.

What the work adds is **evidence** about that path: persona-level isolation and
negative-authorization tests that did not exist. The threat model records what
those tests must prove.

The one security-relevant behaviour change is the reset's blast radius, which
grows to include HR records. That is the point of `FR-011`, and `SEC-002` plus
the preserved gates in `SEC-001` are what keep it aimed at a disposable
database.

## Deployment impact

**None.** No environment variable, no compose file, no workflow, no secret, no
queue and no cache key. The demo environment this dataset is intended for is
`SPEC-0008` and is deliberately not part of this specification.

## Rollback

Revert the commit. The HR dataset disappears from future seeds and the reset
returns to its previous coverage. No deployed system is affected because
nothing here runs in one, and no migration exists to reverse. A database that
already holds the HR demo data is disposable by definition; re-running the
previous reset and seed returns it to the earlier baseline.

## Verification strategy

`test-plan.md` holds the detail. In outline: unit tests prove the dataset
invariants, determinism and the coverage check; integration tests prove seed
and reset behaviour and persona access; security tests prove isolation,
negative authorization and the absence of external dispatch; end-to-end tests
walk the three demonstrations. All land in harnesses that already exist —
`apps/web/vitest.config.mts`, `apps/web/vitest.server.mts` and
`apps/web/playwright.config.ts` — and no new harness is introduced.

## Sequencing

1. HR generator, with its dataset-invariant tests written first.
2. Reset extension, with the coverage check written first.
3. Sales audit, filling only what it proves empty.
4. Persona isolation and negative-authorization tests.
5. End-to-end walkthroughs.
6. Documentation.

Steps 1 and 2 are independent and may proceed in parallel. Step 3 depends on
neither. Steps 4 and 5 depend on 1.

## Assumptions and unknowns

- Assumed: the HR screens render from the models the generator targets. Any
  screen that reads from a model not covered is a finding for the audit in
  `FR-008`, not a silent omission.
- Unknown: whether any HR screen requires a record shape the demo workspace
  cannot produce without payroll data. `CL-004` bounds this.
- Unknown, and out of reach from the repository: the behaviour of any deployed
  environment. Nothing in this plan depends on it.
