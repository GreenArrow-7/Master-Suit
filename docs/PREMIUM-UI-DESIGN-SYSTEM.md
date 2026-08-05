# Premium shared SaaS interface

Date: 2026-08-03

## Direction

The shared application now follows the supplied LeadFlow screenshot: a compact
dark command rail, a 56-pixel utility bar, a quiet neutral working canvas and
dense data-first operational pages. The brief explicitly rejected gold
gradients, so gold is limited to a two-pixel active-module/navigation marker.

## Tokens

- Command rail: `#230B15`
- Primary wine: `#6B1D33`
- Canvas: `#F3F0F1`
- Surface: `#FFFFFF`
- Border: `#E4DDE0`
- Active marker: `#B18A3D`
- Success: `#12655A`
- Warning: `#A87A22`
- Danger: `#C8412C`

Operational screens use one sans-serif stack: Inter, Segoe UI and system UI.
Monospace remains restricted to identifiers and numeric data.

## Shared components

- responsive Platform and workspace command rails;
- workspace identity and workspace switcher;
- subscription-plan badge;
- Sales/People module switcher with entitlement-aware visibility;
- contextual search and quick-create top bar;
- notifications, density, theme, Help and session actions;
- reusable page header and breadcrumbs;
- shared dense table, empty state, metric card and form-section styling;
- five-step workspace provisioning wizard;
- mobile navigation drawer and horizontally scrollable tables;
- light/dark token support and reduced-motion support.

## Functional boundary

The redesign changes presentation and navigation composition only. Existing API
routes, validation, tenant guards, permission checks and database transactions
remain authoritative. The workspace wizard posts the same creation payload to
the existing transactional provisioning endpoint.

The full functional-preservation matrix remains the release authority. Pages
whose original HRMS or LeadFlow workflows have not yet been migrated must not be
described as complete merely because the shared shell now styles them.

## Evidence

- `docs/evidence/premium-platform-dashboard.png`
- `docs/evidence/premium-workspace-wizard.png`
- `docs/evidence/premium-manath-dashboard.png`
- `docs/evidence/premium-sales-leads.png`
- `docs/evidence/premium-people-dashboard.png`
- `docs/evidence/premium-people-employees.png`
- `docs/evidence/premium-mobile-navigation.png`
- `docs/evidence/premium-mobile-navigation-open.png`
- `docs/evidence/premium-dark-mode.png`

## Verification

- TypeScript: passed (`tsc --noEmit`, exit code 0).
- Browser: Platform dashboard, provisioning wizard, Manath Homes dashboard,
  Sales leads, People dashboard, employee directory, responsive navigation and
  dark mode rendered from live PostgreSQL data.
- Browser/server scan after the tenant-filter correction: no current 500 or
  unhandled-error entries.
