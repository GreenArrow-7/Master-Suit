# Risk Classification

How much process a change needs. Classify by the *highest* level any part of
the change touches. Most day-to-day work is R1–R3; do not inflate.

| Level | Meaning | YOUHAN ONE examples |
|---|---|---|
| **R0** | Experiment, never merged | a spike branch, a local screenshot harness, throwaway scripts in a scratch directory |
| **R1** | Cosmetic / very low risk | copy edits, `.lf-*` styling and token tweaks, a new icon, docs-only changes, a lint-clean rename inside one file |
| **R2** | Normal application change | a new UI screen over existing endpoints, adding a column to a grid, a new `SmartView`, a non-security bug fix in a service, a new unit test |
| **R3** | Backend / business logic | a new `/api/v1` route or changed response shape, new service logic (lead scoring, commission calculation, SLA timers), a new queue job, an integration client change, an additive Prisma migration |
| **R4** | Security / data-sensitive | anything in `src/lib/auth/*` or `src/lib/security/*`, permissions/roles/scopes, visibility or field rules, RLS policies, session or MFA behaviour, audit logging, PII/biometric handling, AI prompt or redaction changes, retention periods, new outbound data flows |
| **R5** | Production-critical / destructive / infrastructure | destructive or long-locking migrations, `infra/*` (Compose, Caddy, Dockerfile, systemd), `.github/workflows/*`, `scripts/release.sh`, backup/restore scripts, secret rotation, environment variables in a deployed environment, host/IAM/DNS/TLS/firewall, anything run against production |

## Required rigour per level

| | R0 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| Spec depth | none | one line in the PR | short spec: goal, scope, out-of-scope | full spec + plan (files, data, deploy, rollback) | full spec + explicit threat/abuse cases | full spec + runbook + blast radius + rehearsal plan |
| Clarification step | no | no | if ambiguous | yes | yes | yes |
| Tests | none | none (visual check) | unit/component + regression if a fix | unit + tenant/permission where relevant + regression | above **plus** a `tests/security` case proving the boundary | above **plus** a rehearsal in staging |
| Security review | no | no | self-check | self-check, flag anything touching authz | mandatory human security review | mandatory human security review |
| Human code review | optional | 1 reviewer | 1 reviewer | 1 reviewer | 2 reviewers (one security-literate) | 2 reviewers + the operator who will run it |
| CI gates | — | full `verify` | full `verify` | full `verify` + `check:drift` | full `verify` + `check:rls` + `check:raw-sql` | full `verify` + staging-first migration gate |
| Production approval | n/a | normal release | normal release | normal release | named approver | named approver **and** a scheduled window; agents may never approve |
| Rollback plan | n/a | implicit | implicit | written | written and tested in staging | written, rehearsed, with a data-restore path |

## Notes

- A change that is R2 in code but adds an env variable to a deployed
  environment is R5 for that part; split the change or take the higher level.
- "Docs-only" is R1 only when it does not assert new security or operational
  guarantees; a runbook that will be followed under pressure is R3.
- An AI agent may prepare any level, and may execute R0–R3 locally. R4
  requires a human to accept the plan before implementation. R5 execution is
  human-only (`AGENTS.md` §7).

## Evidence Sources

Derived from the controls and gates described in
`docs/architecture/*`, `docs/security/*`, `docs/operations/*`,
`.github/workflows/ci.yml` and `apps/web/scripts/*`.
