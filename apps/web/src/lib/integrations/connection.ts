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

export function decryptCredentials(stored: Record<string, unknown>): Record<string, string> {
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
  return decryptCredentials((conn.credentials ?? {}) as Record<string, unknown>);
}

/**
 * What is actually stored, whatever the connection's status.
 *
 * `connectionCredentials` refuses anything but CONNECTED, which is right for
 * every runtime caller — a broken connection must not be used — and wrong for
 * the two administration paths, because it made ERROR a trap nobody could get
 * out of: Test connection read no key and wrote "No API key is saved for this
 * connection" over a row that held one, and re-saving with the key box left
 * blank (the documented way to keep it) merged over nothing and was refused as
 * "API key is required". The settings screen then showed a saved key, a Remove
 * key button and "no key saved" at once, and neither button could fix it.
 *
 * Only Settings → Integrations may call this.
 */
export async function savedCredentials(tenantId: string, provider: string): Promise<Record<string, string>> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { credentials: true },
  });
  return conn ? decryptCredentials((conn.credentials ?? {}) as Record<string, unknown>) : {};
}

/**
 * Whether a provider is connected, and whether a credential is sitting behind
 * that status — without decrypting anything.
 *
 * `connectionCredentials` answers null both for "this tenant never connected
 * the provider" and for "this tenant connected it and the connection is
 * currently marked broken". Those are different situations and a caller that
 * cannot tell them apart will fall back as though no choice had been made,
 * which is how a tenant's own credential stopped being used without anyone
 * being told.
 */
export async function connectionState(
  tenantId: string,
  provider: string,
): Promise<{ status: string; storedKeys: string[] } | null> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { status: true, credentials: true },
  });
  return conn ? { status: conn.status, storedKeys: storedCredentialKeys(conn.credentials) } : null;
}

/** Which credential fields hold a value — names only, never values. */
export function storedCredentialKeys(credentials: unknown): string[] {
  return Object.entries((credentials ?? {}) as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .map(([k]) => k);
}

/** Non-secret operational settings stored beside the credentials. */
export async function connectionMetadata(tenantId: string, provider: string): Promise<Record<string, unknown>> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { metadata: true },
  });
  return (conn?.metadata ?? {}) as Record<string, unknown>;
}
