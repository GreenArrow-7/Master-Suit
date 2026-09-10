# SPEC-0008 — R5 approval packet

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Status | `READY_FOR_APPROVAL` |
| Prepared | 2026-09-09 |
| Prepared by | agent |
| Gates outstanding | 1 specification · 2 architecture · 3 security · 5 implementation readiness |

An agent prepared this. It records no approval, and it may not: R5 execution is
human-only. Each gate below states the exact decision being asked for, so that
approving is a yes or a no rather than an interpretation.

---

## 1. What the repository actually shows, measured today

Everything here was measured on 2026-09-09, not inferred from documentation.
No production or staging system was accessed, and nothing was configured.

### 1.1 There is no deployment infrastructure of any kind — for any environment

| Queried | Result |
|---|---|
| GitHub Actions **environments** | **0** — `total_count: 0` |
| GitHub Actions **secrets** | **0** |
| GitHub Actions **variables** | **0** |

This is the single most important fact in this packet, and it is larger than
`SPEC-0008`.

`.github/workflows/deploy.yml` resolves its credentials as
`secrets[format('DEPLOY_HOST_{0}', inputs.environment)]` and gates on
`environment: ${{ inputs.environment }}`. With zero environments and zero
secrets configured, **the deployment workflow has never run successfully for
staging or production either.** Its own first step is a check that names the
missing secrets and exits 1; that is what it would do today, for any input.

So "add a demo environment" is not an increment on a working pipeline. The
pipeline is unexercised. That changes what gate 5 is being asked to approve,
and it is stated here rather than discovered during a demonstration.

### 1.2 There is no demo runtime

| Looked for | Found |
|---|---|
| **docker-compose.demo.yml** (new, under `apps/web/infra/`) | **absent** — the peers are `.dev`, `.prod`, `.staging`, `.azure`, `.small-host`, `.pgbouncer` |
| `demo` in `deploy.yml` environment choices | **absent** — `options: [staging, production]` |
| `demo` anywhere in `.github/workflows/` or `apps/web/infra/` | **absent** — the only match in the tree is unrelated, in `ci.yml` |
| A demo Caddyfile | **absent** — `Caddyfile`, `Caddyfile.intranet`, `Caddyfile.staging` exist |

What *does* exist, and is reusable: `apps/web/infra/provision-host.sh`,
`apps/web/infra/cloud-init.yaml`, `apps/web/infra/docker-compose.small-host.yml`
and the Caddy pattern. The single-VM shape `CL-001` recommends is already
automated; nothing needs inventing.

The application contract for `demo` is also already honoured — the environment
enum and `apps/web/src/lib/startup-check.ts` both know about it. That half is
real. Only the runtime is missing.

### 1.3 Staging is not a candidate host, and the repository says why

`apps/web/infra/Caddyfile.staging` is explicit: staging has **no public name and
no certificate**, is reachable only over an SSH tunnel, and is *"pointed at a
restored production snapshot — that is the point of it."*

Staging therefore holds **real customer data**. Option A of `CL-001` — a second
Compose project on the staging host — would place a publicly reachable,
client-facing environment on the host holding a production snapshot. This is
stronger than the cost argument `CL-001` recorded, and it should be read as
closing Option A rather than pricing it.

### 1.4 The domain: registered, but nothing exists for a demo

Public DNS lookups only.

| Query | Result |
|---|---|
| `youhan.in` A | **166.117.93.67** — registered, resolves |
| `youhan.in` nameservers | `ns53.domaincontrol.com`, `dns.jomax.net` — GoDaddy |
| `youhan.in` MX | **none published** |
| `demo.youhan.in` | **NXDOMAIN** |

`CL-002` recorded that no domain was evidenced. That is now partly answered: the
organisation demonstrably has `youhan.in` and controls its DNS at GoDaddy. What
is still absent is the record itself — `demo.youhan.in` does not exist, and no
certificate exists. Neither may be created by an agent.

---

## 2. What is still missing, and it is not a technical question

Two facts block provisioning. Neither is an engineering decision, and no gate
can waive either.

1. **Which host.** No hosting capacity is evidenced anywhere in the repository —
   no VM, no subscription, no cost. This is procurement.
2. **Authorisation to create `demo.youhan.in` and a certificate for it.** DNS
   control is evidenced; permission to use it is not.

A third, surfaced by 1.1 and larger than this specification:

3. **Whether the deployment pipeline is meant to work at all yet.** Zero
   environments and zero secrets means staging and production are equally
   undeployable. If that is a surprise, it should be settled before a demo
   environment is added to a workflow nobody has run.

---

## 3. The gates, with the exact decision each is being asked for

### Gate 1 — specification approval

**Approvers required at R5:** Product Owner **and** Solution Architect (both).

**The decision:** approve `SPEC-0008`'s scope — build a dedicated `APP_ENV=demo`
environment on its own database, deployed through GitHub Actions, reachable by
clients over HTTPS, holding only synthetic seed data, with no scheduled backup
because a re-seed is the recovery path.

**Approve if you accept:** a fifth environment, its running cost, and public
exposure of a system holding no real data.

**Do not approve if:** the demonstration can be screen-shared instead. That is
`CL-002`'s recorded default and it is the reversible choice — widening later is
a configuration change; narrowing after a prospect has a link is not.

**Open, not blocking:** `CL-003`, acceptable rebuild time. Default is that no
threshold is enforced and the provisioning rehearsal sets one from observation.

---

### Gate 2 — architecture

**Approver required:** Solution Architect.

**The decision:** approve `AD-001`–`AD-009`, and specifically the hosting shape.

**Recommendation: a separate small VM,** following the existing single-VM
pattern. Section 1.3 is the reason and it is stronger than the one `CL-001`
recorded: co-location would put a public demo on the host holding a restored
production snapshot.

**What the architect is really being asked:** Option B (separate VM), or the
Azure variant (Option C) if that platform is already in use. Option A
(co-locate with staging) should be declined on the section 1.3 evidence.

**Also to confirm:** that outbound safety is achieved by environment
configuration only, so that no demo-awareness enters the production request
path. This is `AD-00x`'s stated intent and it is worth confirming explicitly,
because the alternative — a runtime `if (isDemo)` in shared code — is the
failure mode.

---

### Gate 3 — security

**Approver required:** Application Security.

**The decision:** approve the threat model and the public-exposure conditions.

**The conditions, as `CL-002` recorded them** — each needs a yes:

| Condition | Status |
|---|---|
| HTTPS only | Caddy pattern exists; certificate does not |
| Authentication required | already true |
| No debug mode | environment configuration, unverified in a demo runtime |
| Database not exposed | Compose pattern keeps it internal |
| No public admin console | `ST-005`, `E2E-004` and `ST-015` prove the client login is refused it |
| Rate limiting and brute-force controls | already true; `ST-010` asserts demo logins are ordinary accounts |
| Safe outbound providers | mock provider; `ST-008` and `ST-009` assert it |

**Two specific things to rule on:**

1. **A new deploy key with SSH access to a public host.** Adding
   `DEPLOY_KEY_demo` creates a credential that can reach a publicly exposed
   machine. Note from 1.1 that this would be the **first** deployment secret in
   the repository, so the handling pattern is being set here rather than
   followed.
2. **`DEPLOY_KNOWN_HOSTS_demo`.** Without it `deploy.yml` falls back to
   trust-on-first-use and emits a warning. For a public host that fallback
   should be closed, which means pinning the fingerprint at provisioning time.

**Carried in from `SPEC-0007`:** `CONV-003` is closed — the seed no longer
prints a generated password when stdout is not a terminal or when `CI` is set,
and never reprints a supplied one. The demo environment must supply
`DEMO_PASSWORD` from a secret store, never let the seed generate one.

---

### Gate 5 — implementation readiness

**Approver required:** Solution Architect. R4/R5 only.

**The decision:** that the specification is ready to be *executed* — which at R5
means by a human, not an agent.

**Ready:** the artefact set is complete and validates; the provisioning pattern
exists and is automated; the application already understands `APP_ENV=demo`; and
the dataset it will run is built, tested and green (`SPEC-0007`, 1987 tests
passing, `E2E-006` proving the single client login across both modules).

**Not ready, and honestly so:**

- **No host** (section 2.1).
- **No DNS record or certificate** (section 1.4).
- **A pipeline with zero configured environments and zero secrets** (section
  1.1). Gate 5 should not certify readiness to deploy through a workflow that
  has never deployed anything.

**Recommendation:** approve gates 1, 2 and 3 if the scope and shape are wanted,
and **hold gate 5** until a host exists and section 1.1 is explained. Holding
gate 5 costs nothing — it blocks execution, not preparation — and approving it
against three absent prerequisites would make the record say something untrue.

---

## 4. The smallest correct change, for when the gates are passed

Recorded so the approvers can see the size of what they are approving. **None of
this has been written.** No file in `.github/workflows/` or `apps/web/infra/`
has been touched.

1. **docker-compose.demo.yml** (new, under `apps/web/infra/`) — a peer of `docker-compose.staging.yml`,
   layered over the base and production overlays.
2. `apps/web/infra/Caddyfile.demo` — like `Caddyfile`, not `Caddyfile.staging`:
   this one *does* need a public name and a certificate.
3. `.github/workflows/deploy.yml` — add `demo` to `options: [staging, production]`.
   One line. The credential lookup is already templated on the environment name,
   so nothing else in the workflow changes.
4. A GitHub `demo` environment, and four secrets: `DEPLOY_HOST_demo`,
   `DEPLOY_USER_demo`, `DEPLOY_KEY_demo`, `DEPLOY_KNOWN_HOSTS_demo`.
5. A demo `.env` on the host, from a secret store, with `APP_ENV=demo`, a
   `master_saas_demo`-named database, `DEMO_PASSWORD`, and the mock mail
   provider.
6. One DNS A record and one certificate for the authorised hostname.

Steps 3 and 4 are the R5 surface. Steps 1, 2, 5 and 6 are infrastructure that
does not exist yet.

---

## 5. What an agent has done, and what it has not

**Done:** prepared the artefacts; measured everything in section 1; verified no
demo runtime exists; confirmed the reusable provisioning pattern; and completed
the dataset this environment would serve.

**Not done, and not permitted:** provisioned anything; created a DNS record or
certificate; created or read any deployment secret; run `deploy.yml`; touched
`.github/workflows/`; accessed staging or production; recorded any approval.

`SPEC-0008` stays at `READY_FOR_APPROVAL` with all four gates `UNRESOLVED`.


---

# Gate decision texts — revision 2, 2026-09-09

Revised after the parity requirement, `CL-005` (resolved to **Option C**) and the
architecture adjustment that decouples the production deploy-path migration from
the demo launch. Each text below is what the approver is being asked to approve,
worded so the decision is a yes or a no rather than an interpretation.

## Gate 1 — specification approval

**Approvers (both required at R5):** Product Owner **and** Solution Architect.

> **Approved:** a dedicated permanent demo environment for YOUHAN ONE, built
> from the same canonical repository as production and holding no production
> data.
>
> It runs `APP_ENV=demo` against its own `master_saas_demo` database, is
> deployed from GitHub by dispatched workflow, is reachable by clients over
> HTTPS at an authorised hostname, and presents a single client-facing login
> `demo@youhan.in` reaching Sales and HRMS in one session.
>
> Functional parity with production is required and is defined as **code
> parity, not data replication**: parity is calculated from the deployed **full
> commit SHA** of each environment and reported as `IN_SYNC`, `DEMO_BEHIND`,
> `DEMO_AHEAD` or `DIVERGED`. Demo synchronisation is **detected automatically
> and deployed manually**; no standing autonomous deployment credential is
> created.
>
> The demonstration dataset is synthetic, evolves with the product through the
> governed seed, and is never populated from production records. No scheduled
> backup: the recovery path is a re-seed.
>
> **This does not approve** provisioning, DNS, TLS, any deployment, any change
> to production's deployment mechanism, or gate 5.

**Approve if** a fifth environment, its running cost and public exposure of a
system holding no real data are all wanted.

**Do not approve if** a screen-shared demonstration would do — that is `CL-002`'s
recorded default and the reversible choice.

**Open, non-blocking:** `CL-003` (rebuild-time threshold, default: measure it at
provisioning) and `CL-006` (drift target, default: one working day).

## Gate 2 — architecture approval

**Approver:** Solution Architect.

> **Approved:** `AD-001` to `AD-019`, and specifically:
>
> 1. **Hosting:** a separate VM on the existing single-VM Compose pattern.
>    Co-location with staging is **declined**, on the evidence that
>    `apps/web/infra/Caddyfile.staging` documents staging as tunnel-only and
>    holding a restored production snapshot — so co-locating would place a
>    publicly reachable client environment on the host carrying real customer
>    data.
> 2. **Demo release source (`AD-019`):** GitHub builds
>    `ghcr.io/<owner>/<repo>/{web,worker}:<full-sha>`; the demo path pulls and
>    locally tags them so `apps/web/scripts/release.sh` promotes rather than
>    builds. The demo host runs no application build.
> 3. **Production's deploy path is NOT changed (`AD-011`).** Mandatory registry
>    pull for every environment is **deferred to its own specification**,
>    recommended as `SPEC-0009`. The only edit to shared code is an additive
>    `demo` case in `dc_for()`, with `REG-001` asserting staging and production
>    are behaviourally unchanged.
> 4. **Parity is computed on full SHAs (`AD-012`),** expanding a short SHA via
>    `git rev-parse` first. Production's build arg is
>    `GIT_SHA: ${IMAGE_TAG:-unknown}` and `release.sh` sets `IMAGE_TAG` from
>    `--short=12`, so production reports 12 characters today; comparing widths
>    as strings would report permanent false drift.
> 5. **Parity in this phase is SHA-based, not digest-based.** Identical
>    container digests across demo and production are **not** claimed while
>    production still builds on its host. Stated as a limitation rather than
>    overclaimed.
> 6. **Environment differences stay in configuration (`AD-017`).** No `APP_ENV`
>    branch in the shared request path.

**Also confirm:** that deferring the production migration is accepted as
deliberate scope control rather than an oversight, and that `SPEC-0009` is the
right home for it.

## Gate 3 — security approval

**Approver:** Application Security.

> **Approved:** the threat model including `TH-014` to `TH-021` and controls
> `CTRL-016` to `CTRL-024`, and specifically:
>
> 1. **Manual parity synchronisation is approved. Autonomous demo deployment on
>    drift detection is NOT approved.** `CL-005` resolves to Option C. The
>    parity job holds **no deployment credential for any environment**, so
>    `TH-014` is closed by absence of capability rather than by a conditional a
>    later edit could remove.
> 2. **Public exposure conditions** (`CL-002`): HTTPS only; authentication
>    required; no debug mode; database not exposed; no public admin console;
>    rate limiting and lockout active; inert outbound providers with no vendor
>    credential present.
> 3. **`DEPLOY_KNOWN_HOSTS_demo` is mandatory,** not optional as elsewhere:
>    without it `deploy.yml` falls back to trust-on-first-use, which is wrong
>    for a publicly reachable host.
> 4. **New credentials introduced, each scoped:** a read-only pull-scoped
>    registry credential on the demo host (`TH-017`), and a read-only
>    `METRICS_TOKEN_demo` for parity reading, which must not be reused as a
>    deployment credential (`TH-018`).
> 5. **`DATA-004`** — no automated path from production data to demo. The parity
>    automation carries a commit SHA and an image digest and holds no database
>    credential, so it could not copy a row if instructed to.
> 6. **`TH-021`** — demo does not substitute for staging in the migration
>    rehearsal gate. Staging rehearses against production-shaped data; demo does
>    not.

**Known limitation to accept explicitly:** with `TRUSTED_PROXY_CIDRS` unset the
per-IP login bucket is deployment-wide — 10 sign-ins per five minutes for the
whole environment. Fail-safe, but it will look like a broken demonstration if a
client mistypes repeatedly.

## Gate 5 — implementation readiness

> **HOLD.** Not approved.

Held on three prerequisites that are facts rather than decisions: no demo host,
no authorised hostname / DNS record / certificate, and a deployment pipeline
with **0** GitHub environments, **0** secrets and **0** variables — meaning
`deploy.yml` has never successfully deployed staging or production either.

`provisioning-checklist.md` in this directory lists every item, its owner, and
the evidence that closes it. Gate 5 becomes approvable when that checklist is
satisfied, not before.


---

# Gate decision texts — revision 3, 2026-09-09 (final before approval)

Revision 3 supersedes revision 2 above, which is retained rather than rewritten.
It exists because a reconciliation pass found two things revision 2 stated
incorrectly or incompletely, and a gate must not be approved against either.

**What revision 2 got wrong, corrected here:**

1. It claimed both "the one shared-code change is an additive `demo` case in
   `dc_for()`" **and** "zero changes to `.github/`, `apps/web/infra/` or
   `release.sh`". The second was a statement about the repository *as it stands*
   — nothing is implemented — and the first about *proposed* work. Placed
   together they read as a contradiction, and the reconciliation is:
   **`apps/web/scripts/release.sh` does require changes.** They are listed
   exactly in `TASK-009`.
2. It asserted "no host rebuild for demo" without checking that migrations can
   run from a pulled image. They cannot: the `production` stage is Next.js
   standalone output and carries no `prisma` CLI, which is why both existing
   `migrate` services build `target: build`. `AD-021` resolves it by publishing
   a third image; without that, "no host rebuild" was unachievable.

## Gate 1 — specification approval

**Approvers (both required at R5):** Product Owner **and** Solution Architect.

> **Approved:** a dedicated permanent demo environment for YOUHAN ONE.
>
> It is built from the **same canonical repository** as production, runs
> `APP_ENV=demo` against its own dedicated **synthetic** `master_saas_demo`
> database, and is deployed **from GitHub** by dispatched workflow. It is
> reachable by clients over **public HTTPS** at an authorised hostname, and
> presents a **single client-facing login, `demo@youhan.in`**, reaching **Sales
> and HRMS** in one authenticated session.
>
> Parity with production is **functional parity, not data replication**, tracked
> on the deployed **full commit SHA** and reported as `IN_SYNC`, `DEMO_BEHIND`,
> `DEMO_AHEAD`, `DIVERGED` or `UNKNOWN`. Synchronisation is **detected
> automatically and deployed manually**; no standing autonomous deployment
> credential is created.
>
> **No production data is replicated into demo, by any path, ever.** The
> dataset is synthetic, evolves with the product through the governed seed, and
> recovery is by reconstruction with a stated RPO and RTO rather than by backup.
>
> **This does not approve** provisioning, DNS, TLS, any deployment, any change
> to production's deployment mechanism, or gate 5.

**Open and non-blocking:** `CL-003` (rebuild threshold — measure at
provisioning) and `CL-006` (drift target — default one working day).

## Gate 2 — architecture approval

**Approver:** Solution Architect.

> **Approved:** `AD-001` to `AD-024`, and specifically:
>
> 1. **Hosting:** a separate VM. Co-location with staging is **declined** on the
>    evidence that `apps/web/infra/Caddyfile.staging` documents staging as
>    tunnel-only and holding a restored production snapshot.
> 2. **Demo image path:** GitHub builds
>    `ghcr.io/<owner>/<repo>/{web,worker,migrate}:<full-sha>`; the demo path
>    pulls and locally tags them so `apps/web/scripts/release.sh` promotes.
>    **The demo host never builds the application.** If the image is absent the
>    deployment **fails closed** — no host-local substitute is built.
> 3. **A `migrate` image must be published (`AD-021`).** The `production` stage
>    carries no `prisma` CLI, so without a third published image the demo host
>    would have to build one. Additive to
>    `.github/workflows/build-images.yml`; changes no environment deploy
>    behaviour.
> 4. **`apps/web/scripts/release.sh` changes — acknowledged, not hidden.** Four
>    additive edits (`dc_for()` case, its error text, the `status` loop, two
>    usage strings), listed in `TASK-009`. **Staging behaviour: unchanged.
>    Production behaviour: unchanged.** `REG-001` is the evidence, and is
>    mandatory because the file is shared by all three environments.
> 5. **Production deployment mechanism is NOT changed.** Mandatory registry
>    pull for every environment is deferred to a future specification, whose
>    identifier is to be allocated when it is created rather than reserved now.
> 6. **Parity on full SHAs, resolved in CI (`AD-020`).** Production reports a
>    12-character prefix today; the parity job expands it with
>    `git rev-parse --disambiguate` against a full checkout — one match resolves,
>    zero or many yield `UNKNOWN`. **No production shell access is required, and
>    a 12-character value is never compared against a 40-character one.**
> 7. **`UNKNOWN` is a first-class state**, not an error path.
> 8. **Database separation** is absolute; **DNS/TLS** follow the production Caddy
>    model, never the staging one with `auto_https off`; **rollback** is
>    `release.sh rollback demo` leaving the schema alone; **recovery** is
>    reconstruction with RPO = last deployed commit and RTO within 2 hours.

## Gate 3 — security approval

**Approver:** Application Security.

> **Approved:** the threat model including `TH-014` to `TH-021` and controls
> `CTRL-016` to `CTRL-024`, and specifically:
>
> 1. **Manual synchronisation only.** Autonomous demo deployment on drift
>    detection is **not** approved. The parity job holds **no deployment
>    credential for any environment** and **no database credential for any
>    environment**, so `TH-014` and `DATA-004` are closed by absent capability
>    rather than by a conditional.
> 2. **SSH host-key pinning is mandatory.** `DEPLOY_KNOWN_HOSTS_demo` must be
>    populated from an out-of-band reading of the host key before the first
>    deployment. `StrictHostKeyChecking=no` is never used, and the trust-on-
>    first-use fallback must never fire — the absence of its warning is the
>    evidence.
> 3. **Separate demo secrets**, sharing no value with any other environment; a
>    shared `FIELD_ENCRYPTION_KEY` would be the worst case.
> 4. **Mock outbound providers**, with no vendor credential present at all
>    rather than blank-but-declared.
> 5. **Public HTTPS attack surface:** ports 80 and 443 only; no database, cache,
>    object store, admin console or debug interface published; no source maps;
>    no stack traces in error responses.
> 6. **Authentication, tenant isolation and RLS** unchanged and enforced; the
>    client login is `org_admin`, `platformRole USER`, refused the platform
>    control plane.
> 7. **Trusted-proxy configuration (`FR-021`, `AD-022`):** `TRUSTED_PROXY_CIDRS`
>    is set to the demo project's **own declared Compose subnet** and nothing
>    wider. **`0.0.0.0/0` is forbidden** — it would trust the caller's own
>    forwarded entry, which is the spoof the right-to-left walk in
>    `apps/web/src/lib/auth/session.ts` exists to defeat. Verified by `OPS-016`
>    and `OPS-017`, including a forged-header case.
> 8. **Rate limiting** per address and per account, tested with independent
>    clients rather than assumed from configuration.
> 9. **Synthetic data only**, with every demo tenant one the seed creates.

**Accept explicitly, or require it fixed before launch:** until `FR-021` is
configured, the per-IP login bucket is deployment-wide — 10 sign-ins per five
minutes for the whole environment. Fail-safe, but it will present as a broken
demonstration.

## Gate 5 — implementation readiness

> **HOLD.** Not approved. See `provisioning-checklist.md`.

| | Item | State |
|---|---|---|
| ☐ | Approved demo host | **absent — B1** |
| ☐ | `demo.youhan.in` DNS | **absent — NXDOMAIN** |
| ☐ | Valid TLS path | absent |
| ☐ | GitHub Environment `demo` | **absent — 0 environments exist** |
| ☐ | Required GitHub secrets | **absent — 0 secrets exist** |
| ☐ | Deployment variable | **absent — 0 variables exist** |
| ☐ | SSH host key pinned | absent |
| ☐ | Demo DB provisioned | absent |
| ☐ | Recovery procedure rehearsed | defined, not rehearsed |
| ☐ | Rollback procedure rehearsed | implemented, not rehearsed |
| ☐ | Proxy / rate-limit configuration | designed, not configured |
| ☐ | Monitoring | designed, not configured |
| ☐ | Deployment operator / process | not named |
| ☐ | Post-deployment smoke / E2E plan | **defined** — the one item ready |

Fourteen items, one of which is ready. Gate 5 stays HOLD.
