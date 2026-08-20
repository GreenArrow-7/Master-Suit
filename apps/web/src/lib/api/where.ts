/**
 * Combines Prisma `where` fragments without letting one silently delete another.
 *
 * ── The bug this exists to make unrepresentable ──────────────────────────────
 *
 * Every list route used to build its query by spreading its fragments into one
 * object literal:
 *
 *   const where = { ...scopeWhere, ...compileFilterTree(...), ...search, ...cursorWhere(cursor) };
 *
 * That reads like "apply all four". It is not. Object spread is last-key-wins,
 * and three of those four fragments can carry a top-level `OR`:
 *
 *   visibilityWhere  { tenantId, OR: [{ ownerId: { in: [...] } }, { ownerId: null }] }
 *   compileFilterTree  { OR: [...] }   whenever the filter tree's root is an OR node
 *   cursorWhere        { OR: [{ updatedAt: { lt } }, { updatedAt, id: { lt } }] }
 *
 * So the ownership restriction — the entire enforcement of OWN, TEAM, BRANCH and
 * REGION scope on the read path — was discarded by any request that carried a
 * cursor, and by any filter whose root node was an OR. `tenantId` survived, so
 * row-level security still held the workspace boundary and this never leaked
 * across tenants. Inside a workspace it leaked completely: a rep with OWN scope
 * who clicked to page two of the leads grid was served every colleague's leads,
 * and the "No Activity (30d)" smart view did it on page one, because that view's
 * filter is an OR by construction.
 *
 * Merging under `AND` is what "apply all four" actually is.
 *
 * ── Why `tenantId` is hoisted rather than wrapped ────────────────────────────
 *
 * The obvious fix — `{ AND: [scopeWhere, filterWhere, search, cursor] }` — breaks
 * two things in lib/db.ts, both quietly. The tenant guard refuses any read whose
 * `where` has no top-level `tenantId`, and `resolveTenantId` reads the same key
 * to pin `app.tenant_id` for row-level security. Buried one level down, the first
 * throws and the second returns null.
 *
 * So scalar keys stay at the top of the object where they were, and only the
 * keys that would collide — plus the boolean combinators, which never compose by
 * assignment — go into `AND`. `{ a, b }` and `{ AND: [{ a }, { b }] }` are the
 * same conjunction to Prisma, so splitting a fragment across the two is free.
 */

/** A Prisma `where` fragment. Deliberately loose: each caller has its own model type. */
export type WhereFragment = Record<string, unknown> | null | undefined;

/** Keys that are a conjunction/disjunction rather than a field, and so never merge by assignment. */
const COMBINATORS = new Set(['AND', 'OR', 'NOT']);

/**
 * Conjoins fragments left to right. Later fragments never overwrite earlier ones.
 *
 * A key appearing for the first time, and not a combinator, is kept at the top
 * level — that is what leaves `tenantId` where lib/db.ts looks for it. Anything
 * that would overwrite something already there is moved into `AND` instead,
 * which is the whole point: a second restriction on the same field narrows the
 * result, it does not replace the first.
 *
 *   mergeWhere(
 *     { tenantId: 't', OR: [{ ownerId: 'u' }] },
 *     { OR: [{ createdAt: { not: null } }] },
 *   )
 *   // { tenantId: 't', AND: [{ OR: [{ ownerId: 'u' }] }, { OR: [{ createdAt: { not: null } }] }] }
 */
export function mergeWhere(...fragments: WhereFragment[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const conjuncts: Record<string, unknown>[] = [];

  for (const fragment of fragments) {
    if (!fragment) continue;
    for (const [key, value] of Object.entries(fragment)) {
      if (value === undefined) continue;
      if (COMBINATORS.has(key) || key in merged) {
        conjuncts.push({ [key]: value });
      } else {
        merged[key] = value;
      }
    }
  }

  // Only when there is something to conjoin: an untouched `AND` keeps the
  // simplest queries reading exactly as they did, and keeps the generated SQL
  // free of a one-element AND on every list endpoint in the product.
  if (conjuncts.length === 1) return { ...merged, ...normaliseSingle(conjuncts[0]!, merged) };
  if (conjuncts.length > 1) merged.AND = conjuncts;
  return merged;
}

/**
 * A lone conjunct is folded back to the top level when it cannot collide.
 *
 * `{ tenantId, AND: [{ OR: [...] }] }` and `{ tenantId, OR: [...] }` mean the
 * same thing; the second is what every existing snapshot, log line and query
 * plan in this codebase already shows, and keeping it means adopting mergeWhere
 * does not churn the shape of queries that never had a collision to begin with.
 */
function normaliseSingle(conjunct: Record<string, unknown>, merged: Record<string, unknown>) {
  const [key] = Object.keys(conjunct);
  return key !== undefined && !(key in merged) ? conjunct : { AND: [conjunct] };
}
