import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

/**
 * A flat for a fixture booking to be a sale *of*.
 *
 * Every confirmed booking names one specific inventory unit, and the database
 * holds writers to that through `Booking_confirmed_requires_unit` — whether the
 * write came through the route or straight from a test. Fixtures that only ever
 * wanted "a confirmed sale, any confirmed sale" still need the unit.
 *
 * Defaults to BOOKED because that is what a unit under a confirmed booking
 * looks like once the confirm path has run; a fixture writing the booking row
 * directly would otherwise leave inventory disagreeing with the ledger in
 * exactly the way these constraints exist to prevent.
 */
export async function fixtureUnit(
  tenantId: string,
  projectId: string,
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'SOLD' | 'BLOCKED' = 'BOOKED',
) {
  return prisma.unitInventory.create({
    data: { tenantId, projectId, unitNumber: `FX-${randomBytes(5).toString('hex')}`, status },
  });
}
