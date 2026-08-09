import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';

/**
 * Campaigns could be sent, dialled and reported on, but never created — every
 * sub-route under [id] assumed a row that only the seed could produce. This is
 * the missing front door.
 */
const createBody = z
  .object({
    name: z.string().min(2).max(160),
    /** Short unique handle; derived from the name when omitted. */
    code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i).optional(),
    campaignType: z.string().min(2).max(40).default('OUTBOUND'),
    channel: z.enum(['WHATSAPP', 'VOICE', 'EMAIL', 'SMS']).default('WHATSAPP'),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    budget: z.coerce.number().min(0).optional(),
    expectedLeads: z.coerce.number().int().min(0).optional(),
    /** DRAFT builds quietly; SCHEDULED declares intent to run from startDate. */
    status: z.enum(['DRAFT', 'SCHEDULED']).default('DRAFT'),
  })
  .strict()
  .refine((b) => !(b.startDate && b.endDate) || b.endDate >= b.startDate, {
    message: 'The end date is before the start.',
    path: ['endDate'],
  });

const slug = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

export const POST = route(
  { module: 'campaigns', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const base = body.code?.toUpperCase() ?? slug(body.name);
    // The code is the human handle on reports and the dialer; collide politely
    // rather than 500 on the unique index.
    const taken = await prisma.campaign.findFirst({
      where: { tenantId: ctx.tenantId, code: base },
      select: { id: true },
    });
    if (taken && body.code) throw Conflict('That campaign code is already used.');
    const code = taken ? `${base}-${Date.now().toString(36).toUpperCase().slice(-4)}` : base;

    return prisma.campaign.create({
      data: {
        tenantId: ctx.tenantId,
        name: body.name,
        code,
        campaignType: body.campaignType,
        channel: body.channel,
        status: body.status,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        budget: body.budget ?? null,
        expectedLeads: body.expectedLeads ?? null,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true, name: true, code: true, status: true },
    });
  },
);
