# SPEC-NNNN — Clarifications

> Copy to `specs/SPEC-NNNN-short-slug/clarifications.md`.
> Rules: `docs/sdd/CLARIFICATION_STANDARD.md`.
> An answered clarification must be **incorporated** into the specification or
> **formally linked** from the requirement it affects. A decision that lives
> only in conversation did not happen.

## Status summary

| ID | Question | Status | Affected requirements |
|---|---|---|---|
| `CL-001` | | `OPEN` | |

Statuses: `OPEN`, `ANSWERED`, `INCORPORATED`, `DEFERRED`, `NOT APPLICABLE`.
A material `OPEN` entry blocks `READY_FOR_PLAN`, and blocks approval at R4/R5.

---

## CL-001

**Question:**

**Why it matters:**
What differs between the readings — behaviour, data handling, permissions,
failure mode, blast radius. If nothing material differs, this is not a
clarification.

**Possible interpretations:**
1.
2.

**Recommended interpretation:**
The author's or agent's analysis. Carries no authority.

**Decision:**
The answer. Authoritative once the owner is recorded.

**Decision owner:**
Functional role: Product Owner, Solution Architect, Application Security,
QA / Release Engineering, DevOps / Production Engineering.

**Status:** `OPEN`

**Affected requirements:**
Identifiers this decision changes or creates, once incorporated.

---

## Checklist used

> Tick what was considered, so a reviewer can see what was *not* asked.
> Full list and rationale: `docs/sdd/CLARIFICATION_STANDARD.md`.

- [ ] Actors — who performs this, and who else can
- [ ] Permissions — module, action, scope
- [ ] Tenant boundary — whose data, and cross-tenant references
- [ ] Failure behaviour
- [ ] Lifecycle — create, update, soft delete, hard delete, restore, suspend
- [ ] Data ownership — and what happens when the owner leaves
- [ ] Concurrency
- [ ] Retry and idempotency
- [ ] Deletion and retention
- [ ] Audit — what is recorded, with which values
- [ ] External dependency failure
- [ ] Security boundary — authenticated but unauthorised; anonymous
- [ ] Backward compatibility — API consumers, rows, sessions, queued jobs
- [ ] Migration behaviour for pre-existing data
- [ ] Performance expectations
- [ ] Operational implications — env vars, queues, alerts, runbooks
