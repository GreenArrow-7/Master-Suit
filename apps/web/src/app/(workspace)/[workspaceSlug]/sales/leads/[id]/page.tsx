import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { visibilityWhere } from '@/lib/security/visibility';
import { emptyFollowUpLabel, obligationAccess, scopedNextFollowUp } from '@/services/leads/nextFollowUp';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can, scopeFor } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import StageRail from '@/components/ui/StageRail';
import LeadDetail from './LeadDetail';
import SalesLink from '@/components/workspace/SalesLink';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });

  const [scope, taskScope] = await Promise.all([
    visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true }),
    // A Task is read under `tasks`, not `leads` (services/leads/nextFollowUp.ts):
    // the Tasks tab lists what the viewer's Tasks page would, so each row passes
    // the scope check of PATCH /tasks/{id}, and a role with no `tasks` grant sees none.
    scopeFor(ctx, 'tasks', 'VIEW') === 'NONE'
      ? { id: { in: [] } }
      : visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
  ]);
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
        // The tenant guard's soft-delete filter reaches the lead, not what it includes.
        where: { ...taskScope, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: { dueAt: 'asc' },
        take: 20,
        include: { type: true },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          name: true,
          category: true,
          mimeType: true,
          sizeBytes: true,
          scanState: true,
          createdAt: true,
        },
      },
      stageHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
      // The latest only: a manual reassignment after it carries no note, and hides it.
      assignments: { orderBy: { createdAt: 'desc' }, take: 1, select: { note: true } },
      phones: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, raw: true, normalized: true, label: true, isWhatsapp: true },
      },
    },
  });

  const [lead, stages, activityTypes, taskTypes, tenantUsers, rules] = await Promise.all([
    leadPromise,
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true, category: true, requiresReason: true, reasons: true },
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

  const personalAccess = await obligationAccess(ctx, 'personal');
  const scopedDue = await scopedNextFollowUp(ctx.tenantId, [lead.id], personalAccess);

  const safe = applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS) as typeof lead;
  // The other numbers follow the main one: a role that may not see `phone`, or
  // sees it masked, sees none of them.
  const phoneVisible = safe.phone === lead.phone;

  // Serialize dates to ISO strings for the client component
  const serializedLead = {
    id: safe.id,
    reference: safe.reference,
    fullName: safe.fullName,
    email: safe.email,
    phone: safe.phone,
    phoneNormalized: phoneVisible ? lead.phoneNormalized : null,
    phones: phoneVisible ? lead.phones : null,
    company: lead.company,
    jobTitle: lead.jobTitle,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    source: lead.source,
    consentStatus: lead.consentStatus,
    priority: lead.priority,
    status: lead.status,
    slaState: lead.slaState,
    score: lead.score,
    grade: lead.grade,
    notes: lead.notes,
    tags: lead.tags,
    // The viewer's own next obligation. The stored aggregate is not consulted
    // at all — not even as a boolean, which would disclose whether a colleague
    // has work here. The empty label speaks about the viewer instead.
    nextFollowUpAt: (scopedDue.get(lead.id) ?? null)?.toISOString() ?? null,
    followUpEmptyLabel: emptyFollowUpLabel(personalAccess, 'personal'),
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    stage: { key: lead.stage.key, name: lead.stage.name },
    stageReason: lead.stageReason,
    assignedWhy: lead.assignments[0]?.note ?? null,
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
        // Deleting an attachment is its own authority, not part of editing the
        // lead: the representatives who upload hold `leads:EDIT` and must not be
        // able to remove a file once it is on the record. Only the organisation
        // administrator is granted `documents:DELETE`.
        canDeleteDocuments={can(ctx, 'documents', 'DELETE')}
      />
    </>
  );
}
