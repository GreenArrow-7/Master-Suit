/**
 * The unit availability state machine.
 *
 * A unit is the thing a booking eventually points at, so the transitions here
 * are the last cheap place to stop two salespeople selling the same flat. The
 * rules are deliberately narrow: anything not listed is refused, including
 * transitions that look harmless (SOLD back to AVAILABLE is a cancellation, and
 * a cancellation is a decision with money attached — M9's problem, not a
 * dropdown).
 */
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { withTx } from '@/lib/db';
import { recalculateProjectRollups } from './rollups';

export const UNIT_STATUSES = ['AVAILABLE', 'HELD', 'BOOKED', 'SOLD', 'BLOCKED'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/**
 * Legal moves.
 *
 * HELD is reachable only from AVAILABLE and expires on its own. BOOKED is
 * reachable from either, because a walk-in buys a flat nobody was holding.
 * Nothing returns from SOLD: reversing a completed sale is a finance operation
 * that has to leave a paper trail, and it will arrive with M9's booking
 * lifecycle rather than as a status dropdown here.
 */
const ALLOWED: Record<UnitStatus, readonly UnitStatus[]> = {
  AVAILABLE: ['HELD', 'BOOKED', 'BLOCKED'],
  HELD: ['AVAILABLE', 'BOOKED', 'BLOCKED'],
  BOOKED: ['SOLD', 'AVAILABLE'],
  SOLD: [],
  BLOCKED: ['AVAILABLE'],
};

export const canTransition = (from: UnitStatus, to: UnitStatus) => ALLOWED[from].includes(to);

/** Default life of a hold when the caller does not name one. */
const DEFAULT_HOLD_HOURS = 48;

export interface MoveUnitInput {
  tenantId: string;
  actorId: string;
  projectId: string;
  unitId: string;
  to: UnitStatus;
  /** Required when moving to BOOKED, so the unit points back at who bought it. */
  leadId?: string;
  holdHours?: number;
}

export async function moveUnit(input: MoveUnitInput) {
  return withTx(input.tenantId, async (tx) => {
    /**
     * Locked for the duration.
     *
     * Two salespeople pressing "hold" on the same unit within the same second
     * is not a hypothetical on a launch day. Without the row lock both read
     * AVAILABLE, both pass the transition check, and the second write wins
     * silently — so the loser walks away believing they hold a unit that
     * someone else is now booking.
     */
    const [current] = await tx.$queryRaw<{ id: string; status: UnitStatus; heldById: string | null }[]>`
      SELECT "id", "status"::text AS status, "heldById"
      FROM "UnitInventory"
      WHERE "id" = ${input.unitId} AND "tenantId" = ${input.tenantId} AND "projectId" = ${input.projectId}
      FOR UPDATE
    `;
    if (!current) throw NotFound('Unit');

    if (current.status === input.to) throw Conflict(`This unit is already ${input.to.toLowerCase()}.`);
    if (!canTransition(current.status, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A unit cannot move from ${current.status.toLowerCase()} to ${input.to.toLowerCase()}.`,
        },
      ]);
    }

    if (input.to === 'BOOKED' && !input.leadId) {
      throw Invalid([{ field: 'leadId', code: 'required', message: 'Booking a unit requires the lead buying it.' }]);
    }

    // Releasing someone else's hold is a supervisor action, not a side effect of
    // clicking the wrong row. Refused here; an admin can BLOCK then release.
    if (
      current.status === 'HELD' &&
      input.to === 'AVAILABLE' &&
      current.heldById &&
      current.heldById !== input.actorId
    ) {
      throw Conflict('This unit is held by someone else. Ask them to release it.');
    }

    const heldUntil =
      input.to === 'HELD' ? new Date(Date.now() + (input.holdHours ?? DEFAULT_HOLD_HOURS) * 3_600_000) : null;

    const unit = await tx.unitInventory.update({
      where: { id: input.unitId, tenantId: input.tenantId },
      data: {
        status: input.to,
        heldById: input.to === 'HELD' ? input.actorId : null,
        heldUntil,
        // Cleared when a unit comes back to the market, so a released unit does
        // not keep pointing at the lead that did not buy it.
        leadId: input.to === 'BOOKED' || input.to === 'SOLD' ? (input.leadId ?? undefined) : null,
        updatedById: input.actorId,
      },
    });

    // Same transaction, deliberately: the catalogue's availability count and the
    // unit's status must never be readable in disagreement.
    await recalculateProjectRollups(tx, input.tenantId, input.projectId);

    return { unit, from: current.status };
  });
}

/**
 * Expired holds return to the market.
 *
 * Called by the caller that notices, rather than by a sweeper: a hold whose
 * clock ran out is only interesting when somebody looks at that project, and a
 * repeatable job over every tenant's inventory to change nothing most of the
 * time is work nobody asked for.
 * ponytail: move to a `maintenance` repeatable job if holds ever need to expire
 * without a reader — for example to trigger a notification.
 */
export async function releaseExpiredHolds(tenantId: string, projectId: string): Promise<number> {
  return withTx(tenantId, async (tx) => {
    const { count } = await tx.unitInventory.updateMany({
      where: { tenantId, projectId, status: 'HELD', heldUntil: { lt: new Date() } },
      data: { status: 'AVAILABLE', heldById: null, heldUntil: null },
    });
    if (count > 0) await recalculateProjectRollups(tx, tenantId, projectId);
    return count;
  });
}
