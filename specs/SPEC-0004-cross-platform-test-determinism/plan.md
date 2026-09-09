# SPEC-0004 — Plan

| Field | Value |
|---|---|
| Specification | `SPEC-0004` |
| Risk | `R2` |
| Date | 2026-09-08 |

R2 asks for a short plan: the mandatory sections present, a line or two each.

## Approach

Fix the harness where it is wrong about the platform, and add the missing
test-database preparation. Touch no application source.

## Technical decisions

### AD-001 — Split on `/\r?\n/`, never on `'\n'`

The repository's own `toLines()` in `tools/sdd/lib/markdown.mjs` already does
this. The tests are the outliers.
**Serves:** `FR-001`

### AD-002 — Match the body delimiter on either line ending

`bodyOf()` gets a pattern rather than a literal, so a CRLF file yields the real
tool body. **The check becomes stricter**, because it stops examining most of
the file.
**Serves:** `FR-001`, `SEC-002`

### AD-003 — Normalise separators before membership tests

Compare `file.split(path.sep).join('/')` against the forward-slash `EXEMPT`
set. The capture-vault service already uses this idiom for its object keys, so it is
the house pattern rather than a new one.
**Serves:** `FR-002`

### AD-004 — Guard POSIX-mode assertions on the platform, not on the result

`process.platform === 'win32'` decides whether the assertion runs. It never
inspects the value first. On POSIX the assertion is unchanged and must pass.
**Serves:** `FR-003`, `SEC-001`

### AD-005 — `db:test:prepare` and `db:test:reset` are separate commands

Preparation is idempotent and never destroys. Reset is destructive, named so,
and never invoked by preparation.
**Serves:** `FR-004`, `FR-005`, `FR-006`

### AD-006 — Correct the sentence, not the command

`npm run setup` is not widened to prepare a second database. The false claim in
the secrets-generation script is corrected to describe what actually happens and to
point at the new command.
**Serves:** `FR-007`

## Affected files

| File | Change |
|---|---|
| `apps/web/tests/unit/env-example-parses.spec.ts` | line splitting |
| `apps/web/tests/security/assistant-guardrails.spec.ts` | body delimiter |
| `apps/web/tests/unit/observability.spec.ts` | line splitting, platform guard |
| `apps/web/tests/security/guarded-prologue.spec.ts` | separator normalisation |
| `prepare-test-db` under `apps/web/scripts/` | **new** |
| `apps/web/package.json` | two script entries; **no dependency change** |
| `apps/web/scripts/generate-secrets.mjs` | comment correction only |
| `apps/web/SETUP.md` | document the commands |

## Data model impact

None. No migration is created and no schema is changed. The bootstrap applies
**existing** migrations to a local disposable database.

## Security impact

Two of the four touched test files are security tests. `SEC-001` requires every
assertion to keep proving the same invariant, and `SEC-002` requires the
`assistant-guardrails` check to end stricter than it began. The security review
in `TASK-007` is the evidence.

## Deployment impact

None. No environment variable, no migration, no worker, no queue. The new
script is local-only and refuses a non-loopback host.

## Rollback

Revert the touched files and the manifest entries.

## Tests that will prove it

`test-plan.md`. The existing 20 failing tests are the primary evidence: they
must pass **while asserting the same things**. Idempotence gets its own case.

## Assumptions and unknowns

- CI runs Linux and these 20 already pass there (`EVC-014`, `DOCUMENTED`).
- If correcting `assistant-guardrails` reveals **genuine** permission drift, it
  surfaces as a new failure. That would be a real finding and must be reported,
  not suppressed.
