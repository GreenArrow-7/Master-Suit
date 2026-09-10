# SPEC-0008 — Tasks

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Date | 2026-09-08 |

**Every task is `BLOCKED`.** At R5 no task may begin until gate 1 (Product Owner
and Solution Architect), gate 2 (Solution Architect), gate 3 (Application
Security) and gate 5 (Solution Architect) are all discharged, and `CL-001` and
`CL-002` are answered. None of that has happened.

**Every task is executed by a human.** R5 execution is human-only; an AI agent
may prepare these tasks and may not run them.

## Task list

| Task | Purpose | Blocked on |
|---|---|---|
| `TASK-001` | Demo Compose project | gates 1, 2, 3, 5; `CL-001` |
| `TASK-002` | Reverse proxy and TLS | gates 1, 2, 3, 5; `CL-002` |
| `TASK-003` | Deployment target | gates 1, 2, 3, 5 |
| `TASK-004` | Secrets and provider configuration | gates 1, 2, 3, 5 |
| `TASK-005` | Monitoring and alerting | gates 1, 2, 3, 5; `TASK-001` |
| `TASK-006` | Runbook | gates 1, 2, 3, 5; `TASK-001`–`TASK-005` |
| `TASK-007` | Rehearsal and security verification | `TASK-006` |
| `TASK-008` | Production-readiness verification | `TASK-007` |

---

## TASK-001

**Purpose:** a Compose project for the demo environment, modelled on the staging
project.

**Requirements:** `FR-001`, `FR-002`, `FR-003`, `NFR-001`, `SEC-002`, `SEC-003`.
Decisions `AD-001`, `AD-002`.

**Dependencies:** `CL-001` answered.

**Allowed scope:** `apps/web/infra/`

**Prohibited paths:** `apps/web/infra/docker-compose.prod.yml`,
`apps/web/infra/docker-compose.staging.yml`,
`apps/web/infra/docker-compose.azure.yml`, `apps/web/src/`

**Expected files and components:** a demo Compose file with its own project
name, network, volumes, container names and database carrying the demo name
marker.

**Required tests:** `IT-001`, `IT-002`, `IT-003`

**Security implications:** this task creates the separation that `SEC-002`
depends on. The database name marker is the input to the boot cross-check and
is a security control, not a convention.

**Data and migration implications:** none to the schema. The database is created
empty and receives the existing migration history.

**Definition of Done:** the project boots, reports the demo environment, and
`IT-003` confirms it shares no name, network, volume or container with another
environment.

**Status:** `BLOCKED`

---

## TASK-002

**Purpose:** reverse-proxy configuration and TLS for the demo address.

**Requirements:** `FR-007`, `SEC-006`, `SEC-008`. Decisions `AD-001`.

**Dependencies:** `CL-002` answered.

**Allowed scope:** `apps/web/infra/`

**Prohibited paths:** `apps/web/infra/Caddyfile`,
`apps/web/infra/Caddyfile.staging`, `apps/web/src/`

**Expected files and components:** a demo proxy configuration following the
existing pattern, with the same header set the other environments serve.

**Required tests:** `ST-009`, `IT-007`

**Security implications:** the address is the environment's exposure. If
`CL-002` resolves to a restricted address, the restriction is implemented here
and `ST-005` becomes correspondingly easier to satisfy.

**Data and migration implications:** none.

**Definition of Done:** `ST-009` passes; plaintext is redirected; the
certificate is valid and its renewal path is recorded in the runbook.

**Status:** `BLOCKED`

---

## TASK-003

**Purpose:** add the demo target to the deployment workflow, additively.

**Requirements:** `FR-004`, `FR-011`, `SEC-005`, `OBS-002`. Decisions `AD-003`.

**Dependencies:** none.

**Allowed scope:** `.github/workflows/deploy.yml`

**Prohibited paths:** `.github/workflows/ci.yml`,
`.github/workflows/build-images.yml`, `.github/workflows/sdd-validate.yml`

**Expected files and components:** a third environment choice, reading its
credentials under the existing per-environment naming scheme.

**Required tests:** `UT-001`, `REG-001`, `IT-004`, `ST-004`

**Security implications:** this task edits a file that deploys production. The
change must be additive, and `REG-001` exists to prove it. A change that alters
the staging or production target's behaviour, credentials or approval gate is
out of scope and stops the work.

**Data and migration implications:** none.

**Definition of Done:** `REG-001` shows the existing targets unchanged;
`ST-004` shows the demo credential refused elsewhere; `IT-004` shows deploy and
rollback working.

**Status:** `BLOCKED`

---

## TASK-004

**Purpose:** generate the environment's secrets and select the inert providers.

**Requirements:** `FR-005`, `FR-006`, `FR-012`, `SEC-001`, `SEC-004`, `SEC-007`,
`DATA-001`. Decisions `AD-004`, `AD-007`.

**Dependencies:** `TASK-001`.

**Allowed scope:** `apps/web/infra/`

**Prohibited paths:** `apps/web/src/`, `apps/web/scripts/generate-secrets.mjs`

**Expected files and components:** environment configuration selecting the mock
mail, messaging and antivirus providers, and holding no third-party provider
credential. The secret values themselves live in the environment, never in the
repository.

**Required tests:** `ST-003`, `ST-006`, `ST-008`

**Security implications:** the central control for `TH-002` and `TH-005`. No
value may be copied from another environment. Nothing may print a secret.

**Data and migration implications:** none.

**Definition of Done:** `ST-003` finds no shared value; `ST-006` shows nothing
leaves the host during a full walkthrough; `ST-008` finds no secret in any log.

**Status:** `BLOCKED`

---

## TASK-005

**Purpose:** monitoring and alerting for the environment.

**Requirements:** `FR-008`, `OBS-001`, `NFR-004`. Decisions `AD-006`.

**Dependencies:** `TASK-001`.

**Allowed scope:** `apps/web/infra/`

**Prohibited paths:** `apps/web/src/`

**Expected files and components:** a monitoring target and an environment label
that makes demo series unmistakable alongside production series.

**Required tests:** `IT-006`, `ST-012`

**Security implications:** none directly. Mislabelled series are an operational
hazard rather than a security one, which is why `ST-012` tests recognisability
rather than access.

**Data and migration implications:** none.

**Definition of Done:** an induced failure alerts the owning team, and `ST-012`
confirms an operator can identify the environment within one screen.

**Status:** `BLOCKED`

---

## TASK-006

**Purpose:** the runbook — provisioning, deployment, rollback, recovery,
decommissioning, and what to do between demonstrations.

**Requirements:** `FR-009`, `FR-010`, `NFR-002`, `NFR-003`, `DATA-002`,
`DATA-003`, `OBS-003`. Decisions `AD-005`, `AD-008`, `AD-009`.

**Dependencies:** `TASK-001` to `TASK-005`.

**Allowed scope:** `docs/ENVIRONMENTS.md`

**Prohibited paths:** `docs/sdd/`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/RISK_CLASSIFICATION.md`, `docs/DEPLOY-STAGING.md`, `docs/DEPLOYMENT.md`

**Expected files and components:** a demo deployment runbook, and an updated
environments document recording that the environment now exists, with its owner.
The new runbook file is created under the documentation directory; it does not
exist yet and so is not cited here as a resolvable path.

**Required tests:** `IT-005`

**Security implications:** the runbook states the prohibition on copying
production data in, which is the only control available against `TH-006`. It
records no secret value and no host credential.

**Data and migration implications:** none.

**Definition of Done:** `IT-005` is executed by following the runbook, by
someone who did not write it, without recourse to its author.

**Status:** `BLOCKED`

---

## TASK-007

**Purpose:** the rehearsal and the security verification.

**Requirements:** `SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-005`,
`SEC-006`, `SEC-007`, `SEC-008`, `DATA-001`, `DATA-002`.

**Dependencies:** `TASK-006`.

**Allowed scope:** `docs/ENVIRONMENTS.md`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`

**Expected files and components:** a witnessed evidence record of every case in
the rehearsal and security sections, recording command names and outcomes and
never captured secret output.

**Required tests:** `IT-001` to `IT-007`, `ST-001` to `ST-012`, `E2E-001`

**Security implications:** this task *is* the security evidence. A case that
cannot be executed is recorded as not executed, never as passed.

**Data and migration implications:** none.

**Definition of Done:** every case has an outcome; every failure has a
disposition; nothing is recorded as verified that was not run.

**Status:** `BLOCKED`

---

## TASK-008

**Purpose:** production-readiness verification before any client sees the
environment.

**Requirements:** `FR-009`, `FR-010`, `FR-011`, `NFR-002`.

**Dependencies:** `TASK-007`.

**Allowed scope:** `docs/ENVIRONMENTS.md`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`,
`.github/workflows/deploy.yml`

**Expected files and components:** the completed seven-point readiness record
from the test plan, signed by the owning team.

**Required tests:** `IT-005`, `IT-004`

**Security implications:** the readiness record is the last point at which an
unverified control can be caught before a prospect is looking at the screen.

**Data and migration implications:** none.

**Definition of Done:** all seven readiness points are satisfied, including that
`SPEC-0007` has converged so there is something to demonstrate.

**Status:** `BLOCKED`


---

## TASK-009

**Purpose:** give the demo environment the CI-built artefact, **without changing
how staging or production deploy**.

**Requirements:** `FR-013`, `FR-014`.

**Dependencies:** gate 5.

**Revised 2026-09-09.** This task previously made mandatory registry pull — a
change to production's deploy path — a prerequisite for the demo launch. That
coupling is removed. The production migration is deferred to its own
specification (recommended `SPEC-0009`; see the plan's "Deferred workstream").

**Allowed scope:** `.github/workflows/deploy.yml`,
`.github/workflows/build-images.yml`, `apps/web/scripts/release.sh`,
`apps/web/infra/`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`,
`apps/web/infra/docker-compose.prod.yml`, `apps/web/infra/docker-compose.azure.yml`,
`apps/web/infra/docker-compose.staging.yml`

**Expected files and components — stated exactly, because an earlier summary of
this task was contradictory and a gate cannot be approved against ambiguous
scope:**

1. **`apps/web/scripts/release.sh` — YES, it changes.** `dc_for()` lives at
   line 69 of that file; there is no other extension point, and its `*)` branch
   fails on an unknown environment. Four edits, all additive:

   | Site | Edit |
   |---|---|
   | `dc_for()`, ~line 69 | add a `demo)` case selecting the demo env-file and the new demo overlay |
   | `dc_for()` `*)`, ~line 78 | widen the error text to name demo |
   | `status`, ~line 91 | `for envname in staging production demo` |
   | usage strings, ~lines 110 and 132 | name demo |

   **No edit is required at ~line 137**, the promotion branch: it is guarded by
   `[ "${ENVIRONMENT}" = 'production' ]`, and the demo deployment always passes
   an explicit SHA, so demo takes the first branch and never inherits staging's
   tag.

2. **A new demo Compose overlay**, peer of the staging file. It must define its
   own `migrate` service, because that service exists only in the per-environment
   overlays. Model it on the **staging** one — a plain `prisma migrate deploy`
   with no staging-first gate — not on production's, which runs
   `apps/web/scripts/check-staging-first.mjs` and expects a `STAGING_DATABASE_URL`.

3. **`.github/workflows/deploy.yml`** — `demo` added to the target choices, and,
   in the demo path only, a pull-and-tag step before `release.sh`.

4. **`.github/workflows/build-images.yml`** — a third matrix entry publishing the
   `build` stage as a `migrate` image, per `AD-021`. Without it the demo host
   cannot run migrations without building, and "no host rebuild" is unachievable.
   Additive to the build workflow; it changes no environment's deploy behaviour.

**Required tests:** `REG-002`, `UT-004`, `REG-001`

**Security implications:** the demo host gains a **read-only, pull-scoped**
registry credential and no build toolchain. `REG-001` is required here, not
optional: it is what demonstrates the staging and production targets are
behaviourally unchanged by edits to files they share — `release.sh` is shared by
all three environments, so "additive" is a claim that must be tested rather than
asserted.

**Staging behaviour affected: NO. Production behaviour affected: NO.** Every
edit above adds a branch or widens a message; none alters the staging or
production branches, and neither existing overlay is touched. `REG-001` is the
evidence for that claim.

**Data and migration implications:** none directly. `release.sh` reads
migrations from the working tree and refuses a tree whose HEAD is not the
deployed tag, so the demo path keeps the checkout step for that reason rather
than for the image.

---

## TASK-010

**Purpose:** report each environment's deployed commit and compute parity from
the two, deterministically.

**Requirements:** `FR-015`, `FR-016`, `OBS-004`, `OBS-005`.

**Dependencies:** `TASK-009`.

**Allowed scope:** `apps/web/scripts/release.sh`, `apps/web/scripts/`,
`.github/workflows/deploy.yml`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`

**Expected files and components:** a parity reporter that reads
`masterapp_build_info` from each environment, compares full SHAs by ancestry,
and emits `IN_SYNC`, `DEMO_AHEAD`, `DEMO_BEHIND` or `DIVERGED`. It reports the
disagreement rather than picking a winner when the metric and
`release.sh`'s state file differ.

**Required tests:** `UT-002`, `UT-003`, `OPS-010`, `OPS-011`, `OPS-015`

**Security implications:** reading `masterapp_build_info` requires
`METRICS_TOKEN`, so this introduces a read credential for each environment.
Read-only and metric-scoped; it must not be reused as a deployment credential.

**Data and migration implications:** none. The reporter touches no database,
which is `OBS-004`'s stated requirement and not merely a convenience.

---

## TASK-011

**Purpose:** add demo as a deployment target, and add parity **reporting**.

**Requirements:** `FR-017`, `SEC-009`.

**Dependencies:** `TASK-010`.

**Revised 2026-09-09.** `CL-005` resolved to Option C, so this task no longer
builds a job that deploys. It builds one that reports and stops.

**Allowed scope:** `.github/workflows/deploy.yml`, `apps/web/scripts/release.sh`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/`,
`apps/web/infra/docker-compose.azure.yml`,
`apps/web/infra/docker-compose.staging.yml`

**Expected files and components:** `demo` added to the workflow's environment
choices and to `dc_for()`. A parity report that runs after a release, states the
status and — on `DEMO_BEHIND` — names the exact commit difference and the
approved deployment action a human then dispatches.

**Required tests:** `UT-005`, `OPS-013`, `ST-013`

**Security implications:** the whole of `SEC-009`, now stronger than it was. The
parity job holds **no deployment credential for any environment**, so it cannot
deploy anywhere — not to production, and not to demo either. `TH-014` is closed
by absent capability rather than by a guard. An agent may not run this task; R5
execution is human-only.

**Data and migration implications:** none.

---

## TASK-012

**Purpose:** prove the separation parity must not erode — different databases,
no production rows, governed migration order.

**Requirements:** `FR-018`, `DATA-004`, `DATA-005`.

**Dependencies:** `TASK-011`.

**Allowed scope:** `apps/web/scripts/check-staging-first.mjs`,
`docs/ENVIRONMENTS.md`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/migrations/`

**Expected files and components:** demo added as a rehearsal environment in the
migration-ordering gate, **without** allowing it to substitute for staging:
staging rehearses against production-shaped data and demo does not, so demo
passing a migration is not evidence that production will.

**Required tests:** `OPS-014`, `ST-014`, `ST-015`, `ST-016`

**Security implications:** `DATA-004` is the requirement most likely to be
eroded by convenience — "just copy a tenant to reproduce it" is the failure this
task exists to make impossible rather than discouraged.

**Data and migration implications:** the whole task. No schema change of its
own; it changes the order in which schema changes are applied.

---

## TASK-013

**Purpose:** let the demonstration dataset and the demo login grow with the
product, without either becoming a bypass.

**Requirements:** `FR-019`, `FR-020`.

**Dependencies:** `TASK-012`. Overlaps `SPEC-0007`, which owns the seed; this
task owns only the rule that the seed evolves with the release.

**Allowed scope:** `docs/ENVIRONMENTS.md`, `docs/DEMO.md`

**Prohibited paths:** `apps/web/src/lib/security/`, `apps/web/src/lib/auth/`

**Expected files and components:** the documented rule that a release adding
demonstrable functionality also adds synthetic seed data for it, and that new
demonstration capability is granted through role and entitlement only.

**Required tests:** `UT-006`, `ST-017`

**Security implications:** `FR-020` is where parity could quietly become
privilege. Growing the demonstration surface must go through the authorization
model; a demo-only branch in shared code would put demo behaviour into
production's binary.

**Data and migration implications:** seed content only, always synthetic.

---

## TASK-014

**Purpose:** configure client-address extraction so per-address rate limiting
works behind the demo's own reverse proxy, without trusting a header the caller
controls.

**Requirements:** `FR-021`.

**Dependencies:** `TASK-011`, and a provisioned host — the correct value is a
fact about deployed infrastructure, not a constant that can be chosen in advance.

**Allowed scope:** `apps/web/infra/`, `docs/ENVIRONMENTS.md`

**Prohibited paths:** `apps/web/src/`, `.github/workflows/`

**Expected files and components:** the demo Compose network's subnet declared
explicitly rather than left to Docker's allocator, and `TRUSTED_PROXY_CIDRS` set
to exactly that subnet in the demo environment file.

**Required tests:** `OPS-016`, `OPS-017`

**Security implications:** the whole task. `apps/web/src/lib/auth/session.ts`
already walks the forwarded chain right to left and returns the furthest hop not
in the trusted set; the code is correct and merely unconfigured. Setting the
range too wide is worse than leaving it empty — empty falls back to a shared
bucket that no caller can steer, while `0.0.0.0/0` would trust the client's own
first entry and hand every caller a rate-limit identity of their choosing.

**Data and migration implications:** none.

---

## TASK-015

**Purpose:** make recovery a rehearsed procedure with stated objectives, and
close the reset gap that would otherwise leave a stale workspace behind.

**Requirements:** `FR-022`, `FR-023`.

**Dependencies:** `TASK-014`.

**Allowed scope:** `docs/ENVIRONMENTS.md`, `docs/DEMO.md`,
`apps/web/prisma/seed/index.ts`

**Prohibited paths:** `apps/web/src/`, `apps/web/prisma/migrations/`,
`.github/workflows/`

**Expected files and components:** the recovery runbook with its recovery-point
and recovery-time objectives, and a reset that covers **every** workspace the
seed creates rather than only the primary one.

**Required tests:** `OPS-018`, `OPS-019`, `ST-018`

**Security implications:** low directly, but this is what makes "no backups"
defensible. Without a rehearsed reconstruction, `CL-004`'s decision is an
assumption rather than a control.

**Data and migration implications:** the reset's coverage is the whole point.
`SPEC-0007`/`CONV-011` records the current gap — `--reset` drops only the
primary demo tenant — and this task closes it for the permanent environment.
Overlaps `SPEC-0007`, which owns the seed; the ordering between the two is a
sequencing question for whoever schedules the work, and is called out here
rather than assumed away.