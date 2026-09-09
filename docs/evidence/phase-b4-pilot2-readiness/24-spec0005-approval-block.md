# SPEC-0005 — one-page approval block

| Field | Value |
|---|---|
| Specification | `SPEC-0005` — platform-independent capture-vault storage keys |
| Risk | **R4** · Lifecycle `READY_FOR_APPROVAL` · Approvals recorded **0** |
| Package | validates 0 errors / 0 warnings · 8 artefacts · 6 tasks `BLOCKED` · **no code written** |
| Date | 2026-09-08, revised after `EVC-018` |
| Gate 5 role | **Solution Architect** — resolved, `EVC-018` |

**All four roles are now named.** Nothing is pre-filled: `EVC-018` settled
*who* decides gate 5, not *what* they decided. Every line below is still blank.

**Four decisions, one round.** Sign or refuse each line. Nothing here is
pre-filled and no agent may complete any of it.

---

## The defect, in three lines

`captureVault.pathFor()` composes the value persisted to
`HrAttendancePunch.capturePath` with `path.join`, so a Windows-hosted writer
stores `t-x\emp-y\…`. Read on POSIX, `objectKey` cannot address it,
`deleteCapture` deletes nothing and returns normally, the punch row is then
deleted — leaving an encrypted biometric image orphaned and the sweep reporting
success.

**Honest likelihood:** a bad key can only be produced by a Windows-hosted
writer. For a Linux-only deployment history the count is zero and the fix is
preventive. That is `CL-001`, and it is open.

---

## Decision 1 — Gate 1, specification approval

**Role: Product Owner *and* Solution Architect (both).**

> Are these the right requirements, and is the scope right?
> 12 `FR-`, 5 `NFR-`, 5 `SEC-`, 2 `DATA-`, 1 `OBS-`, 6 `AC-`.

Authorizes the specification as correct and complete enough to build against.
**Does not authorize writing code** — that is decision 4.

`APPROVE / REJECT` — Product Owner: ______   Solution Architect: ______

## Decision 2 — Gate 2, architecture approval

**Role: Solution Architect.** Always required at R4.

> Is separating a *logical storage key* from a *physical filesystem path* the
> right approach, and are `AD-001`–`AD-007` sound?

The load-bearing one is `AD-007`: only `pathFor` composes a persisted
identifier and only it changes. The other six `path` uses sit at genuine
filesystem boundaries and are deliberately left alone — a blanket replacement
would break the legacy on-disk walk.

`APPROVE / REJECT` — Solution Architect: ______

## Decision 3 — Gate 3, security risk acceptance

**Role: Application Security.** Mandatory at R4. *"An agent may draft the
analysis; it may not accept the risk."*

> Is the threat model adequate, and is the residual risk acceptable?
> `TH-001`–`TH-015`.

What to weigh:

- `TH-008` cross-tenant biometric exposure — highest severity, least likely.
- `TH-001`/`TH-012` silent deletion failure — most likely; legal impact.
- `TH-003`/`TH-009` **traversal introduced by the fix itself** — the primary
  attack surface, because backward-compatible reading is the one place that
  normalises a database value before use. `AD-004` fixes the order (normalise
  once, then validate); `ST-004` pins it.
- Three existing controls must be byte-identical afterwards: the
  `path.resolve` + containment check at lines 148/191, the ciphertext content
  type, and tenant-first sharding.

`ACCEPT RISK / REJECT` — Application Security: ______

## Decision 4 — Gate 5, implementation readiness

**Role: Solution Architect.** Named by `EVC-018`, governance-owner decision,
2026-09-08. The standard and the risk matrix now both carry the role.

> Separate permission to begin writing code, additional to gate 1.
> Is the specification *technically* ready to implement?

Readiness covers: implementation plan, architecture, task decomposition,
dependencies, migration and data impact, security prerequisites, rollback
approach, verification strategy, operational implications.

It replaces nothing — Product Owner approval, architecture approval, AppSec
approval, code review, convergence acceptance, staging and production approval
all stand alongside it.

`APPROVE / REJECT / REQUEST_CHANGES` — Solution Architect: ______

---

## What approval unlocks — and what it does not

**Unlocks:** implementation in order `TASK-002` → `TASK-001` → `TASK-003` →
`TASK-004` → `TASK-005` → `TASK-006`. `TASK-002` is first despite its number:
backward-compatible reading must exist before composition changes, or a capture
written by the old code and read by the new becomes unreachable — and
undeletable.

**Does not unlock:** two human code reviewers (one security-literate), still
required at R4; convergence acceptance by Application Security plus QA /
Release Engineering; staging; production; any deployed query; any historical
rewrite.

## Verified again immediately before this block

| Claim | Evidence |
|---|---|
| `capturePath` is `String?` | `apps/web/prisma/schema.prisma:2431` |
| No schema change needed | `git status apps/web/prisma` → clean, 66 migrations, none added |
| No migration needed | same |
| No code written for `SPEC-0005` | `git status apps/web/src/services/hr/captureVault.ts` → clean |
| The four failures are real and constant | 3 consecutive full runs, same 4 tests, `23-suite-stability-and-posix-proof.md` |

## Two open clarifications — blocking implementation, not approval

| | Question | Owner |
|---|---|---|
| `CL-001` | Do any deployed rows hold a backslash key? | Application Security, executed by DevOps |
| `CL-002` | If they exist, are they rewritten? | Application Security with DevOps |

The count-only assessment is prepared in
`18-capture-vault-deployed-data-assessment.md` and **has not been executed** —
four integers, no key, no identifier, no biometric metadata.
