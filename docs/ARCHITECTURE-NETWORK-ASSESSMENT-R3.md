# Master Suite — Architecture & Network Configuration Assessment

**Revision 3 · 2026-08-22 · commit `07d39c8`**

> **This is a third assessment, not an update of the second.**
> `ARCHITECTURE-NETWORK-ASSESSMENT.md` records `aede392` and
> `ARCHITECTURE-NETWORK-ASSESSMENT-R2.md` records `f1dd84e`. Both are left as
> written, for the reason each of them gives: an assessment that edits itself is
> no longer a record of anything. This one reads the tree as it stands at
> `07d39c8`, twenty-five commits after R2, and reaches different conclusions
> about several things R2 rated High.
>
> Where a finding has moved, this says so and names the change, so the three
> revisions read as a sequence rather than as three opinions.

Everything below was read out of the codebase, measured against a live
PostgreSQL 16 catalog with all 58 migrations applied, or taken from a rendered
Compose configuration. Where something cannot be determined from the repository
it is marked **UNKNOWN / NOT FOUND** rather than inferred. **No credential value
appears anywhere in this document**; where a secret's handling is discussed,
only its location and its risk are named.

---

## Executive summary

Master Suite is **one Next.js 16.2.12 application**, not a frontend and a
backend. 131,420 lines of TypeScript across 756 files, with a second process of
the same image draining nine BullMQ queues and a 729-line Python sidecar doing
face recognition. One PostgreSQL 16 database holds 197 models — 198 tables — for
every tenant.

**Every P0 and every P1 R2 raised is closed.** So is every P2. Of R2's seven P3
items, one is closed, one was removed, and the remaining five are either
framework-blocked, conditional on something that has not happened, or
explicitly opportunistic.

The headline has moved twice. R1's was a worker that could not start. R2's was
instrumentation nobody scraped. **R3's is that there is no longer a technical
headline** — what limits this system now is a single virtual machine and four
product decisions nobody has made. Both are outside an implementer's authority,
and neither is a defect.

Tenant isolation, which is the property this product cannot be partly right
about, was audited invariant by invariant for this revision rather than sampled.
**No live cross-tenant read or write exists.** Four dormant exemptions were
found and closed, and two CI gates now check the exemption lists against the
schema and the catalog, so the class cannot silently return.

### What changed since revision 2

| R2 finding                                                                | Status at `07d39c8`                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W-2** Metrics exist and nothing scrapes them (🟠 High)                  | **Closed.** `prometheus` and `alertmanager` run in both deployment overlays, behind an `observability` profile each overlay clears; CI gate 3c fails the build if either stops clearing it |
| **P0-2** Off-host backup copy manual; restore never proven from it        | **Closed.** `pull` and `list` on all four transports, `restore-verify.sh --from-remote\|--prefer-remote` on the weekly timer, and a round-trip gate in CI                                  |
| **M-5** Redis without AUTH                                                | **Closed.** `requirepass` in all five stacks including development, with a CI gate on drift between the two places the value is written                                                    |
| **W-3** Logs die with the container (🟡 Medium)                           | **Half closed.** Every container rotates at 10 MB × 5 (`x-logging` in the azure, staging and pgbouncer overlays), gated in CI. **A destination is still NOT FOUND** — see M-3              |
| **W-4** Attendance captures on local disk                                 | **Closed.** Object storage, still encrypted before leaving the process, with a migration for the backlog and retention over both vaults                                                    |
| **W-7** `AuditLog` / `HrAttendancePunch` / `PlatformAuditEvent` unbounded | **Built, not enabled.** Swept on independent windows, proven across two tenants — and deliberately deletes nothing until an owner sets a period. See D-3                                   |
| **W-9** No infrastructure as code                                         | **Closed.** `infra/provision-host.sh`, idempotent, called from `infra/cloud-init.yaml`, with a check-only mode                                                                             |
| **W-10** No CD                                                            | **Closed.** `.github/workflows/deploy.yml`, `workflow_dispatch`, production behind `environment:` approval, calling the same `release.sh` a person would                                   |
| **M-2** `FIELD_MAP` registered only `LEAD`                                | **Closed**                                                                                                                                                                                 |
| **M-3** Three unconsumed queues                                           | **Closed.** Deleted; nine declared and nine consumed, exhaustive in both directions                                                                                                        |
| **M-4** No break-glass control in the console                             | **Closed**                                                                                                                                                                                 |
| **M-7** `FACE_SERVICE_TOKEN` never rotated                                | **Closed.** Scheduled, with a previous-token window                                                                                                                                        |
| **M-8** False CSP nonce comment                                           | **Closed**                                                                                                                                                                                 |
| **L-2** `Tenant.dataRegion` meaningless                                   | **Closed.** Dropped, behind a migration that refuses if any tenant carries a non-default value                                                                                             |
| **§9.4 / P2-5** PgBouncer overlay off                                     | **Declined with a reason, and the missing signal built.** Pool saturation is measured and alerted on, so the decision is answerable rather than arguable                                   |
| **§14 / P3-4** Settings implying SMS and e-signature adapters             | **Closed.** Four unread settings removed; following the surface into the product found the campaign-channel defect below                                                                   |
| **W-1** Single VM, no failover, no PITR                                   | **Unchanged** — now the largest remaining risk by a clear margin                                                                                                                           |
| **W-5** Business logic in server components                               | **Unchanged**, slightly larger: 92 of 111 workspace pages, was 89 of 108                                                                                                                   |
| **W-6** Two 1,000-line dispatch routes                                    | **Unchanged.** 1,089 and 974 lines                                                                                                                                                         |
| **W-8** Lead scoring and billing modelled, unimplemented                  | **Unchanged.** `grep -rn "ScoringRule" src/` still returns nothing; no payment provider of any kind                                                                                        |
| **M-1** `script-src 'unsafe-inline'`                                      | **Unchanged and still framework-blocked**                                                                                                                                                  |
| **M-6** Plaintext between services on the host                            | **Unchanged**, and correctly deferred while there is one host                                                                                                                              |
| **L-1** No CSRF token beyond `SameSite=Lax`                               | **Unchanged**                                                                                                                                                                              |

### Defects found while closing those, which no assessment had recorded

Four, and they share a signature: **the code recorded a value and then never
read it.** None is a bug review sees, because in each case the code that would
read correctly is the code that is not there.

1. **`sendCampaignBatch` never read `campaign.channel`.** It hard-codes
   WhatsApp. The scheduler checked the channel before calling it; `POST
/api/v1/campaigns/[id]/send` did not — so "Send now" on an SMS or Email
   campaign sent WhatsApp templates to its audience and reported success.
2. **The dialer never read `campaign.status`.** Both the route and the page
   selected it and neither used it, so Cancel, Complete and Pause changed a
   badge and stopped no calls, and a DRAFT campaign nobody had started was
   dialled like a live one.
3. **The campaign page offered "Open dialer" on every campaign**, including
   channels with nobody in that queue.
4. **`backup-ship.sh` asserted the weekly unit restored a copy pulled back from
   the remote.** It restored the local directory, and nothing could pull a copy
   back, because that code did not exist. What had been proven restorable was
   the copy on the disk that is gone in the disaster the feature exists for.

---

## 1. System inventory, measured

|                                   |  Measured at `07d39c8` |         R2 (`f1dd84e`) |
| --------------------------------- | ---------------------: | ---------------------: |
| TypeScript files / lines          |          756 / 131,420 |          720 / 121,838 |
| `src/` files                      |                    602 |                      — |
| API route files                   |                    162 |                    155 |
| Route groups                      |                    102 |                      — |
| Page components                   |                    131 |                      — |
| Prisma models / enums             |              197 / 105 |              192 / 103 |
| Tables (live catalog)             |                    198 |                    193 |
| Indexes / foreign keys            |              675 / 415 |              655 / 404 |
| Tables `FORCE ROW LEVEL SECURITY` |                    178 |                    173 |
| RLS policies attached             |                    178 |                      — |
| Migrations applied                |                     58 |                     55 |
| BullMQ queues declared / consumed |                  9 / 9 |                 12 / 9 |
| Prometheus alert rules            |                     12 |                     10 |
| CI steps (all green)              |                     34 |               19 gates |
| Unit + integration tests          | 1,538 across 124 files | 1,349 across 107 files |
| Playwright specs                  |               11 files |                      — |
| Python sidecar                    |    5 files / 729 lines |                      — |

Counts of tables, indexes, foreign keys and RLS flags come from
`information_schema` and `pg_class` on a live database with every migration
replayed — not from the schema file, which is the other of two descriptions and
is separately gated against drift.

---

## 2. Environments — five, and they are enforced

`docs/ENVIRONMENTS.md` declares five, and the separation is checks in code
rather than team habit. This matters to every finding below, because the same
Compose base file behaves differently under each overlay.

| Environment     | `APP_ENV`     | Database           | Compose                         | Mail                     | Demo seed        |
| --------------- | ------------- | ------------------ | ------------------------------- | ------------------------ | ---------------- |
| **Development** | `development` | `leadflow`         | base + `docker-compose.dev.yml` | Mailpit, on purpose      | Allowed          |
| **Test**        | `test`        | `master_saas_test` | base                            | —                        | Allowed          |
| **Demo**        | `demo`        | `master_saas_demo` | base + `prod.yml`               | Mailpit, on purpose      | **The** use case |
| **Staging**     | `staging`     | `leadflow_staging` | base + `staging.yml`            | Mailpit, on purpose      | **Refused**      |
| **Production**  | `production`  | `master_saas_prod` | base + `prod.yml` + `azure.yml` | Real relay, **required** | **Refused**      |

Four independent enforcement points, verified in source:

1. **Separate Compose projects.** Staging carries its own `name:`, so its
   volumes, network and containers cannot be production's.
2. **Boot cross-check** (`src/lib/startup-check.ts`) — the database _name_ is
   physical evidence of which environment the process is wired to.
   `APP_ENV=production` against a `*_demo` database kills the process before it
   serves a request.
3. **Seed guards** (`prisma/seed/index.ts`) — three independent refusals plus an
   explicit `ALLOW_DEMO_SEED=yes` every time. The third reads the target
   database's name, because the likeliest accident is a production connection
   string pasted into a shell whose declarations are still laptop defaults.
4. **Role split** — `DATABASE_URL` is the `NOBYPASSRLS` application role,
   `MIGRATION_DATABASE_URL` the owning role. Boot refuses when they are the same
   string, and verifies at runtime that RLS actually applies to the connected
   role.

> **A distinction worth holding while reading §5.**
> `infra/docker-compose.prod.yml` sets `SMTP_HOST: mailpit` and carries an inline
> development `DATABASE_URL`. That overlay is the **local production build** and
> the demo stack, not the deployed one. `infra/docker-compose.azure.yml` layers on
> top and replaces both with `${VAR:?…}` forms that refuse to start when unset —
> which is the correct construction, because Compose's `environment:` outranks
> `env_file:` unconditionally, and the earlier absence of that override is
> precisely how production mail once went to a Mailpit container on the VM and
> stayed there.

---

## 3. Network architecture

One public ingress. Everything else is private or loopback, verified by
rendering the configuration rather than by reading the runbook.

```
                    ┌─────────────────────────────────────────────┐
   Internet  ──▶ 80 │  caddy   automatic TLS · HSTS preload        │
              ▶ 443 └────────────────────┬────────────────────────┘
                                         │  private compose bridge
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
   ┌────▼────┐   ┌──────────┐   ┌────────▼────────┐   ┌────────┐   ┌──────▼──────┐
   │  web    │   │  worker  │   │    postgres     │   │ redis  │   │    minio    │
   │ :3000   │◀─▶│ 9 queues │◀─▶│  198 tables     │   │ AUTH   │   │  objects    │
   └────┬────┘   └────┬─────┘   │  178 FORCE RLS  │   └────────┘   └─────────────┘
        │             │         └─────────────────┘
        │        ┌────▼────┐   ┌────────┐   ┌────────────┐   ┌──────────────┐
        └───────▶│  face   │   │ clamav │   │ prometheus │──▶│ alertmanager │
                 │ sidecar │   │  scan  │   │ 12 rules   │   │  → relay     │
                 └─────────┘   └────────┘   └────────────┘   └──────────────┘

   Egress only: Google Gemini · SMTP relay · Meta Graph · telephony vendors
```

- **Published to the internet:** ports 80 and 443, on `caddy`, and nothing else.
- **Published to loopback only:** postgres 5432, redis 6379, minio 9000/9001,
  mailpit 1025/8025, clamav 3310, face 8081→8000, web 3000 — each bound
  `127.0.0.1:` in the base file, reachable through an SSH tunnel and not from the
  network.
- **Not published at all:** `worker`, `prometheus`, `alertmanager`.
- **Inbound webhooks** from telephony vendors and Meta arrive through the same
  Caddy and are rate-limited _by key before the key is looked up_, which is the
  ordering that matters.
- **Behind the edge, everything is plaintext.** Correct while there is one host;
  it is the first assumption that breaks on the second — see M-2.

---

## 4. Data layer and multi-tenancy

This section was re-derived for R3 as a set of invariants rather than sampled,
because it is the property that cannot be partly right.

**Three independent layers.**

| Layer                              | Refuses                                                                                                                                                                                                                  | Cannot see                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **API kernel**                     | `resolveCtx` takes `tenantId` from the session cookie and re-validates the membership every request. **No route accepts a `tenantId` from a body, a query string or a path** — verified by grep over all 162 route files | Anything not going through a route: workers, sweeps, scripts                                                                           |
| **Prisma guard** (`src/lib/db.ts`) | A model read or filtered write with no `tenantId` in its `where`; a create with no `tenantId` in its data. Trips are counted _at the throw_, so a caller that swallows one still appears in metrics                      | `$queryRaw` / `$executeRaw` — there is no `where` to inspect, so the extension returns early                                           |
| **Row-level security**             | The row itself, for the `NOBYPASSRLS` role the application connects as. `FORCE` means the table owner is filtered too. 178 tables, 178 policies                                                                          | Tables read _in order to decide_ the tenant — a policy filtering on `app.tenant_id` has nothing to match when the read is what sets it |

**What the audit verified holds.** `withTx(tenantId, fn)` and `withPlatformTx(fn)`
both set their config with `set_config(…, true)` — transaction-local, which is
also what makes a transaction pooler safe. No session-level `set_config` exists
in application code; the two that exist are standalone scripts owning their own
connection. Every Redis key is tenant-scoped (`rbac:actor:<tenant>:<user>`,
`t:<tenant>:ent:<module>`, `q:slots:<queue>:<tenant>`) or keyed by a globally
unique secret. Every object key is `t-${tenantId}`-prefixed, and every read path
resolves it through a tenant-filtered row rather than trusting a caller-supplied
key.

**What it found: four dormant exemptions, no live breach.**

| Correction                                                                             | Kind                                | Impact if left                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Session: ['tokenHash']` removed from `GLOBAL_UNIQUE_FIELDS`                           | Dormant guard exemption             | No such model — identity moved to `PlatformSession`. `Session` is about the most likely name a future model takes; add one with a `tenantId` and every `findUnique({ where: { tokenHash } })` on it skips the guard                               |
| `PlatformSession: ['tokenHash','id']` removed from the same map                        | Dormant, by shadowing               | Unreachable: `PlatformSession` is in `GLOBAL_MODELS` and the guard returns on that check first. It decides nothing today, which is why it reads as harmless — and starts deciding the day it leaves that set                                      |
| `BOOTSTRAP` in `check-rls.mjs` trimmed 12 → 8, and the gate now validates its own list | Dormant RLS exemption               | Four entries excluded nothing: `Session` again, and three tables carrying no `tenantId`. A list a reader can see is partly fiction stops being read carefully, which costs the entries that _are_ real                                            |
| `platformUserFor(ctx, userId = ctx.actor.id)` lost its second parameter                | Latent cross-tenant credential read | `WorkspaceMembership` is guard-exempt _and_ has no RLS, and `salesUserId` is globally unique — another workspace's id is a valid key, and the row returned is the one place that file loads credential columns. Five callers, none ever passed it |

**Three tables are carried by application code alone**, deliberately:
`WorkspaceMembership`, `PlatformAccessGrant`, `PlatformAuditEvent`. Each is read
to _establish_ who the actor is and which workspace they may act in, so a policy
cannot run before the read that would set its filter. Their call sites were read
individually and they hold. The set is now pinned by a spec, so a fourth cannot
join it quietly.

---

## 5. Security posture

**Strong, and several controls are better than typical commercial practice:**
boot-time RLS verification that refuses to serve a misconfiguration; session
rotation with theft detection; MFA mandatory for privileged roles with an
enrolment-purpose session so mandating it cannot lock out existing users;
egress redaction before AI calls including spoken digit sequences; break-glass
platform access that is read-only until a reasoned, time-boxed grant; rate
limits that cannot be forgotten because they live in the route contract;
constant-time comparison on the face-service bearer token with a rotation
window; upload scanning; an SSRF allow-list on the vendor-supplied recording URL.

**Secret handling — locations and risk, no values.**

| Where                                                             | Handling                                                                                                                      | Risk                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/.env*`                                                  | Gitignored. Generated by `npm run secrets`; the boot check refuses placeholder or low-entropy values                          | Low. The `.example` files carry blanks and comments, never values                                                                                                                                                                                                                    |
| `<KEY>_FILE` indirection (`src/lib/env.ts`)                       | Any variable may instead name a file to read it from                                                                          | Low, and this is what a secret manager would mount                                                                                                                                                                                                                                   |
| Prometheus / Alertmanager configs                                 | Rendered into a **tmpfs** at container start; bearer token by `credentials_file`, relay password by `smtp_auth_password_file` | Low — deliberately kept out of `docker inspect`                                                                                                                                                                                                                                      |
| `infra/docker-compose.prod.yml`, `.dev.yml`, `.yml`, `Dockerfile` | **Contain inline connection strings with development-grade credentials, in git**                                              | **Low-Medium.** Each is a well-known local value for a laptop or demo database, and the Azure overlay replaces every one with a `${VAR:?…}` form that refuses to start when unset. The risk is not the value; it is that a reader can copy the shape into a real deployment. See L-2 |
| `infra/pgbouncer-userlist.txt`                                    | Gitignored; `.example` beside it                                                                                              | Low                                                                                                                                                                                                                                                                                  |

**Not secure, and named as such:**

- `script-src 'unsafe-inline'` (M-1) — framework-blocked, not neglected, and
  verified in a browser by `tests/e2e/csp.spec.ts`.
- Plaintext between services on the host (M-2).
- No CSRF token beyond `SameSite=Lax` (L-1).

---

## 6. Observability

From R2's 45/100 to a running system. `GET /api/metrics` exposes **16 distinct
`masterapp_*` series** — liveness, errors, four queue signals, pool occupancy
and its ceiling, table rows and bytes, secret age against its maximum, live
platform write grants, and the configured retention window;
`infra/prometheus-alerts.yml` holds **12 rules**, each matching a
failure this codebase has actually had. A `prometheus` and an `alertmanager`
run in **both** deployment overlays, defined in the base file behind
`profiles: ['observability']` which each deployment overlay clears — so layering
a deployment overlay _is_ opting in, and a production stack cannot come up
without its scraper. Both refuse to start rather than run half-configured, on
the grounds that a Prometheus with no token scrapes a 404 that looks exactly
like a process being down, and an Alertmanager with no recipient reads as
monitored while delivering nothing.

Queue consumer counts are read from Redis **at scrape time**, because a counter
kept by the enqueue path looks healthy in precisely the dead-worker failure that
took months to notice.

**Still missing:** distributed tracing, error reporting, and a log destination.
The monitoring stack also shares a host with what it watches, which is the
single-VM finding wearing a different hat.

---

## 7. Backup and recovery

Database _and_ object store, encrypted, on three systemd timers
(`master-suite-backup`, `-restore-verify`, `-backup-status`). The weekly
verifier runs `--prefer-remote`: it fetches the off-host copy and applies the
identical verification, degrading to the local copy **out loud** when no remote
is configured. A `.verified-at` marker records _which_ copy was proven, because
"verified 3 days ago" otherwise means two different things.

`scripts/test-backup-roundtrip.sh` is CI gate 3f — ship, list, pull, byte-compare
on the `local` transport, plus four refusals.

**Not covered, and stated rather than implied:** the `s3`, `rclone` and `rsync`
transports need a real remote and are exercised by an operator once, with the
three commands in `docs/BACKUP-RECOVERY.md`. Recovery point is still the nightly
backup — there is no PITR.

---

## 8. CI/CD and local parity

CI is one `verify` job, **34 steps, all green** at `07d39c8`, over a PostgreSQL 16
service and a Redis started as a step (a service container cannot pass
`--requirepass`, which is a command argument). Deployment is
`.github/workflows/deploy.yml` — `workflow_dispatch`, production behind an
`environment:` approval, calling the same `release.sh` a person would, and
refusing a commit whose CI was not green on that exact SHA.

New in R3: **`npm run verify` runs every gate CI runs, in CI's order**, and takes
its steps out of `.github/workflows/ci.yml` rather than keeping a copy — so a
gate added to CI either runs locally too or forces somebody to write down why it
cannot. 15 gates run locally in ~370 s. This exists because there was no single
command for "is this pushable", `README.md` listed five of fifteen and claimed
that was all of them, and a red build for `prettier --check` was the result.

---

## 9. What remains

### W-1 · Single point of failure, by construction · 🟠 High

One VM holds the application, the worker, the database, the queue, the object
store, the scanner, the biometric engine, the monitoring stack, and a second
full stack for staging. Any host failure is a total outage; recovery is the
nightly backup, so the worst case is losing up to a day.

**This is now the only High finding, and the only one left that a customer would
feel.** The application side of moving off it is done and verified:
`sslmode=require`, `rediss://`, and any S3 endpoint are accepted unchanged.
It is procurement and connection strings.

### M-1 · `script-src 'unsafe-inline'` · 🟡 Medium · framework-blocked

A nonce with `strict-dynamic` was tried and does not survive Next 16.2.12's
inline bootstrap. Verified in a browser rather than asserted. XSS is uncontained
by CSP; every other XSS control is in place.

### M-2 · Plaintext between services on the host · 🟡 Medium

Correct while there is one host and nothing crosses a wire anybody else can
reach. It is the same day W-1 is fixed that this becomes real, which is why it
is listed beside it rather than deferred indefinitely.

### M-3 · Logs rotate, and go nowhere · 🟡 Medium

Every container rotates at 10 MB × 5, gated in CI, so no log grows unbounded.
Nothing collects them, so post-incident analysis is still limited to what is on
the host. The lines are already structured JSON carrying a request id — **the
missing piece is a destination nobody has chosen**, which is a decision, not
work.

### M-4 · Features whose schema shipped without an implementation · 🟡 Medium

`ScoringRule` and `LeadScoreHistory` exist with `Lead.score` and an index
ordering by it, and `grep -rn "ScoringRule" src/` returns nothing. Billing has
`SubscriptionPlan`, `TenantSubscription` and `BillingEvent`, and no payment
provider of any kind. A lead list ordered by a score nothing computes is worse
than one that does not claim to. See D-1, D-2.

### W-5 · Business logic in server components · 🟡 Medium

92 of 111 workspace pages query Prisma directly, up from 89 of 108. Safe — the
tenant guard covers every one — but the same read exists in a page, a service
and an export, and they drift. Not a rewrite; move read shapes into
`src/services/*` as they are next touched.

### W-6 · Two large dispatch routes · 🔵 Low

1,089 and 974 lines. Both permission maps are total over their enums, so an
undeclared resource or action is a compile error rather than a silent
fall-through. What remains is readability.

### L-1 · No CSRF token · 🔵 Low

`SameSite=Lax` is the only cross-site protection. Adequate for a
single-origin application; it stops being adequate the day a subdomain is added.

### L-2 · Development credentials inline in tracked Compose files · 🔵 Low

`infra/docker-compose.prod.yml`, `.dev.yml`, `.yml` and `Dockerfile` carry
connection strings with development-grade credentials. Every one is overridden
by the Azure overlay with a form that refuses to start when unset, so no
deployment inherits them. The residual risk is a reader copying the shape.
Worth converting to `${VAR:?…}` throughout when those files are next touched.

---

## 10. Production readiness

| Area                     |     R3 |  R2 |  R1 | Explanation                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | -----: | --: | --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**         | **87** |  86 |  82 | Boundaries real and consistently held. +1 for the campaign/dialer channel and status defects being closed with tests that fail on the previous commit. Still held back by two 1,000-line dispatch routes, 92 pages querying Prisma directly, and a feature whose schema shipped without its engine                                                                               |
| **Security**             | **91** |  88 |  78 | Redis AUTH everywhere including development; token rotation on a schedule; SSRF allow-list; the tenancy audit closing four dormant exemptions and adding two gates over the exemption lists themselves. Held back by `unsafe-inline` (framework-blocked), plaintext intra-host traffic, no CSRF token                                                                            |
| **Scalability**          | **72** |  71 |  48 | Every code-level ceiling raised. +1 for attendance captures moving off local disk, which was the last thing in the way of a stateless web tier. What remains is one VM and no load balancer                                                                                                                                                                                      |
| **Database**             | **93** |  91 |  84 | 197 models, 675 indexes, 415 FKs, 178 tables forced and policied, drift-gated, keyset pagination, `NOT VALID`/`VALIDATE` discipline. +2 for retention now existing for the three append-only tables. Still no partitioning, and retention deletes nothing until an owner sets a period                                                                                           |
| **Network**              | **78** |  70 |  62 | Redis AUTH closed the largest gap. Edge verified by rendering rather than reading. Everything behind the edge is still plaintext                                                                                                                                                                                                                                                 |
| **AI**                   | **86** |  86 |  74 | Unchanged and genuinely well-architected: per-tenant BYO keys, redaction at the boundary, schema-constrained output, claim-before-bill idempotency, honest labelled simulation, per-workspace metering with a plan ceiling, per-tenant fairness. Loses the same points: lead scoring modelled and unimplemented, no streaming                                                    |
| **DevOps**               | **88** |  74 |  41 | CD with production behind approval; infrastructure as code for the host; the off-host backup proven to restore on the weekly timer; 34 CI steps; and `npm run verify` giving local parity that reads the workflow rather than copying it. Loses points for a single deployment host and three backup transports proven only by hand                                              |
| **Multi-tenancy**        | **97** |  93 |  88 | Three independent layers, `FORCE` on 178 tables, a `NOBYPASSRLS` runtime role with `CREATE` revoked, transaction-local settings that survive a pooler, and now **the exemption lists themselves checked against the schema and the catalog every run**. Short of 100 only because three control-plane tables are carried by application code alone — unavoidably, and now pinned |
| **Monitoring**           | **80** |  45 |  12 | A running Prometheus and Alertmanager in both deployment overlays, 12 rules, consumer counts read from Redis at scrape time, CI failing the build if an overlay stops starting them. Short of full marks for no tracing, no error reporting, no log destination, and a monitoring stack sharing a host with what it watches                                                      |
| **Production readiness** | **84** |  73 |  46 | Deployable to a real customer today with an accepted single-host risk. **Every remaining blocker is a decision or a procurement, not an engineering task.**                                                                                                                                                                                                                      |

**Overall: 84 / 100** (R2: 73 · R1: 46).

---

## 11. Priority roadmap

### P0 — Critical

**None.** Every P0 R2 raised is closed.

### P1 — Production · before paying customers

|      | Item                                                                                                                                                     | Reference |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P1-1 | **Choose a log destination.** The lines are structured and the rotation is in place; what is missing is where they go                                    | M-3       |
| P1-2 | **Answer D-1 and D-2** — lead scoring and billing, build or remove. Shipping a list ordered by a score nothing computes is a credibility cost paid daily | M-4       |
| P1-3 | **Answer D-3** — the audit retention period. The sweep is built and proven, and deletes nothing until it has a number                                    | W-7       |

### P2 — Scale · as volume grows

|      | Item                                                                                                                               | Reference |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P2-1 | Managed Postgres with PITR; managed Redis with TLS; object storage off the VM. The application already accepts all three unchanged | W-1       |
| P2-2 | TLS or mTLS between services — the same day P2-1 lands, not before                                                                 | M-2       |
| P2-3 | Exercise the `s3`, `rclone` and `rsync` backup transports once against a real remote                                               | §7        |
| P2-4 | Partition `AuditLog` and `HrAttendancePunch` by month, **after** P1-3 sets a period                                                | W-7       |
| P2-5 | Turn on the PgBouncer overlay once the pool-saturation metric says the pool is the constraint                                      | §9.4 (R2) |

### P3 — Optimization

|      | Item                                                                                               | Reference |
| ---- | -------------------------------------------------------------------------------------------------- | --------- |
| P3-1 | Close the CSP gap when Next supports nonce propagation, or hash the inline bootstrap at build time | M-1       |
| P3-2 | Move page-level Prisma reads into `services/` as they are next touched                             | W-5       |
| P3-3 | Split the two HR dispatch routes when one is next changed                                          | W-6       |
| P3-4 | Convert the inline Compose credentials to `${VAR:?…}` throughout                                   | L-2       |
| P3-5 | A CSRF token, if a subdomain is ever added                                                         | L-1       |
| P3-6 | A second SIF layout, once a second bank is onboarded                                               | L-4 (R2)  |

### Decisions this roadmap cannot make

|     | Question                                                                                                        | Why it is not an implementer's call                                    |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| D-1 | **Lead scoring** — build the rule engine, or delete `ScoringRule`, `LeadScoreHistory` and the `ORDER BY score`? | Both defensible; they differ by weeks of work                          |
| D-2 | **Billing** — connect a payment provider, or take the billing language off the product?                         | Nothing charges anybody today                                          |
| D-3 | **Audit retention** — how long, and may these tables be deleted at all?                                         | A regulator's answer, not a database's                                 |
| D-4 | **Break-glass approval** — should a second person approve platform write access?                                | A platform with one owner could not satisfy it and would be locked out |

---

## 12. UNKNOWN / NOT FOUND

Stated rather than inferred, because a gap presented as a fact is worse than a
gap.

| Question                                                                           | Status                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which cloud the production VM runs on                                              | **UNKNOWN.** `docker-compose.azure.yml` and `DEPLOY-AZURE.md` name Azure by convention; there is **no** provider SDK, Terraform, Bicep, ARM or cloud CLI anywhere in the repository. `cloud-init.yaml` is provider-agnostic. Nothing here proves any provider                         |
| The production host's size, region, disks or firewall rules                        | **NOT FOUND.** `provision-host.sh` configures the host from inside; the VM, its security group and its DNS record are deliberately out of scope                                                                                                                                       |
| Whether the off-host backup remote is configured on the live deployment            | **UNKNOWN.** `BACKUP_REMOTE` is read from the environment; the repository cannot say what it is set to, and the weekly verifier degrades out loud when it is unset                                                                                                                    |
| Whether the `s3` / `rclone` / `rsync` backup transports work against a real remote | **NOT VERIFIED.** Only `local` is covered by CI                                                                                                                                                                                                                                       |
| Whether the AWS SDK object-store calls paginate correctly against a real bucket    | **NOT VERIFIED.** MinIO needs a Docker daemon this environment has not got, and CI has no object-storage service. `listObjects`, `listPrefixes` and `deleteObjects` are exercised against a stand-in, and pagination plus 1,000-key batching are exactly what a stand-in cannot prove |
| Whether anyone is receiving the Alertmanager notifications                         | **UNKNOWN.** The relay and recipients are environment values; the stack refuses to start without them, which proves they are set, not that they arrive                                                                                                                                |
| Actual production traffic, tenant count or data volume                             | **NOT FOUND.** No telemetry from a live deployment is in this repository                                                                                                                                                                                                              |

---

_Assessed at commit `07d39c8`, 2026-08-22. Measurements taken against a live
PostgreSQL 16 catalog with all 58 migrations applied, rendered Compose
configurations for six stacks, and a full local run of every gate CI runs —
1,538 tests across 124 files, none skipped._
