# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── development ──────────────────────────────────────────────────────────────
# The dev server, for `docker-compose.dev.yml`. Source arrives by bind mount, so
# nothing is copied in; node_modules comes from this stage rather than the host,
# because the host's copy is built for win32 and its binaries will not run here.
FROM node:22-alpine AS development
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` evaluates lib/env.ts while collecting page data, so the whole zod
# schema in that file has to be satisfied for the compile to finish. A fresh
# clone has no .env — it is gitignored — so without these the build fails on a
# deployment host with a wall of validation errors before it writes a byte.
#
# The values are deliberately throwaway and reach nothing: .env* is dockerignored
# so no real secret is ever copied into a layer, runtime configuration arrives by
# env_file, and the only NEXT_PUBLIC_ variable in the application is the product
# name — so nothing here can be baked into the client bundle. The two keys are
# generated per build rather than hardcoded, so an image cannot accidentally ship
# a known encryption key that some environment then fails to override.
RUN npx prisma generate && \
    APP_URL=http://build.invalid \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    S3_ENDPOINT=http://127.0.0.1:9000 \
    S3_REGION=build S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build S3_SECRET_ACCESS_KEY=build \
    FIELD_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
    WEBHOOK_SIGNING_PEPPER="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
    npm run build

# ── production ───────────────────────────────────────────────────────────────
# `next build` output served by the standalone server. Named `production` for
# the compose overlay; `runtime` stays as an alias so existing builds that ask
# for it by name keep working.
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S leadflow && adduser -u 1001 -S leadflow -G leadflow

COPY --from=build --chown=leadflow:leadflow /app/.next/standalone ./
COPY --from=build --chown=leadflow:leadflow /app/.next/static ./.next/static
COPY --from=build --chown=leadflow:leadflow /app/prisma ./prisma

# ATTENDANCE_CAPTURE_DIR writes here. Created in the image and owned by the
# runtime user, because a named volume mounted over a path that does not exist
# in the image arrives root-owned, and uid 1001 then cannot write a single
# check-in capture.
RUN mkdir -p /app/storage/attendance && chown -R leadflow:leadflow /app/storage

USER leadflow
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# ── worker ───────────────────────────────────────────────────────────────────
# The queue consumers: `src/workers/index.ts` and everything it reaches.
#
# This stage exists because the `production` stage cannot serve it. That image
# holds `next build`'s standalone output — a bundled HTTP server and nothing
# else. The worker is a second entry point into the same `src/` tree, and Next
# does not compile it, so there is no built artefact for it anywhere.
#
# The compose files used to paper over that with `node dist/workers/index.js`.
# Nothing in this repository has ever produced `dist/`: `tsconfig.json` sets
# `noEmit`, no script runs `tsc -p`, and `dist/` is gitignored. The container
# therefore exited immediately on every deployment, and because nothing else
# depends on it, `docker compose up -d` still reported success. Every queue went
# unconsumed in silence — inbound Meta leads stored and never applied, AI
# analyses PENDING forever, recordings left on the vendor, SLA never escalated.
#
# So the worker runs its TypeScript directly, through `tsx`, exactly as
# `npm run worker` does on a laptop. One code path, one resolver, one set of
# semantics — rather than a second build whose output only production executes,
# and which therefore only breaks in production.
#
# `tsconfig.json` is copied because tsx reads `paths` from it to resolve the
# `@/*` imports the worker tree uses throughout.
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV PROCESS_ROLE=worker

RUN addgroup -g 1001 -S leadflow && adduser -u 1001 -S leadflow -G leadflow

# From `build` rather than `deps`: that stage has already run `prisma generate`,
# so node_modules carries the generated client the worker needs.
COPY --from=build --chown=leadflow:leadflow /app/node_modules ./node_modules
COPY --from=build --chown=leadflow:leadflow /app/src ./src
COPY --from=build --chown=leadflow:leadflow /app/prisma ./prisma
COPY --from=build --chown=leadflow:leadflow /app/package.json /app/tsconfig.json ./

# The retention sweep reads ATTENDANCE_CAPTURE_DIR. Same reasoning as the web
# stage: a named volume mounted over a path absent from the image arrives
# root-owned, and uid 1001 cannot write to it.
RUN mkdir -p /app/storage/attendance && chown -R leadflow:leadflow /app/storage

USER leadflow

# No HTTP surface, so no HTTP health check. src/workers/index.ts exits non-zero
# if a queue fails to attach, which is what makes `restart: unless-stopped`
# meaningful: a worker that cannot consume must die rather than idle.
CMD ["node_modules/.bin/tsx", "src/workers/index.ts"]

# ── runtime ──────────────────────────────────────────────────────────────────
# Alias for the web stage above, kept so `--target runtime` still resolves.
FROM production AS runtime
