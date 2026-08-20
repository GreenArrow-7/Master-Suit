import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import StageRail from '@/components/ui/StageRail';
import LeadDetail from './LeadDetail';
import SalesLink from '@/components/workspace/SalesLink';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  // One round trip, not three: the lookups and field rules depend only on ctx,
  // so they run alongside the lead fetch instead of after it.
  const leadPromise = prisma.lead.findFirst({
    where: { ...scope, id },
    include: {
      stage: true,
      owner: { select: { fullName: true, email: true } },
      activities: {
        orderBy: { occurredAt: 'desc' },
        take: 50,
        include: { type: { select: { name: true, key: true } } },
      },
      tasks: {
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: { dueAt: 'asc' },
        take: 20,
        include: { type: true },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, name: true, category: true, mimeType: true, sizeBytes: true, scanState: true, createdAt: true },
      },
      stageHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  const [lead, stages, activityTypes, taskTypes, tenantUsers, rules] = await Promise.all([
    leadPromise,
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true, category: true },
    }),
    prisma.activityType.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, key: true },
    }),
    prisma.taskType.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, key: true },
    }),
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    loadFieldRules(ctx, 'LEAD'),
  ]);
  if (!lead) notFound();

  const safe = applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS) as typeof lead;

  // Serialize dates to ISO strings for the client component
  const serializedLead = {
    id: safe.id,
    reference: safe.reference,
    fullName: safe.fullName,
    email: safe.email,
    phone: safe.phone,
    company: lead.company,
    jobTitle: lead.jobTitle,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    source: lead.source,
    consentStatus: lead.consentStatus,
    priority: lead.priority,
    slaState: lead.slaState,
    score: lead.score,
    grade: lead.grade,
    notes: lead.notes,
    tags: lead.tags,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    stage: { key: lead.stage.key, name: lead.stage.name },
    owner: lead.owner,
    activities: lead.activities.map((a) => ({
      id: a.id,
      outcome: a.outcome,
      notes: a.notes,
      occurredAt: a.occurredAt.toISOString(),
      durationSecs: a.durationSecs,
      type: a.type,
    })),
    tasks: lead.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      dueAt: t.dueAt.toISOString(),
      priority: t.priority,
      status: t.status,
      completedAt: t.completedAt?.toISOString() ?? null,
      type: { name: t.type.name, key: t.type.key, color: t.type.color },
    })),
    documents: lead.documents.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      scanState: d.scanState,
      createdAt: d.createdAt.toISOString(),
    })),
  };

  return (
    <>
      <SalesLink href="/leads" style={{ fontSize: 'var(--lf-text-sm)' }}>
        &larr; Leads
      </SalesLink>

      <StageRail
        stages={stages as any}
        currentKey={lead.stage.key}
        slaState={lead.slaState as any}
        slaDueAt={lead.slaDueAt}
      />

      <LeadDetail
        lead={serializedLead}
        stages={stages}
        activityTypes={activityTypes}
        taskTypes={taskTypes}
        users={tenantUsers}
        canEdit={can(ctx, 'leads', 'EDIT')}
        canAssign={can(ctx, 'leads', 'ASSIGN')}
        canDelete={can(ctx, 'leads', 'DELETE')}
      />
    </>
  );
}
