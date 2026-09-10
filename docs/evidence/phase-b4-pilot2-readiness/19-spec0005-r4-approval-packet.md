# SPEC-0005 — R4 human approval packet

| Field | Value |
|---|---|
| Specification | `SPEC-0005` — platform-independent capture-vault storage keys |
| Risk | **`R4`** |
| Status | `READY_FOR_APPROVAL` |
| Author | AI agent, Planner role |
| Data class | **biometric capture references** |
| Date | 2026-09-08 |
| Code written | **none** |

**Three gates are unresolved and none of them is mine.** This packet is what a
human needs in order to decide. It records no approval, and no approval record
exists.

---

## 1. What is being asked for

| Gate | Required role at `R4` | Status |
|---|---|---|
| **1 — specification approval** | Product Owner **and** Solution Architect | **UNRESOLVED** |
| **2 — architecture approval** | Solution Architect (always at `R4`) | **UNRESOLVED** |
| **3 — security risk acceptance** | Application Security | **UNRESOLVED** |
| **5 — implementation readiness** | human, a *separate* permission to start writing code | **UNRESOLVED** |

Read from `docs/sdd/HUMAN_APPROVAL_GATES.md` and the `R4` column of
`docs/sdd/RISK_TO_PROCESS_MATRIX.md`. Gate 5 is additional to gate 1: at `R4`
specification approval alone does **not** authorise implementation.

Two clarifications are also open and material (§9). Neither blocks approval of
the specification; both block entry to `IMPLEMENTING`.

## 2. The defect, in one line of code

`apps/web/src/services/hr/captureVault.ts:83`

```js
return path.join(`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`);
```

`path.join` returns the **running platform's** separator. The value is written
to `HrAttendancePunch.capturePath`, and the file's own docstring states the
contract it breaks:

> The return value is the same shape it always was —
> `t-x/emp-y/2026-08/punch-z.jpg.enc` — because it is written to
> `HrAttendancePunch.capturePath` and existing rows hold it.

**`path.join` is not the problem. Using it to build a persisted identifier is.**

## 3. Why this is `R4` and not a formatting defect

The key is the only link between a database row and an encrypted biometric
image whose deletion is a legal obligation.

Traced through `apps/web/src/lib/jobs/retention.ts:306-315`, with a
Windows-written key on a POSIX host:

| Step | What happens |
|---|---|
| 1 | `deleteCapture(row.capturePath)` |
| 2 | the object key addresses nothing; nothing is deleted; nothing throws |
| 3 | the on-disk fallback's `ENOENT` is swallowed as "already purged" |
| 4 | `deleteCapture` **returns normally** |
| 5 | the punch row is deleted |

**An encrypted biometric image is left in the bucket with its only index
removed, and the sweep reports success.** The severity comes from the data
class and the silence, not from the size of the diff.

## 4. The honest counterweight

**A bad key can only be created by a Windows-hosted writer.** On POSIX,
`pathFor` already produces `/`. If every process that ever wrote a capture ran
on Linux — the likely case for a containerised deployment — **no bad row exists
and none can be created**, and this change is purely preventive.

That is stated here rather than buried, because a decision-maker who is told
only the worst case is being managed rather than informed.

It is still worth fixing:

1. The code is wrong about what it is building.
2. The failure is silent and legally consequential, so being wrong about the
   deployment history is expensive and the fix is one line.
3. Development and test now run on Windows; a capture written there and read by
   a Linux CI container reproduces it exactly.

**Not claimed:** that any deployed capture is currently orphaned. That is
`CL-001`, and it is open.

## 5. What is already correct — read, not assumed

Only **one** of the seven path compositions in the file is wrong:

| Line | Expression | Kind | Verdict |
|---|---|---|---|
| 55 | `path.resolve(env.ATTENDANCE_CAPTURE_DIR)` | filesystem root | correct |
| **83** | `path.join(...)` in `pathFor` | **logical key** | **the defect** |
| 89 | `relative.split(path.sep).join('/')` | object key | correct today, redundant after the fix |
| 147, 187 | `path.resolve(root(), relative)` | filesystem boundary | correct |
| 148, 191 | containment check using `path.sep` | filesystem boundary | correct |
| 262 | `path.join(directory, entry.name)` | filesystem walk | correct |
| 290 | `path.join(root(), shard.name)` | filesystem walk | correct |

`AD-007` records that the six correct uses are left alone. A blanket
replacement of `path.join` would break the legacy filesystem walk — a defect
introduced by a fix.

## 6. The proposed change

Separate two concepts that are one string today:

| | Produced by | Stored | Separator |
|---|---|---|---|
| logical storage key | `pathFor` | yes, in `capturePath` | always `/` |
| filesystem path | `path.resolve(root(), key)` | never | the host's |

With **backward-compatible reading first** (`FR-011`, `AD-003`): an existing
backslash key still resolves for read and delete, and the stored row is not
rewritten. Reversed, the change would make any existing backslash capture
unreachable — and *undeletable*, turning a formatting defect into a
retention-obligation failure.

## 7. What is explicitly out of scope

- **Any mutation of an existing row.** `DATA-002`. Not as a migration, not as
  a repair-on-read, not as a helper script. That is `CL-002`, and it needs its
  own authorisation.
- Any schema change or migration. `capturePath` is `String?` — verified by
  reading the Prisma schema — and stays so.
- Any change to what is captured, encrypted or retained, or to who may read it.
- Any change to `apps/web/src/lib/jobs/retention.ts`. It is a caller, and the
  point of fixing this at the vault is that callers do not change. The separate
  question of *when the retention sweep deletes a row* is flagged in `TASK-004`
  as a decision for a human, not something to slip in behind a path fix.
- `EVC-016`, `PC-01`, and pilot #2.

## 8. Threat model — for gate 3

Fifteen threats, `TH-001` to `TH-015`. The shape a security reviewer should
weigh:

| | Threat | Note |
|---|---|---|
| **Highest severity** | `TH-008` cross-tenant biometric exposure | least likely; `SEC-003`, tested on its own |
| **Most likely** | `TH-001` silent deletion failure, `TH-012` stale references | legal rather than confidentiality impact |
| **Introduced by the fix itself** | `TH-003`, `TH-009` traversal via normalisation | **the primary attack surface** |

**The database is treated as a trust boundary.** A stored key is data, not a
promise. Backward-compatible reading is the one place that takes a database
value and normalises it before use, so it is where a traversal would be
introduced if written carelessly. `AD-004` fixes the order — normalise once,
then validate, never the reverse — and `ST-004` pins it.

Three existing controls must be identical afterwards, listed so a reviewer can
check them rather than take the claim:

1. `path.resolve(root(), relative)` plus a containment check against `root()`
   — lines 147/148 and 187/191.
2. Ciphertext content type, so a browser never treats a capture as an image.
3. Tenant-first sharding, so one workspace's captures stay one subtree.

Residual risk is recorded in the threat model and is **not accepted** — only
Application Security may accept it.

## 9. Open clarifications

### `CL-001` — do any deployed rows contain a backslash key?

`UNKNOWN — requires runtime/infrastructure verification`. The local database
holds **0** rows, which proves nothing about a deployed environment.

A **count-only** query is prepared in
`18-capture-vault-deployed-data-assessment.md` and in `clarifications.md`, and
is deliberately **not executed**. It returns four integers and no key, no
identifier, no filename and no biometric metadata. DevOps / Production
Engineering would run it, with Application Security consulted.

### `CL-002` — if such rows exist, are they repaired?

Deliberately separated from the code fix:

| | Change | Authorisation |
|---|---|---|
| 1 | new writes are canonical; old keys still resolve | this specification, at its `R4` gates |
| 2 | existing rows containing `\` are rewritten | **its own explicit authorisation** |

Change 1 is safe whatever change 2 decides. Options: (a) compatibility only —
the strong preference; (b) compatibility now, migration later; (c) migrate
immediately — **argued against**, because it rewrites biometric references
before anyone has established that any exist.

## 10. Evidence that this is a real defect

Four existing tests in `apps/web/tests/unit/capture-vault.spec.ts` fail against
the current code. Run 2026-09-08: **4 failed, 8 passed of 12.**

| Case | Failure |
|---|---|
| *returns the same relative path shape the punch column already holds* | expected `t-t1/emp-emp1/2026-08/punch-punch1.jpg.enc` |
| *still reads a capture written before the move, from the old directory* | `relative.split('/')[2]` is `undefined` |
| *deletes what is past the window and keeps what is not* | `bucket.get('attendance/' + stale)` is `undefined` |
| *keeps an object the listing could not date* | same |

**These are not new tests written to justify a change.** They are the existing
suite, already correct, already failing. The last two are the most
informative: the object *is* in the bucket under the canonical key, while the
value handed back to the caller holds backslashes. The two disagree, and that
disagreement is the whole defect.

## 11. Artefacts to review

| Artefact | What it holds |
|---|---|
| `specs/SPEC-0005-capture-vault-storage-keys/spec.md` | 12 `FR-`, 5 `NFR-`, 5 `SEC-`, 2 `DATA-`, 1 `OBS-`, 6 `AC-` |
| `.../threat-model.md` | `TH-001` to `TH-015`, trust boundaries, controls that must not weaken |
| `.../clarifications.md` | `CL-R01`–`CL-R03` resolved; `CL-001`, `CL-002` open |
| `.../plan.md` | impact by area, `AD-001` to `AD-007`, five alternatives |
| `.../test-plan.md` | 6 `UT-`, 6 `IT-`, 5 `ST-`, 6 `REG-`; full requirement coverage |
| `.../tasks.md` | 6 tasks, **all `BLOCKED`**, with scope boundaries |
| `.../traceability.md` | 25 requirements mapped; Code and Result columns empty on purpose |

`node tools/sdd/cli.mjs validate --all` → **0 errors**, 7 pre-existing warnings
in `SPEC-0001` and `SPEC-0003`.

## 12. Why the tasks say `BLOCKED` and not `TODO`

`TODO` would mean the work is available to pick up. At `R4` no implementation
task may begin until gates 1, 2, 3 and 5 are discharged **and** `CL-001` and
`CL-002` are closed. `BLOCKED` is the accurate word.

## 13. What has deliberately not been done

- **No code written.** Not a draft, not a branch, not a stash.
- **No approval recorded.** `approvals` in `sdd.json` is an empty array.
- **No deployed system contacted.** No production, no staging, no deployed
  database, Redis or bucket.
- **No biometric file retrieved**, and no capture content or biometric metadata
  printed anywhere in this workstream.
- **`EVC-016` untouched** — not renamed, not broadened, not repurposed. It
  remains the historical `PC-01` PII-classification conflict and stays `OPEN`.
  `SPEC-0005` is a separately allocated identifier.
- **Authorship unchanged.** The author is an AI agent in the Planner role and
  is recorded as such. Authorship was not adopted or altered to make any gate
  appear satisfiable.

## 14. If approval is given

Execution order is `TASK-002` → `TASK-001` → `TASK-003` → `TASK-004` →
`TASK-005` → `TASK-006`. `TASK-002` is first even though it is numbered second:
compatibility must exist before composition changes, or a capture written by
the old code and read by the new becomes unreachable.

`R4` also requires **2 human code reviewers, one security-literate**, and
convergence acceptance by **Application Security for every security finding,
plus QA / Release Engineering**. None of that is discharged by approving this
packet.

## 15. If approval is refused, or deferred

The defect stays as it is. That is a defensible outcome given §4: if the
deployment has only ever run on Linux, no bad row exists.

What should **not** happen is the middle path — treating the fix as trivial
because the diff is small, and applying it without gate 3. The one line that
looks trivial sits between a database column and an encrypted biometric image,
and the change most able to go wrong is the compatibility path, not the
composition.

---

**Prepared by an agent. No gate is discharged by this document, and no agent
may discharge one.**
