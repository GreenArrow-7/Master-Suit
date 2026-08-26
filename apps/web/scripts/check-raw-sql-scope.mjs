/**
 * Raw SQL against a row-level-security table must run inside a tenant transaction.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * The Prisma tenant guard is an extension over the *model* API. It sees
 * `prisma.lead.findMany` and refuses it without a tenantId. It does not see
 * `prisma.$queryRaw` at all — lib/db.ts returns early on `$queryRaw` and
 * `$executeRaw`, because there is no `where` to inspect.
 *
 * So raw SQL is protected by exactly one layer: the RLS policy, which filters on
 * `app.tenant_id`. And `app.tenant_id` is set by `set_config(..., true)` — the
 * `true` meaning transaction-local. Outside a transaction, the setting is scoped
 * to whichever pooled connection happened to serve that one statement, and the
 * next statement may land on another connection with no setting at all.
 *
 * The consequence is not an error. A policy with no `app.tenant_id` matches
 * nothing, so a SELECT returns zero rows and a DELETE deletes nothing, quietly,
 * and the caller reports success. The retention sweep is the shape that gets
 * this wrong: it is a `DELETE FROM "Recording"` with no model API to go through,
 * so it is written raw, and a sweep that silently deletes nothing looks exactly
 * like a sweep with nothing to do.
 *
 * The inverse is worse and equally quiet: a raw statement issued on a connection
 * that still carries a *previous* request's `app.tenant_id` reads that other
 * workspace's rows.
 *
 * `withTx(tenantId, fn)` and `withPlatformTx(fn)` exist to make this impossible
 * — they open a transaction, set the tenant inside it, and hand the callback a
 * client bound to that connection. This gate asserts every raw statement naming
 * an RLS-forced table is issued on such a client rather than on the module-level
 * `prisma`.
 *
 * ── What it checks, and what it therefore cannot ────────────────────────────
 *
 * It is a lexical check over source text: the receiver of the call, and the
 * table names in the statement. It cannot follow a transaction client through a
 * variable, and it cannot tell that a helper taking `tx` was handed `prisma` by
 * one of its callers — so a raw statement moved into a helper whose parameter is
 * typed as a transaction client is trusted. That is the honest limit. What it
 * does catch is the direct form, which is the form every occurrence of this bug
 * has actually taken.
 *
 * The RLS-forced set comes from the catalog, not from a list here, for the same
 * reason check-rls.mjs does: a table added last week must be covered the moment
 * it exists.
 *
 *   node scripts/check-raw-sql-scope.mjs
 *
 * Exit 0 clean · 1 a raw statement is outside a transaction · 2 misconfigured.
 */
import { Client } from 'pg';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');

/**
 * Clients that are *not* bound to a transaction, named rather than inferred.
 *
 * `prismaRead` is here too. It is the read replica, and a replica connection is
 * pooled exactly like the primary — reading another workspace's rows from the
 * replica is the same breach with better latency.
 */
const LOOSE_CLIENTS = new Set(['prisma', 'prismaRead']);

const RAW_METHODS = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'];

/** Comment lines, so a docstring naming `$queryRaw` is not read as a call. */
function stripComments(source) {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
      return line;
    })
    .join('\n');
}

/**
 * The statement text belonging to a raw call, read by balancing delimiters
 * rather than by taking a fixed window — a window long enough for the retention
 * sweep's SQL is long enough to swallow the next call's.
 */
function statementAt(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;

  if (source[i] === '`') {
    i += 1;
    const start = i;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') i += 1;
      else if (ch === '$' && source[i + 1] === '{') {
        depth += 1;
        i += 1;
      } else if (ch === '}' && depth > 0) depth -= 1;
      else if (ch === '`' && depth === 0) return source.slice(start, i);
      i += 1;
    }
    return source.slice(start);
  }

  if (source[i] === '(') {
    const start = i;
    let depth = 0;
    while (i < source.length) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
      i += 1;
    }
    return source.slice(start);
  }

  return '';
}

/** Table names a statement reads or writes. Quoted only — every table here is. */
function tablesIn(statement) {
  const names = new Set();
  for (const match of statement.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"(\w+)"/gi)) names.add(match[1]);
  return names;
}

/**
 * Identifiers in this file that name a transaction client.
 *
 * Two ways one is bound: as the parameter of a callback handed to `withTx`,
 * `withPlatformTx` or `$transaction`, or as a parameter annotated with a type
 * built from `Prisma.TransactionClient` — services/shared/reference.ts takes
 * `tx: RawCapable`, where `RawCapable` is a `Pick` of it, and is called from
 * inside a transaction by every one of its callers.
 */
function transactionalNames(source) {
  const names = new Set();

  for (const match of source.matchAll(
    /\b(?:withTx|withPlatformTx|\$transaction)\s*\(\s*(?:[^)]*?,\s*)?(?:async\s*)?\(?\s*(\w+)\s*[),:]/g,
  )) {
    names.add(match[1]);
  }
  // `withTx(tenantId, async (tx) => …)` — the tenant argument is consumed by the
  // optional group above; this is the same shape written across lines.
  for (const match of source.matchAll(
    /\b(?:withTx|withPlatformTx|\$transaction)\s*\([\s\S]{0,200}?(?:async\s*)?\(\s*(\w+)\s*[):]/g,
  )) {
    names.add(match[1]);
  }

  const aliases = new Set(['Prisma.TransactionClient', 'TransactionClient']);
  for (const match of source.matchAll(/\btype\s+(\w+)\s*=[^;]*TransactionClient/g)) aliases.add(match[1]);
  const aliasPattern = [...aliases].map((a) => a.replace(/[.$]/g, '\\$&')).join('|');
  for (const match of source.matchAll(new RegExp(`\\(\\s*(\\w+)\\s*:\\s*(?:${aliasPattern})\\b`, 'g'))) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(new RegExp(`\\b(\\w+)\\s*:\\s*(?:${aliasPattern})\\b`, 'g'))) {
    names.add(match[1]);
  }

  return names;
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const url = process.env.RLS_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('[check-raw-sql-scope] Set DATABASE_URL (or RLS_DATABASE_URL) to the database to check.');
  process.exit(2);
}

const client = new Client({ connectionString: url });
await client.connect();
const { rows } = await client.query(`
  SELECT c.relname AS table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
`);
await client.end();

const forced = new Set(rows.map((row) => row.table));
if (forced.size === 0) {
  console.error(
    '[check-raw-sql-scope] No table has FORCE ROW LEVEL SECURITY. Either migrations have not been\n' +
      '  applied to this database, or RLS has been dropped wholesale — check-rls.mjs will say which.\n' +
      '  Passing on an empty set would make this gate report clean on a database with no isolation.',
  );
  process.exit(2);
}

const problems = [];
let inspected = 0;
/** Raw calls seen at all, and those whose statement named a quoted table. */
let rawCalls = 0;
let parsed = 0;

for (const file of sources(SRC)) {
  const raw = readFileSync(file, 'utf8');
  const source = stripComments(raw);
  const transactional = transactionalNames(source);
  const relative = path.relative(root, file);

  for (const method of RAW_METHODS) {
    const pattern = new RegExp(`(\\w+)\\.\\${method}\\b(?:<[^>]*>)?`, 'g');
    for (const match of source.matchAll(pattern)) {
      const receiver = match[1];
      const statement = statementAt(source, match.index + match[0].length);
      const tables = tablesIn(statement);
      rawCalls += 1;
      if (tables.size > 0) parsed += 1;
      const touched = [...tables].filter((table) => forced.has(table));
      if (touched.length === 0) continue;
      inspected += 1;

      if (LOOSE_CLIENTS.has(receiver) || !transactional.has(receiver)) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push(
          `${relative}:${line}  ${receiver}.${method} touches ${touched.join(', ')} outside a tenant transaction.\n` +
            `    A policy on ${touched[0]} filters on app.tenant_id, which is transaction-local. Outside one it is\n` +
            `    unset — the statement matches nothing and reports success — or it is another request's. Wrap the\n` +
            `    call in withTx(tenantId, (tx) => …) or withPlatformTx((tx) => …) and issue it on that client.`,
        );
      }
    }
  }
}

// A gate that finds nothing because its parser stopped working reports the same
// clean line as a gate that finds nothing because the code is clean. These are
// the two facts that distinguish them: raw calls exist, and their SQL was read.
if (rawCalls > 0 && parsed === 0) {
  console.error(
    `[check-raw-sql-scope] Found ${rawCalls} raw call(s) but could not read a table name out of any of\n` +
      '  them. That is this script being broken, not the codebase being clean — statementAt() or\n' +
      '  tablesIn() has stopped matching how the calls are written. Fix it before trusting a pass.',
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`[check-raw-sql-scope] ${problems.length} raw statement(s) outside a tenant transaction:\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `[check-raw-sql-scope] ${inspected} raw statement(s) touching ${forced.size} RLS-forced tables — all inside a tenant transaction.`,
);
