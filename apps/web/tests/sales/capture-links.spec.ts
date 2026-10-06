import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as createLink } from '@/app/api/v1/capture-links/route';
import { PATCH as editLink } from '@/app/api/v1/capture-links/[id]/route';
import { POST as submit } from '@/app/api/v1/public/capture/route';
import { patch, post } from '../helpers/request';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * QR capture links (Lead Eagle plan, gap 4): the public form behind a code
 * makes a lead credited to the link's agent, through the portals' intake.
 */
let fixture: Fixture;
let tenantId: string;
let link: { id: string; key: string };

const send = (key: string, answers: Record<string, string>) =>
  post(submit, '/api/v1/public/capture', { workspace: fixture.a.slug, form: key, answers });
const leadsOn = (phoneNormalized: string) => prisma.lead.findMany({ where: { tenantId, phoneNormalized } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('QR capture', () => {
  it('turns a submission into a lead owned by the link’s agent', async () => {
    const created = await post(
      createLink,
      '/api/v1/capture-links',
      { label: 'Cityscape stand', ownerId: fixture.a.userId, campaign: 'Sidra' },
      fixture.a.cookie,
    );
    expect(created.status).toBe(200);
    link = created.body;
    expect(link.key).toMatch(/^cityscape-stand-[0-9a-f]{6}$/);

    const res = await send(link.key, { name: 'Lina Haddad', phone: '050 444 1212', message: 'A villa, please' });
    expect(res.status).toBe(200);
    const [lead] = await leadsOn('+971504441212');
    expect(lead).toMatchObject({
      fullName: 'Lina Haddad',
      ownerId: fixture.a.userId,
      source: 'PUBLIC_FORM',
      sourceDetail: `capture:${link.key}`,
    });
    const counts = await prisma.captureLink.findFirstOrThrow({ where: { tenantId, id: link.id } });
    expect(counts.submitCount).toBe(1);
  });

  it('attaches a second submission from the same number to the same lead', async () => {
    expect((await send(link.key, { name: 'Lina H', phone: '0504441212' })).status).toBe(200);
    const leads = await leadsOn('+971504441212');
    expect(leads).toHaveLength(1);
    expect(await prisma.activity.count({ where: { tenantId, leadId: leads[0]!.id } })).toBe(2);
  });

  it('answers 404 once the link is switched off, and makes nothing', async () => {
    const off = await patch(editLink, `/api/v1/capture-links/${link.id}`, { isActive: false }, fixture.a.cookie, {
      id: link.id,
    });
    expect(off.status).toBe(200);
    expect((await send(link.key, { name: 'Omar', phone: '0509990000' })).status).toBe(404);
    expect(await leadsOn('+971509990000')).toHaveLength(0);
  });

  it('answers 404 for another workspace’s key', async () => {
    const other = await post(submit, '/api/v1/public/capture', {
      workspace: fixture.b.slug,
      form: link.key,
      answers: { name: 'Sam', phone: '0508880000' },
    });
    expect(other.status).toBe(404);
  });
});
