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
RUN npx prisma generate && npm run build

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

USER leadflow
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# ── runtime ──────────────────────────────────────────────────────────────────
# Alias for the stage above, kept so `--target runtime` still resolves.
FROM production AS runtime
