// Temporary e2e-debug aid: snapshot or restore the owner's MFA columns, so a
// local run of the e2e suite (whose helper overwrites the authenticator) can
// put the real enrolment back. Usage:
//   node scripts/owner-mfa-snapshot.mjs save <file>
//   node scripts/owner-mfa-snapshot.mjs restore <file>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against production.');
  process.exit(1);
}

const require = createRequire(path.join(appRoot, 'package.json'));
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const adapter = new PrismaPg({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
const db = new PrismaClient({ adapter });

const [mode, file] = process.argv.slice(2);
const email = process.env.PLATFORM_OWNER_EMAIL;
if (!mode || !file || !email) {
  console.error('usage: owner-mfa-snapshot.mjs save|restore <file> (PLATFORM_OWNER_EMAIL required)');
  process.exit(1);
}

if (mode === 'save') {
  const u = await db.platformUser.findUnique({
    where: { email },
    select: { mfaSecret: true, mfaEnabled: true, mfaRecoveryCodes: true },
  });
  if (!u) {
    console.error('no owner row for', email);
    process.exit(1);
  }
  fs.writeFileSync(file, JSON.stringify(u));
  console.log('saved:', email, 'mfaEnabled =', u.mfaEnabled);
} else {
  const u = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.platformUser.update({ where: { email }, data: u });
  console.log('restored:', email, 'mfaEnabled =', u.mfaEnabled);
}
await db.$disconnect();
