# Production readiness — operator packet

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Authorization held | read-only production diagnostics; staging deployment — **both granted** |
| Execution status | **NOT EXECUTED — capability absent, not permission** |
| Prepared by | AI agent |

> **The authorization is not the blocker. The access path is.**
>
> Every check below was authorized. None could be run from this workstation,
> and the reason is mechanical rather than procedural. Per the instruction —
> *"If this workstation does not have the production access path: do NOT
> fabricate access"* — this is the operator packet instead.

## Why nothing could be executed

| Requirement | State | Evidence |
|---|---|---|
| Production host address | **absent** | `DEPLOY_HOST_<ENV>` is a GitHub Actions secret (`deploy.yml:136`) |
| Deploy user | **absent** | `DEPLOY_USER_<ENV>`, same |
| Deploy key | **absent** | `DEPLOY_KEY_<ENV>`, same |
| `.env.production` / `.env.staging` | **absent** | only `.example` files exist locally |
| `gh` authentication | **absent** | `gh auth status` → *"not logged into any GitHub hosts"* |
| Approved deployment mechanism | **unreachable** | `deploy.yml` is `workflow_dispatch`; dispatching it needs `gh` auth |

`~/.ssh/master-saas-key` exists on this workstation, but **no hostname does**,
and using it directly would bypass the approved deployment mechanism the
instruction requires. It was not used.

---

## Packet A — read-only production diagnostics

Run by **DevOps / Production Engineering** on the production host. Read-only:
no writes, no restarts, no configuration or environment mutation, no migration,
no secret rotation, no secret values printed.

| # | Check | Command | Answers |
|---|---|---|---|
| 1 | Deployed version | `docker compose -f infra/docker-compose.prod.yml ps --format json` | image tag, container state |
| 2 | Deployed commit | `docker inspect <web-image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` | exact SHA running |
| 3 | Service health | `curl -sS -o /dev/null -w '%{http_code}' https://<host>/api/health` | one status code |
| 4 | Container health | `docker compose ps` | per-service health column |
| 5 | Worker state | `docker compose logs --since 1h worker \| tail -50` | liveness, crash loops |
| 6 | Error rate | Prometheus `sum(rate(http_requests_total{status=~"5.."}[15m]))` | one number |
| 7 | Response codes | Prometheus `sum by (status) (rate(http_requests_total[15m]))` | counts per status |
| 8 | Recent errors | `docker compose logs --since 24h --tail 500 web \| grep '"level":50'` | **may contain identifiers — filter before sharing** |
| 9 | Redis | `docker compose exec redis redis-cli --no-auth-warning PING` and `INFO stats` | health, evictions |
| 10 | Queue depth | BullMQ queue lengths and last-completed timestamps | backlog |
| 11 | DB connectivity | `docker compose exec web node -e "…SELECT 1"` | up/down |
| 12 | Migration state | `prisma migrate status` against the deployed URL | applied/pending counts |
| 13 | CPU / memory | `docker stats --no-stream` | per-container |
| 14 | Disk | `df -h` and `docker system df` | headroom |
| 15 | Object storage | bucket reachability and a `HEAD` on a known prefix | up/down |
| 16 | Config presence | `docker compose config --services`; env **names only** | presence, never values |

**Return aggregates only.** Item 8 is the one that can surface personal data.

## Packet B — EVC-005, backup and restore

**This is the release-blocking one.** Repository scripts are not evidence that
anything runs.

| # | Question | Command | Required to answer |
|---|---|---|---|
| 1 | Backup service installed? | `systemctl list-unit-files \| grep master-suite-backup` | six units expected |
| 2 | Timer enabled? | `systemctl list-timers master-suite-*` | next/last run |
| 3 | Latest successful DB backup? | `apps/web/scripts/backup-status.sh` | timestamp |
| 4 | Freshness? | same | age vs RPO |
| 5 | Recent failures? | `journalctl -u master-suite-backup --since '7 days ago' \| grep -i fail` | failure history |
| 6 | Retention enforced? | listing of the backup destination with ages | actual, not configured |
| 7 | Object-storage backup? | mechanism + latest success | timestamp |
| 8 | Off-host copy present? | destination listing | fresh copy off the host |
| 9 | Encryption state? | backup artefact inspection — **do not print keys** | encrypted at rest, yes/no |
| 10 | Restore procedure documented? | `docs/BACKUP-RECOVERY.md` vs reality | yes/no |
| 11 | **Latest isolated restore verification?** | `systemctl status master-suite-restore-verify`; `journalctl -u master-suite-restore-verify` | **date and result** |
| 12 | Integrity verified? | row-count or checksum comparison from that run | yes/no |
| 13 | RPO defined and supported? | stated objective vs observed cadence | yes/no |
| 14 | RTO defined and supported? | stated objective vs restore duration | yes/no |

**Disposition rule, restated so it cannot be softened:** if item 11 shows no
successful isolated restore has ever been proven, **`EVC-005` and `BLK-001`
stay BLOCKING**. Authorization to inspect does not close them, and a passing
inspection of items 1–10 does not substitute for item 11.

**Do not run a destructive restore against production.** Isolated restore
verification only.

## Packet C — EVC-004, production RLS

Catalogue and control state only. **Do not query tenant row contents.**

```sql
-- Aggregate control posture. Returns four integers and no customer data.
SELECT
  count(*)                                   AS tenant_owned_tables,
  count(*) FILTER (WHERE c.relrowsecurity)   AS rls_enabled,
  count(*) FILTER (WHERE c.relforcerowsecurity) AS rls_forced,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
```

```sql
-- Role posture: the application role must not bypass RLS.
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

Or simply run the repository's own gate against the deployed URL:
`node apps/web/scripts/check-rls.mjs`.

**Local baseline for comparison:** 181 tenant-owned tables, RLS enabled,
FORCED, policies present, 7 bootstrap tables exempt.

**Disposition rule:** Application Security uses the observed result to
disposition `EVC-004`. Running the query does not close it, and a production
result that disagrees with the local baseline **blocks release**.

## Packet D — staging deployment and verification

Approved mechanism, not an invented one:

```
gh workflow run deploy.yml -f environment=staging -f action=deploy -f ref=<commit>
```

Requires `gh` authentication and the `DEPLOY_*_staging` secrets. Neither is
available here.

Once staging is up, verify: build and exact commit · services and workers
healthy · DB, Redis, storage connectivity · login, logout, session, password
reset, MFA · workspace access, role enforcement, tenant isolation · critical
CRUD, core API, HR/workspace flows · **capture-vault and retention/delete —
the RC-4 regression** · background jobs · integrations · AI assistant where
enabled · logs, health probes, monitoring · documented rollback path and
triggers.

**No production change during staging validation.**

---

## Rollback readiness — preparable locally, and prepared

| Item | State |
|---|---|
| Release candidate | **NONE YET — see below** |
| Prior known-good version | `f16ed677516fb07f31832a5d725e13efb477c34d` (current `HEAD`) |
| Application rollback | `gh workflow run deploy.yml -f environment=production -f action=rollback` — promotes the previously running tag |
| **Migration rollback for RC-4** | **NONE REQUIRED** — verified: no migration added, 66 unchanged, `capturePath String?` unchanged |
| Database rollback | **not required for RC-4**; rows written under the new code hold canonical keys the previous code resolves correctly on POSIX |
| Object-storage implications | none — no object moved, renamed or deleted by this change |
| Rollback triggers | 5xx rate above baseline; health probe failing; worker crash loop; capture read or retention errors appearing after deploy |
| Post-rollback smoke | login, workspace access, one capture read, one retention dry-run |
| **Backup dependency** | **rollback for RC-4 itself needs no restore**, because there is no migration. **But platform rollback capability in general is unproven while `EVC-005` is open** |

**Rollback cannot be called GREEN.** RC-4's own rollback is trivial and
verified; the platform's restore capability underneath it is not, and
`EVC-005` is exactly that gap.

## The release candidate does not exist yet

The RC-4 work is **uncommitted**. `HEAD` is still
`f16ed677516fb07f31832a5d725e13efb477c34d`, and `git status` shows
`captureVault.ts` and `capture-vault.spec.ts` modified in the working tree.

There is therefore **no commit SHA to release**, and no image can be built for
staging. This is not an oversight — committing has not been authorized in this
workstream, and it is not assumed now.

**This is the first action needed before anything in Packet D can run.**

## Production defect register — unchanged

**Zero production-observed defects**, because production has still not been
observed. The register's classification stands:

| Class | Count |
|---|---|
| PRODUCTION-OBSERVED | **0** |
| LOCAL/CI-ONLY | 2 — `BUG-002`, `BUG-003`, both SEV-4, both governance/tooling |
| HISTORICAL | 3 — `BUG-001` (now fixed as RC-4), `BUG-004`, `BUG-005` (both fixed) |
| UNKNOWN | production health in its entirety |

No incident is invented. SEV-1 **0** · SEV-2 **0** · SEV-3 **0** (`BUG-001`
closed by RC-4) · SEV-4 **2**.
