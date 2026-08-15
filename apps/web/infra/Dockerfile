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

# ── runtime ──────────────────────────────────────────────────────────────────
# Alias for the stage above, kept so `--target runtime` still resolves.
FROM production AS runtime
