#!/usr/bin/env node
/**
 * Postgres accepts TCP connections a second or two before it accepts queries, so
 * `docker compose up -d && prisma migrate` races. This closes the gap.
 *
 * No dependencies on purpose — this runs during setup, before anyone can assume
 * node_modules is complete.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const url = existsSync('.env') ? (/^DATABASE_URL=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1] ?? '').trim() : '';
const host = /@([^:/]+)/.exec(url)?.[1] ?? 'localhost';
const port = Number(/@[^:]+:(\d+)/.exec(url)?.[1] ?? 5432);
const deadline = Date.now() + 90_000;

const probe = () =>
  new Promise((resolve) => {
    const s = createConnection({ host, port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1000);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });

process.stdout.write(`Waiting for PostgreSQL at ${host}:${port} `);
while (Date.now() < deadline) {
  if (await probe()) {
    await new Promise((r) => setTimeout(r, 1500)); // let it finish accepting queries
    console.log('\x1b[32mready\x1b[0m');
    process.exit(0);
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 1000));
}

console.log('\n\x1b[31mPostgreSQL did not become ready within 90s.\x1b[0m\n');
console.log('The container is probably starting and then exiting. Check why:\n');
console.log('  docker compose -f infra/docker-compose.yml ps -a');
console.log('  docker compose -f infra/docker-compose.yml logs postgres\n');
process.exit(1);
