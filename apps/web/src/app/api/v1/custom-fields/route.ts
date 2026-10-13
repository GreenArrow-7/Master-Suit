import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { CUSTOM_FIELD_KEY, CUSTOM_FIELD_TYPES, fieldForScreen, leadFields } from '@/services/leads/customFields';

/**
 * The workspace's custom fields on a lead (Lead Eagle audit row M4-13):
 * Administration → Custom fields. Read under `settings:VIEW`, defined and
 * changed under `settings:MANAGE_CONFIGURATION`, like the source catalogue.
 * The key and the type are fixed once a field exists, because values are
 * stored under the key in the type's form; a field is switched off, never
 * deleted. A key already used answers 409 (the unique index says so).
 */
const label = z.string().trim().min(1).max(60);
const options = z.array(z.string().trim().min(1).max(60)).max(50);
const idQuery = z.object({ id: z.string().cuid() });

/** `Visa status` → `visa_status`. */
const keyFor = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40);

/** A select needs options; anything else has none. Duplicates are dropped. */
function optionsFor(type: string, given: string[] | undefined) {
  const list = [...new Set(given ?? [])];
  if (type === 'DROPDOWN' && list.length === 0) {
    throw Invalid([{ field: 'options', code: 'required', message: 'A select needs at least one option.' }]);
  }
  return type === 'DROPDOWN' ? list : [];
}

export const GET = route({ module: 'settings', productModule: LEAD_MODULES, action: 'VIEW' }, async ({ ctx }) =>
  (await leadFields(prisma, ctx.tenantId)).map(fieldForScreen),
);

const createBody = z
  .object({
    label,
    /** Lower-case letters, digits and _; from the label when left out. */
    key: z
      .string()
      .regex(CUSTOM_FIELD_KEY, 'A key is lower-case letters, digits and _, starting with a letter.')
      .optional(),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: options.optional(),
    isRequired: z.boolean().default(false),
    displayOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((b) => CUSTOM_FIELD_KEY.test(b.key ?? keyFor(b.label)), {
    message: 'Give this field a key: lower-case letters, digits and _.',
    path: ['key'],
  });

export const POST = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const created = await prisma.leadCustomFieldDefinition.create({
      data: {
        tenantId: ctx.tenantId,
        objectType: 'LEAD',
        key: body.key ?? keyFor(body.label),
        label: body.label,
        type: body.type,
        options: optionsFor(body.type, body.options),
        isRequired: body.isRequired,
        displayOrder:
          body.displayOrder ??
          (await prisma.leadCustomFieldDefinition.count({ where: { tenantId: ctx.tenantId, objectType: 'LEAD' } })),
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });
    return fieldForScreen(created);
  },
);

const editBody = z
  .object({
    label: label.optional(),
    options: options.optional(),
    isRequired: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    query: idQuery,
    body: editBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, query, body }) => {
    const field = await prisma.leadCustomFieldDefinition.findFirst({
      where: { tenantId: ctx.tenantId, id: query.id, objectType: 'LEAD' },
    });
    if (!field) throw NotFound('Custom field');
    const { isActive, options: given, ...rest } = body;
    const updated = await prisma.leadCustomFieldDefinition.update({
      where: { tenantId: ctx.tenantId, id: field.id },
      data: {
        ...rest,
        ...(isActive !== undefined && { isHidden: !isActive }),
        ...(given !== undefined && field.type === 'DROPDOWN' && { options: optionsFor(field.type, given) }),
        updatedById: ctx.actor.id,
      },
    });
    return fieldForScreen(updated);
  },
);
