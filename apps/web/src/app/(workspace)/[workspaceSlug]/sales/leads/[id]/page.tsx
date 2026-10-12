import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertRecordVisible, visibilityWhere } from '@/lib/security/visibility';
import { assignableUsers, leadScope } from '@/lib/security/record-scope';
import { emptyFollowUpLabel, obligationAccess, scopedNextFollowUp } from '@/services/leads/nextFollowUp';
import { loadFieldRules, applyFieldSecurity, seesField } from '@/lib/security/fieldSecurity';
import { can, scopeFor } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { asLeadPhone, LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { leadSourceLabel, listLeadSources } from '@/services/leads/leadSources';
import { openRequirement, requirementForPage } from '@/services/leads/requirement';
import { fieldForScreen, leadFields } from '@/services/leads/customFields';
import { workspaceTimezone } from '@/services/hr/attendance';
import StageRail from '@/components/ui/StageRail';
import LeadDetail from './LeadDetail';
import SalesLink from '@/components/workspace/SalesLink';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });

  const [scope, taskScope] = await Promise.all([
    leadScope(ctx, 'VIEW', { includeUnassigned: true }),
    // A Task is read under `tasks`, not `leads` (services/leads/nextFollowUp.ts):
    // the Tasks tab lists what the viewer's Tasks page would, and a role with no
    // `tasks` grant sees none. Completing one also takes `leads:EDIT` over its
    // owner (PATCH /tasks/{id}), which no seeded role lacks where it sees the task.
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
      owner: { select: { id: true, fullName: true, email: true } },
      secondaryOwner: { select: { id: true, fullName: true } },
      leadSource: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } },
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
      stageHistory: { orderBy: { createdAt: 'desc' }, take: 50 },
      // The latest only: a manual reassignment after it carries no note, and hides it.
      assignments: { orderBy: { createdAt: 'desc' }, take: 1, select: { note: true } },
      phones: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, raw: true, normalized: true, label: true, isWhatsapp: true },
      },
      // The projects and listings it asked about (M4-06), live ones only.
      projectInterests: {
        where: { project: { deletedAt: null } },
        orderBy: { createdAt: 'asc' },
        select: { project: { select: { id: true, name: true } } },
      },
      listingInterests: {
        where: { listing: { deletedAt: null } },
        orderBy: { createdAt: 'asc' },
        select: { listing: { select: { id: true, reference: true, title: true } } },
      },
    },
  });
  const seesProjects = can(ctx, 'projects', 'VIEW');
  const seesListings = can(ctx, 'listings', 'VIEW');

  const [
    lead,
    stages,
    activityTypes,
    taskTypes,
    tenantUsers,
    rules,
    sources,
    requirement,
    timeZone,
    fields,
    projectOptions,
    listingOptions,
  ] = await Promise.all([
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
    // The owner menu offers whom updateLead accepts.
    assignableUsers(ctx, 'leads', can(ctx, 'leads', 'ASSIGN') ? 'ASSIGN' : 'REASSIGN'),
    loadFieldRules(ctx, 'LEAD'),
    listLeadSources(prisma, ctx.tenantId),
    // Read only once the lead is in reach: it is the lead's, scoped like it (M4-05).
    leadPromise.then((found) => (found ? openRequirement(prisma, ctx.tenantId, found.id) : null)),
    workspaceTimezone(ctx),
    leadFields(prisma, ctx.tenantId, { activeOnly: true }),
    // The interest pickers offer what the viewer can see (M4-06).
    // ponytail: the first 300 by name or newest; a search box when books outgrow a select.
    seesProjects
      ? prisma.project.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          orderBy: { name: 'asc' },
          take: 300,
          select: { id: true, name: true },
        })
      : null,
    seesListings
      ? prisma.listing.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 300,
          select: { id: true, reference: true, title: true },
        })
      : null,
  ]);
  if (!lead) notFound();
  const customData = (lead.customData ?? {}) as Record<string, unknown>;
  // The register's page lists the listings that match; offered only where the viewer may open it.
  const opensRequirement =
    !!requirement &&
    (await assertRecordVisible(ctx, 'requirements', requirement, prisma, 'VIEW').then(
      () => true,
      () => false,
    ));

  const personalAccess = await obligationAccess(ctx, 'personal');
  const scopedDue = await scopedNextFollowUp(ctx.tenantId, [lead.id], personalAccess);

  const safe = applyFieldSecurity(ctx, 'LEAD', rules, lead, LEAD_SENSITIVE_FIELDS) as typeof lead;
  // The other numbers follow the main one: masked where it is masked, absent
  // where it is hidden.
  const sees = (field: 'phone' | 'email') => seesField(ctx, 'LEAD', rules, field, LEAD_SENSITIVE_FIELDS);
  const phoneVisible = sees('phone');

  // Serialize dates to ISO strings for the client component
  const serializedLead = {
    id: safe.id,
    reference: safe.reference,
    fullName: safe.fullName,
    email: safe.email,
    phone: safe.phone,
    phoneNormalized: phoneVisible ? lead.phoneNormalized : null,
    phones: phoneVisible
      ? lead.phones
      : safe.phone === undefined
        ? null
        : lead.phones.map((p) => ({ ...p, raw: asLeadPhone(ctx, rules, p.raw) ?? '', normalized: '' })),
    // Masked contact details are shown, never dialled, mailed or edited.
    contactMasked: { phone: !phoneVisible, email: !sees('email') },
    phoneIsWhatsapp: lead.phoneIsWhatsapp,
    company: lead.company,
    jobTitle: lead.jobTitle,
    industry: lead.industry,
    city: lead.city,
    country: lead.country,
    nationality: lead.nationality,
    source: lead.source,
    sourceDetail: lead.sourceDetail,
    sourceId: lead.sourceId,
    sourceLabel: leadSourceLabel(lead.leadSource),
    campaignName: lead.campaignName,
    consentStatus: lead.consentStatus,
    priority: lead.priority,
    status: lead.status,
    slaState: lead.slaState,
    score: lead.score,
    grade: lead.grade,
    requirement: requirementForPage(requirement, timeZone),
    // The values of the workspace's active fields, and nothing else of customData (M4-13).
    custom: Object.fromEntries(
      fields.flatMap((f) => (customData[f.key] == null ? [] : [[f.key, customData[f.key] as string | number]])),
    ),
    interests: {
      projects: lead.projectInterests.map((i) => i.project),
      listings: lead.listingInterests.map((i) => i.listing),
    },
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
    secondaryOwner: lead.secondaryOwner,
    activities: lead.activities.map((a) => ({
      id: a.id,
      outcome: a.outcome,
      notes: a.notes,
      occurredAt: a.occurredAt.toISOString(),
      durationSecs: a.durationSecs,
      type: a.type,
    })),
    // Stored rows with their stored times; a stage deleted since is named as such, not guessed.
    stageChanges: lead.stageHistory.map((h) => ({
      id: h.id,
      at: h.createdAt.toISOString(),
      from: h.fromStageId ? (stages.find((s) => s.id === h.fromStageId)?.name ?? 'a removed stage') : null,
      to: stages.find((s) => s.id === h.toStageId)?.name ?? 'a removed stage',
      reason: h.reason,
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
        // The offered entries, plus the lead's own (and its source) should it have been withdrawn since.
        sources={sources.filter((s) => s.isActive || s.id === lead.sourceId || s.id === lead.leadSource?.parentId)}
        customFields={fields.map(fieldForScreen)}
        projectOptions={projectOptions}
        listingOptions={listingOptions}
        opens={{ projects: seesProjects, listings: seesListings }}
        matchesHref={opensRequirement ? `/requirements/${requirement!.id}` : null}
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
