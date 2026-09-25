# SPEC-0007 — Clarifications

## CL-001

**Status:** OPEN

**Question:** Which isolated local execution environment will contain Claude and repository test/build code while keeping controller state, evidence and production credentials inaccessible?

**Owner:** Solution Architect with Application Security.

**Evidence:** Git worktrees share repository metadata and the launching OS user's access. An argv allowlist does not constrain code invoked by npm scripts. No isolation environment was demonstrated in this session.

**Proposed decision:** Use a human-provisioned disposable local environment with only the task checkout and approved development inputs mounted; keep the controller/evidence outside the writable boundary; block execution when that boundary is unavailable. Provisioning or changing host configuration is outside this task.

**Alternative requiring explicit security acceptance:** A cooperative same-user manual workflow with scope/tamper detection only. It cannot guarantee that Claude cannot modify controller state or access other user-readable files, and must not be documented as enforcing that boundary.

**Impact:** Material security ambiguity; implementation remains blocked. No option has been selected or approved by an AI.

## Interpretations incorporated into the draft

ASTRA VERIFIED_COMPLETE means independently supported engineering verification, not human SDD convergence acceptance or release permission. The backlog does not override specification approval. Existing SDD VER records retain command/exit/test metadata only; proposed sanitized output lives separately under .astra/evidence. A withheld log never counts as sufficient evidence. Application discovery and the first pilot prompt follow framework validation, not this draft.
