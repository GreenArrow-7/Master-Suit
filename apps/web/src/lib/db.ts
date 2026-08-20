import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env';
import { invalidateActors } from './auth/actorCache';
import { logger } from './logger';
import { recordTenantGuardTrip } from './metrics';

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
  // Previous credentials, keyed by PlatformUser. A password belongs to the
  // identity, not to any one of its workspace memberships — duplicating it per
  // tenant is how two copies of one password drift apart. Reached only through
  // services/identity/passwordHistory.ts, which is always already scoped to a
  // single platformUserId.
  'PasswordHistory',
  'PlanModule',
  'PlanLimit',
  'SubscriptionModule',
  // Operator key-value settings; carries no tenantId at all.
  'PlatformSetting',
  // Control-plane, and resolved *before* any tenant context exists: it is the
  // lookup that decides whether platform staff may write into a workspace.
  'PlatformAccessGrant',
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
  // The console edits a subscription by its primary key; the cuid pins exactly
  // one row, and the platform routes run under app.platform_admin for RLS.
  TenantSubscription: ['id'],
  // A telephony vendor posts to a URL and knows nothing about workspaces, so the
  // key in that URL is the only thing that can identify the tenant. This is the
  // last genuine bootstrap lookup among the engagement tables.
  IntegrationConnection: ['webhookKey'],
  // RecordingConsent, Recording, Transcript, AIAnalysis and CallAudit were here.
  //
  // They were not bootstrap lookups. `callId` is a cuid, not a bearer secret,
  // and every caller already knew the tenant — the exemption existed only
  // because `findUnique({ where: { callId } })` was the convenient way to write
  // the query. It bought a guard hole on five tables holding transcripts and
  // recordings of client conversations, and it forced those five tables out of
  // row-level security entirely, because a query with no tenant filter sets no
  // `app.tenant_id` and a policy would have returned nothing.
  //
  // Every call site now passes tenantId alongside callId, so both layers apply.
  // See 20260808200000_rls_call_intelligence.
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
  'Project',
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

// ─────────────────────────────────────────────────────────────────────────────
// Keeping the permission cache honest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models whose rows feed `buildActor`, and therefore what a user may do.
 *
 * Hooked here rather than at the write sites on purpose. There are dozens of
 * places that touch a role, an assignment or a user's status — the role editor,
 * the invitation flow, deactivation, the org-chart move, seeds, the platform
 * console — and the failure mode of forgetting one is *a revoked permission that
 * still works*. A list of call sites has to be maintained; a list of models is
 * checked by the type of every query that passes through this client.
 */
const ACTOR_MODELS = new Set([
  'Role', // isActive and rank
  'RolePermission', // granted and scope
  'MembershipRole', // in-window assignments
  'WorkspaceMembership', // which sales user a platform user is
  'User', // see ACTOR_USER_FIELDS below
  'UserTeam', // teamIds
]);

/**
 * The one model with no tenant: the permission catalogue. Renaming a permission
 * changes the `module:ACTION` keys every cached map is keyed by, so it has to
 * invalidate every tenant at once.
 */
const GLOBAL_ACTOR_MODEL = 'Permission';

/**
 * `User` is written constantly — `lastLoginAt` alone would invalidate a whole
 * tenant's cache on every sign-in — so it is the one model filtered by field.
 * These are the columns `buildActor` actually reads.
 *
 * `managerId` is here because it decides `managedUserIds`, which means moving
 * one person under a new manager invalidates the tenant, and the *manager's*
 * cached actor is rebuilt with the new report. That is the case a per-user
 * invalidation would have got wrong.
 */
const ACTOR_USER_FIELDS = new Set(['status', 'deletedAt', 'roleId', 'branchId', 'regionId', 'managerId']);

function touchesActor(model: string, operation: string, args: GuardedArgs): boolean {
  if (!CREATE_OPS.has(operation) && !FILTERED_WRITE_OPS.has(operation)) return false;
  if (model !== 'User') return true;

  // `create`/`createMany` put rows in `data`; `upsert` splits them across
  // `create` and `update`. A field in any of them is a field being written.
  const rows: unknown[] = [args?.data, args?.create, args?.update];
  if (Array.isArray(args?.data)) rows.push(...args.data);
  return rows.some(
    (row) => row && typeof row === 'object' && Object.keys(row).some((field) => ACTOR_USER_FIELDS.has(field)),
  );
}

/**
 * The tenant a write belongs to, for invalidation only.
 *
 * The guard above has already established that a scoped write carries one, so
 * this is a read of a value that is known to be there. `undefined` means it
 * could not be determined — a write reached through a global-unique field, say —
 * and the caller invalidates every tenant rather than none. Over-invalidating
 * costs a rebuild; under-invalidating leaves a revoked permission working.
 */
function tenantOfWrite(args: GuardedArgs): string | undefined {
  const candidates = [args?.where?.tenantId, (args?.data as IncomingRow | undefined)?.tenantId];
  for (const value of candidates) if (typeof value === 'string' && value) return value;
  const first = Array.isArray(args?.data) ? (args.data[0] as IncomingRow | undefined)?.tenantId : undefined;
  return typeof first === 'string' && first ? first : undefined;
}

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
  /** `upsert` carries its rows here rather than in `data`. */
  create?: unknown;
  update?: unknown;
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
              // Counted at the throw, not at the catch: a caller that swallows
              // this would otherwise hide the one signal that says a repository
              // is relying on row-level security alone.
              recordTenantGuardTrip(model, operation);
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
                recordTenantGuardTrip(model, operation);
                throw new TenantGuardError(`${model}.${operation} was issued without a tenantId value.`);
              }
            }
          }

          if (args) delete args.__includeDeleted;

          const invalidates = model === GLOBAL_ACTOR_MODEL || ACTOR_MODELS.has(model);
          const result = await runPinned(base, model, operation, args, query);

          // After the write, never before: invalidating first would leave a
          // window in which a rebuild caches the pre-write answer under the new
          // version. Awaited rather than fired and forgotten, so a request that
          // revokes a permission cannot return before the revocation is visible
          // to the next one.
          if (invalidates && touchesActor(model, operation, args)) {
            await invalidateActors(model === GLOBAL_ACTOR_MODEL ? undefined : tenantOfWrite(args));
          }
          return result;
        },
      },
    },
  } as const;
}

function build(url: string) {
  try {
    /**
     * Bounded, because node-postgres defaults `connectionTimeoutMillis` to 0 —
     * "wait forever". With Postgres unreachable, every request that touched the
     * database hung open instead of failing: no error, no page, just a spinner
     * until the browser gave up. A person watching that reasonably calls it a
     * crash, and it hides the one fact that would have explained it.
     *
     * Five seconds is far longer than a healthy connection ever needs, and
     * short enough that an outage surfaces as an error somebody can read.
     */
    const adapter = new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5_000 });
    const base = new PrismaClient({
      adapter,
      log:
        env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : [{ emit: 'event', level: 'query' }, 'error'],
    });

    // Only queries at or over the threshold are logged — quiet in production by
    // design. Params are deliberately omitted: they can carry PII.
    base.$on('query', (e) => {
      if (e.duration >= env.SLOW_QUERY_MS) {
        logger.warn({ ms: e.duration, query: e.query }, 'slow query');
      }
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

/**
 * Read replica for reports and exports; falls back to the primary when unset.
 *
 * ── It was built and never used ─────────────────────────────────────────────
 *
 * `DATABASE_REPLICA_URL` has been in `lib/env.ts` and this line has constructed
 * a second client from it since the beginning, and nothing in `src/` ever
 * imported the result. An operator setting that variable got a second connection
 * pool that answered no queries — configuration that looks load-bearing and
 * does nothing, which is worse than absent, because it reads as a capability
 * the deployment has.
 *
 * ── What may and may not use it ─────────────────────────────────────────────
 *
 * A replica is behind the primary — usually by milliseconds, occasionally by a
 * lot when the primary is under the write load that made you want a replica.
 * So the rule is not "reads go here", it is **"reads whose answer may be a
 * moment stale go here"**:
 *
 *   yes   reports, CSV exports, analytics roll-ups — a leaderboard computed
 *         200ms ago is the same leaderboard
 *   no    session and permission lookups (a revoked session must be revoked
 *         now), duplicate checks before an insert, anything read back after a
 *         write in the same request, anything a uniqueness decision rests on
 *
 * ── Why it refuses writes even with no replica configured ───────────────────
 *
 * The `$extends` below throws on every write operation, and it is applied in
 * *both* branches — including the fallback where this is the primary client.
 *
 * That is deliberate. Without it, a write added to a report module would work
 * perfectly in development and on any deployment with no replica, and fail only
 * where a replica exists — which is production, at the moment someone is already
 * dealing with load. A guard that only bites in the configuration you cannot
 * test is not a guard. This one fails the same way everywhere, on the first run.
 */
const READ_ONLY_OPS_REFUSED = new Set([...CREATE_OPS, ...FILTERED_WRITE_OPS, '$executeRaw', '$executeRawUnsafe']);

function readOnly<T extends { $extends: (ext: never) => unknown }>(client: T) {
  return client.$extends({
    name: 'read-only',
    query: {
      $allOperations({
        model,
        operation,
        args,
        query,
      }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) {
        if (READ_ONLY_OPS_REFUSED.has(operation)) {
          throw new ReadReplicaWriteError(
            `${model ? `${model}.` : ''}${operation} was issued through prismaRead. ` +
              'That client is for reports and exports; a replica cannot accept writes. Use `prisma`.',
          );
        }
        return query(args);
      },
    },
  } as never) as T;
}

/** A write reached the read client. Distinct from TenantGuardError: different bug, different fix. */
export class ReadReplicaWriteError extends Error {}

export const prismaRead = readOnly(env.DATABASE_REPLICA_URL ? build(env.DATABASE_REPLICA_URL) : prisma);

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
export function withPlatformTx<T>(fn: (tx: TxClient) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
  return inTenantTx.run(
    true,
    () =>
      prisma.$transaction(
        async (tx: TxClient) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'on', true)`);
          return fn(tx);
        },
        /**
         * Prisma's default interactive-transaction timeout is 5 seconds, which
         * is right for a request and wrong for a maintenance sweep: the
         * retention job deletes in batches across every tenant, and a batch that
         * runs long aborts with P2028 rather than finishing.
         *
         * Passed through rather than raised globally, so a control-plane write
         * on the request path still fails fast instead of holding a connection.
         */
        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
      ) as Promise<T>,
  );
}
