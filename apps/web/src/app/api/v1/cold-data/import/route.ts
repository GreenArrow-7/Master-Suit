import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { importRow } from '@/lib/leads/importRow';
import { normalizePhone } from '@/services/leads/normalizePhone';

/**
 * Cold data in (Lead Eagle plan, gap 5): a raw list — an expo's cards, a bought
 * list — lands as records to work, not as leads. The spreadsheet screen is the
 * lead import's, posting the same shape here; the file's name becomes the list.
 * Nothing is matched against leads yet: that happens on conversion, when it
 * decides between a new lead and the one that already exists.
 */
const body = z
  .object({
    rows: z
      .array(z.object({ line: z.number().int().positive(), values: z.record(z.string(), z.unknown()) }))
      .min(1)
      .max(1000),
    fileName: z.string().max(160).optional(),
    onDuplicate: z.enum(['BLOCK', 'WARN']).optional(),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'IMPORT', body, auditEvent: 'IMPORT_STARTED' },
  async ({ ctx, body }) => {
    const batch =
      body.fileName?.replace(/\.(csv|xlsx?)$/i, '').trim() || `Import ${new Date().toISOString().slice(0, 10)}`;
    const failed: { line: number; reason: string }[] = [];
    const data = [];
    for (const { line, values } of body.rows) {
      const parsed = importRow.safeParse(values);
      if (!parsed.success) {
        const first = parsed.error.issues[0]!;
        failed.push({ line, reason: `${first.path.join('.') || 'row'}: ${first.message}` });
        continue;
      }
      const row = parsed.data;
      data.push({
        ...row,
        tenantId: ctx.tenantId,
        phoneNormalized: row.phone ? normalizePhone(row.phone) : null,
        batch,
        createdById: ctx.actor.id,
      });
    }
    const { count } = data.length ? await prisma.dataRecord.createMany({ data }) : { count: 0 };
    return { created: count, failed, batch };
  },
);
