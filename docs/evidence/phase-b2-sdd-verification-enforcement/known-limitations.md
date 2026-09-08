# Phase B2 — known limitations

What the validator cannot do, what was deliberately not built, and what must
be tracked forward.

## L-01 — A structured approval record does not prove human agency

The most important limitation, restated here because it is the one most
likely to be misread. The validator confirms that a record exists on the right
gate with `actorType: "human"`. Anyone who can commit can write that record.

Real assurance needs commit authorship, code review and branch protection.
Branch protection here is `UNKNOWN — requires runtime/infrastructure
verification` (GAP-CI-01). Until confirmed, treat an approval record as making
an omission visible, not as evidence a human decided anything.

Accepted residual risk `TH-005`, owned by Application Security. Revisit when
branch protection is confirmed.

## L-02 — Structure is checked; quality is not

The validator can say an R4 specification has a threat model. It cannot say
the threat model is any good. The same holds for plans, tests and
requirements. A specification can pass every rule while being poor work.

This is deliberate (`CL-002`). A tool that scored quality would be trusted for
a judgement it cannot make, which is worse than not scoring it. Review remains
the control.

The corollary is that a green run is not a safety claim, and no document in
this phase says it is.

## L-03 — CI enforcement is applied but unproven in CI

Resolved as a blocker: `.github/workflows/sdd-validate.yml` exists, added under
`CHG-001` after explicit authorisation.

What remains: the workflow has never run. Phase B2 does not commit or push, so
whether GitHub accepts the file and the job is green is
`UNKNOWN — requires runtime/infrastructure verification` until somebody pushes
it. Both job steps were run locally and pass.

Separately, branch protection is still unconfirmed (GAP-CI-01), so a red check
can currently be merged past. The workflow reports; it does not yet enforce.

## L-04 — Four rules have no dedicated negative fixture

`SDD-V010`, `SDD-V015`, `SDD-V031` and `SDD-V041` are exercised indirectly
through shared machinery rather than by a fixture built to trigger each one.
The other 37 have a dedicated test that fails before and passes after.

These four are the most likely place for a rule gap to hide. Adding fixtures
is cheap and should happen in the next phase.

## L-05 — Cross-platform equivalence is asserted, not demonstrated

`NFR-002` requires identical findings on Windows and Linux. The suite was run
on Windows only. The parsing is line-oriented and CRLF-tolerant by
construction, so equivalence is expected, but expected is not verified:
`UNKNOWN — requires runtime/infrastructure verification` until CI runs it on
Linux. This is one of the things CI adoption would settle.

## L-06 — The schema and the implementation can drift

`docs/sdd/schemas/sdd-manifest.schema.json` is documentation; the validator
implements its checks directly (`AD-002`, to avoid a dependency). Nothing
mechanically holds the two in step. They agree today, field by field, as
recorded in `machine-contract-audit.md`. A future change to one without the
other would not be caught.

## L-07 — Change association is narrow by design

A file counts as associated only when a task names its exact path. Real
changes often touch files a task did not enumerate, so `SDD-V041` will report
UNKNOWN frequently. That is preferred to a heuristic that guesses, but it does
limit the rule's usefulness until tasks routinely list concrete paths.

## L-08 — The process has still never run on a product feature

`SPEC-0001` governs the tooling itself. No product change has gone through the
lifecycle. Whether the process is workable on real feature work — whether R2
artefacts really are "short", whether the clarification checklist finds the
right ambiguities — remains untested.

## L-09 — Performance measured at small scale only

One specification and three fixtures. 85 ms for a full validation. Behaviour
at a hundred specifications is reasoned about, not measured
(`performance-check.md`).

## L-10 — Phase A and B1 items are unchanged

All 27 Phase A unknowns remain open, including the eleven production-release
blockers. All 14 evidence conflicts remain as they were. The six approval
roles still have no people assigned, which means an R4 gate still has no
identified approver. The `.gitattributes` remediation is still deferred.

## Evidence Sources

E1: `tools/sdd/**`, validator runs at commit `f16ed67`.
E3: `tools/sdd/tests/validator.test.mjs`.
E4: `specs/SPEC-0001-sdd-verification-enforcement/`,
`docs/evidence/phase-a-foundation/unknowns.snapshot.md`,
`docs/evidence/phase-b1-sdd-foundation/known-limitations.md`.
