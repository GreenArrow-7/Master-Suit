# 02 — CI readiness audit

**Phase:** B4.0 · **Date:** 2026-09-08

Two questions are kept apart throughout: what the repository proves, and what
only a GitHub run could prove.

## Repository-local: VERIFIED

`.github/workflows/sdd-validate.yml` inspected against executable content,
with comment prose excluded from every scan.

| Property | State | Evidence |
|---|---|---|
| B2 validator tests run | **VERIFIED** | step `node --test tools/sdd/tests/validator.test.mjs` |
| B3 agent tests run | **VERIFIED** | step `node --test tools/sdd/tests/agent.test.mjs`, added by `TASK-013` under `D6` |
| `validate --all` runs | **VERIFIED** | step `node tools/sdd/cli.mjs validate --all --format text` |
| Cannot deploy | **VERIFIED** | no deploy, publish or release action; only `actions/checkout` and `actions/setup-node` |
| Runs no migration | **VERIFIED** | no migration command in any `run:` step |
| No production access | **VERIFIED** | no `environment:` block, no deployment target |
| Needs no production secret | **VERIFIED** | no `secrets.` reference in executable content |
| Minimal checkout permissions | **VERIFIED** | `permissions: contents: read` |
| Credentials not persisted | **VERIFIED** | `persist-credentials: false` |
| Deterministic | **VERIFIED** | pinned `node-version: '24'`; no dependency install step; the validator itself has no clock, randomness or network |
| Failure propagates | **VERIFIED** locally | each command exits non-zero on failure, which fails the step. See the limitation below |
| `SDD-V041` not promoted | **VERIFIED** | no `--strict`; `validate --all` performs no change association |

## The three things the repository cannot prove

**GITHUB-HOSTED SDD CI: `UNKNOWN — requires runtime/infrastructure verification`**

The workflow file is untracked and has never been pushed. It has never
executed on a GitHub runner. Whether it passes on Linux — where line endings,
path separators and file modes differ from this Windows workstation — is not
known. Three unit specs elsewhere in the repository are known to fail on
Windows for exactly those reasons (`EVC-014`), which is a reason to expect a
difference, not to assume one.

**BRANCH PROTECTION: `UNKNOWN — requires runtime/infrastructure verification`**

**REQUIRED STATUS CHECK: `UNKNOWN — requires runtime/infrastructure verification`**

Also unknown by the same argument: merge restrictions and review requirements.

These are GitHub repository settings. They live in GitHub's configuration, not
in the working tree, and **cannot be inferred from YAML**. A workflow file
declares what would run; it says nothing about whether a run is required to
merge. The `gh` CLI is unauthenticated in this environment, so no API check was
attempted and none was guessed at.

## Failure propagation, stated precisely

Each command was executed locally and returns a non-zero exit code on failure —
that much is verified. That a non-zero step actually fails the *job*, and that
a failed job actually blocks a *merge*, are runtime and settings facts
respectively. The first is near-certain from GitHub's documented behaviour; the
second is exactly what branch protection governs and is unknown.

## Carried forward from B2 and B3, unchanged

`CONV-005` was remediated under `D6`: the agent suite now runs in the workflow.
That remediation was recorded as **repository-locally VERIFIED** and its
GitHub-hosted result as **UNKNOWN**. Nothing since has changed either.

## Not attempted

No push was made to prove the workflow runs. B4.0 explicitly forbids it, and
pushing to test CI would also be the first push of this branch — a materially
larger action than a readiness audit warrants.
