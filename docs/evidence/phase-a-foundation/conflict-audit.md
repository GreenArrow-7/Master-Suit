# Evidence-conflict audit

Audit of `docs/EVIDENCE_CONFLICTS.md` at commit `f16ed67`.

## Register integrity

**VERIFIED.**

| Check | Result |
|---|---|
| Conflicts defined | 14 (EVC-001 … EVC-014, no gaps, no duplicates) |
| Referenced from other Phase A documents | 14 of 14 |
| Referenced but not defined | none |
| Defined but never referenced | none |
| Each entry records both sides independently | yes |
| Each entry names required verification | yes |
| Each entry names a functional resolution owner | yes |
| Resolved conflicts | 0 (the resolved section is present and empty) |

## Status and severity distribution

| Status | Count |
|---|---|
| OPEN | 9 |
| PARTIALLY RESOLVED | 3 |
| ACCEPTED DIFFERENCE | 2 |
| RESOLVED | 0 |

| Severity | Count | | Release impact | Count |
|---|---|---|---|---|
| C0 | 1 | | NON-BLOCKING | 10 |
| C1 | 4 | | TO BE DETERMINED | 3 |
| C2 | 5 | | BLOCKING | 1 |
| C3 | 3 | | | |
| C4 | 1 | | | |

Note: the PARTIALLY RESOLVED entries are EVC-004 (C4), EVC-014 (C2) and one
ACCEPTED DIFFERENCE marked "pending confirmation", EVC-009 (C1). Nothing was
marked RESOLVED, because no conflict has the verification behind it that the
standard requires for that status.

## No silent resolution

**VERIFIED.** Every conflict where repository evidence favours one side still
carries the opposing claim in full, an explicitly qualified "current
conclusion", and a confidence rating separate from its status. Two
illustrative cases:

- **EVC-004** (C4, RLS): the repository evidence is strong — 26 migrations
  carrying `FORCE ROW LEVEL SECURITY`, a CI gate, a boot check that refuses
  to serve, and passing isolation tests. The conflicting document,
  `docs/RLS-ROLLOUT.md`, is nonetheless preserved verbatim, the status is
  PARTIALLY RESOLVED rather than RESOLVED, and the production catalogue check
  is named as the outstanding verification.
- **EVC-001** (C2, layering): the code contradicts the architecture document
  on every point, yet the status stays OPEN because whether the documented
  design is still intended is a product decision, not a code fact.

## Conflicts affecting Phase A correctness

Assessment: **none of the 14 invalidate the Phase A documentation.** Each was
found by Phase A, is recorded by Phase A, and is reflected in the documents it
touches. A conflict that is registered, cross-referenced and qualified is
working documentation, not a documentation defect.

Two require care by any consumer of the Phase A set, because a reader who
consults only the older document would act on stale information:

| Conflict | Why it matters to Phase A readers | Mitigation in place |
|---|---|---|
| EVC-001 / EVC-002 | `apps/web/docs/00-ARCHITECTURE.md` remains in the repository and describes a layering and a queue set that do not exist | `docs/architecture/BACKEND.md` and `SYSTEM_OVERVIEW.md` state the current code and name the conflict; GAP-DOC-01 proposes status headers on legacy documents |
| EVC-004 | A reader of `docs/RLS-ROLLOUT.md` alone could conclude tenant isolation is not enforced and relax a guard | `docs/security/SECURITY_MODEL.md` and `architecture/DATABASE.md` carry the current position with citations; the conflict is C4 and tracked |

## Conflicts that are production or runtime concerns only

EVC-003 (active deployment mechanism), EVC-005 (backup execution),
EVC-012 (artifact and rollback path). Each is answerable only on the host.
They do not affect the accuracy of the Phase A documents, which already mark
the corresponding facts UNKNOWN. EVC-005 remains **release-blocking** for a
production claim and is not downgraded by this audit.

## Distinction from security findings

**VERIFIED.** The register and `docs/security/SECURITY_OBSERVATIONS.md` are
separate artefacts with separate identifier spaces. One cross-link exists in
each direction between EVC-010 and SEC-OBS-002, which is the intended
pattern: an evidence conflict about the completeness of the route
authorization matrix, and a separate observation about the routes themselves.
No conflict was promoted to a vulnerability claim.

## Open C4 conflicts

One: **EVC-004**, tenant-isolation evidence. Status PARTIALLY RESOLVED,
release impact TO BE DETERMINED, confidence High on the repository evidence,
outstanding verification is a read-only catalogue check against production.
It appears in this audit, in `unknowns.snapshot.md` and in `acceptance.md`,
as the standard requires.

## Evidence Sources

E1: `docs/EVIDENCE_CONFLICTS.md`; cross-reference extraction over
`AGENTS.md`, `CLAUDE.md`, `docs/SYSTEM_INVENTORY.md`,
`docs/PHASE_A_GAP_ANALYSIS.md`, `docs/architecture/**`, `docs/security/**`,
`docs/operations/**`, `docs/standards/**`.
E4: the conflicting source documents named in each entry.
