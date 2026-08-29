import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';
import { readCachedActor, writeCachedActor } from './actorCache';
import { env } from '../env';
import { getNumericSetting } from '../platform-settings';
import { Forbidden, Unauthorized } from '../errors';
import { SCOPE_RANK, type Actor, type Ctx, type Scope } from '../security/rbac';
import { buildSupportActor, isSupportRole } from './support-actor';
import { isPrivilegedPlatformRole, isPlatformServiceRole } from './platform-policy';
import { isInAny, parseCidrList, parseIp, type Cidr } from '../security/cidr';
import { logger } from '../logger';

export const SESSION_COOKIE = 'lf_session';

/**
 * A second cookie, for `AI_SERVICE` sessions only.
 *
 * One cookie name cannot hold two identities. An operator signing into the
 * platform console overwrote their service session — same browser, same name,
 * last write wins — and the next request carried the owner's FULL session to an
 * endpoint that only accepts AI_SERVICE, which surfaced as the useless "This
 * session cannot be used here."
 *
 * These two identities are *expected* to be held at once: the console is where
 * the service account is administered, and the service session is what you use
 * to see what it can see. Giving them separate names lets both live in one
 * browser instead of silently evicting each other.
 */
export const SERVICE_SESSION_COOKIE = 'lf_service_session';

/** Which cookie a session's purpose belongs in. */
const cookieFor = (purpose: SessionPurpose) =>
  purpose === 'AI_SERVICE' ? SERVICE_SESSION_COOKIE : SESSION_COOKIE;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Minutes an MFA-enrolment grant lives. Long enough to scan a QR code, no longer. */
export const MFA_ENROLMENT_TTL_MINUTES = 10;

/**
 * FULL is an ordinary signed-in human session. MFA_ENROLMENT is the restricted
 * grant that reaches only the enrolment endpoints. AI_SERVICE is an interactive
 * session for a machine identity, mintable only by api/v1/auth/service-login.
 */
export type SessionPurpose = 'FULL' | 'MFA_ENROLMENT' | 'AI_SERVICE';

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
  // A machine identity's interactive session is deliberately short — see
  // SERVICE_SESSION_TTL_MINUTES in lib/env.ts.
  /**
   * Three lifetimes, and only one of them is operator-tunable.
   *
   * A human session takes `sessionTtlMinutes` from platform settings, which is
   * what main made editable — an operator changing it must still change it for
   * people. The machine identity's interactive session deliberately does not
   * follow that dial: raising the human session to a working day must not
   * silently extend a cross-tenant read-only account to match, so it stays on
   * `SERVICE_SESSION_TTL_MINUTES` and is capped at 480 in lib/env.ts.
   */
  const ttlMinutes =
    purpose === 'MFA_ENROLMENT'
      ? MFA_ENROLMENT_TTL_MINUTES
      : purpose === 'AI_SERVICE'
        ? env.SERVICE_SESSION_TTL_MINUTES
        : await getNumericSetting('sessionTtlMinutes');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

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

  await setSessionCookie(token, expiresAt, cookieFor(purpose));
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
export async function setSessionCookie(token: string, expiresAt: Date, name: string = SESSION_COOKIE) {
  try {
    (await cookies()).set(name, token, {
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

/**
 * Every live session for a platform identity, by identity id.
 *
 * `revokeAllSessions` below cannot serve this: it resolves the identity through
 * `WorkspaceMembership`, and a platform service identity has none by design — so
 * it would find nothing and silently revoke nothing, which is the worst possible
 * outcome for a function whose whole job is ending access.
 *
 * Returns the count so a caller can report what it actually did rather than
 * assuming.
 */
export async function revokeAllPlatformSessions(
  platformUserId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const { count } = await prisma.platformSession.updateMany({
    where: {
      platformUserId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
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
  platformRole: 'USER' | 'OWNER' | 'SUPPORT' | 'SECURITY_AUDITOR' | 'AI_SERVICE';
  email: string;
  fullName: string;
  /** Null while an administrator-issued password is still in force. */
  passwordChangedAt: Date | null;
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
async function readCookie(req: Request, name: string): Promise<string | undefined> {
  for (const part of req.headers.get('cookie')?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  try {
    return (await cookies()).get(name)?.value;
  } catch {
    return undefined;
  }
}

/**
 * The tokens this request carries, in the order they should be tried for a
 * given set of allowed purposes.
 *
 * A browser can now hold both a human session and a service session at once, so
 * "which one did you mean" has to be answered by something other than
 * whichever was written last. It is answered by the route: a handler that
 * accepts only AI_SERVICE gets the service cookie first, everything else gets
 * the ordinary one first. The *other* cookie is still tried as a fallback, so a
 * browser holding only one of the two keeps working everywhere it should.
 */
async function sessionTokens(req: Request, allowPurpose: readonly SessionPurpose[]): Promise<string[]> {
  const preferService = allowPurpose.length === 1 && allowPurpose[0] === 'AI_SERVICE';
  const names = preferService
    ? [SERVICE_SESSION_COOKIE, SESSION_COOKIE]
    : [SESSION_COOKIE, SERVICE_SESSION_COOKIE];
  const tokens: string[] = [];
  for (const name of names) {
    const value = await readCookie(req, name);
    if (value && !tokens.includes(value)) tokens.push(value);
  }
  return tokens;
}

/** One session by token, or null when it does not exist, is revoked or has expired. */
async function loadSession(token: string, now: Date) {
  const session = await prisma.platformSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { platformUser: true },
  });
  if (!session || session.revokedAt || session.expiresAt < now) return null;
  return session;
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
  const tokens = await sessionTokens(req, allowPurpose);
  if (tokens.length === 0) throw Unauthorized();

  const now = new Date();
  /**
   * With two cookies in play, the first token that resolves to a *usable*
   * session wins — usable meaning live and of a purpose this route accepts.
   *
   * Checking the purpose here rather than only below is what stops one identity
   * masking the other: a browser holding both an owner session and a service
   * session used to send whichever cookie was written last, so opening the
   * console evicted the service session and the next request was refused with
   * "this session cannot be used here" while a perfectly good session sat in
   * the other cookie.
   */
  const live = (await Promise.all(tokens.map((candidate) => loadSession(candidate, now)))).filter(
    (found): found is NonNullable<typeof found> => found !== null,
  );
  if (live.length === 0) throw Unauthorized('Your session has expired.');

  /**
   * Among the sessions this route will accept, the most recently created wins.
   *
   * Order of cookies cannot decide it. Workspace routes accept both FULL and
   * AI_SERVICE, so "first allowed cookie" always picked the human session and
   * a service session could never browse a workspace while a console session
   * existed — the original bug, moved rather than fixed.
   *
   * Recency matches what the person did: whichever identity they signed in as
   * most recently is the one they are using. The difference from the old
   * single-cookie behaviour is that the other session now *survives* instead of
   * being overwritten, so switching back is a sign-in rather than a recovery.
   *
   * A route with a single allowed purpose is unambiguous and never reaches this
   * — the console gets the owner, the service endpoints get the service session.
   */
  const usable = live
    .filter((found) => allowPurpose.includes(found.purpose as SessionPurpose))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // No usable one: fall through with any live session so the purpose check
  // below explains *why* rather than reporting a generic expiry.
  const session = usable[0] ?? live[0]!;

  if (!allowPurpose.includes(session.purpose as SessionPurpose)) {
    throw Unauthorized(
      session.purpose === 'MFA_ENROLMENT'
        ? 'Finish setting up two-factor authentication before continuing.'
        : 'This session cannot be used here.',
    );
  }

  const idleCutoff = new Date(now.getTime() - (await getNumericSetting('sessionIdleTimeoutMinutes')) * 60_000);
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
   * A machine identity may hold a session, but only one its own path minted.
   *
   * This used to refuse every AI_SERVICE session outright, which was right while
   * the identity had no password. It is narrowed rather than removed: the
   * purpose column is the proof that the dedicated username → password → MFA
   * route in api/v1/auth/service-login issued this session.
   *
   * Both directions are checked, and the second matters as much as the first. An
   * AI_SERVICE identity holding a FULL session means the human login route
   * accepted it and the dedicated path was bypassed. A human identity holding an
   * AI_SERVICE session means a service session outlived a role change — someone
   * demoted to USER, or promoted to OWNER, while signed in — and the session must
   * not survive that either way.
   */
  const serviceIdentity = isPlatformServiceRole(user.platformRole);
  const servicePurpose = session.purpose === 'AI_SERVICE';
  if (serviceIdentity !== servicePurpose && session.purpose !== 'MFA_ENROLMENT') {
    logger.error(
      { platformUserId: user.id, sessionId: session.id, purpose: session.purpose, role: user.platformRole },
      'platform session purpose does not match the identity role',
    );
    await prisma.platformSession.update({
      where: { id: session.id },
      data: { revokedAt: now, revokedReason: 'ROLE_PURPOSE_MISMATCH' },
    });
    throw Unauthorized();
  }

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
    passwordChangedAt: user.passwordChangedAt,
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
  /**
   * Only a PlatformSession is a session, so this delegates straight to
   * resolvePlatformCtx — it answers a missing row with the same
   * "Your session has expired". A pre-check findUnique used to run here first,
   * which meant the identical session query executed twice on every
   * authenticated request. (A legacy `Session` branch the pre-check existed to
   * arbitrate is long gone; see the git history of this function.)
   */
  // AI_SERVICE alongside FULL, because a workspace request is exactly what an
  // interactive service session exists to make. The purpose is still checked
  // against the identity's role inside resolvePlatformCtx, so widening the list
  // here does not let a human session in through the service door or the
  // reverse; MFA_ENROLMENT stays excluded, as it reaches no workspace at all.
  const platformCtx = await resolvePlatformCtx(req, requestId, ['FULL', 'AI_SERVICE']);
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
      : isPlatformServiceRole(platformCtx.platformRole)
        ? await serviceSessionActor(platformCtx)
        : null;
  if (!actor) throw Unauthorized('Your workspace access is not active.');
  return {
    tenantId: platformCtx.activeTenantId,
    actor,
    requestId,
    ip: platformCtx.ip,
    userAgent: platformCtx.userAgent,
    // Only for real members: a support actor holds no workspace credential to
    // change, and forcing platform staff through the screen would lock them out.
    ...(membership?.salesUserId
      ? {
          mustChangePassword: platformCtx.passwordChangedAt === null,
          passwordChangedAt: platformCtx.passwordChangedAt,
        }
      : {}),
  };
}

/**
 * The workspace actor for an interactive `AI_SERVICE` session.
 *
 * Everything the machine credential path enforces per request has to hold here
 * too, or signing in through a browser becomes the way around the scoping:
 *
 *   * the identity's `serviceScopes` narrow the permission map, exactly as a
 *     credential's scopes do — and an empty list grants nothing,
 *   * `serviceTenantAllowlist` decides which workspaces may be opened at all,
 *   * `buildSupportActor` is the same builder, so read-only and the
 *     OWNER-only elevation branch apply unchanged.
 *
 * Read on every request rather than captured at login, so narrowing an
 * identity's scopes or allowlist takes effect on the next request instead of at
 * the next sign-in.
 */
async function serviceSessionActor(platformCtx: PlatformCtx): Promise<Actor | null> {
  const identity = await prisma.platformUser.findUnique({
    where: { id: platformCtx.platformUserId },
    select: { serviceScopes: true, serviceTenantAllowlist: true },
  });
  if (!identity) return null;
  if (identity.serviceTenantAllowlist.length && !identity.serviceTenantAllowlist.includes(platformCtx.activeTenantId!)) {
    throw Forbidden('This service identity is not permitted in that workspace.');
  }
  return buildSupportActor(
    platformCtx.activeTenantId!,
    platformCtx.platformUserId,
    platformCtx.platformRole,
    identity.serviceScopes,
  );
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

/**
 * The permission set for one user in one workspace.
 *
 * Cached in Redis — see lib/auth/actorCache.ts for the versioning, and why
 * invalidation is a single INCR rather than a key sweep. The cache is checked
 * first and written last; everything between is the original build, unchanged.
 *
 * The *session* is deliberately not cached and is still read from the database
 * on every request, so signing someone out remains immediate. Only what they may
 * do once signed in comes from here.
 */
async function buildActor(userId: string, tenantId: string): Promise<Actor> {
  const hit = await readCachedActor(tenantId, userId);
  if (hit) return hit;

  const actor = await loadActor(userId, tenantId);
  await writeCachedActor(tenantId, userId, actor);
  return actor;
}

async function loadActor(userId: string, tenantId: string): Promise<Actor> {
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
    fullName: user.fullName,
    email: user.email,
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
