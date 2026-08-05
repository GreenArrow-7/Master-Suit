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

| Field | Value |
|---|---|
| Workspace | `meridian` |
| Email | `amina.alrashid@example.com` |
| Password | `Meridian!Demo2026` |

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
*"Need to install the following packages: prisma"*, `node_modules` does not exist
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

| Command | Does |
|---|---|
| `npm run setup` | Full first-time setup |
| `npm run preflight` | Diagnose what's broken |
| `npm run dev` | Start the app |
| `npm run docker:up` / `docker:down` / `docker:logs` | Manage containers |
| `npm run db:seed -- --reset` | Rebuild the demo workspace |
| `npm run db:studio` | Browse the database |
| `npm run secrets` | Regenerate `.env` secrets |

## Seeing the UI without any of this

Open `leadflow-design-system.html` in a browser. No build, no database.
