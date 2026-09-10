# CONV-012 and CONV-014 — disposition packets

**Date:** 2026-09-08 · **Prepared by:** AI · **Status: both PENDING**

Two independent decisions. Neither is recorded here, and neither may be
recorded by an agent. Each is separately actionable.

## How the required role was derived

Not invented. `docs/sdd/HUMAN_APPROVAL_GATES.md` gate 9 routes an accepted
residual risk by its **type**:

> Security residual risk: Application Security. Functional or scope
> limitation: Product Owner. Operational limitation: DevOps / Production
> Engineering.

Both findings are execution-scope limitations rather than security or
operational ones, so both route to the **Product Owner**. This matches the
precedent already set in this specification: `CONV-003`, the original
bootstrap boundary, was accepted by the Product Owner.

---

# CONV-012 — the ASES-0004 scope deviation

**Required functional role: Product Owner** (gate 9, functional or scope
limitation).

## The facts, preserved

| Fact | State |
|---|---|
| `ASES-0004` | `PARTIAL` — unchanged |
| `VER-0004` | `PARTIAL` — corrected from `PASS` by audit, because a `PASS` sat above a command that exited 1 |
| `SDD-V046` | genuinely fired; the deviation really happened |
| Scope widening | **none.** `TASK-013` was not enlarged to absorb the edit |
| The out-of-scope edit | recorded in `ASES-0004`, `VER-0004` and `REV-0005` |
| `D6` workflow change itself | independently verified (`VER-0004`) and reviewed (`REV-0005`) |

## What happened

While `ASES-0004` was open for `TASK-013`, whose declared scope was the CI
workflow file alone, `docs/EVIDENCE_CONFLICTS.md` was edited for unrelated
`D2` governance work. The scope checker reported `SDD-V046` correctly.

The correct sequencing was to finish the `D2` corrections before opening the
session.

## Allowed decisions

| Decision | Consequence |
|---|---|
| **ACCEPT RISK** | `CONV-012` → `ACCEPTED_RISK` with the Product Owner named, plus rationale, scope, compensating controls, evidence reference and date |
| **REQUIRE REMEDIATION** | A `CHG-` record, task, preflight, session, verification and independent review. `D10` stays ineligible until complete |

## Rationale offered for consideration

> The historical execution-process deviation was detected by the scope
> control, preserved truthfully, and not normalized by widening scope. The
> intended `D6` implementation was separately verified and reviewed.
> Acceptance is historical and does not authorize future scope violations.

## Compensating controls, if accepted

1. The control that caught it remains active and unchanged — scope checking
   caught its own operator, which is the strongest evidence it works.
2. The deviation is recorded in three execution artefacts and one convergence
   finding, none of which the acceptance removes.
3. `ASES-0004` and `VER-0004` stay `PARTIAL`, so the record does not read as a
   clean run.
4. The `D6` deliverable was verified and reviewed independently of the
   deviation, so `CONV-005` stands on its own evidence.

**What acceptance would not authorise:** any future scope violation, or
widening a task after the fact to absorb one.

---

# CONV-014 — the TASK-017 bootstrap deviation

**Required functional role: Product Owner** (gate 9, functional or scope
limitation; same routing and same precedent as `CONV-003`).

## The facts, preserved

| Fact | State |
|---|---|
| Preflight | genuinely refused; `SDD-V060` was already blocking |
| Mechanism | no generic exception mechanism existed yet |
| `TASK-017` | **not** represented as session-controlled; the execution note says plainly it ran outside a session |
| Retroactive session | **none fabricated** |
| After the mechanism existed | `TASK-016` returned to preflight, session, scope check, verification and independent review |

## What happened

The exception mechanism could not be built inside a session, because preflight
refuses to authorise one while a blocking validation error stands — and the
blocker was `SDD-V060` on this specification, the exact finding the exception
exists to cover.

A control cannot govern its own construction. The alternative was to leave an
approved human decision with no means of taking effect.

## Where the boundary sits

```text
TASK-017   exception mechanism      ungoverned  ← the deviation
─────────────────────────────────────────────── EXC-001 takes effect
TASK-016   brittle test correction  ASES-0007, fully governed
```

The line is visible rather than smoothed over, and it is exactly where the
exception took effect.

## Allowed decisions

| Decision | Consequence |
|---|---|
| **ACCEPT RISK** | `CONV-014` → `ACCEPTED_RISK` with the Product Owner named, plus rationale, scope, compensating controls, evidence reference and date |
| **REQUIRE REMEDIATION** | A `CHG-` record, task, preflight, session, verification and independent review. `D10` stays ineligible until complete |

**A note on what remediation could and could not achieve.** The work is done
and cannot be un-done into a session. Remediation would mean a governed
re-review of `exceptions.mjs`, not a re-execution — and the `D9` addendum
already covers exactly that ground. A reviewer may reasonably judge that the
addendum makes separate remediation redundant, or may not.

## Rationale offered for consideration

> The first implementation of the generic exception mechanism necessarily
> crossed a bootstrap boundary because the mechanism required to authorize the
> historical exception did not yet exist. The deviation is preserved rather
> than rewritten. The exception implementation is non-precedential and all
> subsequent applicable work returned to the normal controlled workflow.

## Compensating controls, if accepted

1. The mechanism is generic: `UT-045` asserts no specification or exception
   identifier appears in `exceptions.mjs`, and a repository-wide scan confirms
   no executable line anywhere references one.
2. Eleven adversarial tests, none of which uses `SPEC-0002`.
3. It fails closed on every rejection path.
4. `TASK-016`, immediately afterwards, ran fully governed — so the boundary is
   bounded and demonstrable.
5. The `D9` addendum puts the same code in front of a human reviewer.

**What acceptance would not authorise:** future work outside a session, or
treating a blocked preflight as an invitation to proceed. This was one
bootstrap, recorded, with the boundary visible.
