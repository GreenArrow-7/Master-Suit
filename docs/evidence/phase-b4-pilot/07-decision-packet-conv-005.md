# Decision packet — CONV-005: live-region announcement policy

| Field | Value |
|---|---|
| Finding | `SPEC-0003/CONV-005` |
| Decision owner | **Product Owner**, with accessibility input |
| Status | `OPEN` — **not decided here** |
| Prepared | 2026-09-08 by AI agent |
| Blocks | `SPEC-0003` convergence acceptance |

An agent prepared this and deliberately selected nothing. The recommendation
sections give reasoning, not a choice.

---

## What the component does today, exactly

`apps/web/src/components/workspace/TableSearch.tsx` renders **one** status
region:

```jsx
<span className="lf-visually-hidden" aria-live="polite">
  {count ? `${count.shown} of ${count.total} shown${count.shown === 0 ? `. ${NO_MATCH}` : ''}` : ''}
</span>
```

Four facts, each verified by reading the source and by `E2E-005`:

1. The region is `aria-live="polite"` and is **rendered unconditionally**, so
   assistive technology observes it before its content ever changes.
2. It carries the result count and, at zero matches, the no-match sentence —
   *"Nothing on this page matches. Clear the box to see every row again."*
3. **Its content changes on every keystroke.** `onInput` calls `filter`
   directly; there is no debounce and no transition detection.
4. It is visually hidden. The visible count and the visible message keep their
   original positions and are `aria-hidden`, so nothing is announced twice and
   nothing moved on screen.

## What that means in practice

Typing `zzz` into a list where nothing matches produces three polite
announcements, each ending in the full sentence:

> "0 of 42 shown. Nothing on this page matches. Clear the box to see every row again."
> "0 of 42 shown. Nothing on this page matches. Clear the box to see every row again."
> "0 of 42 shown. Nothing on this page matches. Clear the box to see every row again."

A polite region does not interrupt, and most screen readers coalesce rapid
updates — but the behaviour is **not** what it was.

## Why this is a change, and why it is not a defect

**It is louder than before.** Previously the no-match sentence sat outside any
live region and was announced *never*. Fixing `ACC-004` is what made it
audible; the frequency is inherited from the pre-existing per-keystroke count,
which `FR-005` requires to stay as it is.

**No requirement is violated.** `ACC-004` asks that the message be announced
when it appears, and it is. `FR-005` forbids a debounce, and none was added.
The specification as approved is satisfied.

**No automated test can settle it.** Playwright reads the accessibility tree;
it cannot judge whether an announcement is welcome. This is a taste judgement
about what a screen-reader user should hear.

## The constraint that binds the options

`FR-005` — *"Every value change continues to invoke the existing filter on the
same event, with no debounce introduced."*

**A debounce may not be added unless `FR-005` is formally amended** under
`docs/sdd/CHANGE_CONTROL.md`. That is option C below, and it is a real option
rather than a warning.

## Options

| | Option | What changes | Cost | Requires |
|---|---|---|---|---|
| **A** | **Keep current behaviour.** The region announces count and message on every keystroke | nothing | none | Product Owner accepts `CONV-005` as an accepted limitation |
| **B** | **Announce only on state transition.** The region updates only when the result set *enters* or *leaves* the empty state, not on every keystroke | one `useRef` holding the previous emptiness; no timer, no debounce | small, one file | Nothing — see below |
| **C** | **Amend `FR-005` and add a debounce.** The filter, or just the announcement, waits for a pause in typing | a timer, and a requirement change | medium | A change record amending `FR-005`, then a new task |
| **D** | **Reduce what is announced.** Keep per-keystroke updates but announce the count alone, moving the no-match sentence to `aria-live="off"` or a separate polite region raised only on transition | small | small | Judgement on whether `ACC-004` is still met |

### On option B, specifically

B is worth understanding before choosing, because it is the only option that
reduces the noise **without** touching `FR-005`.

`FR-005` constrains *when the filter runs* — every value change, same event, no
debounce. It says nothing about when the **region's text** changes. Announcing
only on transition into or out of the empty state leaves the filter running on
every keystroke exactly as required, and changes only what the region says.

Whether that reading is correct is itself a judgement for the owner. If the
Product Owner considers it a change to the announcement contract, it becomes
option C and needs a change record. **The agent has not decided which.**

### On option D

`ACC-004` says the no-match message "is announced when it appears". Option D
risks not meeting it, depending on the variant chosen. It is listed for
completeness rather than recommended.

## Reasoning, not a recommendation

**A** is defensible: `aria-live="polite"` exists precisely so that rapid
updates do not interrupt, most screen readers coalesce them, and the pilot's
stated goal was to make the message audible at all — which it now is.

**B** is the smallest change that addresses the concern, and it is the one an
accessibility reviewer is most likely to ask for, because a message repeated
per keystroke is the classic live-region complaint.

**C** is the most thorough and the most expensive, and it reopens a requirement
the Product Owner already approved.

**No option is selected.** A and B are both reasonable; the difference is a
product judgement about how much a screen-reader user should hear while typing.

## If the decision requires code

Options B, C and D all need a change record under
`docs/sdd/CHANGE_CONTROL.md`, then a bounded task, preflight, a controlled
session, and a re-run of the Playwright suite. `SPEC-0003` is `R2`, so no
separate implementation-readiness approval is required — but the human code
review and convergence acceptance still are.

Option C additionally needs `FR-005` amended before any task may start.

## What is being asked

Choose A, B, C or D.

If **A**: `CONV-005` becomes `ACCEPTED_RISK` with the Product Owner as named
owner, and `SPEC-0003` can proceed to convergence acceptance.

If **B**, **C** or **D**: `CONV-005` stays `OPEN`, a change record is raised,
and `SPEC-0003` returns to `IMPLEMENTING`.
