/**
 * `.env.example` must parse against the schema that reads it.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * `.env` is not written by hand. `npm run secrets` copies `.env.example` and
 * fills in the generated values, and CI's "Generate .env" step runs the same
 * script. So `.env.example` is not documentation — it is the literal input every
 * fresh checkout and every CI run parses at boot.
 *
 * A key declared there that lib/env.ts rejects therefore stops every process
 * from starting, everywhere except on the machine of whoever added it: their own
 * `.env` predates the key, so it arrives *absent* rather than *empty*, and those
 * are different values to zod. `FACE_SERVICE_TOKEN_ROTATED_AT: z.string()
 * .regex(…).optional()` accepted absent and rejected empty; the whole suite went
 * red in CI and passed locally, on an identical tree.
 *
 * The example file declares keys with no value on purpose — that is how it shows
 * an operator what to set. So the schema is what has to accommodate it, and this
 * is the check that says so before the push rather than after.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { envSchema } from '@/lib/env';

const root = path.resolve(__dirname, '../..');

/** `KEY=value` lines only — comments, blanks and `export ` prefixes are not input. */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(root, file), 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    // Values are taken verbatim, quotes and all, because that is what
    // `process.env` would hold — stripping them here would test a string the
    // application never sees.
    out[match[1]!] = match[2]!;
  }
  return out;
}

/**
 * The values `npm run secrets` generates, which are absent from the example.
 *
 * Supplied so this test checks *shape* — the keys the example declares — rather
 * than failing on the secrets it deliberately leaves blank. Each is a real
 * 32-byte base64 value because `b64` decodes and measures, and a placeholder
 * would be rejected for being one.
 */
const GENERATED: Record<string, string> = {
  FIELD_ENCRYPTION_KEY: Buffer.from([...Array(32)].map((_, i) => (i * 37 + 11) % 251)).toString('base64'),
  WEBHOOK_SIGNING_PEPPER: Buffer.from([...Array(32)].map((_, i) => (i * 53 + 7) % 251)).toString('base64'),
};

const EXAMPLES = ['.env.example', '.env.test.example', '.env.production.example', '.env.staging.example'];

describe.each(EXAMPLES)('%s', (file) => {
  it('parses against the schema every process boots with', () => {
    const declared = parseEnvFile(file);
    const result = envSchema.safeParse({ ...declared, ...GENERATED });

    // Report the offending keys, not "invalid": this failing at all means
    // somebody is one push away from a red CI they cannot reproduce.
    const issues = result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    expect(issues).toEqual([]);
  });
});

describe('the example files and the schema agree in both directions', () => {
  it('declares every variable the schema requires', () => {
    // A required key missing from `.env.example` is the same failure seen from
    // the other side: `npm run secrets` produces a `.env` that will not boot.
    const declared = new Set(Object.keys({ ...parseEnvFile('.env.example'), ...GENERATED }));
    const missing = Object.entries(envSchema.shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([name]) => name)
      .filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  /**
   * A key in an example file that nothing reads is a variable somebody will set
   * and expect to have an effect — the CSP-nonce comment problem in
   * configuration form. This check found `TELEPHONY_PROVIDER=mock` sitting in
   * the list beside `SMS_PROVIDER` and `WHATSAPP_PROVIDER`; the telephony vendor
   * is a per-tenant choice in organizationSetting.telephonyProvider and no
   * process-wide setting can decide it.
   *
   * It ran over `.env.example` alone, which is why the same `TELEPHONY_PROVIDER`
   * line survived in `.env.test.example` and `SMS_PROVIDER=unconfigured` in the
   * two deployed ones — an operator reads the file for the environment they are
   * deploying, and those are the copies that mislead. Every example file now.
   *
   * Not every key belongs to lib/env.ts, so the ones read elsewhere are listed
   * with where they are read. Adding a name here is a claim that something
   * consumes it, and one worth having to write down.
   */
  it.each(EXAMPLES)('%s declares nothing that no longer has a consumer', (file) => {
    const READ_ELSEWHERE: Record<string, string> = {
      PORT: 'Next itself, and prisma/seed',
      SHADOW_DATABASE_URL: 'prisma.config.ts, for `migrate dev`',
      REDIS_PASSWORD: 'Compose, for redis --requirepass; never by the app',
      PLATFORM_OWNER_EMAIL: 'prisma/seed and scripts/bootstrap-owner.mjs',
      PLATFORM_OWNER_PASSWORD: 'prisma/seed and the e2e helpers',
      PLATFORM_OWNER_MFA_SECRET: 'prisma/seed and scripts/owner-mfa.mjs',
      FACE_SERVICE_TOKEN_PREVIOUS: 'apps/face/tokens.py, during a token rotation',
      RLS_DATABASE_URL: 'scripts/check-rls.mjs and the tenant suites; never the app',
      POSTGRES_PASSWORD: 'Compose, for the postgres image’s own superuser',
      ALERT_EMAIL_TO: 'infra/alertmanager-entrypoint.sh',
      ALERT_PAGE_EMAIL_TO: 'infra/alertmanager-entrypoint.sh, for severity=page',
      ALERT_EMAIL_FROM: 'infra/alertmanager-entrypoint.sh',
      ALERT_WEBHOOK_URL: 'infra/alertmanager-entrypoint.sh',
      PROMETHEUS_RETENTION: 'infra/prometheus-entrypoint.sh',
      APP_DOMAIN: 'infra/Caddyfile, via the azure overlay',
      ACME_EMAIL: 'infra/Caddyfile, for the Let’s Encrypt account',
      // The one entry here whose consumer is a person rather than a process:
      // DEPLOY-AZURE.md and DEPLOY-STAGING.md have the operator run `ALTER ROLE
      // master_saas_app PASSWORD '<APP_DB_PASSWORD …>'` by hand, and the same
      // value appears inside DATABASE_URL. Nothing reads the variable, so this
      // is a claim that the runbook does — check the runbook before deleting it.
      APP_DB_PASSWORD: 'docs/DEPLOY-AZURE.md and docs/DEPLOY-STAGING.md, by hand',
    };
    const accounted = new Set([...Object.keys(envSchema.shape), ...Object.keys(READ_ELSEWHERE)]);
    const orphans = Object.keys(parseEnvFile(file)).filter((name) => !accounted.has(name));
    expect(orphans).toEqual([]);
  });

  /**
   * A pinned Gemini model id here is a dead deployment on Google's schedule.
   *
   * ── The defect this caught ─────────────────────────────────────────────────
   *
   * `.env.example` carried `GEMINI_MODEL=gemini-2.0-flash`, an id Google has
   * retired. `lib/ai/gemini.ts` defaults to a rolling alias precisely so that
   * cannot happen — but *nothing ever reached that default*, because this file
   * is copied verbatim into `.env` by `npm run secrets` and the line is
   * therefore always set. Every fresh checkout and every CI run booted pointing
   * at a model that no longer exists.
   *
   * What that looks like from the outside is the worst part: a 404 inside each
   * AI feature, caught, falling back to clearly-labelled simulation — while
   * Settings → Integrations still reads Connected, because the key is valid.
   * The key is not the problem and the screen that would be checked first says
   * so.
   *
   * Google's own convention is the fix: `*-latest` is a rolling alias that
   * survives a retirement, numbered and dated ids do not. So an example may
   * leave the value empty, or name an alias, and may not pin anything else.
   */
  it.each(EXAMPLES)('%s does not pin a Gemini model id that Google can retire', (file) => {
    const model = parseEnvFile(file).GEMINI_MODEL;
    if (model === undefined || model.trim() === '') return;
    expect(model.trim()).toMatch(/-latest$/);
  });
});
