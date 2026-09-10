# Human code review packet — SPEC-0003 (CONV-007)

| Field | Value |
|---|---|
| Finding | `SPEC-0003/CONV-007` |
| Requirement | `R2` — **1 human reviewer** (`docs/sdd/RISK_TO_PROCESS_MATRIX.md`, row *Human code review*) |
| Status | `OPEN` — **no human review has occurred** |
| Prepared | 2026-09-08 by AI agent |
| Decision required | `APPROVE` / `REQUEST_CHANGES` / `BLOCKED` |

**An AI review exists (`REV-0001`, `APPROVE`) and does not satisfy this gate.**
It carries `actorType: "ai"` and `satisfiesHumanGate: false`. It is offered
below as input, not as a substitute.

---

## What you are reviewing

Two files. Nothing else in the repository changed for this pilot.

| File | Change |
|---|---|
| `apps/web/src/components/workspace/TableSearch.tsx` | +19 / −3, of which 10 additions are comment |
| `apps/web/tests/e2e/tablesearch-a11y.spec.ts` | new, 7 cases |

## The requirements this must satisfy

**Functional** — `FR-001` filtering unchanged; `FR-002` keyboard-reachable;
`FR-005` filter still runs on every value change, no debounce; `FR-006` no new
keyboard behaviour.

**Accessibility** — `ACC-001` `searchbox` role from native `type="search"`,
no ARIA role added; `ACC-002` accessible name from the visible `<label>`, no
`aria-label` added; `ACC-003` status region present from first render;
`ACC-004` no-match message announced; `ACC-005` no keyboard trap; `ACC-006`
focus indication not suppressed.

**Non-functional** — `NFR-001` no new dependency; `NFR-002` no backend, API,
schema or migration change; `NFR-003` no material visual redesign;
`NFR-004` no additional event handling; `NFR-005` claims bounded by the
browsers Playwright runs. `DATA-001` no data change.

**Withdrawn**, `CL-001` option (c), Product Owner: `FR-003`, `FR-004`,
`AC-004`, `E2E-004`, `TASK-002`, `AD-004`. No `Escape` behaviour was added.

## The final diff

```diff
+const NO_MATCH = 'Nothing on this page matches. Clear the box to see every row again.';
+
 export default function TableSearch({ ... }) {
   ...
   <div ref={host} style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
+    {/* One status region for the whole component, rendered unconditionally ... */}
+    <span className="lf-visually-hidden" aria-live="polite">
+      {count ? `${count.shown} of ${count.total} shown${count.shown === 0 ? `. ${NO_MATCH}` : ''}` : ''}
+    </span>
     <div style={{ display: 'flex', ... }}>
       ...
       {count && (
-        <span aria-live="polite" style={{ ... }}>
+        <span aria-hidden="true" style={{ ... }}>
           {count.shown} of {count.total} shown
         </span>
       )}
     </div>
     {children}
     {count?.shown === 0 && (
-      <p style={{ ... }}>
-        Nothing on this page matches. Clear the box to see every row again.
+      <p aria-hidden="true" style={{ ... }}>
+        {NO_MATCH}
       </p>
     )}
   </div>
```

## The two defects this fixes

1. **The no-match message was never announced.** It sat outside any live
   region, so a screen-reader user heard `0 of 42 shown` and was never told
   what to do about it.
2. **The live region was conditionally rendered.** `{count && (<span
   aria-live="polite">…)}` meant it did not exist until the first keystroke,
   and a region inserted at the same moment as its content is announced
   unreliably.

## The one design decision worth your attention — `AD-006`

`AD-003`, as approved, said the message "moves inside the same status region".
**Implemented literally, that violates `NFR-003`**: the message would relocate
from below the table to beside the search input — a long sentence in a
`--lf-text-xs` span inside a wrapping flex row.

Two approved statements conflicted. The resolution, recorded as `AD-006` in
`plan.md` and as `CONV-004`:

- one live region, as `AD-003` requires, carrying both texts;
- rendered with the **existing** `.lf-visually-hidden` class, so nothing moves
  on screen and `NFR-003` holds exactly;
- the two visible elements keep their positions and are `aria-hidden`, so the
  same text is not presented twice.

`.lf-visually-hidden` is defined in `globals.css` and already used by
`ConversationInbox.tsx` and `LeadGrid.tsx`. It is a clip pattern, not
`display: none`, so its content is announced. **No CSS was added and
`globals.css` was not edited** — it is a prohibited path for `TASK-001`.

**Please confirm or reject `AD-006`.** It is the only place the implementation
departs from the approved plan's literal wording.

## Accessibility behaviour, as verified

| Aspect | Behaviour | Evidence |
|---|---|---|
| Role | `searchbox`, from native `type="search"`. No ARIA role added | `E2E-002` |
| Accessible name | from the visible `<label htmlFor>` with `useId()`. No `aria-label` added | `E2E-002` |
| Default name | `Search` when a consumer passes no `label` | `E2E-006` |
| Live region | present and **empty** before any query; carries the message at zero matches | `E2E-005` |
| Focus | takes focus; `Tab` leaves, `Shift+Tab` returns — no trap | `E2E-001` |
| Focus indicator | untouched — **the change contains no CSS at all** | diff inspection |
| Keyboard | no handler added; zero matches for `onKey`, `keydown`, `keyup`, `Escape`, `addEventListener` | diff inspection |

## Regression evidence

| Check | Result |
|---|---|
| `E2E-003`, `REG-001` | filtering and restore behave exactly as before |
| `REG-002` | label, input and table still render; visible count still absent until a query exists |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm run lint` | **PASS**, exit 0 — no finding in either changed file |
| Playwright | **7 / 7 PASS** |

## Security screening

No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `fetch`, `axios`, `prisma`,
`process.env`, `localStorage`, `sessionStorage`, `document.cookie` or
`window.location`.

**All ARIA values are literals** — `aria-live="polite"`, `aria-hidden="true"`.
**No user-controlled value reaches any ARIA attribute**; the search query is
deliberately *not* interpolated into the live region, only row counts and a
module constant. No `.focus()` call, so no focus theft. No key handler, so no
trap introduced. No auth, authorization, tenant, PII, backend, API, database
or secret surface. **No risk escalation — `R2` stands.**

## Known limitations you are accepting if you approve

| # | Limitation | Finding |
|---|---|---|
| 1 | The region announces on every keystroke and appends the full sentence at zero matches — louder than before, when it was never announced | `CONV-005`, separate Product Owner decision |
| 2 | `prettier --check` fails on CRLF line endings; content is byte-identical after stripping `\r`, and untouched files fail identically | `CONV-001` |
| 3 | The unit suite cannot give a regression signal: `master_saas_test` is stale | `CONV-003` |
| 4 | No real screen reader was exercised; evidence is the browser accessibility tree only | stated in `spec.md` |
| 5 | Chromium only — the Playwright configuration defines one project | `NFR-005` |
| 6 | Five of the six call sites were not individually exercised; all render the same component | — |

## All open convergence findings

| Finding | Subject | Status | Owner |
|---|---|---|---|
| `CONV-001` | prettier / CRLF | `OPEN` | QA / Application Engineering |
| `CONV-003` | stale `master_saas_test` | `OPEN` | DevOps / Production Engineering |
| `CONV-005` | live-region announcement policy | `OPEN` | Product Owner |
| `CONV-007` | **this review** | `OPEN` | you |
| `CONV-002` | 12 unit failures = `EVC-014` | `RESOLVED` | — |
| `CONV-004` | `AD-006` deviation | `RESOLVED` | — |
| `CONV-006` | `E2E-006` row-count precondition | **remediated** under `CHG-001` | — |
| `CONV-008` | scope-parser defect | **remediated** under `SPEC-0002/CHG-007` | — |

## What the AI review flagged for you

`REV-0001` returned `APPROVE` with nine findings. The three `MINOR` ones are
the ones a browser test cannot settle:

1. **Announcement verbosity** — `CONV-005`, above.
2. **Reading order.** Making the visible count and message `aria-hidden` means
   a screen-reader user browsing statically reads both from the hidden region
   rather than at their visual position. Conventional for a visible/announced
   pair, but it does move where that text sits.
3. **`E2E-006`'s row-count precondition** — since remediated under `CHG-001`.

## Your decision

- **`APPROVE`** — `CONV-007` becomes `RESOLVED`.
- **`REQUEST_CHANGES`** — name what must change; `SPEC-0003` returns to
  `IMPLEMENTING` under a change record.
- **`BLOCKED`** — name the blocker.

Record it as a `REV-` record with `actorType: "human"` and your functional
role. **Do not let an agent write it for you.**
