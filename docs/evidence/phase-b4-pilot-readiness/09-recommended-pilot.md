# 09 — Comparison matrix and recommended pilot

> **SUPERSEDED by `13`.** `PC-01` is not eligible as the first pilot pending
> `EVC-016`. The current recommendation is `PC-02`.

**Phase:** B4.0 · **Date:** 2026-09-08

## Scoring convention — stated before the numbers

Every dimension is scored **1–5 where 5 is always better for a first pilot**.

For the four risk dimensions — security, data, architecture, external
dependency — **5 means safest** (touches nothing) and **1 means riskiest**.
The convention is uniform across all fourteen rows so the total is meaningful
and cannot be read backwards.

## Matrix

| Dimension | PC-01 | PC-02 | PC-03 | PC-04 | PC-05 |
|---|---|---|---|---|---|
| Business usefulness | 5 | 3 | 2 | 3 | 1 |
| Repository evidence quality | 5 | 5 | 5 | 3 | 5 |
| Scope clarity | 5 | 4 | 5 | 3 | 5 |
| Implementation boundedness | 4 | 4 | 5 | 4 | 5 |
| Testability | 5 | 3 | 4 | 1 | 4 |
| Rollback simplicity | 5 | 5 | 5 | 5 | 5 |
| Security risk *(5 = safest)* | 3 | 5 | 5 | 4 | 5 |
| Data risk *(5 = safest)* | 3 | 5 | 5 | 5 | 5 |
| Architecture risk *(5 = safest)* | 4 | 5 | 5 | 5 | 5 |
| External-dependency risk *(5 = safest)* | 5 | 5 | 5 | 5 | 5 |
| Exercises SDD | 5 | 3 | 2 | 3 | 1 |
| Exercises agent sessions | 5 | 4 | 2 | 3 | 1 |
| Exercises verification / review | 5 | 3 | 2 | 2 | 1 |
| Exercises traceability / convergence | 5 | 3 | 2 | 3 | 1 |
| **Total (max 70)** | **64** | **57** | **54** | **49** | **50** |

`PC-01` scores **lowest of all five** on the three risk dimensions that matter
and still leads. That is the shape of an honest matrix: it wins on usefulness,
testability and control coverage while openly carrying more risk than the
trivial candidates.

## Exclusion check

| Domain | Any candidate? |
|---|---|
| Auth, authorization, tenant isolation, billing, secrets | **none** |
| Production infrastructure, release/deployment architecture | **none** |
| Destructive or potentially destructive migrations | **none** |
| External financial systems, destructive data modification | **none** |

Disfavour checks: none touches too many modules, none requires broad
refactoring, none has unclear acceptance criteria, all have code-only rollback.
**`PC-04` is disfavoured** on two counts — it lacks existing tests for its
symptom and depends on real-browser behaviour this phase could not observe.

## Recommended first pilot: PC-01

Scoped to **`people/attendance`, `people/compliance`, `people/work-locations`**.
`people/face-activity` explicitly excluded.

**Recommendation only. The selection is a human's.**

### Why it is useful

It fixes a real defect. A display name beginning `=`, `+`, `-`, `@` or a tab is
written unguarded; formula-leading cells **may be interpreted as formulas by
spreadsheet software**, and the hardened encoder guards against this class
while three HR pages do not. Evidence level `DOCUMENTED`; the missing guard is
`VERIFIED`, exploitation is untested here. The library's own
docblock predicted the drift and four copies exist.

### Why it is low enough risk

No auth, no authorization, no tenant isolation, no schema, no migration, no API
surface, no dependency, no infrastructure. Client components only. The change
**adds** a security defence rather than relaxing one, and rollback is code-only
with no persisted state — an export is generated on demand and never stored.

### Why it is representative enough

It is genuine product work with a security dimension, three files, real
acceptance criteria and a security test that must pass. It is not a
documentation change and not a cosmetic tweak. It will exercise the full
pipeline honestly rather than gliding through it.

### Why it exercises B1/B2/B3

- **B1** — R3 requires the full artefact set: specification, clarifications,
  plan, test plan, tasks, traceability, convergence.
- **B2** — the validator governs those artefacts; `SDD-V059` and `SDD-V060`
  will now demand a *timely* specification approval, which `SPEC-0002` itself
  could not produce. This is the first chance to satisfy that rule properly
  rather than by exception.
- **B3** — preflight, a scoped session over three named files, a scope check
  that can actually fail, a verification record, and an independent review.
  Digest capture applies from the first session, which is what `CONV-009` asked
  for.

### Why its tests are practical

`tests/unit/csv.spec.ts` is the template and already pins every property the
local copies lack. Unit and security tests need no browser, no database and no
network. A regression test can forbid a fifth copy, mirroring the `ST-002`
allowlist scan the B2 suite already uses.

### The honest caveat

Its risk classification sits on the R3/R4 line. `06` sets out both readings.
**If a Solution Architect reads "PII handling" as triggered, `PC-01` becomes R4
and is disqualified as pilot #1** — in which case `PC-02` is the fallback.

## Why the others are less suitable as pilot #1

**PC-02** — genuine accessibility value and safe, but its verification leans on
Playwright and a running application, so it exercises the control system less
convincingly than a unit-testable change. **This is the recommended fallback.**

**PC-03** — correct and almost free, and that is the problem: two attributes
cannot meaningfully exercise a specification, threat consideration, session,
verification and convergence. It would prove the process runs, not that it
works.

**PC-04** — the defect is plausible but **unobserved**. A pilot might discover
there is nothing to fix, which is a poor use of a first run. Better once a
browser-based verification loop exists.

**PC-05** — dead-code removal with zero call sites. Effectively the
documentation-only change the brief warns against.
