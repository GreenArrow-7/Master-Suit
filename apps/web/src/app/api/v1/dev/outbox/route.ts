import { env } from '@/lib/env';
import { mockOutbox } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

/**
 * Reads the mock mailer's in-memory outbox.
 *
 * The end-to-end suite has to redeem a password-reset link and an invitation
 * link, and the plaintext token for either exists in exactly one place: the body
 * of the email. It is stored only as a SHA-256 hash, so no amount of database
 * access recovers it, and the outbox lives inside the server process where
 * Playwright cannot reach it.
 *
 * Two independent conditions gate this route, and production cannot satisfy
 * either:
 *
 *   1. EMAIL_PROVIDER must be `mock`. With `smtp` the outbox is always empty,
 *      because sendMail never writes to it.
 *   2. NODE_ENV must not be `production`.
 *
 * Those overlap on purpose. lib/startup-check.ts already calls process.exit(1)
 * when a production build starts with any mock provider configured, so a
 * deployment that could serve real tokens here does not reach the point of
 * listening on a port.
 */
export async function GET(req: Request) {
  if (env.NODE_ENV === 'production' || env.EMAIL_PROVIDER !== 'mock') {
    return new Response(null, { status: 404 });
  }

  const to = new URL(req.url).searchParams.get('to');
  const mail = to ? mockOutbox.lastTo(to) : mockOutbox.all().at(-1);
  if (!mail) return Response.json({ error: 'no mail' }, { status: 404 });

  return Response.json({ to: mail.to, subject: mail.subject, body: mail.body, at: mail.at });
}
