# Historical malformed scope declarations — classification

| Field | Value |
|---|---|
| Raised by | `SDD-V064`, added under `SPEC-0002/CHG-008` / `TASK-020` |
| Date | 2026-09-08 |
| Scanned | 39 tasks across 3 specifications |
| Flagged | **5 tasks, 7 findings** |
| Rewritten | **none** |

`SDD-V062` refuses a malformed scope declaration at preflight, so none of these
can authorise new work. `SDD-V064` reports them repository-wide so they are
visible rather than found one session at a time.

**No historical task record was rewritten to make the validator green.** Each
is classified below against the four categories.

---

## Classification

| Task | Declaration | Class |
|---|---|---|
| `SPEC-0001/TASK-008` | `` `tools/sdd/tests/**` `` — a glob | **HISTORICAL RECORD** |
| `SPEC-0001/TASK-010` | `` `docs/sdd/{IDENTIFIER_STANDARD,…}.md` `` — brace expansion | **HISTORICAL RECORD** |
| `SPEC-0001/TASK-011` | "evidence package only." — wholly prose | **HISTORICAL RECORD** |
| `SPEC-0001/TASK-012` | prose citing `` `CHG-001` `` | **HISTORICAL RECORD** |
| `SPEC-0003/TASK-003` | prose plus `` `tablesearch-a11y` ``; prose prohibition | **HISTORICAL RECORD** |

**None is an `ACTIVE GOVERNANCE DEFECT`**, on one specific ground: every one of
these tasks is `DONE`, and `SDD-V062` now blocks preflight on any of them. The
defect cannot authorise work. **If any of these tasks is ever reopened, the
declaration must be corrected first** — that is the condition attached to this
classification, and preflight enforces it automatically.

**None is `OBSOLETE`.** Each task really was executed and its record is live
evidence of what was authorised.

**None `REQUIRES CORRECTION`** — see the reasoning below, which is the part
most worth disagreeing with.

---

## Why not `REQUIRES CORRECTION`

The tempting answer is to fix all five: they are only a few lines. It was
rejected for a reason that applies to each differently.

### `SPEC-0001/TASK-008` — `tools/sdd/tests/**`

A glob, which `CL-002` forbids. Because the parser matched exactly and no
directory called `**` exists, the effective allowed set was **empty**, and the
session that delivered the test suite was measured against nothing.

Correcting it now to `tools/sdd/tests/` would state, retroactively, a boundary
that was never actually enforced. The honest record is that this task ran
without an effective scope, and that is worth being able to see.

### `SPEC-0001/TASK-010` — brace expansion

Same class. The declaration reads as one token, matches nothing, and the
session was effectively unbounded.

### `SPEC-0001/TASK-011` — "evidence package only."

No backticks at all, so no allowed path was ever parsed. Rewriting it would
invent a boundary retrospectively.

### `SPEC-0001/TASK-012` — prose citing `CHG-001`

**The one that was actively wrong rather than merely empty.** The parser
returned `CHG-001` — an identifier — as an *allowed path*. It is now excluded,
so the effective scope has changed **without the record being edited**, which
is exactly the desired behaviour: the declaration stands as written and the
tooling reads it correctly.

### `SPEC-0003/TASK-003` — the pilot's own case

`DONE`, and its session `ASES-0002` recorded
`allowedPaths: ['apps/web/tests/e2e/', 'tablesearch-a11y']` at creation.
Rewriting the task now would put the task and the session record that measured
it out of step.

The effective boundary was correct throughout — the real path
`apps/web/tests/e2e/` was always the first entry, and the session changed
exactly one file inside it. The prose prohibition ("the Playwright and Vitest
configuration files") never entered the prohibited list, but those files were
not touched either.

---

## Why no validation exception was raised

`docs/sdd/VALIDATION_EXCEPTIONS.md` exists for precisely this situation, and it
was deliberately not used.

An approved exception downgrades a finding to `INFO` with an
`EXCEPTED under EXC-NNN` prefix. For these five that would be **worse**: a
standing `WARNING` on every `validate --all` is more visible than an `INFO`,
and there is no expiry to review because nothing here is expected to change.

`SDD-V064` was given `WARNING` severity for the same reason. Making it `ERROR`
would have forced one of the two bad outcomes — rewrite history, or hide it
behind an exception. A permanent, visible warning is the honest third option.

**Nothing is suppressed.** All seven findings appear on every run.

---

## Condition attached

If any of these five tasks is reopened for further work, its scope declaration
must be corrected **before** the session is created. `SDD-V062` enforces this
without anyone having to remember it: preflight fails, and `create-session`
refuses to write a record.

That is the whole reason the preflight rule is an `ERROR` and the
repository-wide rule is a `WARNING`.
