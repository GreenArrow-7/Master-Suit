# SPEC-0008 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0008` |
| Risk | `R5` |
| Last updated | 2026-09-08 |

The subject is a deployed environment, so most evidence is a rehearsal and an
inspection rather than a suite. That is stated plainly rather than disguised by
inventing automated cases that cannot exist. Each case names the requirements it
verifies. Every case is executed by a human; R5 execution is human-only.

## Unit and regression — the workflow change

The only automatable part of this specification.

- `UT-001` verifies `FR-004` — The deployment workflow parses with a demo target
  present, and the target resolves its credentials under the existing
  per-environment naming scheme.
- `REG-001` verifies `SEC-005`, `FR-004` — The staging and production targets
  are byte-for-byte unchanged in behaviour: same inputs, same credential names,
  same approval gate. Asserted by diffing the rendered workflow for those two
  targets before and after.

## Functional parity

Added 2026-09-09 with `FR-013` to `FR-020`. Most of these are assertions about
deployment state rather than about code, so they are written to be answerable
from the two deployments themselves — a parity check that trusts a deploy log
proves the log, not the parity.

- `UT-002` verifies `FR-016` — The parity function maps two commit SHAs to
  exactly one status. Equal is `IN_SYNC`; demo an ancestor of production is
  `DEMO_BEHIND`; production an ancestor of demo is `DEMO_AHEAD`; neither an
  ancestor of the other is `DIVERGED`. A pure function, so this is a real unit
  test rather than a rehearsal step.
- `UT-003` verifies `FR-016`, `AD-012` — A full SHA and its own 12-character
  prefix are recognised as the same commit and never reported as a mismatch.
  Written because the two existing mechanisms genuinely disagree on tag width,
  and a string comparison would report permanent drift.
- `UT-004` verifies `FR-013` — The repository contains exactly one application
  source tree: no demo-suffixed duplicate of `apps/web/src`, and no
  demo-specific Dockerfile or application entrypoint.
- `UT-005` verifies `FR-017`, `SEC-009` — The deployment workflow exposes a demo
  target, and the parity automation's reachable deploy targets are demo only.
  Asserted against the parsed workflow, so adding a production target to that
  automation fails the test.
- `UT-006` verifies `FR-019` — The demo seed is part of the application source
  and reads no production connection string: it takes its database from the
  environment and carries the four refusal gates it already has.
- `REG-002` verifies `FR-014`, `SEC-005` — Deploying an already-built tag does
  not rebuild it. Asserted by capturing the image digest before and after a
  deploy of the same tag and requiring them equal.

## Parity rehearsal

Executed against real deployments, so these belong with the staging rehearsal
rather than with the unit cases.

- `OPS-010` verifies `FR-015`, `OBS-004` — Each environment is asked what it is
  running and answers with a full commit SHA that resolves in this repository.
  Neither answers `unknown`. Read from `masterapp_build_info`, which is the
  container describing itself.
- `OPS-011` verifies `FR-015`, `AD-013` — The commit reported by the deployment
  and the commit recorded in `apps/web/scripts/release.sh`'s state file agree.
  A disagreement is reported as a finding rather than resolved by preferring
  one, because the two disagreeing means something deployed outside the
  pipeline.
- `OPS-012` verifies `FR-014`, `AC-013` — The artefact digests running in demo
  and in production are identical when parity is `IN_SYNC`. Same commit is not
  the claim; same bytes is.
- `OPS-013` verifies `FR-017`, `AC-014` — A release reaches demo through the
  workflow with no manual file copying, and the host checkout afterwards is at
  the deployed commit.
- `OPS-014` verifies `FR-018`, `AC-016` — A release carrying a migration applies
  it to the demo database before production's release gate, and each database's
  migration ledger contains only its own history.
- `OPS-015` verifies `OBS-005` — An intentional mismatch is recorded with a
  reason, a version difference, an owner and an expected resolution, and a
  `DEMO_BEHIND` state older than the drift target is reported rather than
  ignored.

- `UT-007` verifies `FR-016`, `AC-019` — Short-to-full resolution is exact.
  A prefix matching one commit resolves and compares; a prefix matching none
  yields `UNKNOWN` with a reason; a prefix matching more than one yields
  `UNKNOWN`/ambiguous and fails. Driven through
  `git rev-parse --disambiguate`, whose match-count semantics were verified
  against this repository on 2026-09-09.
- `UT-008` verifies `FR-016` — A 12-character value is never compared against a
  40-character one. Asserted by construction: the comparison rejects any input
  that is not a 40-character hex string, so a code path that skipped expansion
  fails rather than quietly under-comparing.
- `OPS-016` verifies `FR-021`, `AC-020` — Behind the real reverse proxy, two
  independent clients are throttled on their own addresses; a client supplying a
  forged `x-forwarded-for` does not obtain a different rate-limit key, and the
  per-account limit applies regardless. Run against the provisioned environment,
  because the property depends on the deployed proxy rather than on the code.
- `OPS-017` verifies `FR-021` — `TRUSTED_PROXY_CIDRS` names the demo project's
  own proxy network and nothing wider. A value of `0.0.0.0/0`, or an empty
  value, fails.
- `OPS-018` verifies `FR-022`, `AC-021` — The recovery procedure is executed
  end to end from an empty database and completes within the recovery-time
  objective, ending with the client login present and both modules populated.
  Timed, and the observed duration recorded.
- `OPS-019` verifies `FR-023`, `AC-022` — After a reset, every workspace the
  seed creates is present and rebuilt, and none survives from before. Written
  because `SPEC-0007`/`CONV-011` records that today's reset drops only the
  primary tenant.
- `ST-018` verifies `FR-023` — After reset and after recovery, the client login
  authenticates, reaches Sales and HRMS, holds a tenant-scoped role and is
  refused platform administration.

## Parity security

- `ST-013` verifies `SEC-009` — The parity automation holds no production
  deployment credential and no production deploy path: given a `DEMO_BEHIND`
  state it acts on demo and, asked to touch production, has no means to.
- `ST-014` verifies `DATA-004` — No path exists from production data to demo.
  Asserted structurally: the parity automation reads a commit SHA and an image
  digest and nothing else, and neither the demo compose project nor the demo
  seed references a production connection string or backup artefact.
- `ST-015` verifies `DATA-005`, `AC-015` — The demo and production database
  identities differ, and the demo name carries the marker
  `apps/web/src/lib/startup-check.ts` requires.
- `ST-016` verifies `DATA-004`, `AC-018` — Every tenant in the demo database is
  one the demo seed creates. Any tenant the seed does not name is a finding.
- `ST-017` verifies `FR-020` — New demonstration capability is reachable through
  role and entitlement only. The client login's effective permissions come from
  the authorization model, and no demo-only branch exists in the shared request
  path.

## Staging rehearsal

Required at R5. The rehearsal is performed against a throwaway environment
provisioned from the same files, **not** against staging itself, because
provisioning is the thing under test and staging gates production releases.

- `IT-001` verifies `FR-001`, `FR-002`, `FR-009` — Provision the environment
  from nothing following the runbook. It boots, reports the demo environment,
  and serves the application. Record the elapsed time for `CL-003`.
- `IT-002` verifies `SEC-003`, `OBS-003` — Start the runtime with the declared
  environment and the database name deliberately mismatched. It refuses to
  start and names the cross-check that refused, printing no connection string.
- `IT-003` verifies `FR-003`, `NFR-001` — Inspect the running project: its
  name, network, volumes and containers are distinct from staging's and
  production's, and it shares no host.
- `IT-004` verifies `FR-011`, `OBS-002` — Deploy an image, deploy a second,
  roll back to the first. The rollback succeeds without any data restoration,
  and the deployment record shows what was deployed, by whom and when.
- `IT-005` verifies `FR-009`, `FR-010`, `DATA-003`, `NFR-002` — Rebuild the
  environment from nothing, then decommission it: runtime, data and secrets are
  gone, and the runbook required no manual database editing.
- `IT-006` verifies `FR-008`, `OBS-001` — Monitoring shows the environment's
  liveness, error rate and queue depth under a label that distinguishes it, and
  an induced failure alerts the owning team.
- `IT-007` verifies `FR-007`, `NFR-003`, `NFR-004` — The environment is
  reachable over its address, serving the same application version production
  serves or a named newer one.

## Security

Each case is an inspection or an induced failure, performed by a human and
witnessed.

- `ST-001` verifies `SEC-002` — From the demo runtime, attempt to reach the
  production and staging databases, caches and object stores by hostname and by
  address. Every attempt fails at the network layer.
- `ST-002` verifies `SEC-002`, `SEC-003` — Attempt to start the demo runtime
  with a production connection string. It refuses, and the refusal is the boot
  cross-check rather than a credential failure, so the control is demonstrated
  rather than incidentally avoided.
- `ST-003` verifies `SEC-001`, `FR-005` — Inventory every secret present in the
  environment. No value matches any production or staging secret, and no
  production or staging connection string, backup or data extract is present.
- `ST-004` verifies `SEC-005` — The demo deployment credential is used against
  the staging and production targets and is refused by both.
- `ST-005` verifies `SEC-008`, `SEC-002` — From the demo host, attempt to reach
  the organisation's internal services. The host holds no privileged network
  position and every attempt fails.
- `ST-006` verifies `SEC-004`, `FR-006` — With the inert providers selected,
  trigger every outbound path a demonstration can reach — the follow-up email,
  the invitation, the notification worker — and confirm at the host's egress
  that nothing left. Confirm no third-party provider credential is present.
- `ST-007` verifies `DATA-001`, `DATA-002` — Inspect the provisioned database.
  Every record is synthetic and traceable to the seed; no record derives from
  production.
- `ST-008` verifies `SEC-007`, `FR-012` — Review the full workflow log,
  deployment log and application log of a complete deploy. No secret value
  appears, in whole or in part.
- `ST-009` verifies `SEC-006` — The address serves over TLS with a valid
  certificate, redirects plaintext, and returns the same security headers the
  other environments return.
- `ST-010` verifies `DATA-002` — No scheduled backup exists for this
  environment, and no demo artefact is present in any other environment's
  backup store.
- `ST-011` verifies `NFR-003` — The deployed image identifier matches the
  production image or a named newer one, checked at the running container.
- `ST-012` verifies `OBS-001` — An operator looking at the monitoring stack and
  at the running host can tell within one screen that this is the demo
  environment.

## End to end

- `E2E-001` verifies `FR-001`, `FR-006`, `SEC-004` — Run the full client
  walkthrough from `SPEC-0007` against the provisioned environment, over its
  public address, in a browser. It completes, and the egress check in `ST-006`
  shows nothing left the host during it.

## Production-readiness verification

Required at R5, performed before the environment is used with a client, and
recorded as evidence.

1. Every case above has passed and is witnessed.
2. `CL-001`, `CL-002` and `CL-003` are answered and recorded.
3. The runbook has been followed end to end by someone who did not write it.
4. The decommissioning procedure has been executed at least once, on the
   rehearsal environment.
5. Rollback has been executed at least once.
6. The owning team is named, and knows it owns this.
7. `SPEC-0007` is converged, so there is something to demonstrate.

## Gates that must stay green

`node tools/sdd/cli.mjs validate --all`, and the repository's existing
`verify` pipeline for the workflow change. No application test is affected by
this specification, and if one is, that is evidence the change was not additive
and work stops.

## What is not tested, and why

- Production and staging behaviour: out of scope and untouched. Cases `ST-001`,
  `ST-002` and `ST-004` deliberately test *from* the demo side, so that no
  action in this plan runs against a customer-bearing system.
- Availability under load: `NFR-004` carries no commitment, so there is nothing
  to verify.
- Data restore: there is no restore path by design. `CL-004`.
