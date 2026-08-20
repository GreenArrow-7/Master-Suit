import { prisma } from '@/lib/db';
import { can, type Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';

/**
 * The CRM tool layer the assistant model calls.
 *
 * Every executor runs the caller's own permission context: `can()` gates the
 * module, `visibilityWhere()` scopes rows exactly as the list pages do, and
 * results are capped small. The model never touches the database — it sees
 * only what these functions return, which is only what the signed-in user may
 * see. Write-style tools never write: they return a `proposedAction` that the
 * UI must confirm, and the confirmation goes through the existing REST
 * endpoints with all their own checks.
 */

export interface ToolSource {
  label: string;
  /** Module-relative href, e.g. /leads/abc — the widget renders it via SalesLink. */
  href: string;
}

export interface ProposedAction {
  kind: 'follow_up' | 'task' | 'opportunity_stage';
  label: string;
  /** Request the widget sends on Confirm. */
  method: 'POST' | 'PATCH';
  endpoint: string;
  payload: Record<string, unknown>;
}

export interface ToolResult {
  data: unknown;
  sources?: ToolSource[];
  proposedAction?: ProposedAction;
}

type Exec = (ctx: Ctx, args: Record<string, any>) => Promise<ToolResult>;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // Gemini functionDeclaration parameters (OpenAPI subset)
  execute: Exec;
}

const denied = (what: string): ToolResult => ({ data: { error: `You do not have permission to view ${what}.` } });

const str = { type: 'string' as const };
const num = { type: 'number' as const };

const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : null);

const leadBrief = (l: any) => ({
  id: l.id,
  reference: l.reference,
  name: l.fullName,
  company: l.company,
  phone: l.phone,
  email: l.email,
  stage: l.stage?.name ?? null,
  score: l.score,
  priority: l.priority,
  sla: l.slaState,
  owner: l.owner?.fullName ?? null,
  nextFollowUpAt: fmtDate(l.nextFollowUpAt),
  lastActivityAt: fmtDate(l.lastActivityAt),
});

const LEAD_SELECT = {
  id: true,
  reference: true,
  fullName: true,
  company: true,
  phone: true,
  email: true,
  score: true,
  priority: true,
  slaState: true,
  nextFollowUpAt: true,
  lastActivityAt: true,
  stage: { select: { name: true } },
  owner: { select: { fullName: true } },
} as const;

/** Resolve a lead by id or (partial) name within the caller's visibility. */
async function findLead(ctx: Ctx, args: { leadId?: string; name?: string }) {
  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  if (args.leadId) {
    return prisma.lead.findFirst({ where: { ...scope, id: args.leadId }, select: LEAD_SELECT });
  }
  if (!args.name) return null;
  return prisma.lead.findFirst({
    where: { ...scope, fullName: { contains: args.name, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
    select: LEAD_SELECT,
  });
}

export const TOOLS: ToolDef[] = [
  {
    name: 'searchLeads',
    description:
      'Search leads the user may see. Filters: q (name/company/email/phone), view (mine | unassigned | overdue_followup | sla_breached | sla_at_risk | high_priority | high_score | no_activity_30d | converted), stage (stage name), ownerName. Returns up to `limit` (default 8) compact leads.',
    parameters: {
      type: 'object',
      properties: { q: str, view: str, stage: str, ownerName: str, limit: num },
    },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('leads');
      const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
      const where: Record<string, unknown> = { ...scope };
      const now = new Date();
      switch (args.view) {
        case 'mine':
          where.ownerId = ctx.actor.id;
          break;
        case 'unassigned':
          where.ownerId = null;
          break;
        case 'overdue_followup':
          where.nextFollowUpAt = { lt: now };
          break;
        case 'sla_breached':
          where.slaState = 'BREACHED';
          break;
        case 'sla_at_risk':
          where.slaState = 'AT_RISK';
          break;
        case 'high_priority':
          where.priority = { in: ['HIGH', 'URGENT'] };
          break;
        case 'high_score':
          where.score = { gte: 70 };
          break;
        case 'no_activity_30d':
          where.OR = [
            { lastActivityAt: { lt: new Date(now.getTime() - 30 * 864e5) } },
            { lastActivityAt: null, createdAt: { lt: new Date(now.getTime() - 30 * 864e5) } },
          ];
          break;
        case 'converted':
          where.stage = { category: 'CONVERSION' };
          break;
      }
      if (args.q) {
        where.OR = [
          { fullName: { contains: args.q, mode: 'insensitive' } },
          { company: { contains: args.q, mode: 'insensitive' } },
          { email: { contains: args.q, mode: 'insensitive' } },
          { phone: { contains: args.q } },
        ];
      }
      if (args.stage) where.stage = { name: { contains: args.stage, mode: 'insensitive' } };
      if (args.ownerName) where.owner = { fullName: { contains: args.ownerName, mode: 'insensitive' } };

      const limit = Math.min(Number(args.limit) || 8, 15);
      const rows = await prisma.lead.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
        select: LEAD_SELECT,
      });
      return {
        data: { count: rows.length, capped: rows.length === limit, leads: rows.map(leadBrief) },
        sources: rows.slice(0, 6).map((l) => ({ label: `Lead · ${l.fullName}`, href: `/leads/${l.id}` })),
      };
    },
  },

  {
    name: 'getLead',
    description: 'Fetch one lead by leadId or by (partial) name, with profile, stage, owner and SLA.',
    parameters: { type: 'object', properties: { leadId: str, name: str } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('leads');
      const lead = await findLead(ctx, args);
      if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
      return {
        data: leadBrief(lead),
        sources: [{ label: `Lead · ${lead.fullName}`, href: `/leads/${lead.id}` }],
      };
    },
  },

  {
    name: 'getLeadTimeline',
    description:
      'Chronological history for a lead (activities, calls, tasks, follow-ups) over the last `days` (default 30), newest first.',
    parameters: { type: 'object', properties: { leadId: str, name: str, days: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('leads');
      const lead = await findLead(ctx, args);
      if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
      const since = new Date(Date.now() - Math.min(Number(args.days) || 30, 365) * 864e5);
      const [activities, calls, tasks, followUps] = await Promise.all([
        prisma.activity.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null, occurredAt: { gte: since } },
          orderBy: { occurredAt: 'desc' },
          take: 15,
          select: { occurredAt: true, outcome: true, notes: true, type: { select: { name: true } } },
        }),
        prisma.call.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, createdAt: true, startedAt: true, status: true, outcome: true, durationSecs: true },
        }),
        prisma.task.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null },
          orderBy: { dueAt: 'desc' },
          take: 10,
          select: { title: true, dueAt: true, status: true, priority: true },
        }),
        prisma.followUpTask.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null },
          orderBy: { dueAt: 'desc' },
          take: 10,
          select: { title: true, dueAt: true, status: true },
        }),
      ]);
      const events = [
        ...activities.map((a) => ({ at: a.occurredAt, kind: a.type.name, detail: a.outcome ?? a.notes ?? '' })),
        ...calls.map((c) => ({
          at: c.startedAt ?? c.createdAt,
          kind: `Call (${c.status.toLowerCase()})`,
          detail: `${c.outcome?.toLowerCase().replace(/_/g, ' ') ?? ''}${c.durationSecs ? ` · ${Math.round(c.durationSecs / 60)}m` : ''}`,
        })),
        ...tasks.map((t) => ({ at: t.dueAt, kind: `Task (${t.status.toLowerCase()})`, detail: t.title })),
        ...followUps.map((f) => ({ at: f.dueAt, kind: `Follow-up (${f.status.toLowerCase()})`, detail: f.title })),
      ]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 30)
        .map((e) => ({ at: fmtDate(e.at), kind: e.kind, detail: e.detail.slice(0, 160) }));
      return {
        data: { lead: lead.fullName, since: fmtDate(since), events },
        sources: [{ label: `Lead · ${lead.fullName}`, href: `/leads/${lead.id}` }],
      };
    },
  },

  {
    name: 'getCalls',
    description:
      'Recent calls the user may see. Optional leadId/leadName narrows to one lead; mine=true narrows to calls the user made. Includes outcome, duration and whether analysis exists.',
    parameters: { type: 'object', properties: { leadId: str, leadName: str, mine: { type: 'boolean' }, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'calls', 'VIEW')) return denied('calls');
      const scope = await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' });
      const where: Record<string, unknown> = { ...scope, deletedAt: null };
      if (args.mine) where.callerId = ctx.actor.id;
      if (args.leadId) where.leadId = args.leadId;
      else if (args.leadName) {
        const lead = await findLead(ctx, { name: args.leadName });
        if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
        where.leadId = lead.id;
      }
      const rows = await prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(args.limit) || 8, 15),
        select: {
          id: true,
          createdAt: true,
          startedAt: true,
          status: true,
          outcome: true,
          durationSecs: true,
          notes: true,
          caller: { select: { fullName: true } },
          analysis: { select: { status: true } },
          leadId: true,
        },
      });
      return {
        data: rows.map((c) => ({
          id: c.id,
          at: fmtDate(c.startedAt ?? c.createdAt),
          status: c.status,
          outcome: c.outcome,
          minutes: c.durationSecs ? Math.round(c.durationSecs / 60) : null,
          by: c.caller.fullName,
          analysed: c.analysis?.status === 'COMPLETED',
        })),
        sources: rows
          .slice(0, 5)
          .map((c) => ({ label: `Call · ${fmtDate(c.startedAt ?? c.createdAt)}`, href: `/calls/${c.id}` })),
      };
    },
  },

  {
    name: 'getCallDetail',
    description:
      'Full detail of one call: AI analysis (summary, objections, commitments, buying signals, sentiment, next steps) and the quality audit scores if present. Use callId, or latest=true for the most recent analysed call visible to the user.',
    parameters: { type: 'object', properties: { callId: str, latest: { type: 'boolean' } } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'calls', 'VIEW')) return denied('calls');
      const scope = await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' });
      const call = await prisma.call.findFirst({
        where: args.callId
          ? { ...scope, id: args.callId, deletedAt: null }
          : { ...scope, deletedAt: null, analysis: { status: 'COMPLETED' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          startedAt: true,
          status: true,
          outcome: true,
          durationSecs: true,
          notes: true,
          leadId: true,
          caller: { select: { fullName: true } },
          analysis: true,
          callAudits: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!call) return { data: { error: 'No matching call found in the CRM.' } };
      const lead = call.leadId
        ? await prisma.lead.findFirst({
            where: { tenantId: ctx.tenantId, id: call.leadId },
            select: { fullName: true },
          })
        : null;
      const a = call.analysis;
      const audit = call.callAudits[0];
      return {
        data: {
          id: call.id,
          at: fmtDate(call.startedAt ?? call.createdAt),
          lead: lead?.fullName ?? null,
          by: call.caller.fullName,
          status: call.status,
          outcome: call.outcome,
          minutes: call.durationSecs ? Math.round(call.durationSecs / 60) : null,
          analysis:
            a?.status === 'COMPLETED'
              ? {
                  summary: a.summary,
                  sentiment: a.sentiment,
                  clientNeeds: a.clientNeeds,
                  objections: a.objections,
                  commitments: a.commitments,
                  buyingSignals: a.buyingSignals,
                  nextSteps: a.nextSteps,
                  topicsMissed: a.topicsMissed,
                  model: a.modelId,
                }
              : null,
          audit: audit
            ? {
                score: audit.overallScore,
                maxScore: audit.maxScore,
                strengths: audit.strengths,
                missedPoints: audit.missedPoints,
                suggestions: audit.suggestions,
                nextAction: audit.nextAction,
              }
            : null,
        },
        sources: [{ label: `Call · ${fmtDate(call.startedAt ?? call.createdAt)}`, href: `/calls/${call.id}` }],
      };
    },
  },

  {
    name: 'searchAccounts',
    description: 'Search accounts (companies) by name/industry, with their contacts and open opportunities.',
    parameters: { type: 'object', properties: { q: str, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'accounts', 'VIEW')) return denied('accounts');
      const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
      const where: Record<string, unknown> = { ...scope };
      if (args.q) {
        where.OR = [
          { name: { contains: args.q, mode: 'insensitive' } },
          { industry: { contains: args.q, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.account.findMany({
        where,
        take: Math.min(Number(args.limit) || 5, 10),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          industry: true,
          mainPhone: true,
          mainEmail: true,
          owner: { select: { fullName: true } },
          contacts: { take: 5, select: { id: true, fullName: true, jobTitle: true, phone: true } },
          opportunities: {
            take: 5,
            select: {
              id: true,
              name: true,
              status: true,
              amount: true,
              expectedCloseDate: true,
              stage: { select: { name: true } },
            },
          },
        },
      });
      return {
        data: rows.map((a) => ({
          id: a.id,
          name: a.name,
          industry: a.industry,
          phone: a.mainPhone,
          email: a.mainEmail,
          owner: a.owner?.fullName ?? null,
          contacts: a.contacts.map((c) => ({ name: c.fullName, title: c.jobTitle, phone: c.phone })),
          opportunities: a.opportunities.map((o) => ({
            name: o.name,
            stage: o.stage.name,
            status: o.status,
            amount: Number(o.amount),
            closes: fmtDate(o.expectedCloseDate),
          })),
        })),
        sources: rows.map((a) => ({ label: `Account · ${a.name}`, href: `/accounts/${a.id}` })),
      };
    },
  },

  {
    name: 'searchContacts',
    description: 'Search contacts by name, phone (or phone suffix), email or company.',
    parameters: { type: 'object', properties: { q: str, phoneEndsWith: str, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'contacts', 'VIEW')) return denied('contacts');
      const scope = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true });
      const where: Record<string, unknown> = { ...scope };
      if (args.phoneEndsWith) where.phone = { endsWith: String(args.phoneEndsWith).replace(/\D/g, '') };
      else if (args.q) {
        where.OR = [
          { fullName: { contains: args.q, mode: 'insensitive' } },
          { email: { contains: args.q, mode: 'insensitive' } },
          { phone: { contains: args.q } },
          { account: { name: { contains: args.q, mode: 'insensitive' } } },
        ];
      }
      const rows = await prisma.contact.findMany({
        where,
        take: Math.min(Number(args.limit) || 8, 15),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          email: true,
          phone: true,
          account: { select: { name: true } },
        },
      });
      return {
        data: rows.map((c) => ({
          id: c.id,
          name: c.fullName,
          title: c.jobTitle,
          email: c.email,
          phone: c.phone,
          company: c.account?.name ?? null,
        })),
        sources: rows.slice(0, 6).map((c) => ({ label: `Contact · ${c.fullName}`, href: `/contacts/${c.id}` })),
      };
    },
  },

  {
    name: 'searchOpportunities',
    description:
      'Search opportunities. Filters: status (OPEN | WON | LOST), closingWithinDays (expected close within N days), q (name/account).',
    parameters: { type: 'object', properties: { status: str, closingWithinDays: num, q: str, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'opportunities', 'VIEW')) return denied('opportunities');
      const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
      const where: Record<string, unknown> = { ...scope };
      if (args.status) where.status = String(args.status).toUpperCase();
      if (args.closingWithinDays) {
        where.expectedCloseDate = {
          gte: new Date(),
          lte: new Date(Date.now() + Number(args.closingWithinDays) * 864e5),
        };
        where.status = 'OPEN';
      }
      if (args.q) {
        where.OR = [
          { name: { contains: args.q, mode: 'insensitive' } },
          { account: { name: { contains: args.q, mode: 'insensitive' } } },
        ];
      }
      const rows = await prisma.opportunity.findMany({
        where,
        take: Math.min(Number(args.limit) || 8, 15),
        orderBy: [{ expectedCloseDate: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          name: true,
          status: true,
          amount: true,
          probability: true,
          expectedCloseDate: true,
          stage: { select: { name: true } },
          account: { select: { name: true } },
          owner: { select: { fullName: true } },
        },
      });
      return {
        data: rows.map((o) => ({
          id: o.id,
          name: o.name,
          account: o.account?.name ?? null,
          stage: o.stage.name,
          status: o.status,
          amountAed: Number(o.amount),
          probability: o.probability,
          closes: fmtDate(o.expectedCloseDate),
          owner: o.owner?.fullName ?? null,
        })),
        sources: rows.slice(0, 6).map((o) => ({ label: `Opportunity · ${o.name}`, href: `/opportunities/${o.id}` })),
      };
    },
  },

  {
    name: 'getTasks',
    description: 'The user’s tasks. due: today | overdue | upcoming | all (default all open).',
    parameters: { type: 'object', properties: { due: str, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'tasks', 'VIEW') && !can(ctx, 'leads', 'VIEW')) return denied('tasks');
      const scope = await visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' });
      const now = new Date();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const where: Record<string, unknown> = { ...scope, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } };
      if (args.due === 'today') where.dueAt = { gte: new Date(now.setHours(0, 0, 0, 0)), lte: todayEnd };
      else if (args.due === 'overdue') where.dueAt = { lt: new Date() };
      else if (args.due === 'upcoming') where.dueAt = { gt: todayEnd };
      const rows = await prisma.task.findMany({
        where,
        orderBy: { dueAt: 'asc' },
        take: Math.min(Number(args.limit) || 10, 20),
        select: { id: true, title: true, dueAt: true, priority: true, status: true, leadId: true },
      });
      const leadNames = new Map(
        (
          await prisma.lead.findMany({
            where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } },
            select: { id: true, fullName: true },
          })
        ).map((l) => [l.id, l.fullName]),
      );
      return {
        data: rows.map((t) => ({
          title: t.title,
          due: fmtDate(t.dueAt),
          priority: t.priority,
          status: t.status,
          lead: t.leadId ? (leadNames.get(t.leadId) ?? null) : null,
        })),
        sources: [{ label: 'Tasks', href: '/tasks' }],
      };
    },
  },

  {
    name: 'getFollowUps',
    description: 'The user’s follow-up queue. due: today | overdue | upcoming | all.',
    parameters: { type: 'object', properties: { due: str, limit: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('follow-ups');
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const where: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        deletedAt: null,
        status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] },
      };
      if (args.due === 'today') where.dueAt = { gte: todayStart, lte: todayEnd };
      else if (args.due === 'overdue') where.dueAt = { lt: now };
      else if (args.due === 'upcoming') where.dueAt = { gt: todayEnd };
      const rows = await prisma.followUpTask.findMany({
        where,
        orderBy: { dueAt: 'asc' },
        take: Math.min(Number(args.limit) || 10, 20),
        select: { id: true, title: true, dueAt: true, priority: true, leadId: true },
      });
      const leadNames = new Map(
        (
          await prisma.lead.findMany({
            where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } },
            select: { id: true, fullName: true },
          })
        ).map((l) => [l.id, l.fullName]),
      );
      return {
        data: rows.map((f) => ({
          title: f.title,
          due: fmtDate(f.dueAt),
          priority: f.priority,
          lead: f.leadId ? (leadNames.get(f.leadId) ?? null) : null,
          leadId: f.leadId,
        })),
        sources: [{ label: 'Follow-ups', href: '/follow-ups' }],
      };
    },
  },

  {
    name: 'getCalendar',
    description: 'Events and meetings within the next `days` (default 7), plus today’s scheduled calls.',
    parameters: { type: 'object', properties: { days: num } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'events', 'VIEW') && !can(ctx, 'leads', 'VIEW')) return denied('the calendar');
      const now = new Date();
      const until = new Date(now.getTime() + Math.min(Number(args.days) || 7, 60) * 864e5);
      const [events, calls] = await Promise.all([
        prisma.event.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, startAt: { gte: now, lte: until } },
          orderBy: { startAt: 'asc' },
          take: 10,
          select: { id: true, title: true, startAt: true, location: true, eventType: true },
        }),
        prisma.call.findMany({
          where: { tenantId: ctx.tenantId, callerId: ctx.actor.id, deletedAt: null, status: 'SCHEDULED' },
          orderBy: { createdAt: 'asc' },
          take: 10,
          select: { id: true, createdAt: true, recipientNumber: true, leadId: true },
        }),
      ]);
      return {
        data: {
          events: events.map((e) => ({ title: e.title, at: fmtDate(e.startAt), where: e.location, type: e.eventType })),
          scheduledCalls: calls.map((c) => ({ id: c.id, number: c.recipientNumber })),
        },
        sources: [
          { label: 'Calendar', href: '/calendar' },
          ...events.slice(0, 3).map((e) => ({ label: `Event · ${e.title}`, href: `/events/${e.id}` })),
        ],
      };
    },
  },

  {
    name: 'getMyDay',
    description:
      'A prioritised snapshot for “what should I focus on today”: overdue and today’s follow-ups, overdue tasks, SLA-breached and hottest leads, upcoming events, today’s calls.',
    parameters: { type: 'object', properties: {} },
    execute: async (ctx) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('the CRM');
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const leadScope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
      const [overdueFups, todayFups, overdueTasks, breached, hot, events, todayCalls] = await Promise.all([
        prisma.followUpTask.findMany({
          where: {
            tenantId: ctx.tenantId,
            ownerId: ctx.actor.id,
            deletedAt: null,
            status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] },
            dueAt: { lt: now },
          },
          orderBy: { dueAt: 'asc' },
          take: 5,
          select: { title: true, dueAt: true, leadId: true },
        }),
        prisma.followUpTask.count({
          where: {
            tenantId: ctx.tenantId,
            ownerId: ctx.actor.id,
            deletedAt: null,
            status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] },
            dueAt: { gte: todayStart, lte: todayEnd },
          },
        }),
        prisma.task.count({
          where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, deletedAt: null, status: 'OPEN', dueAt: { lt: now } },
        }),
        prisma.lead.findMany({
          where: { ...leadScope, slaState: 'BREACHED' },
          take: 5,
          select: LEAD_SELECT,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.lead.findMany({
          where: { ...leadScope, score: { gte: 70 } },
          orderBy: { score: 'desc' },
          take: 5,
          select: LEAD_SELECT,
        }),
        prisma.event.findMany({
          where: {
            tenantId: ctx.tenantId,
            deletedAt: null,
            startAt: { gte: todayStart, lte: new Date(now.getTime() + 3 * 864e5) },
          },
          orderBy: { startAt: 'asc' },
          take: 4,
          select: { title: true, startAt: true },
        }),
        prisma.call.count({
          where: { tenantId: ctx.tenantId, callerId: ctx.actor.id, deletedAt: null, createdAt: { gte: todayStart } },
        }),
      ]);
      return {
        data: {
          overdueFollowUps: overdueFups.map((f) => ({ title: f.title, due: fmtDate(f.dueAt) })),
          followUpsDueToday: todayFups,
          overdueTasks,
          slaBreachedLeads: breached.map(leadBrief),
          hottestLeads: hot.map(leadBrief),
          upcomingEvents: events.map((e) => ({ title: e.title, at: fmtDate(e.startAt) })),
          callsMadeToday: todayCalls,
        },
        sources: [
          { label: 'Follow-ups', href: '/follow-ups?due=overdue' },
          { label: 'SLA breached leads', href: '/leads?filter=breached' },
          { label: 'Tasks', href: '/tasks?tab=overdue' },
        ],
      };
    },
  },

  {
    name: 'prepareForCall',
    description:
      'Everything needed to brief the user before calling a lead: profile, last interactions, previous call analyses (objections, commitments), open tasks and follow-ups.',
    parameters: { type: 'object', properties: { leadId: str, name: str } },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'VIEW')) return denied('leads');
      const lead = await findLead(ctx, args);
      if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
      const [activities, calls, tasks, followUps] = await Promise.all([
        prisma.activity.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null },
          orderBy: { occurredAt: 'desc' },
          take: 5,
          select: { occurredAt: true, outcome: true, notes: true, type: { select: { name: true } } },
        }),
        prisma.call.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null, analysis: { isNot: null } },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            createdAt: true,
            analysis: {
              select: { summary: true, objections: true, commitments: true, sentiment: true, nextSteps: true },
            },
          },
        }),
        prisma.task.findMany({
          where: { tenantId: ctx.tenantId, leadId: lead.id, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          take: 5,
          select: { title: true, dueAt: true },
        }),
        prisma.followUpTask.findMany({
          where: {
            tenantId: ctx.tenantId,
            leadId: lead.id,
            deletedAt: null,
            status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] },
          },
          take: 5,
          select: { title: true, dueAt: true },
        }),
      ]);
      return {
        data: {
          profile: leadBrief(lead),
          recentActivity: activities.map((a) => ({
            at: fmtDate(a.occurredAt),
            kind: a.type.name,
            detail: (a.outcome ?? a.notes ?? '').slice(0, 140),
          })),
          previousCalls: calls.map((c) => ({
            at: fmtDate(c.createdAt),
            summary: c.analysis?.summary?.slice(0, 280),
            objections: c.analysis?.objections,
            commitments: c.analysis?.commitments,
            sentiment: c.analysis?.sentiment,
            suggestedNextSteps: c.analysis?.nextSteps,
          })),
          openTasks: tasks.map((t) => ({ title: t.title, due: fmtDate(t.dueAt) })),
          openFollowUps: followUps.map((f) => ({ title: f.title, due: fmtDate(f.dueAt) })),
        },
        sources: [
          { label: `Lead · ${lead.fullName}`, href: `/leads/${lead.id}` },
          ...calls.map((c) => ({ label: `Call · ${fmtDate(c.createdAt)}`, href: `/calls/${c.id}` })),
        ],
      };
    },
  },

  {
    name: 'createFollowUp',
    description:
      'PREPARE (never execute) a follow-up for the user to confirm. dueAt must be an ISO datetime. Resolve the lead first if only a name is known.',
    parameters: {
      type: 'object',
      properties: { leadId: str, leadName: str, title: str, dueAt: str, priority: str },
      required: ['title', 'dueAt'],
    },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'EDIT')) return denied('follow-up creation');
      let lead = null;
      if (args.leadId || args.leadName) {
        lead = await findLead(ctx, { leadId: args.leadId, name: args.leadName });
        if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
      }
      const due = new Date(args.dueAt);
      if (Number.isNaN(due.getTime())) return { data: { error: 'The due date could not be understood.' } };
      const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(args.priority).toUpperCase())
        ? String(args.priority).toUpperCase()
        : 'MEDIUM';
      return {
        data: { prepared: true, note: 'Follow-up prepared; the user must confirm before it is created.' },
        proposedAction: {
          kind: 'follow_up',
          label: `Create follow-up “${String(args.title).slice(0, 80)}”${lead ? ` for ${lead.fullName}` : ''} — ${due.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
          method: 'POST',
          endpoint: '/api/v1/follow-ups',
          payload: {
            title: String(args.title).slice(0, 200),
            dueAt: due.toISOString(),
            priority,
            ...(lead ? { leadId: lead.id } : {}),
          },
        },
      };
    },
  },

  {
    name: 'createTask',
    description: 'PREPARE (never execute) a task for the user to confirm. dueAt must be an ISO datetime.',
    parameters: {
      type: 'object',
      properties: { leadId: str, leadName: str, title: str, dueAt: str, priority: str },
      required: ['title', 'dueAt'],
    },
    execute: async (ctx, args) => {
      if (!can(ctx, 'leads', 'EDIT')) return denied('task creation');
      const taskType = await prisma.taskType.findFirst({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });
      if (!taskType) return { data: { error: 'No task types are configured in this workspace.' } };
      let lead = null;
      if (args.leadId || args.leadName) {
        lead = await findLead(ctx, { leadId: args.leadId, name: args.leadName });
        if (!lead) return { data: { error: 'No matching lead found in the CRM.' } };
      }
      const due = new Date(args.dueAt);
      if (Number.isNaN(due.getTime())) return { data: { error: 'The due date could not be understood.' } };
      const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(args.priority).toUpperCase())
        ? String(args.priority).toUpperCase()
        : 'MEDIUM';
      return {
        data: { prepared: true, note: 'Task prepared; the user must confirm before it is created.' },
        proposedAction: {
          kind: 'task',
          label: `Create task “${String(args.title).slice(0, 80)}”${lead ? ` for ${lead.fullName}` : ''} — ${due.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
          method: 'POST',
          endpoint: '/api/v1/tasks',
          payload: {
            typeId: taskType.id,
            title: String(args.title).slice(0, 200),
            dueAt: due.toISOString(),
            priority,
            ...(lead ? { leadId: lead.id } : {}),
          },
        },
      };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
