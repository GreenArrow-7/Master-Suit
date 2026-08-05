import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { loadFieldRules, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { createLead } from '@/services/leads/createLead';

/** Mirrors the create endpoint's accepted fields, minus anything an import cannot set. */
const importRow = z.object({
  fullName: z.string().min(1).max(160),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(32).optional(),
  company: z.string().max(160).optional(),
  jobTitle: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  source: z.string().max(60).optional(),
  notes: z.string().max(5000).optional(),
}).strict();

const body = z.object({
  /** 1-based line numbers from the source file, so failures point at the user's row. */
  rows: z.array(z.object({ line: z.number().int().positive(), values: z.record(z.string(), z.unknown()) })).min(1).max(1000),
}).strict();

/**
 * Bulk lead import. Each row goes through the same `createLead` service the form and
 * the single-record endpoint use, so scoring, deduplication, distribution and audit
 * behave identically — an imported lead is not a second-class lead.
 *
 * Rows are independent: one bad row is reported and skipped rather than failing the
 * batch, because a 900-row file with three typos should still land 897 leads.
 */
export const POST = route(
  { module: 'leads', action: 'IMPORT', body, auditEvent: 'IMPORT_STARTED' },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const failed: { line: number; reason: string }[] = [];
    let created = 0;

    for (const { line, values } of body.rows) {
      const parsed = importRow.safeParse(values);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        failed.push({ line, reason: `${first.path.join('.') || 'row'}: ${first.message}` });
        continue;
      }

      try {
        await createLead(ctx, stripUneditableFields(rules, parsed.data) as typeof parsed.data);
        created += 1;
      } catch (err: any) {
        failed.push({ line, reason: String(err?.message ?? 'could not be created').slice(0, 200) });
      }
    }

    return { created, failed };
  },
);
