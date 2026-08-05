import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';
import { env } from '../env';
import { Unauthorized } from '../errors';
import type { Actor, Ctx, Scope } from '../security/rbac';

export const SESSION_COOKIE = 'lf_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(input: {
  tenantId: string; userId: string; ip: string | null; userAgent: string | null; mfaSatisfied: boolean;
}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_MINUTES * 60_000);

  await prisma.session.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: sha256(token),
      ipAddress: input.ip,
      userAgent: input.userAgent,
      mfaSatisfied: input.mfaSatisfied,
      expiresAt,
    },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function createPlatformSession(input: {
  platformUserId: string;
  activeTenantId: string | null;
  ip: string | null;
  userAgent: string | null;
  mfaSatisfied: boolean;
}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_MINUTES * 60_000);

  await prisma.platformSession.create({
    data: {
      platformUserId: input.platformUserId,
      activeTenantId: input.activeTenantId,
      tokenHash: sha256(token),
      ipAddress: input.ip,
      userAgent: input.userAgent,
      mfaSatisfied: input.mfaSatisfied,
      expiresAt,
    },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function revokeSession(token: string, reason = 'USER_LOGOUT') {
  const tokenHash = sha256(token);
  await Promise.all([
    prisma.platformSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
    prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  ]);
  (await cookies()).delete(SESSION_COOKIE);
}

/** A password or role change invalidates every other session for that user. */
export async function revokeAllSessions(tenantId: string, userId: string, except?: string, reason = 'CREDENTIAL_CHANGE') {
  const membership = await prisma.workspaceMembership.findUnique({ where: { salesUserId: userId } });
  await Promise.all([
    prisma.session.updateMany({
      where: { tenantId, userId, revokedAt: null, ...(except ? { NOT: { tokenHash: sha256(except) } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
    membership
      ? prisma.platformSession.updateMany({
          where: {
            platformUserId: membership.platformUserId,
            revokedAt: null,
            ...(except ? { NOT: { tokenHash: sha256(except) } } : {}),
          },
          data: { revokedAt: new Date(), revokedReason: reason },
        })
      : Promise.resolve({ count: 0 }),
  ]);
}

export type PlatformCtx = {
  platformUserId: string;
  platformRole: 'USER' | 'OWNER' | 'SUPPORT' | 'SECURITY_AUDITOR';
  email: string;
  fullName: string;
  activeTenantId: string | null;
  sessionId: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
};

/**
 * The session token for this request.
 *
 * The Cookie header on `req` is the authority: it is correct in route handlers,
 * in server components that forward the real headers, and when a handler is
 * invoked directly by a test. cookies() is only the fallback for callers that
 * hand us a bare Request, and it throws outside a Next request scope — which is
 * why it must not be the primary read.
 */
async function sessionToken(req: Request): Promise<string | undefined> {
  for (const part of req.headers.get('cookie')?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export async function resolvePlatformCtx(req: Request, requestId: string): Promise<PlatformCtx> {
  const token = await sessionToken(req);
  if (!token) throw Unauthorized();

  const session = await prisma.platformSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { platformUser: true },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) throw Unauthorized('Your session has expired.');

  const idleCutoff = new Date(now.getTime() - env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
  if (session.lastSeenAt < idleCutoff) {
    await prisma.platformSession.update({
      where: { id: session.id },
      data: { revokedAt: now, revokedReason: 'IDLE_TIMEOUT' },
    });
    throw Unauthorized('Your session timed out.');
  }

  const user = session.platformUser;
  if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Unauthorized();

  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.platformSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  return {
    platformUserId: user.id,
    platformRole: user.platformRole,
    email: user.email,
    fullName: user.fullName,
    activeTenantId: session.activeTenantId,
    sessionId: session.id,
    requestId,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function switchActiveWorkspace(platformCtx: PlatformCtx, tenantId: string) {
  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      tenantId,
      platformUserId: platformCtx.platformUserId,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE', deletedAt: null },
      salesUser: { status: 'ACTIVE', deletedAt: null },
    },
    select: { id: true },
  });
  if (!membership) throw Unauthorized('You do not have access to that workspace.');
  await prisma.platformSession.update({
    where: { id: platformCtx.sessionId },
    data: { activeTenantId: tenantId, lastSeenAt: new Date() },
  });
}

/**
 * Resolves the request into a Ctx: session validity, idle timeout, user status, and
 * the role's full permission map with per-permission scopes.
 */
export async function resolveCtx(req: Request, requestId: string): Promise<Ctx> {
  const token = await sessionToken(req);
  if (!token) throw Unauthorized();

  const platformSession = await prisma.platformSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { platformUser: true },
  });
  if (platformSession) {
    const platformCtx = await resolvePlatformCtx(req, requestId);
    if (!platformCtx.activeTenantId) throw Unauthorized('Choose a workspace to continue.');
    const membership = await prisma.workspaceMembership.findFirst({
      where: {
        platformUserId: platformCtx.platformUserId,
        tenantId: platformCtx.activeTenantId,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE', deletedAt: null },
        salesUser: { status: 'ACTIVE', deletedAt: null },
      },
      select: { salesUserId: true },
    });
    if (!membership?.salesUserId) throw Unauthorized('Your workspace access is not active.');
    const actor = await buildActor(membership.salesUserId, platformCtx.activeTenantId);
    return {
      tenantId: platformCtx.activeTenantId,
      actor,
      requestId,
      ip: platformCtx.ip,
      userAgent: platformCtx.userAgent,
    };
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          teams: { select: { teamId: true } },
        },
      },
    },
  });

  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) throw Unauthorized('Your session has expired.');

  const idleCutoff = new Date(now.getTime() - env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
  if (session.lastSeenAt < idleCutoff) {
    await prisma.session.update({
      where: { tenantId: session.tenantId, id: session.id },
      data: { revokedAt: now, revokedReason: 'IDLE_TIMEOUT' },
    });
    throw Unauthorized('Your session timed out.');
  }

  const user = session.user;
  if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Unauthorized();

  // Cheap heartbeat; avoids a write on every single request.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { tenantId: session.tenantId, id: session.id }, data: { lastSeenAt: now } });
  }

  const actor = await buildActor(user.id, user.tenantId);

  return {
    tenantId: user.tenantId,
    actor,
    requestId,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  };
}

/**
 * Builds a request-less Ctx for a known user — what workers use to run automation
 * actions "as" the automation's owning user, per docs/04-AUTOMATION-ENGINE.md §5.
 * No session or IP involved; a worker isn't answering an HTTP request.
 */
export async function ctxForUser(userId: string, tenantId: string, requestId: string): Promise<Ctx> {
  const actor = await buildActor(userId, tenantId);
  return { tenantId, actor, requestId, ip: null, userAgent: null };
}

async function buildActor(userId: string, tenantId: string): Promise<Actor> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      teams: { select: { teamId: true } },
    },
  });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Unauthorized();

  const permissions = new Map<string, Scope>();
  for (const rp of user.role.permissions) {
    if (!rp.granted) continue;
    permissions.set(`${rp.permission.module}:${rp.permission.action}`, rp.scope as Scope);
  }

  const managed = await prisma.user.findMany({
    where: { tenantId: user.tenantId, managerId: user.id },
    select: { id: true },
  });

  return {
    id: user.id,
    tenantId: user.tenantId,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleRank: user.role.rank,
    branchId: user.branchId,
    regionId: user.regionId,
    teamIds: user.teams.map((t) => t.teamId),
    managedUserIds: managed.map((m) => m.id),
    permissions,
  };
}

export function clientIp(req: Request, trustProxyHeaders = env.TRUST_PROXY_HEADERS): string | null {
  if (!trustProxyHeaders) return null;
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0]!.trim() : req.headers.get('x-real-ip');
}

export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
