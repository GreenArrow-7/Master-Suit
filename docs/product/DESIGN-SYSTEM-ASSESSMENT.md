# Shared visual system — assessment

Foundation-package item 5. **Assessment only: no visual change has been made.**

The brief proposes a palette and a set of comfort requirements. Before adopting
either, the instruction was to inspect what already exists. What exists is more
than a starting point, so this document separates the parts of the brief that
should be adopted from the part that should not.

## What already exists

`apps/web/src/styles/tokens.css` — 388 lines — is a designed system, not an
accumulation. It has two layers:

| Layer | Prefix   | Role                                                  |
| ----- | -------- | ----------------------------------------------------- |
| Brand | `--yh-*` | canonical YOUHAN ONE tokens; new code uses these      |
| Alias | `--lf-*` | the historical LeadFlow names, remapped onto `--yh-*` |

The alias layer exists because roughly 400 call sites reference the old names.
Renaming them would be a large diff for no visual change and real regression
risk, so the old names survive as a thin alias. **Nothing but that file defines
an `--lf-*` colour.** That is a single source of truth, and it is the reason a
palette change is feasible at all.

The file carries its own reasoning, and the reasoning is sound. Three examples:

- **The colour budget.** Brand blue is reserved for the primary action, links,
  focus and the selected nav indicator. Business state is deliberately _not_
  brand-coloured, "because 'breached' and 'brand' must never look alike."
- **Cyan is not text.** `#00D9F5` on white is 1.7:1, so cyan is confined to
  midnight chrome and AI surfaces, with `--yh-cyan-ink` (`#0b7f95`) as the
  ink-weight version where a cyan word is genuinely needed.
- **Primary flips role between themes.** `--yh-on-primary` exists because on
  light the primary is a deep blue carrying white text and on dark it is a
  bright blue carrying midnight text; hardcoding `#fff` is what gave the
  previous dark theme a 2.7:1 primary button.

There is also an established component library —
`src/components/{ui,workspace,forms,nav,brand,sales,...}` — including
`WorkspaceTable`, `ConfigurableGrid`, `ListHeader`, `FilterSheet`, `Pager`,
`RowActions`, `EmptyState`, `MobileTabBar` and `ModuleTheme`. The shared
components the brief asks for largely exist; they need auditing, not authoring.

## Measured contrast

Computed from the token values, WCAG 2.1 relative luminance.

### Current palette

| Pair                                       | Ratio      | Verdict  |
| ------------------------------------------ | ---------- | -------- |
| primary text `#111827` on canvas `#f7f9fc` | 16.82:1    | AA       |
| primary text on surface `#ffffff`          | 17.74:1    | AA       |
| secondary text `#667085` on canvas         | 4.72:1     | AA       |
| **muted text `#8a94a6` on canvas**         | **2.90:1** | **FAIL** |
| white on primary `#2455e6`                 | 5.97:1     | AA       |
| success `#0e7c66` on canvas                | 4.86:1     | AA       |
| warning `#b45309` on canvas                | 4.76:1     | AA       |
| danger `#c4342c` on canvas                 | 5.14:1     | AA       |

One genuine defect: `--yh-text-muted` fails AA for body text. It is used for
de-emphasised metadata, which is exactly the text a tired reader struggles with.
`--yh-text-faint` (`#a9b2c0`) is lighter still.

### Proposed palette

| Pair                                    | Ratio      | Verdict  |
| --------------------------------------- | ---------- | -------- |
| primary text `#243041` on bg `#F3F4F6`  | 12.12:1    | AA       |
| primary text on card `#FAFAFB`          | 12.79:1    | AA       |
| secondary text `#526071` on bg          | 5.83:1     | AA       |
| white on primary action `#176B63`       | 6.33:1     | AA       |
| primary action as text on bg            | 5.75:1     | AA       |
| **decorative accent `#B49A76` as text** | **2.44:1** | **FAIL** |
| white on navigation `#182330`           | 15.89:1    | AA       |

The proposed palette is sound. Its only failure is the decorative accent used as
text — and the brief already calls it "restrained decorative accent", so it was
never intended to carry text. Both palettes are viable on contrast grounds.

## The recommendation

**Adopt the comfort requirements. Do not replace the brand.**

The proposed palette is teal (`#176B63`) and gold (`#B49A76`). The existing brand
is blue (`#2455E6`) and cyan (`#00D9F5`), and cyan carries a specific meaning —
it marks AI surfaces. Swapping hue families would:

- discard a documented colour budget and the meaning attached to cyan;
- diverge from youhan.in, which the token file names as the parent brand;
- touch every screen at once — which the brief itself asks to avoid before
  visual review.

Nothing in the brief's stated goals — elegance, comfort over long sessions,
readability, restraint — requires a hue change. Every one of them is achievable
within the existing palette, and the measurements above show the existing palette
already meets AA everywhere except one token.

**If a rebrand to teal/gold is genuinely wanted**, it is cheap to execute _later_:
the alias layer means it is an edit to the `--yh-*` block, not to 400 call sites.
That makes it a decision that can be deferred without cost, which is an argument
for deferring it. Recorded as decision **D-12** in `DECISIONS-REQUIRED.md`.

## The real gaps, against the brief's requirements

Measured against `tokens.css`, not asserted.

| Requirement                    | Current                                | Gap                                                                  |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------------- |
| Body text ~16px                | `--lf-text-base: 0.9375rem` = **15px** | 1px under                                                            |
| Working-table text 14–16px     | `--lf-text-sm: 0.8125rem` = **13px**   | **3px under** — the workhorse token                                  |
| — compact density              | `--lf-text-sm: 0.75rem` = **12px**     | acceptable _as_ the compact option                                   |
| Distinct success/warning/error | present, semantic, non-brand           | verify every one is paired with a label or icon, not colour alone    |
| Visible keyboard focus         | `--yh-azure` reserved for focus        | needs an audit that every interactive element shows it               |
| Reduced motion                 | not yet confirmed                      | **VERIFY** — no `prefers-reduced-motion` block found in `tokens.css` |
| Dark mode                      | present, with role-flipping primary    | contrast to be measured independently, as the brief requires         |
| Muted text legibility          | 2.90:1                                 | **repair**                                                           |

The single highest-value change is the working-table size: **13px → 14px**, with
the compact density keeping 13px rather than 12px. That is one token, it moves
every grid in the product, and it is the text people read for hours.

## Proposed sequence

Deliberately not started — this is an assessment, and the brief asks for previews
before propagating a visual direction.

1. **Repair contrast.** Darken `--yh-text-muted` to reach AA; re-check
   `--yh-text-faint`'s uses. One token, measurable, no layout change.
2. **Raise the type floor.** `--lf-text-sm` 13px → 14px, `--lf-text-base` 15px →
   16px; compact density becomes 13px. Screenshot the densest grids before and
   after — this changes row heights.
3. **Audit, don't author, the shared components.** Confirm each of the brief's
   states — loading, empty, error, permission-denied, selected, focused — exists
   in the shared library and is used rather than re-implemented per page.
4. **Add `prefers-reduced-motion`** if the VERIFY above confirms it is absent.
5. **Build the five previews** with synthetic data: agent work queue, customer
   timeline, manager exception queue, employee HR self-service, HR
   attendance/leave administration. Desktop and mobile screenshots for review.
6. **Only then** consider D-12.

Steps 1 and 2 are reversible single-token edits and can proceed without a
decision. Step 5 depends on the first connected workflow existing, since three of
the five previews are screens that package builds.

## What this assessment did not check

- Dark-theme contrast was **not** measured; the brief requires it to be tested
  independently and that is step 1 work.
- No screen was audited for actual token usage — a page may hardcode a colour
  despite the system. Step 3.
- Mobile responsiveness of the agent workflows was not assessed.
- `prefers-reduced-motion` support is unconfirmed, not confirmed absent.
