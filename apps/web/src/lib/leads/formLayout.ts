import { z } from 'zod';

/**
 * The Add lead form as a workspace arranges it (audit M18-04): the order of its
 * fields and which are hidden, stored as `[{ key, hidden }]` on
 * `OrganizationSetting.leadFormLayout`. Full name stays first and shown; the
 * phone and the source cannot be hidden (calling and routing need them). A
 * hidden field also leaves the lead page's Details card. Custom fields keep
 * their own order and switch (Custom Fields) and follow these.
 */
export const LEAD_FORM_FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone', fixed: true },
  { key: 'company', label: 'Company' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'source', label: 'Source', fixed: true },
  { key: 'campaignName', label: 'Campaign' },
  { key: 'tags', label: 'Tags' },
  { key: 'priority', label: 'Priority' },
  // On the lead page only: a lead's numbers beyond the main one.
  { key: 'otherNumbers', label: 'Other numbers (lead page)' },
] as const;

export type LeadFormKey = (typeof LEAD_FORM_FIELDS)[number]['key'];
export interface LayoutField {
  key: LeadFormKey;
  label: string;
  fixed: boolean;
  hidden: boolean;
}

const KEYS = LEAD_FORM_FIELDS.map((field) => field.key) as [LeadFormKey, ...LeadFormKey[]];
export const layoutBody = z
  .object({
    fields: z
      .array(z.object({ key: z.enum(KEYS), hidden: z.boolean() }).strict())
      .max(KEYS.length)
      .refine((rows) => new Set(rows.map((row) => row.key)).size === rows.length, 'A field is listed twice.'),
  })
  .strict();

/** The stored layout made whole: known keys in their stored order, any others after, a fixed one never hidden. */
export function leadFormLayout(stored: unknown): LayoutField[] {
  const rows = (Array.isArray(stored) ? stored : []) as { key?: unknown; hidden?: unknown }[];
  const order = [...new Set(rows.map((row) => row?.key).filter((key) => KEYS.includes(key as LeadFormKey)))];
  const hidden = new Set(rows.filter((row) => row?.hidden === true).map((row) => row.key));
  return [...order, ...KEYS.filter((key) => !order.includes(key))].map((key) => {
    const field = LEAD_FORM_FIELDS.find((f) => f.key === key)!;
    const fixed = 'fixed' in field;
    return { key: field.key, label: field.label, fixed, hidden: !fixed && hidden.has(key) };
  });
}
