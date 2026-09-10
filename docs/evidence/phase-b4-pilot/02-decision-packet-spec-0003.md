# Decision packet — SPEC-0003 (pilot PC-02)

| Field | Value |
|---|---|
| Specification | `SPEC-0003` — TableSearch keyboard and screen-reader accessibility |
| Risk | `R2` |
| Lifecycle state | `CLARIFYING` — blocked |
| Prepared | 2026-09-08 by AI agent, Planner role |
| Decisions needed | **3** — two product, one governance |
| Prepared by | an AI agent. **Nothing here is decided.** |

Implementation is blocked. This packet contains everything needed to unblock
it. Three decisions, one sitting, roughly ten minutes.

**No option is pre-selected and no approval is recorded.** Where a
recommendation appears it is labelled as such and carries its reasoning, so it
can be disagreed with on the merits.

---

## Why this is blocked

`R2` requires **no** separate implementation-readiness approval — that was
checked first, and it is not the blocker.

The blocker is that two clarifications are `OPEN` and both are declared
material. Three governing documents forbid implementation in that state:
`docs/sdd/CHANGE_WORKFLOW.md` STOP condition 1, `AGENTS.md` ("Stop before
implementing ... when a material clarification is open"), and
`docs/sdd/SPEC_LIFECYCLE.md` (entry to `APPROVED_FOR_IMPLEMENTATION` requires
material clarifications resolved).

Full reasoning, including the narrower readings that were considered and
rejected: `01-pre-implementation-stop-check.md`.

---

## What the pilot fixes, and why it is worth doing

Two defects, both read directly from
`apps/web/src/components/workspace/TableSearch.tsx`:

1. **The "nothing matched" message is never announced.** The row count sits in
   an `aria-live="polite"` region. The paragraph reading *"Nothing on this page
   matches. Clear the box to see every row again."* sits **outside** it. A
   screen-reader user hears `0 of 42 shown` and is never told what to do about
   it.

2. **The live region is conditionally rendered.** `{count && (<span
   aria-live="polite">...)}` means the region does not exist in the DOM until
   the first keystroke. A live region inserted at the same moment as its
   content is announced unreliably across assistive technologies.

Neither defect is disputed and neither needs a decision. **Both are fixed by
`TASK-001` alone.** The component is used at six call sites across five files
and currently has no test of any kind.

---

# Decision 1 — `CL-001`: what should `Escape` do?

**Owner: Product Owner.**

## The question

There is no clear control on this search box today. Emptying it means
selecting the text and deleting it, which is awkward with a keyboard alone.
Should `Escape` clear the query and restore all rows?

## What makes it genuinely arguable

**For.** `Escape` is a common convention for `type="search"`, and some
browsers already do something like it natively for the built-in clear
affordance — inconsistently.

**Against.** `Escape` also dismisses overlays. `FilterSheet` and `Sheet` both
exist in this codebase. If a consumer ever renders `TableSearch` inside one, a
swallowed `Escape` would trap the user in the sheet with no keyboard way out —
turning an accessibility fix into an accessibility defect.

## Options

| | Option | Consequence |
|---|---|---|
| **(a)** | `Escape` always clears and keeps focus | Simplest to describe. Swallows `Escape` from any future enclosing sheet, including when the box is already empty |
| **(b)** | `Escape` clears **only when the input is non-empty**; otherwise the event propagates | Gives the convenience without the trap. Slightly more logic, one extra branch |
| **(c)** | `Escape` does nothing — **descope it from this pilot** | `FR-003`, `FR-004`, `AC-004`, `E2E-004` and `TASK-002` are all `WITHDRAWN`. The pilot narrows to the two undisputed defects and can start immediately |

## Recommendation, with reasoning

**(b)** on the merits — it is the only option that delivers the convenience
without creating the sheet trap, and the extra branch is one line.

**(c) if the goal is to get the pilot moving tonight.** The two defects that
actually motivated selecting `PC-02` are fixed entirely by `TASK-001`;
`Escape` is a *feature addition* riding along with a *defect fix*. Splitting
them is defensible practice regardless of scheduling, and `Escape` would come
back as its own small specification with (b) already decided.

**These are not ranked against each other.** (b) is the better end state; (c)
is the better next step. Choosing (c) does not foreclose (b).

## If you choose (c), what happens mechanically

`FR-003`, `FR-004`, `AC-004`, `E2E-004`, `TASK-002` and decision `AD-004` are
marked `WITHDRAWN` — not deleted, so the record shows what was considered.
`CL-001` closes as "deferred to a follow-on specification". The pilot proceeds
on `TASK-001`, `TASK-003`, `TASK-004`, `TASK-005`.

---

# Decision 2 — `CL-002`: should a visible clear button be added?

**Owner: Product Owner.**

## The question

Should the pilot add a visible clear control (a `✕` in the search box)?

## What makes it arguable

**For.** It makes clearing discoverable for pointer and keyboard users alike,
and it is the conventional pattern for a search field.

**Against.** It adds an interactive control to a component that currently has
none, which brings its own accessible-name and focus-order obligations, and it
changes the visual design — which `NFR-003` currently forbids.

## Options

| | Option | Consequence |
|---|---|---|
| **(a)** | No button — keep the pilot minimal | `SPEC-0003` is already written this way. Nothing changes |
| **(b)** | Add one | Visual change, wider scope, new focus-order and accessible-name obligations, `NFR-003` must be amended |

## Recommendation

**(a)** for a first pilot. (b) is a reasonable follow-on with its own
specification.

**Note:** `SPEC-0003` is already written assuming (a). Choosing (a) requires
no edit to the specification — only that the clarification is recorded as
closed. Choosing (b) sends the specification back for revision.

---

# Decision 3 — gate 1 specification approval

**Owner: any human competent to accept an `R2` specification.**

## The question

`docs/sdd/RISK_TO_PROCESS_MATRIX.md` places `R2` specification approval with
the **author**. The author of `SPEC-0003` is an AI agent, and `AGENTS.md`
forbids an agent granting itself an approval or treating its own confidence as
a gate passed.

An AI author therefore cannot discharge an author-approval gate by being the
author. The gate is recorded as `UNRESOLVED` in `spec.md`; `approvals` in
`sdd.json` is empty.

## Options

| | Option | Consequence |
|---|---|---|
| **(a)** | A human **approves** the specification at gate 1 | An approval record is written naming that human's role. Cleanest, and matches what the matrix intends |
| **(b)** | A human **adopts authorship** of the specification | The author becomes human, so the author-approval row is satisfiable in its own terms. Also honest, since the human is accepting the content as theirs |
| **(c)** | Amend the matrix so the `R2` author row names a human explicitly when the author is an AI | A governance change, not a pilot decision. Would need its own evidence conflict and a Solution Architect decision |

## Recommendation

**(a)** — it is the smallest action and needs no governance change. **(c) is a
real question worth registering separately**, because this will recur for
every AI-authored `R1` or `R2` specification, but it should not block this
pilot.

## What is deliberately *not* proposed

An approval record with `actorType: "ai"`. `SDD-V059` would reject it, and it
would be false regardless.

---

## After the three decisions, what happens without further human input

Assuming `CL-001` = (b) or (c), `CL-002` = (a), and gate 1 approved:

1. `SPEC-0003` moves `CLARIFYING` to `PLANNED` to `READY_FOR_APPROVAL` to
   `APPROVED_FOR_IMPLEMENTATION`.
2. `agent preflight` for `TASK-001`, session opened, live region fixed.
3. `TASK-003` writes the Playwright spec — a separate session, since the two
   tasks' allowed scopes are deliberately disjoint.
4. `TASK-004` runs `npm run typecheck`, `npm run lint` and the Playwright
   suite, recording real results.
5. `TASK-005` assembles the review and convergence report.

**Two things will still need a human afterwards**, and neither can be
delegated:

- **Human code review.** `R2` requires 1 reviewer. An AI review will be
  labelled an AI review and does not satisfy this.
- **Convergence acceptance.** `R2` places this with the author — the same
  question as decision 3, and it resolves the same way.

## One known environmental limitation, stated in advance

The Playwright harness needs a running application and a seeded PostgreSQL
database. **Docker is installed but no container is currently running.**

Unless that harness is started, the E2E cases can be *written* but not *run*,
and will be recorded as `UNKNOWN — requires runtime/infrastructure
verification`. **They will not be recorded as `PASS`.** This is stated now so
it is not mistaken later for a failure of the pilot.

---

## Summary — what is being asked

| # | Decision | Owner | Recommended | Blocks implementation? |
|---|---|---|---|---|
| 1 | `CL-001` — `Escape` behaviour | Product Owner | (b) on merits, (c) to start tonight | **Yes** |
| 2 | `CL-002` — visible clear button | Product Owner | (a) — no button | **Yes** |
| 3 | Gate 1 specification approval | any competent human | (a) — approve | **Yes** |

All three block. All three are answerable in one sitting.
