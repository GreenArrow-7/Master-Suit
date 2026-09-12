import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Verified money against a booking's agency fee, for fixtures that need a
 * commission to be collectable and are not testing the receipt path itself.
 *
 * Written straight to the table, so the database's own checks apply: a
 * positive amount, evidence, and a verifier who is not the recorder. Two ids
 * are therefore required — there is no fixture shortcut around the two-person
 * rule, on purpose.
 */
export async function coverAgencyFee(input: {
  tenantId: string;
  bookingId: string;
  recordedById: string;
  verifiedById: string;
  /** Defaults to the booking's agencyFee, i.e. exactly covered. */
  amount?: Prisma.Decimal | number | string;
}) {
  const booking = await prisma.booking.findFirstOrThrow({
    where: { id: input.bookingId, tenantId: input.tenantId },
    select: { agencyFee: true, currency: true },
  });
  const amount = new Prisma.Decimal(input.amount ?? booking.agencyFee ?? 0);
  const tag = randomBytes(4).toString('hex');
  return prisma.agencyFeeReceipt.create({
    data: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      reference: `RCT-FX-${tag}`,
      kind: 'RECEIPT',
      status: 'VERIFIED',
      amount,
      currency: booking.currency,
      paidAt: new Date(),
      paymentReference: `FIXTURE-${tag}`,
      providerTransactionRef: `provider-${tag}`,
      recordedById: input.recordedById,
      verifiedById: input.verifiedById,
      verifiedAt: new Date(),
    },
  });
}
