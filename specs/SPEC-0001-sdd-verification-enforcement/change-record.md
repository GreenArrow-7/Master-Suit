# SPEC-0001 — Change record

| Field | Value |
|---|---|
| Specification | `SPEC-0001` |
| Current risk | `R3`, with the R5 element covered by `CHG-001` below |

## Log

| ID | Change type | Summary | Risk change | Approval status | Date |
|---|---|---|---|---|---|
| `CHG-001` | `SCOPE CHANGE` | Bring CI enforcement into scope and apply the workflow | R3 → R3 for the specification; the workflow itself is an R5 element | APPROVED | 2026-09-07 |

---

## CHG-001

**Change:** Move CI enforcement from out of scope to in scope, and create
`.github/workflows/sdd-validate.yml`.

**Reason:** The specification originally excluded CI because
`.github/workflows/*` is R5 by `docs/RISK_CLASSIFICATION.md` and the
authorisation in force at the time explicitly stated it was "NOT
infrastructure approval" (`CL-005`, `AD-008`). The requester has since
instructed, in writing, that the dedicated non-production SDD validation check
be added **if safe**, and has restated the safety conditions it must meet. That
is a new authorisation for this specific, bounded change, so the gate that
previously blocked the work is now satisfied for it.

**Requested by:** Product Owner.

**Change type:** `SCOPE CHANGE`. It moves a scope boundary rather than altering
any requirement. No `FR-`, `NFR-`, `SEC-`, `DATA-`, `OBS-` or `AC-` statement
changes meaning, and none is added or withdrawn.

**Affected requirements:** none change. `FR-003` and `FR-005` are the
requirements the CI job exercises; both are unmodified.

**Affected plan:** `AD-008` recorded the decision to prepare rather than apply
the workflow. It is superseded by this record. `TASK-012` produced the
proposal; a new task is not raised because the artefact it prepared is applied
verbatim.

**Affected tests:** none change. The CI job runs the existing suite and the
existing `validate --all`; it adds no test and alters no expectation.

**Security impact:** The workflow is read-only. `permissions: contents: read`,
`persist-credentials: false` on checkout, no secret reference, no environment,
no service container, no network egress beyond the checkout and Node setup
actions, no deploy step. It cannot reach production or staging, cannot connect
to a database and cannot run a migration. It is a separate workflow, so it
cannot alter the behaviour of `.github/workflows/ci.yml` or
`.github/workflows/deploy.yml`.

**Migration impact:** none.

**Compatibility impact:** none. Existing workflows are untouched. A repository
state with no specifications passes the job trivially, so no pre-SDD work can
fail it.

**Risk change:** The specification stays R3. The workflow file itself is an R5
artefact by path, and is treated as such: it required the explicit
authorisation recorded above and is applied as a single reviewable file with
no accompanying change to any other pipeline.

**Approval required:** Architecture approval (Solution Architect) and
infrastructure approval (DevOps / Production Engineering), per
`docs/sdd/HUMAN_APPROVAL_GATES.md` gates 2 and 4.

**Approval status:** `APPROVED` — recorded on the written instruction of the
requester, dated 2026-09-07, which named the safety conditions the workflow
must satisfy and authorised its addition subject to them. Each condition was
verified before the file was created; see
`docs/evidence/phase-b2-sdd-verification-enforcement/ci-enforcement-audit.md`.

**Date:** 2026-09-07

**Lifecycle consequence:** the specification returned from `CONVERGED` to
`IMPLEMENTING` to carry out this change, then to `VERIFYING` and back to
`CONVERGED`. The history is recorded in `sdd.json`, and `SDD-V018` confirms
every transition is legal. A converged specification is not edited in place.
