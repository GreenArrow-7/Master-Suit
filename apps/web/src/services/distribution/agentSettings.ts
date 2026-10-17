import { z } from 'zod';
import { prisma } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';

/**
 * A person's lead work, as Admin → Users → the account sets it (audit M1-12,
 * M7-04, M7-06, M7-07): who they report to, their daily lead quota, the
 * languages they sell in, and whether they take new leads. Assignment
 * (`eligibility.ts`, `assignLead.ts`) and the reporting line (`managedUserIds`)
 * already read every one of these; nothing in the app wrote them.
 *
 * The form sends the whole set, so a field left out is cleared: no manager, no
 * quota (no limit), no languages.
 */
export const leadSettingsBody = z
  .object({
    userId: z.string().min(1).max(64),
    managerId: z.string().max(64).optional(),
    dailyLeadQuota: z.coerce.number().int().min(0).max(1000).optional(),
    /** "Arabic, English" as typed, or a list. */
    languages: z.union([z.string().max(300), z.array(z.string().max(40)).max(12)]).optional(),
    available: z.enum(['yes', 'no']).default('yes'),
  })
  .strict();

/** Trimmed, blanks dropped, one of each whatever its case, twelve at most. */
export function languageList(raw: string | string[] | undefined): string[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : (raw ?? '').split(','))
    .map((language) => language.trim().slice(0, 40))
    .filter((language) => language && !seen.has(language.toLowerCase()) && seen.add(language.toLowerCase()))
    .slice(0, 12);
}

export async function setLeadSettings(ctx: Ctx, input: z.infer<typeof leadSettingsBody>) {
  const { tenantId } = ctx;
  // The rank rule every account action keeps (services/identity/accounts.ts): only
  // someone strictly below you, never yourself — a reporting line is visibility,
  // and nobody hands themselves a senior's records by naming themselves manager.
  const target = await prisma.user.findFirst({
    where: { tenantId, id: input.userId, deletedAt: null },
    select: { id: true, role: { select: { rank: true } } },
  });
  if (!target) throw NotFound('User');
  if (target.id === ctx.actor.id) throw Forbidden('Use your own profile to change your own account.');
  if (target.role.rank <= ctx.actor.roleRank) {
    throw Forbidden('You cannot administer an account at or above your own level.');
  }

  const managerId = input.managerId || null;
  if (managerId) {
    if (managerId === input.userId) throw Conflict('Someone cannot report to themselves.');
    const manager = await prisma.user.findFirst({
      where: { tenantId, id: managerId, deletedAt: null },
      select: { managerId: true },
    });
    if (!manager) throw NotFound('Manager');
    // Up from the proposed manager: reaching this person would close the line into a loop.
    const visited = new Set<string>();
    for (let cursor = manager.managerId; cursor && !visited.has(cursor);) {
      if (cursor === input.userId) throw Conflict('That would create a reporting loop.');
      visited.add(cursor);
      const next: { managerId: string | null } | null = await prisma.user.findFirst({
        where: { tenantId, id: cursor },
        select: { managerId: true },
      });
      cursor = next?.managerId ?? null;
    }
  }

  const data = {
    managerId,
    dailyLeadQuota: input.dailyLeadQuota ?? null,
    languages: languageList(input.languages),
    isAvailable: input.available === 'yes',
  };
  const { count } = await prisma.user.updateMany({ where: { tenantId, id: input.userId, deletedAt: null }, data });
  if (!count) throw NotFound('User');
  await audit(ctx, { event: 'RECORD_UPDATED', objectType: 'user', recordId: input.userId, newValue: data });
  return { userId: input.userId, ...data };
}

/** The one setting a person changes for themselves: whether new leads come to them. */
export async function setOwnAvailability(ctx: Ctx, isAvailable: boolean) {
  await prisma.user.updateMany({ where: { tenantId: ctx.tenantId, id: ctx.actor.id }, data: { isAvailable } });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'user',
    recordId: ctx.actor.id,
    fieldKey: 'isAvailable',
    newValue: isAvailable,
  });
  return { isAvailable };
}
