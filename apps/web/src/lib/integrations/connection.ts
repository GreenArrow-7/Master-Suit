import { prisma } from '../db';

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
  return (conn.credentials ?? {}) as Record<string, string>;
}
