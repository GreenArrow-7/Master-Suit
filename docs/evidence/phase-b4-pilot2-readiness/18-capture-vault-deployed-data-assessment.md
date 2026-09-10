# Capture vault — deployed-data assessment

| Field | Value |
|---|---|
| Answers | `SPEC-0005/CL-001` |
| State | **PREPARED — NOT EXECUTED** |
| Prepared by | AI agent |
| Executed by | **nobody, yet** |
| Date | 2026-09-08 |

> **Nothing in this document has been run.** No production system was
> contacted. No staging system was contacted. No deployed database, Redis
> instance or object bucket was queried, listed or connected to. No biometric
> file was retrieved, and no capture content or biometric metadata appears
> anywhere in this workstream.
>
> This is a script for a human to consider, refuse, amend or run under their
> own authorisation.

## The question

Does `HrAttendancePunch.capturePath` in any deployed environment hold a value
containing a backslash?

## Why it is worth asking at all

`pathFor` composes the stored key with `path.join`, which returns the running
platform's separator. A key written by a **Windows-hosted** process is
`t-x\emp-y\…`; the object itself is at the canonical key, because `objectKey`
normalised it on the way in using that host's `path.sep`.

Read that row back **on a POSIX host** and the two disagree. The consequence,
traced through `apps/web/src/lib/jobs/retention.ts:306-315`:

1. `deleteCapture` builds an object key that addresses nothing. Nothing is
   deleted, and nothing throws.
2. The legacy on-disk fallback fails `ENOENT`, which is swallowed as "already
   purged".
3. `deleteCapture` **returns normally**.
4. The punch row is deleted.

**Result: an encrypted biometric image left in the bucket with its only index
removed, reported as a successful deletion.**

## Why the honest expectation is zero

`pathFor` on POSIX already produces `/`. **A bad key can only be created by a
Windows-hosted writer.** For a containerised Linux deployment the expected
answer is **zero**, and this assessment most likely confirms that the fix is
purely preventive.

That is the expected outcome and it is stated up front rather than after the
fact. The reason to ask anyway is that the failure is silent, the data is
biometric, and the deletion obligation is legal — so "probably zero" is a
different thing from "zero".

## The query

Four integers. Nothing else.

```sql
SELECT
  count(*)                                                     AS with_path,
  count(*) FILTER (WHERE "capturePath" LIKE '%\\%')            AS backslash,
  count(*) FILTER (WHERE "capturePath" LIKE '%/%')             AS forward_slash,
  count(*) FILTER (WHERE "capturePath" ~ '^([A-Za-z]:|/|\\\\)') AS absolute_like
FROM "HrAttendancePunch"
WHERE "capturePath" IS NOT NULL;
```

### What it returns, and what it deliberately does not

| Returns | Does **not** return |
|---|---|
| four counts | any `capturePath` value |
| — | any employee id, punch id or tenant id |
| — | any filename |
| — | any capture, encrypted or otherwise |
| — | any biometric metadata |

It is `SELECT`-only. It writes nothing, locks nothing beyond a read, and
creates no temporary object. It is the least sensitive question that answers
`CL-001`.

### If, and only if, `backslash > 0`

A second query — **only** if the first returns a non-zero count, and **only**
under its own authorisation:

```sql
SELECT
  date_trunc('month', "occurredAt") AS month,
  count(*)                          AS rows
FROM "HrAttendancePunch"
WHERE "capturePath" LIKE '%\\%'
GROUP BY 1
ORDER BY 1;
```

Counts per month. It bounds *when* the affected writes happened, which is what
decides whether `CL-002` needs a remediation and roughly how large it is. It
still returns no key, no identifier and no capture.

**Do not run this one first.** If `backslash` is zero there is nothing to
bound, and running it anyway is a query against biometric records for no
purpose.

## Who may run it

| | Role | Why |
|---|---|---|
| **Runs it** | DevOps / Production Engineering | owns deployment, infrastructure and production access (`HUMAN_APPROVAL_GATES.md`, roles table) |
| **Consulted first** | Application Security | the table holds references to biometric data; gate 3 is theirs |

**No agent may run either query, in any environment, under any circumstance.**
`CLAUDE.md` prohibits all production activity, and `AGENTS.md` §4 prohibits an
agent from executing data operations against production.

## Handling the answer

Report **only the counts**. Four integers are the whole result. Nothing else
from either query should be pasted into a ticket, a chat message or an artefact
in this repository.

Record the outcome against `SPEC-0005/CL-001`:

| Result | Meaning | Effect on `SPEC-0005` |
|---|---|---|
| `backslash = 0` | no affected row exists | `FR-011` is preventive; `CL-002` resolves to option (a) — compatibility only, no migration |
| `backslash > 0` | affected rows exist | `FR-011` is load-bearing; `CL-002` becomes a real decision, and the second query bounds it |
| not run | unchanged | `CL-001` stays `OPEN`; `SPEC-0005` cannot enter `IMPLEMENTING` |

## What this assessment cannot tell you

**Whether any capture is already orphaned.** A row with a good key and a
missing object, or an object with no row, is not visible to either query — that
needs a bucket-versus-database reconciliation, which is a different exercise
with a different risk profile and is **not** prepared here.

`TH-012` in the threat model carries that gap explicitly as
`UNKNOWN — requires runtime/infrastructure verification`.

## Local evidence, for completeness

The local development database holds **0** `HrAttendancePunch` rows.

**That proves nothing about any deployed environment**, and is recorded only so
that nobody later mistakes it for having answered the question.
