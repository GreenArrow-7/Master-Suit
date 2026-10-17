/**
 * A project's payment plan (Lead Eagle audit row M11-02): a name a salesperson
 * reads out — "20/80 post-handover" — and the milestones behind it, each a
 * label and a share of the price, summing to 100.
 *
 * The form types the milestones on one line ("20 On booking, 80 On handover");
 * the API also takes them as a list. Both arrive here, and only a plan whose
 * shares add up to 100 leaves.
 */
import { z } from 'zod';

const milestone = z.object({
  label: z.string().trim().min(1).max(80),
  percent: z.coerce.number().positive().max(100),
});

export type Milestone = z.infer<typeof milestone>;

/** "20 On booking, 80% on handover" → [{ label: 'On booking', percent: 20 }, …]. */
function parseLine(text: string): unknown[] {
  return text
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+(?:\.\d+)?)\s*%?\s*(.*)$/);
      return match ? { percent: match[1], label: match[2] } : { percent: NaN, label: part };
    });
}

export const milestonesInput = z
  .union([z.array(milestone).min(1).max(20), z.string().max(1000)])
  .transform((value, ctx) => {
    const parsed = z
      .array(milestone)
      .min(1)
      .max(20)
      .safeParse(typeof value === 'string' ? parseLine(value) : value);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Write each milestone as a share and a label: "20 On booking, 80 On handover".',
      });
      return z.NEVER;
    }
    const total = parsed.data.reduce((sum, m) => sum + m.percent, 0);
    if (Math.abs(total - 100) > 0.001) {
      ctx.addIssue({ code: 'custom', message: `The milestones add up to ${total}%, not 100%.` });
      return z.NEVER;
    }
    return parsed.data;
  });

export const paymentPlanBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    milestones: milestonesInput,
  })
  .strict();

/** A stored plan's milestones, read defensively: the column is JSON. */
export function readMilestones(value: unknown): Milestone[] {
  const parsed = z.array(milestone).safeParse(value);
  return parsed.success ? parsed.data : [];
}
