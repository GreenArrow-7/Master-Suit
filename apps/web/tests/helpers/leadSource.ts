import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { POST as receive } from '@/app/api/v1/webhooks/leads/[key]/route';
import { handleJob } from '@/workers/jobs';
import { createWorkspaceUser, grantPermissions, type Grants } from './fixtures';
import { createSessionToken } from './session';

/**
 * A lead-source connection end to end: a Lead-Eagle-only workspace, a signed
 * delivery through the real receiver, and the registered worker job that turns
 * it into a lead.
 */
export const sign = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

/** A Lead-Eagle-only workspace with a default stage and its administrator signed in, holding `grants`. */
export async function leadEagleWorkspace(label: string, grants: Grants) {
  const suffix = randomBytes(4).toString('hex');
  const slug = `${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: `${slug} LLC`, displayName: slug, status: 'ACTIVE' },
  });
  const tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, grants);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `admin@${slug}.test`,
    fullName: 'Sources Admin',
  });
  return {
    tenantId,
    slug,
    userId: admin.id,
    cookie: await createSessionToken(tenantId, admin.id),
    cleanup: () => prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {}),
  };
}

/** A delivery to `/api/v1/webhooks/leads/{key}`, the body sent as the exact text given. */
export async function deliver(key: string, text: string, headers: Record<string, string> = {}) {
  const res = await receive(
    new Request(`http://localhost/api/v1/webhooks/leads/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: text,
    }),
    { params: Promise.resolve({ key }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** What the queue would run: every stored, unworked delivery for the connection, through the registered job. */
export async function work(tenantId: string, provider: string) {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { tenantId_provider: { tenantId, provider } },
  });
  const stored = `${provider}:${connection.id}`;
  const events = await prisma.webhookEvent.findMany({ where: { tenantId, provider: stored, processed: false } });
  for (const event of events) {
    await handleJob('webhook', {
      name: 'lead-source.enquiry',
      data: { tenantId, provider: stored, externalId: event.externalId, source: provider },
    });
  }
  return stored;
}
