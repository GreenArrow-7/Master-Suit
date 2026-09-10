# SPEC-NNNN — Tasks

> Copy to `specs/SPEC-NNNN-short-slug/tasks.md`.
> A task is a bounded unit of work small enough to review in one sitting.
> Tasks may not introduce requirements and may not expand scope
> (`docs/sdd/ARTIFACT_AUTHORITY.md`).

| Field | Value |
|---|---|
| Specification | `SPEC-NNNN` |
| Risk | `R?` |
| Date | YYYY-MM-DD |

## Task list

| ID | Purpose | Requirements | Status |
|---|---|---|---|
| `TASK-001` | | `FR-001` | `TODO` |

Statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`, `WITHDRAWN`.

---

## TASK-001

**Purpose:** one sentence.

**Requirements:** `FR-001`, `SEC-002` — or the approved technical decision
`AD-00x` this serves.

> A task citing neither a requirement nor an approved technical rationale is
> treated as scope expansion and is rejected in review.

**Dependencies:** other tasks that must complete first.

**Allowed scope:** what this task may touch, stated as a boundary rather than
an aspiration. Anything outside it is a different task or a change record.
Refactors, renames, formatting sweeps and dependency changes are outside the
scope of every task unless a task exists specifically for them.

**Expected files and components:** the paths this is expected to touch.
Divergence at review time is a signal worth explaining, not hiding.

**Required tests:** `UT-001`, `ST-002`.

**Security implications:** none, or what changes about authentication,
authorization, tenant scope, secrets, audit or data exposure.

**Data and migration implications:** none, or the model change, migration type
and backfill.

**Definition of Done:**
- the requirements named above are satisfied and nothing else changed
- the required tests exist and pass
- traceability updated
- documentation updated where this task made something untrue
- the applicable items of `AGENTS.md` §8 hold

**Status:** `TODO`

---

## Scope discipline

Three failure modes this template exists to prevent:

1. **The task that grew.** Work that turned out to need more than its allowed
   scope stops and raises a change record. It does not quietly widen.
2. **The task nobody asked for.** A task with no requirement behind it is
   either a missing requirement, in which case add it properly, or scope
   creep, in which case drop it.
3. **The tidy-up rider.** Fixing something unrelated while nearby is how a
   small reviewable change becomes an unreviewable one. Note it, and raise it
   separately.
