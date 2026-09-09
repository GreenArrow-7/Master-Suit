# Validation rule audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## Catalogue state

| | Before B3 | After B3 |
|---|---|---|
| Rules in `tools/sdd/rules/rules.mjs` | 41 | 58 |
| Rules documented in `docs/sdd/VALIDATION_RULES.md` | 41 | 58 |
| Undocumented rules | 0 | 0 |
| Documented rules with no implementation | 0 | 0 |

Verified mechanically by comparing the exported catalogue against the document
text. Both directions were checked: every implemented rule is documented, and
every documented identifier exists in code. `UT-148` additionally asserts in
the test suite that each of `SDD-V042` to `SDD-V058` exists with a title and a
severity.

## Rules added

Seventeen, `SDD-V042` to `SDD-V058`. Sixteen `ERROR`, one `WARNING`.

The single `WARNING` is `SDD-V052`, repository drift. `UT-148` asserts that
severity explicitly, so a later edit that promoted it to `ERROR` would fail a
test rather than pass silently.

## Rules changed

None. No B1 or B2 rule was redefined, renumbered, reworded in intent, or
changed in severity. The B3 rules occupy a fresh identifier range above the
existing catalogue.

Specifically, and per the phase instruction: **`SDD-V041` remains `WARNING`.**
Code-without-specification stays advisory during the brownfield transition.
Its promotion is governed by `docs/sdd/ENFORCEMENT_STANDARD.md` and is a
separate, approved decision. See `transition-policy-audit.md`.

## One validator defect fixed

`validate()` previously collected only the filtered specification when
`--spec` was given, which meant a cross-specification reference could not
resolve and `SDD-V016` produced false positives. The fix collects every
specification and filters only the reported findings.

This was a defect in the validator, and it was fixed in the validator. The
alternative, adjusting the artefacts to avoid triggering it, would have
recorded a tooling bug as a documentation problem. `docs/sdd/CHANGE_CONTROL.md`
requires resolving a conflict at the layer that is actually wrong.

## No rule was weakened to obtain a pass

Three `SDD-V040` findings against `SPEC-0002` were outstanding while this
phase ran, all forward references to documents produced later in the phase.
Two were fixed by qualifying an unqualified path in the artefact. The rest
were cleared by producing the referenced documents.

At no point was a rule disabled, downgraded, excepted, or narrowed to make the
phase pass. `docs/sdd/VALIDATION_EXCEPTIONS.md` records no new exception.

The convergence pass strengthened one B2 security test rather than relaxing
it. `ST-002` had gone red because its `child_process` allowlist did not
anticipate a second legitimate git caller. The allowlist now authorises by six
verified properties instead of by file name, newly prohibits `spawn`, `fork`
and an implicit shell, and fails if an entry becomes stale. Two `ST-009`
tests were added. That work was done by a session forbidden from editing the
callers it was reviewing, so it could not make a caller pass by changing the
caller.
