import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { AppError, Conflict } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { loadFieldRules, seesField, stripUneditableFields, type FieldRule } from '@/lib/security/fieldSecurity';
import { createLead, LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { updateLead } from '@/services/leads/updateLead';
import { importRow } from '@/lib/leads/importRow';

const body = z
  .object({
    /** 1-based line numbers from the source file, so failures point at the user's row. */
    rows: z
      .array(z.object({ line: z.number().int().positive(), values: z.record(z.string(), z.unknown()) }))
      .min(1)
      .max(1000),
    /** Shown as the lead's source detail, e.g. the spreadsheet's file name. */
    fileName: z.string().max(160).optional(),
    /**
     * A row that matches an existing lead: BLOCK skips it, WARN imports it
     * anyway, UPDATE fills that lead in from the row's non-empty values (M4-41).
     */
    onDuplicate: z.enum(['BLOCK', 'WARN', 'UPDATE']).default('BLOCK'),
    /** Run every row, then roll it all back: the commit's report, with nothing saved (M4-42). */
    dryRun: z.boolean().default(false),
  })
  .strict();
type Body = z.infer<typeof body>;

/** What became of the rows: `failed` is every refused row, `duplicates` how many of them a lead already had. */
interface Report {
  dryRun: boolean;
  created: number;
  updated: number;
  duplicates: number;
  failed: { line: number; reason: string }[];
}

/**
 * Bulk lead import. Each row goes through the same `createLead` service the form and
 * the single-record endpoint use, so scoring, deduplication, distribution and audit
 * behave identically — an imported lead is not a second-class lead. A row UPDATE
 * matches goes through `updateLead`, as an edit on the lead page does.
 *
 * Rows are independent: one bad row is reported and skipped rather than failing the
 * batch, because a 900-row file with three typos should still land 897 leads.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'IMPORT', body },
  async ({ ctx, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    if (body.dryRun) return rehearse(ctx, (tx) => importRows(ctx, rules, body, tx));

    const report = await importRows(ctx, rules, body);
    // Here rather than as the route's `auditEvent`, which a dry run would write too.
    await audit(ctx, {
      event: 'IMPORT_STARTED',
      objectType: 'leads',
      metadata: {
        method: 'POST',
        path: '/api/v1/leads/import',
        onDuplicate: body.onDuplicate,
        created: report.created,
        updated: report.updated,
        failed: report.failed.length,
      },
    });
    return report;
  },
);

/** Thrown to roll the dry run's transaction back, carrying its report out. */
class Rehearsed extends Error {
  constructor(readonly report: Report) {
    super('dry run');
  }
}

/**
 * The import inside one transaction that is always rolled back. Later rows see
 * what earlier ones wrote, as on the commit, so a number repeated further down
 * the file reports what the commit will do with it.
 * ponytail: the leads UPDATE matches stay locked until the run ends (seconds for
 * a 500-row batch); run it per row if an edit of one ever waits on it.
 */
function rehearse(ctx: Ctx, run: (tx: TxClient) => Promise<Report>): Promise<Report> {
  return withTx(
    ctx.tenantId,
    async (tx) => {
      throw new Rehearsed(await run(tx));
    },
    { timeout: 120_000 },
  ).catch((err: unknown) => {
    if (err instanceof Rehearsed) return err.report;
    throw err;
  });
}

async function importRows(ctx: Ctx, rules: Map<string, FieldRule>, body: Body, dryRun?: TxClient): Promise<Report> {
  const db = dryRun ?? prisma;
  const report: Report = { dryRun: !!dryRun, created: 0, updated: 0, duplicates: 0, failed: [] };
  let noteType: { id: string } | null = null;

  for (const { line, values } of body.rows) {
    const parsed = importRow.safeParse(values);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      report.failed.push({ line, reason: `${first.path.join('.') || 'row'}: ${first.message}` });
      continue;
    }

    try {
      const outcome = await oneRow(dryRun, async () => {
        const { notes, ...fields } = parsed.data;
        const safe = stripUneditableFields(rules, fields) as typeof fields;
        const [match] =
          body.onDuplicate === 'UPDATE'
            ? await findDuplicates(
                ctx.tenantId,
                {
                  email: safe.email,
                  phoneNormalized: safe.phone ? normalizePhone(safe.phone) : null,
                  fullName: safe.fullName,
                },
                db,
              )
            : [];
        const leadId = match
          ? await fillIn(ctx, rules, match, safe, dryRun)
          : (
              await createLead(
                ctx,
                {
                  ...safe,
                  source: 'IMPORT',
                  sourceDetail: body.fileName,
                  onDuplicate: body.onDuplicate === 'WARN' ? 'WARN' : 'BLOCK',
                },
                { dryRun },
              )
            ).id;
        // Lead has no notes column; the spreadsheet's remarks and unmapped columns
        // become an activity on the lead so they show in the timeline.
        if (notes) {
          noteType ??= await db.activityType.upsert({
            where: { tenantId_key: { tenantId: ctx.tenantId, key: 'note' } },
            update: {},
            create: { tenantId: ctx.tenantId, key: 'note', name: 'Note', icon: 'note' },
            select: { id: true },
          });
          await db.activity.create({
            data: {
              tenantId: ctx.tenantId,
              typeId: noteType.id,
              leadId,
              ownerId: ctx.actor.id,
              createdById: ctx.actor.id,
              source: 'IMPORT',
              notes,
            },
          });
        }
        return match ? 'updated' : 'created';
      });
      report[outcome] += 1;
    } catch (err) {
      if (err instanceof AppError && err.status === 409) report.duplicates += 1;
      report.failed.push({ line, reason: String((err as Error)?.message ?? 'could not be created').slice(0, 200) });
    }
  }
  return report;
}

/**
 * One row. In the dry run, behind a savepoint: a row the database refuses
 * aborts only itself, as its own transaction does on the commit, rather than
 * every row after it.
 */
async function oneRow<T>(dryRun: TxClient | undefined, fn: () => Promise<T>): Promise<T> {
  if (!dryRun) return fn();
  await dryRun.$executeRawUnsafe('SAVEPOINT import_row');
  try {
    const out = await fn();
    await dryRun.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
    return out;
  } catch (err) {
    await dryRun.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
    throw err;
  }
}

/**
 * UPDATE (M4-41): the row's values onto the lead it matched, through
 * `updateLead`, so the edit is scoped, checked for duplicates and audited as on
 * the lead page. Only the values the row has, so nothing is blanked; a phone or
 * email this role sees masked stays as it is (the PATCH route's rule). A match
 * outside the importer's EDIT scope is reported as the duplicate it is.
 */
async function fillIn(
  ctx: Ctx,
  rules: Map<string, FieldRule>,
  match: { id: string; reference: string; matchedOn: string },
  fields: Record<string, string | undefined>,
  dryRun?: TxClient,
): Promise<string> {
  const patch = Object.fromEntries(
    Object.entries(fields).filter(
      ([field, value]) =>
        value?.trim() &&
        (!['phone', 'email'].includes(field) || seesField(ctx, 'LEAD', rules, field, LEAD_SENSITIVE_FIELDS)),
    ),
  );
  try {
    return (await updateLead(ctx, match.id, patch, { dryRun })).id;
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      throw Conflict(`A lead with this ${match.matchedOn} already exists (${match.reference}).`);
    }
    throw err;
  }
}
