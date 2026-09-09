# Traceability validation audit

## What is enforced

| Rule | Enforces | Test |
|---|---|---|
| `SDD-V026` | Every task cites a requirement or an approved decision | passes |
| `SDD-V027` | Every requirement appears in the test plan | passes |
| `SDD-V028` | Every security requirement is co-located with a security test | passes |
| `SDD-V029` | Every acceptance criterion has a verification mapping | passes |
| `SDD-V030` | Traceability references only identifiers that exist | passes |
| `SDD-V014` | An identifier is declared once per artefact | passes |
| `SDD-V015` | No identifier is declared in two artefacts | indirect |
| `SDD-V016` | Qualified `SPEC-NNNN/ID` references resolve | passes |

## Declaration versus reference

The distinction that makes these rules workable: an identifier is *declared*
by a heading or a list bullet, and merely *referenced* in a table cell. Without
it, a task appearing in both a summary table and its own heading would look
like a duplicate declaration, and every specification would fail `SDD-V014`
for being well organised.

## The defect this audit exists to record

`SDD-V030` originally could not fire. The known-identifier set was built from
every artefact including the traceability matrix itself, so the matrix
vouched for its own references and a phantom identifier was always "known".

Found by running the validator against its own specification, exactly as Step
18 of the brief intends. Fixed at the validator layer, which was the layer
that was wrong, by excluding the traceability artefact from the known set.
The test failed before the fix and passes after. Recorded as `CONV-002`.

Had the artefact been "fixed" instead, the rule would still be inert today
and nobody would know.

## What is not enforced

The anti-gaming rule from `docs/sdd/TRACEABILITY_STANDARD.md` stays human. A
test listed against a requirement it does not exercise resolves structurally
and passes. The validator can prove a link exists; only a reviewer can prove
it is meaningful. This is stated in the standard rather than implied away.

## Evidence Sources

E1: `tools/sdd/lib/traceability.mjs`, `tools/sdd/lib/markdown.mjs`,
`tools/sdd/lib/validate.mjs`.
E3: the six traceability tests.
E4: `docs/sdd/TRACEABILITY_STANDARD.md`.
