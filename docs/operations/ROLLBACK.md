# Rollback

Mechanisms that exist today, with their gaps.

| Layer | Mechanism | Evidence | Gap |
|---|---|---|---|
| Code | Git; `main` is the release branch (CI on push to `main`); PRs merge into it | E2 `ci.yml` | Branch protection unknown (E6) |
| Application release | `scripts/release.sh rollback <env>` restarts the previously recorded image tag (`<env>.previous`) with `up -d --no-build`; refuses when no previous tag or the image is gone ("rebuild that commit"); swaps current/previous state files. Callable from `deploy.yml` (`action: rollback`) | E1 `release.sh`; E2 `deploy.yml` | Only one step back; depends on images still in the local daemon; no health-gated automatic rollback |
| Container image | Images tagged by commit stay in the host daemon; GHCR images exist only if `build-images.yml` was run for that SHA | E1/E2 | Deploy path does not pull from GHCR, so a lost host loses its rollback set (**EVC-012**) |
| Database migration | **None.** `prisma migrate deploy` has no down path; `release.sh` says so explicitly; `check-staging-first.mjs` reduces risk by requiring staging success first | E1 | Any backward-incompatible migration makes application rollback unsafe; expand/contract discipline is not codified (see `AGENTS.md` §4) |
| Data | Restore from backup into a scratch database (`restore-verify.sh`); a live restore procedure is prose in `docs/BACKUP-RECOVERY.md` | E2/E4 | Never rehearsed in production (`docs/OPERATIONAL-READINESS.md`) |
| Configuration | `.env.<env>` files on the host are outside git; no versioning mechanism found | E2 negative | A bad config change has no recorded previous state unless the operator kept one |
| Edge / host | Caddy config in git; host state via `provision-host.sh` (idempotent) | E2 | VM/NSG/DNS are manual `az` steps (`docs/DEPLOY-AZURE.md`) |
| Queues / cache | Redis job payloads and cached permissions survive a rollback; queue names and job shapes are contracts | E1 `queue.ts` | A rollback across a job-shape change can strand jobs; not codified |
| Secrets | `rotate-field-encryption-key.mjs` re-wraps forward; `rotate-face-token.sh` keeps a previous-token window | E2 | No reverse rotation; a lost `FIELD_ENCRYPTION_KEY` is unrecoverable by design |

Runbook pointers: `docs/DEPLOY-AZURE.md` "Rollback", `docs/ENVIRONMENTS.md`
(migration order), `docs/BACKUP-RECOVERY.md`.

Rollback history in production: `UNKNOWN — requires runtime/infrastructure
verification`.

## Evidence Sources

E1: `apps/web/scripts/release.sh`, `scripts/check-staging-first.mjs`,
`src/lib/queue.ts`, `scripts/rotate-*`.
E2: `.github/workflows/deploy.yml`, `build-images.yml`, `ci.yml`,
`infra/provision-host.sh`, `scripts/restore-verify.sh`.
E4: `docs/DEPLOY-AZURE.md`, `docs/BACKUP-RECOVERY.md`,
`docs/OPERATIONAL-READINESS.md`, `docs/ENVIRONMENTS.md`.
