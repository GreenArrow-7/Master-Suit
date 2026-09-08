# 03 — Runtime and infrastructure unknowns

**Phase:** B4.0 · **Date:** 2026-09-08

Every prerequisite carries an evidence level. Where runtime proof is absent the
exact phrase is used, not a softer one.

## Prerequisites

| Prerequisite | Level | Basis |
|---|---|---|
| Local development environment | **VERIFIED** | `apps/web/SETUP.md`, `docs/LOCAL-DEVELOPMENT.md`; loopback Docker services and disposable data |
| Environment separation is documented | **DOCUMENTED** | `docs/operations/ENVIRONMENTS.md`; `tests/unit/environment-separation.spec.ts` exists |
| Deployment process | **DOCUMENTED**, contested | `docs/operations/DEPLOYMENT.md`. `EVC-003` records two descriptions of the deployment mechanism; `EVC-012` records two artifact paths |
| Rollback capability | **DOCUMENTED** | `docs/operations/ROLLBACK.md`. Never exercised from this workstation |
| Backup and restore | **UNKNOWN — requires runtime/infrastructure verification** | `EVC-005` records the readiness checklist disagreeing with the backup documentation and scripts. Unresolved |
| Observability | **DOCUMENTED** | `docs/operations/OBSERVABILITY.md`; `tests/unit/observability.spec.ts` exists and fails on Windows for POSIX file-mode reasons (`EVC-014`) |
| Structured logging | **VERIFIED** | pino is a declared dependency and the logging standard is written |
| Application health checks | **DOCUMENTED** | described in the operations set; not exercised here |
| Test environment availability | **VERIFIED** for unit; **UNKNOWN** for server and e2e | `vitest.config` excludes `tests/server` and `tests/e2e`; both need a running application, and `tests/server` has its own config that starts one |
| GitHub-hosted CI | **UNKNOWN — requires runtime/infrastructure verification** | never pushed, never run |
| Branch protection | **UNKNOWN — requires runtime/infrastructure verification** | a GitHub setting, not inferable from the tree |
| Required status check | **UNKNOWN — requires runtime/infrastructure verification** | same |
| Production unknowns from Phase A | **UNKNOWN**, unchanged | `docs/PHASE_A_GAP_ANALYSIS.md`; none closed by B1, B2 or B3 |
| Secrets and configuration | **DOCUMENTED** | `docs/security/SECRETS_AND_CONFIG.md`. No `.env` was read in any phase |
| Database access boundaries | **VERIFIED** in code | three layers: `Ctx.tenantId` filter, Prisma tenant-guard extension, PostgreSQL `FORCE ROW LEVEL SECURITY`. `EVC-004` records the RLS rollout document contradicting the migrations |
| Authentication boundaries | **VERIFIED** in code | argon2, MFA enrolment, session handling all present. `EVC-011` records a naming inconsistency in remediation notes |
| Tenant isolation | **VERIFIED** in code, **UNTESTED** here | `npm run test:tenant` exists; not run in B4.0, which changes no application code |
| Node version | **UNKNOWN**, contested | `EVC-009` records the version differing across manifests and runtimes. Local is v24.18.0; the container is `node:22-alpine`; CI pins 24 |

## Evidence conflicts still open

**Ten of fifteen** entries in `docs/EVIDENCE_CONFLICTS.md` are `OPEN`. None was
closed by B1, B2 or B3, and B4.0 closes none — closing any would require
production or staging verification that this phase is forbidden from doing.

The ones that would bear on a *release*, as opposed to a controlled local
pilot: `EVC-003` (deployment mechanism), `EVC-005` (backup capability),
`EVC-012` (artifact paths), `EVC-009` (Node version).

## What this means for a pilot

None of the unknowns above blocks **local, branch-controlled development**.
Every one of them bears on staging or release, which B4.0 does not claim.

The distinction is drawn explicitly in `12-phase-b4-readiness-summary.md` and
must not be collapsed: a system can be ready to be worked on and not ready to
be shipped from.
