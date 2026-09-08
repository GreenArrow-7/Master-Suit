# RC-4 — biometric capture path separator — R4 decision packet

| Field | Value |
|---|---|
| Failures | 4, in `apps/web/tests/unit/capture-vault.spec.ts` |
| Risk class | **R4** — not remediated, not downgraded |
| Status | **BLOCKED at a required human gate** |
| Date | 2026-09-08 |
| Roles | **Application Security** and **Solution Architect** |
| Governance ID | see *Identifier allocation* |

The only cluster of the original 24 that is a **product** defect. Everything
else was remediated under `SPEC-0004`; this was deliberately excluded from that
approval and is not fixed here.

---

## Exact defect

**Affected function:** `pathFor()` in
`apps/web/src/services/hr/captureVault.ts`

```js
return path.join(`t-${tenantId}`, `emp-${employeeId}`, month, `punch-${punchId}${SUFFIX}`);
```

**Affected database field:** `HrAttendancePunch.capturePath`

**Documented contract**, from the file's own comment:

> The return value is the same shape it always was —
> `t-x/emp-y/2026-08/punch-z.jpg.enc` — because it is written to
> `HrAttendancePunch.capturePath` and existing rows hold it.

**Current behaviour on Windows:** `path.join` returns the platform separator, so
the stored value is `t-x\emp-y\2026-08\punch-z.jpg.enc`.

**Expected cross-platform behaviour:** the persisted value is a **logical
storage key** and must be identical on every platform.

**The four tests:** all in `capture-vault.spec.ts` — *"returns the same relative
path shape the punch column already holds"*, *"still reads a capture written
before the move, from the old directory"*, *"deletes what is past the window and
keeps what is not"*, *"keeps an object the listing could not date"*. Observed:

```
expected 't-t1\emp-emp1\2026-08\punch-punch1.jp…'
      to be 't-t1/emp-emp1/2026-08/punch-punch1.jp…'
```

**They are asserting the documented contract and are correct.**

## Why the S3 normalisation does not save it

```js
const objectKey = (relative) => PREFIX + relative.split(path.sep).join('/');
```

This normalises on the way out, using the **running** platform's separator. A
row written on Windows stores backslashes; a Linux process later reading that
row splits on `/`, finds nothing, and passes the backslash string through
unchanged. Normalisation on write does not repair what was already persisted
wrong.

## Retention and deletion consequence

`pathFor` also feeds the retention walk — `retentionCutoff`, `walk`, and the
per-tenant subtree the file describes as *"what a deletion request under PDPL
actually needs to be able to act on"*.

**A key that does not match the expected shape is a biometric capture that a
deletion sweep may not find.** That is the consequence that makes this R4 rather
than a formatting nit: the data is biometric, and the obligation is deletion.

## Biometric sensitivity

`docs/security/SECURITY_MODEL.md` classifies biometric templates and images as
a sensitive data category in their own right, separate from ordinary PII.
`docs/RISK_CLASSIFICATION.md` places **PII/biometric handling** and **retention
periods** at R4 — this touches both.

## Existing stored-path compatibility — measured, not assumed

Queried on the **local development database only**:

| Metric | Value |
|---|---|
| `HrAttendancePunch` rows | **0** |
| rows with a `capturePath` | **0** |
| rows whose `capturePath` contains `\` | **0** |

**This says nothing about any deployed environment.** No production or staging
database was contacted, and none may be. Whether deployed rows contain
backslashes is:

> **UNKNOWN — requires a read against an environment this workstream may not
> access.**

It is knowable with one read-only query, which a human with access can run:

```sql
SELECT count(*) FROM "HrAttendancePunch" WHERE "capturePath" LIKE '%\\%';
```

**If that returns anything above zero, do not silently rewrite the values.**
New-write normalisation and historical-data remediation are separate changes
with separate authorisation:

| | Change | Authorisation |
|---|---|---|
| **1** | New writes produce a canonical `/` key | this R4 gate |
| **2** | Existing rows containing `\` are repaired | **its own explicit authorisation** — a data migration touching biometric records |

Change 1 is safe whatever change 2 decides. Change 2 must not be bundled into
it.

## Proposed smallest fix — not to be implemented without approval

The technical invariant worth evaluating: **a persisted capture key is a
logical storage key, not an OS filesystem path.** Logical keys are
platform-independent and use `/`; translation to a local filesystem path
happens only at the filesystem boundary.

So the change is *not* a blanket replacement of `path.join`. It is a deliberate
separation:

| Composition | Today | Should be |
|---|---|---|
| **logical storage key** — `pathFor()`, written to `capturePath` | `path.join` | `/`, always |
| **physical filesystem path** — `walk()`, `join(directory, entry.name)` | `path.join` | **unchanged** — it is a real filesystem path |

Roughly one line in `pathFor`. The four existing tests already prove it.

## Security and privacy impact

The fix itself neither widens nor narrows access: it changes no authorisation,
no retention period, no encryption, and no data collected. Its security value is
that it makes retention and deletion able to find what they are meant to find.

The risk lies in the *data* question, not the code change — which is why
change 2 is separated out.

## Rollback

Change 1 is code-only and revertible by reverting the function. Rows written
between deploy and revert would carry canonical keys, which is the desired
shape, so a revert leaves no broken state.

## Regression test plan

The four existing tests are the regression, and they already fail today. Add
one asserting `pathFor` output contains no `\` on any platform, so this cannot
regress silently on a POSIX-only CI that would never have caught it.

## Identifier allocation

**`EVC-016` is untouched.** It concerns the historical `PC-01` PII
classification question and has not been renamed, broadened, repurposed, or
altered in any way. RC-4 is a **new defect** and does not reuse it.

`SPEC-0004` is consumed by the test-determinism remediation. RC-4 governance
therefore takes **`SPEC-0005`**, and the eventual pilot #2 product
specification takes the next free identifier after that — **`SPEC-0006`**. No
number is reserved in advance.

## What is being asked

| | Option | Consequence |
|---|---|---|
| **A** | Confirm **R4** and authorise remediation through the R4 process | Threat model, security test proving the boundary, Application Security review, recorded human plan approval, then the change |
| **B** | Re-classify | Would need an explicit argument that biometric storage-key construction is not "PII/biometric handling"; the same function feeds retention, which is separately R4 |
| **C** | Accept as a known limitation | Only defensible if no deployment ever writes captures from a non-POSIX host, which is an assumption about every future operator |

Separately, and either way: **run the read-only query above** and decide
whether change 2 is needed.

**No option is selected here.**

## Update — 2026-09-08

`SPEC-0005` now exists as a complete `R4` artefact set: specification, threat
model (`TH-001` to `TH-015`), clarifications, plan, test plan, tasks and
traceability. **No code has been written and no gate has been discharged.**

Creating the specification does not select an option above and does not presume
approval. Gates 1, 2, 3 and 5 are all `UNRESOLVED`, every task is `BLOCKED`
rather than `TODO`, and two material clarifications are open. Option **A** is
what the artefact set makes it possible to take; **B** and **C** remain
available and are unaffected.

Two things this packet said have since been made more precise by reading the
code rather than reasoning about it:

1. **The failure is asymmetric.** A key written on POSIX is already canonical
   and reads correctly anywhere. Only a **Windows-written key read on POSIX**
   breaks — so for a Linux-only deployment history the expected number of
   affected rows is zero, and the change is preventive.
2. **The harm is worse than "cannot read".** Traced through
   `apps/web/src/lib/jobs/retention.ts:306-315`, `deleteCapture` returns
   normally having deleted nothing, and the punch row is then deleted — leaving
   an encrypted biometric image in the bucket with its only index removed, and
   reporting success.

The decision packet is `19-spec0005-r4-approval-packet.md`. The prepared,
unexecuted assessment is `18-capture-vault-deployed-data-assessment.md`.
