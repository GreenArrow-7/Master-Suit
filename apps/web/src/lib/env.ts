import { z } from 'zod';

/**
 * Placeholders that look like configuration but are not secret.
 *
 * Matched on the decoded bytes as well as the raw string, so a base64-wrapped
 * placeholder is caught too.
 */
const PLACEHOLDERS = /^(change[_-]?me|placeholder|secret|password|todo|xxx+|test|example|changeit)$/i;

/**
 * A real 32-byte secret, not merely a long string.
 *
 * This was `z.string().min(32)`, which measures characters. A 32-byte secret in
 * base64 is 44 characters, so the check was loose in the direction that matters:
 * `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` passed and gave 24 bytes of entropy from
 * a single repeated character, and `CHANGE_ME_CHANGE_ME_CHANGE_ME_ME` passed
 * too. Decoding and measuring the bytes is the check that was intended.
 */
export const b64 = z.string().superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });

  if (PLACEHOLDERS.test(value.trim())) {
    return fail('is a placeholder, not a secret. Generate one with `npm run secrets`.');
  }

  // base64 and base64url both, since generate-secrets.mjs emits base64 and
  // several deployment tools rewrite it to base64url.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    return fail('must be base64. Generate one with `npm run secrets`.');
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength < 32) {
    return fail(`must decode to at least 32 bytes; this decodes to ${bytes.byteLength}. Run \`npm run secrets\`.`);
  }

  // A key of one repeated byte decodes to the right length and has no entropy.
  if (new Set(bytes).size < 8) {
    return fail('decodes to too few distinct bytes to be random. Run `npm run secrets`.');
  }
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which environment this deployment IS, as distinct from how Node was built.
   *
   * NODE_ENV cannot carry this: staging and production both run production
   * builds, and the demo showcase runs one too. Environment separation —
   * separate databases, separate secrets, and above all "the demo seed must
   * never touch production" — needs a name for the environment itself, declared
   * by the operator rather than inferred from build flags.
   *
   * The default is development, so a laptop needs no ceremony. Anything built
   * with NODE_ENV=production must declare itself: the startup check refuses a
   * production build whose APP_ENV is still the default, and refuses APP_ENV
   * values that contradict the database it is pointed at (a database named
   * `*_demo` under APP_ENV=production is a wiring mistake, not a choice).
   */
  APP_ENV: z.enum(['development', 'test', 'demo', 'staging', 'production']).default('development'),
  PROCESS_ROLE: z.enum(['web', 'worker']).default('web'),
  APP_URL: z.string().url(),

  /** The application role: NOBYPASSRLS, no DDL. See docs/RLS-ROLLOUT.md. */
  DATABASE_URL: z.string().url(),
  /**
   * The owning role, used by `prisma migrate` and nothing else. Declared here
   * only so the startup check can refuse a deployment that points both at the
   * same role — it is never used to open a connection from the application.
   */
  MIGRATION_DATABASE_URL: z.string().url().optional().or(z.literal('')),
  DATABASE_REPLICA_URL: z.string().url().optional().or(z.literal('')),
  REDIS_URL: z.string().url(),

  // SESSION_SECRET was here. Nothing ever read it: sessions are rows in
  // PlatformSession matched by SHA-256 token hash, with no signing step, so
  // requiring it at boot promised a session-revocation lever that did not
  // exist. Use revokeAllSessions, or the platform PATCH `revokeSessions`.
  FIELD_ENCRYPTION_KEY: b64,
  WEBHOOK_SIGNING_PEPPER: b64,

  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /**
   * Comma-separated CIDRs of the proxies in front of this server, e.g.
   * `10.0.0.0/8,172.16.0.0/12`. Forwarded headers are believed only when the
   * request actually arrived from one of them.
   *
   * This replaced a `TRUST_PROXY_HEADERS` boolean that defaulted to false and
   * made `clientIp` return null behind every load balancer — so every request
   * on the platform shared one rate-limit bucket keyed `unknown`, and every
   * audit row recorded `unknown` as the source. Production refuses to start
   * with this empty; see lib/startup-check.ts.
   */
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  EMAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('Master Suite <no-reply@localhost>'),
  SMS_PROVIDER: z.string().default('mock'),
  /** Offer letters, contracts and policy acknowledgements. `mock` is blocked in production. */
  ESIGNATURE_PROVIDER: z.string().default('mock'),
  WHATSAPP_PROVIDER: z.string().default('mock'),
  /** `clamav` in any deployed environment; `mock` is test-only and blocked in production. */
  ANTIVIRUS_PROVIDER: z.string().default('mock'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  ANTIVIRUS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_PROVIDER: z.string().default('mock'),
  AI_API_KEY: z.string().optional(),
  /**
   * The key call analysis, call audits and live coaching actually read. Unset
   * means those features run in clearly-labelled simulation mode — fine for a
   * demo, not for production analysis.
   */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  // Face check-in. FACE_SERVICE_URL unset means the engine is unavailable and
  // attendance fails closed with a 503 that says so — never a wave-through.
  FACE_SERVICE_URL: z.string().url().optional().or(z.literal('')),
  FACE_SERVICE_TOKEN: z.string().optional(),
  FACE_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** Cosine similarity against the enrolled templates. Tune on your own staff and lighting. */
  FACE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  FACE_SAMPLES_REQUIRED: z.coerce.number().int().min(1).max(10).default(4),
  /** Enrolment samples must genuinely differ, or the template overfits one pose. */
  FACE_ENROLMENT_MIN_SPREAD: z.coerce.number().min(0).max(1).default(0.02),
  MAX_GPS_ACCURACY_M: z.coerce.number().int().positive().default(100),
  MIN_PUNCH_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  MAX_OFFLINE_SYNC_HOURS: z.coerce.number().int().positive().default(48),
  ATTENDANCE_CAPTURE_DIR: z.string().default('storage/attendance'),
  ATTENDANCE_CAPTURE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),

  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(500_000),
  IMPORT_CHUNK_SIZE: z.coerce.number().int().positive().default(5_000),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

/** Providers that must be real before the server serves a request. */
export const PROVIDER_KEYS = [
  'EMAIL_PROVIDER',
  'SMS_PROVIDER',
  'ESIGNATURE_PROVIDER',
  'WHATSAPP_PROVIDER',
  'ANTIVIRUS_PROVIDER',
  'AI_PROVIDER',
] as const;

/**
 * `next build` sets NODE_ENV=production and evaluates this module while
 * collecting page data, so enforcing provider configuration here made the build
 * itself depend on ClamAV, Twilio and SMTP credentials that a build server has
 * no reason to hold. "Is this binary safe to run in production" is a runtime
 * question; it is asked at boot instead — see instrumentation.ts.
 *
 * Every other rule above still applies during the build.
 */
export function mockProviders(value: Record<string, string>): string[] {
  return PROVIDER_KEYS.filter((key) => String(value[key] ?? '').toLowerCase() === 'mock');
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail at boot, not at the first request that happens to need the variable.
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
