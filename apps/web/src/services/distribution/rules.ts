import { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertAssignableUser } from '@/lib/security/record-scope';

/**
 * Automatic assignment rules (audit M7-01, M18-05). The engine
 * (services/distribution/assignLead.ts) uses the first active round-robin rule
 * by position, so that is the only method offered here.
 */
export const ruleBody = z
  .object({
    name: z.string().min(2).max(120),
    isActive: z.boolean().optional(),
    everyone: z.boolean().optional(),
    userIds: z.array(z.string().min(1)).max(200).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    /** Uneven shares (audit M7-02): {userId: 1..10}; anyone not named takes one turn a round. */
    weights: z.record(z.string().min(1), z.number().int().min(1).max(10)).optional(),
    reassignAfterMins: z.number().int().min(5).max(10_080).nullable().optional(),
    escalateAfterMins: z.number().int().min(5).max(10_080).nullable().optional(),
    /** Route only leads that match (audit M7-03); empty lists match everything. */
    conditions: z
      .object({
        sourceIds: z.array(z.string().min(1)).max(100).optional(),
        cities: z.array(z.string().min(1).max(80)).max(100).optional(),
        projectIds: z.array(z.string().min(1)).max(100).optional(),
        /** Leads tagged with one of these, for people who speak it (audit M7-04). */
        languages: z.array(z.string().min(1).max(40)).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const RULE_FIELDS = {
  id: true,
  name: true,
  isActive: true,
  position: true,
  candidatePool: true,
  weights: true,
  reassignAfterMins: true,
  escalateAfterMins: true,
  conditions: true,
  updatedAt: true,
} as const;

/** A pool names only people the caller may hand work to. */
export async function poolOf(ctx: Parameters<typeof assertAssignableUser>[0], body: z.infer<typeof ruleBody>) {
  if (body.everyone) return { everyone: true };
  for (const id of body.userIds ?? []) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', id);
  return { userIds: body.userIds ?? [] };
}
