# Setup

## One command

```powershell
npm install
npm run setup
npm run dev
```

`npm install` generates the Prisma client. `npm run setup` writes secrets, starts
Docker, waits for Postgres, migrates and seeds. `npm run dev` runs preflight first
and refuses to start with a plain-English fix if anything is missing.

Sign in at http://localhost:3000

| Field     | Value                        |
| --------- | ---------------------------- |
| Workspace | `meridian`                   |
| Email     | `amina.alrashid@example.com` |
| Password  | `Meridian!Demo2026`          |

The seed prints eight other accounts covering every role.

## Requirements

- **Node 20.19+, 22.12+ or 24+** — Prisma 7 aborts its install below this
- **Docker Desktop, running** — Postgres, Redis and MinIO live there

## If something fails

```powershell
npm run preflight
```

It checks Node, `.env`, the Prisma client, Postgres and Redis, and prints the
exact command to fix whatever is wrong.

## `npm install` is not optional

Every other failure follows from skipping it. If `npx prisma generate` says
_"Need to install the following packages: prisma"_, `node_modules` does not exist
in this folder — run `npm install` first. Extracting a fresh copy of the project
means installing again; `node_modules` is never shipped in the archive.

## The failures everyone hits

**`Cannot find module '.prisma/client/default'`**

npm 12 blocks package install scripts, so Prisma's postinstall never generated
the client. The bundled `.npmrc` allow-lists it, but if you installed before
pulling that file:

```powershell
npm approve-scripts --allow-scripts-pending
npx prisma generate
```

**`P1001: Can't reach database server at localhost:5432`**

Docker isn't running, or the containers aren't up in this folder.

```powershell
npm run docker:up
docker compose -f infra/docker-compose.yml ps
```

Wait for postgres to report `healthy`.

**Compose says postgres "Started" but `ps` doesn't list it**

The container is starting and exiting immediately. Compose prints "Started" either
way, which makes this look like a connection problem when it is a crash.

```powershell
docker compose -f infra/docker-compose.yml ps -a      # shows Exited
docker compose -f infra/docker-compose.yml logs postgres
```

If the log mentions an unrecognised option, you are on a build before v4 — the
`command:` block used `-c=key=value`, which Postgres rejects. Take the current
`infra/docker-compose.yml`, then:

```powershell
docker compose -f infra/docker-compose.yml down -v
npm run docker:up
```

`down -v` also clears the data volume, which resolves a corrupt data directory
from a half-initialised container.

## Commands

| Command                                             | Does                       |
| --------------------------------------------------- | -------------------------- |
| `npm run setup`                                     | Full first-time setup      |
| `npm run preflight`                                 | Diagnose what's broken     |
| `npm run dev`                                       | Start the app              |
| `npm run docker:up` / `docker:down` / `docker:logs` | Manage containers          |
| `npm run db:seed -- --reset`                        | Rebuild the demo workspace |
| `npm run db:studio`                                 | Browse the database        |
| `npm run secrets`                                   | Regenerate `.env` secrets  |
| `npm run db:test:prepare`                           | Prepare + seed the test DB |
| `npm run db:test:reset`                             | **Drop** and rebuild it    |

## Before you run the tests

`npm run setup` prepares `leadflow`, the database `.env` names. It does **not**
touch `master_saas_test`, which is the separate database `.env.test` names and
the one Vitest actually connects to. Prepare that one once:

```bash
npm run db:test:prepare
```

It creates the database if it is missing, applies the existing migrations, and
seeds it. It is safe to re-run: the migrations are already applied and the seed
is upsert-based, so a second run changes nothing the first did not. It refuses
any host that is not loopback, and any database whose name does not identify it
as a test database. It prints no connection string and no credential.

**This is the authoritative local equivalent of what CI runs**, which is why it
seeds:

| | CI (`.github/workflows/ci.yml`) | Local |
| --- | --- | --- |
| 1 | `prisma migrate deploy` | `npm run db:test:prepare` |
| 2 | `npm run db:seed` | (the same, included) |
| 3 | `npm test` | `npm test` |

Do **not** substitute `npm run db:seed` for step 2 by hand. The seed reads
`.env`, which names `leadflow` — so run on its own it seeds the *development*
database while the tests read `master_saas_test`. `db:test:prepare` passes
`.env.test`'s values to it explicitly, which is what makes the target
unambiguous.

Without the seed one test skips locally that runs in CI:
`tests/permission/engagement-modules.spec.ts` → *"grants each role exactly what
it already had on leads — never more"*. It needs a tenant to have roles to
compare, and it is the assertion that proves the engagement migration did not
grant a role more than its `leads` access. Skipping it locally means the check
most worth having before a permission change is the one you never run.

`npm run db:test:reset` **drops** the database and rebuilds it from the
migrations, then seeds it. It is a separate command precisely so that "prepare"
can never destroy anything.

If the unit suite fails with a missing column on a table you have not touched,
this is almost always the reason: the test database is behind.

## Seeing the UI without any of this

Open `leadflow-design-system.html` in a browser. No build, no database.
