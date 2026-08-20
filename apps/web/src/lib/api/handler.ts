import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { AppError, Invalid, MethodNotAllowedError, Unauthorized } from '../errors';
import { logger } from '../logger';
import { TenantGuardError } from '../db';
import { resolveCtx, clientIp } from '../auth/session';
import { authenticateApiKey } from '../auth/apiKey';
import { assertPermission, type Action, type Ctx } from '../security/rbac';
import { consume, limits } from '../security/ratelimit';
import { audit, SECRET_KEYS, type AuditEventName } from '../security/audit';
import { assertModuleEntitlement, type ProductModule } from '../security/entitlements';
import { recordError, recordRequest } from '../metrics';

export interface RouteSpec<PS extends ZodTypeAny, QS extends ZodTypeAny, BS extends ZodTypeAny> {
  module: string;
  action: Action;
  productModule?: ProductModule;
  /** Skip authentication entirely. Only for /public and /webhooks/inbound routes. */
  anonymous?: boolean;
  /**
   * Authenticated, tenant-checked, but no permission required.
   *
   * Only for routes where every action reads `ctx.actor` and takes no target
   * parameter — changing your own password, enrolling your own authenticator.
   * These were gated on `hrms:VIEW`, which meant a Sales-only workspace's users
   * could not change their own password; gating them on a `users` permission
   * instead would lock out the HR-created employees who most need to replace a
   * temporary one. Neither is right: self-service is not a privilege.
   *
   * `module` is still declared, for audit and rate-limit keys.
   */
  selfService?: boolean;
  params?: PS;
  query?: QS;
  body?: BS;
  auditEvent?: AuditEventName;
  /** Per-route override; otherwise the credential's default applies. */
  rateLimit?: { max: number; windowSeconds: number };
}

export interface HandlerArgs<P, Q, B> {
  ctx: Ctx;
  params: P;
  query: Q;
  body: B;
  req: Request;
}

/**
 * The single entry point for every /api/v1 route. The order below is the security
 * contract described in docs/03-API.md §1 — a route that does not go through here
 * is a review blocker.
 */
export function route<
  PS extends ZodTypeAny = ZodTypeAny,
  QS extends ZodTypeAny = ZodTypeAny,
  BS extends ZodTypeAny = ZodTypeAny,
  P = unknown extends z.infer<PS> ? unknown : z.infer<PS>,
  Q = unknown extends z.infer<QS> ? unknown : z.infer<QS>,
  B = unknown extends z.infer<BS> ? unknown : z.infer<BS>,
>(spec: RouteSpec<PS, QS, BS>, handler: (args: HandlerArgs<P, Q, B>) => Promise<unknown>) {
  return async (req: Request, context: { params: Promise<Record<string, string>> }) => {
    const requestId = req.headers.get('x-request-id') ?? ulid();
    const started = Date.now();
    let ctx: Ctx | null = null;

    try {
      // 1. Authenticate ────────────────────────────────────────────────────────
      if (!spec.anonymous) {
        const bearer = req.headers.get('authorization');
        ctx = bearer?.startsWith('Bearer ')
          ? await authenticateApiKey(bearer.slice(7), req, requestId)
          : await resolveCtx(req, requestId);
      }

      // 2. Rate limit ──────────────────────────────────────────────────────────
      const ip = clientIp(req) ?? 'unknown';
      if (spec.rateLimit) {
        await consume({ key: `route:${spec.module}:${spec.action}:${ctx?.actor.id ?? ip}`, ...spec.rateLimit });
      } else if (ctx) {
        await consume(ctx.apiKeyId ? limits.apiKey(ctx.apiKeyId, 600) : limits.sessionUser(ctx.actor.id));
      }

      // 3. Authorize — before the handler body runs ────────────────────────────
      if (ctx) {
        // Only when the route declares one. The previous `?? 'SALES'` default
        // silently demanded the Sales entitlement from routes that had nothing
        // to do with Sales, and made "forgot to declare it" indistinguishable
        // from "deliberately Sales". Platform-level surfaces — users, roles,
        // profile, notifications — belong to no product module.
        if (spec.productModule) await assertModuleEntitlement(ctx.tenantId, spec.productModule);
        if (!spec.selfService) assertPermission(ctx, spec.module, spec.action);
      } else if (!spec.anonymous) throw Unauthorized();

      // 4. Validate ────────────────────────────────────────────────────────────
      // `!= null`, not truthiness: a Promise is always truthy, so the old test
      // was checking presence by accident rather than by intent.
      const rawParams = context?.params != null ? await context.params.catch(() => ({})) : {};
      const url = new URL(req.url);
      const rawQuery = Object.fromEntries(url.searchParams);
      const rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await req.json().catch(() => ({})) : {};

      const params = spec.params ? parse(spec.params, rawParams) : (rawParams as P);
      const query = spec.query ? parse(spec.query, rawQuery) : (rawQuery as unknown as Q);
      const body = spec.body ? parse(spec.body, rawBody) : (rawBody as B);

      // 5. Handle ──────────────────────────────────────────────────────────────
      // Scrubbed on the way out. A handler that returns a Prisma record with a
      // relation included returns *every* scalar on that relation, so one
      // `include: { platformUser: true }` was enough to publish password hashes
      // and live TOTP secrets. Per-route selects are the real fix; this is the
      // net under them, and it is here because this is the one place every
      // response body passes through.
      const result = scrubSecrets(await handler({ ctx: ctx!, params, query, body, req }));

      // 6. Audit ───────────────────────────────────────────────────────────────
      if (ctx && spec.auditEvent) {
        await audit(ctx, {
          event: spec.auditEvent,
          objectType: spec.module,
          recordId: (result as { id?: string } | null)?.id,
          metadata: { method: req.method, path: url.pathname },
        });
      }

      const ms = Date.now() - started;
      recordRequest(spec.module, spec.action, 200, ms);
      logger.info({ requestId, module: spec.module, action: spec.action, ms, tenantId: ctx?.tenantId }, 'request');

      /**
       * A handler that streams bytes returns its own Response.
       *
       * Without this, a download had to bypass the kernel and re-implement
       * authentication, entitlement, permission, rate limiting and audit by
       * hand — five chances to omit one. `scrubSecrets` leaves a Response
       * untouched (it is not a plain object), so nothing above is skipped.
       */
      if (result instanceof Response) {
        result.headers.set('x-request-id', requestId);
        return result;
      }

      return NextResponse.json(result ?? { ok: true }, { headers: { 'x-request-id': requestId } });
    } catch (err) {
      const response = toResponse(err, requestId, {
        module: spec.module,
        action: spec.action,
        tenantId: ctx?.tenantId,
      });
      // Counted here rather than inside toResponse: this is the one place that
      // sees both the outcome and how long reaching it took, and a slow 500 is a
      // different problem from a fast one.
      recordRequest(spec.module, spec.action, response.status, Date.now() - started);
      recordError(spec.module, spec.action, errorCode(err), response.status);
      return response;
    }
  };
}

/**
 * Deep-removes credential fields from anything on its way into a response body.
 *
 * Only plain objects and arrays are walked. Date, Buffer, Decimal, Map, Set and
 * every other class instance is returned untouched — rebuilding them as plain
 * objects would corrupt the payload, and none of them carry a key from
 * SECRET_KEYS. Cycles are tracked because Prisma results can carry back-relations.
 */
function scrubSecrets<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing as T;
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(scrubSecrets(item, seen));
    return out as T;
  }
  // Anything that is not a plain object is a value type to us.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const existing = seen.get(value);
  if (existing) return existing as T;
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = scrubSecrets(item, seen);
  }
  return out as T;
}

/** Exposed for tests/security/secret-egress.spec.ts. Not part of the route API. */
export const scrubForTest = <T>(value: T): T => scrubSecrets(value);

function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  try {
    return schema.parse(value);
  } catch (e) {
    if (e instanceof ZodError) {
      throw Invalid(e.issues.map((i) => ({ field: i.path.join('.'), code: i.code, message: i.message })));
    }
    throw e;
  }
}

/** The label for an error series: stable, low-cardinality, never a message. */
function errorCode(err: unknown): string {
  if (err instanceof ZodError) return 'validation-failed';
  if (err instanceof TenantGuardError) return 'tenant-guard';
  if (err instanceof AppError) return err.code;
  return 'internal-error';
}

function toResponse(err: unknown, requestId: string, meta: Record<string, unknown>) {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'content-type': 'application/problem+json' };

  // Validation may also happen inside a handler when the payload is adapted for
  // an existing module. Keep those failures client-safe instead of reporting a 500.
  if (err instanceof ZodError) {
    const invalid = Invalid(
      err.issues.map((issue) => ({
        field: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
    logger.warn({ requestId, code: invalid.code, status: invalid.status, ...meta }, 'request rejected');
    return NextResponse.json(invalid.toProblem(requestId), { status: invalid.status, headers });
  }

  if (err instanceof AppError) {
    // Set by the rate limiter on the error it throws; not part of AppError.
    const retryAfter = (err as { retryAfter?: number }).retryAfter;
    if (retryAfter) headers['retry-after'] = String(retryAfter);
    // RFC 9110: a 405 must say which methods are allowed.
    if (err instanceof MethodNotAllowedError) headers['allow'] = err.allow.join(', ');
    if (err.status >= 500) logger.error({ err, requestId, ...meta }, 'request failed');
    else logger.warn({ requestId, code: err.code, status: err.status, ...meta }, 'request rejected');
    return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
  }

  // A tenant guard trip is a bug in a repository, not a client error. Log loudly.
  if (err instanceof TenantGuardError) {
    logger.error({ err, requestId, ...meta }, 'TENANT GUARD TRIPPED');
  } else {
    logger.error({ err, requestId, ...meta }, 'unhandled error');
  }

  const problem = new AppError(500, 'internal-error', 'Something went wrong on our side.', [], false);
  return NextResponse.json(problem.toProblem(requestId), { status: 500, headers });
}
