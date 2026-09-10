# 12 — Phase B4.0 readiness summary

**Phase:** B4.0 — Production/Pilot Readiness & First Controlled Feature
Selection · **Date:** 2026-09-08

## Verdict

# READY FOR PILOT SELECTION

Two blocking items remain, and both are human decisions rather than
engineering work: the pilot selection itself, and the R3/R4 reading if `PC-01`
is chosen.

**This is B4.0, not B4. Nothing is complete.**

## Three readiness levels, not one

Kept separate deliberately. Collapsing them is how a system that can be worked
on gets mistaken for one that can be shipped from.

| Level | Status | Basis |
|---|---|---|
| **CONTROLLED DEVELOPMENT READINESS** | **READY** | B3 accepted; validator, agent control plane and test suites all green; a bounded, code-only-rollback pilot identified with a feasible local test strategy |
| **STAGING READINESS** | **NOT ESTABLISHED** | The CI workflow has never run remotely; branch protection and required checks are unverified; `EVC-003` and `EVC-012` leave the deployment mechanism contested |
| **PRODUCTION RELEASE READINESS** | **NOT ESTABLISHED** | Everything above, plus `EVC-005` on backup capability, and every Phase A production unknown still open |

Ten of the fifteen evidence conflicts remain `OPEN`. None was closed by B1, B2,
B3 or B4.0, and closing any needs production or staging access this phase is
forbidden from having.

## B3 accepted limitations carried into B4

None is resolved. None authorises a similar B4 deviation.

| Finding | What it means for B4 |
|---|---|
| **CONV-001** | Machine role separation proves distinct records, not reviewer competence or genuine independence. The pilot's `REV-` record is a structured claim; the **human** code review is what carries assurance |
| **CONV-003** | A historical B3 bootstrap limitation. **It must not recur.** The pilot has a working control plane from its first task; there is no bootstrap excuse available |
| **CONV-009** | Historical digest limitation. **Every new B4 session must use current digest capture** — `ASES-0004` onward already do, so this is inherited working, not owed |
| **CONV-012** | A scope deviation was accepted *historically*. B4 must not normalise future ones: a task that needs wider scope stops and raises a change record |
| **CONV-014** | The exception-mechanism bootstrap was historical and non-precedential. **All B4 work uses normal preflight and sessions.** A blocked preflight is a stop, not an invitation |

**No accepted B3 risk automatically authorises a similar B4 deviation.** Each
was accepted for a specific historical fact, scoped to itself, by a named role.

## What B4.0 changed

Documentation and evidence only.

| Area | Changed |
|---|---|
| Application frontend / backend | **none** |
| Database schema, migrations | **none** |
| Dependencies, lockfiles | **none** |
| Runtime configuration | **none** |
| CI workflow | **none** |
| Deployment configuration | **none** |
| `docs/evidence/phase-b4-pilot-readiness/` | 13 files created |

No defect discovered during the audit was fixed. `PC-01` through `PC-05` are
recorded as candidates for governed work, not repaired opportunistically —
which is the rule `CONV-012` exists to protect.

## Reconciliation, 2026-09-08

Two audits after the first pass changed the recommendation. See `13`.

- **`PC-01` is NOT eligible** as the first pilot. Its risk class is
  `UNRESOLVED`: the authoritative language does not settle whether reformatting
  PII the caller may already read is an R4 trigger. Registered as `EVC-016`,
  and the earlier R3 reading is withdrawn.
- **`PC-02` is the current recommendation.** R2, verifiable with the
  Playwright harness already present — no dependency added.
- The CSV-injection claim is corrected from the executes-in-Excel wording to
  the evidence-qualified form, at level `DOCUMENTED`.

## The strongest candidate is blocked, not wrong

Four HR pages each carry a private copy of a CSV encoder that lacks the
formula-injection guard the shared hardened library has. The library's own
docblock warned that a third copy must not drift. Four did.

That work is still worth doing. It is blocked on a governance question rather
than on its merits, and it should return once `EVC-016` is decided.

## Next SPEC identifier

**`SPEC-0003`** — reserved, **not created**. No specification exists for any
candidate, deliberately: an AI recommendation must not become authoritative
product scope by default.

## Stop point

**HUMAN PILOT SELECTION REQUIRED.**

No implementation may begin. No specification may be created. Phase B4.1 does
not start automatically.
