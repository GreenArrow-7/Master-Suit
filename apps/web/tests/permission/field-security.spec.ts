/**
 * P1-7 — field-level security had no tests at all.
 *
 * `tests/permission/field.spec.ts` was deleted rather than fixed: it asserted
 * against `/api/v1/leads/export` and `/api/v1/reports/run`, neither of which
 * exists, using fabricated fixtures. Deleting it was the right call for that
 * file and left `loadFieldRules`, `applyFieldSecurity`, `stripUneditableFields`
 * and `assertFilterableFields` — the whole of field security — untested.
 *
 * This suite is written against `/api/v1/opportunities`, which is where field
 * security is actually wired, plus unit coverage of the masking strategies. The
 * route half is what matters: field security lives in the serialiser precisely
 * so that it cannot be forgotten on an egress path, and only a test that goes
 * through the route proves the serialiser is still in the path.
 *
 * The binary-search case is the one worth reading. Masking a field is worthless
 * if a caller can filter or sort on it: ten requests recover a masked salary by
 * bisection. `assertFilterableFields` refuses instead of silently dropping the
 * clause, and that refusal is asserted here through the real query parameter.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  applyFieldSecurity,
  assertFilterableFields,
  loadFieldRules,
  stripUneditableFields,
  type FieldRule,
} from '@/lib/security/fieldSecurity';
import { GET as listOpportunities, POST as createOpportunityRoute } from '@/app/api/v1/opportunities/route';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { get, post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `fieldsec-${suffix}`;

let tenantId = '';
let restrictedRoleId = '';
let openRoleId = '';
const cookies: Record<string, string> = {};
const userIds: Record<string, string> = {};

/** Base64url-encodes a filter tree the way the route's `filter` parameter expects. */
const encodeFilter = (tree: unknown) => Buffer.from(JSON.stringify(tree)).toString('base64url');

const ctxFor = (label: string, roleId: string) =>
  buildCtx(
    buildActor({
      id: userIds[label]!,
      tenantId,
      roleId,
      roleKey: label,
      roleRank: 50,
      permissions: new Map([
        ['opportunities:VIEW', 'ORGANIZATION' as const],
        ['opportunities:CREATE', 'ORGANIZATION' as const],
      ]),
    }),
  );

async function member(label: string, grants: readonly (readonly [string, string])[]) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action: action as never } },
      update: {},
      create: { module, action: action as never },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const user = await prisma.user.create({
    data: { tenantId, email: `${label}-${suffix}@fs.test`, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `${label}-${suffix}@fs.test`,
      normalizedEmail: `${label}-${suffix}@fs.test`,
      fullName: label,
      status: 'ACTIVE',
    },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  userIds[label] = user.id;
  cookies[label] = await createSessionToken(tenantId, user.id);
  return role.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'FieldSec LLC', displayName: 'FieldSec', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const grants = [
    ['opportunities', 'VIEW'],
    ['opportunities', 'CREATE'],
  ] as const;
  restrictedRoleId = await member('restricted', grants);
  openRoleId = await member('open', grants);

  // The restricted role: cannot see `amount` at all, sees `currency` masked, and
  // may not write `probability`.
  await prisma.fieldPermission.createMany({
    data: [
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'amount',
        canView: false,
        canEdit: false,
        maskStrategy: 'HIDE',
      },
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'currency',
        canView: false,
        canEdit: false,
        maskStrategy: 'MASK_ALL',
      },
      {
        tenantId,
        roleId: restrictedRoleId,
        objectType: 'OPPORTUNITY',
        fieldKey: 'probability',
        canView: true,
        canEdit: false,
        maskStrategy: null,
      },
    ],
  });

  const pipeline = await prisma.pipeline.create({
    data: { tenantId, key: `pipe-${suffix}`, name: 'Default', isDefault: true },
  });
  const stage = await prisma.pipelineStage.create({
    data: { tenantId, pipelineId: pipeline.id, key: `new-${suffix}`, name: 'New', position: 1 },
  });
  await prisma.opportunity.create({
    data: {
      tenantId,
      name: `Tower deal ${suffix}`,
      reference: `OP-${suffix}`,
      amount: 1_250_000,
      currency: 'AED',
      probability: 40,
      ownerId: userIds.restricted!,
      pipelineId: pipeline.id,
      stageId: stage.id,
    },
  });
});

afterAll(async () => {
  await prisma.workspaceMembership.deleteMany({ where: { tenantId } });
  await prisma.platformUser.deleteMany({ where: { email: { endsWith: `-${suffix}@fs.test` } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('through the route it is actually wired into', () => {
  it('hides a field the role may not view', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.restricted);
    expect(response.status).toBe(200);
    const row = response.body.data[0];
    // HIDE means the key is absent, not null: a null still tells the caller the
    // field exists and is empty.
    expect(row).not.toHaveProperty('amount');
    expect(row.name).toContain('Tower deal');
  });

  it('masks a field whose rule asks for masking rather than removal', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.restricted);
    const row = response.body.data[0];
    expect(row.currency).toBe('•••');
    expect(row.currency).not.toBe('AED');
  });

  it('returns the real values to a role with no restriction', async () => {
    const response = await get(listOpportunities, '/api/v1/opportunities', cookies.open);
    const row = response.body.data[0];
    expect(row.amount).toBe('1250000');
    expect(row.currency).toBe('AED');
  });

  it('refuses to filter on a hidden field, rather than ignoring the clause', async () => {
    // Silently dropping the clause is the dangerous alternative: the caller gets
    // an unfiltered list and cannot tell, but a caller who *does* know can
    // recover a masked value by bisection over the filter.
    const filter = encodeFilter({ op: 'AND', children: [{ field: 'amount', cmp: 'gt', value: 1000000 }] });
    const response = await get(listOpportunities, `/api/v1/opportunities?filter=${filter}`, cookies.restricted);
    expect(response.status).toBe(403);
    expect(response.body.detail).toMatch(/restricted field/i);
  });

  it('lets the unrestricted role past the field-security gate on the same field', async () => {
    const filter = encodeFilter({ op: 'AND', children: [{ field: 'amount', cmp: 'gt', value: 1000000 }] });
    const response = await get(listOpportunities, `/api/v1/opportunities?filter=${filter}`, cookies.open);

    // The positive control for the case above: the same filter, the same field,
    // a role without the rule — and no 403. That is the whole claim this suite
    // makes, and it is what proves the 403 came from field security rather than
    // from the filter being rejected for some unrelated reason.
    expect(response.status).not.toBe(403);

    // It is a 400, and that is a separate defect with its own entry in
    // docs/KNOWN-LIMITATIONS.md: FIELD_MAP in lib/api/filterTree.ts registers
    // only LEAD, so `filter` on any other list route is rejected as
    // "unknown-object" for every caller. Asserted rather than skipped, so this
    // test starts failing the day somebody adds the OPPORTUNITY map — which is
    // when the line above should become `toBe(200)`.
    expect(response.status).toBe(400);
    expect(response.body.detail).toMatch(/no filter map registered/i);
  });

  it('drops an uneditable field from a create payload instead of writing it', async () => {
    const response = await post(
      createOpportunityRoute,
      '/api/v1/opportunities',
      { name: `Smuggled ${suffix}`, amount: 999, tags: [], custom: {} },
      cookies.restricted,
    );
    expect(response.status).toBe(200);

    // `amount` is canEdit:false for this role, so the crafted value must not have
    // reached the database — and the response must not echo it back either.
    const stored = await prisma.opportunity.findFirst({
      where: { tenantId, name: `Smuggled ${suffix}` },
      select: { amount: true },
    });
    // The column defaults to 0 rather than null, so the assertion is that the
    // crafted 999 did not survive — not that the field is empty.
    expect(Number(stored?.amount ?? 0)).not.toBe(999);
    expect(response.body).not.toHaveProperty('amount');
  });
});

describe('rules are scoped to the role that owns them', () => {
  it('loads only this role’s rules', async () => {
    const restricted = await loadFieldRules(ctxFor('restricted', restrictedRoleId), 'OPPORTUNITY');
    const open = await loadFieldRules(ctxFor('open', openRoleId), 'OPPORTUNITY');
    expect([...restricted.keys()].sort()).toEqual(['amount', 'currency', 'probability']);
    expect(open.size).toBe(0);
  });

  it('loads only this object type’s rules', async () => {
    const other = await loadFieldRules(ctxFor('restricted', restrictedRoleId), 'LEAD');
    expect(other.size).toBe(0);
  });
});

describe('masking strategies', () => {
  const rule = (fieldKey: string, maskStrategy: FieldRule['maskStrategy']): [string, FieldRule] => [
    fieldKey,
    { fieldKey, canView: false, canEdit: false, maskStrategy },
  ];
  const ctx = () => ctxFor('restricted', restrictedRoleId);
  const apply = (record: Record<string, unknown>, rules: Map<string, FieldRule>) =>
    applyFieldSecurity(ctx(), 'OPPORTUNITY', rules, record);

  it('MASK_ALL reveals nothing, not even the true length', () => {
    const out = apply({ secret: 'a-very-long-secret-value' }, new Map([rule('secret', 'MASK_ALL')]));
    expect(out.secret).toBe('•••••••••');
    expect(String(out.secret)).not.toContain('secret');
  });

  it('MASK_PARTIAL keeps enough to recognise a record and not enough to use it', () => {
    const out = apply({ iban: 'AE070331234567890123456' }, new Map([rule('iban', 'MASK_PARTIAL')]));
    expect(String(out.iban).startsWith('AE070')).toBe(true);
    expect(String(out.iban).endsWith('56')).toBe(true);
    expect(out.iban).not.toBe('AE070331234567890123456');
  });

  it('MASK_PARTIAL does not leak a short value whole', () => {
    const out = apply({ pin: '1234' }, new Map([rule('pin', 'MASK_PARTIAL')]));
    expect(out.pin).toBe('••••');
  });

  it('MASK_EMAIL keeps the domain, which is what makes it useful', () => {
    const out = apply({ email: 'amina.alrashid@example.com' }, new Map([rule('email', 'MASK_EMAIL')]));
    expect(out.email).toBe('a•••••••••••••@example.com');
  });

  it('MASK_EMAIL does not treat a non-address as one', () => {
    const out = apply({ email: 'not-an-address' }, new Map([rule('email', 'MASK_EMAIL')]));
    expect(String(out.email)).toMatch(/^•+$/);
  });

  it('masks null as null rather than as a row of dots', () => {
    const out = apply({ amount: null }, new Map([rule('amount', 'MASK_ALL')]));
    expect(out.amount).toBeNull();
  });

  it('HIDE removes the key entirely', () => {
    const out = apply({ amount: 42, name: 'keep' }, new Map([rule('amount', 'HIDE')]));
    expect(out).not.toHaveProperty('amount');
    expect(out.name).toBe('keep');
  });

  it('a rule with no strategy removes the key too', () => {
    const out = apply({ amount: 42 }, new Map([rule('amount', null)]));
    expect(out).not.toHaveProperty('amount');
  });
});

describe('sensitive fields', () => {
  const ctxWithout = () => ctxFor('restricted', restrictedRoleId);
  const ctxWith = () =>
    buildCtx(
      buildActor({
        id: userIds.restricted!,
        tenantId,
        roleId: restrictedRoleId,
        roleKey: 'restricted',
        roleRank: 50,
        permissions: new Map([['opportunity:VIEW_SENSITIVE_FIELDS', 'ORGANIZATION' as const]]),
      }),
    );

  it('are withheld by default, with no rule row needed', () => {
    const out = applyFieldSecurity(ctxWithout(), 'OPPORTUNITY', new Map(), { salary: 100 }, ['salary']);
    expect(out).not.toHaveProperty('salary');
  });

  it('are returned to a role holding VIEW_SENSITIVE_FIELDS', () => {
    const out = applyFieldSecurity(ctxWith(), 'OPPORTUNITY', new Map(), { salary: 100 }, ['salary']);
    expect(out.salary).toBe(100);
  });
});

describe('write and filter guards as units', () => {
  const uneditable = new Map<string, FieldRule>([
    ['amount', { fieldKey: 'amount', canView: true, canEdit: false, maskStrategy: null }],
  ]);

  it('strips only what the role may not write', () => {
    const out = stripUneditableFields(uneditable, { name: 'keep', amount: 999 });
    expect(out).toEqual({ name: 'keep' });
  });

  it('leaves a payload alone when the role has no rules', () => {
    const out = stripUneditableFields(new Map(), { name: 'keep', amount: 999 });
    expect(out).toEqual({ name: 'keep', amount: 999 });
  });

  it('names every blocked field, so the caller can fix the request in one go', () => {
    const hidden = new Map<string, FieldRule>([
      ['amount', { fieldKey: 'amount', canView: false, canEdit: false, maskStrategy: 'HIDE' }],
      ['currency', { fieldKey: 'currency', canView: false, canEdit: false, maskStrategy: 'MASK_ALL' }],
    ]);
    expect(() => assertFilterableFields(hidden, ['amount', 'currency', 'name'])).toThrow(/amount, currency/);
  });

  it('allows filtering on a viewable-but-uneditable field', () => {
    expect(() => assertFilterableFields(uneditable, ['amount'])).not.toThrow();
  });
});
