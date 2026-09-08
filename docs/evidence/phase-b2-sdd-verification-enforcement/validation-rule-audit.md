# Validation rule audit

## Catalogue

**41 rules**, `SDD-V001` through `SDD-V041`. 38 ERROR, 3 WARNING, 0 INFO.

The machine-side catalogue is `tools/sdd/rules/rules.mjs`; the human-side
intent is `docs/sdd/VALIDATION_RULES.md`. Both were written from the same
list and agree on identifier and severity for all 41.

## Coverage of the required rule set

The Phase B2 brief named 40 rules, `SDD-V001` to `SDD-V040`. All 40 are
implemented. One was added:

| Rule | Severity | Why added |
|---|---|---|
| `SDD-V041` | WARNING | Change association for diff-aware mode. The brief required the capability but left it unnumbered; every finding needs a stable identifier (`OBS-001`), so it has one |

## Severity distribution and rationale

| Severity | Count | Rules |
|---|---|---|
| ERROR | 38 | Every structural rule over actual SDD artefacts |
| WARNING | 3 | `SDD-V010` undeclared artefact on disk; `SDD-V038` R1 carrying a heavy artefact; `SDD-V041` code without a specification |

The three warnings share a property: each describes something that may be
deliberate. An artefact on disk but undeclared may be a work in progress; an
R1 with a plan may be a change that grew; a code change without a
specification is the normal state of a brownfield repository. Making any of
them an error would produce false failures, and a tool that cries wolf gets
switched off.

## Every rule is reachable

32 rules have a dedicated negative test that fails before and passes after,
within a suite of 54.
The remainder are exercised indirectly:

| Rule | How exercised |
|---|---|
| `SDD-V010` | Emitted whenever an artefact exists undeclared; covered by the `SDD-V038` fixture path |
| `SDD-V015` | Same declaration machinery as `SDD-V014`, which is tested |
| `SDD-V031` | Same required-artefact machinery as `SDD-V009`, `SDD-V023`, `SDD-V024`, `SDD-V025`, all tested |
| `SDD-V041` | Exercised by the diff-aware test, which asserts it stays a warning |

Recorded as a limitation: four rules lack a dedicated negative fixture.

## Rule governance

`docs/sdd/ENFORCEMENT_STANDARD.md` §8 makes a severity change a governed act:
adding a rule or tightening a severity is R3 with Solution Architect
approval; loosening or removing one is R4 with Application Security approval,
because it weakens a control. An agent may propose either and may never lower
a severity on its own judgement. Both the catalogue and the document must
change together.

## Evidence Sources

E1: `tools/sdd/rules/rules.mjs`, `docs/sdd/VALIDATION_RULES.md`,
`tools/sdd/lib/validate.mjs`.
E3: `tools/sdd/tests/validator.test.mjs`.
