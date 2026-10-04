// Prisma 7 moved the datasource URL out of schema.prisma into this file.
//
// This must NOT import dotenv: the Prisma CLI loads this config before
// node_modules is guaranteed to exist (e.g. `npx prisma generate` on a fresh
// clone), and a missing import here fails with a confusing "Cannot find module"
// rather than a useful message. So .env is loaded by Node itself, which needs no
// dependency and, like dotenv, never overrides what the environment already sets.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile();

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
