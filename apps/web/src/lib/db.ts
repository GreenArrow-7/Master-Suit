import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from './env';

const globalForPrisma = globalThis as unknown as {
  __prisma?: ReturnType<typeof build>;
  __inTenantTx?: AsyncLocalStorage<true>;
};

/**
 * Set while an interactive transaction is open. That transaction owns a single
 * connection, so the per-query wrapper below must not start another one on top.
 *
 * Cached on globalThis for the same reason the client is: dev HMR re-evaluates
 * this module but reuses the cached client, whose extension closure would
 * otherwise keep checking a stale, permanently-empty AsyncLocalStorage.
 */
const inTenantTx = globalForPrisma.__inTenantTx ?? new AsyncLocalStorage<true>();
globalForPrisma.__inTenantTx = inTenantTx;

/**
 * Tables that are not tenant-scoped. Everything else MUST be filtered by tenantId.
 * Adding a model here is a security decision and needs review.
 */
const GLOBAL_MODELS = new Set([
  'Tenant', 'Permission', 'SubscriptionPlan', 'WebhookEvent',
  // Identity/control-plane records cross workspace boundaries by design. Access
  // to them must go through resolvePlatformCtx/requirePlatformOwner.
  'PlatformUser', 'WorkspaceMembership', 'PlatformSession', 'PlatformAuditEvent',
  'AuthenticationFactor', 'PlanModule', 'PlanLimit', 'SubscriptionModule',
]);

/**
 * Fields that are cryptographically unique bearer secrets (256-bit random,
 * globally unique) rather than tenant-scoped identifiers. A lookup by one of
 * these already pins exactly one row across all tenants, so it's the
 * bootstrap case where tenantId isn't known yet (that's what the lookup is
 * for) — not a missing safety check.
 */
const GLOBAL_UNIQUE_FIELDS: Record<string, string[]> = {
  Session: ['tokenHash'],
  PlatformSession: ['tokenHash', 'id'],
  APIKey: ['prefix', 'keyHash'],
  IntegrationConnection: ['webhookKey'],
  RecordingConsent: ['callId'],
  Recording: ['callId'],
  Transcript: ['callId'],
  AIAnalysis: ['callId'],
  CallAudit: ['id'],
};

/** Models carrying deletedAt — reads exclude soft-deleted rows unless asked. */
const SOFT_DELETE_MODELS = new Set([
  'User', 'Region', 'Branch', 'Territory', 'Department', 'Team', 'Lead', 'LeadStage',
  'LeadCustomFieldDefinition', 'Account', 'Contact', 'Opportunity', 'Product',
  'Activity', 'Task', 'Campaign', 'MarketingList', 'EmailCampaign', 'MessageTemplate',
  'Form', 'LandingPage', 'FieldVisit', 'Ticket', 'Document', 'SmartView', 'Dashboard',
  'Report', 'Automation', 'DistributionRule', 'Call', 'FollowUpTask', 'Event',
  'PlatformUser', 'EmployeeProfile',
  'Designation',
]);

const READ_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
const FILTERED_WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

export class TenantGuardError extends Error {}

/**
 * Defence in depth, layer 2 of 3.
 *
 *   1. Repositories pass tenantId explicitly from Ctx.
 *   2. This extension throws if a tenant-scoped query is missing it.  ← here
 *   3. Postgres RLS rejects it even if 1 and 2 are bypassed.
 *
 * It does not *inject* tenantId. Injecting silently would hide the bug that a
 * repository forgot it; throwing surfaces it in development and in the
 * tenant-isolation suite.
 */
/**
 * The tenant this operation is pinned to, when it is a single literal id.
 *
 * Returns null for the cases RLS cannot be given a value for: lookups by a
 * global bearer secret (tenant is unknown — that is what the lookup is for) and
 * multi-tenant filters such as `{ tenantId: { in: [...] } }`. Those tables are
 * excluded from RLS in the migration; the guard above still covers them.
 */
function literalTenantId(operation: string, args: any): string | null {
  if (CREATE_OPS.has(operation)) {
    const rows = operation === 'create' ? [args?.data] : (args?.data ?? []);
    const ids = (rows as any[]).map((row) => row?.tenantId).filter((id) => typeof id === 'string');
    // createMany spanning tenants cannot be pinned to one GUC value.
    return ids.length === rows.length && new Set(ids).size === 1 ? ids[0] : null;
  }
  const tenantId = args?.where?.tenantId;
  return typeof tenantId === 'string' ? tenantId : null;
}

function tenantGuard(base: PrismaClient) {
  return {
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || GLOBAL_MODELS.has(model)) return query(args);
          if (operation === '$queryRaw' || operation === '$executeRaw') return query(args);

          if (READ_OPS.has(operation) || FILTERED_WRITE_OPS.has(operation)) {
            const where = args?.where ?? {};
            const scoped =
              where.tenantId !== undefined ||
              Object.keys(where).some((k) => k.startsWith('tenantId_')) ||
              (GLOBAL_UNIQUE_FIELDS[model] ?? []).some((f) => where[f] !== undefined);

            if (!scoped) {
              throw new TenantGuardError(
                `${model}.${operation} was issued without a tenantId filter. ` +
                `Pass ctx.tenantId — see docs/05-SECURITY.md §3.`,
              );
            }
            if (READ_OPS.has(operation) && SOFT_DELETE_MODELS.has(model) && where.deletedAt === undefined && args?.__includeDeleted !== true) {
              args.where = { ...where, deletedAt: null };
            }
          }

          if (CREATE_OPS.has(operation)) {
            const rows = operation === 'create' ? [args?.data] : (args?.data ?? []);
            for (const row of rows as any[]) {
              if (row && row.tenantId === undefined && row.tenant === undefined) {
                throw new TenantGuardError(`${model}.${operation} was issued without a tenantId value.`);
              }
            }
          }

          if (args) delete args.__includeDeleted;

          // Layer 3: hand Postgres the tenant it should enforce. A batched
          // $transaction is the one form that guarantees both statements land on
          // the same pooled connection, so set_config is still in scope for the
          // query. Skipped inside withTenantTx, which already set it.
          const tenantId = literalTenantId(operation, args);
          if (tenantId && !inTenantTx.getStore()) {
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
              query(args),
            ]);
            return result;
          }
          return query(args);
        },
      },
    },
  } as const;
}

function build(url: string) {
  try {
    const adapter = new PrismaPg({ connectionString: url });
    const base = new PrismaClient({
      adapter,
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    return base.$extends(tenantGuard(base));
  } catch (err) {
    // The overwhelmingly common cause is an ungenerated client (npm 12 blocks
    // install scripts), which otherwise surfaces as an opaque MODULE_NOT_FOUND
    // buried in a webpack stack.
    const message = err instanceof Error ? err.message : String(err);
    if (/\.prisma[\\/]client|did not initialize|@prisma\/client did not/i.test(message)) {
      throw new Error(
        'The Prisma client has not been generated.\n\n' +
        '  npm approve-scripts --allow-scripts-pending\n' +
        '  npx prisma generate\n\n' +
        'npm 12 blocks package install scripts by default, so Prisma\'s postinstall ' +
        'never ran. See SETUP.md.\n\nOriginal error: ' + message,
      );
    }
    throw err;
  }
}

export const prisma = globalForPrisma.__prisma ?? build(env.DATABASE_URL);
if (env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

/** Read replica for reports and exports; falls back to primary when unset. */
export const prismaRead = env.DATABASE_REPLICA_URL ? build(env.DATABASE_REPLICA_URL) : prisma;

/**
 * Interactive transaction. Use this instead of calling prisma.$transaction(fn)
 * directly.
 *
 * An interactive transaction owns one connection and every query inside it must
 * stay there. The per-query wrapper in tenantGuard would otherwise open a second
 * transaction on a *different* connection part-way through, where rows written by
 * the outer one are not yet visible — which surfaces as foreign-key violations
 * against records the caller just created. This flag tells the wrapper to stand
 * down for the duration.
 */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export function withTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTenantTx.run(true, () => prisma.$transaction(fn as any) as Promise<T>);
}

/**
 * Runs a transaction with app.tenant_id set, which is what the RLS policies read.
 * Any query inside is protected by Postgres even if the guard above is bypassed.
 */
export async function withTenantTx<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return inTenantTx.run(true, () =>
    prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      return fn(tx);
    }),
  );
}
