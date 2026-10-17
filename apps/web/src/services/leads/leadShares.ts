import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { AppError, Conflict, NotFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { agencyOf, PUBLIC_LISTING, publicListing, SHOWABLE } from '@/lib/proposals/publicProposal';
import { publicLink } from '@/lib/publicLink';
import { redis } from '@/lib/redis';
import { audit } from '@/lib/security/audit';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { can, type Ctx } from '@/lib/security/rbac';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { todayKey } from '@/services/targets/dailyBoard';
import { LEAD_SENSITIVE_FIELDS } from './createLead';
import { recipientOf } from './leadMessages';

/**
 * A project or a listing shared with a lead (Lead Eagle audit row M4-30): a
 * public page, `/s/{token}`, showing what an advert would, that tells the
 * agent when the client opened it. The token is signed and carries the tenant
 * (lib/publicLink.ts), so the page reads it scoped like any other request; it
 * names one LeadShare row, which ties the opening to the lead and lets the link
 * lapse (`expiresAt`) or be revoked.
 */
export const shareLink = publicLink('lead-share', 's');

/** How long a link works unless the sharer says otherwise. */
export const SHARE_DAYS = 30;
const DAY_MS = 86_400_000;

const targetFields = z.object({ projectId: z.string().cuid().optional(), listingId: z.string().cuid().optional() });
const oneTarget = (t: { projectId?: string; listingId?: string }) => Boolean(t.projectId) !== Boolean(t.listingId);
const oneTargetIssue = { message: 'Name one project or one listing.', path: ['projectId'] };

/** One project or one listing, as a lead's interest links and shares name them. */
export const leadTarget = targetFields.strict().refine(oneTarget, oneTargetIssue);
export type LeadTarget = z.infer<typeof leadTarget>;

/** A share: its target, and how many days it works (`SHARE_DAYS` unless given). */
export const shareRequest = targetFields
  .extend({ days: z.number().int().min(1).max(90).optional() })
  .strict()
  .refine(oneTarget, oneTargetIssue);

/**
 * A project or listing the caller can see: the workspace's own, live, with
 * `projects:VIEW` or `listings:VIEW`. Anything else answers 404, as a missing
 * one does. `onMarket`: whether it may be shown to a client (a listing for sale
 * or rent, a project the desk may pitch).
 */
export async function assertLeadTarget(ctx: Ctx, tx: TxClient, t: LeadTarget) {
  if (t.projectId) {
    const found =
      can(ctx, 'projects', 'VIEW') &&
      (await tx.project.findFirst({ where: { tenantId: ctx.tenantId, id: t.projectId, deletedAt: null } }));
    if (!found) throw NotFound('Project');
    return { kind: 'project', name: found.name, onMarket: found.isPitchable } as const;
  }
  const found =
    can(ctx, 'listings', 'VIEW') &&
    (await tx.listing.findFirst({ where: { tenantId: ctx.tenantId, id: t.listingId!, deletedAt: null } }));
  if (!found) throw NotFound('Listing');
  return { kind: 'listing', name: found.title, onMarket: SHOWABLE.includes(found.status) } as const;
}

/**
 * A link for the lead, audited and on its timeline as the sharer's (M10-09);
 * `leads:EDIT` on the lead (404 outside it) and stock the sharer sees.
 * `whatsapp`: wa.me with the link written, to the number a send would take
 * (main first), where the sharer reads the lead's number and the lead may be
 * messaged on WhatsApp; else null.
 */
export async function createShare(ctx: Ctx, leadId: string, target: LeadTarget, days = SHARE_DAYS) {
  const rules = await loadFieldRules(ctx, 'LEAD');
  return withTx(ctx.tenantId, async (tx) => {
    const lead = await assertLeadInScope(ctx, leadId, tx, 'EDIT');
    const found = await assertLeadTarget(ctx, tx, target);
    if (!found.onMarket) {
      throw Conflict(
        found.kind === 'listing' ? 'That listing is not on the market.' : 'That project is not offered to clients.',
      );
    }
    const share = await tx.leadShare.create({
      data: {
        tenantId: ctx.tenantId,
        leadId: lead.id,
        ...target,
        createdById: ctx.actor.id,
        expiresAt: new Date(Date.now() + days * DAY_MS),
      },
      select: { id: true, expiresAt: true },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'lead-share',
        recordId: share.id,
        metadata: { leadId: lead.id, ...target, name: found.name },
      },
      tx,
    );
    const type = await tx.activityType.upsert({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: 'link_shared' } },
      update: {},
      // Inactive: logged by the share, never by hand from the lead page.
      create: {
        tenantId: ctx.tenantId,
        key: 'link_shared',
        name: 'Property shared',
        direction: 'OUTBOUND',
        icon: 'link',
        isActive: false,
      },
      select: { id: true },
    });
    await tx.activity.create({
      data: {
        tenantId: ctx.tenantId,
        typeId: type.id,
        leadId: lead.id,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        notes: `${found.kind === 'listing' ? 'Listing' : 'Project'}: ${found.name}`,
      },
    });

    const url = shareLink.url(ctx.tenantId, share.id);
    let number: string | null = null;
    if (seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS)) {
      const phones = await tx.leadPhone.findMany({
        where: { tenantId: ctx.tenantId, leadId: lead.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, normalized: true, isWhatsapp: true },
      });
      try {
        number = recipientOf({ ...lead, phones }, 'WHATSAPP');
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
      }
    }
    const firstName = lead.firstName?.trim() || lead.fullName.split(/\s+/)[0] || lead.fullName;
    const text = `Hi ${firstName}, here are the details of ${found.name}: ${url}`;
    return {
      id: share.id,
      kind: found.kind,
      title: found.name,
      url,
      expiresAt: share.expiresAt,
      whatsapp: number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null,
    };
  });
}

/** Stops a link at once, audited; the page then answers 404 like any other. */
export async function revokeShare(ctx: Ctx, leadId: string, shareId: string) {
  return withTx(ctx.tenantId, async (tx) => {
    await assertLeadInScope(ctx, leadId, tx, 'EDIT');
    const share = await tx.leadShare.findFirst({
      where: { tenantId: ctx.tenantId, id: shareId, leadId },
      select: { id: true, revokedAt: true },
    });
    if (!share) throw NotFound('Shared link');
    if (!share.revokedAt) {
      await tx.leadShare.update({ where: { tenantId: ctx.tenantId, id: share.id }, data: { revokedAt: new Date() } });
      await audit(
        ctx,
        {
          event: 'RECORD_UPDATED',
          objectType: 'lead-share',
          recordId: share.id,
          metadata: { leadId, action: 'revoked' },
        },
        tx,
      );
    }
    return { id: share.id, revoked: true };
  });
}

/** The lead's links, newest first, for its page: what, how often opened, until when. */
export async function leadShares(tenantId: string, leadId: string) {
  const rows = await prisma.leadShare.findMany({
    where: { tenantId, leadId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      viewCount: true,
      lastViewedAt: true,
      project: { select: { name: true } },
      listing: { select: { title: true } },
    },
  });
  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    title: row.listing?.title ?? row.project?.name ?? 'A removed property',
    kind: row.listing ? ('listing' as const) : ('project' as const),
    url: shareLink.url(tenantId, row.id),
    views: row.viewCount,
    lastViewedAt: row.lastViewedAt,
    expiresAt: row.expiresAt,
    live: !row.revokedAt && row.expiresAt > now,
  }));
}

const POSSESSION: Readonly<Record<string, string>> = {
  READY_TO_MOVE: 'Ready to move in',
  UNDER_CONSTRUCTION: 'Under construction',
  NEW_LAUNCH: 'New launch',
};

/**
 * What a share token opens, or 404 alike for a bad signature, an unknown,
 * revoked or lapsed link, a deleted lead, stock off the market, and a
 * workspace with no lead module left: telling them apart would tell a
 * stranger holding a link which of them it is.
 */
export async function loadShare(token: string, now = new Date()) {
  const claim = shareLink.verify(token);
  if (!claim) throw NotFound('Page');
  const { tenantId } = claim;
  await assertAnyModuleEntitlement(tenantId, LEAD_MODULES).catch(() => {
    throw NotFound('Page');
  });
  return withTx(tenantId, async (tx) => {
    const [workspace, share] = await Promise.all([
      tx.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE', deletedAt: null }, select: { timezone: true } }),
      tx.leadShare.findFirst({
        where: {
          tenantId,
          id: claim.recordId,
          revokedAt: null,
          expiresAt: { gt: now },
          lead: { deletedAt: null },
        },
        select: {
          id: true,
          leadId: true,
          createdById: true,
          listing: { select: PUBLIC_LISTING },
          project: {
            select: {
              name: true,
              description: true,
              possessionStatus: true,
              possessionAt: true,
              minPrice: true,
              currency: true,
              unitTypes: true,
              highlights: true,
              reraNumber: true,
              isPitchable: true,
              deletedAt: true,
              developer: { select: { name: true } },
              micromarket: { select: { name: true, city: true } },
            },
          },
        },
      }),
    ]);
    if (!workspace || !share) throw NotFound('Page');
    const { listing, project } = share;
    if (listing && (listing.deletedAt || !SHOWABLE.includes(listing.status))) throw NotFound('Page');
    if (project && (project.deletedAt || !project.isPitchable)) throw NotFound('Page');
    const timeZone = workspace.timezone || 'Asia/Dubai';
    const agent = share.createdById
      ? await tx.user.findFirst({
          where: { tenantId, id: share.createdById, deletedAt: null },
          select: { fullName: true, displayName: true, email: true, phone: true },
        })
      : null;

    return {
      shareId: share.id,
      tenantId,
      leadId: share.leadId,
      timeZone,
      agency: await agencyOf(tx, tenantId),
      agent: agent ? { name: agent.displayName || agent.fullName, email: agent.email, phone: agent.phone } : null,
      listing: listing ? publicListing(tenantId, listing) : null,
      project: project
        ? {
            name: project.name,
            developer: project.developer?.name ?? null,
            community: project.micromarket ? `${project.micromarket.name}, ${project.micromarket.city}` : null,
            fromPrice: project.minPrice
              ? `${project.currency} ${Number(project.minPrice).toLocaleString('en-GB')}`
              : null,
            possession: POSSESSION[project.possessionStatus] ?? null,
            handover: project.possessionAt
              ? new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone }).format(
                  project.possessionAt,
                )
              : null,
            unitTypes: project.unitTypes,
            highlights: project.highlights,
            description: project.description,
            reraNumber: project.reraNumber,
          }
        : null,
    };
  });
}

export type PublicShare = Awaited<ReturnType<typeof loadShare>>;

/** However many visitors a link has in a day, at most this many openings of it go on the lead's timeline. */
export const LOGGED_PER_DAY = 3;

/**
 * An opening (api/v1/public/share-view, called by the page's script): counted
 * on the link every time, and logged on the lead's timeline once per visitor
 * per day (the workspace's day), at most `LOGGED_PER_DAY` a day per link. A
 * visitor is a hash of their address and browser, kept two days in Redis and
 * nowhere else; the activity names the property, not who opened it. Audited
 * as the system: nobody in the workspace did it. Its activity type is
 * inactive, so nobody logs one by hand from the lead page.
 */
export async function recordShareView(share: PublicShare, visitor: string, now = new Date()) {
  const what = share.listing ? `Listing: ${share.listing.title}` : `Project: ${share.project?.name}`;
  const seen = createHash('sha256').update(visitor).digest('hex').slice(0, 32);
  const day = `share-view:${share.shareId}:${todayKey(share.timeZone, now)}`;
  // Redis away: log it rather than lose it; a second entry is the lesser harm.
  const unavailable = (err: Error) => {
    logger.warn({ err: err.message, shareId: share.shareId }, 'share view dedupe unavailable');
    return true;
  };
  const first = await redis.set(`${day}:${seen}`, '1', 'EX', 2 * 86_400, 'NX').then((ok) => ok === 'OK', unavailable);
  // A new browser string is a new visitor: the day's cap keeps that from filling the timeline.
  const logs =
    first &&
    (await redis
      .multi()
      .incr(day)
      .expire(day, 2 * 86_400)
      .exec()
      .then((replies) => Number(replies?.[0]?.[1] ?? 0) <= LOGGED_PER_DAY, unavailable));
  await withTx(share.tenantId, async (tx) => {
    await tx.leadShare.updateMany({
      where: { tenantId: share.tenantId, id: share.shareId },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    });
    if (!logs) return;
    const type = await tx.activityType.upsert({
      where: { tenantId_key: { tenantId: share.tenantId, key: 'link_view' } },
      update: {},
      create: {
        tenantId: share.tenantId,
        key: 'link_view',
        name: 'Shared link opened',
        direction: 'INBOUND',
        icon: 'link',
        isActive: false,
      },
      select: { id: true },
    });
    const activity = await tx.activity.create({
      data: { tenantId: share.tenantId, typeId: type.id, leadId: share.leadId, occurredAt: now, notes: what },
      select: { id: true },
    });
    await audit(
      { tenantId: share.tenantId, source: 'shared-link' },
      {
        event: 'RECORD_CREATED',
        objectType: 'activity',
        recordId: activity.id,
        metadata: { leadId: share.leadId, shareId: share.shareId },
      },
      tx,
    );
  });
}
