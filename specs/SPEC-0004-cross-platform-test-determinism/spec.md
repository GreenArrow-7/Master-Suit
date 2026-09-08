# SPEC-0004 — Cross-platform test determinism and test-database bootstrap

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0004` |
| Status | `CONVERGED` |
| Risk | `R2` |
| Author | AI, Planner role |
| Date | 2026-09-08 |

## Problem

The product suite reports **1892 passed / 24 failed**. All 24 were reproduced
from a known local environment before anything was edited, and every one was
root-caused to source rather than inferred from a historical label.

**Twenty of the twenty-four are defects in the test harness itself, not in the
product.** They fail only where the worktree uses CRLF line endings and
backslash path separators — that is, on Windows, where `core.autocrlf` is
`true`. The remaining four are a genuine product defect and are deliberately
**out of scope** here; see *Out of scope*.

### Root cause 1 — text scanning that assumes LF — 17 failures

| File | Failures | Mechanism |
|---|---|---|
| `apps/web/tests/unit/env-example-parses.spec.ts` | 5 | Splits on `'\n'`, leaving a trailing `\r`. The line pattern ends `(.*)$`, and `.` excludes line terminators while `$` without the `m` flag anchors to end-of-input, so **no line matches and no variable is parsed** |
| `apps/web/tests/security/assistant-guardrails.spec.ts` | 11 | `bodyOf()` locates a tool body with `source.indexOf('\n  },\n')`, which never matches a CRLF file. `indexOf` returns `-1` and `slice(start, -1)` returns **nearly the whole file** |
| `apps/web/tests/unit/observability.spec.ts` | 1 | Byte-identical comparison of a rendered file against its source |

**The `assistant-guardrails` case matters most, because its failure message was
actively misleading.** It reported *"searchLeads reads `prisma.account` (module
accounts) but neither requires it nor is listed in ALLOWED"*, which reads as
drift between the AI assistant's declared tool permissions and what its tools
actually read.

**Measured, that claim is false.** With the correct delimiter, `searchLeads`
reads exactly one model — `prisma.lead`. The broken extraction captured 39,757
characters instead of 2,752, so every tool appeared to read every model
mentioned later in the file.

`SPEC-0003/CONV-011` recorded these 11 as *"drift between the AI assistant's
declared tool permissions and the models its tools read"*. **That root cause was
wrong.** It is corrected here; the accepted risk on the closed pilot is not
rewritten.

### Root cause 2 — path separator in a test helper — 1 failure

`apps/web/tests/security/guarded-prologue.spec.ts` builds its file list with
`globSync`, which returns `integrations\meta\callback\route.ts` on Windows,
and tests membership against an `EXEMPT` set keyed with forward slashes. The
set never matches, so the **two legitimately exempt routes are reported as
hand-rolled security prologues**.

### Root cause 3 — POSIX file mode on a filesystem without one — 2 failures

The observability spec asserts `statSync(f).mode & 0o777 === 0o600` on files a
shell script creates. Windows reports `0o666`. The script is correct and the
assertion is correct; the platform cannot represent the property.

### Root cause 4 — no deterministic test-database preparation

`master_saas_test` — the database `.env.test` names — has no workflow that
creates or migrates it. `apps/web/scripts/generate-secrets.mjs` states it is
*"a separate database that a developer creates with `npm run setup`"*. That is
false: `setup` runs `prisma migrate deploy` against `.env`, which resolves to
`leadflow`, and `apps/web/infra/docker-compose.yml` creates only `leadflow`.

This is the standing `REQUIRED before pilot #2` action from `SPEC-0003/CONV-003`.

## Goal

A product suite whose result is the same on Windows and Linux, and a documented
deterministic way to prepare the local test database — without weakening a
single assertion.

## Scope

`apps/web/tests/unit/env-example-parses.spec.ts`,
`apps/web/tests/security/assistant-guardrails.spec.ts`,
`apps/web/tests/unit/observability.spec.ts`,
`apps/web/tests/security/guarded-prologue.spec.ts`,
`apps/web/package.json`, `apps/web/scripts/`, `apps/web/SETUP.md`.

## Out of scope

**`apps/web/tests/unit/capture-vault.spec.ts` and its 4 failures.** They are a
genuine product defect: `pathFor()` in
`apps/web/src/services/hr/captureVault.ts` builds a storage key with
`path.join`, which yields backslashes on Windows, and that value is written to
the `HrAttendancePunch.capturePath` column whose documented contract is
`t-x/emp-y/2026-08/punch-z.jpg.enc`.

**That change is `R4`, not `R2`.** `docs/RISK_CLASSIFICATION.md` places
"PII/biometric handling" at `R4`, and this is the construction of biometric
capture storage paths. Whether a pure *transformation* of already-authorised
sensitive data is an `R4` trigger is the unresolved question in `EVC-016`,
which this specification does not resolve and must not assume away. Risk is
classified by the **highest** level any part of a change touches, so bundling
it here would make this entire specification `R4`.

It is therefore carried as a separate blocked workstream with its own decision
packet. Also out of scope: any change to product code, `EVC-016`, `PC-01`,
pilot #2 selection, and reopening `SPEC-0003`.

## Functional requirements

- `FR-001` — Text scanning in the affected tests tolerates both `LF` and
  `CRLF`, and parses the same content on either.
- `FR-002` — File-list membership tests compare normalised paths, so a
  backslash separator does not defeat an exemption set.
- `FR-003` — Assertions that depend on POSIX file modes run and must pass where
  the platform supports them, and are explicitly and visibly skipped where it
  does not.
- `FR-004` — A documented command deterministically prepares `master_saas_test`
  against a local PostgreSQL: the database exists, existing migrations are
  applied, and the suite can run.
- `FR-005` — Preparation is idempotent. Running it against an already-prepared
  database leaves it usable and destroys nothing.
- `FR-006` — Any destructive reset is a **separately named** command. No
  destructive behaviour hides behind a preparation command.
- `FR-007` — Every repository statement about what `npm run setup` prepares
  agrees with what it executes.
- `FR-008` — The E2E harness does not begin a test until the API routes it
  depends on are able to answer. Added by `CHG-001`.

## Non-functional requirements

- `NFR-001` — No new runtime or development dependency.
- `NFR-002` — **No application source file is changed.** Only tests, scripts,
  the package manifest and documentation.
- `NFR-003` — No new Prisma migration and no schema change.
- `NFR-004` — No production or staging system is contacted. Loopback only.
- `NFR-005` — No secret value is read, printed or written into any artefact.
- `NFR-006` — No blind retry, arbitrary sleep or raised global timeout is used
  as a remedy for a readiness defect. Added by `CHG-001`.

## Security requirements

- `SEC-001` — Every security assertion in the four touched test files continues
  to prove the same invariant. **No assertion is loosened, deleted, skipped
  without a platform reason, or replaced by a weaker matcher.**
- `SEC-002` — The corrected `assistant-guardrails` extraction must make the
  tool-permission check **stricter**, not weaker: with the correct delimiter it
  examines the real tool body instead of most of the file.

## Data and privacy requirements

- `DATA-001` — No change to what data is collected, stored or transmitted. The
  bootstrap creates a local disposable database only.

## Acceptance criteria

- `AC-001` — Given a CRLF worktree, when the suite runs, then the 17 root-cause-1
  failures pass and assert the same properties as before.
- `AC-002` — Given a Windows path separator, when `guarded-prologue` runs, then
  the two exempt routes are recognised and no hand-rolled prologue is reported.
- `AC-003` — Given a platform without POSIX modes, when the mode assertions are
  reached, then they are skipped with a stated reason; on POSIX they run and pass.
- `AC-004` — Given a local PostgreSQL and no prepared test database, when the
  documented command runs, then the database exists with migrations applied.
- `AC-005` — Given an already-prepared database, when the same command runs
  again, then it succeeds and the database remains usable.
- `AC-006` — Given the corrected documentation, when a reader follows it, then
  the described behaviour matches what the command does.
- `AC-007` — Given the harness starts, when the first test begins, then every
  API route it depends on answers rather than returning `404`.

## Assumptions

- `A-001` — CI runs Linux, where these 20 tests already pass. **Evidence:
  `DOCUMENTED`** — `EVC-014` records it; not measured from inside this session.
- `A-002` — `.env.test` already carries a complete configuration including the
  owning migration role. **Evidence: `VERIFIED`** — read 2026-09-08.

## Risks

- Correcting `assistant-guardrails` makes a real permission check run for the
  first time on this platform. If genuine drift exists it will surface as a new
  failure — which is the correct outcome and must not be suppressed.
- A platform guard could hide a regression on POSIX. Mitigated by guarding on
  the platform only, never on the outcome.

## Rollback

Code-only. Revert the touched test files, the manifest script entry and the
documentation. No schema, no state, no flag.

## Evidence

- `VERIFIED` — all 24 failures reproduced 2026-09-08 from a prepared local
  environment before any edit: **1892 passed / 24 failed**.
- `VERIFIED` — `searchLeads` reads exactly `prisma.lead`; the broken extraction
  returned 10 models from 39,757 characters.
- `VERIFIED` — `globSync` returns `integrations\meta\callback\route.ts` on this
  platform.
- `VERIFIED` — `npm run setup` does not create or migrate `master_saas_test`.

## Approval

**Gate 1, specification approval. Status: APPROVED.**

| Gate | Role | Actor type | Decision | Date |
|---|---|---|---|---|
| Specification approval | Product Owner | `human` | **APPROVED** | 2026-09-08 |

**Authorship is unchanged.** The author remains `AI, Planner role`. The gate
was discharged by a human approving the specification, not by altering who
wrote it — a bypass the approver explicitly forbade.

**Approved scope:** RC-1, RC-2 and RC-3 remediation; the deterministic
`master_saas_test` bootstrap; the inaccurate setup-documentation correction;
bounded Playwright harness investigation and remediation; and the associated
tests, traceability and evidence.

**Not authorised by this approval:** RC-4 biometric capture-vault remediation,
authentication redesign, authorization or tenant-boundary changes,
production or staging access, deployment, migration outside the isolated local
test environment, Pilot #2 implementation, `PC-01`, or resolution of
`EVC-016`.
