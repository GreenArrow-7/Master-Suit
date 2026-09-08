# CI Enforcement

`NORMATIVE — engineering process requirement`, and the record of a gate that
was open and is now closed. Introduced by Phase B2 (`SPEC-0001`, decision
`AD-008`, clarification `CL-005`, change record `CHG-001`).

## Current state

**Applied.** `.github/workflows/sdd-validate.yml` exists, added under change
record `CHG-001` after the requester explicitly authorised it. No other
workflow was modified. The validator also runs locally:

```bash
node tools/sdd/cli.mjs validate --all
node --test tools/sdd/tests/validator.test.mjs
```

`VERIFIED` — `.github/workflows/sdd-validate.yml` is the only file under
`.github/` that Phase B2 created; `ci.yml` and `deploy.yml` are unmodified.

## Why it was gated, and how the gate was passed

`docs/RISK_CLASSIFICATION.md` places `.github/workflows/*` at **R5 —
production-critical / infrastructure**. R5 requires DevOps and Solution
Architect approval and human execution
(`docs/sdd/HUMAN_APPROVAL_GATES.md`, gates 2 and 4).

The authorisation for Phase B2 states it is "NOT infrastructure approval" and
instructs that where the approval model requires a gate the authorisation
cannot satisfy, the work stops at that gate and reports it rather than
inventing approval. That is what happened. Creating the workflow anyway would
have been a process violation committed by the change whose purpose is
preventing process violations.

The requester later authorised this specific bounded change in writing,
subject to named safety conditions. Each condition was verified before the
file was created; see the Phase B2 evidence package. The change was made under
change control rather than by editing a converged specification.

## The applied workflow

Live at `.github/workflows/sdd-validate.yml`. Reproduced here for review.

```yaml
name: SDD validation

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: sdd-validate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Validator tests
        run: node --test tools/sdd/tests/validator.test.mjs

      - name: Validate SDD artefacts
        run: node tools/sdd/cli.mjs validate --all --format text
```

### Why this shape

- **A standalone workflow, not an edit to `ci.yml`.** The existing pipeline
  gates releases. Adding a step to it means a validator defect can block a
  release, which is a release risk created by a process tool. A separate
  workflow fails on its own and is easy to reason about. Step 16 of the B2
  brief permits this choice explicitly.
- **`permissions: contents: read`.** The job reads the repository and nothing
  else.
- **No secrets, no services, no database, no network.** The validator needs
  none. It cannot deploy, cannot reach production, and cannot modify
  artefacts.
- **Node 24**, matching the existing pipeline.
- **No dependency install.** There is nothing to install; the validator uses
  the standard library.
- **`SDD-V041` stays advisory.** The job runs `validate --all`, which does not
  perform change association at all. Promotion of that rule is governed
  separately by `docs/sdd/ENFORCEMENT_STANDARD.md` §6.

### What it blocks

Only ERROR findings over actual SDD artefacts. Since every such artefact is
new by definition, no pre-SDD application work can fail this job. A repository
with no specifications at all passes it.

## Approvals

| Gate | Role | Status |
|---|---|---|
| Architecture approval, R5 change to CI | Solution Architect | APPROVED 2026-09-07 |
| Infrastructure approval, workflow execution | DevOps / Production Engineering | APPROVED 2026-09-07 |

Both recorded on the requester written instruction dated 2026-09-07, which
named the safety conditions and authorised the addition subject to them. An AI
agent prepared the file; it did not grant the approvals.

## Verification before adoption

Already satisfied by Phase B2, so adoption does not need to repeat it:

- Validator tests pass locally.
- Valid fixtures pass; every invalid fixture fails with its expected rule.
- The repository's real SDD artefacts pass.
- A security review of the validator is recorded.

Remaining: the first run on a branch has not happened, because Phase B2 does
not commit or push. Whether GitHub accepts the workflow and the job is green
is `UNKNOWN — requires runtime/infrastructure verification`.

## Authority / References

- `docs/RISK_CLASSIFICATION.md` — `.github/workflows/*` is R5
- `docs/sdd/HUMAN_APPROVAL_GATES.md` — gates 2 and 4
- `docs/sdd/ENFORCEMENT_STANDARD.md` — transition policy
- `docs/operations/DEPLOYMENT.md` — the release pipeline, which this workflow
  deliberately does not touch
- `specs/SPEC-0001-sdd-verification-enforcement/change-record.md` — `CHG-001`
- `specs/SPEC-0001-sdd-verification-enforcement/clarifications.md` — `CL-005`
