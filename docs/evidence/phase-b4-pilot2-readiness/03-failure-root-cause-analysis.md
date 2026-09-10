# The 24 product-suite failures — reproduction and root causes

| Field | Value |
|---|---|
| Date | 2026-09-08 |
| Environment | local, Windows 11, Node v24.18.0, loopback Docker PostgreSQL, `master_saas_test` current |
| Result | **1892 passed · 24 failed · 152 files · 189.9s** — the historical baseline reproduced exactly |
| Method | reproduced **before any edit**; every root cause derived from source, not from a historical label |

---

## The failure table

| # | File | Count | Observed error | Root cause | Layer | Risk |
|---|---|---|---|---|---|---|
| 1 | `apps/web/tests/unit/env-example-parses.spec.ts` | 5 | `expected [ 'APP_URL: Required', …(7) ] to deeply equal []` | RC-1 CRLF | test | R2 |
| 2 | `apps/web/tests/security/assistant-guardrails.spec.ts` | 11 | `searchLeads reads prisma.account … neither requires it nor is listed in ALLOWED` | RC-1 CRLF | test | R2 |
| 3 | `apps/web/tests/unit/observability.spec.ts` | 1 | byte-identical config comparison | RC-1 CRLF | test | R2 |
| 4 | `apps/web/tests/security/guarded-prologue.spec.ts` | 1 | `expected [ …(2) ] to deeply equal []` | RC-2 path separator | test | R2 |
| 5 | `apps/web/tests/unit/observability.spec.ts` | 2 | `expected 438 to be 384` | RC-3 POSIX mode | environment | R2 |
| 6 | `apps/web/tests/unit/capture-vault.spec.ts` | 4 | `expected 't-t1\emp-emp1\…' to be 't-t1/emp-emp1/…'` | RC-4 product `path.join` | **product** | **R4** |

**20 test/environment · 4 product.**

---

## RC-1 — text scanning that assumes LF — 17 failures

### `env-example-parses` (5)

Splits on `'\n'`, leaving `\r` on every line. The pattern ends `(.*)$`; `.`
excludes line terminators and `$` without the `m` flag anchors to end-of-input.
So the regex never matches, **no variable is parsed**, and every example file
appears to declare nothing.

### `assistant-guardrails` (11) — the one that was misdiagnosed

`bodyOf()` finds a tool body with `source.indexOf('\n  },\n')`. On a CRLF file
that literal never occurs, `indexOf` returns `-1`, and `slice(start, -1)`
returns nearly the whole file.

**Measured directly:**

| | Broken (LF search) | Correct (CRLF search) |
|---|---|---|
| body length | **39,757 chars** | **2,752 chars** |
| models `searchLeads` "reads" | 10 — `account, activity, call, contact, event, followUpTask, lead, opportunity, …` | **1 — `lead`** |
| whole file | 45,552 chars | — |

**`SPEC-0003/CONV-011` recorded these as "drift between the AI assistant's
declared tool permissions and the models its tools read". That was wrong.**
There is no drift. Every tool declares what it reads; the extraction was
reading most of the file and attributing it to whichever tool it started from.

The closed pilot's accepted risk is **not** rewritten — see
`docs/evidence/phase-b4-pilot/` and `14-pilot2-readiness.md`. This is recorded
as post-pilot remediation of the root cause, not as a claim that the limitation
never existed.

### `observability` (1)

Byte-identical comparison of a rendered file against its source, where one side
carries CRLF.

## RC-2 — path separator in a test helper — 1 failure

`guarded-prologue` lists routes with `globSync`, which returns
`integrations\meta\callback\route.ts` on this platform, and tests membership
against an `EXEMPT` set keyed `integrations/meta/callback/route.ts`. The set
never matches, so **the two legitimately exempt routes are reported as
hand-rolled security prologues** — a false positive on a security check.

## RC-3 — POSIX file mode on a filesystem without one — 2 failures

`observability` asserts `statSync(f).mode & 0o777 === 0o600` on files created
by a shell script. Windows reports `0o666` — `438` against the expected `384`.

The script is correct, the assertion is correct, and the platform cannot
represent the property. This is the only cluster where the honest fix is a
platform guard rather than a repair.

## RC-4 — product defect — 4 failures — **BLOCKED**

`pathFor()` in the capture-vault service builds a storage key with `path.join`,
which yields backslashes on Windows, and that value is written to the
`HrAttendancePunch.capturePath` column whose documented contract is
forward-slashed.

**Classified R4** — biometric handling, and the same function feeds the
retention walk. Full analysis, blast radius and the human options are in
`05-capture-vault-r4-blocked.md`. **Not fixed, not reclassified, not bundled.**

---

## What was proven about "unrelated"

`SPEC-0003/CONV-011` was accepted on the basis that those 12 failures were
unrelated to the pilot. **That remains true** — they touch no
`TableSearch` and no `components/workspace` file. But *"unrelated to
SPEC-0003"* was never a root cause, and this pass replaces it with one.

## Grouping into governed work

Root causes, not individual assertions, define the tasks:

| Root cause | Failures | Task | Specification |
|---|---|---|---|
| RC-1 | 17 | `TASK-001` | `SPEC-0004`, R2 |
| RC-2 | 1 | `TASK-002` | `SPEC-0004`, R2 |
| RC-3 | 2 | `TASK-003` | `SPEC-0004`, R2 |
| test-DB bootstrap | — | `TASK-004`, `TASK-005` | `SPEC-0004`, R2 |
| RC-4 | 4 | **none** | **blocked, R4** |

`SPEC-0004` consumes that identifier, so **the next pilot specification is
`SPEC-0005`**.

## No repair was applied

`SPEC-0004` is at `READY_FOR_APPROVAL` and the control plane refuses to
implement it: `SDD-V043` — *"Role IMPLEMENTER may not act while the
specification is READY_FOR_APPROVAL"* — on all five implementation tasks.
Advancing requires a gate 1 approval record, and `AGENTS.md` forbids an agent
writing one.

That is a tool-enforced stop, not a judgement call.
