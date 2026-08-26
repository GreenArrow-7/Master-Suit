# Performance Report — 2026-08-15

Measured results, not projections. Every number below was produced by
`apps/web/scripts/perf/run-load.mjs` (autocannon) against a **production build**
(`next start` over `.next-prod`) serving the synthetic 10k-user tenant. The
harness, the seeder and the raw scenarios are in the repository; the runs are
repeatable.

## Test environment

| Component  | Spec                                                             |
| ---------- | ---------------------------------------------------------------- |
| Machine    | 11th-gen Intel i5-1145G7 (8 threads), 32 GB RAM, Windows 11 Pro |
| App        | **One** Next.js production process (`next start`)                |
| Database   | PostgreSQL 16 in Docker, same machine, `connection_limit=20`     |
| Redis      | Redis 7 in Docker, same machine                                  |
| Confounds  | DB, Redis, load driver and app share one laptop; no reverse proxy |

This is a developer laptop, not target infrastructure. It *understates* what a
real deployment achieves (dedicated DB, more cores, N app instances behind a
load balancer) but it is honest about relative costs and about which paths
scale with data volume.

## Dataset (synthetic tenant `perf-titan`, `master_saas_perf` database)

| Table          | Rows    |
| -------------- | ------- |
| Platform users | 10,000  |
| Workspace users / memberships | 10,000 each |
| Leads          | 100,000 |
| Activities     | 200,000 |
| Tasks          | 50,000  |
| Calls          | 20,000  |

Seeded by `scripts/perf/seed-perf.mjs` (guarded: refuses non-`*perf*` databases,
refuses production/staging names, requires `ALLOW_PERF_SEED=yes`).

## Scenario results

**Operating range — 10 concurrent connections, 20s per scenario** (the shape of
~500 active sessions whose users click a few times a minute):

| Scenario                          | RPS | p50   | p95    | p99    | Errors |
| --------------------------------- | --- | ----- | ------ | ------ | ------ |
| Readiness (framework floor)       | 174 | 52ms  | 94ms   | 143ms  | 0      |
| Lead list, page 1 of 100k         | 34  | 265ms | 674ms  | 781ms  | 0      |
| Lead list, page 5 (cursor)        | 36  | 256ms | 435ms  | 488ms  | 0      |
| Server search over 100k (`?q=`)   | 19  | 489ms | 788ms  | 980ms  | 0      |
| Role dashboard (SSR, ~15 aggregates) | 11 | 856ms | 1,270ms | 1,321ms | 0    |
| Login burst (argon2 verify path)  | 174 | 53ms  | 104ms  | 151ms  | 0*     |

\* the login burst intentionally hammers one account; ~2,600 responses were
**429** from the per-account/per-IP brute-force limiter. That is the designed
behaviour under a credential storm, counted here as handled, not as failure.

**Saturation — 50 concurrent connections** (deliberate overload of one process):

| Scenario     | RPS | p50     | p95     | Notes                                   |
| ------------ | --- | ------- | ------- | --------------------------------------- |
| Lead list    | 32  | 1,489ms | 1,808ms | Same throughput, latency = queueing     |
| Search       | 27  | 2,000ms | 2,592ms | Some 429s: per-user session limiter     |
| Dashboard    | 10  | 3,746ms | 5,514ms | Aggregation-bound                       |

Throughput at 50 connections equals throughput at 10 — the process saturates
and queues rather than collapsing; **zero** connection errors or timeouts in
every run, and Postgres never exceeded its 20-connection pool.

## What the numbers demonstrate

- **Keyset pagination holds at depth**: page 5 of 100,000 leads costs the same
  as page 1 (256ms vs 265ms p50). This is the direct payoff of the
  `(tenantId, updatedAt DESC, id DESC)` indexes added in this release — before
  them, every page was a per-tenant seq-scan + sort (measured 40× slower on the
  query alone).
- **Search meets the ~800ms p95 target** at operating load on 100k rows.
- **Brute-force protection does not degrade the login path**: legitimate-shaped
  verifies stayed at p95 ~104ms while the limiter absorbed the storm.
- **The dashboard is the most expensive page** (~15 scoped aggregates). At
  operating load it renders in p50 856ms — within the "useful content < 2s"
  target — but it is the first candidate for aggregate caching if dashboards
  become a hot path at scale.

## Observed safe operating range (honest claim)

On **this single-instance laptop environment**: ~30 rps of list/search traffic
with p95 under 800ms, ~10 rps of dashboard renders, and login bursts to ~175
rps — concurrently with zero errors. Extrapolating registered users from
request rates: a 10,000-registered-user tenant with ~500 concurrently active
sessions generates on the order of 5–20 list/search requests per second, which
this single instance already services inside the targets **with the full 10k
dataset**.

We do **not** claim "10,000 concurrent users" from this test. The architecture
is horizontally scalable — instances are stateless (sessions in Postgres, rate
limits and cache in Redis, files in object storage), so concurrency scales with
instance count behind a load balancer — but concurrency beyond what is measured
here must be validated on target infrastructure. The load harness in
`scripts/perf/` is the tool for exactly that.

## Reproducing

```bash
# one-time: database + data
docker exec master-saas-postgres-1 psql -U leadflow -d postgres -c "CREATE DATABASE master_saas_perf OWNER leadflow;"
MIGRATION_DATABASE_URL=postgresql://leadflow:...@localhost:5432/master_saas_perf npx prisma migrate deploy
PERF_DATABASE_URL=postgresql://leadflow:...@localhost:5432/master_saas_perf ALLOW_PERF_SEED=yes node scripts/perf/seed-perf.mjs

# serve the production build against it
DATABASE_URL=postgresql://leadflow:...@localhost:5432/master_saas_perf npm run start:local -- -p 3200

# mint a session, run the scenarios
PERF_DATABASE_URL=... BASE=http://localhost:3200 node scripts/perf/mint-session.mjs
PERF_COOKIE=lf_session=... BASE=http://localhost:3200 node scripts/perf/run-load.mjs --connections 10 --duration 20
```
