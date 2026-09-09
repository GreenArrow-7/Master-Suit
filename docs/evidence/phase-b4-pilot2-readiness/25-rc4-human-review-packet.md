# RC-4 / SPEC-0005 — human code review packet

| Field | Value |
|---|---|
| Specification | `SPEC-0005` — platform-independent capture-vault storage keys |
| Risk | **R4** · Lifecycle `VERIFYING` |
| Gate | human code review — **2 reviewers, one security-literate** (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, R4 row) |
| Diff | **two files**, +190 / −11 |
| Base | `f16ed677516fb07f31832a5d725e13efb477c34d` |
| Date | 2026-09-08 |

**Two decisions are needed and neither can be an AI's.** `REV-0001` is an AI
security review: `actorType: "ai"`, `satisfiesHumanGate: false`. It is technical
evidence for you, not a substitute for you.

---

## The whole diff

| File | +/− | What |
|---|---|---|
| `apps/web/src/services/hr/captureVault.ts` | **+82 / −10** | the fix |
| `apps/web/tests/unit/capture-vault.spec.ts` | **+108 / −1** | 12 cases → 28 |

Nothing else. No schema, no migration, no dependency, no other source file.

## What changed, and why each piece exists

### 1. `pathFor` — the defect itself

```js
// before
return path.join(`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`);
// after
return [`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`].join('/');
```

This value is written to `HrAttendancePunch.capturePath`. `path.join` emitted
`\` on Windows, so a key composed on one host meant something different on
another.

### 2. `toLogicalKey` — backward compatibility

Converts `\` to `/` **for resolution only**. It does not resolve `..`, collapse
`//`, percent-decode, or write anything back. Rows written before this change
stay readable and — the point — stay **deletable**.

### 3. `assertSafeKey` — refusal

Refuses empty keys, POSIX absolute, Windows drive and drive-relative, UNC,
`..`, `.` and empty segments. **Normalise first, then validate** — the reverse
order is how `..\` slips past a check written for `../`.

### 4. `filesystemPathFor` — the single boundary

The one place a logical key becomes a filesystem path. The containment check at
both call sites is byte-identical to before.

### 5. `deleteCapture` — the deletion contract

`deleteObjects` no longer has a `.catch` returning `0`, and `unlink` rethrows
anything that is not `ENOENT`. An absent object still succeeds — that is the
outcome the caller asked for — but a store or filesystem that **refuses** now
propagates instead of reading as a completed cleanup.

## The questions worth your time

1. **Is the classification right?** Seven `path` compositions exist in this
   file. Six are physical-path composition and are untouched (lines 55,
   147/187, 148/191, 262, 290). Only `pathFor` composed a persisted identifier.
   `path.join` was deliberately **not** globally replaced — doing so would break
   the legacy filesystem walk.

2. **Can `toLogicalKey` be turned into a traversal?** It is the one place a
   database value is normalised before use, and it is the primary attack
   surface in the threat model. It converts separators and nothing else, and
   `assertSafeKey` runs after it, never before.

3. **Is the containment check still meaningful?** It is byte-identical, and it
   is now *unreachable* through the public API — a key that passes
   `assertSafeKey` cannot escape the root. That is defence in depth, and
   `REV-0001` records it as such rather than claiming it as an active control.

4. **Did the one changed assertion get weaker?** *"refuses to read outside the
   vault"* previously matched the containment check's message. A traversal key
   is now refused **earlier**, by a stricter guard, so the message differs. The
   expectation — a traversal key is refused — is unchanged and still enforced.
   The test carries a comment saying exactly this. **This is the single place a
   pre-existing assertion was modified; everything else was added.**

5. **Is the residual orphan risk acceptable?** See `CONV-003` below. This is
   the security-literate reviewer's question.

## Test evidence

| | Before | After |
|---|---|---|
| Capture-vault targeted | **4 failed · 8 passed** (12) | **28 passed** (28) |
| Product suite ×3 | 1914 · 4 failed · 2 skipped | **1933 passed · 0 failed · 2 skipped** (1935), three consecutive runs |

The 16 added cases: nine hostile-key forms asserted separately, three
percent-encoding forms, four deletion-contract cases, a legacy-key read, and a
no-key-material-in-the-refusal check.

The two skips are the Windows POSIX file-mode assertions; their Linux execution
**and pass** is proved in `23-suite-stability-and-posix-proof.md`.

## Confirmed unchanged

| Claim | Evidence |
|---|---|
| Prisma schema | `git status apps/web/prisma` → empty; `capturePath String?` |
| Migrations | none added; 66 unchanged |
| Encryption | AES-256-GCM, same HKDF derivation, same content type |
| Tenant isolation | shard order unchanged; no RLS or tenant-guard change |
| Retention periods | unchanged |
| Dependencies / lockfile | unchanged |
| Deployed data | untouched; no row rewritten, asserted by test |
| Other source files | none changed |

## Open findings you should see first

| Finding | Status | Summary |
|---|---|---|
| `CONV-001` | `OPEN` | **this review** |
| `CONV-002` | `OPEN` | convergence acceptance — AppSec **and** QA/Release |
| `CONV-003` | `OPEN` | residual orphan risk; needs AppSec to accept → `ACCEPTED_RISK` |
| `CONV-004` | `RESOLVED` | a declared scope deviation; **does not block this review** |

### CONV-003, stated plainly for the security reviewer

`deleteCapture` now surfaces a storage failure. `apps/web/src/lib/jobs/retention.ts`
still deletes the punch row in its `catch` block — so a permanently unreachable
object still ends with the row gone, **now with an error logged where there was
previously silence**.

**It violates no `SPEC-0005` requirement.** Checked against every `FR-`,
`SEC-`, `DATA-` and `OBS-` requirement and against `TASK-004`'s Definition of
Done, all of which it satisfies. `retention.ts` is a prohibited path for every
task in this specification, deliberately: changing when a data-destroying sweep
deletes a row is its own decision, carried as `CL-003`.

**What is being asked:** accept the residual risk, or direct that `CL-003` be
answered first.

### CONV-004, so it does not surprise you

`apps/web/tests/unit/capture-vault.spec.ts` was edited during `ASES-0001`,
whose task allows the source file only. `SDD-V046` caught it; the session is
marked `PARTIAL` and its notes record it; `TASK-005` owns the file. Both files
are inside `SPEC-0005`'s approved scope — one was edited under the wrong task's
session. The STOP condition is *scope expanding **without a change record***,
and there is a record. History is preserved, not rewritten.

## Reviewer 2 — where each named concern lives

So the security-literate reviewer can go straight to the code rather than hunt
for it. Every row is in `apps/web/src/services/hr/captureVault.ts` unless the
test column says otherwise.

| Concern | Where | Proved by |
|---|---|---|
| `toLogicalKey()` | separator conversion only — `stored.split('\\').join('/')` | `UT-005` |
| `assertSafeKey()` | the refusal set; runs **after** normalisation | `UT-006`, `ST-001` |
| `filesystemPathFor()` | the single logical→physical boundary | `IT-004`, `REG-005` |
| `deleteCapture()` | no `.catch` returning 0; `unlink` rethrows non-`ENOENT` | `IT-006`, deletion CASES 1–4 |
| legacy stored `\` keys | `toLogicalKey` at read and delete; row never rewritten | `IT-002`, `IT-003`, `REG-006` |
| canonical `/` keys | `pathFor` composes with `join('/')` | `UT-001`, `IT-001`, `REG-001` |
| traversal rejection | `..` segment check after normalisation | `ST-001` rows 1–2 |
| percent-encoded traversal | **not decoded**, so it cannot become one | `ST-004` — three forms incl. double-encoded |
| Windows absolute | `/^[A-Za-z]:/` | `ST-001` row 4 |
| drive-relative (`C:x`) | same test — catches both forms | `ST-001` row 5 |
| UNC | leading `//` after normalisation | `ST-001` row 6 |
| POSIX absolute | leading `/` | `ST-001` row 3 |
| root containment | check byte-identical at lines 148/191 | `ST-002` |
| tenant crossover | shard order + refusal before resolution | `ST-003` |
| storage deletion failure | propagates instead of reading as success | `IT-006`, deletion CASE 2 |
| **caller behaviour after a vault failure** | **not governed by `SPEC-0005`** | **`CONV-003` — your decision** |
| encrypted biometric retention | untouched — same cipher, key derivation, content type | `IT-001`, `IT-005` |

**The one row that is not a code question is the last-but-one.** Everything
above it is verifiable from the diff; `CONV-003` asks you to accept a residual
risk or refuse it.

## What is being asked for

**Two decisions, `APPROVE` / `REQUEST_CHANGES` / `BLOCKED`:**

| | Reviewer | Focus |
|---|---|---|
| 1 | any competent human reviewer | questions 1 and 4 — is the classification right, and did the assertion stay as strong |
| 2 | **security-literate** | questions 2, 3 and 5 — normalisation, containment, residual orphan risk |

Reviewer 1: ______   Reviewer 2 (security-literate): ______

This is the code review only. Convergence acceptance is gate 6, is recorded
separately, and needs Application Security **and** QA / Release Engineering.

**No approval may be recorded by an agent, and none has been.**
