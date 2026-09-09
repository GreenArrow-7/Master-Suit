# SPEC-0008 — Plan and operational plan

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Last updated | 2026-09-08 |

No implementation is authorised. At R5 an agent may prepare this plan and may
not execute any part of it.

## Approach

Copy the staging pattern, change only what must differ, and add nothing new.
Staging already demonstrates every mechanism this environment needs: a separate
Compose project, its own database with a name marker the boot check reads, its
own secrets, its own reverse-proxy configuration, and a deployment target in the
workflow. The work is a fourth instance of an established pattern, not a new
one — which is why the risk here is operational rather than architectural.

## Architecture decisions

- `AD-001` — A separate Compose project, modelled on the staging file, with its
  own project name, network, volumes and container names. Sharing a project
  would share a failure domain and defeat `SEC-002`.

- `AD-002` — A dedicated database instance for the demo project, named with the
  demo marker so the existing boot cross-check enforces the pairing. The marker
  is not cosmetic: it is the control that turns a wiring mistake into a refusal
  to start.

- `AD-003` — The demo target is added to the deployment workflow additively, as
  a third choice reading secrets under the existing per-environment naming
  scheme. No existing target's behaviour, credentials or approval gate changes.

- `AD-004` — Outbound safety is achieved by environment configuration, not by
  application code. The inert mail, messaging and antivirus providers are
  selected for this environment, and no third-party provider credential is
  issued to it. Changing shared application code to special-case a demo
  environment would put demo-awareness into the production request path, which
  is the outcome this whole approach exists to avoid.

- `AD-005` — No scheduled backup. `CL-004` records the reasoning; the recovery
  path for data loss is a re-seed.

- `AD-006` — Monitoring reuses the existing Prometheus configuration, which is
  already parameterised by environment, with an environment label that makes
  demo series unmistakable in a shared dashboard.

- `AD-007` — Demonstration credentials are generated into the environment's own
  secret set and handed over out of band. Nothing prints them into a workflow
  log, a deployment log or an evidence file.

- `AD-008` — The environment runs the image production runs, or a named newer
  one. It is a demonstration of the product, not a preview branch; a divergent
  build would demonstrate something the customer cannot buy.

- `AD-009` — Rebuild is preferred to repair. Every runbook below ends in
  "rebuild" rather than a diagnostic tree, because the environment holds nothing
  worth preserving and operator time is better spent elsewhere.


### Functional parity (added 2026-09-09)

The parity requirement asks for something the repository is already most of the
way toward, so these decisions are mostly about *closing a gap*, not designing a
mechanism. What already exists is recorded under "Evidence" below, because the
difference between "we should build once and promote" and "this script already
refuses to rebuild a tag it has" is the difference between a plan and a wish.

- `AD-010` — **Promotion, not rebuild, and the existing script already does it.**
  `apps/web/scripts/release.sh` skips the build when the tag's image is present
  and says so: *"promoting it, not rebuilding"*, on the stated ground that
  "the bytes staging exercised are the bytes production starts". Demo joins that
  model as a third environment rather than getting a mechanism of its own.

- `AD-011` — **Demo pulls the CI-built artefact. Production's deploy path is not
  touched.** *(Revised 2026-09-09 on an explicit architecture adjustment.)*

  The earlier version of this decision made mandatory-GHCR-pull a prerequisite
  for the demo launch. That coupled a material change to production's deployment
  mechanism to a demo feature, which is the wrong trade and is now deferred.

  It is also **technically avoidable**, which is the test the adjustment set.
  Measured rather than assumed:

  - `apps/web/infra/docker-compose.prod.yml` names the image
    `master-suite/web:${IMAGE_TAG}` — a **local** tag, not a registry reference.
  - `apps/web/scripts/release.sh` builds only when
    `docker image inspect master-suite/web:<tag>` **fails**, and otherwise
    promotes what it finds.

  So a demo deployment that pulls `ghcr.io/<owner>/<repo>/web:<full-sha>` and
  tags it `master-suite/web:<tag>` before invoking `release.sh` gets promotion
  rather than a host build, with **no edit to `release.sh`, to
  `apps/web/infra/docker-compose.prod.yml`, or to either existing deploy target**. The pull and
  tag happen in the demo deployment path only.

  The one change `release.sh` does need is a `demo` case in `dc_for()`. That is
  additive — a new branch of a `case` statement that cannot alter the staging or
  production branches — and `REG-001` already exists to assert those two are
  behaviourally unchanged.

  Long-term, mandatory registry pull for every environment remains the right
  destination. It is recommended as its own specification rather than carried
  here; see "Deferred workstream" below.

- `AD-012` — **Parity compares full SHAs, expanding short ones first.**

  The two environments genuinely report different widths, and this is measured,
  not anticipated:

  - Demo's image is built by `.github/workflows/build-images.yml`, which passes
    `GIT_SHA=<the full 40-character SHA>`. Demo therefore reports a full SHA.
  - Production's image is built on the host from
    `apps/web/infra/docker-compose.prod.yml`, whose build arg is
    `GIT_SHA: ${IMAGE_TAG:-unknown}`, and `release.sh` sets `IMAGE_TAG` from
    `git rev-parse --short=12`. Production therefore reports a **12-character**
    SHA today.

  Comparing those two as strings would report permanent drift between
  environments that are in fact identical — which is exactly the failure a
  parity checker exists to prevent, arriving as a false positive instead of a
  false negative.

  The rule is therefore: **expand any short SHA to its full form with
  `git rev-parse` against the canonical repository, then compare full to full.**
  That is not a short-SHA comparison; it is a deterministic lookup performed
  before comparison. `git rev-parse` fails loudly on an ambiguous prefix, so a
  hash collision surfaces as an error rather than as a wrong answer.

  This also means production SHA tracking works **today**, with no change to
  production's deployment mechanism — which is what makes `AD-011`'s deferral
  possible rather than merely desirable.

- `AD-013` — **Each environment reports its own commit; nothing infers it.**
  `BUILD_COMMIT` is already baked into the image by the Dockerfile and already
  surfaced as the `masterapp_build_info` metric's `commit` label. That is the
  authority, because it is what the running container says about itself rather
  than what a deploy log claimed. `release.sh`'s `<env>.current` state file is a
  second, independent record; the two disagreeing is itself a finding worth
  reporting rather than a tie to be broken silently.

- `AD-014` — **Parity is a pure function of two SHAs, computed where both are
  visible.** `IN_SYNC` when equal; otherwise the two commits are ordered by
  ancestry in the canonical repository, giving `DEMO_AHEAD` or `DEMO_BEHIND`. If
  neither is an ancestor of the other, the answer is `DIVERGED` — a state the
  requirement does not name but which is reachable the moment somebody deploys
  from a branch, and reporting it honestly is better than forcing it into one of
  the three.

- `AD-015` — **Demo-first ordering follows the existing staging-first gate.**
  `apps/web/scripts/check-staging-first.mjs` already refuses a production
  migration that has not succeeded elsewhere with the same bytes, comparing
  migration checksums rather than names. Demo is added as a rehearsal
  environment in that model. Note the asymmetry deliberately: staging holds a
  restored production snapshot and is the *data-shaped* rehearsal; demo holds
  synthetic data and is the *functional* rehearsal. Demo passing a migration
  does not tell you it is safe against production-shaped volume, so demo must
  not be allowed to substitute for staging in that gate.

- `AD-016` — **Automation detects; a human deploys.** *(Revised 2026-09-09;
  `CL-005` resolved to Option C.)*

  After a production release the pipeline computes parity and reports it. On
  `DEMO_BEHIND` it names the exact commit difference and the approved deployment
  action, and stops. It holds **no deployment credential for any environment**,
  demo included, so `TH-014` is closed by absence of capability rather than by a
  conditional that a later edit could remove.

  The cost is honest and accepted: drift is now visible immediately but still
  closes only when somebody acts. `OBS-005` and the drift target in `CL-006` are
  what stop that becoming the silent months-long drift the requirement was
  raised against.

- `AD-017` — **Differences between environments stay in configuration.** No
  `if (isDemo)` in shared application code. The demo/production difference is
  `APP_ENV`, the database URL, provider selection and secrets — all of which the
  application already reads from the environment, and all of which
  `apps/web/src/lib/startup-check.ts` already cross-checks. Adding a demo-awareness branch
  to the request path would put demo behaviour into production's binary, which
  is exactly the coupling parity is meant to avoid.

- `AD-018` — **The demo seed is a release artefact.** It lives in the same
  repository, ships in the same commit, and gains synthetic records for new
  functionality in the same change that adds the functionality. It is never
  populated from production rows; `DATA-004` forbids the path and `UT-013` in
  `SPEC-0007` already asserts the address-domain half of it.

- `AD-019` — **The demo release source is a CI-built image, addressed by full
  SHA.** GitHub builds `ghcr.io/<owner>/<repo>/{web,worker}:<full-sha>` from the
  approved commit; the demo deployment pulls those, tags them locally as
  `master-suite/{web,worker}:<tag>`, and lets `release.sh` promote them. The
  demo host never builds the application, so it needs no build toolchain and no
  source tree beyond the checkout that `release.sh` requires for migrations.

  Note that checkout requirement is not incidental: migrations are read from the
  working tree, not from the image, and `release.sh` refuses a tree whose HEAD
  does not match the tag being deployed. The demo path keeps that guard.

- `AD-020` — **Short-to-full SHA resolution happens in CI, against a full
  checkout, and refuses to guess.**

  Production reports a 12-character prefix; demo reports 40. The parity job runs
  in GitHub Actions with `fetch-depth: 0`, so it holds the canonical commit
  graph and needs **no shell access to production** to resolve anything.

  Resolution uses `git rev-parse --disambiguate=<prefix>`, which lists every
  object matching the prefix — verified 2026-09-09 to give exactly the semantics
  required:

  | Matches | Meaning | Result |
  |---|---|---|
  | exactly 1 | the commit is identified | expand to the full SHA, compare |
  | 0 | the commit is not in the canonical history | `UNKNOWN` — reason: unresolvable prefix |
  | more than 1 | ambiguous prefix | `UNKNOWN` / ambiguous — **fail the check** |

  A 12-character comparison is never performed. Expansion happens first or the
  answer is `UNKNOWN`; there is no third path.

- `AD-021` — **A migration image must be published, or "no host rebuild" is not
  achievable.** *(Found 2026-09-09 while reconciling the deployment scope.)*

  The `production` stage of `apps/web/infra/Dockerfile` is Next.js **standalone**
  output. It carries `prisma/` but not the `prisma` CLI, which is a
  devDependency — which is exactly why both existing `migrate` services use
  `target: build` instead. `.github/workflows/build-images.yml` publishes only
  `web` and `worker`.

  So a demo environment that pulls only those two images **cannot run
  migrations**, and the only ways out are to build the migrate image on the demo
  host — contradicting the no-rebuild requirement — or to expose the demo
  database to the CI runner, which is worse.

  The decision is to add a third entry to the `.github/workflows/build-images.yml` matrix
  publishing the `build` stage as a `migrate` image tagged by the same full SHA.
  This is **additive to the build workflow and changes no environment's
  deployment behaviour**: production and staging continue to build their own
  migrate service locally exactly as they do today.

  Recorded as a decision rather than a detail because it is the one place where
  the stated architecture did not survive contact with the Dockerfile.

- `AD-022` — **The trusted proxy range is the demo project's own Compose
  network, declared explicitly.**

  `clientIp()` in `apps/web/src/lib/auth/session.ts` already walks
  `x-forwarded-for` right to left and returns the furthest hop **not** in the
  trusted set, skipping unparseable entries; with nothing declared it returns
  `null` and falls back to a shared bucket rather than believing a header the
  caller controls. The logic is sound — it is only unconfigured.

  For the permanent demo, Caddy terminates TLS on the same host and proxies over
  the project's Compose network, so the single trusted hop is Caddy's address on
  that network. The network's subnet is therefore **declared explicitly in
  **docker-compose.demo.yml** (new)** rather than left to whatever Docker allocates, and
  `TRUSTED_PROXY_CIDRS` is set to exactly that subnet.

  `0.0.0.0/0` is forbidden: it would trust every hop in the chain, which means
  trusting the client's own first entry, which is the spoof the right-to-left
  walk exists to defeat. Making rate limiting "work" that way would make it
  worthless.

- `AD-023` — **Recovery is reconstruction, with stated objectives.**

  `CL-004` decided no scheduled backup. That is only defensible with a recovery
  objective attached, so:

  | Objective | Value | Basis |
  |---|---|---|
  | **RPO** | **The last deployed commit.** No demonstration data is durable; anything a presenter typed during a demonstration is expected to be lost. | The dataset is deterministic output of the seed, so the only recoverable state is the seed's input |
  | **RTO** | **≤ 2 hours** from a destroyed environment to a verified demonstration, of which the rebuild itself is minutes | Provisioning is automated; the bound is dominated by host creation, not by data |

  The procedure is fixed: empty database → migrations from the deployed release →
  deterministic seed → client login provisioned by that seed → reset verification
  → Sales smoke test → HRMS smoke test. Each step is already automated;
  `FR-022` is what makes the objectives part of the specification rather than
  folklore.

  If the business needs a demonstration's *in-session* edits to survive, this
  model does not deliver it and backups must be added. That is stated so the
  choice is visible rather than discovered mid-incident.

- `AD-024` — **Reset must cover every seeded workspace.** `SPEC-0007`/`CONV-011`
  records that `--reset` today drops only the primary demo tenant, so the
  second workspace survives and cannot be rebuilt from a changed definition.
  That is tolerable on a laptop and not tolerable in a permanent environment
  whose only recovery path is reconstruction. `FR-023` requires the gap closed
  before gate 5.

### Deferred workstream — production deploy-path migration

Recommended as **`SPEC-0009`**, the next free identifier (`SPEC-0008` is the
highest allocated today). Not opened here: opening a specification is not this
specification's work, and the identifier should be recomputed at creation time
rather than reserved in advance.

**Scope of that specification, as recommended:** move every environment from
"build on the host when the image is absent" to "pull the approved artefact from
the registry, and fail when it is absent". It carries the production deployment
mechanism, a registry credential on each deployment host, and the removal of the
local-build fallback — the fallback being the part that matters, because a
fallback that silently builds fires exactly when the registry is unreachable and
nobody is watching.

**Why it is genuinely separate:** it changes how production deploys, its risk
sits in production's release path rather than in a demonstration environment,
and none of it is required for the demo to launch. It should not ride along on a
demo feature for architectural tidiness.

**What this specification does instead:** demo obtains the same CI-built
artefact by pulling and tagging it, which achieves same-artefact provenance for
demo without asserting it for production. Parity in this phase is therefore
established on the **deployed full commit SHA**, not on identical container
digests — a weaker claim, stated as such rather than overclaimed.

### Evidence: what already exists, measured 2026-09-09

| Capability | State | Where |
|---|---|---|
| Immutable artefact per commit | **exists** | `.github/workflows/build-images.yml` — GHCR, tagged by full SHA, never `latest` |
| Commit baked into the artefact | **exists** | `apps/web/infra/Dockerfile` — `ARG GIT_SHA` → `ENV BUILD_COMMIT` |
| Deployment reports its commit | **exists** | `masterapp_build_info{commit,built_at}` in `apps/web/src/lib/metrics.ts` |
| Build-once / promote | **exists** | `apps/web/scripts/release.sh` — skips build when the tag is present |
| Per-environment deployed version | **exists** | `release.sh` state files, and `release.sh status` |
| Promotion takes the rehearsed tag | **exists** | production defaults to the tag staging is running |
| Migration-before-production gate | **exists** | `apps/web/scripts/check-staging-first.mjs`, by checksum |
| Separate database per environment | **exists** | per-environment `--env-file`, plus the boot cross-check |
| Rollback without data restore | **exists** | `release.sh rollback`, deliberately schema-untouching |
| Demo as a deploy target | **absent** | `dc_for()` accepts staging and production only |
| Registry as the artefact source | **absent** | `release.sh` builds locally when the image is missing |
| Cross-environment parity status | **absent** | `release.sh status` reports one host, not a comparison |
| Drift policy | **absent** | nothing records or bounds an intentional mismatch |

Four gaps, three of them small. The one that is not small is `AD-011`, because
it changes how production deploys.

## Affected files and components

Existing files to be modified:

- `.github/workflows/deploy.yml` — add the demo target, additively.
- `docs/ENVIRONMENTS.md` — record that the environment now exists, with its
  address and its owner.

New files to be created (named in plain text because they do not exist yet):

- apps/web/infra/docker-compose.demo.yml — the Compose project.
- apps/web/infra/Caddyfile.demo — reverse proxy and TLS.
- docs/DEPLOY-DEMO.md — the provisioning, deployment, rollback and
  decommissioning runbook.

Created outside the repository: the host, the DNS record, the certificate, the
deployment credentials and the environment's secret set. None of these is a
file in this repository and none may be committed.

## Data model impact

**None.** No schema change and no migration. The demo database is created by
applying the existing migration history to an empty database, which is the same
path every environment uses.

## Security impact

The security surface this adds is an internet-reachable deployment of the
application holding synthetic data. It adds no new code path, no new
authorization decision and no new secret class.

The controls that matter are all configuration:

- Network and credential separation from production and staging (`SEC-001`,
  `SEC-002`), enforced by a separate project, separate host and separate
  credentials.
- The boot cross-check (`SEC-003`), preserved and relied on.
- Inert providers and no vendor credentials (`SEC-004`).
- Deployment credentials scoped to this environment alone (`SEC-005`).
- TLS with the same headers the other environments serve (`SEC-006`).

`threat-model.md` records what could go wrong with each.

## Deployment impact

This specification *is* the deployment impact. It adds an environment, a target,
a credential set, a DNS record, a certificate and a monitoring series. It
changes no existing environment.

## Operational plan

### Provisioning

1. Confirm `CL-001` and `CL-002` are answered.
2. Prepare the host. Record its identity in the runbook, not in the repository.
3. Generate the environment's secret set with the existing generator. Never
   copy a value from another environment.
4. Create the database with the demo name marker.
5. Bring up the Compose project. Confirm the boot check reports the demo
   environment and did not refuse.
6. Apply the migration history to the empty database.
7. Seed the demonstration data — `SPEC-0007` — and confirm its four environment
   gates permitted the run for the right reasons.
8. Publish the address and issue the certificate.
9. Run the production-readiness verification in `test-plan.md`.

### Deployment

Deploy through the workflow, selecting the demo target. The image is the one
production runs or a named newer one (`AD-008`). Deployment during a
demonstration is forbidden by convention rather than by tooling; the runbook
says so and the owning team schedules around demonstrations.

### Rollback

Redeploy the previous image through the same workflow. No data restoration is
involved (`FR-011`). If the environment is unhealthy after rollback, rebuild it
(`AD-009`).

### Recovery from data loss

Re-seed. There is no restore path and deliberately none (`CL-004`, `AD-005`).

### Decommissioning

Stop and remove the Compose project, its volumes and its database; revoke the
deployment credentials; delete the environment's secrets; remove the DNS record
and let the certificate lapse; remove the monitoring target; record the date in
the runbook. `DATA-003`.

### Between demonstrations

The environment may be left running or stopped. If stopped, the runbook's
start procedure is the deployment procedure with no image change.

## Rollback of this change itself

Reverting the repository change removes the demo Compose file, the demo
reverse-proxy configuration and the demo workflow target. Because every change
is additive, the revert cannot affect staging or production. The host, DNS
record and credentials are removed by the decommissioning procedure, which is
part of this specification rather than an afterthought.

## Verification strategy

`test-plan.md` holds the detail. It is unusual in shape for this repository
because almost nothing here is unit-testable: the subject is a deployed
environment, so the evidence is a rehearsal and an inspection rather than a
suite. The one genuinely automatable part is the workflow change, and the
staging rehearsal exists to prove the additive claim.

## Assumptions and unknowns

- Assumed: a host and a domain can be made available. `CL-001`, `CL-002`.
- Unknown: whether the existing monitoring stack has capacity for a fifth
  environment's series. Established during provisioning, not from the
  repository.
- Unknown, and stated as such: everything about the runtime behaviour of
  production and staging. This plan asserts nothing about either and touches
  neither.
