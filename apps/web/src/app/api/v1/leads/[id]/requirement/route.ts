import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { parseTypedDate } from '@/lib/dates';
import { Invalid } from '@/lib/errors';
import { PROPERTY_TYPES } from '@/lib/inventory/listings';
import { audit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { workspaceTimezone } from '@/services/hr/attendance';
import { openRequirement } from '@/services/leads/requirement';
import { dayBounds } from '@/services/targets/dailyBoard';

const params = z.object({ id: z.string().cuid() });

const count = z.number().int().min(0).max(50).nullish();
const money = z.number().nonnegative().max(1e12).nullish();
const body = z
  .object({
    purpose: z.enum(['BUY', 'RENT']),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(8).default([]),
    subType: z.string().trim().max(80).nullish(),
    bedroomsMin: count,
    bedroomsMax: count,
    budgetMin: money,
    budgetMax: money,
    locations: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    /** A calendar day in the workspace's time zone. */
    possessionBy: z
      .string()
      .refine((day) => parseTypedDate(day) === day, 'Enter a real date as YYYY-MM-DD.')
      .nullish(),
    notes: z.string().trim().max(4000).nullish(),
  })
  .strict();

/**
 * The lead's requirement, from the composer on its Overview (Lead Eagle audit
 * rows M4-05, M4-08): purpose, property type and sub-type, bedrooms, budget in
 * AED, areas and the possession date.
 *
 * Scoped like the lead, not like the Requirements register: whoever may edit
 * the lead may say what its client wants, and a lead out of reach answers 404.
 * The body is the whole requirement, so a field left out is cleared. The open
 * one is edited in place; a different purpose closes it and starts another,
 * as the register's own edit keeps a purpose fixed (requirements/[id]).
 */
export const PUT = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body },
  async ({ ctx, params, body }) => {
    const pairs = [
      ['bedroomsMax', body.bedroomsMin, body.bedroomsMax, 'Bedrooms: the most is below the fewest.'],
      ['budgetMax', body.budgetMin, body.budgetMax, 'The top of the budget is below the bottom.'],
    ] as const;
    for (const [field, low, high, message] of pairs) {
      if (low != null && high != null && low > high) throw Invalid([{ field, code: 'range', message }]);
    }
    const possessionBy = body.possessionBy ? dayBounds(body.possessionBy, await workspaceTimezone(ctx)).to : null;

    return withTx(ctx.tenantId, async (tx) => {
      const lead = await assertLeadInScope(ctx, params.id, tx, 'EDIT');
      const fields = {
        propertyTypes: body.propertyTypes,
        subType: body.subType || null,
        bedroomsMin: body.bedroomsMin ?? null,
        bedroomsMax: body.bedroomsMax ?? null,
        budgetMin: body.budgetMin ?? null,
        budgetMax: body.budgetMax ?? null,
        locations: body.locations,
        possessionBy,
        notes: body.notes || null,
        updatedById: ctx.actor.id,
      };
      const open = await openRequirement(tx, ctx.tenantId, lead.id);
      if (open && open.purpose === body.purpose) {
        const saved = await tx.clientRequirement.update({
          where: { tenantId: ctx.tenantId, id: open.id },
          data: fields,
        });
        await audit(
          ctx,
          { event: 'RECORD_UPDATED', objectType: 'requirement', recordId: saved.id, metadata: { leadId: lead.id } },
          tx,
        );
        return saved;
      }
      if (open) {
        await tx.clientRequirement.update({
          where: { tenantId: ctx.tenantId, id: open.id },
          data: { status: 'CLOSED', updatedById: ctx.actor.id },
        });
        await audit(
          ctx,
          {
            event: 'RECORD_UPDATED',
            objectType: 'requirement',
            recordId: open.id,
            fieldKey: 'status',
            previousValue: open.status,
            newValue: 'CLOSED',
            metadata: { leadId: lead.id },
          },
          tx,
        );
      }
      const saved = await tx.clientRequirement.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          purpose: body.purpose,
          // The agent working the lead works its search.
          ownerId: lead.ownerId,
          createdById: ctx.actor.id,
          ...fields,
        },
      });
      await audit(
        ctx,
        { event: 'RECORD_CREATED', objectType: 'requirement', recordId: saved.id, metadata: { leadId: lead.id } },
        tx,
      );
      return saved;
    });
  },
);
