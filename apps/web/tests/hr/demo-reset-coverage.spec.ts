/**
 * SPEC-0007/FR-015 — the demo reset must not silently leave a tenant's rows
 * behind when someone adds a model.
 *
 * This test exists because the audit that produced SPEC-0007 got this wrong.
 * It read the reset's 47 explicit `deleteMany` calls, saw no HR table among
 * them, and concluded HR records survived a reset. They do not: the branch ends
 * with `tenant.delete()` and almost every tenant-scoped model cascades. The
 * conclusion was confident, documented, and false — see CHG-002.
 *
 * So the property asserted here is the one that actually matters, and it is
 * stronger than "the list mentions every table": every model carrying a
 * `tenantId` must be removed by the reset **by some mechanism** — the tenant
 * cascade, an explicit deletion, or a reviewed and named exclusion. A new model
 * that satisfies none of the three fails this test rather than quietly
 * surviving into the next demonstration.
 *
 * It reads the schema rather than the database: this is a property of the
 * source, it must fail on a developer's machine the moment a model is added,
 * and it needs no PostgreSQL to do so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const seed = readFileSync(path.join(root, 'prisma', 'seed', 'index.ts'), 'utf8');

/**
 * Models excluded from the reset, each with the reason it is excluded.
 *
 * Deliberately short. A broad exclusion list would make this test pass by
 * saying nothing, which is the failure mode it is written against — so every
 * entry names a specific, defensible reason rather than a category.
 */
const REVIEWED_EXCLUSIONS: Record<string, string> = {
  // Its tenant relation is SetNull, not Cascade, and that is the point: the
  // record of what an operator did to a workspace has to outlive the workspace.
  // Deleting it with the tenant would destroy the audit trail of the deletion.
  PlatformAuditEvent: 'audit history must survive the tenant it describes (onDelete: SetNull, by design)',
};

interface ModelInfo {
  name: string;
  cascades: boolean;
}

function tenantScopedModels(): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (!/^\s*tenantId\s+String/m.test(body!)) continue;
    const relation = body!.match(/^\s*tenant\s+Tenant\??\s+@relation\(([^)]*)\)/m);
    models.push({ name: name!, cascades: Boolean(relation && /onDelete:\s*Cascade/.test(relation[1]!)) });
  }
  return models;
}

/**
 * The teardown, located by the function that performs it.
 *
 * This used to slice between `if (RESET)` and the removal log, which stopped
 * working when CONV-011 moved the teardown into a function so it could be
 * applied to every seeded workspace rather than only the first. The anchors
 * follow the code; the assertion below is unchanged in strength.
 */
function teardownSource(): string {
  const start = seed.indexOf('async function removeSeededTenant(');
  expect(start, 'the teardown function must still be recognisable in the seed').toBeGreaterThan(-1);
  const end = seed.indexOf('Removed ${label}', start);
  expect(end, 'the teardown must still end by reporting removal').toBeGreaterThan(start);
  return seed.slice(start, end);
}

/** Models named by an explicit `db.<model>.deleteMany` in the teardown. */
function explicitlyDeleted(): Set<string> {
  const names = new Set<string>();
  for (const m of teardownSource().matchAll(/db\.(\w+)\.deleteMany\(/g)) {
    // Prisma's client property is the model name with a lower-case initial.
    names.add(m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1));
  }
  return names;
}

describe('SPEC-0007/FR-015 demo reset coverage', () => {
  const models = tenantScopedModels();

  it('finds the tenant-scoped models to check', () => {
    // A regex that silently matched nothing would make every assertion below
    // vacuously true.
    expect(models.length).toBeGreaterThan(100);
  });

  it('the teardown still deletes the tenant, which is what does the work', () => {
    expect(teardownSource()).toMatch(/db\.tenant\.delete\(/);
  });

  /**
   * CONV-011. The reset used to remove the primary workspace only, so the
   * secondary isolation workspace survived every reset and could not be
   * rebuilt from a changed definition.
   */
  it('the reset removes every workspace the seed creates, not just the first', () => {
    const start = seed.indexOf('if (RESET)');
    expect(start, 'the reset branch must still be recognisable').toBeGreaterThan(-1);
    const branch = seed.slice(start, start + 600);
    expect(branch, 'the reset does not remove the primary workspace').toMatch(/DEMO_WORKSPACE\.slug/);
    expect(branch, 'the reset does not remove the secondary workspace').toMatch(/SECOND_WORKSPACE\.slug/);
    expect(branch).toMatch(/removeSeededTenant\(/);
  });

  it('every tenant-scoped model is cleared by cascade, by explicit deletion, or is a reviewed exclusion', () => {
    const deleted = explicitlyDeleted();
    const uncovered = models
      .filter((m) => !m.cascades && !deleted.has(m.name) && !(m.name in REVIEWED_EXCLUSIONS))
      .map((m) => m.name);

    expect(
      uncovered,
      `these models carry a tenantId but nothing removes them on a demo reset:\n  ${uncovered.join('\n  ')}\n` +
        'Give the model an onDelete: Cascade tenant relation, delete it explicitly in the reset, ' +
        'or add it to REVIEWED_EXCLUSIONS with the reason it must survive.',
    ).toEqual([]);
  });

  it('the exclusion list stays narrow and every entry is still tenant-scoped', () => {
    const names = new Set(models.map((m) => m.name));
    for (const [name, reason] of Object.entries(REVIEWED_EXCLUSIONS)) {
      expect(names.has(name), `${name} is excluded but no longer carries a tenantId; drop the entry`).toBe(true);
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(20);
    }
    // A list that grows without review is how this check stops meaning
    // anything. Raising this ceiling is a decision, not a formality.
    expect(Object.keys(REVIEWED_EXCLUSIONS).length).toBeLessThanOrEqual(3);
  });

  it('HR models specifically are covered — the case SPEC-0007 was written about', () => {
    const hr = models.filter((m) => /^Hr[A-Z]/.test(m.name) || m.name === 'BiometricConsent');
    expect(hr.length, 'the schema should still declare HR models').toBeGreaterThan(20);
    const deleted = explicitlyDeleted();
    const uncovered = hr.filter((m) => !m.cascades && !deleted.has(m.name)).map((m) => m.name);
    expect(uncovered).toEqual([]);
  });
});
