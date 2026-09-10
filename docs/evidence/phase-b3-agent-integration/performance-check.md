# Performance check

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07
**Machine:** Windows 11, Node v24.18.0. Wall-clock, three runs each, cold
filesystem cache not controlled.

## Measurements

| Command | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `validate --all` | 344 ms | 303 ms | 299 ms |
| `agent preflight` | 281 ms | 521 ms | 304 ms |
| `node --test agent.test.mjs` (36 tests) | 3.5 s | | |

`NFR-001` in `SPEC-0002` asks that a preflight decision be fast enough not to
discourage use. At roughly a third of a second on a developer workstation,
it is.

The 521 ms outlier is process start-up variance on Windows, not a different
code path. Three runs is enough to see that and not enough to characterise the
distribution; no conclusion is drawn from it beyond that.

## Why preflight costs about what a full validation costs

Because it *is* a full validation. Preflight runs the complete validator
against the specification before evaluating a single role question, so a
blocking structural error stops every agent action. That is a deliberate
design decision, not an inefficiency, and it is what `UT-132` verifies.

## Complexity

Both commands are linear in the number of specification artefacts and their
size. Records are bounded at 128 KiB each, drift output is capped at 25 paths,
and there is no quadratic comparison over findings.

The repository currently holds two specifications. The measurements above do
not tell you how the tool behaves at two hundred, and nothing here should be
read as a projection.

## Not measured

- Behaviour on a large monorepo checkout.
- Behaviour in CI, on Linux, on GitHub-hosted runners. The workflow has never
  executed. See `ci-integration-audit.md`.
- Any application-level performance. B3 changed no application code, so there
  is nothing to compare.
