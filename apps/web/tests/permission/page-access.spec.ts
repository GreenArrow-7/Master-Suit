/**
 * P1-1 — every workspace page declares a permission, and enforces it.
 *
 * `resolveWorkspacePage` backed 46 of the 65 pages and checked nothing beyond
 * the session; the other 39 called `resolveCtx` directly and checked even less.
 * Any authenticated employee could open the company profile, the role list, the
 * subscription, the security settings, the integration list, the full employee
 * directory and the audit log by typing the URL.
 *
 * Two things are asserted:
 *   1. structurally — no page can exist without declaring a permission;
 *   2. behaviourally — the helper both pages use actually refuses.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { assertPermission } from '@/lib/security/rbac';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Grants } from '../helpers/fixtures';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const pagesDir = path.join(root, 'src', 'app', '(workspace)');

/** `export { default } from './x'` / `export { default, metadata } from './x'`. */
const RE_EXPORT = /^\s*export \{[^}]*\bdefault\b[^}]*\} from '(\.[^']+)';/m;

function workspacePages(): string[] {
  return globSync('**/page.tsx', { cwd: pagesDir }).sort();
}

/**
 * The source that actually decides a route's access, following a re-export.
 *
 * Some routes are one line: `/{slug}/realty/leads` re-exports the Sales leads
 * page, because Real Estate reads the same lead register rather than a copy of
 * it. Such a file contains no gate call of its own and never should — the gate
 * is in the page it renders, and duplicating it here would be a second place to
 * get it wrong.
 *
 * So this resolves one hop and reads the target. That keeps the guard exactly as
 * strong as it was: every route still has to arrive at a file that gates, and a
 * re-export pointing at an ungated page fails on the target's source. What it
 * stops is the guard reading a delegation as an absence.
 *
 * Deliberately one hop and no more. A chain of re-exports is not a thing this
 * codebase has, and a resolver that followed arbitrarily many could loop.
 */
function accessSource(page: string): string {
  const file = path.join(pagesDir, page);
  const source = readFileSync(file, 'utf8');
  const reexport = RE_EXPORT.exec(source);
  if (!reexport) return source;
  return readFileSync(path.join(path.dirname(file), reexport[1]! + '.tsx'), 'utf8');
}

describe('structural: no workspace page can skip the access check', () => {
  const pages = workspacePages();

  it('found the pages', () => {
    // A glob that silently matches nothing would make every case below vacuous.
    expect(pages.length).toBeGreaterThanOrEqual(60);
  });

  it.each(workspacePages())('%s declares a permission', (page) => {
    const source = accessSource(page);
    const gated = /resolveWorkspacePage\s*\(|requirePageAccess\s*\(/.test(source);
    expect(gated, `${page} resolves no access check`).toBe(true);

    // A gated page must name what it needs. The type already requires it; this
    // catches a page that smuggles an options object through a cast. Both the
    // literal form (`permission: ['leads', 'VIEW']`) and the shorthand
    // (`{ permission }`, used where the value is chosen per URL segment) count.
    const declares = /permission:\s*(\[|SELF_SERVICE)/.test(source) || /\{\s*permission\s*\}/.test(source);
    expect(declares, `${page} declares no permission`).toBe(true);
  });

  it('no page reaches for resolveCtx directly any more', () => {
    const offenders = workspacePages().filter((page) => /\bresolveCtx\s*\(/.test(accessSource(page)));
    expect(offenders).toEqual([]);
  });
});

/**
 * Behavioural half. The pages are server components and cannot be invoked from
 * vitest without a Next request scope, so the assertion is on the check they all
 * funnel through — with real roles and real permission rows.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let adminRoleId = '';
let plainRoleId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `page-access-${suffix}`, legalName: 'PA LLC', displayName: 'PA', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  const admin = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  adminRoleId = admin.id;
  for (const [module, action] of [
    ['settings', 'VIEW'],
    ['auditlogs', 'VIEW'],
    ['users', 'VIEW'],
  ] as Grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: admin.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }

  const plain = await prisma.role.create({
    data: { tenantId, key: `plain-${suffix}`, name: 'Plain', rank: 100, defaultScope: 'OWN' },
  });
  plainRoleId = plain.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

/** The permissions the admin screens the audit named actually require. */
const ADMIN_SCREENS: [string, string, string][] = [
  ['admin/company', 'settings', 'VIEW'],
  ['admin/modules', 'settings', 'VIEW'],
  ['admin/subscription', 'settings', 'VIEW'],
  ['admin/security', 'settings', 'VIEW'],
  ['admin/audit', 'auditlogs', 'VIEW'],
  ['admin/users', 'users', 'VIEW'],
];

describe('behavioural: the shared check refuses an actor without the permission', () => {
  it.each(ADMIN_SCREENS)('%s refuses a member holding nothing', (_screen, module, action) => {
    const ctx = buildCtx(
      buildActor({
        id: `plain-${suffix}`,
        tenantId,
        roleId: plainRoleId,
        roleKey: 'plain',
        roleRank: 100,
        permissions: new Map(),
      }),
    );
    expect(() => assertPermission(ctx, module, action as never)).toThrow(Forbidden().constructor);
  });

  it.each(ADMIN_SCREENS)('%s admits an administrator', (_screen, module, action) => {
    const ctx = buildCtx(
      buildActor({
        id: `admin-${suffix}`,
        tenantId,
        roleId: adminRoleId,
        roleKey: 'admin',
        roleRank: 10,
        permissions: new Map([[`${module}:${action}`, 'ORGANIZATION']]),
      }),
    );
    expect(() => assertPermission(ctx, module, action as never)).not.toThrow();
  });
});
