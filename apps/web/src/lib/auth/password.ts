import { hash, verify } from '@node-rs/argon2';
import { env } from '../env';

const opts = {
  memoryCost: env.ARGON2_MEMORY_KIB,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
};

export const hashPassword = (plain: string) => hash(plain, opts);

export const verifyPassword = (digest: string, plain: string) => verify(digest, plain, opts).catch(() => false);

/**
 * Burns roughly the same CPU as a real verification. Called when the email is
 * unknown or the account is locked so response timing cannot distinguish the cases.
 */
const DUMMY = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$3l4Xh0Z2vJ1qk9kQ0f5oV1oV3yq0mLZ0Xz5qv1p7hAk';
export const burnTiming = () => verify(DUMMY, 'not-the-password', opts).catch(() => false);

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  reuseWindow: number;
  maxAgeDays: number | null;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireNumber: true,
  requireSymbol: false,
  reuseWindow: 5,
  maxAgeDays: null,
};

export function checkPolicy(plain: string, policy: PasswordPolicy): string[] {
  const problems: string[] = [];
  if (plain.length < policy.minLength) problems.push(`Use at least ${policy.minLength} characters.`);
  if (policy.requireUpper && !/[A-Z]/.test(plain)) problems.push('Include an uppercase letter.');
  if (policy.requireLower && !/[a-z]/.test(plain)) problems.push('Include a lowercase letter.');
  if (policy.requireNumber && !/[0-9]/.test(plain)) problems.push('Include a number.');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(plain)) problems.push('Include a symbol.');
  return problems;
}
