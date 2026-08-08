/**
 * A tenant's connected providers, and the only place their credentials are
 * decrypted.
 *
 * Secrets are wrapped per value with AES-256-GCM before they reach the database
 * (§28: never store API secrets in the database in plaintext). Values written
 * before this existed are plaintext and pass through unchanged, and are re-wrapped
 * the next time the connection is saved.
 */
import { prisma } from '../db';
import { envelope } from '../security/envelope';

const secrets = envelope('master-saas-integration-credential-v1');

/**
 * Every value in `credentials` is wrapped, with no per-key exception list.
 *
 * A list of "which of these is really secret" is a thing to get wrong when a
 * vendor is added — Exotel's account SID is public-ish, Knowlarity's SR number
 * is a phone number — and wrapping a non-secret costs nothing. Operational
 * settings that need to be readable without the key live in `metadata`.
 */
export function wrapCredentials(credentials: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [key, value ? secrets.encrypt(value) : value]),
  );
}

function unwrapCredentials(stored: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value !== 'string') continue;
    out[key] = secrets.isEncrypted(value) ? secrets.decrypt(value) : value;
  }
  return out;
}

/**
 * Credentials for a tenant's connected provider, or null when the tenant has not
 * connected it. Callers must treat null as "feature unavailable" rather than
 * falling back to a mock provider — a mock returns plausible-looking links and
 * message ids that would read as success in the UI while nothing was sent.
 */
export async function connectionCredentials(
  tenantId: string,
  provider: string,
): Promise<Record<string, string> | null> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
  });
  if (!conn || conn.status !== 'CONNECTED') return null;
  return unwrapCredentials((conn.credentials ?? {}) as Record<string, unknown>);
}

/** Non-secret operational settings stored beside the credentials. */
export async function connectionMetadata(tenantId: string, provider: string): Promise<Record<string, unknown>> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { metadata: true },
  });
  return (conn?.metadata ?? {}) as Record<string, unknown>;
}

export const decryptCredentials = unwrapCredentials;
