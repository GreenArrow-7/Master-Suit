import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as readProfiles } from '@/app/api/v1/client-profiles/route';
import { grantPermissions, seedHierarchy, type Hierarchy, type Member } from '../helpers/fixtures';
import { get } from '../helpers/request';

/**
 * One buyer's profile, read by lead or contact id, follows the list's rule. It
 * followed none: an agent at OWN scope could quote any id in the workspace and
 * read that buyer's profession, income band, means, nationality and notes.
 * Outside the caller's scope a profile reads exactly like no profile, so the
 * answer cannot say one exists, and a wizard opens on its first step.
 */
let h: Hierarchy;
const contactOf: Record<string, string> = {};
const MISSING = `c${'0'.repeat(24)}`;

const read = (query: string, as: string) => get(readProfiles, `/api/v1/client-profiles?${query}`, as);

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  // The fixture's roles hold only `leads`; the reps' role and the team manager's get profiles at their scope.
  const roleOf = async (m: Member) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId, id: m.id }, select: { roleId: true } })).roleId;
  await grantPermissions(tenantId, await roleOf(h.repA1), [['clientprofiles', 'VIEW']], 'OWN');
  await grantPermissions(tenantId, await roleOf(h.teamManagerA), [['clientprofiles', 'VIEW']], 'TEAM');

  // Each rep has profiled their own buyer, once as a lead and once as a contact.
  for (const rep of [h.repA1, h.repA2, h.repB1]) {
    const contact = await prisma.contact.create({
      data: { tenantId, reference: `CT-${rep.id}`, fullName: 'A buyer', ownerId: rep.id },
    });
    contactOf[rep.id] = contact.id;
    for (const subject of [{ leadId: rep.leadId }, { contactId: contact.id }]) {
      await prisma.clientProfile.create({
        data: { tenantId, ...subject, ownerId: rep.id, profession: 'Surgeon', nationality: 'British' },
      });
    }
  }
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

const SUBJECTS = [
  { name: 'by lead', of: (m: Member) => `leadId=${m.leadId}`, missing: `leadId=${MISSING}` },
  { name: 'by contact', of: (m: Member) => `contactId=${contactOf[m.id]}`, missing: `contactId=${MISSING}` },
];

describe.each(SUBJECTS)('a profile read $name', ({ of, missing }) => {
  it('reads a teammate’s exactly as no profile', async () => {
    const theirs = await read(of(h.repA2), h.repA1.cookie);
    const none = await read(missing, h.repA1.cookie);
    expect(none).toMatchObject({ status: 200, body: { profile: null, completeness: { nextStep: 'identity' } } });
    expect(theirs).toEqual(none);
  });

  it('reads the caller’s own', async () => {
    const res = await read(of(h.repA1), h.repA1.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.profile).toMatchObject({ ownerId: h.repA1.id, profession: 'Surgeon' });
  });

  it('reads a team manager’s team, not another team', async () => {
    expect((await read(of(h.repA2), h.teamManagerA.cookie)).body.profile?.ownerId).toBe(h.repA2.id);
    expect((await read(of(h.repB1), h.teamManagerA.cookie)).body.profile).toBeNull();
  });
});
