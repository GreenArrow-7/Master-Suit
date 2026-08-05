import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { AppError, Invalid, Unauthorized } from '../errors';
import { logger } from '../logger';
import { TenantGuardError } from '../db';
import { resolveCtx, clientIp } from '../auth/session';
import { authenticateApiKey } from '../auth/apiKey';
import { assertPermission, type Action, type Ctx } from '../security/rbac';
import { consume, limits } from '../security/ratelimit';
import { audit, type AuditEventName } from '../security/audit';
import { assertModuleEntitlement, type ProductModule } from '../security/entitlements';

export interface RouteSpec<PS extends ZodTypeAny, QS extends ZodTypeAny, BS extends ZodTypeAny> {
  module: string;
  action: Action;
  productModule?: ProductModule;
  /** Skip authentication entirely. Only for /public and /webhooks/inbound routes. */
  anonymous?: boolean;
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
>(
  spec: RouteSpec<PS, QS, BS>,
  handler: (args: HandlerArgs<P, Q, B>) => Promise<unknown>,
) {
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
        await assertModuleEntitlement(ctx.tenantId, spec.productModule ?? 'SALES');
        assertPermission(ctx, spec.module, spec.action);
      }
      else if (!spec.anonymous) throw Unauthorized();

      // 4. Validate ────────────────────────────────────────────────────────────
      const rawParams = context?.params
        ? await context.params.catch(() => ({}))
        : {};
      const url = new URL(req.url);
      const rawQuery = Object.fromEntries(url.searchParams);
      const rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method)
        ? await req.json().catch(() => ({}))
        : {};

      const params = spec.params ? parse(spec.params, rawParams) : (rawParams as P);
      const query = spec.query ? parse(spec.query, rawQuery) : (rawQuery as unknown as Q);
      const body = spec.body ? parse(spec.body, rawBody) : (rawBody as B);

      // 5. Handle ──────────────────────────────────────────────────────────────
      const result = await handler({ ctx: ctx!, params, query, body, req });

      // 6. Audit ───────────────────────────────────────────────────────────────
      if (ctx && spec.auditEvent) {
        await audit(ctx, {
          event: spec.auditEvent,
          objectType: spec.module,
          recordId: (result as any)?.id,
          metadata: { method: req.method, path: url.pathname },
        });
      }

      logger.info({ requestId, module: spec.module, action: spec.action, ms: Date.now() - started, tenantId: ctx?.tenantId }, 'request');
      return NextResponse.json(result ?? { ok: true }, { headers: { 'x-request-id': requestId } });
    } catch (err) {
      return toResponse(err, requestId, { module: spec.module, action: spec.action, tenantId: ctx?.tenantId });
    }
  };
}

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

function toResponse(err: unknown, requestId: string, meta: Record<string, unknown>) {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'content-type': 'application/problem+json' };

  // Validation may also happen inside a handler when the payload is adapted for
  // an existing module. Keep those failures client-safe instead of reporting a 500.
  if (err instanceof ZodError) {
    const invalid = Invalid(err.issues.map((issue) => ({
      field: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })));
    logger.warn({ requestId, code: invalid.code, status: invalid.status, ...meta }, 'request rejected');
    return NextResponse.json(invalid.toProblem(requestId), { status: invalid.status, headers });
  }

  if (err instanceof AppError) {
    if ((err as any).retryAfter) headers['retry-after'] = String((err as any).retryAfter);
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
