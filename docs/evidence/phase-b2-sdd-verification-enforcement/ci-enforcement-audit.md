# CI enforcement audit

## Status

**APPLIED.** `.github/workflows/sdd-validate.yml` exists. It is the only file
under `.github/` that Phase B2 created, and no existing workflow was modified.

## How the gate was passed

The specification originally excluded CI (`CL-005`, `AD-008`), because
`.github/workflows/*` is R5 by `docs/RISK_CLASSIFICATION.md` and the
authorisation in force at the time stated it was "NOT infrastructure
approval". The work stopped at that gate and reported it, which was correct.

The requester subsequently instructed in writing that the dedicated
non-production check be added **if safe**, restating the conditions it must
satisfy. That is a new authorisation for this specific bounded change, so the
gate is satisfied for it and for nothing else.

The change was made under change control rather than by editing a converged
specification: `CHG-001`, a `SCOPE CHANGE`, with the specification returning
`CONVERGED → IMPLEMENTING → VERIFYING → CONVERGED`. `SDD-V018` confirms every
transition is legal and `SDD-V019` confirms the status matches the final
history entry.

## Safety conditions, verified individually

| Required | Verified |
|---|---|
| Runs validator tests | `node --test tools/sdd/tests/validator.test.mjs` |
| Runs `validate --all` | `node tools/sdd/cli.mjs validate --all --format text` |
| Fails on ERROR findings | The CLI exits 1 on any ERROR; a non-zero exit fails the step |
| Does not deploy | No deploy step, no action that can deploy, no environment |
| Does not access production or staging | No SSH, no host, no URL, no network egress beyond checkout and Node setup |
| Requires no production secret | No `secrets.*` reference anywhere in the file |
| Connects to no database | No service container, no connection string |
| Runs no migration | No Prisma or SQL invocation |

Additional hardening applied beyond the stated minimum:
`permissions: contents: read` at the workflow level, so the job holds no write
scope of any kind; `persist-credentials: false` on checkout, so the job's git
credential is not left in the runner's git config; a 10-minute timeout; a
concurrency group that cancels superseded runs.

## Why a separate workflow rather than a step in `ci.yml`

`.github/workflows/ci.yml` gates releases. A defect in a process tool must
never be able to block a release. A separate workflow fails on its own, is
reviewable in isolation, and can be disabled without touching the release
path. Step 16 of the Phase B2 brief permits this choice explicitly, and it is
recorded here as the reason.

## What it can and cannot fail

It fails on ERROR findings over SDD artefacts only. Every such artefact was
created by the SDD system, so no pre-SDD application work can fail this job. A
repository state with no specifications at all passes it trivially.

It runs `validate --all`, which performs **no change association**. `SDD-V041`,
the code-without-specification rule, therefore cannot fail this job during the
brownfield transition. Promotion of that rule remains a separate decision
governed by `docs/sdd/ENFORCEMENT_STANDARD.md` §6.

## Observed locally, as the job would run

| Step | Result |
|---|---|
| `node --test tools/sdd/tests/validator.test.mjs` | 54 pass, 0 fail |
| `node tools/sdd/cli.mjs validate --all --format text` | `result=PASS errors=0 warnings=0`, exit 0 |

The job's first real run on a branch has not happened, because Phase B2 does
not commit or push. That the workflow is syntactically accepted by GitHub and
green in CI is `UNKNOWN — requires runtime/infrastructure verification` until
somebody pushes it.

## Residual

Branch protection and required status checks on this repository remain
`UNKNOWN — requires runtime/infrastructure verification` (GAP-CI-01). Until a
human confirms them, this job reports but does not enforce: a maintainer can
merge past a red check.

## Evidence Sources

E1: `.github/workflows/sdd-validate.yml`;
`specs/SPEC-0001-sdd-verification-enforcement/change-record.md`;
`git status` showing no other `.github/` file changed.
E2: `.github/workflows/ci.yml`, `deploy.yml` — unmodified.
E3: local runs of both job steps.
E4: `docs/sdd/CI_ENFORCEMENT.md`, `docs/RISK_CLASSIFICATION.md`,
`docs/sdd/HUMAN_APPROVAL_GATES.md`.
