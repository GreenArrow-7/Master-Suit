# Architecture review pack — `D3`

**Prepared for:** Solution Architect · **Gate:** 2 (architecture approval)
**Date:** 2026-09-07 · **Prepared by:** AI

**This is not an approval and does not become one by being read.** It
assembles what gate 2 needs, states what is being asked, and surfaces what
argues against approval. The decision is the Solution Architect's.

## What is being asked

Does the agent control-plane pattern fit the system? Gate 2 applies at R3
because a new pattern is introduced: the agent execution record.

## The pattern

```text
specification (spec.md, authority for intent)
      ↓
agent role model (7 roles × permitted lifecycle states)
      ↓
preflight  ── refuses → nothing is written, no override exists
      ↓
agent session (ASES-NNNN, control artefact)
      ↓
bounded task (declared allowed + prohibited paths)
      ↓
scope enforcement (session-introduced delta, by content digest)
      ↓
verification record (VER-NNNN, tests and exit codes only)
      ↓
independent review (REV-NNNN, distinct actor)
      ↓
convergence (human accepts from R3 up)
```

## Assessment against the review criteria

| # | Criterion | Assessment |
|---|---|---|
| 1 | Is `tools/sdd/` an appropriate boundary? | **Yes.** Zero imports from `apps/web/src` into `tools/sdd`, and zero the other way. Verified by search, both directions |
| 2 | Is agent control separate from application runtime? | **Yes.** Nothing here ships. No runtime dependency, no database client, no network client |
| 3 | Are specification authority and machine metadata separated? | **Yes.** `spec.md` holds intent; `sdd.json` holds process metadata and is forbidden from carrying requirements. `ARTIFACT_AUTHORITY.md` states the order; `SDD-V0xx` enforce the split |
| 4 | Is the control plane deterministic? | **Yes.** No `Math.random`, no `Date.now`, no `process.env` read anywhere in `lib/`, `cli.mjs` or `rules/`. Same inputs, same findings |
| 5 | Does the design create unnecessary complexity? | **Mostly no**, with one concern — see *Concerns* below |
| 6 | Is path and scope enforcement robust? | **Reasonably.** Exact paths and directory prefixes only, no globs; absolute paths, drive letters, traversal segments, null bytes and escaping symlinks all refused; separator-normalised. Fails closed on an empty scope |
| 7 | Is session attribution safe? | **Sound in logic, weak in trust** — see *Concerns* |
| 8 | Does future extension stay maintainable? | **Qualified yes** — see *Concerns* |
| 9 | Is machine enforcement confused with human judgement? | **No, and this is the design's strongest property.** Three claims are kept structurally apart: scope executed (agent), tests passed (verification record), accepted (human). `SDD-V053` refuses an AI on a human gate; `SDD-V057` refuses `COMPLETE` without verification. The word "accepted" appears nowhere in the session vocabulary |

## Scale

2,307 lines across the whole control plane, no third-party dependency, Node
standard library only.

| Module | Lines |
|---|---|
| `lib/agent.mjs` | 598 |
| `lib/validate.mjs` | 468 |
| `cli.mjs` | 389 |
| `lib/discover.mjs` | 147 |
| `lib/markdown.mjs` | 136 |
| `lib/lifecycle.mjs` | 128 |
| `lib/manifest.mjs` | 118 |
| `lib/traceability.mjs` | 106 |
| `rules/rules.mjs` | 85 |
| `lib/diff.mjs` | 70 |
| `lib/approvals.mjs` | 62 |

## Concerns — the case against approval

Stated plainly, because a review pack that only argues for approval is not a
review pack.

**1. `agent.mjs` carries five concerns in one module.** Record loading, task
scope parsing, path safety, git invocation, and attribution all live in 598
lines. It is the largest file in the control plane and the obvious candidate
to split (`records`, `scope`, `git`, `attribution`). Nothing is wrong with it
today; it is where the next change will be awkward.

**2. Attribution trusts self-reported state.** Scope enforcement rests on
digests the session itself recorded. An agent that can write code can write
that record, and a fabricated entry would make its own change look
pre-existing. The digest makes attribution *decidable*; it does not make the
record *trustworthy*. Real assurance is commit authorship, review and branch
protection — outside this tool.

**3. Markdown is parsed with regular expressions.** `taskScope` reads task
declarations textually, so formatting affects meaning. `CONV-008` was exactly
this: a test range read as two identifiers rather than ten. Fixed by
enumerating, not by making the parser cleverer — but the class of problem
remains.

**4. Preflight runs a full validation on every call.** Correct, and it is what
makes a structural error block every agent action. It also means preflight
cost tracks total specification count, not the size of the question asked.
About 0.3 s at two specifications; unmeasured at two hundred.

**5. The rule catalogue is a flat map of 58 entries.** Adequate now. It has no
grouping, ownership or lifecycle metadata, so a future deprecation or
per-area ownership would need structure that does not exist yet.

## What approval would mean

Approving gate 2 says the **approach** fits: the boundary, the separation of
concerns, the determinism, the enforcement model. It does not say the
requirements are right — that is `D1`, gate 1, a separate decision that a
Product Owner may also satisfy.

## Allowed decisions

| Decision | Consequence |
|---|---|
| APPROVE | An architecture approval record is added to `sdd.json`; convergence check 15 can pass |
| REQUEST_CHANGES | `plan.md` is amended under a `CHG-` record; the affected tasks are re-executed under new sessions |
| REJECT | The pattern is withdrawn; `SPEC-0002` returns to `PLANNED` |

## Evidence to read

`plan.md` decisions `AD-001` to `AD-007`; `docs/sdd/AGENT_ROLE_MODEL.md`;
`docs/sdd/AGENT_SESSION_STANDARD.md`; `tools/sdd/lib/agent.mjs`;
`docs/evidence/phase-b3-agent-integration/security-re-review.md`.
