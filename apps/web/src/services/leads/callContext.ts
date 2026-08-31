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
import { parseAmounts } from '@/lib/ai/simulated';
import type { CoachHint } from '@/lib/ai/liveCoach';

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

export interface PlaybookSummary {
  id: string;
  name: string;
  discoveryQuestions: string[];
  approvedClaims: string[];
  objectionGuidance: string | null;
  closingStrategy: string | null;
  complianceNotes: string | null;
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
  /** The buyer-type playbook this lead sells under: tag match first, then the default. */
  playbook: PlaybookSummary | null;
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

/** Tag match first, then the workspace default. First active overlap wins. */
export function pickPlaybook<T extends { leadTags: string[]; isDefault: boolean }>(
  playbooks: readonly T[],
  leadTags: readonly string[],
): T | null {
  const tags = new Set(leadTags.map((t) => t.toLowerCase()));
  return (
    playbooks.find((p) => p.leadTags.some((t) => tags.has(t.toLowerCase()))) ??
    playbooks.find((p) => p.isDefault) ??
    null
  );
}

export async function leadCallContext(tenantId: string, leadId: string): Promise<LeadCallContext | null> {
  const [lead, requirement, lastCall, playbooks] = await Promise.all([
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
        tags: true,
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
    prisma.salesPlaybook.findMany({
      where: { tenantId, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ]);
  if (!lead) return null;

  const playbook = pickPlaybook(playbooks, lead.tags);

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
    playbook: playbook
      ? {
          id: playbook.id,
          name: playbook.name,
          discoveryQuestions: playbook.discoveryQuestions,
          approvedClaims: playbook.approvedClaims,
          objectionGuidance: playbook.objectionGuidance,
          closingStrategy: playbook.closingStrategy,
          complianceNotes: playbook.complianceNotes,
        }
      : null,
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
 * Mid-call re-matching: the customer just stated a budget — is there stock for
 * it, right now? Fired by the live transports when a customer line parses to an
 * amount, so the recommendation lands seconds after the number is spoken
 * instead of on the next call. Deterministic and drawn from the live book only.
 */
export async function budgetMatchHint(tenantId: string, customerLine: string): Promise<CoachHint | null> {
  const amounts = parseAmounts(customerLine).filter((a) => a >= 100_000);
  if (!amounts.length) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);

  const rows = await prisma.listing.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: ['ACTIVE', 'UNDER_OFFER'] },
      listingType: 'SALE',
      // A single stated figure reads as a ceiling with ~10% stretch below it.
      price: { gte: amounts.length > 1 ? min : min * 0.7, lte: max * 1.05 },
    },
    select: { title: true, reference: true, bedrooms: true, price: true, currency: true },
    take: 50,
  });
  if (!rows.length) return null;

  const target = (min + max) / 2;
  const best = rows.reduce((a, b) =>
    Math.abs(Number(a.price) - target) <= Math.abs(Number(b.price) - target) ? a : b,
  );
  return {
    kind: 'TIP',
    text: `In budget right now: ${best.title} (${best.reference}) — ${best.bedrooms ?? '?'}BR at ${fmtMoney(Number(best.price))} ${best.currency}.`,
    say: `"That budget actually works — ${best.title} sits right inside it. Shall I send you the details?"`,
    why: 'Matched against live inventory the moment the budget was stated.',
    source: 'simulated',
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
  const pb = ctx.playbook;
  if (pb) {
    parts.push(
      `PLAYBOOK "${pb.name}" — sell to this buyer type as follows.` +
        (pb.discoveryQuestions.length
          ? ` Discovery questions: ${pb.discoveryQuestions.slice(0, 6).join(' | ')}.`
          : '') +
        (pb.approvedClaims.length
          ? ` APPROVED CLAIMS (assert nothing beyond these): ${pb.approvedClaims.slice(0, 8).join(' | ')}.`
          : '') +
        (pb.objectionGuidance ? ` Objections: ${pb.objectionGuidance.slice(0, 300)}.` : '') +
        (pb.closingStrategy ? ` Closing: ${pb.closingStrategy.slice(0, 300)}.` : '') +
        (pb.complianceNotes ? ` Compliance: ${pb.complianceNotes.slice(0, 300)}.` : ''),
    );
  }
  if (ctx.lastCall?.summary) parts.push(`LAST CALL: ${ctx.lastCall.summary.slice(0, 400)}`);
  if (ctx.lastCall?.objections.length)
    parts.push(`PAST OBJECTIONS: ${ctx.lastCall.objections.join('; ').slice(0, 300)}`);
  if (ctx.matches.length) {
    parts.push(
      `MATCHING INVENTORY (only recommend from this list): ${ctx.matches
        .map((m) => `${m.reference} ${m.title} (${m.bedrooms ?? '?'}BR, ${fmtMoney(m.price)} ${m.currency})`)
        .join('; ')}`,
    );
  }
  return parts.join('\n');
}
