# Coding Standards

Current observed conventions, extracted from the code and the tooling
configuration. Recommendations are kept separate at the end.

## Current observed standard

**Language and typing**
- TypeScript everywhere in `apps/web` (`strict: true`, path alias `@/*`);
  Python 3.12 in `apps/face`. `@typescript-eslint/no-explicit-any` is a
  warning (off in tests), so `any` exists but is visible. E2
  `tsconfig.json`, `eslint.config.mjs`.
- Types are declared next to their use (`export interface`/`export type` in
  the module that owns them); Zod schemas double as runtime and static types
  (`z.infer`). E1.

**Folder structure** (`apps/web/src`)
```
app/          route groups (auth) (platform) (workspace), api/v1/**, public pages
components/   ui, workspace, nav, forms, platform, assistant, brand, pwa, sales, communications, auth
lib/          api, auth, security, ai, integrations, jobs, events, nav, grid, push, pwa, inventory + flat modules (db, env, queue, redis, logger, metrics, storage, mailer, …)
services/     one folder per business domain, functions taking Ctx
workers/      one file per BullMQ queue + index.ts
styles/       tokens.css
```
E1.

**Naming**
- Files: `camelCase.ts` for modules, `PascalCase.tsx` for components,
  `route.ts`/`page.tsx`/`layout.tsx` per Next conventions, `kebab-case` for
  route segments and scripts, `*.spec.ts` for tests. E1/E2.
- Symbols: `camelCase` functions/variables, `PascalCase` types and
  components, `SCREAMING_SNAKE` module constants, `assertX`/`requireX` for
  throwing guards, `canX`/`isX` for predicates. E1.
- CSS: `.lf-<block>__<element>--<modifier>` with `--yh-*` / `--lf-*` custom
  properties. E1.

**Async**
- `async/await` throughout; `@typescript-eslint/no-floating-promises` is an
  **error**, so every promise is awaited or explicitly voided
  (`void shutdown(...)`). `no-misused-promises` on (with
  `checksVoidReturn: false`). Timeouts via `AbortSignal.timeout(...)` on
  outbound fetches. E1/E2.

**Validation**
- Zod at every boundary: route `params/query/body`, env, cursors, filter
  trees. Parsed values are used; raw inputs are not passed on. E1.

**Error handling**
- `AppError` subclasses and helper constructors; no bare `throw new Error`
  for user-facing failures. See `docs/standards/ERROR_HANDLING.md`. E1.

**Data access**
- Services take `Ctx` first; queries go through the extended Prisma client
  so the tenant guard applies; raw SQL only inside tenant transactions. E1.

**Reusable utilities** (prefer these over new ones)
`lib/api/{handler,guarded,pagination,filterTree,where,read-body}`,
`lib/auth/*`, `lib/security/*`, `lib/{db,env,logger,metrics,queue,redis,
storage,mailer,csv,pdf,geo,publicLink,theme,branding,build}`,
`components/ui/*`, `lib/grid/*`, `lib/nav/*`. E1.

**Comments**
- The codebase's distinctive habit: block comments that explain *why* a
  design exists and what failure it prevents (see `src/lib/security/
  ratelimit.ts`, `scripts/backup-ship.sh`). New non-obvious decisions are
  expected to carry the same. E1.

**Formatting and linting**
- Prettier 3.9.6: `printWidth: 120`, `singleQuote: true`,
  `trailingComma: 'all'`, `arrowParens: 'always'`; `.prettierignore` excludes
  build output, generated Prisma client, migrations, reports.
  `npm run format:check` = `prettier --check .` and is a CI gate.
- ESLint 9 flat config with `eslint-config-next` and type-aware rules;
  `no-console` error (allow `warn`/`error`), `no-unused-vars` with an
  underscore escape; per-area overrides for scripts, tests and two Next/React
  rules. `npm run lint` gates on errors; warnings (122 at present) do not
  fail CI. E2.
- Line endings: files are LF in git; Windows checkouts are CRLF
  (`core.autocrlf=true`), which makes `prettier --check .` report every text
  file locally. Use `--end-of-line auto` when checking on Windows. VERIFIED
  in this workstream. Three unit specs fail on Windows for the same class of
  reason — **EVC-014**.

**Dependency patterns**
- Few, deliberate dependencies (18 runtime); platform features preferred
  (`fetch`, `node:crypto`, `AbortSignal`). New dependencies are justified in
  the change (`AGENTS.md` §6). E2.

**Tests**
- Vitest specs mirror the area they cover (`tests/{unit,tenant,permission,
  security,hr,sales,integration,server}`); Playwright specs in `tests/e2e`.
  Names read as sentences (`returns the same relative path shape the punch
  column already holds`). E3.

## Recommended future standard (not current)

- Decide the Tailwind vs `.lf-*` boundary and write it down; today both are
  in use.
- Drive the `any` warning count to zero, or ratchet it in CI.
- Add `.gitattributes` (`* text=auto eol=lf`) so Windows checkouts stop
  producing spurious `prettier --check` failures.
- If the layering in `apps/web/docs/00-ARCHITECTURE.md` §2 is still the
  intent, either introduce the repository layer or update that document to
  the current route→service→Prisma reality.

## Evidence Sources

E1: `apps/web/src/**` (sampled across app, lib, services, workers,
components), `src/styles/tokens.css`.
E2: `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`,
`.prettierignore`, `package.json`, `.github/workflows/ci.yml`.
E3: `apps/web/tests/**`.
E4: `apps/web/docs/00-ARCHITECTURE.md`, `apps/web/docs/08-DESIGN-SYSTEM.md`.
