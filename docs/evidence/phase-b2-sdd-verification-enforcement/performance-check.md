# Performance check

Measured, not asserted against a threshold. `CL-004` decided against
inventing a number nobody approved, so this records observations and leaves
the judgement open.

## Observations

| Measurement | Runs | Result |
|---|---|---|
| `validate --all` over the repository | 3 | 90 ms, 86 ms, 81 ms |
| Full test suite, 52 tests | 1 | 7.1 s |

Platform: Windows 11, Node 24.18.0. Each `validate` figure includes Node
process start-up, so the validator itself accounts for less than that.

## Current scale

One specification with eight artefacts, plus three fixture specifications.
That is a small input, and these numbers should be read as a floor rather
than a projection.

## Why it should scale acceptably

Work is linear in total artefact bytes. Parsing is line-oriented with
anchored patterns and no nested quantifiers, so no input produces
super-linear behaviour (`ST-003` confirms this on a 25,000-character hostile
line, which parses in single-digit milliseconds). The only cross-artefact
pass builds a map keyed by specification, which is linear in identifier
count.

A repository with a hundred specifications would do roughly a hundred times
the per-specification work, which at this rate stays well inside the time a
developer will tolerate before a review.

## What is not measured

Behaviour at large scale was not measured, because the synthetic fixture set
needed to do it credibly would itself be a maintenance burden. If validation
time becomes noticeable, the honest response is to measure the real
repository at that point and set a threshold with a reference workload.

## Evidence Sources

E1: timed runs of `tools/sdd/cli.mjs` and `node --test` at commit `f16ed67`.
E3: `ST-003`.
E4: `specs/SPEC-0001-sdd-verification-enforcement/clarifications.md` `CL-004`.
