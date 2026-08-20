# Local development performance

Measured 2026-08-11 on this machine, against the seeded `manath-homes` workspace.

## Which endpoints the running application actually uses

Not "the containers are green" — the endpoints themselves:

```
DATABASE_URL host -> localhost:5432
REDIS_URL    host -> localhost:6379
```

There is **no Upstash** and **no remote PostgreSQL** anywhere in this repository:
`grep -rilE "upstash" --include=".env*" .` returns nothing, and neither does a
search for a non-local database host. Nothing in Sydney or any other region is
in the request path.

`localhost` is correct **here specifically**, because the web application is not
containerised in this setup. Port 3000 is held by a Windows host process:

```
TCP 0.0.0.0:3000 LISTENING 22104
  "C:\Program Files\nodejs\node.exe" ".../next/dist/server/lib/start-server.js"
```

Only `postgres`, `redis` and `minio` run in Docker, with their ports published,
so the host process reaches them over `localhost`. Rewriting those URLs to
`postgres:5432` / `redis:6379` would break this setup, because those names only
resolve inside the compose network. They are the right names for the
containerised path, and that is exactly what the `web` and `worker` services in
`infra/docker-compose.yml` already use.

There is also a stopped `infra-web-1` container, `Exited (255) 7 days ago`. It
belongs to a **different compose project** — `C:\Users\admin\Downloads\Sales Lead
Flow\infra\docker-compose.yml`, the pre-unification original — and is not part
of this application. It is a leftover, not a participant.

### Environment precedence inside the container

`infra/docker-compose.yml` lists both `environment:` and `env_file: [../.env]`
on the `web` service. Compose gives `environment:` the higher precedence
regardless of the order they appear in, so the host `.env` — which necessarily
says `localhost`, because local development also runs the app straight on the
host — cannot reach into the container and point it at a port that means
something different there. `docker-compose.dev.yml` restates the two URLs
anyway, so the guarantee is visible at the file you are actually reading.

## Where the latency is

Neither datastore. Both are sub-millisecond from the application process:

| Probe                             | p50                     | p95    |
| --------------------------------- | ----------------------- | ------ |
| PostgreSQL `SELECT 1`             | 0.4 ms                  | 1.2 ms |
| PostgreSQL `count(*) from "User"` | 0.8 ms                  | 4.2 ms |
| Redis `PING`                      | 0.4 ms                  | 1.0 ms |
| PostgreSQL connect                | 19 ms (cold), 6 ms warm |

IPv4 and IPv6 connect identically (6 ms each), so the usual Windows
`localhost` → `::1` penalty is not in play either.

The time is in the **Turbopack development server**. Same machine, same
database, same seeded data, same requests — the only variable is `next dev`
versus a `next build` artefact:

| Route      | dev p50 | prod p50   | dev p95 | prod p95   | p50 speedup |
| ---------- | ------- | ---------- | ------- | ---------- | ----------- |
| Check-in   | 620 ms  | **170 ms** | 1019 ms | **305 ms** | 3.6x        |
| Users      | 1000 ms | **161 ms** | 1571 ms | **209 ms** | 6.2x        |
| Leave      | 1735 ms | **218 ms** | 2451 ms | **341 ms** | 8.0x        |
| Attendance | 968 ms  | **148 ms** | 1097 ms | **184 ms** | 6.5x        |
| Roles      | 966 ms  | **180 ms** | 1849 ms | **267 ms** | 5.4x        |

Warm requests, 12–15 samples each, authenticated, full HTML read to completion.
Reproduce with `.verify/routetimes.mjs`.

The practical consequence: **never quote a dev-server number as a product
latency**. A page that takes 1.7 s to compile-and-render in development answers
in 218 ms from the build.

## The bind mount is a real risk

This repository lives at `C:\Users\admin\Downloads\Master App\master-saas`.
Bind-mounting a Windows path into a Linux container crosses a filesystem
boundary, and every `stat()` pays for the crossing. Next's dev server stats tens
of thousands of files per compile, so the cost lands squarely on the slowest
thing here.

Two mitigations, in order of preference:

1. **Move the working copy onto the Linux filesystem.** Clone into the WSL2
   distribution's own filesystem (`~/src/master-saas`, i.e. `\\wsl$\...`) rather
   than `/mnt/c/...`, and run the dev server from there. This removes the
   boundary rather than working around it.
2. **Keep the source bind-mounted, but not the build output.**
   `docker-compose.dev.yml` puts `node_modules` and `.next` on Docker-managed
   named volumes. Those two directories hold nearly all the files and are never
   hand-edited, so keeping them inside the VM's own filesystem recovers most of
   the loss. It also stops the host's win32 `node_modules` from shadowing the
   container's Linux build, which is a correctness problem as much as a speed
   one.

## Configurations

| File                            | Purpose                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `infra/docker-compose.yml`      | Base: postgres, redis, minio, clamav, face, web, worker                               |
| `infra/docker-compose.dev.yml`  | Local postgres + redis, hot reload, named volumes for build output                    |
| `infra/docker-compose.prod.yml` | `next build` artefact served by the standalone server; no dev server, no source mount |

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up web
```

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d
```

`next start` is deliberately not used: `next.config` sets `output: 'standalone'`
and `next start` refuses to serve that, so production runs `node server.js`.
