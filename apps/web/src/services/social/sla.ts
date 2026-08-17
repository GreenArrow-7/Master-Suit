/**
 * How fast a social enquiry has to be answered, and whether it is late.
 *
 * Someone who comments "price?" on an Instagram reel is comparing three
 * developers in the same minute. The target is small on purpose, and it is
 * measured from *their* comment, not from anything the desk did afterwards — a
 * reassignment at 10:07 does not buy back the seven minutes since 10:00.
 *
 * The state is derived here rather than stored. A stored state has to be kept
 * true by a background job, and a job that runs late or gets lost leaves a row
 * lying about itself; a deadline and the clock cannot disagree.
 */
import { prisma } from '@/lib/db';
import type { SlaState, SocialIntent, Priority } from '@prisma/client';

/**
 * Defaults, used until a tenant configures otherwise. Ten minutes for a hot
 * enquiry is the number the industry quotes and the one the desk can actually
 * hit; LOW and the non-enquiry intents are owed nothing, so they get no clock
 * rather than a generous one nobody watches.
 */
export const SOCIAL_SLA_DEFAULT_MINUTES: Partial<Record<SocialIntent, number>> = {
  HIGH: 10,
  MEDIUM: 30,
};

/** Social intent is about buying signal; SLA rows are keyed by CRM priority. */
const AS_PRIORITY: Partial<Record<SocialIntent, Priority>> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
};

export interface SocialSlaTarget {
  minutes: number;
  /** How much of the window may pass before the row is flagged AT RISK. */
  warningPct: number;
}

/**
 * The tenant's target for this intent, or null when nothing is owed.
 *
 * Configuration reuses the existing `SLA` table — `firstResponseMins` is
 * literally this question, and a second policy table would mean two places to
 * look when a target is wrong. A workspace that has never opened the SLA screen
 * still gets sensible numbers.
 */
export async function socialSlaTarget(tenantId: string, intent: SocialIntent): Promise<SocialSlaTarget | null> {
  const fallback = SOCIAL_SLA_DEFAULT_MINUTES[intent];
  if (!fallback) return null;

  const priority = AS_PRIORITY[intent];
  const configured = priority
    ? await prisma.sLA.findFirst({
        where: { tenantId, isActive: true, priority },
        orderBy: { updatedAt: 'desc' },
        select: { firstResponseMins: true, warningThresholdPct: true },
      })
    : null;

  return {
    minutes: configured?.firstResponseMins ?? fallback,
    warningPct: configured?.warningThresholdPct ?? 80,
  };
}

/** Everything the state depends on. Loosely typed so callers can pass a `select`. */
export interface SlaSubject {
  commentCreatedAt: Date;
  slaDueAt: Date | null;
  repliedAt: Date | null;
  convertedAt: Date | null;
  status: string;
}

/**
 * MET once somebody answered — replying is the point, and converting is a
 * stronger form of answering. PAUSED when the enquiry was dismissed or marked
 * spam, because a clock on work nobody intends to do is just noise in the
 * numbers. Otherwise it is a straight comparison against the deadline.
 */
export function socialSlaState(subject: SlaSubject, now: Date = new Date(), warningPct = 80): SlaState {
  if (!subject.slaDueAt) return 'ON_TRACK';
  if (subject.repliedAt || subject.convertedAt) return 'MET';
  if (subject.status === 'DISMISSED' || subject.status === 'SPAM') return 'PAUSED';

  const due = subject.slaDueAt.getTime();
  if (now.getTime() >= due) return 'BREACHED';

  /**
   * AT RISK is the whole reason a manager looks at this screen before something
   * goes wrong rather than after. The warning point is a share of the window,
   * so it scales with the target instead of being a fixed number of minutes
   * that means "nearly there" for one tenant and "just started" for another.
   */
  const start = subject.commentCreatedAt.getTime();
  const window = due - start;
  if (window <= 0) return 'BREACHED';
  return now.getTime() - start >= window * (warningPct / 100) ? 'AT_RISK' : 'ON_TRACK';
}

/** How late, or how long left. Negative means overdue. */
export function minutesRemaining(slaDueAt: Date | null, now: Date = new Date()): number | null {
  return slaDueAt ? Math.round((slaDueAt.getTime() - now.getTime()) / 60_000) : null;
}
