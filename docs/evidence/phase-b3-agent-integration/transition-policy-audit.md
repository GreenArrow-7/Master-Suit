# Transition policy audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## `SDD-V041` was not promoted

`SDD-V041`, a changed application file with no associated specification,
remains `WARNING`.

The phase brief instructs directly: *"Do not promote SDD-V041 code-without-spec
from WARNING to ERROR during B3."* It was not promoted, and no configuration
was added that would promote it indirectly.

Verified: the catalogue reports `SDD-V041` as `WARNING`; `sdd.config.json`
retains its transition enforcement mode; the CI workflow still uses
`validate --all`, which performs no change association and therefore cannot
raise the rule at all.

## Why the timing would be wrong

The working tree carries 34 modified application files from redesign work that
predates every SDD phase. Promoting the rule today would fail this repository
for being brownfield, which is precisely the failure mode
`docs/sdd/ENFORCEMENT_STANDARD.md` was written to avoid.

A rule that fires constantly on legitimate work gets disabled. The path from
`WARNING` to disabled is much shorter than the path back.

## No other severity changed

No rule from B1 or B2 was promoted, demoted, reworded in intent, renumbered or
excepted during B3. The seventeen new rules occupy a fresh range above the
existing catalogue and interact with no existing rule.

`docs/sdd/VALIDATION_EXCEPTIONS.md` records no new exception. Nothing was
excepted to make this phase pass.

## The new rules and the transition

The B3 rules apply only where an agent execution record exists. A
specification with no `execution/` directory is unaffected by all seventeen.

That makes adoption additive: existing specifications do not become invalid,
and a team can start recording sessions on one specification without the rest
of the repository failing. The alternative, applying the rules retroactively,
would have made the first day of B3 a repository-wide failure.

## What governs the next promotion

`docs/sdd/ENFORCEMENT_STANDARD.md`. Promotion of any rule is a separate,
approved decision with its own change record. It is not a side effect of a
phase, and no agent makes it.
