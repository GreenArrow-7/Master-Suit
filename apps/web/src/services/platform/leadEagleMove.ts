/**
 * Moving a company from the standalone Lead Eagle into a YOUHAN ONE workspace
 * (Lead Eagle plan, phase 5). `scripts/move-lead-eagle.ts` reads the company
 * into a `LeadEagleCompany` snapshot; this writes it.
 *
 * One transaction, all or nothing. A dry run performs every write — so every
 * constraint, foreign key and policy is exercised against the real workspace —
 * checks the counts and a sample, and rolls back. A commit does the same and
 * keeps it. A company already moved into the workspace is refused, so a second
 * run cannot double the book.
 *
 * People are matched by email to the workspace's existing users: accounts are
 * never created here (invite them first). Records owned by someone without an
 * account move unowned, and anything that must have an owner (a follow-up, a
 * booking) falls to the workspace's first Company Admin; each case is reported.
 */
import type {
  BookingStatus,
  CommissionStatus,
  DataStatus,
  Furnishing,
  ListingStatus,
  PossessionStatus,
  ProjectStatus,
  PropertyType,
  RecordSource,
  RentFrequency,
  StageCategory,
  TaskStatus,
  UnitStatus,
} from '@prisma/client';
import { prisma, withPlatformTx } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { nextReference } from '@/services/shared/reference';

type Id = string;
type When = string | Date;

/** One standalone company, as `scripts/move-lead-eagle.ts` reads it. Decimals are strings. */
export interface LeadEagleCompany {
  company: { id: Id; slug: string; name: string };
  users: { id: Id; email: string; fullName: string }[];
  statuses: {
    id: Id;
    key: string;
    name: string;
    category: 'OPEN' | 'WON' | 'LOST';
    position: number;
    requiresReason: boolean;
    slaMinutes: number | null;
    subStatuses: string[];
  }[];
  leads: {
    id: Id;
    reference: string;
    fullName: string;
    email: string | null;
    primaryPhone: string | null;
    phones: { raw: string; label: string | null; isWhatsapp: boolean }[];
    statusId: Id;
    subStatus: string | null;
    lostReason: string | null;
    ownerId: Id | null;
    source: string | null;
    campaign: string | null;
    tags: string[];
    notes: string | null;
    score: number;
    purpose: 'BUY' | 'RENT' | 'INVEST' | 'SELL' | null;
    propertyTypes: PropertyType[];
    bedroomsMin: number | null;
    bedroomsMax: number | null;
    budgetMin: string | null;
    budgetMax: string | null;
    preferredLocations: string[];
    /** Names of the projects it was interested in (Lead Eagle's LeadProject). */
    projects: string[];
    createdAt: When;
    lastActivityAt: When | null;
    nextFollowUpAt: When | null;
  }[];
  activities: {
    leadId: Id | null;
    dataRecordId: Id | null;
    userId: Id | null;
    type: string;
    summary: string;
    body: string | null;
    callDirection: 'INBOUND' | 'OUTBOUND' | null;
    callOutcome: string | null;
    callDurationSecs: number | null;
    fromStatusId: Id | null;
    toStatusId: Id | null;
    occurredAt: When;
  }[];
  enquiries: { leadId: Id; source: string | null; message: string | null; receivedAt: When }[];
  followUps: {
    leadId: Id;
    ownerId: Id;
    type: string;
    dueAt: When;
    note: string | null;
    doneAt: When | null;
    outcome: string | null;
    cancelledAt: When | null;
  }[];
  dataRecords: {
    id: Id;
    fullName: string;
    phone: string | null;
    email: string | null;
    company: string | null;
    jobTitle: string | null;
    city: string | null;
    notes: string | null;
    status: 'NOT_CONTACTED' | 'NOT_REACHABLE' | 'NOT_INTERESTED' | 'INTERESTED' | 'CONVERTED' | 'JUNK';
    batch: string | null;
    ownerId: Id | null;
    convertedLeadId: Id | null;
    convertedAt: When | null;
    createdAt: When;
  }[];
  captureLinks: {
    key: string;
    label: string;
    headline: string | null;
    assignToId: Id | null;
    campaign: string | null;
    isActive: boolean;
    scans: number;
    submissions: number;
  }[];
  projects: {
    id: Id;
    name: string;
    developer: string | null;
    community: string | null;
    city: string | null;
    status: 'OFF_PLAN' | 'UNDER_CONSTRUCTION' | 'READY' | 'SOLD_OUT';
    handoverAt: When | null;
    priceFrom: string | null;
    priceTo: string | null;
    permitNumber: string | null;
    description: string | null;
    amenities: string[];
  }[];
  units: {
    id: Id;
    projectId: Id;
    unitNumber: string;
    floor: number | null;
    view: string | null;
    price: string | null;
    sizeSqft: number | null;
    status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'SOLD';
    heldById: Id | null;
    heldUntil: When | null;
  }[];
  listings: {
    id: Id;
    reference: string;
    title: string;
    purpose: 'SALE' | 'RENT';
    propertyType: PropertyType;
    status: ListingStatus;
    bedrooms: number | null;
    bathrooms: number | null;
    sizeSqft: number | null;
    furnishing: Furnishing | null;
    price: string | null;
    rentFrequency: RentFrequency | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    amenities: string[];
    description: string | null;
    permitNumber: string | null;
    availableFrom: When | null;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
    agentId: Id | null;
  }[];
  bookings: {
    id: Id;
    reference: string;
    leadId: Id;
    unitId: Id | null;
    projectId: Id | null;
    listingId: Id | null;
    status: 'RESERVED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    bookingDate: When;
    dealValue: string;
    received: string;
    cancelReason: string | null;
    notes: string | null;
    createdById: Id | null;
    updatedAt: When;
  }[];
  commissions: {
    bookingId: Id;
    userId: Id | null;
    externalName: string | null;
    percent: string | null;
    amount: string;
    status: 'PENDING' | 'INVOICED' | 'RECEIVED' | 'WRITTEN_OFF';
    paidAt: When | null;
  }[];
  /** Rows of the tables this does not move, by table: proposals, media, attendance, custom fields… */
  notMoved: Record<string, number>;
}

export interface MoveReport {
  committed: boolean;
  /** Per table: rows in the snapshot, rows written. */
  counts: Record<string, { source: number; moved: number }>;
  /** What a person should know before (or after) the cut-over. */
  problems: string[];
  notMoved: Record<string, number>;
  needsRealEstate: boolean;
}

class DryRun extends Error {}

const CATEGORY: Record<string, StageCategory> = { OPEN: 'OPEN', WON: 'CONVERSION', LOST: 'TERMINAL_NEGATIVE' };
const PROJECT_STATUS: Record<string, [ProjectStatus, PossessionStatus]> = {
  OFF_PLAN: ['LAUNCHED', 'NEW_LAUNCH'],
  UNDER_CONSTRUCTION: ['UNDER_CONSTRUCTION', 'UNDER_CONSTRUCTION'],
  READY: ['READY', 'READY_TO_MOVE'],
  SOLD_OUT: ['SOLD_OUT', 'READY_TO_MOVE'],
};
const BOOKING_STATUS: Record<string, BookingStatus> = {
  RESERVED: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
};
const COMMISSION_STATUS: Record<string, CommissionStatus> = {
  PENDING: 'ACCRUED',
  INVOICED: 'CONFIRMED',
  RECEIVED: 'COLLECTED',
  WRITTEN_OFF: 'CLAWED_BACK',
};
/** Lead Eagle's activity kinds onto the workspace's activity types, created if missing. */
const ACTIVITY_TYPE: Record<string, [key: string, name: string]> = {
  NOTE: ['note', 'Note'],
  CALL_INBOUND: ['call_in', 'Inbound call'],
  CALL_OUTBOUND: ['call_out', 'Outbound call'],
  EMAIL: ['email_sent', 'Email sent'],
  MEETING: ['meeting', 'Meeting'],
  SITE_VISIT: ['meeting', 'Meeting'],
};

const date = (value: When | null) => (value ? new Date(value) : null);
const stageKey = (key: string) =>
  key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50) || 'stage';
/** A portal, an ad network or a form, as the reports group sources. */
function recordSource(source: string | null): RecordSource {
  const name = (source ?? '').toLowerCase();
  if (/property ?finder|bayut|dubizzle|portal/.test(name)) return 'MARKETPLACE';
  if (/meta|facebook|instagram|google|ads?\b/.test(name)) return 'AD_LEAD_FORM';
  if (/website|form|landing/.test(name)) return 'PUBLIC_FORM';
  if (/walk|referr|manual/.test(name)) return 'MANUAL';
  return 'IMPORT';
}

/** Write one company into the workspace. Rolls back unless `commit`. */
export async function moveCompany(
  tenantId: string,
  snap: LeadEagleCompany,
  options: { commit: boolean; enableRealEstate?: boolean },
): Promise<MoveReport> {
  const problems: string[] = [];
  const counts: MoveReport['counts'] = {};
  const tally = (table: string, source: number, moved: number) => (counts[table] = { source, moved });
  const marker = { leadEagle: { company: snap.company.id } };
  const needsRealEstate = snap.bookings.length + snap.listings.length + snap.projects.length > 0;

  const already = await prisma.lead.count({
    where: { tenantId, customData: { path: ['leadEagle', 'company'], equals: snap.company.id } },
  });
  if (already) throw new Error(`${snap.company.slug} was already moved into this workspace (${already} leads).`);

  // People, by email. Never created: an account is the owner's to invite.
  const people = await prisma.user.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, email: true, status: true, createdAt: true, role: { select: { key: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.id]));
  const userMap = new Map<Id, Id>();
  for (const user of snap.users) {
    const match = byEmail.get(user.email.toLowerCase());
    if (match) userMap.set(user.id, match);
  }
  const owned = (id: Id | null) => (id ? (userMap.get(id) ?? null) : null);
  const unmatched = snap.users.filter((u) => !userMap.has(u.id));
  for (const user of unmatched) {
    const holds = snap.leads.filter((l) => l.ownerId === user.id).length;
    if (holds) problems.push(`${user.email} owns ${holds} leads but has no account here; they move unowned.`);
  }
  const fallback =
    people.find((p) => p.status === 'ACTIVE' && p.role?.key === 'company_admin') ??
    people.find((p) => p.status === 'ACTIVE');
  if (!fallback) throw new Error('The workspace has no active user to own what must be owned.');

  try {
    await withPlatformTx(
      async (tx) => {
        // ── Pipeline ────────────────────────────────────────────────────────
        const existing = await tx.leadStage.findMany({ where: { tenantId, deletedAt: null } });
        const stageMap = new Map<Id, Id>();
        let createdStages = 0;
        for (const status of snap.statuses) {
          const key = stageKey(status.key);
          const found = existing.find((s) => s.key === key);
          if (found) {
            await tx.leadStage.update({
              where: { tenantId, id: found.id },
              data: {
                requiresReason: found.requiresReason || status.requiresReason,
                reasons: [...new Set([...found.reasons, ...status.subStatuses])],
              },
            });
            stageMap.set(status.id, found.id);
            continue;
          }
          const created = await tx.leadStage.create({
            data: {
              tenantId,
              key,
              name: status.name,
              category: CATEGORY[status.category] ?? 'OPEN',
              position: 100 + status.position,
              requiresReason: status.requiresReason,
              reasons: status.subStatuses,
              slaMinutes: status.slaMinutes,
            },
          });
          stageMap.set(status.id, created.id);
          createdStages += 1;
        }
        tally('stages', snap.statuses.length, snap.statuses.length);
        if (createdStages) problems.push(`${createdStages} stages were added to the workspace's pipeline.`);

        // ── Leads, their numbers and requirements ────────────────────────────
        // ponytail: row at a time in one transaction; batch with createManyAndReturn past ~100k leads.
        const leadMap = new Map<Id, Id>();
        let phones = 0;
        let requirements = 0;
        for (const lead of snap.leads) {
          const stageId = stageMap.get(lead.statusId);
          if (!stageId) throw new Error(`Lead ${lead.reference} is in a status the snapshot does not hold.`);
          const ownerId = owned(lead.ownerId);
          const created = await tx.lead.create({
            data: {
              tenantId,
              reference: await nextReference(tx, tenantId, 'LEAD'),
              fullName: lead.fullName,
              email: lead.email?.toLowerCase() ?? null,
              phone: lead.primaryPhone,
              phoneNormalized: lead.primaryPhone ? normalizePhone(lead.primaryPhone) : null,
              stageId,
              stageReason: lead.subStatus ?? lead.lostReason,
              ownerId,
              assignedAt: ownerId ? date(lead.createdAt) : null,
              source: recordSource(lead.source),
              sourceDetail: [lead.source, lead.campaign].filter(Boolean).join(' · ') || null,
              tags: lead.tags,
              notes:
                [lead.notes, lead.projects.length ? `Interested in projects: ${lead.projects.join(', ')}` : null]
                  .filter(Boolean)
                  .join('\n') || null,
              score: lead.score,
              createdAt: date(lead.createdAt)!,
              lastActivityAt: date(lead.lastActivityAt),
              nextFollowUpAt: date(lead.nextFollowUpAt),
              customData: { ...marker, leadEagle: { ...marker.leadEagle, id: lead.id, reference: lead.reference } },
            },
            select: { id: true },
          });
          leadMap.set(lead.id, created.id);

          const extra = lead.phones
            .map((p) => ({ ...p, normalized: normalizePhone(p.raw) }))
            .filter((p): p is typeof p & { normalized: string } => !!p.normalized);
          if (extra.length) {
            const { count } = await tx.leadPhone.createMany({
              data: extra.map((p) => ({
                tenantId,
                leadId: created.id,
                raw: p.raw,
                normalized: p.normalized,
                label: p.label,
                isWhatsapp: p.isWhatsapp,
              })),
              skipDuplicates: true,
            });
            phones += count;
          }

          const wants =
            lead.propertyTypes.length ||
            lead.budgetMin ||
            lead.budgetMax ||
            lead.bedroomsMin ||
            lead.preferredLocations.length;
          if (lead.purpose && lead.purpose !== 'SELL' && wants) {
            await tx.clientRequirement.create({
              data: {
                tenantId,
                leadId: created.id,
                purpose: lead.purpose === 'RENT' ? 'RENT' : 'BUY',
                propertyTypes: lead.propertyTypes,
                bedroomsMin: lead.bedroomsMin,
                bedroomsMax: lead.bedroomsMax,
                budgetMin: lead.budgetMin,
                budgetMax: lead.budgetMax,
                notes: lead.preferredLocations.length ? `Areas: ${lead.preferredLocations.join(', ')}` : null,
                ownerId,
              },
            });
            requirements += 1;
          }
        }
        tally('leads', snap.leads.length, leadMap.size);
        tally(
          'lead phones',
          snap.leads.reduce((n, l) => n + l.phones.length, 0),
          phones,
        );
        tally('requirements', requirements, requirements);

        // ── Timeline: activities, status changes, enquiries ─────────────────
        const typeIds = new Map<string, Id>();
        const typeId = async (kind: string) => {
          const [key, name] = ACTIVITY_TYPE[kind] ?? ACTIVITY_TYPE.NOTE!;
          if (!typeIds.has(key)) {
            const type = await tx.activityType.upsert({
              where: { tenantId_key: { tenantId, key } },
              update: {},
              create: { tenantId, key, name },
              select: { id: true },
            });
            typeIds.set(key, type.id);
          }
          return typeIds.get(key)!;
        };
        let activities = 0;
        let stageChanges = 0;
        const recordNotes = new Map<Id, string[]>();
        for (const a of snap.activities) {
          const text = [a.summary, a.body].filter(Boolean).join('\n');
          if (a.dataRecordId) {
            // Cold-data calls have no timeline here; they join the record's notes.
            recordNotes.set(a.dataRecordId, [...(recordNotes.get(a.dataRecordId) ?? []), text]);
            activities += 1;
            continue;
          }
          const leadId = a.leadId ? leadMap.get(a.leadId) : undefined;
          if (!leadId) continue;
          if (a.type === 'ENQUIRY') {
            // Lead Eagle wrote each enquiry twice; it moves once, from LeadEnquiry, with its source.
            activities += 1;
            continue;
          }
          if (a.type === 'STATUS_CHANGE' && a.toStatusId && stageMap.has(a.toStatusId)) {
            await tx.leadStageHistory.create({
              data: {
                tenantId,
                leadId,
                fromStageId: a.fromStatusId ? (stageMap.get(a.fromStatusId) ?? null) : null,
                toStageId: stageMap.get(a.toStatusId)!,
                changedById: owned(a.userId),
                reason: a.body,
                createdAt: date(a.occurredAt)!,
              },
            });
            stageChanges += 1;
            continue;
          }
          const kind = a.type === 'CALL' ? `CALL_${a.callDirection ?? 'OUTBOUND'}` : a.type;
          await tx.activity.create({
            data: {
              tenantId,
              typeId: await typeId(kind),
              leadId,
              ownerId: owned(a.userId),
              occurredAt: date(a.occurredAt)!,
              outcome: a.callOutcome,
              durationSecs: a.callDurationSecs,
              notes: ACTIVITY_TYPE[kind] ? text : `${a.type.replace(/_/g, ' ').toLowerCase()}: ${text}`,
              source: 'IMPORT',
            },
          });
          activities += 1;
        }
        for (const e of snap.enquiries) {
          const leadId = leadMap.get(e.leadId);
          if (!leadId) continue;
          await tx.activity.create({
            data: {
              tenantId,
              typeId: await typeId('NOTE'),
              leadId,
              occurredAt: date(e.receivedAt)!,
              notes: [`Enquiry via ${e.source ?? 'Lead Eagle'}`, e.message].filter(Boolean).join('\n'),
              source: 'IMPORT',
            },
          });
          activities += 1;
        }
        tally('activities and enquiries', snap.activities.length + snap.enquiries.length, activities + stageChanges);

        // ── Follow-ups ───────────────────────────────────────────────────────
        let followUps = 0;
        for (const f of snap.followUps) {
          const leadId = leadMap.get(f.leadId);
          if (!leadId) continue;
          const status: TaskStatus = f.doneAt ? 'COMPLETED' : f.cancelledAt ? 'CANCELLED' : 'OPEN';
          await tx.followUpTask.create({
            data: {
              tenantId,
              leadId,
              ownerId: owned(f.ownerId) ?? fallback.id,
              title: f.type.charAt(0) + f.type.slice(1).toLowerCase().replace(/_/g, ' '),
              description: f.note,
              dueAt: date(f.dueAt)!,
              status,
              completedAt: date(f.doneAt),
              outcome: f.outcome,
            },
          });
          followUps += 1;
        }
        tally('follow-ups', snap.followUps.length, followUps);

        // ── Cold data and QR links ──────────────────────────────────────────
        let records = 0;
        for (const r of snap.dataRecords) {
          const notes = [r.notes, ...(recordNotes.get(r.id) ?? [])].filter(Boolean).join('\n') || null;
          await tx.dataRecord.create({
            data: {
              tenantId,
              fullName: r.fullName,
              phone: r.phone,
              phoneNormalized: r.phone ? normalizePhone(r.phone) : null,
              email: r.email,
              company: r.company,
              jobTitle: r.jobTitle,
              city: r.city,
              notes,
              status: (r.status === 'JUNK' ? 'INVALID' : r.status) as DataStatus,
              batch: r.batch ?? 'Lead Eagle',
              ownerId: owned(r.ownerId),
              convertedLeadId: r.convertedLeadId ? (leadMap.get(r.convertedLeadId) ?? null) : null,
              convertedAt: date(r.convertedAt),
              createdAt: date(r.createdAt)!,
            },
          });
          records += 1;
        }
        tally('cold data', snap.dataRecords.length, records);

        const takenKeys = new Set(
          (await tx.captureLink.findMany({ where: { tenantId }, select: { key: true } })).map((l) => l.key),
        );
        for (const link of snap.captureLinks) {
          let key = link.key;
          for (let n = 2; takenKeys.has(key); n += 1) key = `${link.key}-${n}`;
          takenKeys.add(key);
          await tx.captureLink.create({
            data: {
              tenantId,
              key,
              label: link.label,
              headline: link.headline,
              ownerId: owned(link.assignToId),
              campaign: link.campaign,
              isActive: link.isActive,
              openCount: link.scans,
              submitCount: link.submissions,
            },
          });
        }
        tally('QR links', snap.captureLinks.length, snap.captureLinks.length);

        // ── Projects, units, listings ───────────────────────────────────────
        const projectMap = new Map<Id, Id>();
        const codes = new Set(
          (await tx.project.findMany({ where: { tenantId }, select: { code: true } })).map((p) => p.code),
        );
        for (const p of snap.projects) {
          const developer = p.developer
            ? await tx.developer.upsert({
                where: { tenantId_name: { tenantId, name: p.developer } },
                update: {},
                create: { tenantId, name: p.developer },
                select: { id: true },
              })
            : null;
          const stem = `LE-${
            p.name
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '')
              .slice(0, 12) || 'PROJECT'
          }`;
          let code = stem;
          for (let n = 2; codes.has(code); n += 1) code = `${stem}-${n}`;
          codes.add(code);
          const [status, possessionStatus] = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.OFF_PLAN!;
          const created = await tx.project.create({
            data: {
              tenantId,
              name: p.name,
              code,
              developerId: developer?.id ?? null,
              status,
              possessionStatus,
              possessionAt: date(p.handoverAt),
              minPrice: p.priceFrom,
              maxPrice: p.priceTo,
              reraNumber: p.permitNumber,
              address: [p.community, p.city].filter(Boolean).join(', ') || null,
              description: p.description,
              highlights: p.amenities,
            },
            select: { id: true },
          });
          projectMap.set(p.id, created.id);
        }
        tally('projects', snap.projects.length, projectMap.size);

        const unitMap = new Map<Id, Id>();
        for (const u of snap.units) {
          const projectId = projectMap.get(u.projectId);
          if (!projectId) continue;
          const created = await tx.unitInventory.create({
            data: {
              tenantId,
              projectId,
              unitNumber: u.unitNumber,
              floor: u.floor,
              facing: u.view,
              price: u.price,
              areaSqft: u.sizeSqft,
              status: u.status as UnitStatus,
              heldById: owned(u.heldById),
              heldUntil: date(u.heldUntil),
            },
            select: { id: true },
          });
          unitMap.set(u.id, created.id);
        }
        tally('units', snap.units.length, unitMap.size);

        const listingMap = new Map<Id, Id>();
        const references = new Set(
          (await tx.listing.findMany({ where: { tenantId }, select: { reference: true } })).map((l) => l.reference),
        );
        for (const l of snap.listings) {
          // A listing here must have a price (Listing_price_check); a draft without one stays behind.
          if (!l.price || Number(l.price) <= 0) {
            problems.push(`Listing ${l.reference} has no price, which a listing here needs; it is not moved.`);
            continue;
          }
          let reference = l.reference;
          for (let n = 2; references.has(reference); n += 1) reference = `${l.reference}-${n}`;
          references.add(reference);
          const landlord = l.ownerName
            ? await tx.owner.create({
                data: {
                  tenantId,
                  fullName: l.ownerName,
                  phone: l.ownerPhone,
                  phoneNormalized: l.ownerPhone ? normalizePhone(l.ownerPhone) : null,
                  email: l.ownerEmail,
                },
                select: { id: true },
              })
            : null;
          const created = await tx.listing.create({
            data: {
              tenantId,
              reference,
              title: l.title,
              listingType: l.purpose,
              status: l.status,
              propertyType: l.propertyType,
              bedrooms: l.bedrooms,
              bathrooms: l.bathrooms,
              areaSqft: l.sizeSqft,
              furnishing: l.furnishing,
              price: l.price,
              rentFrequency: l.rentFrequency,
              address: l.address,
              latitude: l.latitude,
              longitude: l.longitude,
              highlights: l.amenities,
              description: l.description,
              permitNumber: l.permitNumber,
              availableFrom: date(l.availableFrom),
              ownerId: owned(l.agentId),
              propertyOwnerId: landlord?.id ?? null,
            },
            select: { id: true },
          });
          listingMap.set(l.id, created.id);
        }
        tally('listings', snap.listings.length, listingMap.size);

        // ── Bookings and commissions ────────────────────────────────────────
        const bookingMap = new Map<Id, { id: Id; value: string }>();
        for (const b of snap.bookings) {
          const leadId = leadMap.get(b.leadId);
          const projectId = b.projectId ? (projectMap.get(b.projectId) ?? null) : null;
          const unitInventoryId = b.unitId ? (unitMap.get(b.unitId) ?? null) : null;
          const listingId = b.listingId ? (listingMap.get(b.listingId) ?? null) : null;
          // The booking rules here (Booking_buyer_check, _subject_check,
          // _sale_value_check): a buyer, something bought, and a price.
          if (!leadId) {
            problems.push(`Booking ${b.reference} is on a lead that did not move; it is not moved.`);
            continue;
          }
          if (!projectId && !unitInventoryId && !listingId) {
            problems.push(
              `Booking ${b.reference} is on nothing that moved (its listing stayed behind); it is not moved.`,
            );
            continue;
          }
          if (!(Number(b.dealValue) > 0)) {
            problems.push(`Booking ${b.reference} has no deal value; it is not moved.`);
            continue;
          }
          let status = BOOKING_STATUS[b.status] ?? 'DRAFT';
          // A confirmed booking here names its unit (Booking_confirmed_requires_unit).
          if (status === 'CONFIRMED' && !unitInventoryId) {
            status = 'DRAFT';
            problems.push(`Booking ${b.reference} was confirmed but names no unit; it moves as a draft.`);
          }
          const lead = snap.leads.find((l) => l.id === b.leadId);
          const ownerId = owned(lead?.ownerId ?? null) ?? owned(b.createdById);
          if (!ownerId)
            problems.push(`Booking ${b.reference} has no owner with an account; it is given to ${fallback.email}.`);
          const created = await tx.booking.create({
            data: {
              tenantId,
              reference: await nextReference(tx, tenantId, 'BOOKING'),
              leadId,
              projectId,
              unitInventoryId,
              listingId,
              ownerId: ownerId ?? fallback.id,
              status,
              saleValue: b.dealValue,
              bookingDate: date(b.bookingDate)!,
              // Both or neither (Booking_cancel_check).
              cancelledAt: status === 'CANCELLED' ? date(b.updatedAt) : null,
              cancelReason: status === 'CANCELLED' ? (b.cancelReason ?? 'Cancelled in Lead Eagle') : null,
              notes: [
                `Lead Eagle booking ${b.reference}${b.status === 'COMPLETED' ? ' (completed)' : ''}.`,
                Number(b.received) > 0 ? `Received AED ${b.received}.` : null,
                b.notes,
              ]
                .filter(Boolean)
                .join('\n'),
            },
            select: { id: true },
          });
          bookingMap.set(b.id, { id: created.id, value: b.dealValue });
        }
        tally('bookings', snap.bookings.length, bookingMap.size);

        let commissions = 0;
        for (const c of snap.commissions) {
          const booking = bookingMap.get(c.bookingId);
          const userId = owned(c.userId);
          if (!booking) continue;
          if (!userId) {
            problems.push(
              `A commission of AED ${c.amount} on a booking is owed to ${c.externalName ?? 'someone without an account'}; it is not moved.`,
            );
            continue;
          }
          const status = COMMISSION_STATUS[c.status] ?? 'ACCRUED';
          await tx.commission.create({
            data: {
              tenantId,
              bookingId: booking.id,
              userId,
              status,
              baseAmount: booking.value,
              sharePct: c.percent ?? '100',
              amount: c.amount,
              collectedAt: status === 'COLLECTED' ? date(c.paidAt) : null,
              clawbackNote: status === 'CLAWED_BACK' ? 'Written off in Lead Eagle' : null,
            },
          });
          commissions += 1;
        }
        tally('commissions', snap.commissions.length, commissions);

        // ── The check, before anything is kept ─────────────────────────────
        const moved = await tx.lead.findMany({
          where: { tenantId, customData: { path: ['leadEagle', 'company'], equals: snap.company.id } },
          select: { id: true, fullName: true, phoneNormalized: true, stageId: true, ownerId: true, customData: true },
        });
        if (moved.length !== snap.leads.length) {
          throw new Error(`Moved ${moved.length} leads of ${snap.leads.length}; nothing was kept.`);
        }
        const sample = [0, Math.floor(snap.leads.length / 2), snap.leads.length - 1].filter((i) => i >= 0);
        for (const i of new Set(sample)) {
          const source = snap.leads[i]!;
          const row = moved.find((m) => m.id === leadMap.get(source.id));
          const expected = source.primaryPhone ? normalizePhone(source.primaryPhone) : null;
          if (
            !row ||
            row.fullName !== source.fullName ||
            row.phoneNormalized !== expected ||
            row.stageId !== stageMap.get(source.statusId) ||
            row.ownerId !== owned(source.ownerId)
          ) {
            throw new Error(`Lead ${source.reference} did not arrive as it left; nothing was kept.`);
          }
        }

        if (options.enableRealEstate && needsRealEstate) {
          await tx.moduleEntitlement.upsert({
            where: { tenantId_module: { tenantId, module: 'REAL_ESTATE' } },
            update: { state: 'ACTIVE' },
            create: { tenantId, module: 'REAL_ESTATE', state: 'ACTIVE' },
          });
        }
        if (!options.commit) throw new DryRun();
      },
      { timeoutMs: 30 * 60_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }

  if (options.commit && options.enableRealEstate && needsRealEstate) await invalidateEntitlements(tenantId);
  if (needsRealEstate && !options.enableRealEstate) {
    problems.push(
      'This company has projects, listings or bookings, which Real Estate shows and Lead Eagle does not: rerun with --enable-real-estate, or switch it on in the platform portal.',
    );
  }
  return { committed: options.commit, counts, problems, notMoved: snap.notMoved, needsRealEstate };
}
