import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { assertAnyModuleEntitlement, LEAD_MODULES } from '@/lib/security/entitlements';
import { takeEnquiry } from '@/services/leads/intake';
import { leadSourceIdFor } from '@/services/leads/leadSources';
import { utmFrom } from '@/services/leads/utm';

/**
 * The public face of a lead-capture form. Unauthenticated by design: the
 * workspace slug + form key only reach forms that are PUBLISHED and public, of
 * a workspace that still owns a lead module, so a guessed key exposes nothing
 * that was not put on the internet on purpose.
 *
 * A submission becomes a lead through the same intake the portals and QR codes
 * use (`takeEnquiry`): attached to the lead that already holds the number or
 * email, audited, on the first-contact clock, handed to distribution and the
 * automations. The FormSubmission row is kept beside it as evidence.
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
  // A workspace whose lead module has lapsed has no public form: nobody there
  // could open the lead it would make.
  await assertAnyModuleEntitlement(tenant.id, LEAD_MODULES).catch(() => {
    throw NotFound('Form');
  });
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
    /** The landing page the form was filled in on, when it was one. */
    page: z.string().min(2).max(60).optional(),
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

    // Mapped answers become the lead's own columns; the rest go on the timeline
    // note, as a portal enquiry's details do. All of them stay in the submission.
    // Contact details never go on the note, which nobody masks: another number
    // joins the lead's numbers, another address stays in the submission.
    const mapped: Record<string, string> = {};
    const phones: string[] = [];
    const details: string[] = [];
    for (const field of form.fields) {
      const answer = body.answers[field.key]?.trim();
      if (!answer) continue;
      if (field.mapsToField) mapped[field.mapsToField] = answer;
      else if (field.type === 'PHONE') phones.push(answer);
      else if (field.type !== 'EMAIL') details.push(`${field.label}: ${answer}`);
    }
    if (!mapped.fullName) throw Conflict('Please tell us your name.');

    // Filled in on one of the workspace's landing pages: that page's lead, and
    // its conversion. A page the form is not on is a plain form submission.
    const page = body.page
      ? await prisma.landingPage.findFirst({
          where: { tenantId: tenant.id, slug: body.page, formId: form.id, state: 'PUBLISHED', deletedAt: null },
          select: { id: true, slug: true, name: true },
        })
      : null;

    // Form and landing-page leads both count under the workspace's Website entry (M4-03).
    const sourceId = await leadSourceIdFor(prisma, tenant.id, 'website');
    const result = await takeEnquiry(
      tenant.id,
      {
        fullName: mapped.fullName,
        email: mapped.email?.toLowerCase() ?? null,
        phones: mapped.phone ? [mapped.phone, ...phones] : phones,
        company: mapped.company ?? null,
        message: null,
        reference: null,
        details,
      },
      page
        ? {
            label: `Landing page: ${page.name}`,
            source: 'LANDING_PAGE',
            sourceDetail: `landing:${page.slug}`,
            sourceId,
          }
        : { label: `Website form: ${form.name}`, source: 'PUBLIC_FORM', sourceDetail: form.key, sourceId },
    );
    if ('skipped' in result) throw Conflict('Please tell us your name.');

    await prisma.formSubmission.create({
      data: {
        tenantId: tenant.id,
        formId: form.id,
        leadId: result.leadId,
        payload: body.answers,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
        referrerUrl: req.headers.get('referer')?.slice(0, 500) ?? null,
        utm: utmFrom(req.headers.get('referer')),
      },
      select: { id: true },
    });
    if (page) {
      // A lost increment is not worth a failed submission.
      await prisma.landingPage
        .update({ where: { tenantId: tenant.id, id: page.id }, data: { submissionCount: { increment: 1 } } })
        .catch(() => {});
    }

    return { ok: true, message: form.successMessage ?? 'Thank you — we will be in touch shortly.' };
  },
);
