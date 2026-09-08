# Phase A Gap Analysis

Gaps observed while documenting the system on 2026-09-07. Nothing here was
remediated in Phase A except documentation itself. Priorities: **P0** blocks
a safe production release · **P1** before Phase B implementation work · **P2**
soon after · **P3** opportunistic.

## Architecture

**GAP-ARCH-01** — Documented layering does not exist
- Current state: route → service → Prisma; 136 route files import `@/lib/db`; no repository layer; no server actions.
- Evidence: `apps/web/src/app/api/**`, `src/services/**`, vs `apps/web/docs/00-ARCHITECTURE.md` §2 (EVC-001).
- Gap: the architecture document an agent would read first is wrong about the data path.
- Risk: agents introduce or search for a layer that does not exist; review comments cite a non-existent rule.
- Recommended action: decide the intended layering, then either update §2 or plan the refactor as its own R3 change.
- Priority: P1 · Phase: B (documentation), C (any refactor)

**GAP-ARCH-02** — Queue documentation lists queues that do not exist
- Current state: 9 queues in `src/lib/queue.ts`; §5 names `messaging`, `import`, `export` instead of `media`, `ai`, `notifications`, with concurrencies not present in code.
- Evidence: EVC-002.
- Risk: runbooks and alerts keyed to wrong names; capacity assumptions wrong.
- Recommended action: rewrite §5 from `queue.ts` and `src/workers/*`.
- Priority: P2 · Phase: B

**GAP-ARCH-03** — No generated API specification
- Current state: `npm run openapi` points at a missing script; no OpenAPI artifact.
- Evidence: EVC-006.
- Risk: integrators and a future mobile client have no machine-readable contract; the hand-written route surface drifts.
- Recommended action: restore the generator from the Zod route specs and run it in CI.
- Priority: P2 · Phase: B/C

## Security

**GAP-SEC-01** — 38 route files bypass the API kernel
- Current state: 136 `route()`, 10 `guarded()`, 38 raw handlers.
- Evidence: `apps/web/src/app/api/**` (SEC-OBS-002, EVC-010).
- Gap: no inventory of what each raw handler checks.
- Risk: an unauthenticated or unscoped write endpoint could exist unnoticed.
- Recommended action: enumerate all 38, record auth/tenant/validation/rate-limit per route, add tests for the intentionally public ones.
- Priority: **P0** · Phase: B (first security task)

**GAP-SEC-02** — Route authorization matrix is stale
- Current state: `security/APPLICATION_ATTACK_SURFACE.md` is accurate for 2026-08-08 only.
- Evidence: EVC-010.
- Risk: security review believes it is complete.
- Recommended action: generate the matrix from route specs in CI.
- Priority: P1 · Phase: B

**GAP-SEC-03** — CSP allows `'unsafe-inline'` scripts
- Current state: `script-src 'self' 'unsafe-inline'` in production.
- Evidence: `src/proxy.ts` (SEC-OBS-001).
- Risk: the defence-in-depth layer against XSS is largely inert.
- Recommended action: evaluate nonce-based CSP with the current Next build.
- Priority: P2 · Phase: C

**GAP-SEC-04** — No secret scanning or SAST in CI; no Python dependency audit
- Current state: CI runs `npm audit --omit=dev --audit-level=high` only.
- Evidence: `.github/workflows/ci.yml`, `docs/DEPENDENCY-SECURITY.md` (SEC-OBS-006).
- Risk: a committed credential or a known `apps/face` CVE would not fail a build.
- Recommended action: add a secret scanner and `pip-audit`; run a one-off history scan.
- Priority: P1 · Phase: B

**GAP-SEC-05** — Secrets are container environment variables
- Current state: `.env.<env>` passed wholesale; `_FILE` support exists but is unused in compose files.
- Evidence: `scripts/release.sh`, `infra/docker-compose*.yml`, `docs/DEPLOY-AZURE.md` (SEC-OBS-003).
- Risk: full credential exposure to anything with host or container access.
- Recommended action: adopt `_FILE` + Docker secrets for the cryptographic keys first.
- Priority: P2 · Phase: C

**GAP-SEC-06** — Deploy may accept an SSH host key on first use
- Current state: `deploy.yml` warns and proceeds when `DEPLOY_KNOWN_HOSTS_<ENV>` is unset.
- Evidence: `.github/workflows/deploy.yml` (SEC-OBS-005).
- Risk: MITM against the deploy runner.
- Recommended action: set the secret for both environments; make it required.
- Priority: P1 · Phase: B (configuration, human-executed)

**GAP-SEC-07** — Log redaction is one level deep
- Current state: pino wildcards cover depth 1.
- Evidence: `src/lib/logger.ts` (SEC-OBS-007).
- Risk: a nested credential reaches stdout.
- Recommended action: audit `logger.*` call sites that pass request-shaped objects; deepen paths.
- Priority: P2 · Phase: C

## Testing

**GAP-TEST-01** — Three unit specs are platform-dependent
- Current state: 12 failures on Windows (path separators, CRLF parsing, POSIX modes); LF in the index, so Linux CI is expected to pass.
- Evidence: EVC-014.
- Risk: contributors cannot trust a local red suite; a real failure hides among the environmental ones.
- Recommended action: add `.gitattributes` (`* text=auto eol=lf`) and platform guards in the three specs.
- Priority: P1 · Phase: B

**GAP-TEST-02** — CI result not verifiable from this environment
- Current state: `gh` unauthenticated; last green `verify` run unknown.
- Evidence: attempted `gh run list` (E6).
- Risk: local claims about CI health are unproven.
- Recommended action: authenticate `gh` or check the Actions tab before any release claim.
- Priority: P1 · Phase: B

**GAP-TEST-03** — No coverage measurement
- Current state: 152 unit/integration specs + 14 e2e; no coverage threshold or report in CI.
- Evidence: `vitest.config.mts`, `ci.yml` (negative).
- Risk: untested paths are invisible; SDD "tests required" has no metric.
- Recommended action: enable coverage reporting (not necessarily a gate) for the security-critical directories.
- Priority: P2 · Phase: C

**GAP-TEST-04** — `apps/face` has one test
- Current state: `test_tokens.py` covers token rules only; the recognition path is untested.
- Evidence: `apps/face/`.
- Risk: a biometric-matching regression ships unnoticed.
- Recommended action: add fixture-based tests for `/analyse` behaviour and thresholds.
- Priority: P2 · Phase: C

## CI/CD

**GAP-CI-01** — Branch protection and required checks unknown
- Current state: not visible in the repository.
- Evidence: E6.
- Risk: `main` could accept an unverified merge; the deploy gate assumes a `verify` run exists.
- Recommended action: confirm protection rules and required status checks.
- Priority: P1 · Phase: B (human verification)

**GAP-CI-02** — E2E runs only on push or PRs targeting `main`
- Current state: conditional steps in `ci.yml`.
- Evidence: `.github/workflows/ci.yml`.
- Risk: feature-branch PRs merge without e2e evidence.
- Recommended action: accept explicitly, or run a smoke subset on all PRs.
- Priority: P3 · Phase: C

**GAP-CI-03** — CI Node major differs from the shipped image
- Current state: CI Node 24, container Node 22.
- Evidence: EVC-009.
- Risk: a version-specific defect is not caught.
- Recommended action: align, or add a matrix job on 22.
- Priority: P2 · Phase: C

## Deployment

**GAP-DEP-01** — Active production mechanism unconfirmed
- Current state: repository describes `release.sh` + Compose on an Azure VM; the live path is not verifiable here.
- Evidence: EVC-003 (E6).
- Risk: documentation-driven operations against a system that differs.
- Recommended action: record the deployed commit, running containers and compose overlay on the host.
- Priority: **P0** · Phase: B (human verification)

**GAP-DEP-02** — Rollback depends on images on one host
- Current state: `release.sh` rolls back to the previous locally built tag; GHCR images exist but the deploy path never pulls them.
- Evidence: EVC-012.
- Risk: host loss removes the ability to roll back quickly.
- Recommended action: decide whether the deploy path should pull from GHCR; if yes, wire it once and test a rollback in staging.
- Priority: P1 · Phase: C

**GAP-DEP-03** — Stale deployment document still present
- Current state: `docs/DEPLOYMENT.md` (2026-08-05) contradicts the current runbook.
- Evidence: EVC-003.
- Recommended action: replace its body with a pointer to `docs/operations/DEPLOYMENT.md` and `docs/DEPLOY-AZURE.md` (documentation-only change, not done in Phase A because it edits an existing document).
- Priority: P2 · Phase: B

## Backup / Restore

**GAP-BAK-01** — Production backup status unknown; readiness checklist contradicts the backup docs
- Current state: full backup tooling and systemd units exist; the database half was verified off-deployment on 2026-08-20; `docs/OPERATIONAL-READINESS.md` still shows every backup row unticked.
- Evidence: EVC-005.
- Risk: **data loss** — the failure mode this control exists for.
- Recommended action: on the host, confirm the three timers, the newest manifest, and run one `restore-verify.sh` including objects; then update the checklist.
- Priority: **P0** · Phase: B (human verification)

**GAP-BAK-02** — Object-storage restore never exercised
- Current state: `mc mirror` paths written against MinIO's client, never run against a live bucket.
- Evidence: `docs/BACKUP-RECOVERY.md` "Verification status".
- Risk: a database restore succeeds while every document, recording and capture is gone.
- Recommended action: one full `backup.sh` → `restore-verify.sh` cycle with a non-zero object count.
- Priority: **P0** · Phase: B

**GAP-BAK-03** — No stated RPO/RTO; backup encryption optional
- Current state: nightly schedule implies ~24 h RPO; nothing states it. `BACKUP_PASSPHRASE` is optional unless `BACKUP_REQUIRE_ENCRYPTION=1`.
- Evidence: `scripts/backup.sh`, `docs/OPERATIONAL-READINESS.md` §2.4 (SEC-OBS-008).
- Risk: recovery expectations unagreed; unencrypted off-host copies.
- Recommended action: write RPO/RTO into `docs/operations/BACKUP_RESTORE.md`; require encryption in production.
- Priority: P1 · Phase: B

## Rollback

**GAP-ROLL-01** — No database rollback path
- Current state: `migrate deploy` has no down path; `release.sh rollback` deliberately does not touch the database.
- Evidence: `scripts/release.sh`, `docs/ENVIRONMENTS.md`.
- Risk: a backward-incompatible migration makes application rollback unsafe; the only recovery is a restore.
- Recommended action: codify expand → migrate → contract for schema changes (now stated in `AGENTS.md` §4) and require a written data-rollback plan for R5 migrations.
- Priority: P1 · Phase: B

**GAP-ROLL-02** — Configuration has no versioned previous state
- Current state: `.env.<env>` lives on the host, outside git, with no history.
- Evidence: `scripts/release.sh`, `docs/DEPLOY-AZURE.md`.
- Risk: a bad configuration change cannot be reverted precisely.
- Recommended action: keep a checked-in, value-free key manifest per environment and a host-side timestamped copy procedure.
- Priority: P2 · Phase: C

**GAP-ROLL-03** — Rollback never rehearsed
- Current state: mechanism exists; no record of an executed rollback.
- Evidence: `docs/OPERATIONAL-READINESS.md`.
- Recommended action: rehearse `release.sh rollback staging` once and record it.
- Priority: P1 · Phase: B

## Observability

**GAP-OBS-01** — Logs are not shipped anywhere
- Current state: pino JSON to stdout, Docker json-file 10 MB × 5, no collector.
- Evidence: `infra/docker-compose*.yml`, `docs/OBSERVABILITY.md`.
- Risk: post-incident analysis is limited to what is still on the host.
- Recommended action: choose a destination before a second host exists.
- Priority: P1 · Phase: C

**GAP-OBS-02** — No exception tracking, no tracing
- Current state: none in dependencies or config.
- Evidence: `package.json` (negative), `docs/OBSERVABILITY.md`.
- Risk: 5xx have no stack-level visibility; slow requests attribute to a module, not a query.
- Recommended action: adopt an error tracker first (cheaper, higher value than tracing).
- Priority: P2 · Phase: C

**GAP-OBS-03** — Alert delivery unproven
- Current state: 12 rules and an Alertmanager config exist; delivery in production unverified.
- Evidence: E6.
- Risk: silent monitoring — the failure mode the alerting was built to remove.
- Recommended action: fire one test alert end to end and record it.
- Priority: P1 · Phase: B (human verification)

## Documentation

**GAP-DOC-01** — Large, partly stale documentation set
- Current state: 80 files in `docs/`, 10 in `apps/web/docs/`, 3 in `security/`, 1 in `testing/`, dated 2026-08-03 → 08-26; several short 2026-08-05 files are superseded (EVC-001, -002, -003, -004, -007, -011).
- Risk: an agent reads a stale file and acts on it.
- Recommended action: add a status header (`Current` / `Superseded by …` / `Historical`) to each legacy document; do not delete.
- Priority: P1 · Phase: B

**GAP-DOC-02** — Conflicting operational status documents
- Current state: `docs/OPERATIONAL-READINESS.md` vs `docs/BACKUP-RECOVERY.md` (EVC-005).
- Recommended action: update the checklist from the verified evidence, keeping the unverified rows unticked.
- Priority: P1 · Phase: B

**GAP-DOC-03** — Two ADR directories, duplicate numbering
- Evidence: EVC-013.
- Priority: P3 · Phase: C

## SDD Readiness

**GAP-SDD-01** — No spec/plan templates or storage location
- Current state: `AGENTS.md` now names the workflow; there are no templates, no `docs/specs/`, no numbering scheme.
- Gap: nothing to fill in, so the workflow will be skipped.
- Recommended action: add `docs/specs/TEMPLATE.md` (requirement, scope, out-of-scope, security/test design, tasks, verification, rollback) and a naming convention.
- Priority: **P0 for Phase B** · Phase: B (first task)

**GAP-SDD-02** — No definition-of-done checklist in the PR flow
- Current state: `AGENTS.md` §8 exists; no PR template enforces it.
- Recommended action: add `.github/pull_request_template.md` mirroring §8 and the risk level.
- Priority: P1 · Phase: B

**GAP-SDD-03** — No traceability from requirement to test
- Current state: tests are named descriptively but not linked to specs.
- Recommended action: reference the spec id in the spec file and in the test description for R3+ changes.
- Priority: P2 · Phase: C

## Agentic Engineering Readiness

**GAP-AGENT-01** — `AGENTS.md` and `CLAUDE.md` did not exist until now
- Current state: created in Phase A; not yet exercised by any agent run.
- Recommended action: use them for the first Phase B task and revise from what actually went wrong.
- Priority: P1 · Phase: B

**GAP-AGENT-02** — No machine-readable route/permission inventory for agents
- Current state: an agent must grep 173 files to answer "what protects this route".
- Evidence: GAP-SEC-01/02.
- Recommended action: the generated authorization matrix doubles as agent context.
- Priority: P1 · Phase: B

**GAP-AGENT-03** — Windows/Linux divergence trips agent verification
- Current state: `prettier --check .` flags 870 files locally; three unit specs fail locally.
- Evidence: EVC-014, this workstream's verification runs.
- Risk: agents "fix" environmental noise, producing large spurious diffs.
- Recommended action: `.gitattributes`, and a documented Windows verification recipe (`--end-of-line auto`), now recorded in `docs/standards/CODING_STANDARDS.md`.
- Priority: **P0 for agent work** · Phase: B

**GAP-AGENT-04** — No sandbox/staging target an agent may safely exercise
- Current state: local Docker only; staging exists in config but access is human-only.
- Recommended action: define what an agent may run against staging, if anything.
- Priority: P2 · Phase: C

## Evidence Sources

E1: `apps/web/src/**`, `apps/face/**`, `apps/web/scripts/*`.
E2: `apps/web/package.json`, `infra/**`, `.github/workflows/*`,
`vitest*.mts`, `playwright.config.ts`, `.prettierrc.json`.
E3: `apps/web/tests/**` (local run 2026-09-07: 297 pass / 12 environmental
failures).
E4: `docs/**`, `security/**`, `testing/**`, `apps/web/docs/**`.
Unverified (E6): production deployment, backup execution, alert delivery,
branch protection, GitHub environment reviewers, CI's latest result.
Cross-reference: `docs/EVIDENCE_CONFLICTS.md`,
`docs/security/SECURITY_OBSERVATIONS.md`.
