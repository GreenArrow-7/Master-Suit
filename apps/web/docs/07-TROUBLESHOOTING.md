# Setup Troubleshooting (Windows / PowerShell)

## `openssl` is not recognized

Windows has no openssl. Use the bundled script instead — it writes all three
secrets into `.env` in place:

```powershell
npm run secrets
```

## `The datasource.url property is required in your Prisma config file`

Prisma 7 no longer auto-loads `.env` for the CLI. `prisma.config.ts` now calls
`import 'dotenv/config'` explicitly. If it still fires, `.env` is missing or
`DATABASE_URL` is blank:

```powershell
Get-Content .env | Select-String DATABASE_URL
```

## `Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+`

Upgrade Node. The preinstall gate aborts the whole install, which is why `next`
and `tsx` never appear in `node_modules\.bin` afterwards.

```powershell
winget install OpenJS.NodeJS.LTS
node -v
```

## `EPERM: operation not permitted, rmdir` during npm install

Windows Defender or an open editor is holding handles inside `node_modules`.
Close VS Code and any terminal sitting in the folder, then:

```powershell
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install
```

A folder under `Downloads` is scanned more aggressively than one under `C:\dev`.
`Move-Item` fails while your shell is inside the directory — `cd ..` first.

## `failed to connect to the docker API at npipe:...`

The Docker CLI is installed but the engine is not running. Launch Docker Desktop,
wait for the whale to stop animating, then `docker version` should print a Server
section as well as a Client section.

## `P1001: Can't reach database server at localhost:5432`

Docker is running but the containers are not up **in this folder**. Compose scopes
containers per project directory, and a reboot or `docker compose down` stops them.

```powershell
npm run docker:up
docker compose -f infra/docker-compose.yml ps
```

Wait until postgres reports `healthy` before migrating. `npm run setup` does this
wait automatically.

## `GET / 404`

Fixed — the app previously had API routes but no pages. `/` now redirects to
`/login` or `/home` depending on session state.

## `Cannot find module '.prisma/client/default'`

**This is the npm 12 allow-scripts trap, and it is the single most common failure.**

npm 12 blocks package install scripts by default. Prisma's postinstall is what runs
`prisma generate` and writes `node_modules/.prisma/client`. When it is blocked, the
install *succeeds* — with a warning that is easy to scroll past — and then every
command that touches the database fails with an opaque MODULE_NOT_FOUND.

```powershell
npm approve-scripts --allow-scripts-pending
npx prisma generate
```

The bundled `.npmrc` allow-lists the four packages that need scripts, so a fresh
`npm install` handles this automatically. You only need the commands above if you
installed before that file existed.

## Diagnosing anything

```powershell
npm run preflight
```

Checks Node version, `.env`, the Prisma client, Postgres and Redis, and prints the
exact command to fix whatever is wrong. It runs automatically before `dev`,
`db:migrate` and `db:seed`.

## `12 vulnerabilities` from npm audit

Check what they are before acting; `npm audit fix --force` will happily downgrade
Next.js and break the build.

```powershell
npm audit --omit=dev
```

Anything that only appears under `devDependencies` does not ship in the runtime
image — see `infra/Dockerfile`, which installs with `npm ci` and builds a
standalone bundle.
