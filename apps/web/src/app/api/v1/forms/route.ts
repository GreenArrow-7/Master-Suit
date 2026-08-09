import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';

/**
 * Forms had models, a list page and nothing else — no way to create one, no way
 * to submit one. This creates a lead-capture form with the standard contact
 * fields; the public routes under /api/v1/public/forms make it reachable.
 */
const fieldSpec = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(120),
  type: z.enum(['TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'NUMBER', 'DROPDOWN']),
  isRequired: z.boolean().default(false),
  /** Lead column this answer lands in; unmapped answers stay in the payload. */
  mapsToField: z.enum(['fullName', 'email', 'phone', 'company']).optional(),
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
});

/** The default lead-capture set, used when the caller sends no fields. */
const DEFAULT_FIELDS: z.infer<typeof fieldSpec>[] = [
  { key: 'full_name', label: 'Your name', type: 'TEXT', isRequired: true, mapsToField: 'fullName' },
  { key: 'phone', label: 'Phone (WhatsApp)', type: 'PHONE', isRequired: true, mapsToField: 'phone' },
  { key: 'email', label: 'Email', type: 'EMAIL', isRequired: false, mapsToField: 'email' },
  { key: 'message', label: 'What are you looking for?', type: 'LONG_TEXT', isRequired: false },
];

const createBody = z
  .object({
    name: z.string().min(2).max(160),
    key: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/).optional(),
    successMessage: z.string().max(300).optional(),
    fields: z.array(fieldSpec).min(1).max(30).optional(),
    /** Publish immediately as a public form; DRAFT otherwise. */
    publish: z.boolean().default(false),
  })
  .strict();

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export const POST = route(
  { module: 'forms', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const key = body.key ?? slugify(body.name);
    const exists = await prisma.form.findFirst({ where: { tenantId: ctx.tenantId, key }, select: { id: true } });
    if (exists) throw Conflict('A form with that key already exists.');

    const fields = body.fields ?? DEFAULT_FIELDS;
    // One mapped name field is what turns a submission into a lead; without it
    // every row would be an anonymous payload nobody can follow up.
    if (!fields.some((f) => f.mapsToField === 'fullName')) {
      throw Conflict('At least one field must map to the lead name.');
    }

    const form = await prisma.form.create({
      data: {
        tenantId: ctx.tenantId,
        key,
        name: body.name,
        purpose: 'LEAD_CAPTURE',
        targetObject: 'LEAD',
        state: body.publish ? 'PUBLISHED' : 'DRAFT',
        isPublic: body.publish,
        successMessage: body.successMessage ?? 'Thank you — we will be in touch shortly.',
        createdById: ctx.actor.id,
        fields: {
          create: fields.map((field, index) => ({
            tenantId: ctx.tenantId,
            key: field.key,
            label: field.label,
            type: field.type,
            position: index,
            isRequired: field.isRequired,
            mapsToField: field.mapsToField ?? null,
            options: field.options ?? undefined,
          })),
        },
      },
      select: { id: true, key: true, name: true, state: true, isPublic: true },
    });
    return form;
  },
);
