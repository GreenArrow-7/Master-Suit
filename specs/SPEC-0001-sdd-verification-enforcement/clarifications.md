# SPEC-0001 — Clarifications

## Status summary

| ID | Question | Status | Affected requirements |
|---|---|---|---|
| `CL-001` | Where does machine-readable process metadata live | `INCORPORATED` | `FR-002` |
| `CL-002` | Does the validator judge artefact quality | `INCORPORATED` | `FR-003` |
| `CL-003` | Is code-without-spec blocking during B2 | `INCORPORATED` | `FR-007` |
| `CL-004` | Is there a numeric performance threshold | `INCORPORATED` | `NFR-004` |
| `CL-005` | May B2 create a CI workflow | `INCORPORATED` | scope |

No material clarification is `OPEN`.

---

## CL-001

**Question:** Should machine-readable process metadata live in a separate
file, or be parsed out of the Markdown metadata table in `spec.md`?

**Why it matters:** Parsing prose is fragile and makes the validator's
correctness depend on Markdown formatting. A separate file is unambiguous but
risks becoming a second specification that drifts from the first.

**Possible interpretations:**
1. Parse `spec.md` only. No new file.
2. A separate `sdd.json` carrying process metadata only.
3. Both, with one authoritative.

**Recommended interpretation:** 2, with a rule that cross-checks the two so
drift is caught rather than tolerated.

**Decision:** `sdd.json` per specification directory holds process metadata
only — identifier, slug, kind, risk, status, artefact paths, status history,
approvals, reviews. `spec.md` remains authoritative for intended behaviour and
must never be duplicated into it. Rules `SDD-V011`, `SDD-V012` and `SDD-V013`
cross-check identifier, risk and status between the two, so divergence is a
finding rather than a silent inconsistency.

**Decision owner:** Solution Architect

**Status:** `INCORPORATED`

**Affected requirements:** `FR-002`, and `docs/sdd/MACHINE_CONTRACT.md`.

---

## CL-002

**Question:** Does the validator assess whether a threat model, plan or test
plan is *adequate*?

**Why it matters:** If it tries, it becomes an unreliable reviewer and people
will trust it for something it cannot do. If it does not, its guarantees are
narrower and must be stated plainly.

**Decision:** No. The validator checks structure, presence, references and
consistency. It may assert that an R4 specification has a `threat-model.md`
with at least one threat carrying a control and a verification. It may not
assert that the threat model is good. Adequacy is human review work, stated in
`docs/sdd/ENFORCEMENT_STANDARD.md`.

**Decision owner:** Application Security

**Status:** `INCORPORATED`

**Affected requirements:** `FR-003`.

---

## CL-003

**Question:** During B2, does a code change without a linked specification
fail validation?

**Why it matters:** The repository contains substantial pre-SDD application
work and an uncommitted UI redesign. Making that rule blocking immediately
would fail work that predates the system, which the brief forbids.

**Decision:** Advisory during the transition. `SDD-V041` emits a WARNING, not
an ERROR, and the transition policy in
`docs/sdd/ENFORCEMENT_STANDARD.md` records what must be true before it becomes
blocking. Structural rules over actual SDD artefacts are blocking from day
one, because those artefacts are new by definition.

**Decision owner:** Product Owner

**Status:** `INCORPORATED`

**Affected requirements:** `FR-007`.

---

## CL-004

**Question:** Should `NFR-004` state a numeric performance threshold?

**Why it matters:** An invented number becomes a requirement nobody agreed to,
which `docs/sdd/REQUIREMENT_STANDARD.md` explicitly prohibits.

**Decision:** No threshold is set. The observed runtime is measured and
recorded in the evidence package. If it later proves to be a problem, a
threshold is agreed then, with a reference workload, and added under change
control.

**Decision owner:** Solution Architect

**Status:** `INCORPORATED`

**Affected requirements:** `NFR-004`.

---

## CL-005

**Question:** May Phase B2 create the CI workflow that runs the validator?

**Why it matters:** This is the boundary between authorised and unauthorised
work, and getting it wrong would be a process violation by the very change
that exists to prevent process violations.

**Possible interpretations:**
1. Yes — a new standalone workflow is additive and low risk.
2. No — anything under `.github/workflows/` is R5, which requires
   infrastructure approval the authorisation for this work explicitly
   withholds.

**Recommended interpretation:** 2.

**Decision:** No. `docs/RISK_CLASSIFICATION.md` places `.github/workflows/*`
at R5. The authorisation for Phase B2 states it is "NOT infrastructure
approval" and instructs that where the approval model requires a gate the
authorisation cannot satisfy, the work stops at that gate and reports it. The
validator, its tests and its documentation are built; the workflow file is
written out as a ready-to-apply proposal inside
`docs/sdd/CI_ENFORCEMENT.md` and **not** placed under `.github/`. This is
recorded as a Phase B2 blocker awaiting DevOps and Solution Architect
approval, not as a limitation of the tooling.

**Decision owner:** Human Release Authority — deferred; the gate is open and
named rather than assumed.

**Status:** `INCORPORATED`

**Affected requirements:** scope, and `docs/sdd/CI_ENFORCEMENT.md`.

---

## Checklist used

- [x] Actors — engineer, agent, reviewer, future CI
- [x] Permissions — not applicable, the validator reads repository files only
- [x] Tenant boundary — not applicable, no tenant data is involved
- [x] Failure behaviour — exit 2 for tooling failure, distinct from exit 1
- [x] Lifecycle — validated for specifications; the validator holds no state
- [x] Data ownership — not applicable
- [x] Concurrency — not applicable, single process, read-only
- [x] Retry and idempotency — the validator is idempotent by construction
- [x] Deletion and retention — not applicable, writes nothing
- [x] Audit — findings carry rule identifiers; no audit row is written
- [x] External dependency failure — none, no network and no service
- [x] Security boundary — untrusted artefact input, covered by `SEC-001`
      through `SEC-005`
- [x] Backward compatibility — no existing behaviour is touched
- [x] Migration behaviour — pre-SDD work is not retroactively invalidated
      (`CL-003`)
- [x] Performance expectations — measured, not asserted (`CL-004`)
- [x] Operational implications — CI integration deferred (`CL-005`)
