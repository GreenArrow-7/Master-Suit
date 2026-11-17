/**
 * The pre-call brief: three lines, so nobody opens a call cold.
 *
 * Built from `leadCallContext` — the same assembler the live coach already
 * uses, so the brief and the coaching read the same history rather than two
 * approximations of it.
 *
 * **Two things are deliberately left out.**
 *
 * *The phone number.* `leadCallContext` returns `lead.phone` as stored, because
 * its other caller is a model prompt on the server. A number on a screen has to
 * go through the field-security serialisation (`applyFieldSecurity`,
 * `asLeadPhone`), and a `tel:` link has to be built with `dialable()`, which
 * refuses a mask. Rather than reproduce that here, the brief carries no number
 * at all and its action opens the lead, where both already work correctly.
 *
 * *Property matches.* `context.matches` is assembled for the model and is not
 * filtered to the stock this particular viewer may see, whereas the lead page
 * shows "only a project or listing the caller can see". Rendering them here
 * could show a listing the viewer has no grant for. They are worth having and
 * they need that filter first; this pilot does without them.
 *
 * What is left is the lead's own recorded history, which the viewer owns.
 */
import { leadCallContext } from '@/services/leads/callContext';

export interface Brief {
  /** Two or three short lines. Each states a recorded fact. */
  lines: string[];
  /** Discovery questions from the playbook this lead sells under, if any. */
  questions: string[];
}

const money = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : `${n}`);

/**
 * What to say before dialling this lead, or null when nothing is recorded.
 *
 * Never a sentence about intent. "Asked for 2 bedrooms up to AED 1.8M" is a
 * fact somebody typed; "ready to buy" is an assertion about a person, and
 * nothing in this product may generate one.
 */
export async function precallBrief(tenantId: string, leadId: string): Promise<Brief | null> {
  const context = await leadCallContext(tenantId, leadId).catch(() => null);
  if (!context) return null;

  const lines: string[] = [];

  // 1. Who they are and where they came from.
  const who = [context.lead.stageName, context.lead.source && `from ${context.lead.source}`, context.lead.city]
    .filter(Boolean)
    .join(' · ');
  if (who) lines.push(who);

  // 2. What they asked for — the requirement, as recorded.
  const requirement = context.requirement;
  if (requirement) {
    const budget =
      (requirement.budgetMax ?? requirement.budgetMin)
        ? `${requirement.currency} ${[requirement.budgetMin, requirement.budgetMax]
            .filter((n): n is number => typeof n === 'number')
            .map(money)
            .join('–')}`
        : null;
    const beds =
      (requirement.bedroomsMin ?? requirement.bedroomsMax)
        ? `${[requirement.bedroomsMin, requirement.bedroomsMax].filter((n) => typeof n === 'number').join('–')} bed`
        : null;
    const asked = [requirement.purpose, beds, budget, requirement.propertyTypes.join('/') || null]
      .filter(Boolean)
      .join(', ');
    if (asked) lines.push(`Asked for ${asked}`);
  }

  // 3. What happened last time, including what they objected to.
  const last = context.lastCall;
  if (last?.at) {
    const when = new Date(last.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const objections = last.objections.length ? `objected to ${last.objections.slice(0, 2).join(' and ')}` : null;
    const next = last.nextSteps.length ? `agreed: ${last.nextSteps[0]}` : null;
    lines.push([`Last call ${when}`, objections, next].filter(Boolean).join(' — '));
  } else {
    lines.push('No call recorded yet');
  }

  return { lines, questions: context.playbook?.discoveryQuestions.slice(0, 2) ?? [] };
}
