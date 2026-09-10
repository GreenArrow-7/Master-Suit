# SPEC-0005 — Platform-independent capture-vault storage keys

## Metadata

| Field | Value |
|---|---|
| Specification ID | `SPEC-0005` |
| Status | `CONVERGED` |
| Risk | `R4` |
| Author | AI, Planner role |
| Date | 2026-09-08 |

## Problem

`pathFor()` in the capture-vault service composes the value written to
`HrAttendancePunch.capturePath` with `path.join`, which returns the **running
platform's** separator:

```js
return path.join(`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`);
```

The file documents the contract that value must satisfy:

> The return value is the same shape it always was —
> `t-x/emp-y/2026-08/punch-z.jpg.enc` — because it is written to
> `HrAttendancePunch.capturePath` and existing rows hold it.

On Windows it returns `t-x\emp-y\2026-08\punch-z.jpg.enc` instead.

### Why this is more than cosmetic

Captures live in object storage. The key is built by

```js
const objectKey = (relative) => PREFIX + relative.split(path.sep).join('/');
```

which normalises using the separator of the **running** host. So a value stored
by a Windows process is `t-x\emp-y\…`, while the object it wrote is at the
canonical key — because on that host `path.sep` was `\` and the normalisation
worked. Read the same row back **on a POSIX host** and `split('/')` is a no-op:
the key becomes `attendance/t-x\emp-y\…`, which addresses nothing.

**The failure is asymmetric.** A key written on POSIX is already canonical and
is read correctly anywhere. Only a **Windows-written key read on POSIX** breaks.

#### The harm, traced through the code

`lib/jobs/retention.ts:306-315` deletes an expired punch:

| Step | What happens with a backslash key on POSIX |
|---|---|
| 1 | `deleteCapture(row.capturePath)` |
| 2 | `deleteObjects([wrong key])` removes nothing, and does not throw |
| 3 | `path.resolve(root(), key)` yields **one filename**; the containment check passes; `unlink` fails `ENOENT` and is swallowed as "already purged" |
| 4 | `deleteCapture` **returns normally** |
| 5 | the punch row is deleted |

The row is gone. The encrypted biometric frame is still in the bucket, and
nothing points at it any more. **No error, no warning, no count** — the sweep
reports success.

That is the harm: not "a capture that cannot be read", but **an orphaned
biometric image whose only index has just been deleted, reported as a completed
deletion**. It is why this is `R4` rather than a formatting defect.

`loadCapture` fails more honestly — it throws, so a disputed punch shows an
error rather than a wrong picture.

### What is already correct

Read from source, not assumed. Only **one** of the seven path compositions in
the file is wrong:

| Line | Expression | Kind | Verdict |
|---|---|---|---|
| 55 | `path.resolve(env.ATTENDANCE_CAPTURE_DIR)` | filesystem root | correct |
| **83** | `path.join(...)` inside `pathFor` | **logical key** | **the defect** |
| 89 | `relative.split(path.sep).join('/')` | object key | correct today, redundant after the fix |
| 147, 187 | `path.resolve(root(), relative)` | filesystem boundary | correct |
| 148, 191 | containment check using `path.sep` | filesystem boundary | correct |
| 262 | `path.join(directory, entry.name)` | filesystem walk | correct |
| 290 | `path.join(root(), shard.name)` | filesystem walk | correct |

**`path.join` is not the problem. Using it to build a persisted identifier is.**

## Goal

A capture key identical on every platform, and a filesystem path derived from
it only where the filesystem is actually touched.

## Scope

The capture-vault service, its tests, and the traceability and evidence for
this change.

## Out of scope

**Any mutation of existing stored rows.** Whether deployed data contains
backslash keys is `UNKNOWN — requires runtime/infrastructure verification`, and
a historical-data rewrite is a separate change with separate authorisation
(`clarifications.md`, `CL-002`).

Also out of scope: `EVC-016`, `PC-01`, pilot #2, any schema change, and any
change to what is captured, encrypted or retained, or to who may read it.

## The two concepts this specification separates

### A — logical storage key

The persisted representation, written to `capturePath` and used to build the
object key.

- `FR-001` — Composed with a **canonical `/` separator on every platform**.
- `FR-002` — Deterministic: the same inputs give the same key on any host.
- `FR-003` — Never contains a backslash as a separator.
- `FR-004` — Never an absolute path, and never a host filesystem path.
- `FR-005` — Contains no `.` or `..` segment and no empty segment.
- `FR-006` — Preserves the tenant and employee shard order, so a tenant's
  captures remain one subtree.

### B — physical filesystem path

Derived from a logical key **only** where the filesystem is touched.

- `FR-007` — Derived at the I/O boundary, never stored.
- `FR-008` — May use the platform separator.
- `FR-009` — Never flows back into a persisted key.
- `FR-010` — Resolution is containment-checked: a path escaping the capture
  root is refused, as today.

### The invariant

| | Value |
|---|---|
| stored in the database | `t-x/emp-y/2026-08/punch-z.jpg.enc` |
| resolved on Linux | `…/t-x/emp-y/2026-08/punch-z.jpg.enc` |
| resolved on Windows | `…\t-x\emp-y\2026-08\punch-z.jpg.enc` |
| **stored value after either** | **unchanged** |

## Compatibility requirements

- `FR-011` — A key already stored with backslash separators is still resolvable
  for **read** and **delete**, so an existing capture does not become
  unreachable — and in particular does not become undeletable.
- `FR-012` — Backward-compatible reading normalises **only** for resolution. It
  must not rewrite the stored row.

## Non-functional requirements

- `NFR-001` — No schema change. `capturePath` is `String?`; verified by reading
  the Prisma schema.
- `NFR-002` — No new migration.
- `NFR-003` — No new dependency.
- `NFR-004` — No change to encryption, retention periods, or who may read a
  capture.
- `NFR-005` — No production or staging system is contacted by this work.

## Security requirements

- `SEC-001` — Normalisation must not create a traversal. A key containing `..`,
  an absolute path, a Windows drive letter or a UNC prefix is refused rather
  than resolved.
- `SEC-002` — The capture-root containment check remains, and remains effective
  against a mixed-separator key.
- `SEC-003` — Tenant and employee segments cannot be crossed by any separator
  or encoding trick.
- `SEC-004` — Backward-compatible reading must not become a way to reach a file
  outside the vault.
- `SEC-005` — No capture content, filename or biometric metadata is logged.

## Data and privacy requirements

- `DATA-001` — The data class is **biometric capture references**. No capture
  is read, moved, re-encrypted or deleted by this change.
- `DATA-002` — Existing rows are not rewritten. Any historical remediation is a
  separate authorised change.

## Observability requirements

- `OBS-001` — A refused key is counted, not printed. The reason may be logged;
  the key may not.

## Acceptance criteria

- `AC-001` — Given any platform, when a key is composed, then it uses `/` and
  is byte-identical across platforms.
- `AC-002` — Given a stored canonical key, when a capture is read or deleted,
  then the correct file is resolved.
- `AC-003` — Given a stored **backslash** key, when a capture is read or
  deleted, then it still resolves and the row is left unchanged.
- `AC-004` — Given a hostile key — `..`, absolute, drive letter, UNC, mixed
  separators — when resolution is attempted, then it is refused.
- `AC-005` — Given the retention sweep, when it runs, then it resolves the same
  captures it resolved before for canonical keys, and additionally resolves
  backslash keys.
- `AC-006` — Given the four failing tests, when the change lands, then they
  pass; and they fail against the current implementation.

## Assumptions

- `A-001` — `capturePath` is a plain string column. **`VERIFIED`** —
  `capturePath String?` in the Prisma schema, read 2026-09-08.
- `A-002` — Deployed rows may or may not contain backslashes.
  **`UNKNOWN — requires runtime/infrastructure verification`.**
- `A-003` — A backslash key can only be created by a **Windows-hosted writer**.
  **`VERIFIED` from source** — `pathFor` uses `path.join`, so on POSIX it
  already produces `/`.

### What `A-003` means for likelihood, stated plainly

If every process that has ever written a capture ran on Linux, **no bad row
exists and none can be created**, and this change is purely preventive. That is
the likely case for a containerised deployment, and this specification does not
pretend otherwise.

It is still worth fixing, for three reasons that do not depend on a bad row
existing today:

1. The code is wrong about what it is building — a persisted identifier is not
   a filesystem path — and the file's own docstring states the contract it
   breaks.
2. The failure mode is silent and legally consequential, so the cost of being
   wrong about the deployment history is high and the cost of the fix is one
   line.
3. Development and test now run on Windows. A capture written there and read by
   a Linux CI container reproduces it exactly.

**What is not claimed:** that any deployed capture is currently orphaned. That
is `CL-001`, and it is open.

## Risks

- Backward-compatible reading is the requirement most able to introduce a
  traversal if written carelessly. `SEC-001` and `SEC-004` exist for it, and the
  threat model treats it as the primary attack surface.
- If deployed rows do contain backslashes and `FR-011` were skipped, those
  captures would become unreachable — including undeletable, which turns a
  formatting defect into a retention-obligation failure.

## Rollback

Code-only. Reverting restores the previous composition. Rows written while the
change is live hold canonical keys, which the previous implementation resolves
correctly on POSIX, so a revert leaves no unreadable state there.

## Approval

**Gates 1, 2, 3 and 5: all APPROVED by a human, 2026-09-08.**

`R4` requires specification approval by **Product Owner *and* Solution
Architect**, architecture approval by the **Solution Architect**, a threat
model accepted by **Application Security**, and a **separate
implementation-readiness approval** before any code is written.

| Gate | Required role | Status |
|---|---|---|
| 1 — specification approval | Product Owner **and** Solution Architect | **APPROVED** 2026-09-08 |
| 2 — architecture approval | Solution Architect | **APPROVED** 2026-09-08 |
| 3 — security risk acceptance | Application Security | **APPROVED** 2026-09-08 |
| 5 — implementation readiness | **Solution Architect** — named by `EVC-018`, 2026-09-08 | **APPROVED** 2026-09-08 |

`EVC-018` identified **who** holds gate 5; it is not a decision on this
specification. All four gates remain outstanding.

No approval record exists and `approvals` in `sdd.json` is empty. **No code has
been written for this specification.**
