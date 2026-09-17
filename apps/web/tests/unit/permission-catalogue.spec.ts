/**
 * The permission catalogue covers what the code checks, and the migration that
 * installs it defines permissions without granting any.
 *
 * Pure: reads source files, no database. The database side is
 * scripts/check-permission-catalogue.ts, which CI runs right after migrations and
 * before the demo seed, so a seeded database cannot hide a missing definition.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogueTokens } from '@/lib/security/permissionCatalogue';
import { NAV_PERMISSIONS, parsePermission } from '@/lib/nav/workspaceNav';
import { MONITORING_ACTIONS, MONITORING_MODULES } from '@/lib/auth/support-actor';

const web = path.resolve(__dirname, '../..');
const MIGRATION = path.join(web, 'prisma/migrations/20260915140000_permission_catalogue_definitions/migration.sql');
const catalogue = new Set(catalogueTokens());

/**
 * Module names used in checks that are not `Permission` rows, and why.
 * `selfService` / `anonymous` routes skip the permission check and use the module
 * only as a label for rate limiting, audit and metrics.
 */
const PSEUDO_MODULES = new Set([
  'self', // SELF_SERVICE pages are logged as self:VIEW
  'identity_self', // selfService: own password and authenticator
  'hr_self', // selfService: own HR records
  'notifications', // selfService: own notifications and devices
  'metrics', // metrics label on /api/metrics (token-authenticated)
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the catalogue migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('inserts exactly the catalogue', () => {
    const inserted = new Set(
      [...sql.matchAll(/\(gen_random_uuid\(\)::text, '([a-z_]+)', '([A-Z_]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`),
    );
    expect([...inserted].filter((token) => !catalogue.has(token))).toEqual([]);
    expect([...catalogue].filter((token) => !inserted.has(token))).toEqual([]);
  });

  it('defines permissions and grants none: no RolePermission, UPDATE or DELETE, and existing rows are left alone', () => {
    const statements = sql.replace(/--.*$/gm, '');
    expect(statements).not.toMatch(/RolePermission/i);
    // Statements, not the action values ('DELETE' is a permission action).
    expect(statements).not.toMatch(/\bUPDATE\s+"/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bINSERT\s+INTO\s+"(?!Permission")/i);
    expect(statements).toMatch(/ON CONFLICT \("module", "action"\) DO NOTHING/);
  });
});

describe('what the catalogue covers', () => {
  it('every permission the navigation gates on', () => {
    const missing = NAV_PERMISSIONS.map((token) => parsePermission(token).join(':')).filter(
      (token) => !catalogue.has(token),
    );
    expect(missing).toEqual([]);
  });

  it('every permission the monitoring allowlist can grant', () => {
    const missing = [...MONITORING_MODULES]
      .flatMap((module) => MONITORING_ACTIONS.map((action) => `${module}:${action}`))
      .filter((token) => !catalogue.has(token));
    expect(missing).toEqual([]);
  });

  it('every literal permission check in src', () => {
    const checks = new Set<string>();
    const patterns = [
      /permission:\s*\[\s*'([a-z_]+)'\s*,\s*'([A-Z_]+)'\s*\]/g, // page and guarded-route gates
      /module:\s*'([a-z_]+)'\s*,\s*action:\s*'([A-Z_]+)'/g, // API kernel route specs
      /(?:assertPermission|can|scopeFor|atLeast)\(\s*ctx\s*,\s*'([a-z_]+)'\s*,\s*'([A-Z_]+)'/g, // direct checks
    ];
    for (const file of sourceFiles(path.join(web, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) checks.add(`${match[1]}:${match[2]}`);
      }
    }
    expect(checks.size).toBeGreaterThan(100);
    const missing = [...checks]
      .filter((token) => !catalogue.has(token) && !PSEUDO_MODULES.has(token.split(':')[0]!))
      .sort();
    expect(missing).toEqual([]);
  });
});
