# Rollback package and recovery-time evidence — 2026-09-09

## Rollback

| Field | Value |
|---|---|
| Current production SHA | `c879c6c7f7e8e45e90387a3f764599ba4667dfdc` |
| Current production images | `master-suite/web:c879c6c7f7e8`, `master-suite/worker:c879c6c7f7e8` |
| Candidate | the CI-green head of `rc/incident-2026-09-09` |

### Migration delta — proven on the exact diff, not assumed

```
git diff --name-only c879c6c..HEAD -- apps/web/prisma/migrations   →  0 files
git diff --stat      c879c6c..HEAD -- apps/web/prisma/schema.prisma →  no diff
migrations on disk: production 66, candidate 66
```

**No database migration.** Rollback is therefore a pure image swap, with no
schema step in either direction and no data transformation to undo.

No object-storage change. No environment-variable change
(`git diff c879c6c..HEAD -- apps/web/infra` is empty).

### Rollback commands

```sh
cd /opt/mastersuite/apps/web/infra
IMAGE_TAG=c879c6c7f7e8 docker compose --env-file ../.env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  -f docker-compose.azure.yml -f docker-compose.small-host.yml \
  up -d --no-build web worker
```

`IMAGE_TAG` is mandatory: `docker-compose.prod.yml` resolves the images as
`${IMAGE_TAG:-dev}`, and an omitted tag silently recreates web from
`master-suite/web:dev`. That has already caused one outage on this host.

`scripts/release.sh` implements the same rollback at line 121
(`IMAGE_TAG="${PREVIOUS}" ${DC} up -d --no-build`); prefer it where it applies.

### Rollback trigger thresholds

Roll back on any of: `/api/health` failing after deploy; `ApplicationDown` or
`ServerErrorRateHigh` firing; login failing for a known-good account; the leads
list or workspace dashboard returning 5xx; `TenantGuardTripped` firing.

### Rollback drill — executed, isolated stack, timed

Deploy → roll back → roll forward, against one seeded database, verifying at
each step:

| Step | Image | Healthy in | Leads readable | `DELETE /api/v1/tasks/{id}` |
|---|---|---|---|---|
| 1. deploy candidate | `bug008b` | **3.0 s** | 50 | `404` — handler present |
| 2. roll back | `c879c6c7f7e8` | **4.4 s** | 50 | `405` — handler absent, correct old behaviour |
| 3. roll forward | `bug008b` | **3.4 s** | 50 | `404` |

**Data intact across both swaps:** 500 leads, 2 tenants, unchanged throughout.

### The rollback consideration that matters

The drill re-measured `GET /platform` as an anonymous caller at each step:

| Image | Status | Control-plane markers in the response body |
|---|---|---|
| candidate | `307` | **0** |
| `c879c6c7f7e8` (production today) | `307` | **3** |

**Rolling back re-exposes `BUG-008`.** It is not a reason to avoid rolling back
— an outage is worse — but it means a rollback re-opens a known unauthenticated
disclosure, and that should be a conscious, time-boxed decision with the fix
rolled forward as soon as the triggering fault is understood.

## Recovery time

### There is no approved RTO to compare against

`docs/operations/BACKUP_RESTORE.md:55` — "RPO/RTO: not defined in the
repository". `docs/PHASE_A_GAP_ANALYSIS.md` `GAP-BAK-03` — "No stated
RPO/RTO". `docs/OPERATIONAL-READINESS.md` item 2.4, "Documented RPO and RTO,
agreed with the customer", is unticked.

So `actual <= required` **cannot be answered**. The measurement below is real;
the target it should be judged against does not exist and is a business
decision, not an engineering one.

### Full-service recovery exercise — executed, isolated, from the off-host backup

Restored `20260909T074609Z` pulled from Hetzner, into a stack of its own.
Production untouched.

| Phase | Cumulative | Phase |
|---|---|---|
| T0 recovery starts | 0.0 s | — |
| infrastructure ready (postgres, redis, object store) | 0.1 s | 0.1 s |
| **database restored, grants intact** | 6.0 s | 5.9 s |
| web healthy | 9.0 s | 3.0 s |
| worker up | **11.4 s** | 2.4 s |
| login + critical read + critical write proven | — | ~1 s once credentials were in hand |

Add the off-host pull, measured separately at **47 s**, for a realistic
**≈ 60 s** end-to-end recovery from the off-host copy at the current data
volume.

**Functional proof on the recovered service, not just a health check:**

```
login                      → 200, workspace nityaraai01
GET /api/v1/leads          → 200, the production lead recovered
GET /{slug}/sales/leads    → 200
POST /api/v1/leads         → 200  (critical write)
DELETE /api/v1/leads/{id}  → 200
```

### What the drill exposed, and a correction

The first attempt restored with `pg_restore --no-owner --no-privileges`,
copied from `restore-verify.sh`. The application then could not start:
`permission denied for table PlatformUser` — the flag strips the 203
`GRANT ... TO master_saas_app` statements the dump does contain.

**The runbook was already right.** `docs/BACKUP-RECOVERY.md` uses `--no-owner`
without `--no-privileges` and explicitly says to re-run the role grants. The
error was in the drill, not in the documentation, and this is recorded rather
than quietly fixed.

The narrower true finding: `restore-verify.sh` proves a dump **restores**, but
because it restores without privileges it does not prove the result is usable
**by the application role**. Following the runbook does. Both are now evidenced.

### Honest limits

- One tenant, 500 leads in the rollback stack and 1 lead in production. **A
  recovery proven at this volume is not proven at scale.**
- Credentials: the drill set a password in the isolated restored copy because
  the real account passwords are not held here. A genuine recovery would use
  the real ones; the step is drill scaffolding, not recovery time.
- No DNS, TLS or load-balancer cutover is included. On a real host those add
  time this exercise does not measure.
