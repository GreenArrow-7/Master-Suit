/**
 * What a lead a person types in must carry, and what an incoming one need not.
 *
 * The rule, decided 11 November 2026: a manually created lead needs a full name
 * and **at least one usable way to reach somebody** — a phone or an email —
 * and any phone or email supplied must be valid.
 *
 * The second half matters as much as the first. An import, a webhook, a form or
 * an API key keeps the contract it already had: an enquiry that arrives without
 * a contact method is **kept and flagged**, never refused. Losing an enquiry
 * because a field is empty is worse than holding an incomplete one.
 *
 * "Usable" is `normalizePhone` returning a number, not a stricter rule invented
 * here: `phoneNormalized` is what the dialler, duplicate matching and number
 * search all read, so a number that does not normalise is one nobody can ring.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createLead, NEEDS_CONTACT_TAG } from '@/services/leads/createLead';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `contactrule-${suffix}`;

let tenantId = '';
let ctx: Ctx;

/** Each case gets its own name, so the duplicate check never decides a test. */
const name = (label: string) => `Contact ${label} ${suffix}`;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'ContactRule LLC', displayName: 'ContactRule', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 40, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [['leads', 'CREATE']] as const);
  // A real User row: the lead's ownerId is a foreign key, so an invented id
  // fails the insert rather than the rule under test.
  const rep = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `rep-${suffix}@contactrule.test`,
    fullName: 'Rep',
  });
  ctx = buildCtx(buildActor({ id: rep.id, tenantId, roleId: role.id, grants: [['leads', 'CREATE']] as const }));
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('a lead somebody types in', () => {
  it('is accepted with a phone and no email', async () => {
    const lead = await createLead(ctx, { fullName: name('phone only'), phone: '0501234567' }, { requireContact: true });
    expect(lead.phoneNormalized).toBe('+971501234567');
    expect(lead.tags).not.toContain(NEEDS_CONTACT_TAG);
  });

  it('is accepted with an email and no phone', async () => {
    const lead = await createLead(
      ctx,
      { fullName: name('email only'), email: `e${suffix}@example.com` },
      { requireContact: true },
    );
    expect(lead.email).toBe(`e${suffix}@example.com`);
    expect(lead.tags).not.toContain(NEEDS_CONTACT_TAG);
  });

  it('is refused with neither, naming both fields', async () => {
    const attempt = createLead(ctx, { fullName: name('neither') }, { requireContact: true });
    await expect(attempt).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'phone', code: 'contact_required' }),
        expect.objectContaining({ field: 'email', code: 'contact_required' }),
      ]),
    });
  });

  it('is refused when the phone cannot be dialled, even with no email', async () => {
    const attempt = createLead(ctx, { fullName: name('junk phone'), phone: 'abcdefg' }, { requireContact: true });
    await expect(attempt).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ field: 'phone', code: 'invalid' })]),
    });
  });

  it('is refused for a junk phone even when an email is given', async () => {
    // The contact requirement is satisfied by the email; the number is still
    // wrong, and storing it would make the lead look reachable by phone.
    const attempt = createLead(
      ctx,
      { fullName: name('junk phone with email'), phone: 'abcdefg', email: `x${suffix}@example.com` },
      { requireContact: true },
    );
    await expect(attempt).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ field: 'phone', code: 'invalid' })]),
    });
  });

  it('leaves company, job title, nationality and tags optional', async () => {
    const lead = await createLead(
      ctx,
      { fullName: name('bare but reachable'), phone: '0509998888' },
      { requireContact: true },
    );
    expect(lead.company).toBeNull();
    expect(lead.jobTitle).toBeNull();
  });
});

describe('a lead that arrives from somewhere else', () => {
  it('is kept without a contact method, and flagged for follow-up', async () => {
    const lead = await createLead(ctx, { fullName: name('incoming bare') });
    expect(lead.id).toBeTruthy();
    expect(lead.tags).toContain(NEEDS_CONTACT_TAG);
  });

  it('keeps an unusable phone exactly as it arrived rather than refusing the enquiry', async () => {
    const lead = await createLead(ctx, { fullName: name('incoming junk phone'), phone: 'ext 4417' });
    expect(lead.phone).toBe('ext 4417');
    expect(lead.phoneNormalized).toBeNull();
    // Reachable by nothing, so it is on the worklist.
    expect(lead.tags).toContain(NEEDS_CONTACT_TAG);
  });

  it('is not flagged when it does carry a contact method', async () => {
    const lead = await createLead(ctx, { fullName: name('incoming good'), email: `i${suffix}@example.com` });
    expect(lead.tags).not.toContain(NEEDS_CONTACT_TAG);
  });

  it('keeps the tags it already had alongside the flag', async () => {
    const lead = await createLead(ctx, { fullName: name('incoming tagged'), tags: ['portal'] });
    expect(lead.tags).toEqual(expect.arrayContaining(['portal', NEEDS_CONTACT_TAG]));
  });
});
