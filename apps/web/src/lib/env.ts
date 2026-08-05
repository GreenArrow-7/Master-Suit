import { z } from 'zod';

const b64 = z.string().min(32, 'must be a 32-byte base64 secret');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PROCESS_ROLE: z.enum(['web', 'worker']).default('web'),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional().or(z.literal('')),
  REDIS_URL: z.string().url(),

  SESSION_SECRET: b64,
  FIELD_ENCRYPTION_KEY: b64,
  WEBHOOK_SIGNING_PEPPER: b64,

  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  TRUST_PROXY_HEADERS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
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

  EMAIL_PROVIDER: z.string().default('mock'),
  SMS_PROVIDER: z.string().default('mock'),
  WHATSAPP_PROVIDER: z.string().default('mock'),
  TELEPHONY_PROVIDER: z.enum(['mock', 'hmac']).default('mock'),
  ANTIVIRUS_PROVIDER: z.string().default('mock'),
  AI_PROVIDER: z.string().default('mock'),
  AI_API_KEY: z.string().optional(),

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
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;
  for (const key of [
    'EMAIL_PROVIDER', 'SMS_PROVIDER', 'WHATSAPP_PROVIDER', 'TELEPHONY_PROVIDER',
    'ANTIVIRUS_PROVIDER', 'AI_PROVIDER',
  ] as const) {
    if (value[key].toLowerCase() === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'mock providers are forbidden in production',
      });
    }
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail at boot, not at the first request that happens to need the variable.
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
