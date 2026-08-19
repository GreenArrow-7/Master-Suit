import { prisma } from '@/lib/db';

export interface DuplicateMatch {
  id: string;
  reference: string;
  fullName: string;
  matchedOn: string;
  confidence: number;
}

export interface DuplicateProbe {
  email?: string | null;
  phoneNormalized?: string | null;
  fullName?: string | null;
  excludeId?: string;
}

/**
 * Runs the tenant's configured DuplicateRule rows in priority order and returns
 * every match, highest confidence first. Deliberately searches across the whole
 * tenant rather than the actor's visibility scope: a rep must be told a lead is a
 * duplicate even when the existing record belongs to another team. The response
 * carries only reference and name, never the other record's contact details.
 *
 * Takes a tenantId rather than a Ctx because the public form endpoint is
 * anonymous and has no actor, and a website enquiry needs this check most of
 * all — it was the one path creating a fresh lead for every repeat visitor.
 * Nothing here ever read anything else off the context.
 */
export async function findDuplicates(tenantId: string, probe: DuplicateProbe): Promise<DuplicateMatch[]> {
  const rules = await prisma.duplicateRule.findMany({
    where: { tenantId, objectType: 'LEAD', isActive: true },
    orderBy: { position: 'asc' },
  });

  const active = rules.length ? rules : DEFAULT_RULES;
  const found = new Map<string, DuplicateMatch>();

  for (const rule of active) {
    const where = buildWhere(rule.matchFields, probe);
    if (!where) continue;

    const rows = await prisma.lead.findMany({
      where: {
        tenantId,
        isMerged: false,
        ...(probe.excludeId ? { NOT: { id: probe.excludeId } } : {}),
        ...where,
      },
      select: { id: true, reference: true, fullName: true },
      take: 5,
    });

    for (const row of rows) {
      if (found.has(row.id)) continue;
      found.set(row.id, {
        ...row,
        matchedOn: rule.matchFields.join(' + '),
        confidence: CONFIDENCE[rule.matchFields.join('+')] ?? 0.6,
      });
    }
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

function buildWhere(fields: string[], probe: DuplicateProbe): Record<string, unknown> | null {
  const clauses: Record<string, unknown>[] = [];

  for (const field of fields) {
    switch (field) {
      case 'email':
        if (!probe.email) return null;
        clauses.push({ email: probe.email.toLowerCase() });
        break;
      case 'phone':
      case 'phoneNormalized':
        if (!probe.phoneNormalized) return null;
        clauses.push({ phoneNormalized: probe.phoneNormalized });
        break;
      case 'fullName':
        if (!probe.fullName) return null;
        clauses.push({ fullName: { equals: probe.fullName, mode: 'insensitive' } });
        break;
      default:
        return null;
    }
  }

  return clauses.length ? { AND: clauses } : null;
}

const CONFIDENCE: Record<string, number> = {
  'email+phoneNormalized': 0.99,
  email: 0.95,
  phoneNormalized: 0.9,
  'fullName+phoneNormalized': 0.85,
  fullName: 0.4,
};

/** Used until an administrator configures rules in Administration → Duplicates. */
const DEFAULT_RULES = [
  { matchFields: ['email'], position: 0 },
  { matchFields: ['phoneNormalized'], position: 1 },
  { matchFields: ['fullName', 'phoneNormalized'], position: 2 },
] as any[];
