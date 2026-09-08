# Migration change check

## Result

**VERIFIED — Phase A created no migration and made no schema change.** No
database command of any kind was executed against any database as part of
Phase A. No production or staging database was accessed.

## Checks

| Check | Result |
|---|---|
| `git status --porcelain -- apps/web/prisma` | 0 entries (UNCHANGED) |
| `git status --porcelain -- apps/web/prisma/schema.prisma` | 0 entries (UNCHANGED) |
| `git status --porcelain -- apps/web/prisma/migrations` | 0 entries (UNCHANGED) |
| Migration directories at HEAD | 65 |
| Migration directories in the working tree | 65 |
| Difference | none |

The first migration is `20260803000000_baseline`; the most recent is
`20260904080000_platform_scoped_password_reset`. `migration_lock.toml` is
present and unmodified.

`prisma/legacy-migrations/` (one entry, `20260729083313_init`) and
`prisma/schema.pre-unified.prisma` are pre-unification artefacts, labelled
`Legacy / potentially inactive` in `docs/architecture/DATABASE.md`. They were
read, not modified.

## Schema state recorded for the baseline

Observed, not altered: 201 models, 105 enums, 435 `@@index`, 104 `@@unique`;
188 models declare `tenantId`; 53 declare `deletedAt`. 26 migration files
contain `FORCE ROW LEVEL SECURITY`.

## Explicit non-actions

Phase A did not run, and this verification did not run: `prisma migrate
dev`, `migrate deploy`, `migrate reset`, `migrate resolve`, `db push`,
`db seed`, `prisma studio`, or any `psql` statement. No schema drift check
was executed either, so the current drift status is **not** asserted by
Phase A; `npm run check:drift` is a CI gate and its latest result is
`UNKNOWN — requires runtime/infrastructure verification` from inside this
environment.

## Evidence Sources

E1: `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/` (listing
only), `git ls-tree HEAD:apps/web/prisma/migrations`.
E2: `apps/web/prisma.config.ts`, `.github/workflows/ci.yml`.
