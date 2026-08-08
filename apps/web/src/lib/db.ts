import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
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
  'Tenant',
  'Permission',
  'SubscriptionPlan',
  'WebhookEvent',
  // Identity/control-plane records cross workspace boundaries by design. Access
  // to them must go through resolvePlatformCtx/requirePlatformOwner.
  'PlatformUser',
  'WorkspaceMembership',
  'PlatformSession',
  'PlatformAuditEvent',
  'AuthenticationFactor',
  'PlanModule',
  'PlanLimit',
  'SubscriptionModule',
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
  // The reset link is the only thing the caller holds; the tenant is resolved
  // *from* it. Without this the guard threw on every reset attempt and the
  // endpoint answered 500 unconditionally — the migration's RLS bootstrap list
  // already exempts this table for the same reason.
  PasswordResetToken: ['tokenHash'],
  // Redeemed by someone not signed in, before any tenant is known. See
  // prisma/migrations/20260807020000_invitation_bootstrap_lookup.
  WorkspaceInvitation: ['tokenHash'],
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
  'User',
  'Region',
  'Branch',
  'Territory',
  'Department',
  'Team',
  'Lead',
  'LeadStage',
  'LeadCustomFieldDefinition',
  'Account',
  'Contact',
  'Opportunity',
  'Product',
  'Activity',
  'Task',
  'Campaign',
  'MarketingList',
  'EmailCampaign',
  'MessageTemplate',
  'Form',
  'LandingPage',
  'FieldVisit',
  'Ticket',
  'Document',
  'SmartView',
  'Dashboard',
  'Report',
  'Automation',
  'DistributionRule',
  'Call',
  'FollowUpTask',
  'Event',
  'PlatformUser',
  'EmployeeProfile',
  'Designation',
]);

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
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
 * The parts of a Prisma operation's arguments this guard reads.
 *
 * Deliberately narrow rather than `any`: the extension only ever looks at
 * `where` and `data`, and typing it this way means a typo in either is a
 * compile error instead of a silently skipped tenant check.
 */
interface GuardedArgs {
  where?: Record<string, unknown> & { tenantId?: unknown };
  data?: unknown;
  /**
   * Caller opt-in to see soft-deleted rows. Stripped before the query reaches
   * Prisma, which would reject it as an unknown argument.
   */
  __includeDeleted?: boolean;
}

/** A row on its way into the database, as the create-path guard sees it. */
type IncomingRow = { tenantId?: unknown; tenant?: unknown } | null | undefined;

/**
 * The next link in the extension chain.
 *
 * Returns Prisma's own promise rather than a plain one: the batched
 * `$transaction` below only accepts `PrismaPromise`, so `Promise<unknown>` here
 * would not type-check at the call site.
 */
type NextQuery = (args: GuardedArgs) => Prisma.PrismaPromise<unknown>;

/**
 * The tenant this operation is pinned to, when it is a single literal id.
 *
 * Returns null for the cases RLS cannot be given a value for: lookups by a
 * global bearer secret (tenant is unknown — that is what the lookup is for) and
 * multi-tenant filters such as `{ tenantId: { in: [...] } }`. Those tables are
 * excluded from RLS in the migration; the guard above still covers them.
 */
function literalTenantId(model: string, operation: string, args: GuardedArgs | undefined): string | null {
  // On Tenant itself the tenant id is the primary key, not a `tenantId` column.
  //
  // requireWorkspace loads the workspace by id and pulls moduleEntitlements,
  // subscription and _count through it. Those tables *are* RLS-protected, so
  // without this the includes evaluated with no tenant setting and came back
  // empty — which the UI reads as "no modules entitled" and hides the People
  // module entirely, while the dashboard shows a blank plan and no subscription.
  if (model === 'Tenant' && typeof args?.where?.id === 'string') return args.where.id;

  if (CREATE_OPS.has(operation)) {
    const rows: IncomingRow[] =
      operation === 'create' ? [args?.data as IncomingRow] : ((args?.data ?? []) as IncomingRow[]);
    const ids = rows.map((row) => row?.tenantId).filter((id): id is string => typeof id === 'string');
    // createMany spanning tenants cannot be pinned to one GUC value.
    return ids.length === rows.length && new Set(ids).size === 1 ? ids[0] : null;
  }
  const where = args?.where ?? {};
  if (typeof where.tenantId === 'string') return where.tenantId;

  // Compound unique keys carry the tenant one level down:
  //   { where: { tenantId_module: { tenantId, module } } }
  // The guard above already accepts these as scoped; missing them here meant the
  // query ran with no tenant setting and RLS returned nothing — which surfaced
  // as "module not entitled" 403s on every request once RLS was enforced.
  for (const key of Object.keys(where)) {
    if (!key.startsWith('tenantId_')) continue;
    const compound = where[key];
    if (compound && typeof compound === 'object') {
      const nested = (compound as { tenantId?: unknown }).tenantId;
      if (typeof nested === 'string') return nested;
    }
  }
  return null;
}

/**
 * Layer 3: hand Postgres the tenant it should enforce.
 *
 * A batched `$transaction` is the one form that guarantees both statements land
 * on the same pooled connection, so `set_config` is still in scope for the
 * query. Skipped inside withTx/withPlatformTx, which already set it — those own
 * a connection and a second transaction on top would deadlock against it.
 */
async function runPinned(base: PrismaClient, model: string, operation: string, args: GuardedArgs, query: NextQuery) {
  const tenantId = literalTenantId(model, operation, args);
  if (tenantId && !inTenantTx.getStore()) {
    const [, result] = await base.$transaction([
      base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      query(args),
    ]);
    return result;
  }
  return query(args);
}

function tenantGuard(base: PrismaClient) {
  return {
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          args: GuardedArgs;
          query: NextQuery;
        }) {
          if (!model) return query(args);
          if (operation === '$queryRaw' || operation === '$executeRaw') return query(args);

          // A global model still needs the tenant setting when it *names* one.
          //
          // WorkspaceMembership is global, but resolveCtx filters it on a related
          // `salesUser` — and User is RLS-forced. Returning early here meant the
          // join was evaluated with no tenant context, matched nothing, and every
          // request 401'd. Only the *guard* is skipped for global models; handing
          // Postgres the tenant is not optional.
          if (GLOBAL_MODELS.has(model)) return runPinned(base, model, operation, args, query);

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
            if (
              READ_OPS.has(operation) &&
              SOFT_DELETE_MODELS.has(model) &&
              where.deletedAt === undefined &&
              args?.__includeDeleted !== true
            ) {
              args.where = { ...where, deletedAt: null };
            }
          }

          if (CREATE_OPS.has(operation)) {
            const rows = operation === 'create' ? [args?.data] : (args?.data ?? []);
            for (const row of rows as IncomingRow[]) {
              if (row && row.tenantId === undefined && row.tenant === undefined) {
                throw new TenantGuardError(`${model}.${operation} was issued without a tenantId value.`);
              }
            }
          }

          if (args) delete args.__includeDeleted;

          return runPinned(base, model, operation, args, query);
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
          "npm 12 blocks package install scripts by default, so Prisma's postinstall " +
          'never ran. See SETUP.md.\n\nOriginal error: ' +
          message,
        { cause: err },
      );
    }
    throw err;
  }
}

export const prisma = globalForPrisma.__prisma ?? build(env.DATABASE_URL);
if (env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

/** Read replica for reports and exports; falls back to primary when unset. */
export const prismaRead = env.DATABASE_REPLICA_URL ? build(env.DATABASE_REPLICA_URL) : prisma;

export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Interactive transaction, pinned to one tenant. Use this instead of calling
 * prisma.$transaction(fn) directly.
 *
 * Two things happen here, and they are inseparable:
 *
 *  1. `inTenantTx` tells the per-query wrapper above to stand down. An
 *     interactive transaction owns one connection and every query inside must
 *     stay on it; the wrapper would otherwise open a second transaction on a
 *     *different* pooled connection part-way through, where rows written by the
 *     outer one are not yet visible — surfacing as foreign-key violations
 *     against records the caller just created.
 *
 *  2. Because of (1), this function must set `app.tenant_id` itself. It
 *     previously did not, and nothing noticed: the runtime connected as the
 *     table owner, which bypasses RLS entirely. The moment the application
 *     connected as a NOBYPASSRLS role, every INSERT and UPDATE inside a
 *     transaction would have failed its WITH CHECK against an empty setting.
 *     That is why `tenantId` is a required parameter and not an option.
 *
 * `set_config(..., true)` is transaction-local, so the value cannot leak to the
 * next borrower of this pooled connection.
 */
export function withTx<T>(tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  if (!tenantId) throw new TenantGuardError('withTx requires a tenantId. Use withPlatformTx for cross-tenant work.');
  return inTenantTx.run(
    true,
    () =>
      prisma.$transaction(async (tx: TxClient) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        return fn(tx);
      }) as Promise<T>,
  );
}

/**
 * Interactive transaction for the control plane: provisioning a workspace,
 * editing a subscription, managing plans.
 *
 * These legitimately span tenants — or write rows for a tenant that does not
 * exist until part-way through — so no single `app.tenant_id` can describe
 * them. Rather than leaving the setting empty (which reads as "unset" and would
 * silently mean something different if a policy ever changed), this asserts a
 * distinct `app.platform_admin` flag that the RLS policies name explicitly.
 *
 * Every caller must already be behind `requirePlatformOwner`.
 */
export function withPlatformTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return inTenantTx.run(
    true,
    () =>
      prisma.$transaction(async (tx: TxClient) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'on', true)`);
        return fn(tx);
      }) as Promise<T>,
  );
}
