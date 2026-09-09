# SPEC-0008 — Threat model

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Last updated | 2026-09-08 |

Mandatory at R5, and requiring an Application Security acceptance that has not
been given. The subject is a deployed environment: the threats are
misconfiguration and blast radius, not application logic.

## Assets

| Asset | Why it matters here |
|---|---|
| Production customer data | The thing a misconfigured demo runtime could reach |
| Staging | Gates production releases; must not share a failure domain |
| Production and staging secrets | Must never be present in this environment |
| Deployment credentials | A demo credential that reaches production is the worst outcome here |
| The demo environment's availability | A dead environment kills a client meeting, which is a business risk rather than a security one |

## Actors

DevOps engineers provisioning and deploying. A demonstrator. A prospect on the
public internet, untrusted. An opportunistic internet scanner. An engineer six
months from now adding a fourth environment by copying this one.

## Trust boundaries

The internet to the reverse proxy; the proxy to the application; the application
to its own database and cache. The critical boundary is the one that must
**not** exist: between this environment and production or staging.

## Threats and controls

- `TH-001` — The demo runtime is pointed at the production or staging database
  by a mistyped connection string.
  Controls: `CTRL-001`, `CTRL-002`. Verified by `ST-001`, `ST-002`.

- `TH-002` — A production or staging secret is copied into the demo
  environment, so a compromise of a public demonstration host yields a
  production credential.
  Controls: `CTRL-003`. Verified by `ST-003`.

- `TH-003` — The demo deployment credential is granted access to another
  environment, or the workflow change alters an existing target's behaviour.
  Controls: `CTRL-004`, `CTRL-005`. Verified by `ST-004`, `REG-001`.

- `TH-004` — The demo environment shares a host, network or volume with staging
  or production, so a compromise or a resource exhaustion crosses over.
  Controls: `CTRL-002`. Verified by `ST-005`.

- `TH-005` — A demonstration sends a real email, message or webhook to a real
  recipient.
  Controls: `CTRL-006`, `CTRL-007`. Verified by `ST-006`, `E2E-001`.

- `TH-006` — Production data is copied into the demo environment to make a
  demonstration more convincing.
  Controls: `CTRL-008`. Verified by `ST-007`. This is a process control as much
  as a technical one, and it is named because it is the plausible shortcut.

- `TH-007` — The public demonstration host is compromised and used as a foothold
  into the organisation's network.
  Controls: `CTRL-002`, `CTRL-009`. Verified by `ST-005`.

- `TH-008` — A secret value is printed into a workflow log, a deployment log or
  an evidence artefact.
  Controls: `CTRL-010`. Verified by `ST-008`.

- `TH-009` — The environment is exposed without TLS, or with weaker headers than
  the other environments.
  Controls: `CTRL-011`. Verified by `ST-009`.

- `TH-010` — A demo backup is restored into another environment, injecting
  synthetic records into real data.
  Controls: `CTRL-012`. No backup is taken, so there is no artefact to restore.
  Verified by `ST-010`.

- `TH-011` — The environment is left running unattended and drifts to an old,
  unpatched image.
  Controls: `CTRL-013`. Verified by `ST-011`.

- `TH-012` — A demonstration credential is guessed or reused from a public
  source.
  Controls: `CTRL-014`. The blast radius is synthetic data in a disposable
  environment. Verified in `SPEC-0007` rather than duplicated here.

- `TH-013` — An operator mistakes the demo environment for production while
  troubleshooting and acts on it, or the reverse.
  Controls: `CTRL-015`. Verified by `ST-012`.

### Functional parity (added 2026-09-09)

Parity introduces a *new class* of threat, which is worth naming plainly: until
now nothing automatically moved anything between environments. These threats all
descend from that one change.

- `TH-014` — Parity automation is extended, by edit or by mistake, to deploy to
  production, turning a synchronisation job into an ungated production release.
  Controls: `CTRL-016`, `CTRL-017`. Verified by `ST-013`, `UT-005`.

- `TH-015` — Parity is pursued by copying production data into demo, because
  "make demo match production" is read as data rather than code. This is the
  single most likely misreading of the requirement.
  Controls: `CTRL-018`, `CTRL-019`. Verified by `ST-014`, `ST-016`.

- `TH-016` — Schema parity is obtained by pointing demo at the production
  database, which is the cheapest way to make two environments agree and the
  worst.
  Controls: `CTRL-001`, `CTRL-018`. Verified by `ST-015`.

- `TH-017` — A registry credential placed on the demo host is reused to pull, or
  push, artefacts for another environment. Introduced by `AD-011`, which is the
  cost of same-artefact parity.
  Controls: `CTRL-020`. Verified by `ST-013`.

- `TH-018` — The `METRICS_TOKEN` needed to read a deployment's commit is reused
  as a general access credential, or a parity reporter that holds both
  environments' tokens becomes a single point from which both can be read.
  Controls: `CTRL-021`. Verified by `ST-013`.

- `TH-019` — Parity status is reported from what a deploy log claimed rather
  than from what is running, so a failed or partial deployment reports
  `IN_SYNC`.
  Controls: `CTRL-022`. Verified by `OPS-010`, `OPS-011`.

- `TH-020` — A demo-only branch is added to shared application code to make a
  feature demonstrable, putting demo behaviour into production's binary and
  making the two no longer the same product.
  Controls: `CTRL-023`. Verified by `ST-017`.

- `TH-021` — Demo is allowed to satisfy the migration-rehearsal gate in place of
  staging. Demo holds synthetic data at demonstration volume; staging holds a
  restored production snapshot. A migration that passes demo can still lock a
  production-sized table.
  Controls: `CTRL-024`. Verified by `OPS-014`.

## Controls

- `CTRL-001` — The boot cross-check between the declared environment and the
  database name, which refuses to start on a mismatch. Existing, preserved,
  unweakened. `apps/web/src/lib/startup-check.ts`.

- `CTRL-002` — Physical and network separation: a separate Compose project with
  its own name, network, volumes and containers, on a host that is not the
  production or staging host, with no network route to either.

- `CTRL-003` — A distinct secret set generated for this environment by the
  existing generator, with no value copied from another environment.
  `apps/web/scripts/generate-secrets.mjs`.

- `CTRL-004` — Deployment credentials scoped to this environment, stored under
  the workflow's existing per-environment naming scheme, granting nothing
  elsewhere.

- `CTRL-005` — The workflow change is additive. Existing targets keep their
  behaviour, credentials and approval gates, and a regression case asserts it.

- `CTRL-006` — Inert providers selected by environment configuration: mock mail,
  mock messaging, mock antivirus. No shared application code is changed.

- `CTRL-007` — No third-party provider credential is issued to this environment,
  so even a misconfigured provider selection has nothing to authenticate with.

- `CTRL-008` — A standing prohibition on copying, extracting or anonymising
  production data into this environment, stated in the specification, the
  runbook and the environment documentation.

- `CTRL-009` — The host holds no privileged network position: no access to
  internal services, no shared credential, no management-plane role.

- `CTRL-010` — Secrets are passed by reference through the workflow's existing
  masked-secret mechanism, and never echoed. Evidence artefacts record command
  names and exit codes, never captured output.

- `CTRL-011` — TLS termination at the reverse proxy with the same header set the
  other environments serve, following the existing proxy configuration pattern.

- `CTRL-012` — No scheduled backup for this environment, and a prohibition on
  restoring any demo artefact elsewhere. `CL-004`.

- `CTRL-013` — The environment runs the production image or a named newer one,
  re-deployed as part of the normal release rhythm rather than pinned and
  forgotten.

- `CTRL-014` — Existing authentication protections, unchanged, applying to
  demonstration logins exactly as to any account.

- `CTRL-015` — Environment labelling: a distinct address, a distinct monitoring
  label, and a boot line naming the environment, so an operator can tell which
  system they are looking at.

- `CTRL-016` — The synchronisation job is granted demo credentials only. The
  production deploy path is absent from it, so extending it to production
  requires granting a secret rather than editing a condition — a change that is
  visible in repository settings rather than in a diff nobody re-reads.

- `CTRL-017` — `SEC-009` is asserted against the parsed workflow, so adding a
  production target to the parity automation fails a test.

- `CTRL-018` — Parity automation moves an image digest and a commit SHA. It has
  no database credential for any environment, so there is no path by which it
  could copy a row even if instructed to.

- `CTRL-019` — The demo dataset is generated, and every tenant in the demo
  database must be one the seed creates. A tenant the seed does not name is a
  finding, which catches a hand-copied record that no structural control would.

- `CTRL-020` — The registry credential on a deployment host is read-only and
  scoped to pull. Publishing remains the CI job's, which is the only place an
  artefact should be created.

- `CTRL-021` — Metrics tokens are per-environment and read-only, and are not
  reused as deployment credentials. The parity reporter runs in CI, where both
  are already available to the release pipeline, rather than on either host.

- `CTRL-022` — Parity is computed from `masterapp_build_info`, which is the
  running container describing itself, cross-checked against
  `apps/web/scripts/release.sh`'s recorded tag. Disagreement is reported, never
  resolved by preferring one source.

- `CTRL-023` — Environment differences are configuration only. No `APP_ENV`
  branch exists in the shared request path, and the boot cross-check already
  makes the environment declaration meaningful rather than decorative.

- `CTRL-024` — The migration-ordering gate keeps staging as the data-shaped
  rehearsal. Demo is added as a functional rehearsal and is explicitly not
  accepted in staging's place.

## Residual risk

1. A public demonstration address is an internet-reachable deployment of the
   product. It holds no real data, but it is a live target, and `TH-007` is
   reduced rather than eliminated. `CL-002` offers restricting the address as
   the mitigation, and recommends it as the reversible choice.
2. `TH-006`, copying production data in, is ultimately a process control. No
   technical measure in this specification prevents an operator with production
   access from doing it deliberately.
3. `TH-011`, drift, depends on the environment being included in the normal
   release rhythm. An environment nobody deploys to is an environment nobody
   patches.
4. `EVC-003` records two conflicting descriptions of the deployment mechanism.
   Until it settles, this specification's runbook follows the automated path
   evidenced in the repository, and may need reconciling afterwards.
