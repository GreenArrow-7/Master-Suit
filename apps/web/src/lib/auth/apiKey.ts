import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../db';
import { Unauthorized, Forbidden } from '../errors';
import { verifyPassword, hashPassword } from './password';
import { clientIp } from './session';
import type { Actor, Ctx, Scope } from '../security/rbac';
import { consume, limits } from '../security/ratelimit';

/** lf_live_<8-char prefix>_<43-char secret>. Only the prefix is stored in clear. */
export async function issueApiKey(
  tenantId: string,
  name: string,
  roleId: string,
  scopes: string[],
  createdById: string,
) {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const full = `lf_live_${prefix}_${secret}`;

  const record = await prisma.aPIKey.create({
    data: { tenantId, name, prefix, keyHash: await hashPassword(secret), scopes, roleId, createdById },
  });

  // Returned once. There is no endpoint that can retrieve it again.
  return { id: record.id, key: full };
}

export async function authenticateApiKey(raw: string, req: Request, requestId: string): Promise<Ctx> {
  const parts = raw.split('_');
  if (parts.length !== 4 || parts[0] !== 'lf' || parts[1] !== 'live') throw Unauthorized('Invalid API key.');
  const [, , prefix, secret] = parts;

  const key = await prisma.aPIKey.findFirst({
    where: { prefix },
  });
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) throw Unauthorized('Invalid API key.');
  if (!(await verifyPassword(key.keyHash, secret!))) throw Unauthorized('Invalid API key.');

  const ip = clientIp(req);
  if (key.ipAllowlist.length && (!ip || !key.ipAllowlist.includes(ip))) {
    throw Forbidden('This API key is not permitted from your address.');
  }

  await consume(limits.apiKey(key.id, key.rateLimitPerMin));

  if (!key.roleId) throw Forbidden('This API key has no role assigned.');
  const role = await prisma.role.findFirst({
    where: { id: key.roleId, tenantId: key.tenantId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw Unauthorized('Invalid API key.');

  // A key can never exceed its role, and scopes only narrow further.
  const permissions = new Map<string, Scope>();
  for (const rp of role.permissions) {
    if (!rp.granted) continue;
    const id = `${rp.permission.module}:${rp.permission.action}`;
    if (key.scopes.length && !scopeAllows(key.scopes, rp.permission.module, rp.permission.action)) continue;
    permissions.set(id, rp.scope as Scope);
  }

  prisma.aPIKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  const actor: Actor = {
    id: key.createdById ?? key.id,
    tenantId: key.tenantId,
    roleId: role.id,
    roleKey: role.key,
    roleRank: role.rank,
    branchId: null,
    regionId: null,
    grantedBranchIds: [],
    grantedRegionIds: [],
    teamIds: [],
    managedUserIds: [],
    permissions,
  };

  return { tenantId: key.tenantId, actor, requestId, ip, userAgent: req.headers.get('user-agent'), apiKeyId: key.id };
}

const READ_ACTIONS = new Set(['VIEW', 'VIEW_REPORTS', 'EXPORT']);

function scopeAllows(scopes: string[], module: string, action: string): boolean {
  const wanted = READ_ACTIONS.has(action) ? 'read' : 'write';
  return scopes.includes(`${module}:${wanted}`) || scopes.includes(`${module}:*`) || scopes.includes('*');
}

export const fingerprint = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
