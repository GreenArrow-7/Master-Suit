import { prisma } from '@/lib/db';

/**
 * A call that reached, or tried to reach, the lead: dialled by us (not only
 * booked, not called off), or answered. A missed call from the lead is not
 * contact. The first-contact backfill (migration 20261015100000_lead_dashboard)
 * reads calls the same way.
 */
export const reachedOut = (call: { status: string; direction: string }) =>
  call.status !== 'SCHEDULED' &&
  call.status !== 'CANCELLED' &&
  (call.direction === 'OUTBOUND' || call.status === 'IN_PROGRESS' || call.status === 'COMPLETED');

/** An activity of this type records something and contacts nobody: intake's "Enquiry via …", an import's remarks. */
export const NOTE_ACTIVITY = 'note';

/**
 * `Lead.lastActivityAt` is what "has this lead been worked?" reads — the untouched
 * count on Productivity, the work-gated check-out, the grid column. Nothing wrote
 * it until 19 Sep 2026, so every lead read as untouched forever. Every place a
 * person works a lead — logging an activity, placing or finishing a call — calls
 * this; a missing lead id is a no-op so callers need no branching.
 *
 * A touch that `contacted` the lead (a call placed or answered, an activity that
 * is not a note) is also when it was first contacted (`firstContactedAt`): the
 * SLA's first-contact check, the board's Untouched tile and its "worked" days
 * read it. Booking a call or writing a note is not contact. The earliest
 * contact wins, so a call logged late for an earlier hour moves it back and a
 * later one leaves it.
 */
export async function touchLead(
  tenantId: string,
  leadId: string | null | undefined,
  at: Date = new Date(),
  contacted = true,
) {
  if (!leadId) return;
  await prisma.lead.updateMany({ where: { tenantId, id: leadId, deletedAt: null }, data: { lastActivityAt: at } });
  if (!contacted) return;
  await prisma.lead.updateMany({
    where: {
      tenantId,
      id: leadId,
      deletedAt: null,
      OR: [{ firstContactedAt: null }, { firstContactedAt: { gt: at } }],
    },
    data: { firstContactedAt: at },
  });
}
