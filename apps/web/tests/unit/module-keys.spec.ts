import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeModule } from '@/lib/nav/workspaceNav';
import { PRODUCT_MODULE_CHOICES, PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';

/**
 * One product module list: `ModuleKey` in the schema, mirrored once as
 * PRODUCT_MODULE_KEYS in lib/modules/catalogue.ts. The entitlement and navigation
 * types derive from that tuple, so only the tuple and the screens can drift from
 * the schema, and those are what this checks.
 */
const root = path.join(__dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** The values of a Prisma enum block, in declaration order. */
function prismaEnum(schema: string, name: string): string[] {
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (!block) throw new Error(`enum ${name} not found in schema.prisma`);
  return block[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

const schemaModules = prismaEnum(read('prisma/schema.prisma'), 'ModuleKey');

describe('the product module list does not drift', () => {
  it('finds a non-trivial list to check', () => {
    // A parser that quietly matched nothing would make every assertion below
    // pass against two empty arrays.
    expect(schemaModules.length).toBeGreaterThanOrEqual(2);
    expect(schemaModules).toContain('REAL_ESTATE');
  });
});

describe('every module can actually be sold and enabled', () => {
  /**
   * The gap this exists for.
   *
   * REAL_ESTATE was added to the schema, the entitlement union, the navigation
   * and the routes — and the three platform screens that offer modules each
   * carried their own hand-typed pair. So the plan form offered two checkboxes,
   * no plan could include Real Estate, no workspace could be entitled to it, and
   * the module was unreachable in production despite being deployed. Nothing
   * threw; the checkbox was simply absent.
   *
   * A module in the schema that nobody can buy is not shipped, so this is
   * checked with the same weight as the type-level lists above.
   */
  it('the choice catalogue offers exactly the modules the schema defines', () => {
    const offered = PRODUCT_MODULE_CHOICES.map((choice) => choice.value);
    expect([...offered].sort()).toEqual([...schemaModules].sort());
  });

  it('every choice is labelled and described', () => {
    for (const choice of PRODUCT_MODULE_CHOICES) {
      expect(choice.label.trim().length, `${choice.value} has no label`).toBeGreaterThan(0);
      expect(choice.description.trim().length, `${choice.value} has no description`).toBeGreaterThan(0);
    }
  });

  /**
   * The three screens must read the catalogue rather than restate it. A fourth
   * hand-typed list is exactly how this broke the first time.
   */
  it.each([
    'src/app/(platform)/platform/plans/PlanForm.tsx',
    'src/app/(platform)/platform/workspaces/new/NewWorkspaceForm.tsx',
    'src/app/(platform)/platform/workspaces/[workspaceId]/WorkspaceEditForm.tsx',
  ])('%s reads the catalogue instead of listing modules itself', (file) => {
    const source = read(file);
    expect(source).toContain('PRODUCT_MODULE_CHOICES');
    // No literal module keys left behind in the markup.
    expect(source).not.toMatch(/value="(HRMS|SALES|REAL_ESTATE)"/);
    expect(source).not.toMatch(/\['(HRMS|SALES)',/);
  });
});

describe('the platform APIs accept every module the UI offers', () => {
  /**
   * The failure this exists for, and it was expensive to find.
   *
   * Four platform routes validated `enabledModules` / `modules` against their
   * own `z.enum(['HRMS', 'SALES'])`. Adding the Real Estate checkbox to the
   * wizard therefore made it post a value the API refused, so workspace
   * creation failed — and the E2E suite reported only `POST /api/v1/auth/login
   * 401` on every later sign-in, because the admin that login needed had never
   * been created. Nothing in the output named modules at all.
   *
   * An API narrower than the form that feeds it is a 400 the user cannot act
   * on, so the list has one home and everything reads it.
   */
  it('the key tuple matches ModuleKey', () => {
    expect([...PRODUCT_MODULE_KEYS].sort()).toEqual([...schemaModules].sort());
  });

  it('the catalogue and the key tuple agree', () => {
    expect(PRODUCT_MODULE_CHOICES.map((c) => c.value).sort()).toEqual([...PRODUCT_MODULE_KEYS].sort());
  });

  it.each([
    'src/app/api/v1/platform/plans/route.ts',
    'src/app/api/v1/platform/workspaces/route.ts',
    'src/app/api/v1/platform/workspaces/[workspaceId]/route.ts',
  ])('%s validates against the shared list, not its own literals', (file) => {
    const source = read(file);
    expect(source).toContain('PRODUCT_MODULE_KEYS');
    expect(source, 'a hand-written module list is still here').not.toMatch(/\['HRMS', 'SALES'\]/);
  });
});

describe('activeModule answers for every product', () => {
  it('reads the URL segment first', () => {
    expect(activeModule('/acme/realty/leads', ['SALES', 'REAL_ESTATE'])).toBe('realty');
    expect(activeModule('/acme/sales/leads', ['SALES', 'REAL_ESTATE'])).toBe('sales');
    expect(activeModule('/acme/people/leave', ['SALES', 'HRMS'])).toBe('people');
  });

  /**
   * A shared route (`/{slug}/dashboard`) has to pick one tab bar. Picking a
   * product the workspace is not entitled to would offer a phone user four links
   * that all refuse.
   */
  it('falls back to something the workspace actually owns', () => {
    expect(activeModule('/acme/dashboard', ['REAL_ESTATE'])).toBe('realty');
    expect(activeModule('/acme/dashboard', ['HRMS'])).toBe('people');
    // SALES keeps its existing answer, so no entitled workspace moves.
    expect(activeModule('/acme/dashboard', ['SALES', 'REAL_ESTATE'])).toBe('sales');
  });
});
