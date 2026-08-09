/**
 * Referrals.
 *
 * A client gets a code, hands it to somebody, and that somebody becomes a lead
 * the original client is credited for. Issuing the code *is* the referral
 * request — a code that exists is an ask that happened, so there is no separate
 * "asked" row to keep in step.
 *
 * The code is short and typeable rather than a signed token because it gets read
 * aloud and forwarded on WhatsApp. That means it is guessable, which is why
 * redeeming one attributes a lead rather than granting any access: the worst a
 * guessed code achieves is crediting the wrong person for an introduction, which
 * is visible, reversible and audited.
 */
import { randomInt } from 'node:crypto';
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import type { Ctx } from '@/lib/security/rbac';

export const REFERRAL_STATUSES = ['PENDING', 'QUALIFIED', 'CONVERTED', 'REJECTED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const ALLOWED: Record<ReferralStatus, readonly ReferralStatus[]> = {
  PENDING: ['QUALIFIED', 'REJECTED'],
  QUALIFIED: ['CONVERTED', 'REJECTED'],
  CONVERTED: [],
  REJECTED: [],
};

export const canTransition = (from: ReferralStatus, to: ReferralStatus) => ALLOWED[from].includes(to);

/**
 * No vowels, no 0/O, no 1/I/L. Somebody reads this down a phone line and types
 * it on a phone keyboard; an alphabet that cannot produce a confusable pair or
 * an unfortunate word costs nothing and removes a whole class of support call.
 */
const ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 8;

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * A code nobody in this tenant is using.
 *
 * The unique index is the real guard — two agents issuing at the same moment is
 * exactly when a check-then-insert loses — so this only avoids the retry, and
 * the caller still has to survive a collision.
 */
async function freeCode(tx: TxClient, tenantId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const taken = await tx.referralCode.findFirst({ where: { tenantId, code }, select: { id: true } });
    if (!taken) return code;
  }
  // 28^8 is 3.7e11. Five collisions means something is very wrong, and looping
  // forever would turn that into a hung request.
  throw Conflict('Could not allocate a referral code. Try again.');
}

export interface IssueInput {
  ctx: Ctx;
  leadId?: string | null;
  contactId?: string | null;
  expiresAt?: Date;
  maxUses?: number;
}

/** Issuing a code to a client. */
export async function issueCode(input: IssueInput) {
  const { ctx } = input;
  if (!input.leadId && !input.contactId) {
    throw Invalid([{ field: 'leadId', code: 'required', message: 'Say whose code this is.' }]);
  }
  if (input.maxUses !== undefined && input.maxUses < 1) {
    throw Invalid([{ field: 'maxUses', code: 'range', message: 'A code has to be usable at least once.' }]);
  }
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw Invalid([{ field: 'expiresAt', code: 'range', message: 'That expiry has already passed.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const live = await tx.referralCode.findFirst({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        isActive: true,
        ...(input.leadId ? { leadId: input.leadId } : { contactId: input.contactId }),
      },
      select: { id: true, code: true },
    });
    // Two live codes for one person splits their referrals across both and makes
    // "how many did they send us" unanswerable.
    if (live) throw Conflict(`This client already has an active code: ${live.code}.`);

    const code = await tx.referralCode.create({
      data: {
        tenantId: ctx.tenantId,
        code: await freeCode(tx, ctx.tenantId),
        leadId: input.leadId ?? null,
        contactId: input.contactId ?? null,
        issuedById: ctx.actor.id,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'referrals',
        recordId: code.id,
        previousValue: {},
        newValue: { code: code.code, leadId: input.leadId, contactId: input.contactId },
      },
      tx,
    );

    return code;
  });
}

export interface RedeemInput {
  ctx: Ctx;
  code: string;
  referredLeadId: string;
  notes?: string;
}

/**
 * Attributing a new lead to whoever's code they arrived with.
 *
 * The referrer is copied onto the referral rather than read through the code,
 * because a code can later be deactivated or reissued and that must not restate
 * who introduced whom — the same reasoning the commission snapshot uses.
 */
export async function redeemCode(input: RedeemInput) {
  const { ctx } = input;
  const normalized = input.code.trim().toUpperCase();

  return withTx(ctx.tenantId, async (tx) => {
    const code = await tx.referralCode.findFirst({
      where: { tenantId: ctx.tenantId, code: normalized, deletedAt: null },
      include: { _count: { select: { referrals: true } } },
    });
    if (!code) throw NotFound('Referral code');
    if (!code.isActive) throw Conflict('That code is no longer active.');
    if (code.expiresAt && code.expiresAt <= new Date()) throw Conflict('That code has expired.');
    if (code.maxUses !== null && code._count.referrals >= code.maxUses) {
      throw Conflict('That code has been used as many times as it was meant to be.');
    }

    // You cannot refer yourself. The database catches the lead side; the contact
    // side spans tables, so it is checked here.
    if (code.leadId && code.leadId === input.referredLeadId) {
      throw Invalid([{ field: 'referredLeadId', code: 'self', message: 'Nobody refers themselves.' }]);
    }

    const lead = await tx.lead.findFirst({
      where: { id: input.referredLeadId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, convertedContactId: true },
    });
    if (!lead) throw NotFound('Lead');
    if (code.contactId && lead.convertedContactId === code.contactId) {
      throw Invalid([{ field: 'referredLeadId', code: 'self', message: 'Nobody refers themselves.' }]);
    }

    const already = await tx.referral.findFirst({
      where: { tenantId: ctx.tenantId, referredLeadId: input.referredLeadId, deletedAt: null },
      select: { id: true },
    });
    // The unique index refuses this under concurrency; this makes the ordinary
    // case a sentence rather than a 500.
    if (already) throw Conflict('This lead has already been credited to a referrer.');

    const referral = await tx.referral.create({
      data: {
        tenantId: ctx.tenantId,
        codeId: code.id,
        referredLeadId: input.referredLeadId,
        referrerLeadId: code.leadId,
        referrerContactId: code.contactId,
        notes: input.notes,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'referrals',
        recordId: referral.id,
        previousValue: {},
        newValue: { code: normalized, referredLeadId: input.referredLeadId },
      },
      tx,
    );

    return referral;
  });
}

export interface ProgressInput {
  ctx: Ctx;
  referralId: string;
  to: ReferralStatus;
  reason?: string;
}

export async function progressReferral(input: ProgressInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const existing = await tx.referral.findFirst({
      where: { id: input.referralId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!existing) throw NotFound('Referral');

    const from = existing.status as ReferralStatus;
    if (!canTransition(from, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${from.toLowerCase()} referral cannot become ${input.to.toLowerCase()}.`,
        },
      ]);
    }
    if (input.to === 'REJECTED' && !input.reason?.trim()) {
      throw Invalid([{ field: 'reason', code: 'required', message: 'Say why it was rejected.' }]);
    }

    const referral = await tx.referral.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: {
        status: input.to,
        qualifiedAt: input.to === 'QUALIFIED' ? new Date() : undefined,
        convertedAt: input.to === 'CONVERTED' ? new Date() : undefined,
        rejectedAt: input.to === 'REJECTED' ? new Date() : undefined,
        rejectReason: input.to === 'REJECTED' ? input.reason!.trim() : undefined,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'referrals',
        recordId: existing.id,
        previousValue: { status: from },
        newValue: { status: input.to, reason: input.reason },
      },
      tx,
    );

    return { referral, from };
  });
}

export interface DeactivateInput {
  ctx: Ctx;
  codeId: string;
}

/**
 * Retiring a code.
 *
 * The referrals it already produced keep their frozen referrer, so retiring a
 * code settles nothing and un-credits nobody.
 */
export async function deactivateCode(input: DeactivateInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const code = await tx.referralCode.findFirst({
      where: { id: input.codeId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!code) throw NotFound('Referral code');
    await assertRecordVisible(ctx, 'referrals', code, tx, 'EDIT');
    if (!code.isActive) throw Conflict('That code is already inactive.');

    const updated = await tx.referralCode.update({
      where: { id: code.id, tenantId: ctx.tenantId },
      data: { isActive: false },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'referrals',
        recordId: code.id,
        previousValue: { isActive: true },
        newValue: { isActive: false },
      },
      tx,
    );

    return updated;
  });
}

/** How many each client has sent, and how many turned into something. */
export interface ReferrerTally {
  referrerLeadId: string | null;
  referrerContactId: string | null;
  total: number;
  counts: Record<ReferralStatus, number>;
}

export async function referrerScoreboard(tenantId: string, limit = 25): Promise<ReferrerTally[]> {
  const rows = await prisma.referral.groupBy({
    by: ['referrerLeadId', 'referrerContactId', 'status'],
    where: { tenantId, deletedAt: null },
    _count: { _all: true },
  });

  const byReferrer = new Map<string, ReferrerTally>();
  for (const row of rows) {
    const key = `${row.referrerLeadId ?? ''}:${row.referrerContactId ?? ''}`;
    let entry = byReferrer.get(key);
    if (!entry) {
      entry = {
        referrerLeadId: row.referrerLeadId,
        referrerContactId: row.referrerContactId,
        total: 0,
        counts: { PENDING: 0, QUALIFIED: 0, CONVERTED: 0, REJECTED: 0 },
      };
      byReferrer.set(key, entry);
    }
    entry.counts[row.status as ReferralStatus] += row._count._all;
    entry.total += row._count._all;
  }

  return [...byReferrer.values()]
    .sort((a, b) => b.counts.CONVERTED - a.counts.CONVERTED || b.total - a.total)
    .slice(0, limit);
}
