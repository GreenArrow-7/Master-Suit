# SPEC-0005 — Test plan

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Date | 2026-09-08 |
| State | **designed, not executed** — no code exists for this specification |

Designed against the requirements, not against an implementation, because none
has been written. Where a case exists today it is named and its **current**
outcome recorded, so a reader can tell a new assertion from an existing one.

## Test types

| Prefix | Meaning |
|---|---|
| `UT-` | unit — pure composition and normalisation |
| `IT-` | integration — vault against a fake bucket and a temporary directory |
| `ST-` | security — refusal and containment |
| `REG-` | regression — an existing case that fails today, or a behaviour that must not change |

## The four cases that exist and fail today

Run 2026-09-08, `npx vitest run tests/unit/capture-vault.spec.ts`:
**4 failed, 8 passed of 12.** These are not new tests, and they were not
written for this specification — they are the existing suite, already correct,
already failing against the defect.

| Id | Existing case | Current failure |
|---|---|---|
| `REG-001` | *storing a capture › returns the same relative path shape the punch column already holds* | expected `t-t1/emp-emp1/2026-08/punch-punch1.jpg.enc`, received the backslash form |
| `REG-002` | *reading a capture › still reads a capture written before the move, from the old directory* | `relative.split('/')[2]` is `undefined`, so `join` throws |
| `REG-003` | *retention › deletes what is past the window and keeps what is not* | `bucket.get('attendance/' + stale)` is `undefined` |
| `REG-004` | *retention › keeps an object the listing could not date* | same as `REG-003` |

`REG-003` and `REG-004` are the most informative of the four. The object **is**
in the bucket under the canonical key — `objectKey` normalised it on the way in
using this host's `path.sep` — while the value returned to the caller and
written to `capturePath` holds backslashes. The two disagree, and that
disagreement is the whole defect.

**Every one of these four must pass, and must be shown failing first.**
`AC-006` requires both directions.

## Case format

### UT-001 — canonical composition

**Requirement:** `FR-001`, `FR-002`, `FR-003`
**Given** a tenant, an employee, a punch and a date
**When** a key is composed
**Then** it is exactly `t-<tenant>/emp-<employee>/<yyyy-mm>/punch-<punch>.jpg.enc`
**And** it contains no backslash
**Platform:** must assert the same literal on both platforms. A test that
derives the expected value with `path.join` would pass on both and prove
nothing — that is precisely the mistake under repair.

### UT-002 — determinism

**Requirement:** `FR-002`
**Given** the same four inputs
**When** the key is composed twice
**Then** the two are byte-identical.

### UT-003 — shard order preserved

**Requirement:** `FR-006`
**Then** the first segment is the tenant shard and the second the employee
shard, so one workspace's captures remain one subtree.

### UT-004 — a key is never absolute

**Requirement:** `FR-004`
**Then** the composed key is relative, on either platform, and carries no drive
letter and no leading separator.

### UT-005 — normalisation is separator-only

**Requirement:** `FR-012`
**Given** `t-x\emp-y\2026-08\punch-z.jpg.enc`
**When** it is normalised for resolution
**Then** the result is the canonical form
**And** no other transformation is applied — no case folding, no collapsing,
no percent-decoding.

### UT-006 — normalisation does not resolve traversal

**Requirement:** `SEC-001`, `AD-004`, `AD-005`
**Given** `t-x\..\..\etc\passwd`
**Then** it is **refused**, not normalised into something that then passes a
later check.

### IT-001 — write, then read, on one host

**Requirement:** `FR-001`, `AC-002`
**Then** a capture stored and immediately read round-trips the exact bytes, and
the key written to the column is the canonical form.

### IT-002 — a backslash key still reads

**Requirement:** `FR-011`, `AC-003`
**Given** an object at the canonical key and a **stored value holding
backslashes** — the exact state a Windows writer leaves behind
**When** the capture is read
**Then** the correct object is returned
**And** the stored value is **unchanged** (`FR-012`, `DATA-002`).

### IT-003 — a backslash key still deletes

**Requirement:** `FR-011`, `AC-003`, `AC-005`
**Then** `deleteCapture` removes the object that key refers to.
**This is the case that matters most.** It is the difference between a capture
that is deleted and one that is orphaned when the punch row goes.

### IT-004 — the legacy on-disk vault still resolves

**Requirement:** `FR-007`, `FR-008`, `FR-010`
**Then** a capture present only in the legacy directory is still found, with
the filesystem path derived at the boundary and never stored.

### IT-005 — retention sweep unchanged for canonical keys

**Requirement:** `AC-005`
**Then** `purgeExpiredCaptures` removes and keeps exactly what it does today.
The sweep lists the bucket rather than reading `capturePath`, so it must be
proven **unaffected** — a change here would be a regression, not a fix.

### IT-006 — a refusal is not silence

**Requirement:** `FR-005`, `OBS-001`, `TH-001`, `TH-014`
**Given** a key that cannot be resolved
**When** a deletion is attempted
**Then** the caller can tell that nothing was deleted.

**Why this case exists.** Today `deleteCapture` swallows the object-store miss
and the filesystem `ENOENT`, returns normally, and the retention job then
deletes the row. The sweep reports success having deleted nothing, and the biometric
image is left in the bucket with its only index removed. Fixing the composition
without fixing the silence would leave that intact.

### ST-001 — traversal refused

**Requirement:** `SEC-001`, `SEC-004` · **Threats:** `TH-003`, `TH-005`
Each refused, and each asserted separately rather than in a loop, so a failure
names the form that got through:

| Form | Example |
|---|---|
| parent segment | `t-x/../../etc/passwd` |
| backslash parent | `t-x\..\..\windows\win.ini` |
| POSIX absolute | `/etc/passwd` |
| Windows absolute | `C:\Windows\win.ini` |
| drive-relative | `C:passwd` |
| UNC | `\\server\share\x` |
| current-directory segment | `t-x/./emp-y/...` |
| empty segment | `t-x//emp-y/...` |

### ST-002 — containment check still holds

**Requirement:** `SEC-002` · **Threat:** `TH-003`
**Then** the check at lines 148 and 191 still refuses a resolved path outside
the capture root, **and still refuses a mixed-separator key**. The check is not
replaced by this change; this proves it was not weakened by it.

### ST-003 — tenant crossover refused

**Requirement:** `SEC-003` · **Threat:** `TH-008`
**Given** a key attempting to reach another tenant's subtree, by `..`, by an
encoded separator, or by a mixed separator
**Then** it is refused.
Highest severity in the threat model, and the reason it is tested on its own
rather than folded into `ST-001`.

### ST-004 — double decoding cannot create a traversal

**Requirement:** `SEC-001` · **Threat:** `TH-009` · **Decision:** `AD-004`
**Given** `..%2f`, `%2e%2e%2f` and `%252e%252e%252f`
**Then** each is refused, and normalisation is not applied twice.
**This case pins the order** — normalise once, then validate. It fails if a
future edit reverses it.

### ST-005 — no key in a log line

**Requirement:** `SEC-005`, `OBS-001` · **Threat:** `TH-015`
**Then** a refusal logs the reason and not the key, because a key carries a
tenant id and an employee id.

### REG-005 — the six correct compositions are untouched

**Requirement:** `FR-007`, `FR-008`, `FR-009` · **Decision:** `AD-007`
**Then** lines 55, 147, 148, 187, 191, 262 and 290 still use platform path
semantics, and the legacy walk still works on both platforms.
A blanket replacement of `path.join` would break the filesystem walk; this is
what catches it.

### REG-006 — no row is rewritten

**Requirement:** `DATA-002`, `FR-012` · **Threat:** `TH-013`
**Then** after a read and after a delete of a backslash-keyed capture, the
`capturePath` value in the database is byte-identical to what it was.

## Coverage sections

| Section | Cases |
|---|---|
| Happy paths | `UT-001`–`UT-004`, `IT-001`, `IT-005` |
| Negative behaviour | `UT-006`, `ST-001` |
| Authorization | not applicable — no authorization behaviour changes |
| Tenant isolation | `UT-003`, `ST-003` |
| Failure paths | `IT-006` |
| Malformed input | `ST-001`, `ST-004` |
| Boundary conditions | `UT-005`, `ST-002` |
| Concurrency | not applicable — `pathFor` is pure and deterministic (`UT-002`) |
| Retries and idempotency | `UT-002`, `IT-003` |
| External dependency failure | `IT-006` — object store miss must not read as success |
| Regression coverage | `REG-001`–`REG-006` |

## Requirement coverage

| Requirement | Cases |
|---|---|
| `FR-001` | `UT-001`, `IT-001`, `REG-001` |
| `FR-002` | `UT-002` |
| `FR-003` | `UT-001` |
| `FR-004` | `UT-004`, `ST-001` |
| `FR-005` | `UT-006`, `ST-001`, `IT-006` |
| `FR-006` | `UT-003`, `ST-003` |
| `FR-007` | `IT-004`, `REG-005` |
| `FR-008` | `IT-004`, `REG-005` |
| `FR-009` | `REG-005`, `REG-006` |
| `FR-010` | `ST-002` |
| `FR-011` | `IT-002`, `IT-003`, `REG-002`, `REG-003`, `REG-004` |
| `FR-012` | `UT-005`, `REG-006` |
| `NFR-001` | no migration exists — asserted by `check:drift` |
| `NFR-002` | as `NFR-001` |
| `NFR-003` | dependency counts unchanged, asserted at verification |
| `NFR-004` | `IT-001`, `IT-005` |
| `NFR-005` | no test contacts a non-loopback host |
| `SEC-001` | `ST-001`, `ST-004`, `UT-006` |
| `SEC-002` | `ST-002` |
| `SEC-003` | `ST-003` |
| `SEC-004` | `ST-001`, `ST-004` |
| `SEC-005` | `ST-005` |
| `DATA-001` | no case reads, moves or re-encrypts a real capture |
| `DATA-002` | `REG-006` |
| `OBS-001` | `IT-006`, `ST-005` |

## Acceptance-criterion coverage

| Criterion | Verified by |
|---|---|
| `AC-001` | `UT-001`, `UT-002` |
| `AC-002` | `IT-001` |
| `AC-003` | `IT-002`, `IT-003`, `REG-006` |
| `AC-004` | `ST-001`, `ST-003`, `ST-004` |
| `AC-005` | `IT-003`, `IT-005`, `IT-006` |
| `AC-006` | `REG-001`–`REG-004`, each shown failing before and passing after |

## What this plan will not do

- **No test may be weakened, skipped or deleted to reach a pass.** The four
  existing failures are the specification's own evidence; making them pass by
  changing them would destroy it.
- **No test asserts against a deployed system.** `NFR-005`.
- **No test uses a real biometric capture.** Fixtures are synthetic bytes.
- **No test derives its expected key with `path.join`.** That is the defect
  under repair, and a test written that way passes on every platform while
  proving nothing.

## Execution record

**Not executed.** No implementation exists. The four `REG-` cases have been run
against the **current** code and fail, which is recorded above and is the
before-half of `AC-006`.
