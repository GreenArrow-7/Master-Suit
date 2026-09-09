# SPEC-0005 — Technical plan

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Status | `READY_FOR_APPROVAL` — no code written |
| Date | 2026-09-08 |

**Nothing in this plan has been implemented.** It describes what would be done
if gates 1, 3 and 5 were discharged and `CL-001`/`CL-002` closed.

## Affected architecture

One service module and its callers. No route, no schema, no queue, no
configuration, no dependency.

```
attendance.ts ──storeCapture──▶ captureVault.pathFor ──▶ capturePath (DB)
                                                            │
retention.ts ──deleteCapture───▶ captureVault.objectKey ◀────┤
face-activity ─loadCapture ────▶ captureVault.objectKey ◀────┘
```

The whole defect and the whole fix live between `pathFor` and `objectKey`.

## Existing patterns to reuse

- The containment check already written twice in this file (lines 148 and 191)
  is the model for `SEC-002`. It is **kept as it is**; nothing here replaces it.
- `AppError` helpers and the pino logger, per `docs/standards/`.
- The file's own convention of stating *why* in a comment, which is how the
  logical-key-versus-filesystem-path distinction should be recorded so the next
  reader does not reintroduce `path.join`.

## Files and components likely affected

| Path | Change |
|---|---|
| `apps/web/src/services/hr/captureVault.ts` | `pathFor` composes canonically; a normaliser for reads; `objectKey` simplified |
| `apps/web/tests/unit/capture-vault.spec.ts` | the four currently failing cases pass; new cases for compatibility and refusal |
| `specs/SPEC-0005-capture-vault-storage-keys/` | traceability, verification, convergence |

**No other file.** In particular the attendance service and the retention job
are callers, and both keep working unchanged — which is the test that the fix
sits at the right level.

## Data model impact

**None.** `capturePath` is `String?` and stays `String?`.

## API impact

**None.** No route reads or writes a capture key; the face-activity page
explicitly omits `capturePath` from what it selects.

## Frontend impact

**None.**

## Backend impact

Confined to the capture vault. Two concepts are separated where today there is
one string:

| | Produced by | Stored | Separator |
|---|---|---|---|
| logical storage key | `pathFor` | yes, in `capturePath` | always `/` |
| filesystem path | `path.resolve(root(), key)` | never | the host's |

## Integrations

Object storage only, and the key it receives is **unchanged** — `objectKey`
already emits `/` on both platforms. Nothing in the bucket moves.

## Authentication impact

**None.**

## Authorization impact

**None.** `loadCapture`'s docstring already states the caller must have checked
permissions; that contract is untouched.

## Tenant-isolation impact

The `t-<tenantId>` shard stays first and stays intact — `FR-006`. Isolation gets
**stronger**, not weaker: `SEC-001` refuses a key that could traverse out of a
tenant subtree, where today such a key would reach the containment check and
nothing earlier.

## Database and migration impact

**No migration.** No column, index, constraint or enum changes.

Existing rows are **not rewritten**. That is `DATA-002`, and it is the single
most important boundary in this plan: rewriting rows that reference biometric
captures is a different act, needing its own authorisation (`CL-002`).

## Compatibility

The ordering is deliberate and is the whole reason this is safe:

1. **Read compatibility first.** `FR-011` — an existing backslash key still
   resolves for read and delete.
2. **Then write canonically.** `FR-001`.
3. **Historical rewriting: never here.**

Reversed, step 2 without step 1 would leave any existing backslash capture
unreachable — and *undeletable*, which converts a formatting defect into a
retention-obligation failure.

## Dependencies

**None added.** `node:path` and `node:crypto` are already imported.

## Concurrency and idempotency

`pathFor` is pure. Composition is deterministic (`FR-002`), so a retry produces
the same key. `deleteCapture` is already idempotent for an absent object and
stays so.

## Error behaviour

A key that fails validation is **refused**, not repaired. `FR-005` and `TH-010`
both say so, and the reason is that repairing a malformed key guesses at which
file was meant — on biometric data, where a wrong guess deletes someone else's
evidence.

The refusal must be distinguishable from "absent", so a retention sweep cannot
swallow it the way it swallows `ENOENT` today. **That swallowing is the actual
harm** (`TH-001`), so leaving it in place would fix the composition and keep the
silence.

## Logging and observability

`OBS-001` — count refusals; log the reason, never the key. A key carries a
tenant id and an employee id, so it is not safe log content (`SEC-005`).

**A count is not an alert.** Alerting is out of scope and is named as residual
in the threat model rather than quietly implied.

## Security considerations

The primary attack surface is the backward-compatible read, because it is the
one place that takes a database value and normalises it before use. `SEC-001`
and `SEC-004` exist for exactly that, and the order in `AD-004` is the control.

## Test strategy

Four failing tests already exist and must pass. Around them: canonical
composition on both platform shapes, backward-compatible read of a backslash
key, refusal of every hostile key form, and a retention regression proving that
a sweep which cannot resolve a key does **not** report a successful deletion.

Full detail in `test-plan.md`.

## Deployment implications

**None.** No environment variable, no compose change, no worker change, no cache
or queue change, no ordering constraint against a migration. Code only.

## Rollback and reversibility

Revert the commit. Rows written while the change was live hold canonical keys,
which the previous implementation resolves correctly on POSIX — so a revert
leaves no unreadable state on the platform the system actually deploys to.

## Operational impact

None during deployment. Afterwards, a retention sweep that previously reported a
silent success on an unresolvable key reports a refusal instead. **That is a
behaviour change an operator may notice**, and it is the intended one: the count
going from zero to non-zero is the defect becoming visible, not the fix breaking
something.

## Risks

| Risk | Response |
|---|---|
| Normalisation introduces a traversal | `SEC-001`, `SEC-004`, `AD-004`'s ordering, and the unchanged containment check as a backstop |
| The compatibility path becomes a bypass | it normalises separators only — it never resolves `..`, and a key containing one is refused |
| The fix is applied at the wrong level | six of the seven `path` uses are correct and are left alone; a blanket replacement would be a second defect |
| Nobody knows whether bad rows exist | `CL-001` is open and blocking; `FR-011` makes the change safe either way |

## Alternatives considered

| Option | Verdict |
|---|---|
| **A — canonical composition plus compatible read** | **Chosen.** Smallest change that makes the invariant true and cannot orphan an existing capture |
| B — normalise only in `objectKey` | Rejected. Leaves the wrong value in the database, so every future reader inherits the problem |
| C — canonical composition, no compatible read | Rejected. Would make any existing backslash capture unreachable and undeletable |
| D — migrate rows now | Rejected here. Rewrites biometric references before anyone has established that any need it — `CL-002` |
| E — store an absolute path | Rejected. Couples the database to a host layout and breaks object storage entirely |

## Technical decisions

### AD-001 — A storage key is an identifier, not a path

`path.join` is correct for filesystem work and wrong for composing a persisted
identifier. The fix belongs at the composition site, not at every use site.

### AD-002 — `/` is the canonical separator

It is what the object store uses, what the file's docstring documents, and what
every row written on POSIX already holds.

### AD-003 — Backward-compatible read precedes canonical write

See *Compatibility*. This ordering is what makes the change safe while `CL-001`
is unanswered.

### AD-004 — Normalise once, then validate; never validate then normalise

Validating first lets `..%2f` or a double-encoded segment pass validation and
become a traversal when normalised afterwards (`TH-009`). The order is the
control, and a test pins it.

### AD-005 — Refuse malformed keys rather than repair them

Collapsing `//`, resolving `.` or stripping `..` changes which file is named. On
biometric data the safe answer to "this key is not well formed" is to stop.

### AD-006 — Existing rows are not rewritten by this change

`DATA-002`. Rewriting is a separate change with separate authorisation, and
`FR-011` means an un-rewritten row keeps working.

### AD-007 — The six correct `path` uses are left alone

Lines 55, 147, 148, 187, 191, 262 and 290 sit at genuine filesystem boundaries.
Replacing them would be a defect introduced by a fix, which is worse than the
defect being fixed.
