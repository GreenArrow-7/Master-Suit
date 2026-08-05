import { env } from './env';
import { logger } from './logger';

/**
 * EMAIL_PROVIDER=mock is the only mode implemented: logs the message instead of
 * sending it, which is enough for local/dev/demo. Swap this body for a real
 * provider call when EMAIL_PROVIDER names one — one function, not an interface,
 * until there is a second provider to abstract over.
 */
export async function sendMail(to: string, subject: string, body: string) {
  if (env.EMAIL_PROVIDER === 'mock') {
    logger.info({ to, subject, body }, 'mock email sent');
    return;
  }
  throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
}
