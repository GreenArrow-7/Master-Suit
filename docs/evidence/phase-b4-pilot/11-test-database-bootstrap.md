# Test-database bootstrap — investigation and proven procedure

| Field | Value |
|---|---|
| Finding | `SPEC-0003/CONV-003` |
| Date | 2026-09-08 |
| Outcome | **Cause found and the instance fixed. The workflow gap remains.** |
| Result | vitest `1874 passed / 42 failed` → **`1892 passed / 24 failed`** |
| Decision owner | **DevOps / Production Engineering** |

---

## What was actually wrong

Not "the test database was never created". It exists.

`master_saas_test` was **one migration behind**:

```
The migration have not yet been applied:
20260904080000_platform_scoped_password_reset
```

That is exactly the migration adding `PasswordResetToken.platformUserId`, the
column whose absence produced every `password-reset` and
`forgot-password-flow` failure.

It also carries **two migrations that no longer exist in the repository**:

```
The migrations from the database are not found locally in prisma/migrations:
20260901120000_live_ai_call_assist
20260901120500_live_assist_audit_events
```

So its schema still describes things the repository has removed. That half is
**not** fixed by applying the missing migration and is recorded below.

## Why nobody noticed

`apps/web/scripts/generate-secrets.mjs` states, in a comment explaining why CI
generates only `.env`:

> `.env.test` points DATABASE_URL at a separate `master_saas_test` database
> **that a developer creates with `npm run setup`**

**That is not true of the code.** `npm run setup` is:

```
generate-secrets.mjs && docker:up && wait-for-db.mjs && prisma migrate deploy && db:seed
```

`prisma migrate deploy` resolves its datasource through `prisma.config.ts`,
which reads `MIGRATION_DATABASE_URL` from **`.env`** — pointing at `leadflow`.
And `infra/docker-compose.yml` creates only `POSTGRES_DB: leadflow`.

**Nothing in the repository creates or migrates `master_saas_test`.** The
comment describes a workflow that does not exist, which is why the drift went
unobserved.

## The proven procedure

Run and verified on this workstation, 2026-09-08. Loopback only; every port in
`infra/docker-compose.yml` is bound to `127.0.0.1`.

```bash
cd apps/web
npm run docker:up

# .env.test already carries a complete configuration, including the owning
# role migrations need. Nothing has to be invented.
export MIGRATION_DATABASE_URL=$(grep '^MIGRATION_DATABASE_URL=' .env.test | cut -d= -f2- | tr -d '"')
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2- | tr -d '"')

npx prisma migrate status     # read-only: shows exactly what is behind
npx prisma migrate deploy     # applies existing migrations only
```

`.env.test` was already correct:

| Variable | Role | Database |
|---|---|---|
| `DATABASE_URL` | `master_saas_app` | `master_saas_test` |
| `MIGRATION_DATABASE_URL` | `leadflow` (owner) | `master_saas_test` |

The separation matters and is deliberate: a table owner bypasses row-level
security, so the application must never hold the migration role.
`src/lib/startup-check.ts` refuses to boot if the two are ever equal.

## What was deliberately not done

- **No migration was created.** `migrate deploy` applies existing ones only.
- **No schema change.** `prisma/schema.prisma` untouched.
- **No `migrate reset`.** A reset would have cleared the two orphaned
  migrations too, but it is destructive and the minimal action was sufficient.
- **No production or staging contact.** Loopback container only.
- **No script added.** Adding one touches `apps/web/package.json` and
  `SETUP.md`, which is outside both `SPEC-0003` and `SPEC-0002`.
- **No secret printed.** Values were piped into environment variables and
  every command's output was passed through a redaction filter.

## Result

| | Before | After |
|---|---|---|
| Passed | 1874 | **1892** |
| Failed | 42 | **24** |
| Failing files | 8 | 5 |

**18 failures fixed.** `password-reset` (11), `forgot-password-flow` (6) and
`p2-regressions` (1) no longer appear.

### A correction to the earlier analysis

The first convergence attributed **all 30** non-`EVC-014` failures to the stale
database. **That was wrong for 12 of them.** `assistant-guardrails` (11) and
`guarded-prologue` (1) did not move, because their assertions are static
analysis of source text rather than database queries. They are now recorded
separately as `CONV-011`.

The remaining 24 are:

| Count | Files | Cause |
|---|---|---|
| 12 | `capture-vault`, `env-example-parses`, `observability` | `EVC-014` — Windows path separators, CRLF, POSIX file modes |
| 12 | `assistant-guardrails`, `guarded-prologue` | `CONV-011` — pre-existing drift in AI assistant tool permissions |

## What still needs a decision

**A documented, deterministic preparation workflow.** The commands above are
proven; turning them into something a fresh clone runs is the remaining work,
and it needs authorisation because it touches the product repository.

| Option | What it changes | Cost |
|---|---|---|
| **A** | Add `db:test:setup` to `apps/web/package.json` wrapping the commands above, and document it in `SETUP.md` | small; touches `package.json` and one doc |
| **B** | Extend `npm run setup` to prepare both databases, making the existing comment true | small, but changes an existing developer command |
| **C** | Create the database in `infra/docker-compose.yml` via an init script, and migrate it in `setup` | larger; touches infrastructure |
| **D** | Correct the comment in `generate-secrets.mjs` to say no such workflow exists, and leave preparation manual | smallest; honest, but leaves the trap |

**No option is selected.** Each is a DevOps judgement about where this belongs.

### The orphaned migrations are a separate question

Two migrations applied to `master_saas_test` no longer exist in the repository.
Applying the missing migration did not remove them, and a `migrate reset` is
the usual remedy for a disposable test database. That was **not** done here
because it is destructive and was not necessary to establish the cause.

Whether to reset is part of the same DevOps decision.

## Bearing on pilot #2

**`REQUIRED`.** Until a fresh clone can prepare `master_saas_test`
deterministically, `npm test` cannot serve as a regression gate for any future
pilot: a real regression in those five files would be indistinguishable from
environmental noise. That is unchanged by this pass having fixed the instance
on one workstation.
