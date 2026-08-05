import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { runRetentionCleanup } from '@/lib/jobs/retention';

const body = z.object({
  dryRun: z.boolean().default(true),
}).strict();

export const POST = route(
  { module: 'system', action: 'MANAGE_CONFIGURATION', body, auditEvent: 'RECORD_DELETED' },
  async ({ body }) => {
    return runRetentionCleanup(body.dryRun);
  },
);
