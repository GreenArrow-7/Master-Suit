#!/usr/bin/env node
/**
 * TOTP helper for the platform owner on a local/demo install.
 *
 * Every platform role above USER must sign in with a second factor — that rule
 * is deliberate and this script does not weaken it. What it does is what a
 * phone authenticator would: hold a TOTP secret and produce the current code.
 *
 *   node scripts/owner-mfa.mjs --enroll      # set (or reset) the owner's TOTP secret
 *   node scripts/owner-mfa.mjs               # print the current 6-digit code
 *
 * --enroll prints the otpauth:// URL too, so the same secret can be scanned
 * into a real authenticator app once and this script never used again.
 * Refuses to run when NODE_ENV=production — a deployment enrolls through
 * /enroll-2fa like anyone else.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

// dotenv, not a hand-rolled reader: the previous loop split on '\n' and kept the
// trailing '\r' from this repo's CRLF .env, so DATABASE_URL/MIGRATION_DATABASE_URL
// arrived with a stray carriage return and every Prisma query threw. dotenv strips
// line endings and, like the old loop, does not override anything already exported.
dotenv.config({ path: path.join(appRoot, '.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against production. Enroll through /enroll-2fa.');
  process.exit(1);
}

const require = createRequire(path.join(appRoot, 'package.json'));
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const adapter = new PrismaPg({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
const db = new PrismaClient({ adapter });

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Encode = (buf) => {
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};
const base32Decode = (s) => {
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
// RFC 6238, matching src/lib/auth/mfa.ts exactly: 6 digits, 30s step, SHA-1.
const totp = (secret, counter) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(value % 10 ** 6).padStart(6, '0');
};

const email = (process.env.PLATFORM_OWNER_EMAIL || 'owner@masterapp.local').toLowerCase();
const owner = await db.platformUser.findFirst({ where: { normalizedEmail: email } });
if (!owner) {
  console.error(`No platform user ${email} — run the seed or scripts/bootstrap-owner.mjs first.`);
  process.exit(1);
}

if (process.argv.includes('--reset')) {
  // Puts the owner back into the in-app enrolment flow: the next correct
  // password login is granted only /enroll-2fa, which shows a fresh QR /
  // setup key and issues new recovery codes. Old secret and codes die here.
  await db.platformUser.update({
    where: { id: owner.id },
    // Old recovery codes die with the secret: a captured one must not survive a
    // reset. Fresh codes are minted when the account re-enrols through /enroll-2fa.
    data: { mfaSecret: null, mfaEnabled: false, mfaRecoveryCodes: [] },
  });
  await db.authenticationFactor.deleteMany({ where: { platformUserId: owner.id } }).catch(() => {});
  await db.platformSession.updateMany({
    where: { platformUserId: owner.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`${email}: MFA enrolment reset. Next password login opens the authenticator setup screen.`);
  await db.$disconnect();
  process.exit(0);
}

if (process.argv.includes('--enroll')) {
  // Raw base32 in mfaSecret is the documented legacy form; decryptSecret passes
  // it through unchanged, so codes verify without touching the crypto service.
  const secret = process.env.PLATFORM_OWNER_MFA_SECRET?.trim() || base32Encode(randomBytes(20));
  await db.platformUser.update({
    where: { id: owner.id },
    data: { mfaSecret: secret, mfaEnabled: true },
  });
  console.log(`Enrolled ${email} for TOTP.\n`);
  console.log(`  Secret:       ${secret}`);
  console.log(
    `  Authenticator: otpauth://totp/Master%20Suite:${encodeURIComponent(email)}?secret=${secret}&issuer=Master%20Suite&algorithm=SHA1&digits=6&period=30`,
  );
  console.log(`  Current code: ${totp(secret, Math.floor(Date.now() / 1000 / 30))}`);
  console.log(`\nSign in with the password, then enter the code. Re-run without --enroll for a fresh code.`);
} else {
  if (!owner.mfaSecret) {
    console.error(`${email} has no TOTP secret yet. Run: node scripts/owner-mfa.mjs --enroll`);
    process.exit(1);
  }
  // Long secrets that are not base32 are ciphertext from the in-app enrolment;
  // this script can only mint codes for secrets it enrolled itself.
  if (!/^[A-Z2-7]+=*$/i.test(owner.mfaSecret)) {
    console.error('The stored secret was enrolled in-app (encrypted). Use your authenticator app, or re-run --enroll.');
    process.exit(1);
  }
  const step = Math.floor(Date.now() / 1000 / 30);
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${totp(owner.mfaSecret, step)}   (valid ~${remaining}s, next: ${totp(owner.mfaSecret, step + 1)})`);
}

await db.$disconnect();
