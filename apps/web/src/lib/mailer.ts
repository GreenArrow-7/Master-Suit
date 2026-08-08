import { createTransport, type Transporter } from 'nodemailer';
import { env } from './env';
import { logger } from './logger';

/**
 * Outbound email.
 *
 * Two providers: `smtp` for anything deployed, `mock` for local work and tests.
 * Production refuses to boot with `mock` (lib/startup-check.ts), so there is no
 * configuration in which a password-reset link is silently dropped — which is
 * what happened before: `mock` was the only implementation, and the reset flow
 * had no way to reach anyone.
 *
 * The body is never logged. It carries single-use reset and invitation tokens,
 * and a log pipeline is a place those outlive the thirty minutes they are meant
 * to. The mock provider keeps messages in memory instead so a test can read one.
 */
export interface SentMail {
  to: string;
  subject: string;
  body: string;
  at: Date;
}

const outbox: SentMail[] = [];
const OUTBOX_LIMIT = 100;

let transport: Transporter | null = null;

function smtpTransport(): Transporter {
  if (transport) return transport;
  if (!env.SMTP_HOST) {
    throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST. See .env.example.');
  }
  transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Implicit TLS on 465; STARTTLS elsewhere, required rather than opportunistic
    // so a server that does not offer it fails instead of sending in the clear.
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

export async function sendMail(to: string, subject: string, body: string) {
  if (env.EMAIL_PROVIDER === 'mock') {
    outbox.push({ to, subject, body, at: new Date() });
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
    logger.info({ to, subject, provider: 'mock' }, 'email captured (not sent)');
    return;
  }

  if (env.EMAIL_PROVIDER === 'smtp') {
    await smtpTransport().sendMail({ from: env.EMAIL_FROM, to, subject, text: body });
    logger.info({ to, subject, provider: 'smtp' }, 'email sent');
    return;
  }

  throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
}

/** Local-development and test helper. Empty unless EMAIL_PROVIDER=mock. */
export const mockOutbox = {
  all: (): readonly SentMail[] => outbox,
  lastTo: (to: string) => [...outbox].reverse().find((mail) => mail.to.toLowerCase() === to.toLowerCase()),
  clear: () => {
    outbox.length = 0;
  },
};
