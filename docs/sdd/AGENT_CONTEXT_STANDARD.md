# Agent Context Standard

`NORMATIVE — engineering process requirement.` Introduced by Phase B3
(`SPEC-0002`).

The objective is **context quality, not context volume**. An agent that loads
the whole repository has not prepared; it has diluted. The signal it needs
competes with a hundred documents that do not apply, and the failure mode is
confident work built on a document that governs something else.

## Always load

| Artefact | Why |
|---|---|
| `AGENTS.md` | The constitution. Nothing overrides it |
| `CLAUDE.md` | How to operate in this repository |
| The owning `sdd.json` | Risk, lifecycle state, approvals |
| The owning `spec.md` | The requirements being served |
| The task being executed | Scope, required tests, linkage |

That is the floor for any material change, and it is small.

## Then load what the task actually touches

- The plan sections relevant to this task, not the whole plan.
- The threat model, when the task touches a `SEC-` requirement or a control.
- The test plan entries for the required tests.
- The architecture or security document covering the area, from the "Where to
  look" table in `AGENTS.md`.
- The source files in the task's declared scope, **and every caller of the
  symbols being changed**. `AGENTS.md` §1 requires this, and it is the one
  expansion that is never optional.

## Do not load

- Other specifications, unless a qualified `SPEC-NNNN/…` reference points into
  one.
- Documentation for unrelated subsystems.
- The full `docs/` tree, the full evidence packages, or historical phase
  records, unless the task is about them.
- Anything under `.env`. Never, for any reason.

## Why this is a control, not advice

Three failure modes it prevents:

**Stale-document capture.** Parts of `docs/` predate the current code.
`docs/EVIDENCE_CONFLICTS.md` records fourteen places where sources disagree.
An agent that loads everything is more likely, not less, to act on the wrong
one.

**Scope drift by suggestion.** Reading an unrelated module's code makes
improving it feel in scope. It is not.

**Diluted attention.** The caller list that would have caught a regression is
easier to miss inside two hundred thousand tokens of context than inside two
thousand.

## When more context is genuinely needed

Widen deliberately and say so. Record it in the execution record's *new
unknowns* field: what was missing, what was loaded to resolve it, and whether
the task's assumptions survived. If the answer changes the task's scope, that
is a change record, not a wider read.

## Authority / References

- `AGENTS.md` §1, and its "Where to look" table
- `CLAUDE.md` — read only the documentation the task needs
- `docs/sdd/AGENT_HANDOFF_STANDARD.md`, `AGENT_EXECUTION_RECORD.md`
- `docs/EVIDENCE_CONFLICTS.md`
