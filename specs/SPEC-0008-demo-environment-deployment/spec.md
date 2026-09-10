# SPEC-0008 — Dedicated Client Demo Environment Deployment

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0008` |
| Title | Dedicated Client Demo Environment Deployment |
| Status | `READY_FOR_PLAN` |
| Risk | `R5` |
| Owner | DevOps / Production Engineering |
| Created | 2026-09-08 |
| Last updated | 2026-09-08 |
| Supersedes | none |
| Superseded by | none |

## Problem

There is no demo environment. `docs/ENVIRONMENTS.md` describes one — `APP_ENV`
of `demo`, a database named for it, the demo seed as *the* use case — and the
application honours the contract: `apps/web/src/lib/env.ts` accepts the value,
and `apps/web/src/lib/startup-check.ts` cross-checks it against the database
name. But nothing deploys it. There is no demo compose file beside the staging
and production ones, the deployment workflow offers only staging and production,
and no demo deployment credentials exist.

The consequence is that a client demonstration has nowhere to run except a
developer's laptop or a customer-bearing environment. Neither is acceptable: a
laptop is not the product, and the customer database must never hold synthetic
demonstration data.

## Goal

A deployed, reachable, isolated demo environment running the same application
image as production, holding only synthetic data, incapable of contacting a real
external recipient, and disposable without touching any customer system.

## Background and context

Five environments are declared in `docs/ENVIRONMENTS.md`; four have somewhere to
run. Staging is the closest model: `apps/web/infra/docker-compose.staging.yml`
is a separate Compose project with its own name, network, volumes and database,
and `docs/DEPLOY-STAGING.md` is its runbook. The deployment workflow
`.github/workflows/deploy.yml` takes an environment choice and reads per-
environment secrets by name. `apps/web/scripts/generate-secrets.mjs` generates a
distinct secret set per environment.

The application already supports inert providers — mock mail, mock messaging,
mock antivirus — selected by environment variable, which is the mechanism this
specification uses to guarantee no outbound contact rather than changing any
shared application code.

## Scope

- A demo runtime declaring `APP_ENV` of `demo`, on its own database.
- Demo infrastructure: a Compose project, reverse proxy and TLS, its own
  network and volumes.
- A demo target in the deployment workflow, with its own credentials.
- Environment secrets generated for, and used only by, this environment.
- Provider configuration that makes outbound contact impossible.
- Monitoring and alerting for the environment.
- Backup, restore and rollback appropriate to a disposable environment.
- Provisioning and decommissioning runbooks.
- A production-readiness verification before the environment is used with a
  client.

## Out of scope

- The demonstration data, personas and reset. That is `SPEC-0007`.
- Any change to the production or staging environments, their data, their
  secrets or their deployment path.
- Any change to shared application code, including the mailer.
- A demo tenant inside the production customer database.
- Customer-facing availability guarantees for this environment.

## Actors

- **DevOps / Production Engineering** — provisions, deploys, decommissions.
- **Solution Architect** — approves architecture and implementation readiness.
- **Human Release Authority** — approves the deployment.
- **Demonstrator** — a sales representative, an ordinary user of the result.
- **Prospect** — reaches the environment over the public internet.

## User stories

- As a demonstrator, I need a stable public address running the real product, so
  that a demonstration does not depend on my laptop.
- As a security owner, I need the demo environment to be incapable of reaching a
  customer system or a real recipient, so that a demonstration cannot become an
  incident.
- As an operator, I need to rebuild or destroy this environment without
  ceremony, so that a broken demonstration is a ten-minute problem.

## Functional requirements

- `FR-001` — A demo runtime exists, declaring `APP_ENV` of `demo`, serving the
  same application image production serves.
- `FR-002` — The demo runtime uses its own database, whose name carries the
  demo marker the boot cross-check reads.
- `FR-003` — The demo environment is a separate deployment project with its own
  network, volumes and container names, sharing nothing with staging or
  production.
- `FR-004` — The deployment workflow offers demo as a target, using credentials
  scoped to that environment.
- `FR-005` — The environment holds its own generated secrets, sharing no value
  with any other environment.
- `FR-006` — The environment selects the inert mail, messaging and antivirus
  providers, and holds no third-party provider credential.
- `FR-007` — The environment is reachable over TLS at a stable address.
- `FR-008` — Monitoring covers liveness, error rate and queue health, with
  alerting routed to the owning team.
- `FR-009` — Rebuilding the environment from nothing is a documented procedure
  that completes without manual database editing.
- `FR-010` — Decommissioning is a documented procedure that removes the runtime,
  its data and its secrets.
- `FR-011` — A rollback returns the environment to the previously deployed
  image without data restoration being required.
- `FR-012` — Demonstration credentials are provisioned through the environment's
  secret mechanism, and are not printed into any log or artefact.

### Functional parity with production

Added 2026-09-09 on an authoritative business requirement: the demo environment
must not become a stale fork of the product. The requirement is **code parity,
not data replication**, and `DATA-001` continues to forbid the second absolutely.

- `FR-013` — Demo and production are built from the same canonical repository.
  No demo-specific fork, branch-of-record, or duplicated application source
  exists, and no application file is copied to a host by hand.
- `FR-014` — The demo environment starts an artefact built by CI from the
  approved commit, identified by that commit's full SHA. It does not build the
  application on its own host. *(Scoped to demo by the 2026-09-09 architecture
  adjustment: extending build-once to production's deploy path is deferred to
  its own specification — see `AD-011`.)*
- `FR-015` — Each environment reports the exact commit it is running, from the
  deployment itself rather than from what a deploy log claimed.
- `FR-016` — Parity between demo and production is calculated from those two
  reported commits and expressed as exactly one of `IN_SYNC`, `DEMO_AHEAD`,
  `DEMO_BEHIND`, `DIVERGED` or `UNKNOWN`. It is never inferred from branch
  names, timestamps or intent. `UNKNOWN` is required, not a fallback: a commit
  that cannot be resolved to exactly one full SHA, or a deployment that cannot
  be read, produces `UNKNOWN` with a stated reason rather than a guess.
- `FR-017` — The deployment workflow can deploy an approved release to demo
  without any manual file copying onto the host, and without altering the
  behaviour of the staging or production targets.
- `FR-018` — A migration ships inside the release that requires it and is applied
  to each environment's own database in the governed order — demo first, then
  production after its human release gate. No environment is pointed at another
  environment's database to obtain schema parity.
- `FR-019` — The demonstration dataset evolves with the product: when a release
  adds functionality that needs data to be demonstrable, the demo seed gains
  synthetic records for it, generated rather than sourced.
- `FR-020` — The client-facing login continues to reach the approved
  demonstration surface as that surface grows, through the existing tenant-scoped
  authorization model. New capability is exposed by entitlement and role, never
  by an authorization bypass or a demo-only branch in shared code.
- `FR-021` — The environment declares the address range of its own reverse proxy
  so that client addresses are derived from a trusted hop rather than from an
  unverifiable header, and per-address rate limiting works per address. The
  declaration names the actual proxy network and never a range that would trust
  every caller.
- `FR-022` — Recovery is by reconstruction, not restoration, and has stated
  objectives: an empty database, the release's migrations, the deterministic
  seed, the client login, and a verified reset — with a recovery-point and
  recovery-time objective recorded rather than implied.
- `FR-023` — Reset and recovery cover **every** workspace the seed creates, so
  no stale secondary tenant survives a rebuild. After either, the client login
  exists with Sales and HRMS access, a tenant-scoped role and no platform
  administration.

## Non-functional requirements

- `NFR-001` — The environment costs no production capacity: it shares no host,
  database instance or cache with production.
- `NFR-002` — A rebuild completes within one working session. No tighter
  threshold is asserted; see `CL-003`.
- `NFR-003` — The environment runs the same application version production runs,
  or a named newer one, and never a divergent build.
- `NFR-004` — Availability is best-effort. This environment carries no
  customer-facing availability commitment.

## Security requirements

- `SEC-001` — The demo environment holds no production or staging credential,
  connection string, backup or data extract.
- `SEC-002` — The demo runtime cannot reach the production or staging database,
  cache or object store by network path or by credential.
- `SEC-003` — Boot fails closed when the declared environment and the database
  name disagree, preserving the existing cross-check unweakened.
- `SEC-004` — No outbound message, webhook, payment or document can leave the
  environment to a real external recipient.
- `SEC-005` — Deployment credentials for this environment grant no access to any
  other environment.
- `SEC-006` — The environment is exposed over TLS only, with the same security
  headers the other environments serve.
- `SEC-007` — No secret value appears in the workflow log, the deployment log,
  the application log or any evidence artefact.
- `SEC-008` — The demonstration is understood to be publicly reachable and is
  treated as an untrusted-input surface: the environment receives no
  privileged network position.

- `SEC-009` — Parity automation **detects and reports only**. It holds no
  deployment credential for any environment, so it cannot deploy to demo,
  production or anywhere else, and cannot shorten or bypass a release gate. A
  parity check that finds `DEMO_BEHIND` names the commit difference and the
  approved deployment action; a human dispatches it. *(Narrowed from
  deploy-to-demo by `CL-005`, resolved to Option C on 2026-09-09.)*

## Data and privacy requirements

- `DATA-001` — The environment holds synthetic data only, and never a copy,
  extract, dump or anonymisation of production data.
- `DATA-002` — Backups of this environment, if taken, are treated as synthetic
  and are never restored into another environment.
- `DATA-003` — Decommissioning destroys the environment's data and secrets.
- `DATA-004` — No automated path exists by which production data can reach the
  demo environment. Parity automation moves **artefacts and schema**, never rows:
  no tenant, lead, contact, employee, attendance, leave, payroll, bank,
  biometric, document, credential, token, session or audit record is copied,
  synchronised or mirrored from production, in whole or in part, anonymised or
  otherwise.
- `DATA-005` — The demo database is distinct from every other environment's, and
  parity work never causes the two to be the same database. Sharing a schema
  version is not sharing a database.

## Observability requirements

- `OBS-001` — Liveness, error rate and queue depth are visible for the demo
  environment, labelled so it cannot be confused with production.
- `OBS-002` — Deployment and rollback record what was deployed, by whom, and
  when.
- `OBS-003` — A boot refusal states which cross-check refused it, without
  printing a connection string.
- `OBS-004` — The deployed commit of each environment, and the resulting parity
  status, are reportable on demand without connecting to a database.
- `OBS-005` — An intentional parity mismatch is recorded with its reason, the
  version difference, an owner and an expected resolution date, so that
  `DEMO_BEHIND` cannot persist unexplained.

## Failure behaviour

A mismatched environment declaration refuses to boot. A missing deployment
credential fails the workflow before it connects anywhere. A failed deployment
leaves the previous image serving. A corrupted environment is rebuilt rather
than repaired, because it holds nothing worth recovering.

## Edge cases

First provisioning, with no prior state; a rebuild over an existing environment;
a deployment attempted with production credentials by mistake; a demonstration
in progress during a deployment; certificate renewal; the environment left
running and unattended between demonstrations.

## Acceptance criteria

- `AC-001` — The environment serves the application over TLS at its address, and
  reports the demo environment at boot. *(covers `FR-001`, `FR-002`, `FR-007`)*
- `AC-002` — The environment shares no network, volume, container, database or
  secret with staging or production. *(covers `FR-003`, `FR-005`, `NFR-001`,
  `SEC-001`, `SEC-002`)*
- `AC-003` — The deployment workflow deploys and rolls back the demo target
  using only demo credentials. *(covers `FR-004`, `FR-011`, `SEC-005`,
  `OBS-002`)*
- `AC-004` — No outbound message leaves the environment during a full
  demonstration walkthrough. *(covers `FR-006`, `SEC-004`)*
- `AC-005` — Boot is refused when the declared environment and database name
  disagree. *(covers `SEC-003`, `OBS-003`)*
- `AC-006` — Monitoring shows the environment distinctly and alerts the owning
  team. *(covers `FR-008`, `OBS-001`)*
- `AC-007` — The environment is rebuilt from nothing, and separately
  decommissioned, by following the runbooks. *(covers `FR-009`, `FR-010`,
  `DATA-003`, `NFR-002`)*
- `AC-008` — The environment holds only synthetic data, verified by inspection
  after provisioning. *(covers `DATA-001`, `DATA-002`)*
- `AC-009` — No secret value appears in any log or artefact from a full deploy.
  *(covers `FR-012`, `SEC-007`)*
- `AC-010` — The environment serves the same application version as production
  or a named newer one, over TLS with the expected headers. *(covers `NFR-003`,
  `NFR-004`, `SEC-006`, `SEC-008`)*
- `AC-011` — Given the demo and production deployments, when each is asked what
  it is running, then both answer with a full commit SHA that resolves to a
  commit in this repository, and neither answer is `unknown`.
- `AC-012` — Given those two answers, when parity is computed, then the result is
  exactly one of `IN_SYNC`, `DEMO_AHEAD` or `DEMO_BEHIND`, and when they differ
  the report names which environment is ahead.
- `AC-013` — Given an approved release already built for one environment, when it
  is deployed to the other, then no image is rebuilt and both environments run
  an artefact with the same digest.
- `AC-014` — Given an approved release, when it is deployed to demo through the
  workflow, then no file was copied to the host by hand and the host's checkout
  is at the deployed commit.
- `AC-015` — Given demo and production, when their database identities are
  compared, then they differ, and the demo database name carries the demo
  marker.
- `AC-016` — Given a release that carries a migration, when it is deployed, then
  the migration is applied to the demo database before production's release gate
  is reached, and each database's migration ledger is its own.
- `AC-017` — Given the parity automation, when it runs against a `DEMO_BEHIND`
  state, then it may deploy demo and must not initiate any production
  deployment.
- `AC-018` — Given the demo environment at any release, when it is inspected for
  provenance, then every record is synthetic and no row traces to a production
  tenant.
- `AC-019` — Given a production deployment reporting a 12-character commit
  prefix, when parity is computed, then the prefix resolves against the
  canonical repository to exactly one full SHA before any comparison; zero
  matches or more than one produce `UNKNOWN` and fail the check.
- `AC-020` — Given the permanent demo behind its reverse proxy, when two
  independent clients sign in and one supplies a forged forwarding header, then
  each is rate-limited on its own address and the forged header does not become
  a rate-limit key.
- `AC-021` — Given a destroyed demo database, when the recovery procedure is
  run, then the environment returns to its documented baseline within the stated
  recovery-time objective, with the client login present and both modules
  populated.
- `AC-022` — Given a reset, when the workspaces are enumerated, then every
  workspace the seed creates is present and rebuilt, and none survives from
  before the reset.

## Dependencies

- `SPEC-0007` provides the data and personas this environment exists to show.
  This specification does not depend on it to be provisioned, but the
  environment is not demonstrable without it.
- The existing deployment workflow, secret generation, reverse proxy,
  monitoring and backup tooling, all reused rather than rebuilt.

## Assumptions

- A host with capacity for a fifth environment is available. If not, that is a
  procurement decision, not an engineering one; see `CL-001`.
- The organisation controls a domain under which a demo address can be
  published. See `CL-002`.
- Best-effort availability is acceptable for a sales demonstration environment.

## Open questions

`CL-001` to `CL-004` in `clarifications.md`. `CL-001` and `CL-002` must be
answered before provisioning can begin; neither blocks approval of this
specification.

## Risks

- The highest risk in this work is a misconfiguration that points the demo
  runtime at a customer database. `SEC-002` and `SEC-003` exist for it, and the
  boot cross-check already refuses that combination today.
- Deployment tooling changes touch a path production also uses. The workflow
  change is additive — a new target and new secret names — and must not alter
  the behaviour of the existing targets.
- `EVC-003` is an open conflict recording two different descriptions of the
  deployment mechanism. This specification follows the automated path evidenced
  in the repository, cites the conflict rather than amending it, and its runbook
  must be reconciled with whichever description that entry settles on.
- `EVC-005` is an open, release-blocking conflict about backup capability. This
  specification does not depend on it: a demonstration environment holds nothing
  worth restoring, and `FR-011` deliberately requires rollback without data
  restoration. Named here so the dependency is visibly absent rather than
  assumed away.

## Rollback and reversibility expectations

Fully reversible, and cheaply, because the environment holds nothing of value.
Three levels: redeploy the previous image (`FR-011`); rebuild the environment
from nothing (`FR-009`); destroy it (`FR-010`). The data-restore path exists for
completeness and is expected never to be used — the correct response to data
loss here is a re-seed, and `plan.md` records that as the primary recovery.

## Implementation constraints

- The boot cross-check between declared environment and database name is a
  security control and may not be weakened or bypassed.
- The deployment workflow change must be additive. No existing target's
  behaviour, credentials or approval gate may change.
- No production or staging system may be modified by this work.
- No shared application code may be changed. If the environment cannot be built
  without an application change, work stops and raises a change record.
- An AI agent may not execute any part of this specification. R5 execution is
  human-only.

## Evidence and existing-system references

- `VERIFIED` — `apps/web/src/lib/env.ts` — accepts the demo value for the
  deployment-environment declaration. **Preserves**.
- `VERIFIED` — `apps/web/src/lib/startup-check.ts` — cross-checks the declared
  environment against the database name and refuses a mismatch.
  **Preserves**; `SEC-003` depends on it.
- `VERIFIED` — `apps/web/infra/docker-compose.staging.yml` — a separate Compose
  project with its own name, network, volumes and database. **The model** for
  `FR-003`; not modified.
- `VERIFIED` — `.github/workflows/deploy.yml` — offers staging and production
  only, and reads per-environment deployment secrets by name. **Changes**:
  `FR-004` adds a demo target additively.
- `VERIFIED` — `apps/web/infra/Caddyfile` and `apps/web/infra/Caddyfile.staging`
  — the reverse-proxy and TLS pattern. **The model** for `FR-007`.
- `VERIFIED` — `apps/web/scripts/generate-secrets.mjs` — generates a distinct
  secret set per environment. **Preserves**; `FR-005` uses it.
- `VERIFIED` — `apps/web/infra/prometheus.yml` and
  `apps/web/infra/prometheus-alerts.yml` — the monitoring pattern, already
  parameterised by environment. **The model** for `FR-008`.
- `VERIFIED` — there is no demo Compose file in `apps/web/infra/`. **Changes**:
  `FR-003` adds one.
- `DOCUMENTED` — `docs/ENVIRONMENTS.md` — declares the demo environment, its
  database naming convention and its purpose.
- `DOCUMENTED` — `docs/DEPLOY-STAGING.md` — the runbook this environment's
  runbook is modelled on.
- `UNKNOWN — requires runtime/infrastructure verification` — whether any host,
  domain, certificate or deployment credential exists for a demo environment.
  Nothing in the repository establishes it, and `CL-001` and `CL-002` exist to
  settle it before provisioning.
- `UNKNOWN — requires runtime/infrastructure verification` — the runtime
  behaviour of production and staging. This specification asserts nothing about
  either and modifies neither.

## Revision history

| Date | Change | By | Change record |
|---|---|---|---|
| 2026-09-08 | Created | Agent, PLANNER role | — |
| 2026-09-09 | Functional-parity requirement added: `FR-013` to `FR-020`, `DATA-004`, `DATA-005`, `SEC-009`, `OBS-004`, `OBS-005`, `AC-011` to `AC-018`. Business requirement that demo must not become a stale fork. Lifecycle returned to `PLANNED` because the artefact set is no longer complete; no change record, because `docs/sdd/CHANGE_CONTROL.md` begins change control at the first approval and this specification has none. | Agent, PLANNER role | — |
| 2026-09-09 | `CL-005` resolved to Option C: parity is detected automatically and deployed manually, and `SEC-009` narrowed accordingly — the parity job holds no deployment credential for any environment. Architecture adjusted so the production deploy-path migration is NOT a prerequisite for the demo launch: `AD-011` revised, `FR-014` scoped to demo, `TASK-009` and `TASK-011` re-scoped, and mandatory registry pull recommended as its own specification. `AD-012` revised to expand short SHAs before comparing, because production reports 12 characters and demo reports 40. Added `AD-019` and `provisioning-checklist.md`. | Agent, PLANNER role | — |

## Approval

| Gate | Role | Decision | Date | Scope of what was approved |
|---|---|---|---|---|
| Specification approval | Product Owner and Solution Architect | not recorded | — | — |
| Architecture approval | Solution Architect | not recorded | — | — |
| Security risk acceptance | Application Security | not recorded | — | — |
| Data model and destructive migration | Solution Architect, DevOps, Human Release Authority | not applicable, no migration | — | — |
| Implementation readiness | Solution Architect | not recorded | — | — |
