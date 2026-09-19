import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { CLOSE_OUT_STATUSES, closeOutLead } from '@/services/leads/closeOut';

const params = z.object({ id: z.string().cuid() });
const body = z
  .object({
    status: z.enum([...CLOSE_OUT_STATUSES, 'OPEN']),
    /** Only read for DUPLICATE: the record this one repeats. */
    duplicateOfId: z.string().cuid().nullable().optional(),
  })
  .strict();

/**
 * Mark a lead invalid, duplicate or archived — or reopen it. Needs `leads:EDIT`,
 * not `leads:DELETE`: this is the alternative offered to everyone who is not
 * allowed to delete.
 */
export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const lead = await closeOutLead(ctx, params.id, body);
    return { id: lead.id, status: lead.status, duplicateOfId: lead.duplicateOfId };
  },
);
