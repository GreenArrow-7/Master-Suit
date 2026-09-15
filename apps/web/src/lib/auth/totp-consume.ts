import { prisma, type TxClient } from '@/lib/db';
import { matchTotpStep } from '@/lib/auth/mfa';
import { decryptSecret } from '@/services/identity/secrets';

/**
 * Accepting an authenticator code: the only place that does.
 *
 * A TOTP code stays valid for its step and the drift window either side — about
 * ninety seconds. Checking it with a comparison alone lets anyone who saw it (a
 * shoulder, a phishing proxy, a log, a second tab) use it again inside that
 * window, and lets two requests carrying the same code both succeed. Rate limits
 * bound how often that can be tried; they do not stop it happening once.
 *
 * So acceptance is a write. The matched step is recorded on the identity with a
 * conditional update that succeeds only if it moves `mfaLastUsedStep` forward.
 * Postgres re-evaluates that condition under the row lock, so of two concurrent
 * requests with the same code exactly one updates a row and the other sees the
 * new value and is refused. An earlier code than the last accepted one is refused
 * for the same reason (RFC 6238 §5.2).
 *
 * The consequence people notice: a code that has just signed you in cannot also
 * confirm the next step — the authenticator's next code can.
 */
export type TotpOutcome = 'ACCEPTED' | 'INVALID' | 'REPLAYED';

export async function consumeTotp(
  platformUserId: string,
  encryptedSecret: string | null | undefined,
  code: string | null | undefined,
  db: Pick<TxClient, 'platformUser'> = prisma,
): Promise<TotpOutcome> {
  if (!encryptedSecret || !code) return 'INVALID';
  const step = matchTotpStep(decryptSecret(encryptedSecret), code);
  if (step === null) return 'INVALID';
  const { count } = await db.platformUser.updateMany({
    where: { id: platformUserId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
    data: { mfaLastUsedStep: step },
  });
  return count === 1 ? 'ACCEPTED' : 'REPLAYED';
}
export const REPLAYED_CODE =
  'That code has already been used. Wait for the next code from your authenticator and try again.';
