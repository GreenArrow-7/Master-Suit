# LeadFlow CRM — Burgundy Design System

Open `leadflow-design-system.html` in a browser to see everything below rendered.
It inlines the real `tokens.css` and `globals.css`, so it cannot drift from the app.

## 1. The problem burgundy creates, and how it is resolved

Red is already load-bearing in a CRM: breached SLA, lost deal, rejected document,
destructive action. Making burgundy the brand colour puts two reds in the same
field of view and destroys both meanings. A rep glancing at a row must not have to
ask whether that red is "our brand" or "this is on fire".

Four decisions resolve it:

| Decision | Why |
|---|---|
| Burgundy pushed deep (`#2E0B16`–`#6B1D33`) | At that depth it reads as near-black structure in the chrome, not as an alert |
| Alerts moved to vermillion (`#C8412C`) | Visibly higher lightness and hotter hue — the gap is what stays legible at 3 m |
| Brass and viridian for the other semantic slots | Burgundy's neighbours on the wheel, so the palette stays one family instead of importing generic amber/green |
| Pearl neutrals, never cream | Burgundy on cream with a serif is the wine-label cliché. Burgundy on cool pearl reads jewel-like and stays a tool |

Ink is warm-shifted (`#1C1418`, a red-black) so text sits in the brand's family
rather than fighting it with a blue-black.

## 2. Palette

**Burgundy ramp** — 900 is chrome, 700 is the brand, 500 is interaction.

`#2E0B16` · `#3A0F1C` · `#6B1D33` · `#7C2440` · `#8E2B47` · `#C08A9C` · `#E4CED6` · `#F1E3E8` · `#FBF5F7`

**Pearl neutrals** — `#F3F0F1` canvas · `#FFFFFF` surface · `#FAF8F9` surface-2 ·
`#E4DDE0` line · `#CFC4C9` line-2

**Ink** — `#1C1418` · `#5F545A` · `#8E8288` · `#B3A8AE`

**Semantics** — each has exactly one job across every module:

| Token | Hex | Means |
|---|---|---|
| `--lf-brass` | `#A87A22` | at risk, pending, awaiting |
| `--lf-viridian` | `#12655A` | won, converted, verified, SLA met |
| `--lf-vermillion` | `#C8412C` | breached, lost, rejected, destructive |
| `--lf-slate` | `#5F545A` | open, no state |

Shadows are wine-tinted (`rgb(46 11 22 / …)`), not neutral grey. On a pearl canvas
a grey shadow reads dirty; a wine-tinted one reads as depth.

## 3. Typography

Four faces, four jobs.

| Role | Face | Where |
|---|---|---|
| Display | Instrument Serif | **Wordmark and hero metrics only** |
| UI | Instrument Sans | Headings, buttons, labels, badges |
| Body | Inter Tight | Grid rows, dense text |
| Mono | IBM Plex Mono | Every figure in the product |

The serif appears in exactly two places in the whole application. That is where the
boldness is spent — a data grid set in a display face is a costume, not a design.
Inter Tight over Inter buys roughly 8% more columns per row at the same legibility,
which is the difference between eleven and twelve visible fields at 1440px.

Every number is tabular via `.lf-num`, so figures align down a column without
per-cell classes.

## 4. Signature — the stage rail

`src/components/ui/StageRail.tsx`

Completed segments deepen in burgundy as the record advances, so **pipeline depth
is readable peripherally by colour intensity before a single label is read**. The
active segment widens (`flex-grow: 3.2`), carries the brass hairline — the only
metallic accent in the product — and holds the SLA countdown in mono.

When SLA turns, the active segment abandons the wine ramp entirely for brass or
vermillion. That switch is only legible because those hues were deliberately kept
off the burgundy ramp in §1.

One component, rendered identically on leads, opportunities and tickets, so a rep
learns one mental model and reads all three the same way.

The countdown ticks once a second only while the deadline is inside 24 hours; a
30-day timer re-rendering every second is pure battery cost.

## 5. Component inventory

| Component | Class / file |
|---|---|
| Buttons — primary, secondary, ghost, danger, sm, lg | `.lf-btn` |
| Inputs, selects, textareas with error state | `.lf-input` `.lf-field` `.lf-label` `.lf-hint` |
| Status badges with semantic mapping | `Badge.tsx` — a status never picks its own colour ad hoc |
| Metric cards with the serif figure | `MetricCard.tsx` |
| Data grid — sticky first column, sortable headers, bulk bar, score bars | `.lf-grid` `LeadGrid.tsx` |
| Stage rail | `StageRail.tsx` |
| Tabs with counts | `.lf-tabs` `.lf-tab` |
| Activity timeline with typed dots | `.lf-timeline` |
| Alerts — vermillion, brass, viridian | `.lf-alert` |
| Toast / bulk-action bar | `.lf-toast` |
| Skeletons matching real row heights | `Skeleton.tsx` |
| Empty states | `EmptyState.tsx` |

## 6. Screens built

| Screen | Path |
|---|---|
| Sign in — split panel, MFA step | `src/app/(auth)/login/` |
| App shell — wine rail, top bar, ⌘K, density and theme toggles | `src/app/(app)/layout.tsx` |
| Home — four metrics, stage funnel, recently updated | `src/app/(app)/home/page.tsx` |
| Leads — saved-view tabs, data grid, bulk bar | `src/app/(app)/leads/` |
| Lead detail — 360 header, stage rail, eight tabs, timeline | `src/app/(app)/leads/[id]/` |

## 7. Rules the system holds itself to

- **Colour carries meaning, never decoration.** If a colour appears, it is
  answering a question the user has.
- **The serif is spent once.** Wordmark and hero figures. Nowhere else.
- **Brand lives in the chrome.** The working area stays neutral pearl so data reads
  without competing with the palette.
- **Errors explain and instruct.** They do not apologise and are never vague.
- **Empty screens are invitations.** The copy names the next action in the same
  words the button uses.
- **Skeletons match real dimensions.** A loading state that shifts the layout is
  worse than a spinner.
- **Hiding is not authorization.** The UI hides what the actor cannot use; the
  server decides. Both are required, only one is a control.

## 8. Accessibility

- Focus is a two-ring wine halo on every interactive element, never removed.
- Body text on canvas is 12.9:1. `--lf-ink-2` on surface is 6.8:1. Every badge
  pairs a semantic foreground with its own tinted background and clears 4.5:1.
- Status is never colour alone — badges carry a text label and a dot.
- `aria-sort` on sortable headers, `aria-current="step"` on the active rail
  segment, `aria-selected` on tabs and grid rows, `aria-busy` on skeletons.
- `prefers-reduced-motion` collapses every transition to 0.01ms.
- Below 860px the grid reflows to cards; below 1000px the rail hides.

## 9. Dark mode

Not an inversion. The rail colour swallows the whole canvas (`#1A0A11`), surfaces
become deep wine (`#24101A`), and the burgundy ramp inverts so the brand lightens
to `#C4718C` while staying identifiably the same hue. Every semantic colour has a
dark counterpart tuned for contrast on wine, not on grey. Toggle it in the preview.
