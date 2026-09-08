# Frontend

Current observed state. VERIFIED unless labelled otherwise.

## Framework and build

- Next.js 16.2.12 App Router with Turbopack, React 19.2.8, TypeScript 5.9.3
  (`strict: true`, path alias `@/* → src/*`). `output: 'standalone'`,
  `reactStrictMode`, `experimental.authInterrupts`, global security headers
  (HSTS preload, nosniff, referrer policy, permissions policy, COOP) declared
  in `next.config.ts`; CSP is added per request by `src/proxy.ts`. E1/E2.
- Build: `npm run build` (`next build`); the container build runs it with
  placeholder env values so no real secret is needed at build time
  (`infra/Dockerfile` `build` stage). E2.
- Styling: `src/styles/tokens.css` (design tokens `--yh-*` / `--lf-*`) and
  `src/app/globals.css` (`.lf-*` component classes, ~7,000 lines), imported
  after `@import 'tailwindcss'` (Tailwind 4 via PostCSS). `.lf-*` classes are
  used in 245 of 274 `.tsx` files; Tailwind utilities appear in about 40. The
  working tree holds an uncommitted redesign of these two files and ~32
  components (neutral canvas, indigo accent); `apps/web/docs/08-DESIGN-SYSTEM.md`
  and `docs/PREMIUM-UI-DESIGN-SYSTEM.md` describe the previous ("Burgundy" /
  midnight) system and will be stale once the redesign lands — **EVC-007**.
  E1/E4.
- Fonts: Inter (self-hosted via `next/font` in `src/app/layout.tsx` — E1).

## Routing

Route groups under `src/app`:

| Group | Pages | Purpose |
|---|---|---|
| `(auth)` | 6 — `login`, `enroll-2fa`, `forgot-password`, `reset-password`, `accept-invite`, `service-login` | identity flows |
| `(platform)/platform/*` | 11 — overview, workspaces (list/new/detail), users, subscriptions, plans, settings, audit, ai-usage, system-health | Platform Owner console |
| `(workspace)/[workspaceSlug]/*` | 113 | tenant application (Sales, People, Reports, settings) |
| `f/[workspaceSlug]/[formKey]`, `l/[workspaceSlug]/[pageSlug]`, `rsvp/[token]`, `testimonial/[token]` | 4 | public, unauthenticated pages |

Error surfaces: `src/app/error.tsx`, `not-found.tsx`; `loading.tsx` for the
platform and workspace groups. No `global-error.tsx` found. E1.

Navigation is a pure function `buildWorkspaceNav()` in
`src/lib/nav/workspaceNav.ts` (groups Home, Sales, People, Reports … with
"Show all" long tails), rendered by `components/workspace/WorkspaceSidebar.tsx`,
`MobileTabBar.tsx`, `nav/TopBar.tsx`, `nav/CommandPalette.tsx`. E1.

## Authentication handling

- Server components call `requestCtx()` (`src/lib/workspace-page.ts`, React
  `cache`d) → `resolveCtx()`; the workspace layout redirects to `/login` when
  there is no shell and to the security page when MFA enrolment is pending
  (`(workspace)/[workspaceSlug]/layout.tsx`). E1.
- The browser talks to the API with the `lf_session` cookie
  (`credentials: 'same-origin'`). `src/lib/auth/client.ts` implements a
  single-flight `refreshSession()` on 401 with at most one retry and a
  fail-closed `onSessionEnded` broadcast. E1.
- No tokens are stored in `localStorage`; no `NEXT_PUBLIC_*` secret exists —
  the only public variables are product/company display names
  (`src/lib/branding.ts`). E1.

## State management and data access

- No global state library (0 references to SWR, React Query, Zustand, Redux).
  Server components load data via services with `Ctx`; client components use
  `useState`/`useEffect` and `fetch` to `/api/v1` (8 files import the auth
  fetch wrapper; others call `fetch` directly). E1.
- Grid/list infrastructure: `components/workspace/ConfigurableGrid.tsx`,
  `ListHeader.tsx`, `Pager.tsx`, `ColumnEditor.tsx`; `src/lib/grid/*`
  (column definitions persisted per user — `admin/grid-columns` route). E1.
- PWA: `public/sw.js`, `public/offline.html`, `src/app/manifest.ts`,
  `components/pwa/ServiceWorkerRegistration.tsx`, `NativePush.tsx`. E1.
- Assistant: `components/assistant/AssistantWidget.tsx` (ONE AI panel,
  opened via `lf:open-ai` event; `/api/v1/assistant`). E1.

## Major modules (UI)

Sales (leads, opportunities, accounts, contacts, calls, follow-ups, targets,
commissions, leadership, calendar, smart views, activities, site visits,
projects/listings/requirements (real estate), client profiles, testimonials,
referrals, inbox/communications, campaigns, social leads, events, forms,
landing pages, field sales, service, products, documents, allocation,
automation, team feed, contests, awards, playbook, practice, slab rules) and
People (employees, attendance, leave, check-in, performance, lifecycle,
onboarding, offboarding, overtime, my pay, payroll). E1
`src/lib/nav/workspaceNav.ts`.

## Reusable components

`components/ui/*` (PageHeader, EmptyState, MetricCard, AiInsight, Badge,
StageRail …), `components/forms/*`, `components/workspace/*`,
`components/nav/*`, `components/platform/*`, `components/brand/YouhanMark.tsx`,
`components/auth/AuthShell.tsx`, `components/communications/*`,
`components/sales/*`. E1.

## Notable patterns

- Server-first pages; client islands only where interaction needs it.
- The tenant is never in client state as an authority; it is derived
  server-side from the session for every request. E1.
- Sentence-case UI copy, tabular numerals for metrics (`.lf-num`,
  `font-variant-numeric`), 8-px spacing scale — tokens in `tokens.css`. E1.

## Recommended future state (separate from current)

- Decide and document the Tailwind-vs-`.lf-*` boundary (today both exist).
- Add `global-error.tsx` for root-level failures.
- Land the redesign and update the two design-system documents in the same
  change.

## Evidence Sources

E1: `apps/web/src/app/**`, `src/components/**`, `src/lib/nav/*`,
`src/lib/auth/client.ts`, `src/lib/workspace-page.ts`, `src/lib/branding.ts`,
`src/styles/tokens.css`, `src/app/globals.css`, `public/sw.js`.
E2: `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `package.json`.
E4: `apps/web/docs/08-DESIGN-SYSTEM.md`, `docs/PREMIUM-UI-DESIGN-SYSTEM.md`.
