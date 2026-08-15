import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { enqueue } from '@/lib/queue';
import { nextReference } from '@/services/shared/reference';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { utmFrom } from '@/services/leads/utm';

/**
 * The public face of a lead-capture form. Unauthenticated by design: the
 * workspace slug + form key only reach forms that are PUBLISHED and public, so
 * a guessed key exposes nothing that was not put on the internet on purpose.
 *
 * A submission writes two rows — the FormSubmission as evidence, and the Lead
 * the sales team actually works — then hands the lead to the same distribution
 * and automation queues a manually created lead goes through.
 */
const query = z.object({
  workspace: z.string().min(2).max(64),
  form: z.string().min(2).max(60),
});

async function publicForm(workspaceSlug: string, formKey: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!tenant) throw NotFound('Form');
  const form = await prisma.form.findFirst({
    where: { tenantId: tenant.id, key: formKey, state: 'PUBLISHED', isPublic: true, deletedAt: null },
    include: { fields: { orderBy: { position: 'asc' } } },
  });
  if (!form) throw NotFound('Form');
  return { tenant, form };
}

export const GET = route(
  { module: 'forms', action: 'VIEW', anonymous: true, query, rateLimit: { max: 60, windowSeconds: 60 } },
  async ({ query }) => {
    const { form } = await publicForm(query.workspace, query.form);
    return {
      name: form.name,
      key: form.key,
      successMessage: form.successMessage,
      fields: form.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        isRequired: field.isRequired,
        placeholder: field.placeholder,
        options: field.options,
      })),
    };
  },
);

const submitBody = z
  .object({
    workspace: z.string().min(2).max(64),
    form: z.string().min(2).max(60),
    answers: z.record(z.string(), z.string().max(2000)).refine((a) => Object.keys(a).length <= 40),
  })
  .strict();

export const POST = route(
  { module: 'forms', action: 'CREATE', anonymous: true, body: submitBody, rateLimit: { max: 10, windowSeconds: 60 } },
  async ({ body, req }) => {
    const { tenant, form } = await publicForm(body.workspace, body.form);

    const missing = form.fields.filter((field) => field.isRequired && !body.answers[field.key]?.trim());
    if (missing.length) {
      throw Conflict(`Please fill in: ${missing.map((field) => field.label).join(', ')}.`);
    }

    // Mapped answers become the lead's own columns; everything else rides in
    // the submission payload.
    const mapped: Record<string, string> = {};
    for (const field of form.fields) {
      const answer = body.answers[field.key]?.trim();
      if (field.mapsToField && answer) mapped[field.mapsToField] = answer;
    }
    if (!mapped.fullName) throw Conflict('Please tell us your name.');

    const stage = await prisma.leadStage.findFirst({
      where: { tenantId: tenant.id, isDefault: true },
      select: { id: true },
    });
    if (!stage) throw NotFound('Form');

    const phoneNormalized = mapped.phone ? normalizePhone(mapped.phone, 'AE') : null;

    /**
     * The same duplicate check every other entry point already runs.
     *
     * This endpoint used to call `lead.create` unconditionally, so a customer
     * who enquired twice became two leads with two owners — and the tenant's
     * configured DuplicateRule rows, which the in-app lead form obeys, were
     * simply not consulted on the one channel strangers actually use.
     *
     * An existing match attaches the submission to that lead instead of opening
     * a second one. It deliberately does not answer with a Conflict the way
     * createLead does: this caller is a member of the public, and "that email is
     * already known to us" is an enumeration oracle as well as a dead end for
     * someone simply asking to be contacted.
     */
    const duplicates = await findDuplicates(tenant.id, {
      email: mapped.email ?? null,
      phoneNormalized,
      fullName: mapped.fullName ?? null,
    });
    const existing = duplicates[0];

    const { lead } = await withTx(tenant.id, async (tx) => {
      const lead = existing
        ? { id: existing.id, reference: existing.reference }
        : await tx.lead.create({
            data: {
              tenantId: tenant.id,
              reference: await nextReference(tx, tenant.id, 'LEAD'),
              fullName: mapped.fullName!,
              email: mapped.email ?? null,
              phone: mapped.phone ?? null,
              phoneNormalized,
              company: mapped.company ?? null,
              stageId: stage.id,
              source: 'PUBLIC_FORM',
              sourceDetail: form.key,
              // They wrote to us asking to be contacted; that is implied consent,
              // not granted-in-writing.
              consentStatus: 'IMPLIED',
            },
            select: { id: true, reference: true },
          });
      const submission = await tx.formSubmission.create({
        data: {
          tenantId: tenant.id,
          formId: form.id,
          leadId: lead.id,
          payload: body.answers,
          ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
          referrerUrl: req.headers.get('referer')?.slice(0, 500) ?? null,
          utm: utmFrom(req.headers.get('referer')),
        },
        select: { id: true },
      });
      return { lead, submission };
    });

    // A submission that arrived through a landing page scores on that page's
    // conversion column. The referer names the page; anything else is a direct
    // form link and belongs to no page.
    const referer = req.headers.get('referer') ?? '';
    const viaPage = new RegExp(`/l/${body.workspace}/([a-z0-9-]+)`).exec(referer)?.[1];
    if (viaPage) {
      await prisma.landingPage
        .updateMany({
          where: { tenantId: tenant.id, slug: viaPage, formId: form.id },
          data: { submissionCount: { increment: 1 } },
        })
        .catch(() => {});
    }

    // The same after-commit pipeline a manually created lead gets: an owner via
    // round-robin, and any published automations on LEAD created.
    await Promise.all([
      enqueue('distribution', 'assign-lead', { tenantId: tenant.id, leadId: lead.id }),
      enqueue('automation', 'trigger', {
        tenantId: tenant.id,
        event: 'record.created',
        object: 'LEAD',
        recordId: lead.id,
      }),
    ]);

    return { ok: true, message: form.successMessage ?? 'Thank you — we will be in touch shortly.' };
  },
);
