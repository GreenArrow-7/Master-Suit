/**
 * LeadContextService: everything the live-call surface — and the AI coaching it
 * — should know about the person before the first word is spoken.
 *
 * One read, assembled server-side: the lead, their open requirement, how the
 * last conversation ended, and which live stock answers the requirement. The
 * property matches come from the same predicate the Requirements module uses
 * (`matchesForRequirement`), so the coach can never recommend inventory the
 * CRM would not — recommendations are drawn from the book, never invented.
 */
import { prisma } from '@/lib/db';
import { matchesForRequirement } from '@/services/inventory/demand';

export interface PropertyMatch {
  id: string;
  reference: string;
  title: string;
  propertyType: string;
  bedrooms: number | null;
  price: number;
  currency: string;
  micromarket: string | null;
  /** Spec'd behaviour: every recommendation says why it matches. */
  whyMatch: string[];
}

export interface RequirementSummary {
  id: string;
  purpose: string;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  propertyTypes: string[];
  possessionBy: string | null;
  notes: string | null;
}

export interface LeadCallContext {
  lead: {
    id: string;
    fullName: string;
    phone: string | null;
    company: string | null;
    city: string | null;
    source: string;
    score: number;
    stageName: string | null;
    notes: string | null;
  };
  requirement: RequirementSummary | null;
  lastCall: {
    at: string | null;
    summary: string | null;
    objections: string[];
    nextSteps: string[];
  } | null;
  matches: PropertyMatch[];
}

const fmtMoney = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : `${n}`);

export async function leadCallContext(tenantId: string, leadId: string): Promise<LeadCallContext | null> {
  const [lead, requirement, lastCall] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        company: true,
        city: true,
        source: true,
        score: true,
        notes: true,
        stage: { select: { name: true } },
      },
    }),
    prisma.clientRequirement.findFirst({
      where: { tenantId, leadId, deletedAt: null, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.call.findFirst({
      where: { tenantId, leadId, status: 'COMPLETED', deletedAt: null },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true, analysis: { select: { summary: true, objections: true, nextSteps: true } } },
    }),
  ]);
  if (!lead) return null;

  let matches: PropertyMatch[] = [];
  if (requirement) {
    const result = await matchesForRequirement(tenantId, requirement.id, 3);
    matches = (result?.matches ?? []).map((m) => {
      const price = Number(m.price);
      const why: string[] = [];
      if (requirement.budgetMin != null || requirement.budgetMax != null) {
        const lo = requirement.budgetMin != null ? Number(requirement.budgetMin) : null;
        const hi = requirement.budgetMax != null ? Number(requirement.budgetMax) : null;
        why.push(
          `Within the stated ${lo != null ? fmtMoney(lo) : ''}${lo != null && hi != null ? '–' : ''}${hi != null ? fmtMoney(hi) : '+'} ${requirement.currency} budget`,
        );
      }
      if (
        m.bedrooms != null &&
        (requirement.bedroomsMin != null || requirement.bedroomsMax != null) &&
        (requirement.bedroomsMin == null || m.bedrooms >= requirement.bedroomsMin) &&
        (requirement.bedroomsMax == null || m.bedrooms <= requirement.bedroomsMax)
      ) {
        why.push(`${m.bedrooms} bedrooms, as requested`);
      }
      if (requirement.propertyTypes.includes(m.propertyType)) why.push(`Requested property type`);
      if (m.micromarket && requirement.micromarketIds.includes(m.micromarket.id)) {
        why.push(`In ${m.micromarket.name} — a stated preference`);
      }
      return {
        id: m.id,
        reference: m.reference,
        title: m.title,
        propertyType: m.propertyType,
        bedrooms: m.bedrooms,
        price,
        currency: m.currency,
        micromarket: m.micromarket?.name ?? null,
        whyMatch: why,
      };
    });
  }

  return {
    lead: {
      id: lead.id,
      fullName: lead.fullName,
      phone: lead.phone,
      company: lead.company,
      city: lead.city,
      source: lead.source,
      score: lead.score,
      stageName: lead.stage?.name ?? null,
      notes: lead.notes,
    },
    requirement: requirement
      ? {
          id: requirement.id,
          purpose: requirement.purpose,
          budgetMin: requirement.budgetMin != null ? Number(requirement.budgetMin) : null,
          budgetMax: requirement.budgetMax != null ? Number(requirement.budgetMax) : null,
          currency: requirement.currency,
          bedroomsMin: requirement.bedroomsMin,
          bedroomsMax: requirement.bedroomsMax,
          propertyTypes: requirement.propertyTypes,
          possessionBy: requirement.possessionBy?.toISOString() ?? null,
          notes: requirement.notes,
        }
      : null,
    lastCall: lastCall
      ? {
          at: lastCall.endedAt?.toISOString() ?? null,
          summary: lastCall.analysis?.summary ?? null,
          objections: (lastCall.analysis?.objections as string[] | undefined) ?? [],
          nextSteps: (lastCall.analysis?.nextSteps as string[] | undefined) ?? [],
        }
      : null,
    matches,
  };
}

/**
 * The compact text block the live coach prompt carries. Deliberately short —
 * this is resent on every coach tick, and the spec's latency budget is seconds.
 */
export function contextPromptBlock(ctx: LeadCallContext): string {
  const parts: string[] = [
    `LEAD: ${ctx.lead.fullName}${ctx.lead.stageName ? `, stage ${ctx.lead.stageName}` : ''}, score ${ctx.lead.score}, source ${ctx.lead.source}`,
  ];
  const r = ctx.requirement;
  if (r) {
    const budget =
      r.budgetMin != null || r.budgetMax != null
        ? ` budget ${r.budgetMin ?? '?'}-${r.budgetMax ?? '?'} ${r.currency},`
        : '';
    const beds =
      r.bedroomsMin != null || r.bedroomsMax != null ? ` ${r.bedroomsMin ?? '?'}-${r.bedroomsMax ?? '?'}BR,` : '';
    parts.push(
      `KNOWN REQUIREMENT: ${r.purpose},${budget}${beds}${r.propertyTypes.length ? ` types ${r.propertyTypes.join('/')}` : ''}`.replace(
        /,$/,
        '',
      ),
    );
  }
  if (ctx.lastCall?.summary) parts.push(`LAST CALL: ${ctx.lastCall.summary.slice(0, 400)}`);
  if (ctx.lastCall?.objections.length) parts.push(`PAST OBJECTIONS: ${ctx.lastCall.objections.join('; ').slice(0, 300)}`);
  if (ctx.matches.length) {
    parts.push(
      `MATCHING INVENTORY (only recommend from this list): ${ctx.matches
        .map((m) => `${m.reference} ${m.title} (${m.bedrooms ?? '?'}BR, ${fmtMoney(m.price)} ${m.currency})`)
        .join('; ')}`,
    );
  }
  return parts.join('\n');
}
