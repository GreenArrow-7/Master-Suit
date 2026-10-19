import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { logLeadCall } from '@/services/leads/logCall';

/** The phone app's outcomes, as the call log's own. */
const OUTCOMES = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  SWITCHED_OFF: 'Switched off',
  CALLBACK_REQUESTED: 'Call back later',
  WRONG_NUMBER: 'Wrong number',
  NOT_INTERESTED: 'Not interested',
} as const;

/** A phone's clock runs a little fast: two minutes ahead is the same moment, more is a wrong clock. */
const CLOCK_SKEW_MS = 2 * 60_000;
/** The web call log's window: a call is logged within a week of when it happened. */
const OLDEST_MS = 7 * 86_400_000;

const params = z.object({ leadId: z.string().cuid() });
const body = z
  .object({
    outcome: z.enum(Object.keys(OUTCOMES) as [keyof typeof OUTCOMES, ...(keyof typeof OUTCOMES)[]]),
    note: z.string().trim().max(2000).nullish(),
    durationSecs: z.number().int().min(0).max(21_600).nullish(),
    followUpAt: z.string().datetime({ offset: true }).nullish(),
    followUpNote: z.string().trim().max(500).nullish(),
    /**
     * When the call happened, stamped on the phone when it was made: a day of
     * calls sent from a basement at six must not all read six o'clock. Not
     * ahead of now, nor older than a week.
     */
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .refine((at) => Date.parse(at) <= Date.now() + CLOCK_SKEW_MS, 'A call cannot be logged ahead of now.')
      .refine((at) => Date.parse(at) >= Date.now() - OLDEST_MS, 'A call is logged within a week of when it happened.')
      .nullish(),
  })
  .strict();

/**
 * Log a call from the phone: the web call log (`logLeadCall`), the same
 * activity, score, follow-up and audit rows, under the lead's own `leads:EDIT`
 * scope. A send repeated with its Idempotency-Key is answered from the first.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', mobile: true, params, body },
  async ({ ctx, params, body }) => {
    const result = await logLeadCall(ctx, params.leadId, {
      outcome: OUTCOMES[body.outcome],
      notes: body.note || undefined,
      durationSecs: body.durationSecs ?? undefined,
      dueAt: body.followUpAt ? new Date(body.followUpAt) : null,
      followUpNote: body.followUpNote || undefined,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
    return { ok: true, leadId: params.leadId, ...result };
  },
);
