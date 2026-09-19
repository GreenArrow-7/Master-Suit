import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expand, render } from '../../scripts/roles-doc';
import { ROLES } from '../../prisma/seed/roles';

describe('role documentation', () => {
  it('docs/ROLES.md matches the seeded roles (run `npx tsx scripts/roles-doc.ts` after changing them)', () => {
    const committed = readFileSync(path.join(process.cwd(), 'docs', 'ROLES.md'), 'utf8');
    expect(committed).toBe(render());
  });

  it('expands wildcards and drops NONE', () => {
    const admin = ROLES.find((r) => r.key === 'org_admin')!;
    const grants = expand(admin);
    expect(grants.leads?.DELETE).toBe('ORGANIZATION');
    expect(Object.keys(grants).length).toBeGreaterThan(10);
    const rep = ROLES.find((r) => r.key === 'sales_rep')!;
    expect(expand(rep).leads?.DELETE).toBeUndefined();
  });
});
