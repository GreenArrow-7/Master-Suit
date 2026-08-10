import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';
import { env } from '../env';
import { Forbidden, Unauthorized } from '../errors';
import { SCOPE_RANK, type Actor, type Ctx, type Scope } from '../security/rbac';
import { buildSupportActor, isSupportRole } from './support-actor';
import { isPrivilegedPlatformRole } from './platform-policy';
import { isInAny, parseCidrList, parseIp, type Cidr } from '../security/cidr';

export const SESSION_COOKIE = 'lf_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Minutes an MFA-enrolment grant lives. Long enough to scan a QR code, no longer. */
export const MFA_ENROLMENT_TTL_MINUTES = 10;

export type SessionPurpose = 'FULL' | 'MFA_ENROLMENT';

export async function createPlatformSession(input: {
  platformUserId: string;
  activeTenantId: string | null;
  ip: string | null;
  userAgent: string | null;
  mfaSatisfied: boolean;
  purpose?: SessionPurpose;
}) {
  const token = randomBytes(32).toString('base64url');
  const purpose = input.purpose ?? 'FULL';
  const expiresAt =
    purpose === 'MFA_ENROLMENT'
      ? new Date(Date.now() + MFA_ENROLMENT_TTL_MINUTES * 60_000)
      : new Date(Date.now() + env.SESSION_TTL_MINUTES * 60_000);

  await prisma.platformSession.create({
    data: {
      platformUserId: input.platformUserId,
      activeTenantId: input.activeTenantId,
      tokenHash: sha256(token),
      ipAddress: input.ip,
      userAgent: input.userAgent,
      mfaSatisfied: input.mfaSatisfied,
      purpose,
      expiresAt,
    },
  });

  await setSessionCookie(token, expiresAt);
  return { token, expiresAt };
}

/**
 * Writes the session cookie.
 *
 * Separated from session creation because they are different concerns and fail
 * differently: creating the row is the security decision, writing the cookie is
 * transport. `cookies()` throws outside a Next request scope, which made every
 * session-creating route impossible to exercise from a test — the reason the
 * login flow had no coverage at all before Phase 3.
 *
 * Outside a request scope this is a no-op and the caller still gets its token.
 * That is safe: the only callers that skip the scope are tests, and a route
 * that fails to set a cookie in production would have thrown here anyway.
 */
export async function setSessionCookie(token: string, expiresAt: Date) {
  try {
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  } catch {
    // No request scope — a direct handler call from a test.
  }
}

export async function revokeSession(token: string, reason = 'USER_LOGOUT') {
  const tokenHash = sha256(token);
  await prisma.platformSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  try {
    (await cookies()).delete(SESSION_COOKIE);
  } catch {
    /* no request scope */
  }
}

/** A password or role change invalidates every other session for that user. */
export async function revokeAllSessions(
  tenantId: string,
  userId: string,
  except?: string,
  reason = 'CREDENTIAL_CHANGE',
) {
  const membership = await prisma.workspaceMembership.findUnique({ where: { salesUserId: userId } });
  if (!membership) return;
  await prisma.platformSession.updateMany({
    where: {
      platformUserId: membership.platformUserId,
      revokedAt: null,
      ...(except ? { NOT: { tokenHash: sha256(except) } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export type PlatformCtx = {
  platformUserId: string;
  platformRole: 'USER' | 'OWNER' | 'SUPPORT' | 'SECURITY_AUDITOR';
  email: string;
  fullName: string;
  activeTenantId: string | null;
  sessionId: string;
  purpose: SessionPurpose;
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

/**
 * Resolves the platform session.
 *
 * `allowPurpose` defaults to FULL only. An MFA-enrolment grant is not a signed-in
 * session: it exists so a user forced to enrol has somewhere to do it, and it
 * must be refused everywhere except the enrolment, verification and logout
 * endpoints, which opt in explicitly.
 */
export async function resolvePlatformCtx(
  req: Request,
  requestId: string,
  allowPurpose: readonly SessionPurpose[] = ['FULL'],
): Promise<PlatformCtx> {
  const token = await sessionToken(req);
  if (!token) throw Unauthorized();

  const session = await prisma.platformSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { platformUser: true },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) throw Unauthorized('Your session has expired.');

  if (!allowPurpose.includes(session.purpose as SessionPurpose)) {
    throw Unauthorized(
      session.purpose === 'MFA_ENROLMENT'
        ? 'Finish setting up two-factor authentication before continuing.'
        : 'This session cannot be used here.',
    );
  }

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

  /**
   * Platform staff must have completed two-factor authentication.
   *
   * These roles read across every customer workspace — the owner through the
   * platform console, all three through the support actor — and nothing
   * previously required more than a password to do it.
   *
   * `session.mfaSatisfied` is the authority: a column on PlatformSession written
   * by the login route only after a TOTP code or a recovery code has actually
   * verified. It is never derived from anything the client sends, so a caller
   * cannot assert it.
   *
   * The enrolment grant is exempt because it is the way out: it reaches
   * /enroll-2fa and nothing else, so an owner without an authenticator can still
   * set one up rather than being locked out for good.
   */
  if (session.purpose !== 'MFA_ENROLMENT' && !session.mfaSatisfied && isPrivilegedPlatformRole(user.platformRole)) {
    throw Forbidden('Two-factor authentication is required for platform access. Sign in again to set it up.');
  }

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
    purpose: session.purpose as SessionPurpose,
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
    // Platform staff have no membership by design. Rather than locking them out
    // of every workspace URL, give them a support actor — full control for the
    // OWNER, read-only for SUPPORT and SECURITY_AUDITOR. See support-actor.ts.
    const actor = membership?.salesUserId
      ? await buildActor(membership.salesUserId, platformCtx.activeTenantId)
      : isSupportRole(platformCtx.platformRole)
        ? await buildSupportActor(platformCtx.activeTenantId, platformCtx.platformUserId, platformCtx.platformRole)
        : null;
    if (!actor) throw Unauthorized('Your workspace access is not active.');
    return {
      tenantId: platformCtx.activeTenantId,
      actor,
      requestId,
      ip: platformCtx.ip,
      userAgent: platformCtx.userAgent,
    };
  }

  /**
   * Only a PlatformSession is a session.
   *
   * There used to be a second branch here reading a legacy `Session` row. No
   * code path in the application ever created one — `createSession` was dead —
   * so it was reachable only from test fixtures, which meant the permission
   * suite authenticated through something production does not have. Worse, it
   * checked the user but never `tenant.status`, so it would have kept a
   * suspended workspace working. Both are gone; the table is next, once a
   * migration can drop it safely.
   */
  throw Unauthorized('Your session has expired.');
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

/**
 * What an additional role assignment's scope caps its permissions at.
 *
 * The assignment scope answers "where does this role apply", the role's own
 * permission rows answer "what may it do there" — a Branch Manager role
 * assigned for one branch must not confer its ORGANIZATION-scoped reads
 * everywhere. Unknown values cap at ORGANIZATION because that is the column
 * default the assign flow writes.
 */
const ASSIGNMENT_SCOPE_CAP: Record<string, Scope> = {
  ORGANIZATION: 'ORGANIZATION',
  REGION: 'REGION',
  BRANCH: 'BRANCH',
  TEAM: 'TEAM',
  DEPARTMENT: 'TEAM',
  DIRECT_REPORTS: 'TEAM',
  OWN: 'OWN',
  OWN_RECORD: 'OWN',
};

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
  const grant = (key: string, scope: Scope) => {
    const held = permissions.get(key);
    if (!held || SCOPE_RANK[scope] > SCOPE_RANK[held]) permissions.set(key, scope);
  };
  // A deactivated role grants nothing, wherever it is held — the v21 rule that
  // makes deactivation a real off-switch rather than a display state.
  if (user.role.isActive) {
    for (const rp of user.role.permissions) {
      if (!rp.granted) continue;
      grant(`${rp.permission.module}:${rp.permission.action}`, rp.scope as Scope);
    }
  }

  /**
   * Effective permissions are the union of the primary role and every ACTIVE,
   * in-window role assignment — recomputed here on every request, so a revoked
   * or expired assignment stops working on the next call, not the next login.
   * Each assignment contributes its role's permissions capped at the
   * assignment's own scope, and a BRANCH/REGION assignment that names a
   * location widens visibility to it (see resolveOwnerIds).
   */
  const now = new Date();
  const assignments = await prisma.membershipRole.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      membership: { salesUserId: userId },
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      ],
    },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  let rank = user.role.rank;
  const grantedBranchIds = new Set<string>();
  const grantedRegionIds = new Set<string>();
  // ponytail: the location grants are pooled across assignments rather than
  // tracked per permission — a user holding two branch-scoped roles can see
  // either branch at any BRANCH-scoped permission they hold. Split the pool
  // per permission if a customer ever needs that separation.
  for (const assignment of assignments) {
    if (!assignment.role.isActive) continue;
    const cap = ASSIGNMENT_SCOPE_CAP[assignment.scopeType] ?? 'ORGANIZATION';
    for (const rp of assignment.role.permissions) {
      if (!rp.granted) continue;
      const scope = SCOPE_RANK[rp.scope as Scope] < SCOPE_RANK[cap] ? (rp.scope as Scope) : cap;
      grant(`${rp.permission.module}:${rp.permission.action}`, scope);
    }
    // Authority is the strongest role held: the escalation guards compare
    // against this, so a deputy with an assigned admin role is treated as one.
    if (assignment.role.rank < rank) rank = assignment.role.rank;
    if (assignment.scopeType === 'BRANCH' && assignment.scopeId) grantedBranchIds.add(assignment.scopeId);
    if (assignment.scopeType === 'REGION' && assignment.scopeId) grantedRegionIds.add(assignment.scopeId);
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
    roleRank: rank,
    branchId: user.branchId,
    regionId: user.regionId,
    grantedBranchIds: [...grantedBranchIds],
    grantedRegionIds: [...grantedRegionIds],
    teamIds: user.teams.map((t) => t.teamId),
    managedUserIds: managed.map((m) => m.id),
    permissions,
  };
}

/**
 * The client's address, as far as it can be trusted.
 *
 * `X-Forwarded-For` is a list the client can start: a request arriving with
 * `X-Forwarded-For: 1.2.3.4` and no proxy in front has simply told us a lie.
 * So the list is walked from the **right**, discarding entries contributed by
 * proxies we recognise, and the first address that is not one of ours is the
 * furthest hop we have any reason to believe.
 *
 * Taking `split(',')[0]` — the previous behaviour of the disabled branch — reads
 * the leftmost entry, which is precisely the one an attacker controls.
 *
 * With no trusted proxies configured, the socket address is used unchanged and
 * forwarded headers are ignored entirely.
 */
export function clientIp(req: Request, trusted: readonly Cidr[] = trustedProxies()): string | null {
  /**
   * With nothing declared in front of this server, every forwarded header is
   * attacker-controlled and none of them may be believed.
   *
   * This branch used to `return socketIp` — the raw `x-real-ip` header — so a
   * deployment with `TRUSTED_PROXY_CIDRS=none` let any client pick its own
   * rate-limit identity by setting one header, and rotate it freely to make the
   * login limiter irrelevant. Returning null costs per-IP limiting (the caller
   * falls back to a shared bucket) but it cannot be steered by the caller, and
   * the per-account limit still applies. Configure TRUSTED_PROXY_CIDRS to get
   * per-IP limiting back.
   */
  if (trusted.length === 0) return null;

  /**
   * Right to left, because our own proxies append as the request passes through
   * them. The first entry from the right that is not one of ours is the furthest
   * hop we have any reason to believe; everything to its left was supplied by
   * the client and is unverifiable.
   *
   * Entries that do not parse as an address are skipped rather than returned, so
   * a malformed or injected header cannot become a rate-limit key.
   */
  const chain = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = normaliseIp(chain[i]);
    if (!candidate) continue;
    if (!isInAny(candidate, trusted)) return candidate;
  }

  // No usable chain, or all of it is ours: a declared proxy is expected to set
  // x-real-ip, and only a declared proxy can reach this line.
  return normaliseIp(req.headers.get('x-real-ip') ?? '');
}

/**
 * A header value reduced to a bare address, or null if it is not one.
 *
 * Proxies write `x-forwarded-for` entries in several shapes: bare IPv4,
 * `1.2.3.4:5678`, bracketed `[2001:db8::1]:443`, and IPv4-mapped IPv6. Anything
 * that survives here has been validated by parseIp, so a caller cannot inject
 * arbitrary text into a Redis key.
 */
function normaliseIp(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  // `host:port` only when there is exactly one colon — more than one is IPv6.
  else if (value.indexOf(':') !== -1 && value.indexOf(':') === value.lastIndexOf(':')) value = value.split(':')[0];

  return parseIp(value) ? value.toLowerCase() : null;
}

/** Parsed once. An unparseable entry is a configuration error, not a runtime one. */
let trustedCache: Cidr[] | null = null;
export function trustedProxies(): Cidr[] {
  if (trustedCache) return trustedCache;
  const raw = env.TRUSTED_PROXY_CIDRS.trim();
  // 'none' is the explicit "nothing in front of this server" answer.
  trustedCache = !raw || raw.toLowerCase() === 'none' ? [] : parseCidrList(raw);
  return trustedCache;
}

export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
