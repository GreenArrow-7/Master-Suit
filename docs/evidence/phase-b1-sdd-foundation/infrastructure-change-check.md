# Infrastructure, CI/CD and configuration change check

## Result

**VERIFIED — Phase B1 changed no infrastructure, pipeline, container,
deployment, proxy or environment configuration.**

| Path | Status |
|---|---|
| `.github/` (3 workflows) | UNCHANGED |
| `apps/web/infra/` (Dockerfile, compose files, Caddyfiles, cloud-init, provision-host, pgbouncer, prometheus, alertmanager, systemd units) | UNCHANGED |
| `infrastructure/` | UNCHANGED |
| `apps/web/scripts/` | UNCHANGED |
| `apps/web/next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest*.mts`, `playwright.config.ts`, `postcss.config.mjs`, `.prettierrc.json`, `.prettierignore` | UNCHANGED |
| Root PowerShell launchers | UNCHANGED |
| Tracked `.env*` example files | UNCHANGED |
| Untracked `.env`, `.env.test` | not read for values, not modified |
| `.gitattributes` | **still absent — deliberately, see below** |

Command: `git status --porcelain -- <path>` returned zero entries for each.

## CI/CD explicitly untouched

The B1 brief forbids modifying CI/CD during this phase, and none was
modified. B1 documents reference the existing gates by name so the process
matches the pipeline that already exists; it adds no step, no job and no
required check. Automating specification and traceability checks in CI is
Phase B2 work and is listed as such in `known-limitations.md`.

## `.gitattributes` deliberately not added

Phase A recorded a Windows/Linux verification inconsistency (GAP-AGENT-03,
EVC-014). The obvious remedy is a `.gitattributes` file. B1 measured the
consequence before acting:

| Measurement | Value |
|---|---|
| Tracked files in the repository | 1,192 |
| Tracked files whose index copy is LF while the working copy is CRLF | 1,110 |
| `core.autocrlf` on this machine | `true` |
| `.gitattributes` present | no |

Adding `* text=auto eol=lf` would make git renormalise on the next operation
that touches those files, across roughly 93% of the repository, on top of an
uncommitted UI redesign in the working tree. That is precisely the
"immediately rewrite or normalize existing tracked files without a controlled
impact review" outcome the B1 brief prohibits.

**Decision: documented, not applied.** The analysis and the recommended
controlled remediation are in `known-limitations.md`, carried as a Phase B
follow-up against the existing GAP-AGENT-03 and EVC-014. No repository churn
was created.

## Environment variables and secrets

No environment variable was created, changed or removed. No `.env` file was
read for values. See `secret-scan-result.md`.

## Repository configuration is still not production configuration

Everything above concerns files in the repository. What the deployed
environment actually runs remains
`UNKNOWN — requires runtime/infrastructure verification`, tracked as EVC-003,
EVC-012 and GAP-DEP-01.

## Evidence Sources

E1: `git status --porcelain`, `git ls-files --eol`, `git config --get
core.autocrlf` at commit `f16ed67`.
E2: `.github/workflows/*`, `apps/web/infra/**`, `infrastructure/**`,
`apps/web/scripts/**`, `apps/web/.env*.example`.
E4: `docs/PHASE_A_GAP_ANALYSIS.md` (GAP-AGENT-03),
`docs/EVIDENCE_CONFLICTS.md` (EVC-014).
