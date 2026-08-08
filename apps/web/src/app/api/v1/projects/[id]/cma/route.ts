import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { Prisma } from '@prisma/client';

const params = z.object({ id: z.string().cuid() });

/**
 * Comparative market analysis: where this project sits against its own
 * micromarket.
 *
 * Deliberately one query and a page section, not a report builder. What a
 * salesperson is asked on a call is "why is this more expensive than the one
 * down the road", and the answer is a rate, a median, and five named
 * comparables. A configurable report generator answers that question no better
 * and is a great deal more to own.
 *
 * Comparables are the nearest projects *by price per square foot* within the
 * same micromarket — not the geographically nearest, which in a dense market is
 * usually the same developer's other tower and tells the buyer nothing.
 *
 * Projects with no recorded rate are excluded rather than counted as zero. A
 * pre-launch with no plans yet would otherwise drag the median down and make
 * every priced project look overpriced.
 */
export const GET = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        pricePerSqft: true,
        currency: true,
        micromarketId: true,
        micromarket: { select: { name: true, city: true } },
      },
    });
    if (!project) throw NotFound('Project');

    if (!project.micromarketId) {
      return { project, comparables: [], stats: null, note: 'This project has no micromarket, so it has no peer set.' };
    }

    const peers = await prisma.project.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        micromarketId: project.micromarketId,
        id: { not: project.id },
        pricePerSqft: { not: null },
      },
      select: {
        id: true,
        name: true,
        pricePerSqft: true,
        currency: true,
        minPrice: true,
        maxPrice: true,
        possessionStatus: true,
        availableUnits: true,
        developer: { select: { name: true } },
      },
      // Bounded: a micromarket with 4 000 towers does not make a better
      // comparison than one with 200, and the median is stable long before that.
      take: 200,
    });

    const rates = peers.map((p) => p.pricePerSqft!).sort((a, b) => a.comparedTo(b));
    const stats = rates.length
      ? {
          count: rates.length,
          median: rates[Math.floor(rates.length / 2)],
          low: rates[0],
          high: rates[rates.length - 1],
          currency: project.currency,
          /** How far above or below the median this project sits, in percent. */
          deltaPct:
            project.pricePerSqft && !rates[Math.floor(rates.length / 2)].isZero()
              ? project.pricePerSqft
                  .minus(rates[Math.floor(rates.length / 2)])
                  .div(rates[Math.floor(rates.length / 2)])
                  .times(100)
                  .toDecimalPlaces(1)
              : null,
        }
      : null;

    // Nearest by rate. Sorted in memory because the ordering key is a distance
    // from a value, which no index can serve.
    const comparables = project.pricePerSqft
      ? peers
          .map((p) => ({ ...p, gap: p.pricePerSqft!.minus(project.pricePerSqft!).abs() }))
          .sort((a, b) => a.gap.comparedTo(b.gap))
          .slice(0, 5)
      : peers.slice(0, 5).map((p) => ({ ...p, gap: new Prisma.Decimal(0) }));

    return { project, stats, comparables };
  },
);
