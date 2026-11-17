# Instructions for an AI assistant working on YOUHAN ONE

Read this before anything else. It exists so you do **not** re-scan, re-audit or
rediscover a codebase that is already documented.

---

## 1. Read in this order, and stop when you have enough

1. **`CURRENT_STATUS.md`** — where the project stands today, and the next step.
2. **`changes/README.md`** — the index of every change since 5 Oct 2026, newest first.
3. **`changes/PROJECT.md`** — the architecture and the rules every change follows.
   This is the map. Trust it.
4. **The `changes/` entry for the area you are touching** — each one records what
   changed, why, which files, and what was verified.
5. **`PROJECT_HANDOVER.md`** — the long form, when you need setup, environment or
   history.

Only then open source files, and only the ones your task needs.

**Do not** run a full-repository scan, a dependency audit or a "let me understand
the codebase" sweep. It is 231 Prisma models, 256 API routes, 249 pages and 395
spec files; a sweep burns a large amount of context and tells you less than
`changes/PROJECT.md` already does.

---

## 2. Rules you must not break

These have each broken the build or production before.

1. **Tenancy.** Every Prisma query names its tenant. `update` or
   `findFirstOrThrow` by id alone is **refused at runtime** — use
   `updateMany({ where: { tenantId, id } })`. Inside `withTx`, query only through
   `tx`. Cross-tenant reads go through `withPlatformTx` and nothing else.
2. **API routes** use `route()` from `src/lib/api/handler.ts` with
   `{ module, action, productModule, rateLimit, auditEvent }`. A `route.ts` file
   exports **only** HTTP handlers.
3. **Audit.** Every POST/PATCH/PUT/DELETE declares `auditEvent`, calls
   `audit(ctx, …)`, or is listed in `tests/unit/mutation-audit.spec.ts` with a
   reason. That test fails the build otherwise.
4. **OpenAPI.** After adding or changing a route, regenerate:
   `OPENAPI_WRITE=1 npx vitest run tests/unit/openapi.spec.ts`, then run it again
   without the flag.
5. **Out of scope answers 404**, never 403.
6. **A new queue consumer** must be added to `QueueHasNoConsumer` in
   `apps/web/infra/prometheus-alerts.yml` and to the queue lists in
   `docs/DEPLOY-AZURE.md` and `docs/product/RELEASE-RUNBOOK.md`. Prefer reusing
   an existing queue (there are 11).
7. **New env vars** go in `src/lib/env.ts` (optional) and in `.env.example` with
   an **empty** value.
8. **Migrations** get a timestamped folder newer than every existing one, and
   keep row-level security exactly as the newest tenant tables do.
9. **Prettier and ESLint** gate `apps/web`. Run
   `node_modules/.bin/prettier --write` on every file you touched. Never put a
   literal BOM or non-breaking space in source.
10. **No new dependency** where a few lines of standard library or platform code
    will do.
11. **Own branding only.** Never copy a competitor's name, logo, colours or layout.
12. **One record, several screens.** Real Estate and Lead Eagle pages re-export
    Sales pages. **Never add a parallel model.**

---

## 3. Every change ships its entry

This is the repository's own rule (`CLAUDE.md`), and it is what keeps the next
session cheap:

- A new file `changes/YYYY-MM-DD-short-name.md` with the sections
  **What · Why · Where · Behaviour · Verified · Left open** (a few lines each).
- A row at the **top** of the index table in `changes/README.md`.
- A correction to `changes/PROJECT.md` wherever the change makes it wrong.

*A change without its entry is not finished.*

Also update `CURRENT_STATUS.md` when the project's position moves, and
`PROJECT_HANDOVER.md` when architecture, setup or roadmap changes.

---

## 4. How to verify before you claim anything works

From `apps/web`:

| Check | Command |
|---|---|
| Types | `rm -rf .next/dev/types && npx tsc --noEmit` |
| Unit + integration | `npx vitest run [files]` (needs Postgres and Redis) |
| Everything CI gates | `npm run lint`, `npm run format:check`, `npm run check:rls`, `check:permissions`, `check:drift`, `check:observability` |
| Browser | `npx playwright test` |
| Production build | `npx next build` with `NODE_ENV` **unset** |

A behaviour fix ships with a test that **fails on the old code** — prove it by
reverting the fix once and watching the test fail.

---

## 5. Git and release discipline

- Branch from `main`. Never force-push. Never push to `main`.
- **Merge only after CI passes on the exact commit being merged.** If `main`
  moved, merge it in and wait for CI again.
- Commit messages end with a blank line and
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **The owner runs production releases.** Hand over the exact command with the
  full 40-character SHA and the migration count; never SSH to production.

---

## 6. What not to do

- Do not rebuild a feature listed as complete in `CURRENT_STATUS.md` — check the
  `changes/` entry first.
- Do not redo PR #224's phone-app version bump; it is written and waiting on keys.
- Do not "modernise", reformat or restructure code you were not asked to change.
- Do not read or print `.env` files, credentials, tokens or database URLs.
- Do not sign in to third-party services or create accounts.
- Do not remove the iOS version from App Store review to resubmit — it loses its
  place in the queue.

---

## 7. When something is missing

Ask. Specifically: which workspace, which role, which module, which environment.
Do not guess at product behaviour — a wrong guess here means a wrong permission
scope, and permission mistakes in this codebase are data leaks.

If a document contradicts the code, **the code wins** — then fix the document in
the same change.
