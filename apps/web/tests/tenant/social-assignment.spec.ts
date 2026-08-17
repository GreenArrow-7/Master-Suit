import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { normalizeMetaWebhook } from '@/lib/integrations/meta/events';
import { applySocialComment } from '@/services/social/applySocialComment';
import { escalateSocialSla } from '@/services/social/escalateSocialSla';

/**
 * The rule the whole assignment feature rests on: once a person has chosen an
 * owner, automated reprocessing leaves that choice alone.
 *
 * Provider webhooks are redelivered — Meta retries, and backfills replay. If
 * reprocessing re-ran distribution, a manager's deliberate handover would be
 * silently undone hours later by a retry nobody saw.
 */
const suffix = randomBytes(4).toString('hex');
const commentId = `spec-${suffix}`;
const workspace = { id: '', autoOwner: '', manualOwner: '', enquiryId: '' };

const deliver = async () => {
  const envelope = {
    object: 'instagram',
    entry: [
      {
        id: `page-${suffix}`,
        changes: [
          {
            field: 'comments',
            value: {
              id: commentId,
              text: 'Interested — what is the price and payment plan for the 2BR?',
              timestamp: 1_786_900_000,
              from: { id: `author-${suffix}`, username: 'spec.buyer' },
              media: { id: `media-${suffix}`, media_product_type: 'REELS' },
            },
          },
        ],
      },
    ],
  };
  for (const event of normalizeMetaWebhook(envelope)) {
    if (event.kind === 'SOCIAL_COMMENT_RECEIVED') {
      await applySocialComment({ tenantId: workspace.id, event });
    }
  }
};

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `social-${suffix}`, legalName: `Social ${suffix} LLC`, displayName: `Social ${suffix}` },
  });
  workspace.id = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  const [auto, manual] = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `auto@social-${suffix}.test`,
        fullName: 'Auto Owner',
        roleId: role.id,
        status: 'ACTIVE',
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `manual@social-${suffix}.test`,
        fullName: 'Manual Owner',
        roleId: role.id,
        status: 'ACTIVE',
      },
    }),
  ]);
  workspace.autoOwner = auto.id;
  workspace.manualOwner = manual.id;

  await prisma.distributionRule.create({
    data: {
      tenantId: tenant.id,
      name: `spec-${suffix}`,
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: [auto.id] },
    },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.socialAssignmentHistory.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.socialComment.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.distributionRule.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.user.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.role.deleteMany({ where: { tenantId: workspace.id } });
  await prisma.tenant.delete({ where: { id: workspace.id } });
});

describe('social enquiry assignment', () => {
  it('distributes a high-intent comment to the rotation', async () => {
    await deliver();

    const enquiry = await prisma.socialComment.findFirst({
      where: { tenantId: workspace.id, providerCommentId: commentId },
      select: { id: true, ownerId: true, intent: true, assignmentSource: true },
    });
    workspace.enquiryId = enquiry!.id;

    expect(enquiry!.intent).toBe('HIGH');
    expect(enquiry!.ownerId).toBe(workspace.autoOwner);
    expect(enquiry!.assignmentSource).toBe('GLOBAL_DISTRIBUTION');
  });

  it('keeps a manual owner when the provider redelivers the same comment', async () => {
    await prisma.socialComment.update({
      where: { id: workspace.enquiryId, tenantId: workspace.id },
      data: { ownerId: workspace.manualOwner, assignmentSource: 'MANUAL', assignedAt: new Date() },
    });

    await deliver();

    const enquiry = await prisma.socialComment.findFirst({
      where: { tenantId: workspace.id, id: workspace.enquiryId },
      select: { ownerId: true, assignmentSource: true },
    });
    expect(enquiry!.ownerId).toBe(workspace.manualOwner);
    expect(enquiry!.assignmentSource).toBe('MANUAL');
  });

  it('starts the response clock at the customer comment, not at ingestion', async () => {
    const enquiry = await prisma.socialComment.findFirst({
      where: { tenantId: workspace.id, id: workspace.enquiryId },
      select: { commentCreatedAt: true, slaDueAt: true },
    });
    // The fixture's comment timestamp is well in the past, so a clock started at
    // ingestion would put the deadline ten minutes from *now* instead.
    expect(enquiry!.slaDueAt!.getTime() - enquiry!.commentCreatedAt.getTime()).toBe(10 * 60_000);
    expect(enquiry!.slaDueAt!.getTime()).toBeLessThan(Date.now());
  });

  it('does not restart the clock when the enquiry changes hands', async () => {
    const before = await prisma.socialComment.findFirst({
      where: { tenantId: workspace.id, id: workspace.enquiryId },
      select: { slaDueAt: true },
    });

    await prisma.socialComment.update({
      where: { id: workspace.enquiryId, tenantId: workspace.id },
      data: { ownerId: workspace.autoOwner, assignedAt: new Date() },
    });

    const after = await prisma.socialComment.findFirst({
      where: { tenantId: workspace.id, id: workspace.enquiryId },
      select: { slaDueAt: true },
    });
    expect(after!.slaDueAt!.getTime()).toBe(before!.slaDueAt!.getTime());
  });

  it('escalates a breached high-intent enquiry exactly once', async () => {
    const first = await escalateSocialSla(workspace.id, workspace.enquiryId);
    expect(first).toMatchObject({ escalated: true });

    // A redelivered webhook arms a second job; a retry re-runs the same one.
    const second = await escalateSocialSla(workspace.id, workspace.enquiryId);
    expect(second).toMatchObject({ ignored: 'already-escalated' });
  });

  it('never creates a CRM lead from a comment on its own', async () => {
    // Layer 1 stays Layer 1: a Lead appears only when a person converts one.
    expect(await prisma.lead.count({ where: { tenantId: workspace.id } })).toBe(0);
    expect(await prisma.socialComment.count({ where: { tenantId: workspace.id } })).toBe(1);
  });
});
