# Mobile UI audit — findings

Two independent passes over the application, kept separate on purpose because
each finds what the other structurally cannot.

- **Static pass** — 7 parallel auditors over the shell, the whole design system
  (`globals.css`, `tokens.css`), shared components, sales lists, sales
  detail/forms, the 40-route People module, and admin/platform/auth.
  **222 findings, 57 blockers.**
- **Runtime pass** — `scripts/mobile-audit.mjs` renders 29 routes at 10 widths
  (320→1440), compares `scrollWidth` to the viewport and walks the DOM to name
  the elements that escape it. **290 measurements, 23 overflowing.**

## The headline: the phone is not where the overflow is

| Width | Routes overflowing (of 29) |
| ----- | -------------------------- |
| 320 | 1 |
| 360 · 375 · 390 · 414 · 430 | **0** |
| **768** | **22** |
| 1024 · 1280 · 1440 | 0 |

At 360–430px the `max-width: 760px` rules fire and nothing overflows. The
"squared, cramped, desktop-compressed" complaint is therefore **not** an
overflow bug — it is that those rules only *stack* desktop components. They
turn the sidebar into a drawer and tables into labelled blocks; they never
design a mobile screen. No amount of overflow fixing addresses it.

**768px has no design at all.** Every mobile rule is gated on `≤760px`, so at
768 (iPad portrait, most Android landscape) the full desktop layout renders:
236px sidebar + a 648px topbar action cluster in a 768px viewport, overflowing
by exactly +234px on 22 routes. The dead zone runs 761px → ~1024px.

## Systemic causes, by blast radius

### 1. The table system — 58 findings, 24 blockers
- `.lf-table { min-width: 720px }` with, in ~12 screens, a hand-rolled
  `<div class="lf-card" style="padding:0; overflow:hidden">` wrapper. `hidden`
  does not scroll: **columns are silently clipped and unreachable.**
- The `≤760px` "table→card" transform produces *no card*: rows become blocks
  separated by hairlines, with no surface, border or radius. It is the origin
  of the "squared" look.
- `WorkspaceTable` has no column priority, so all 8–15 columns become stacked
  label/value rows on a phone.
- Worst offenders: `CheckInConsole.tsx:426` (720px table, no scroll container
  at all), `LifecycleScreen.tsx` (3 occurrences), roster (8-column day matrix).

### 2. Navigation and shell — blockers across every route
- The desktop sidebar (40–54 links) slid in *is* the mobile navigation.
- No compact mobile header; the desktop cluster (search + workspace + density +
  theme + help + notifications + logout + create) is what a phone gets.
- Drawer is a fixed 236px, never sized to viewport; no scrim, no Escape, no
  close-on-navigate, no focus trap, not `inert` when closed.
- `TopBar` notifications panel is `width: 380px` fixed — wider than a 360px phone.
- `.lf-shell-actions` is the measured +234px at 768.

### 3. Touch targets — 4 blockers, ~2.3k sub-44px controls at 390px
`.lf-btn--sm { height: 28px }` is used for the primary action in row actions,
table cells and the shell. (Headline count includes inline text links, which do
not need 44px; the actionable subset is buttons, icon buttons, tabs, inputs.)

### 4. Overlays — 25 sheet + 21 drawer findings
Desktop drawers and fixed-px dropdowns squeezed into phones instead of becoming
bottom sheets or full-screen sheets.

### 5. Grids — 29 findings
`repeat(auto-fit, minmax(320px, 1fr))` cannot fit 288px of content at 320px:
the sole phone-width overflow (dashboard, +16px) comes from this floor.

### 6. Tabs, filters, forms, list headers
Inline `flexWrap: 'wrap'` overrides the `.lf-tabs` scroll strip; filter rows
place many controls in a non-wrapping row; `ListHeader`'s action slot is
unconstrained, so callers pass 3–4 buttons that cannot fit.

## What must not change
- Desktop ≥1024px is correct today and is the regression baseline.
- The People module's separate visual identity (serif headings, viridian).
- Burgundy-once brand discipline; `overflow-x: hidden` is not an allowed fix.

## Execution order (largest improvement per unit of churn)
1. Breakpoint strategy + tablet tier (fixes 22 routes at 768 in one change).
2. Table→card primitive with column priority (58 findings, most of the app).
3. Mobile shell: compact app bar, bottom nav, real drawer/sheet primitive.
4. Overlay primitive (drawer/modal → bottom sheet / full-screen sheet).
5. Touch-target + grid-floor + tab-strip token rules.
6. Filters → filter sheet; ListHeader → primary + overflow menu.

Raw data is not committed — it is regenerated, and 775KB of machine-written
JSON re-broke the format gate every time the probe ran. `node scripts/mobile-audit.mjs`
rewrites `mobile-audit.json` (per route × width, named offenders); `all-findings.json`
was the static sweep's 222 findings, summarised above.
