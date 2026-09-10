# SPEC-0005 — consolidated R4 approval packet

| Field | Value |
|---|---|
| Specification | `SPEC-0005` — platform-independent capture-vault storage keys |
| Risk | **R4** |
| Lifecycle | `READY_FOR_APPROVAL` |
| Approvals recorded | **0** |
| Tasks | 6, all `BLOCKED` |
| Code written | **none** |
| Date | 2026-09-08 |

**One packet, one review round, four decisions.** Built so the gates can be
taken together rather than in four separate loops.

## Package completeness — verified

| Artefact | Present | Notes |
|---|---|---|
| `spec.md` | yes | 12 `FR-`, 5 `NFR-`, 5 `SEC-`, 2 `DATA-`, 1 `OBS-`, 6 `AC-` |
| `clarifications.md` | yes | `CL-R01`–`CL-R03` resolved; `CL-001`, `CL-002` open |
| `plan.md` | yes | impact by area, `AD-001`–`AD-007`, five alternatives |
| `threat-model.md` | yes | `TH-001`–`TH-015`, trust boundaries, controls that must not weaken |
| `test-plan.md` | yes | 6 `UT-`, 6 `IT-`, 5 `ST-`, 6 `REG-` |
| `tasks.md` | yes | 6 tasks, all `BLOCKED` |
| `traceability.md` | yes | 25 requirements mapped; Code and Result columns empty on purpose |
| `sdd.json` | yes | `R4`, `READY_FOR_APPROVAL`, `approvals: []` |

`node tools/sdd/cli.mjs validate --spec SPEC-0005` → **0 errors, 0 warnings**.

**No schema change. No migration. No deployed-data rewrite.** `capturePath` is
`String?` and stays so — read from the Prisma schema, not assumed.

---

## The four gates

### Gate 1 — Specification approval

| | |
|---|---|
| **Required role** | **Product Owner *and* Solution Architect** — both, per `docs/sdd/HUMAN_APPROVAL_GATES.md` and the R4 column of `docs/sdd/RISK_TO_PROCESS_MATRIX.md` |
| **Decision requested** | Are these the right requirements, and is the scope right? |
| **Authorizes** | that the specification is correct and complete enough to build against |
| **Does NOT authorize** | writing any code — that is gate 5, separately |

### Gate 2 — Architecture approval

| | |
|---|---|
| **Required role** | **Solution Architect** — always required at R4 |
| **Decision requested** | Is separating a *logical storage key* from a *physical filesystem path* the right approach, and are `AD-001`–`AD-007` sound? |
| **Authorizes** | the approach and the patterns |
| **Does NOT authorize** | implementation, or any change to the six correct `path` uses `AD-007` deliberately leaves alone |

### Gate 3 — Security risk acceptance

| | |
|---|---|
| **Required role** | **Application Security** — mandatory at R4. *"An agent may draft the analysis; it may not accept the risk."* |
| **Decision requested** | Is the threat model adequate, and is the residual risk acceptable? |
| **Authorizes** | the threat model and the residual risk |
| **Does NOT authorize** | implementation, deployed-data access, or any historical-data rewrite |

**What Application Security is actually being asked to weigh:**

- `TH-008` cross-tenant biometric exposure — highest severity, least likely.
- `TH-001`/`TH-012` silent deletion failure — most likely, legal rather than
  confidentiality impact.
- `TH-003`/`TH-009` traversal introduced *by the fix itself* — the primary
  attack surface, because backward-compatible reading is the one place that
  takes a database value and normalises it before use. `AD-004` fixes the order
  (normalise once, then validate) and `ST-004` pins it.
- Three existing controls must be identical afterwards: the
  `path.resolve` + containment check at lines 148/191; the ciphertext content
  type; tenant-first sharding.

### Gate 5 — Implementation readiness

| | |
|---|---|
| **Required role** | **NOT NAMED BY THE STANDARD — see below** |
| **Decision requested** | Separate permission to begin writing code, additional to gate 1 |
| **Authorizes** | entry to `APPROVED_FOR_IMPLEMENTATION`, then `IMPLEMENTING` |
| **Does NOT authorize** | staging, production, deployed-data access, or the `CL-002` historical rewrite |

> **A governance gap, flagged rather than filled.**
> `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 5 says it is *"required at R4 and
> R5"* and that it is human, but **names no role** — unlike gates 1, 2, 3, 4
> and 6, which all name theirs. The R4 column of the risk matrix likewise says
> only "required, human".
>
> I am not inferring one. The nearest candidates are the gate-1 holders
> (Product Owner and Solution Architect) or DevOps / Production Engineering,
> and picking between them is exactly the kind of silent decision the
> constitution forbids.
>
> **Suggested resolution:** the gate-1 approvers designate who holds gate 5 for
> this specification when they approve, and the gap is registered as an
> evidence conflict so the standard gets fixed rather than worked around each
> time. This packet does not register that conflict, because a specification
> may cite an `EVC` but may not close one and this is a change to the standard
> itself.

---

## Two open clarifications, both blocking implementation

| | Question | Owner | Effect |
|---|---|---|---|
| `CL-001` | Do any deployed rows hold a backslash key? | Application Security, run by DevOps | decides whether `FR-011` is a safeguard or a repair |
| `CL-002` | If they exist, are they rewritten? | Application Security with DevOps | decides whether a second change exists at all |

**Honest expectation for `CL-001`: zero.** A bad key can only be created by a
Windows-hosted writer; on POSIX `pathFor` already emits `/`. For a
containerised Linux deployment the fix is preventive. That is stated up front
rather than after the fact.

The count-only assessment is prepared in
`18-capture-vault-deployed-data-assessment.md` and **has not been executed** —
four integers, no key, no identifier, no biometric metadata.

---

## What approval unlocks, and what it does not

**Unlocks:** implementation in execution order `TASK-002` → `TASK-001` →
`TASK-003` → `TASK-004` → `TASK-005` → `TASK-006`. `TASK-002` is first despite
its number: compatibility must exist before composition changes, or a capture
written by the old code and read by the new becomes unreachable.

**Does not unlock:** two human code reviewers (one security-literate) still
required at R4; convergence acceptance by Application Security plus QA /
Release Engineering; staging; production; any deployed query; any historical
rewrite.

## What must not happen

- No agent may discharge any of these four gates. None has been.
- No RC-4 test may be weakened, skipped or deleted to reach a green suite. The
  four failures are this specification's own evidence.
- `EVC-016` stays untouched — not renamed, not broadened, not repurposed.
- No deployed database is queried without its own explicit authorization.
