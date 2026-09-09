# Agent session audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07
**Method:** inspect `tools/sdd/lib/agent.mjs`, the JSON schemas, and the
records produced by the command line.

## Record kinds

| Kind | Identifier | Schema |
|---|---|---|
| Execution session | `ASES-NNNN` | `docs/sdd/schemas/agent-session.schema.json` |
| Verification run | `VER-NNNN` | `docs/sdd/schemas/verification-record.schema.json` |
| Independent review | `REV-NNNN` | `docs/sdd/schemas/review-record.schema.json` |

All three live under `specs/SPEC-NNNN-.../execution/`, one record per file,
named for the identifier. `listRecords` classifies by a strict pattern per
kind, so a stray file cannot be read as a session.

## Field validation

`sessionProblems`, `verificationProblems` and `reviewProblems` each return a
list of specific reasons rather than a boolean. A malformed record therefore
produces a finding naming the field, not a generic parse failure.

Checked and confirmed present:

- `schemaVersion` must equal 1. An unsupported version is refused, not
  best-guessed.
- The identifier inside the record must match the file name. A record cannot
  claim to be a different record.
- Enumerated fields (`role`, `status`, `result`, `decision`, `reviewType`,
  `actorType`) are checked against explicit lists.
- `startedFromCommit` is required, which is what makes drift detection
  possible at all.

## Bounds on untrusted input

| Control | Value |
|---|---|
| Maximum record size | 128 KiB |
| Non-regular files | refused by `isPlainFile` |
| Non-object JSON | refused (`UT-146` covers `[]` and malformed input) |
| Unreadable file | reported, never treated as an empty record |

The last row is the one that matters for honesty: a record that cannot be read
produces a finding. It never silently becomes "no findings".

## Status is not completion

The session vocabulary keeps three claims apart, and `SDD-V057` enforces the
first boundary mechanically: `COMPLETE` is refused while a required test has no
recorded verification. `UT-127` exercises it by removing one verified test from
an otherwise complete session.

**Result:** session records are validated by field, bounded in size, and cannot
overstate their own status.
