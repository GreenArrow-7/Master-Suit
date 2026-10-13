import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import type { Ctx } from '@/lib/security/rbac';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertRecordVisible, visibilityWhere } from '@/lib/security/visibility';
import { assignableUsers, leadReach, leadScope, ownerReach, workListScope } from '@/lib/security/record-scope';
import { emptyFollowUpLabel, obligationAccess, OPEN_STATUSES, scopedNextFollowUp } from '@/services/leads/nextFollowUp';
import { loadFieldRules, applyFieldSecurity, seesField } from '@/lib/security/fieldSecurity';
import { can, scopeFor } from '@/lib/security/rbac';
import { prisma, withTx } from '@/lib/db';
import { asLeadPhone, LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { bookableProjects } from '@/services/leads/updateLead';
import { findDuplicates } from '@/services/leads/findDuplicates';
import { leadSourceText, listLeadSources } from '@/services/leads/leadSources';
import { openRequirement, requirementForPage } from '@/services/leads/requirement';
import { fieldForScreen, leadFields } from '@/services/leads/customFields';
import { workspaceTimezone } from '@/services/hr/attendance';
import { leadTimeline, onClock } from '@/services/leads/timeline';
import { matchesForRequirement } from '@/services/inventory/demand';
import StageRail from '@/components/ui/StageRail';
import LeadDetail from './LeadDetail';
import SalesLink from '@/components/workspace/SalesLink';

/** The matches the Matching stock card reads; the requirement's page lists them all. */
const STOCK_CAP = 25;

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });

  const [scope, taskScope, followUpScope] = await Promise.all([
    leadScope(ctx, 'VIEW', { includeUnassigned: true }),
    // A Task is read under `tasks`, not `leads` (services/leads/nextFollowUp.ts):
    // the Tasks tab lists what the viewer's Tasks page would, and a role with no
    // `tasks` grant sees none. Completing one also takes `leads:EDIT` over its
    // owner (PATCH /tasks/{id}), which no seeded role lacks where it sees the task.
    scopeFor(ctx, 'tasks', 'VIEW') === 'NONE'
      ? { id: { in: [] } }
      : visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
    // A follow-up is read under `leads`, as the Follow-ups page lists them.
    workListScope(ctx, 'leads', false),
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
    [stages, activityTypes, taskTypes, sources, fields, projectOptions, listingOptions],
    tenantUsers,
    rules,
    requirement,
    timeZone,
  ] = await Promise.all([
    leadPromise,
    // The workspace's lists through one tenant transaction, so one connection:
    // each read on its own is a pinned transaction on its own connection
    // (lib/db.ts runPinned), and the page asked the pool for more than it holds
    // (P2028). Only `tx` inside: the global client there runs without the tenant.
    withTx(ctx.tenantId, (tx) =>
      Promise.all([
        tx.leadStage.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            key: true,
            name: true,
            category: true,
            requiresReason: true,
            reasons: true,
            requiredFields: true,
          },
        }),
        tx.activityType.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { position: 'asc' },
          select: { id: true, name: true, key: true },
        }),
        tx.taskType.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          select: { id: true, name: true, key: true },
        }),
        listLeadSources(tx, ctx.tenantId),
        leadFields(tx, ctx.tenantId, { activeOnly: true }),
        // The interest pickers offer what the viewer can see (M4-06).
        // ponytail: the first 300 by name or newest; a search box when books outgrow a select.
        seesProjects
          ? tx.project.findMany({
              where: { tenantId: ctx.tenantId, deletedAt: null },
              orderBy: { name: 'asc' },
              take: 300,
              select: { id: true, name: true },
            })
          : null,
        seesListings
          ? tx.listing.findMany({
              where: { tenantId: ctx.tenantId, deletedAt: null },
              orderBy: { updatedAt: 'desc' },
              take: 300,
              select: { id: true, reference: true, title: true },
            })
          : null,
      ]),
    ),
    // The owner menu offers whom updateLead accepts.
    assignableUsers(ctx, 'leads', can(ctx, 'leads', 'ASSIGN') ? 'ASSIGN' : 'REASSIGN'),
    loadFieldRules(ctx, 'LEAD'),
    // Read only once the lead is in reach: it is the lead's, scoped like it (M4-05).
    leadPromise.then((found) => (found ? openRequirement(prisma, ctx.tenantId, found.id) : null)),
    workspaceTimezone(ctx),
  ]);
  if (!lead) return mergedInto(scope, id);
  const projects = await bookableProjects(ctx, stages);
  const duplicates = can(ctx, 'leads', 'EDIT') ? await mergeable(ctx, lead) : [];
  const customData = (lead.customData ?? {}) as Record<string, unknown>;
  // The register's page lists the listings that match; offered only where the viewer may open it.
  const opensRequirement =
    !!requirement &&
    (await assertRecordVisible(ctx, 'requirements', requirement, prisma, 'VIEW').then(
      () => true,
      () => false,
    ));

  // What it is owed and what was done (M4-47): its open follow-ups beside the
  // open tasks, and the last 10 done of either, newest first.
  const [timeline, [openFollowUps, doneTasks, doneFollowUps], completes, logs, matched] = await Promise.all([
    leadTimeline(ctx, lead.id),
    // One transaction, as the lists above.
    withTx(ctx.tenantId, (tx) =>
      Promise.all([
        tx.followUpTask.findMany({
          where: {
            ...followUpScope,
            tenantId: ctx.tenantId,
            leadId: lead.id,
            deletedAt: null,
            status: { in: [...OPEN_STATUSES] },
          },
          orderBy: { dueAt: 'asc' },
          take: 20,
          select: { id: true, title: true, dueAt: true, ownerId: true },
        }),
        tx.task.findMany({
          where: {
            ...taskScope,
            tenantId: ctx.tenantId,
            leadId: lead.id,
            deletedAt: null,
            status: 'COMPLETED',
            completedAt: { not: null },
          },
          orderBy: { completedAt: 'desc' },
          take: 10,
          select: { id: true, title: true, completedAt: true },
        }),
        tx.followUpTask.findMany({
          where: {
            ...followUpScope,
            tenantId: ctx.tenantId,
            leadId: lead.id,
            deletedAt: null,
            status: 'COMPLETED',
            completedAt: { not: null },
          },
          orderBy: { completedAt: 'desc' },
          take: 10,
          select: { id: true, title: true, completedAt: true },
        }),
      ]),
    ),
    // Complete is offered where PATCH /follow-ups/{id} takes it.
    ownerReach(ctx, 'leads', 'EDIT'),
    // Log call is offered where POST /leads/{id}/call-log takes it.
    leadReach(ctx, 'EDIT'),
    // Matching stock (M4-48): the listings its open requirement matches, for a viewer who sees listings.
    requirement && seesListings ? matchesForRequirement(ctx.tenantId, requirement.id, STOCK_CAP) : null,
  ]);
  const done = [
    ...doneTasks.map((t) => ({ ...t, key: `task:${t.id}` })),
    ...doneFollowUps.map((f) => ({ ...f, key: `follow-up:${f.id}` })),
  ]
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
    .slice(0, 10);
  // Live stock only: a lapsed mandate is off the market even before the sweep marks it.
  const now = new Date();
  const stock = (matched?.matches ?? []).filter((m) => !m.mandateExpires || m.mandateExpires > now);

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
    sourceId: lead.sourceId,
    sourceLabel: leadSourceText(lead),
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
    // Named only to a viewer who may see projects or listings: the interests API answers 404 otherwise.
    interests: {
      projects: seesProjects ? lead.projectInterests.map((i) => i.project) : [],
      listings: seesListings ? lead.listingInterests.map((i) => i.listing) : [],
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
    // Its first page; the tab asks GET /leads/{id}/timeline for older ones (M4-12, M4-46).
    timeline,
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
    followUps: openFollowUps.map((f) => ({
      id: f.id,
      title: f.title,
      dueAt: f.dueAt.toISOString(),
      due: onClock(f.dueAt, timeZone),
      canComplete: completes(f.ownerId),
    })),
    done: done.map((d) => ({ key: d.key, title: d.title, doneAt: onClock(d.completedAt!, timeZone) })),
    matchingStock: seesListings
      ? {
          hasRequirement: !!requirement,
          total: stock.length,
          // At the cap there are more than it counts: the card does not give the cap as the number.
          more: (matched?.matches.length ?? 0) >= STOCK_CAP,
          listings: stock.slice(0, 5).map((m) => ({
            id: m.id,
            reference: m.reference,
            title: m.title,
            price: `${m.currency} ${Number(m.price).toLocaleString('en-GB')}`,
            bedrooms: m.bedrooms,
            community: m.micromarket?.name ?? null,
          })),
        }
      : null,
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

      {duplicates.map((other) => (
        <div
          key={other.id}
          className="lf-alert"
          data-tone="brass"
          role="status"
          style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--lf-space-3)' }}
        >
          <span>
            May be the same person as {other.reference} · {other.fullName} (same{' '}
            {other.matchedOn.replace('phoneNormalized', 'number').replace('fullName', 'name')}).
          </span>
          <SalesLink href={`/leads/${lead.id}/merge?with=${other.id}`} style={{ fontWeight: 600 }}>
            Compare and merge
          </SalesLink>
        </div>
      ))}

      <LeadDetail
        lead={serializedLead}
        stages={stages}
        projects={projects}
        activityTypes={activityTypes}
        taskTypes={taskTypes}
        users={tenantUsers}
        // The offered entries, plus the lead's own (and its source) should it have been withdrawn since.
        sources={sources.filter((s) => s.isActive || s.id === lead.sourceId || s.id === lead.leadSource?.parentId)}
        customFields={fields.map(fieldForScreen)}
        projectOptions={projectOptions}
        listingOptions={listingOptions}
        matchesHref={opensRequirement ? `/requirements/${requirement!.id}` : null}
        timeZone={timeZone}
        canEdit={can(ctx, 'leads', 'EDIT')}
        canLog={logs(lead)}
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

/**
 * The leads the duplicate rules match this one with (`findDuplicates`, as on
 * create), each offered for a merge (M4-31): only where the viewer could merge
 * them, as the merge itself requires (`assertMayMerge`): this lead and the match
 * in their EDIT scope, an unassigned one only to a claimer, and another owner's
 * only to a role that may reassign. (Whether the kept lead's owner is in that
 * role's reach is left to the merge: it says so if not.)
 */
async function mergeable(
  ctx: Ctx,
  lead: {
    id: string;
    email: string | null;
    phoneNormalized: string | null;
    fullName: string;
    phones: { normalized: string }[];
  },
) {
  const matches = await findDuplicates(ctx.tenantId, {
    email: lead.email,
    phoneNormalized: lead.phoneNormalized,
    otherPhones: lead.phones.map((phone) => phone.normalized),
    fullName: lead.fullName,
    excludeId: lead.id,
  });
  if (!matches.length) return [];
  const reach = await prisma.lead.findMany({
    where: {
      ...(await leadScope(ctx, 'EDIT', { includeUnassigned: true })),
      id: { in: [lead.id, ...matches.map((match) => match.id)] },
    },
    select: { id: true, ownerId: true },
  });
  const self = reach.find((row) => row.id === lead.id);
  if (!self) return [];
  const reassigns = can(ctx, 'leads', 'ASSIGN') || can(ctx, 'leads', 'REASSIGN');
  return matches.filter((match) =>
    reach.some((row) => row.id === match.id && (reassigns || row.ownerId === self.ownerId)),
  );
}

/**
 * A lead merged into another (M4-31) keeps its page: it names the lead it went
 * into, for whoever could open it before. Anything else is not found.
 */
async function mergedInto(scope: Record<string, unknown>, id: string) {
  const merged = await prisma.lead.findFirst({
    where: { ...scope, id, isMerged: true, deletedAt: { not: null } },
    select: { reference: true, duplicateOfId: true },
  });
  if (!merged) notFound();
  const into = merged.duplicateOfId
    ? await prisma.lead.findFirst({
        where: { ...scope, id: merged.duplicateOfId },
        select: { id: true, reference: true, fullName: true },
      })
    : null;
  return (
    <>
      <SalesLink href="/leads" style={{ fontSize: 'var(--lf-text-sm)' }}>
        &larr; Leads
      </SalesLink>
      <div className="lf-card" role="status" style={{ marginTop: 'var(--lf-space-3)' }}>
        {merged.reference} was merged into{' '}
        {into ? (
          <SalesLink href={`/leads/${into.id}`}>
            {into.reference} · {into.fullName}
          </SalesLink>
        ) : (
          'a lead you cannot open'
        )}
        .
      </div>
    </>
  );
}
