#!/usr/bin/env node
/**
 * Runs before dev, migrate and seed. Every check below corresponds to a failure
 * that otherwise surfaces as a confusing stack trace 200 lines deep.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { execSync } from 'node:child_process';

const problems = [];
const ok = [];

// 1. Node version — Prisma 7 aborts its own install below this ──────────────
const [maj, min] = process.versions.node.split('.').map(Number);
const nodeOk = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj >= 24;
if (nodeOk) ok.push(`Node ${process.versions.node}`);
else
  problems.push({
    what: `Node ${process.versions.node} is too old`,
    why: 'Prisma 7 requires 20.19+, 22.12+ or 24+.',
    fix: 'winget install OpenJS.NodeJS.LTS   (then reopen your terminal)',
  });

// 2. Dependencies installed — explains most downstream failures ────────────
const installed = existsSync('node_modules');
if (!installed) {
  problems.push({
    what: 'Dependencies are not installed',
    why: 'node_modules is missing, so nothing else can work.',
    fix: 'npm install',
  });
} else {
  ok.push('Dependencies installed');
}

// 3. .env present and filled ────────────────────────────────────────────────
if (!existsSync('.env')) {
  problems.push({ what: '.env is missing', why: 'Nothing can read DATABASE_URL.', fix: 'npm run secrets' });
} else {
  const env = readFileSync('.env', 'utf8');
  const placeholder = /^(SESSION_SECRET|FIELD_ENCRYPTION_KEY|WEBHOOK_SIGNING_PEPPER)=CHANGE_ME/m.test(env);
  if (placeholder) {
    problems.push({
      what: '.env still has placeholder secrets',
      why: 'Boot-time validation requires 32-byte values.',
      fix: 'npm run secrets',
    });
  } else {
    ok.push('.env configured');
  }
}

// 3. Prisma client generated — the npm 12 allow-scripts trap ────────────────
const clientGenerated =
  existsSync('node_modules/.prisma/client/default.js') ||
  existsSync('node_modules/.prisma/client/index.js') ||
  existsSync('node_modules/.prisma/client/client.ts');

if (clientGenerated) ok.push('Prisma client generated');
else if (installed) {
  problems.push({
    what: 'Prisma client has not been generated',
    why: "npm 12 blocks package install scripts, so Prisma's postinstall may not have run.",
    fix: 'npx prisma generate',
  });
}
// If node_modules is missing entirely, `npm install` above already covers it —
// listing this too would send you chasing a symptom instead of the cause.

// 4. Postgres and Redis reachable ───────────────────────────────────────────
const reachable = (host, port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

const url = existsSync('.env') ? (/^DATABASE_URL=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1] ?? '') : '';
const dbPort = Number(/:(\d+)\//.exec(url)?.[1] ?? 5432);
const dbHost = /@([^:/]+)/.exec(url)?.[1] ?? 'localhost';

const redisUrl = existsSync('.env') ? (/^REDIS_URL=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1] ?? '') : '';
const redisPort = Number(/:(\d+)(?:\/|$)/.exec(redisUrl.split('@').pop() ?? '')?.[1] ?? 6379);
const redisHost = /@([^:/]+)/.exec(redisUrl)?.[1] ?? 'localhost';

const [pg, redis] = await Promise.all([reachable(dbHost, dbPort), reachable(redisHost, redisPort)]);

if (pg) ok.push(`PostgreSQL ${dbHost}:${dbPort}`);
else {
  let dockerUp = true;
  try {
    execSync('docker info', { stdio: 'ignore' });
  } catch {
    dockerUp = false;
  }

  if (!dockerUp) {
    problems.push({
      what: 'Docker is not running',
      why: 'The database, cache and object store all live in Docker.',
      fix: 'Start Docker Desktop, wait for the whale icon to settle, then:\n        npm run docker:up',
    });
  } else {
    // A container that starts and immediately exits reports "Started" in compose
    // output but never appears in `ps`. That is a different problem from one that
    // was never launched, and it needs the logs, not another `up`.
    let exited = false;
    try {
      const psAll = execSync('docker compose -f infra/docker-compose.yml ps -a --format "{{.Service}} {{.State}}"', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      exited = /postgres\s+(exited|restarting|dead)/i.test(psAll);
    } catch {
      /* compose unavailable; fall through to the generic message */
    }

    problems.push(
      exited
        ? {
            what: 'The PostgreSQL container starts and then exits',
            why: 'Compose reports "Started" even when the process dies a moment later.',
            fix: 'docker compose -f infra/docker-compose.yml logs postgres\n        If it mentions a bad option, pull the latest infra/docker-compose.yml.\n        If the data directory is corrupt:\n        docker compose -f infra/docker-compose.yml down -v && npm run docker:up',
          }
        : {
            what: `PostgreSQL is not reachable at ${dbHost}:${dbPort}`,
            why: 'Docker is running but the database container is not up.',
            fix: 'npm run docker:up',
          },
    );
  }
}

if (redis) ok.push(`Redis ${redisHost}:${redisPort}`);
else if (pg)
  problems.push({
    what: `Redis is not reachable at ${redisHost}:${redisPort}`,
    why: 'Background jobs and rate limiting need it.',
    fix: 'docker compose -f infra/docker-compose.yml up -d redis',
  });

// ── report ─────────────────────────────────────────────────────────────────
const G = '\x1b[32m',
  R = '\x1b[31m',
  D = '\x1b[2m',
  B = '\x1b[1m',
  X = '\x1b[0m';

for (const line of ok) console.log(`${G}✓${X} ${D}${line}${X}`);

if (problems.length === 0) {
  console.log(`${G}✓${X} ${D}preflight passed${X}\n`);
  process.exit(0);
}

console.log(`\n${R}${B}Preflight found ${problems.length} problem${problems.length > 1 ? 's' : ''}.${X}\n`);
problems.forEach((p, i) => {
  console.log(`${R}${i + 1}. ${p.what}${X}`);
  console.log(`   ${D}${p.why}${X}`);
  console.log(`   ${B}Fix:${X} ${p.fix}\n`);
});
console.log(`${D}Full guide: docs/07-TROUBLESHOOTING.md${X}\n`);
process.exit(1);
