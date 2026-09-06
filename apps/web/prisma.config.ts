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
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    // MIGRATION_DATABASE_URL, not DATABASE_URL.
    //
    // Migrations need the owning role: they create tables, enable row-level
    // security and write policies. The application must never hold that role —
    // a table owner bypasses RLS whether or not any role attribute says so, so
    // running the app as the migration role turns tenant isolation off silently.
    // src/lib/startup-check.ts refuses to boot if the two are ever the same.
    //
    // Falls back to DATABASE_URL so an existing single-role checkout still runs
    // `prisma generate`; deployments set both explicitly.
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '',
    // Only `migrate dev` / `migrate diff` use a shadow database; `migrate deploy`
    // never does. Deployments set the variable empty rather than unset, and
    // Prisma 7 refuses an empty string (P1013), so omit it in that case.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
