# SPEC-0005 — Clarifications

| Field | Value |
|---|---|
| Specification | `SPEC-0005` |
| Risk | `R4` |
| Date | 2026-09-08 |

Two questions cannot be settled from the repository. Both are recorded rather
than guessed, and both are material to `R4` approval.

---

## Resolved from repository evidence

### CL-R01 — Does the fix need a schema change or a migration?

**No.** `capturePath` is declared `String?` in the Prisma schema. A canonical
key is the same length and character class as the value already stored, so
nothing about the column changes.

**Status:** `INCORPORATED` · **Affects:** `NFR-001`, `NFR-002`

### CL-R02 — Should every `path.join` in the file be replaced?

**No, and doing so would be a defect.** Seven path compositions were read; six
are at a genuine filesystem boundary and are correct. Only `pathFor` composes a
value that is persisted.

**Status:** `INCORPORATED` · **Affects:** `FR-007`, `FR-008`, `FR-009`

### CL-R03 — Does the object-key normalisation already protect storage?

**Partly, and only by accident of platform.** `objectKey` normalises using
`path.sep` of the **running** host, so a backslash key written on Windows and
read on Linux is not repaired. After `FR-001` the normalisation becomes
redundant rather than wrong, and is kept as a cheap invariant.

**Status:** `INCORPORATED` · **Affects:** `FR-011`

---

## Open — cannot be answered without authorisation

### CL-001 — Do any deployed rows already contain a backslash key?

**Question:** does `HrAttendancePunch.capturePath` in any deployed environment
hold a value containing `\`?

**Why it matters.** It decides whether `FR-011` is a safeguard or a repair, and
whether a historical-data remediation is needed at all. If the answer is zero,
write-forward normalisation alone is sufficient.

**What is known.** The local development database holds **0** rows, which
proves nothing about a deployed environment. No production or staging system
was contacted, and none may be.

**Current answer:** `UNKNOWN — requires runtime/infrastructure verification`.

**How it would be answered** — prepared, deliberately **not executed**:

```sql
SELECT
  count(*)                                              AS with_path,
  count(*) FILTER (WHERE "capturePath" LIKE '%\\%')     AS backslash,
  count(*) FILTER (WHERE "capturePath" LIKE '%/%')      AS forward_slash,
  count(*) FILTER (WHERE "capturePath" ~ '^([A-Za-z]:|/|\\\\)') AS absolute_like
FROM "HrAttendancePunch"
WHERE "capturePath" IS NOT NULL;
```

**Counts only.** It returns four integers. It retrieves no capture, no
filename, no employee identifier and no biometric metadata — the least
sensitive evidence that answers the question.

**Authorising role:** **DevOps / Production Engineering** to run it, with
**Application Security** consulted, since the table holds biometric references.

**Decision owner:** Application Security · **Status:** `DEFERRED`

### Why deferring is safe, and what it still gates

**The gate-1 and gate-3 approvals of 2026-09-08 make this question
non-blocking for implementation, and only for implementation.**

`FR-011` requires a stored backslash key to remain resolvable for read and
delete, and `FR-012` requires that resolution never rewrite the row. So the
implementation is correct whether the deployed count is zero or not: with zero
it is preventive, with more than zero it is a repair, and the code is identical
either way. Nothing in the change branches on the answer.

**What it still gates:** any historical-data remediation — `CL-002` options (b)
and (c) — which the gate-1 approval explicitly does **not** authorise. The
count-only assessment stays prepared and unexecuted in
`docs/evidence/phase-b4-pilot2-readiness/18-capture-vault-deployed-data-assessment.md`.

The deployed state remains
`UNKNOWN — requires runtime/infrastructure verification`, as the gate-3
approval also records.

### CL-002 — If backslash rows exist, are they repaired?

**Question:** should existing rows be rewritten to canonical form?

**Why it matters.** Rewriting rows that reference biometric captures is a data
migration on sensitive records. It is a different act from changing how new
keys are written, and it carries its own rollback and audit obligations.

**The two are deliberately separated:**

| | Change | Authorisation |
|---|---|---|
| 1 | New writes produce canonical keys; old keys still resolve | this specification, at its `R4` gates |
| 2 | Existing rows containing `\` are rewritten | **its own explicit authorisation** |

**Change 1 is safe whatever change 2 decides**, which is the point of
sequencing them this way. `FR-011` means an un-repaired row keeps working, so
change 2 is an optional tidy-up rather than a prerequisite.

**Options:** (a) compatibility only, no migration — the strong preference;
(b) compatibility now, migration later under separate authorisation;
(c) migrate immediately.

**Against (c):** it rewrites biometric references before anyone has established
that any exist, and a migration that touches rows the fix already handles adds
risk without adding capability. **Files may also need relocating** if a
backslash key was ever used as a literal filename — which is itself unknown.

**Decision owner:** Application Security, with DevOps / Production Engineering
· **Status:** `ANSWERED` — **option (a), compatibility only, no migration**

### The answer, and where it comes from

The gate-1 approval of 2026-09-08 states the approved intended behaviour
includes *"no automatic deployed historical-data rewrite"* and *"legacy capture
keys are handled safely where technically feasible"*. The gate-3 approval
records the deployed state as still
`UNKNOWN — requires runtime/infrastructure verification`.

Together those are option **(a)**: implement backward-compatible reading, leave
every existing row exactly as it is. That was the strong preference recorded
here before the approvals, and it is what was approved.

**Options (b) and (c) are not authorised.** Any rewrite or relocation of
historical rows keeps its own separate authorisation and its own rollback plan,
and `CL-001` must be answered before either could be considered.

### CL-003 — should a failed object deletion stop the punch row being deleted?

**Raised during implementation, 2026-09-08.** The one material behaviour
`SPEC-0005` does not settle.

**What changed.** `deleteCapture` no longer swallows a storage failure. An
absent object still succeeds — that is the outcome the caller asked for — but a
bucket or filesystem that *refuses* now propagates instead of reading as a
completed cleanup.

**What did not change.** `apps/web/src/lib/jobs/retention.ts:306-315` catches
that rejection, logs `retention: could not delete capture object`, and **still
deletes the punch row**. So the sequence is now *logged* rather than silent —
a real improvement — but the row still goes.

| | Before | Now | If `CL-003` says the row must survive |
|---|---|---|---|
| store refuses | silent, nothing logged | **error logged**, row still deleted | row kept, retried next sweep |

**Why it is not decided here.** `apps/web/src/lib/jobs/retention.ts` is a prohibited path for
`TASK-004`, deliberately: changing *when a data-destroying sweep deletes a row*
is a different decision from fixing how a key is composed, and it deserves to
be made on its own terms rather than inherited from a path-formatting fix.

**The question:** when `deleteCapture` fails because the store could not be
reached, should the retention sweep leave the punch row in place for the next
run, or continue to delete it and rely on the logged error?

**Against keeping the row:** a permanently unreachable object would block that
row forever, and the sweep would re-attempt it on every run.
**For keeping it:** deleting the row is what orphans the capture, and an
orphaned biometric image is the harm this whole specification exists to
prevent.

**Decision owner:** Product Owner with Application Security ·
**Status:** `DEFERRED`

**Deferred, with the reason stated.** It is not open-and-blocking: this
specification's approved scope ends at the capture vault, and
`apps/web/src/lib/jobs/retention.ts` is a prohibited path for every task in it.
The change delivered here is complete and correct without the answer — the
failure is now visible where it was previously silent, which is what
`SPEC-0005` set out to achieve.

Answering it changes a *different* file under a *different* authorisation, and
carrying it as blocking here would stall a finished change on a question it was
never scoped to settle.

---

## Effect on readiness

Both are **material**. `CL-001` determines whether `FR-011` is precautionary or
load-bearing; `CL-002` determines whether a second change exists at all.

`docs/sdd/SPEC_LIFECYCLE.md` requires material open questions to be closed
before implementation. **They do not block specification, planning, threat
modelling or test design**, which is why this specification is complete to
`READY_FOR_APPROVAL` — and they do block entry to `IMPLEMENTING`.
