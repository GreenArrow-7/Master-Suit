import { randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { Forbidden, Invalid, NotFound, Unauthorized } from '../errors';
import { hashPassword, verifyPassword } from './password';
import { clientIp } from './session';
import { buildSupportActor, platformUserIdOf } from './support-actor';
import { isPlatformServiceRole } from './platform-policy';
import { consume, limits } from '../security/ratelimit';
import { redis } from '../redis';
import { logger } from '../logger';
import type { Ctx } from '../security/rbac';

/**
 * The anonymous platform service identity: background and AI reads across every
 * workspace, with no membership in any of them.
 *
 * ── What makes it invisible, and what does not ──────────────────────────────
 *
 * It is invisible to tenants for one structural reason: it has no
 * `WorkspaceMembership`, and therefore no `User` row. Every tenant-facing list —
 * workspace users, the org chart, member management, account search — reads
 * `User` scoped by `tenantId`. There is no filter anywhere suppressing this
 * identity, and that matters: a filter is something a future query can forget,
 * whereas a row that does not exist cannot be selected by a query nobody has
 * written yet.
 *
 * It is **not** invisible in the platform audit log, and nothing here tries to
 * make it so. Every request it makes writes a `PlatformAuditEvent` — see
 * `recordPlatformAccess`, called unconditionally by the API kernel rather than
 * per-route, because "every route remembered to audit" is not a property either.
 *
 * ── Why a credential and not a password ─────────────────────────────────────
 *
 * `PlatformUser.passwordHash` is left null for these identities, and the login
 * route already refuses an account without one. So there is no interactive
 * sign-in to this identity at all — not a policy, a missing credential. The only
 * way in is a `PlatformServiceCredential`, which expires on a required date and
 * can be rotated or revoked without touching any human's account.
 */

/** `lf_svc_<8-char prefix>_<43-char secret>`. Only the prefix is stored in clear. */
const PREFIX = 'lf_svc';

/**
 * The ceiling on a credential's life.
 *
 * Ninety days is the longest this codebase is willing to let a cross-tenant
 * machine credential run before somebody has to make a decision about it. It is
 * a maximum, not a default — `issueServiceCredential` requires the caller to
 * name a shorter one if the job is shorter.
 */
export const MAX_CREDENTIAL_DAYS = 90;

/**
 * Read actions only.
 *
 * This is the second of the two places read-only is enforced, and it is
 * deliberately redundant with `buildSupportActor`, which never puts a write
 * permission in the map to begin with. A scope string is operator input; the
 * actor is code. Validating here means a typo'd `leads:write` at mint time is a
 * rejected argument rather than a silently ineffective one that reads as granted
 * in the credential listing.
 */
const READ_SCOPE = /^[a-z][a-z0-9_]*:read$/;

export interface IssuedCredential {
  id: string;
  /** Returned exactly once. Nothing can retrieve it again. */
  secret: string;
  expiresAt: Date;
}

function assertScopes(scopes: string[]) {
  if (scopes.length === 0) {
    throw Invalid([{ field: 'scopes', code: 'required', message: 'A credential with no scopes can read nothing.' }]);
  }
  const bad = scopes.filter((scope) => !READ_SCOPE.test(scope));
  if (bad.length) {
    throw Invalid([
      {
        field: 'scopes',
        code: 'invalid',
        message: `Only read scopes are grantable to a service identity. Rejected: ${bad.join(', ')}.`,
      },
    ]);
  }
}

/**
 * Mints one.
 *
 * Refuses any identity that is not `AI_SERVICE`: this credential bypasses the
 * password and the authenticator, and pointing it at a human's platform account
 * would be a way to hold that account's authority without either.
 */
export async function issueServiceCredential(input: {
  platformUserId: string;
  name: string;
  scopes: string[];
  tenantAllowlist?: string[];
  days: number;
  createdById?: string;
  rotatedFromId?: string;
}): Promise<IssuedCredential> {
  assertScopes(input.scopes);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_CREDENTIAL_DAYS) {
    throw Invalid([{ field: 'days', code: 'range', message: `Between 1 and ${MAX_CREDENTIAL_DAYS} days.` }]);
  }

  const identity = await prisma.platformUser.findFirst({
    where: { id: input.platformUserId, deletedAt: null },
    select: { id: true, platformRole: true, status: true },
  });
  if (!identity) throw NotFound('Platform identity');
  if (!isPlatformServiceRole(identity.platformRole)) {
    throw Forbidden('Service credentials can only be issued to an AI_SERVICE identity.');
  }

  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.days * 86_400_000);

  const record = await prisma.platformServiceCredential.create({
    data: {
      platformUserId: identity.id,
      name: input.name,
      prefix,
      keyHash: await hashPassword(secret),
      scopes: input.scopes,
      tenantAllowlist: input.tenantAllowlist ?? [],
      expiresAt,
      createdById: input.createdById,
      rotatedFromId: input.rotatedFromId,
    },
  });

  return { id: record.id, secret: `${PREFIX}_${prefix}_${secret}`, expiresAt };
}

/**
 * Replaces a credential with a fresh one carrying the same scoping.
 *
 * The old one is revoked in the same call rather than left to overlap. An
 * overlap window would be kinder to a caller mid-deployment and would mean two
 * live credentials for one identity, which is the state in which "revoke it" and
 * "rotate it" stop having the same effect. Callers that need a hand-over run
 * `issue` then `revoke` themselves, deliberately, with both ids in hand.
 */
export async function rotateServiceCredential(
  credentialId: string,
  days: number,
  actorId?: string,
): Promise<IssuedCredential> {
  const current = await prisma.platformServiceCredential.findUnique({ where: { id: credentialId } });
  if (!current) throw NotFound('Service credential');

  const replacement = await issueServiceCredential({
    platformUserId: current.platformUserId,
    name: current.name,
    scopes: current.scopes,
    tenantAllowlist: current.tenantAllowlist,
    days,
    createdById: actorId,
    rotatedFromId: current.id,
  });
  await revokeServiceCredential(current.id, `Rotated to ${replacement.id}`);
  return replacement;
}

/** Immediate and irreversible. Rows are kept — they are the record of what was live when. */
export async function revokeServiceCredential(credentialId: string, reason: string) {
  await prisma.platformServiceCredential.updateMany({
    where: { id: credentialId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Every live credential for an identity — the "turn it off now" path. */
export async function revokeAllForIdentity(platformUserId: string, reason: string) {
  const { count } = await prisma.platformServiceCredential.updateMany({
    where: { platformUserId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}

/**
 * The header naming the workspace to read.
 *
 * A session-based caller carries its workspace in `activeTenantId`; a
 * cross-tenant machine has no such thing and must say which workspace each
 * request is about. Making it explicit per request is also what makes the audit
 * row's `tenantId` truthful without inferring it.
 */
export const WORKSPACE_HEADER = 'x-workspace-id';
/** Unverified breadcrumb: which upstream job or operator triggered this call. */
export const INITIATOR_HEADER = 'x-initiated-by';

/**
 * Authenticates a platform service identity and returns the workspace-scoped
 * `Ctx` it may act with.
 *
 * The order matters and is the same order `authenticateApiKey` uses: identify
 * the credential, verify the secret, *then* spend rate-limit budget. Consuming
 * before verification would let an unauthenticated caller exhaust a real
 * credential's allowance by guessing at its prefix.
 */
export async function requirePlatformServiceActor(req: Request, requestId: string): Promise<Ctx> {
  const header = req.headers.get('authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : '';

  const parts = raw.split('_');
  // Same shape as lib/auth/apiKey.ts: the secret is base64url and may itself
  // contain `_`, so the remainder is rejoined rather than taken as one field.
  if (parts.length < 4 || parts[0] !== 'lf' || parts[1] !== 'svc') throw Unauthorized('Invalid service credential.');
  const credential = await prisma.platformServiceCredential.findUnique({
    where: { prefix: parts[2] },
    include: {
      platformUser: { select: { id: true, platformRole: true, status: true, deletedAt: true } },
    },
  });

  const now = new Date();
  if (!credential || credential.revokedAt || credential.expiresAt < now) {
    throw Unauthorized('Invalid service credential.');
  }
  if (!(await verifyPassword(credential.keyHash, parts.slice(3).join('_')))) {
    throw Unauthorized('Invalid service credential.');
  }

  // Checked after the secret, so the identity's standing is not an oracle for a
  // valid prefix, and checked at all because revoking the *identity* has to stop
  // its credentials too — otherwise disabling the account leaves the machine in.
  const identity = credential.platformUser;
  if (!identity || identity.deletedAt || identity.status !== 'ACTIVE') throw Unauthorized();
  if (!isPlatformServiceRole(identity.platformRole)) {
    throw Forbidden('That credential does not belong to a service identity.');
  }

  await consume(limits.platformService(credential.id, credential.rateLimitPerMin));

  const tenantId = req.headers.get(WORKSPACE_HEADER)?.trim();
  if (!tenantId) {
    throw Invalid([
      { field: WORKSPACE_HEADER, code: 'required', message: 'Name the workspace this request is about.' },
    ]);
  }
  if (credential.tenantAllowlist.length && !credential.tenantAllowlist.includes(tenantId)) {
    throw Forbidden('This credential is not permitted in that workspace.');
  }
  const workspace = await prisma.tenant.findFirst({
    where: { id: tenantId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!workspace) throw NotFound('Workspace');

  prisma.platformServiceCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } }).catch(() => {});

  return {
    tenantId,
    // One actor builder for platform callers, narrowed by this credential's
    // scopes. Reused rather than reimplemented: a second permission map for
    // machine callers is a second place for "read-only" to stop being true.
    actor: await buildSupportActor(tenantId, identity.id, identity.platformRole, credential.scopes),
    requestId,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
    service: {
      credentialId: credential.id,
      platformUserId: identity.id,
      declaredInitiator: req.headers.get(INITIATOR_HEADER)?.slice(0, 200) ?? null,
    },
  };
}

/**
 * How many distinct workspaces one credential may touch in an hour before it is
 * worth a look.
 *
 * A legitimate background job sweeps many workspaces, so this is not a limit and
 * does not refuse anything — refusing on a heuristic would break the nightly run
 * at whatever hour the customer count crossed the threshold. It writes a warning
 * with the count and the credential, which is the signal an on-call operator can
 * correlate against what that job was supposed to be doing.
 */
const SPREAD_WARN_AT = 50;

/**
 * Counts distinct workspaces per credential per hour, in Redis.
 *
 * A Redis set keyed to the hour rather than a query over PlatformAuditEvent:
 * the audit table is the record, not an index for this question, and a
 * `COUNT(DISTINCT tenantId)` on every service request would grow with the log.
 *
 * Best-effort by design — Redis being down must not stop the audit row from
 * being written. Losing a monitoring signal is recoverable; losing the record of
 * a cross-tenant read is not.
 */
async function noteWorkspaceSpread(credentialId: string, tenantId: string) {
  try {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `svc:spread:${credentialId}:${hour}`;
    await redis.sadd(key, tenantId);
    await redis.expire(key, 7200);
    const count = await redis.scard(key);
    if (count === SPREAD_WARN_AT || count % (SPREAD_WARN_AT * 10) === 0) {
      logger.warn(
        { credentialId, workspaces: count, windowHours: 1 },
        'platform service credential is reading an unusual number of workspaces',
      );
    }
  } catch (err) {
    logger.warn({ err, credentialId }, 'service spread monitor unavailable');
  }
}

/**
 * The audit row for one request made by a platform identity — machine or human.
 *
 * Called by the API kernel for every request such an identity makes — not by the
 * routes, and not only for routes that declare an `auditEvent`. A cross-tenant
 * reader whose reads are audited only where somebody remembered to ask is a
 * reader with an incomplete trail, and the gap would be invisible until an
 * incident asked what it had seen.
 *
 * ── Why it stopped being service-only ───────────────────────────────────────
 *
 * It was `recordServiceAccess`, and the asymmetry it left was the largest audit
 * gap in the product. An `AI_SERVICE` credential had every request recorded;
 * a *person* holding platform staff authority had one `WORKSPACE_OPENED` row at
 * the door and nothing afterwards. The machine was held to the stricter standard
 * than the human, which is exactly backwards — a credential cannot decide to go
 * looking at a customer's data out of curiosity.
 *
 * Both callers are recognised from `ctx.actor.id`, which carries the platform
 * prefix for both, so a future third kind of platform caller is audited by
 * default rather than by being remembered here.
 *
 * Failure to write is deliberately fatal to the request. The alternative —
 * logging the failure and serving the data anyway — is a read of a customer's
 * records with no record of it, which is the one outcome this whole design
 * exists to prevent.
 */
export async function recordPlatformAccess(
  ctx: Ctx,
  detail: { module: string; action: string; method: string; path: string; objectId?: string; status: number },
) {
  // Self-guarding rather than guarded at the call site: the kernel calls this on
  // every request, and "the caller forgot the `if`" must not be the difference
  // between an audited read and an unaudited one.
  const platformUserId = ctx.service?.platformUserId ?? platformUserIdOf(ctx.actor.id);
  if (!platformUserId) return;

  // Machine-only, and left that way. The spread monitor answers "is one
  // credential sweeping an unusual number of workspaces", which is a question
  // about an automated job; a person opening workspaces one at a time through a
  // console does not produce the shape it looks for.
  if (ctx.service) await noteWorkspaceSpread(ctx.service.credentialId, ctx.tenantId);

  await prisma.platformAuditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: platformUserId,
      /**
       * Two streams, one table. The customer's audit screen already filters on
       * SERVICE_READ to separate automated reads from everything else, so a
       * distinct name is what keeps staff activity separable from machine
       * activity without either becoming invisible.
       *
       * Decided from the actor's role key, not from `ctx.service`. A machine
       * identity reaches a workspace two ways — a credential, which sets
       * `ctx.service`, and the interactive session `api/v1/auth/service-login`
       * mints, which does not — and the second was the other half of this audit
       * gap: its reads were recorded nowhere at all, because the kernel's old
       * `if (ctx?.service)` did not recognise it as a service caller. Keying on
       * the role key puts both under SERVICE_READ, where a customer looking at
       * their "Platform service" tab expects automated reads to appear.
       */
      event: ctx.actor.roleKey === 'platform_service' ? 'SERVICE_READ' : 'SUPPORT_READ',
      objectType: detail.module,
      objectId: detail.objectId,
      requestId: ctx.requestId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        action: detail.action,
        method: detail.method,
        path: detail.path,
        status: detail.status,
        ...(ctx.service
          ? {
              credentialId: ctx.service.credentialId,
              // Prefixed to keep it readable as what it is: a claim by the
              // caller, not something this system verified. See
              // Ctx.service.declaredInitiator.
              declaredInitiator: ctx.service.declaredInitiator,
            }
          : { roleKey: ctx.actor.roleKey, mode: ctx.actor.platformMode }),
      },
    },
  });
}
