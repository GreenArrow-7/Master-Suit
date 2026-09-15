import { prisma } from '@/lib/db';
import { currentTotpStep, totp } from '@/lib/auth/mfa';

/**
 * A current authenticator code for a suite that signs one synthetic identity in
 * many times within a few seconds.
 *
 * An accepted code spends its time step (lib/auth/totp-consume.ts), so the second
 * sign-in of a test inside the same thirty seconds is correctly refused as a
 * replay. Suites whose subject is something else — dual credentials, service
 * identities — clear the identity's spent step first, as test setup, instead of
 * waiting thirty seconds between steps.
 *
 * Replay prevention itself is exercised by tests/security/mfa-replay.spec.ts,
 * which never calls this.
 */
export async function freshTotp(
  who: { id: string } | { email: string } | { username: string },
  secret: string,
): Promise<string> {
  const where =
    'id' in who
      ? { id: who.id }
      : 'email' in who
        ? { normalizedEmail: who.email.toLowerCase() }
        : { username: who.username };
  await prisma.platformUser.updateMany({ where, data: { mfaLastUsedStep: null } });
  return totp(secret, currentTotpStep());
}

/** Waits until the authenticator shows its next code — what a person does after a code is spent. */
export async function waitForNextTotpStep(): Promise<void> {
  const spent = currentTotpStep();
  while (currentTotpStep() === spent) await new Promise((resolve) => setTimeout(resolve, 250));
}
