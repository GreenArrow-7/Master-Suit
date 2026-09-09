# Dependency change check

## Result

**VERIFIED — Phase B2 added no dependency and changed no manifest.**

| File | Status |
|---|---|
| `apps/web/package.json` | UNCHANGED |
| `apps/web/package-lock.json` | UNCHANGED |
| `apps/mobile/package.json` | UNCHANGED |
| `apps/mobile/package-lock.json` | UNCHANGED |
| `apps/face/requirements.txt` | UNCHANGED |

`git status --porcelain -- <path>` returned zero entries for each.

## How the validator avoids dependencies

`NFR-001` required it and `AD-002` recorded the decision. The tool uses only
`node:fs`, `node:path`, `node:url`, `node:crypto` and, in the diff module
alone, `node:child_process` to invoke `git` with a fixed argument array.
Tests use `node:test` and `node:assert`, both built in.

Three temptations were declined: a JSON-schema library for manifest
validation, a Markdown parser for artefact parsing, and a test framework.
Each would have added a supply-chain surface to a repository whose own
constitution (`AGENTS.md` §6) says not to add a dependency for what a few
lines can do. The schema is published as documentation at
`docs/sdd/schemas/sdd-manifest.schema.json` for interoperability; the checks
are implemented directly.

## No package script was added

`apps/web/package.json` governs the application, not the repository, and a
`check:sdd` alias there would imply the validator is part of the application
build. The documented entry point is the direct command. Adding an alias
later is a documentation change, not a dependency change.

## Evidence Sources

E1: `git status --porcelain`; `tools/sdd/**` import statements.
E2: the four manifests above; `.github/workflows/ci.yml`.
