// Prisma 7 moved the datasource URL out of schema.prisma into this file.
//
// This must NOT import dotenv: the Prisma CLI loads this config before
// node_modules is guaranteed to exist (e.g. `npx prisma generate` on a fresh
// clone), and a missing import here fails with a confusing "Cannot find module"
// rather than a useful message. So .env is parsed with zero dependencies.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

function loadEnvFile(file = '.env') {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    // Migrations run as a BYPASSRLS role; the application role never has it.
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    // `prisma generate` does not need a URL, so don't throw when it is absent —
    // migrate and studio will report a clear error of their own if it is missing.
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
