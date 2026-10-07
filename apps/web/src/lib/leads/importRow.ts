import { z } from 'zod';

/**
 * One spreadsheet row, as the lead and cold-data imports accept it: the create
 * endpoint's fields, minus anything an import cannot set. Server-only (zod stays
 * out of the browser bundle that `importMapping` is part of).
 */
export const importRow = z
  .object({
    fullName: z.string().min(1).max(160),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(32).optional(),
    company: z.string().max(160).optional(),
    jobTitle: z.string().max(120).optional(),
    city: z.string().max(80).optional(),
    country: z.string().max(80).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
