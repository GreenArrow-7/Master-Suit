/**
 * Move one company from the standalone Lead Eagle into a YOUHAN ONE workspace
 * (Lead Eagle plan, phase 5).
 *
 *   LEAD_EAGLE_DATABASE_URL=postgres://… \
 *   tsx --env-file=.env scripts/move-lead-eagle.ts --company <lead eagle slug> --into <workspace slug>
 *     [--commit] [--enable-real-estate]
 *
 * Without --commit it is a dry run: every write is made and checked inside one
 * transaction, then rolled back, and the report says what would move and what
 * needs a person first (users to invite, owners missing). Run it against a
 * copy, invite the people it names, then run it with --commit while the
 * standalone app is read-only. The workspace must exist already — made in the
 * platform portal with Lead Eagle — and its users are matched by email.
 *
 * The URL is read from the environment, never the command line, so it stays
 * out of shell history.
 */
import { Client } from 'pg';
import { prisma } from '../src/lib/db';
import { hasModuleEntitlement, LEAD_MODULES } from '../src/lib/security/entitlements';
import { moveCompany, type LeadEagleCompany } from '../src/services/platform/leadEagleMove';

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Tables left behind, reported with their row counts so nothing goes silently. */
const NOT_MOVED = [
  'Proposal',
  'MediaAsset',
  'PaymentPlan',
  'CustomFieldDefinition',
  'SavedView',
  'AssignmentRule',
  'Integration',
  'WorkLocation',
  'FaceEnrollment',
  'AttendanceShift',
  'PhoneCall',
  'PortalFeed',
];

export async function readCompany(db: Client, slug: string): Promise<LeadEagleCompany> {
  // The standalone has its own row-level security; read it as its platform admin.
  await db.query(`select set_config('app.platform_admin', 'on', false)`);
  const rows = async <T>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];

  const [company] = await rows<{ id: string; slug: string; name: string }>(
    `select id, slug, name from "Tenant" where slug = $1 and "deletedAt" is null`,
    [slug],
  );
  if (!company) throw new Error(`No Lead Eagle company with the slug ${slug}.`);
  const t = [company.id];
  const live = `"tenantId" = $1 and "deletedAt" is null`;

  const leads = await rows<LeadEagleCompany['leads'][number] & { otherPhones: unknown }>(
    `select l.id, l.reference, l."fullName", l.email, l."primaryPhone", l."statusId",
            sub.name as "subStatus", l."lostReason", l."ownerId",
            nullif(concat_ws(' / ', src.name, subsrc.name), '') as source, l.campaign, l.tags, l.notes, l.score,
            l.purpose::text as purpose, l."propertyTypes"::text[] as "propertyTypes", l."bedroomsMin", l."bedroomsMax",
            l."budgetMin", l."budgetMax", l."preferredLocations", l."createdAt", l."lastActivityAt", l."nextFollowUpAt",
            coalesce((select array_agg(p.name order by p.name) from "LeadProject" lp join "Project" p on p.id = lp."projectId"
                       where lp."leadId" = l.id), '{}') as projects,
            coalesce((select json_agg(json_build_object('raw', p.raw, 'label', p.label, 'isWhatsapp', p."isWhatsapp"))
                        from "LeadPhone" p
                       where p."leadId" = l.id and not p."isPrimary"
                         and p.normalized is distinct from l."primaryPhoneNormalized"), '[]') as "otherPhones"
       from "Lead" l
       left join "LeadSubStatus" sub on sub.id = l."subStatusId"
       left join "LeadSource" src on src.id = l."sourceId"
       left join "LeadSource" subsrc on subsrc.id = l."subSourceId"
      where l."tenantId" = $1 and l."deletedAt" is null and l."mergedIntoId" is null
      order by l."createdAt"`,
    t,
  );

  const notMoved: Record<string, number> = {};
  for (const table of NOT_MOVED) {
    const [{ n }] = await rows<{ n: number }>(`select count(*)::int as n from "${table}" where "tenantId" = $1`, t);
    if (n) notMoved[table] = n;
  }
  const [{ merged }] = await rows<{ merged: number }>(
    `select count(*)::int as merged from "Lead" where ${live} and "mergedIntoId" is not null`,
    t,
  );
  if (merged) notMoved['Lead (merged duplicates)'] = merged;

  return {
    company,
    users: await rows(`select id, email, "fullName" from "User" where ${live}`, t),
    // Live statuses, and any retired one a live lead still sits in.
    statuses: await rows(
      `select s.id, s.key, s.name, s.category::text as category, s.position, s."requiresReason", s."slaMinutes",
              coalesce(array_agg(ss.name order by ss.position) filter (where ss.id is not null), '{}') as "subStatuses"
         from "LeadStatus" s
         left join "LeadSubStatus" ss on ss."statusId" = s.id and ss."deletedAt" is null
        where s."tenantId" = $1
          and (s."deletedAt" is null or s.id in (select "statusId" from "Lead" where ${live}))
        group by s.id`,
      t,
    ),
    leads: leads.map(({ otherPhones, ...lead }) => ({
      ...lead,
      phones: otherPhones as LeadEagleCompany['leads'][number]['phones'],
    })),
    activities: await rows(
      `select "leadId", "dataRecordId", "userId", type::text as type, summary, body,
              "callDirection"::text as "callDirection", "callOutcome"::text as "callOutcome", "callDurationSecs",
              "fromStatusId", "toStatusId", "occurredAt"
         from "Activity" where "tenantId" = $1 order by "occurredAt"`,
      t,
    ),
    enquiries: await rows(
      `select e."leadId", s.name as source, e.message, e."receivedAt"
         from "LeadEnquiry" e left join "LeadSource" s on s.id = e."sourceId"
        where e."tenantId" = $1 order by e."receivedAt"`,
      t,
    ),
    followUps: await rows(
      `select "leadId", "ownerId", type::text as type, "dueAt", note, "doneAt", outcome, "cancelledAt"
         from "FollowUp" where "tenantId" = $1`,
      t,
    ),
    dataRecords: await rows(
      `select id, "fullName", phone, email, company, "jobTitle", city, notes, status::text as status, batch,
              "ownerId", "convertedLeadId", "convertedAt", "createdAt"
         from "DataRecord" where ${live}`,
      t,
    ),
    captureLinks: await rows(
      `select c.key, c.label, c.headline, c."assignToId", coalesce(p.name, l.title) as campaign,
              c."isActive", c.scans, c.submissions
         from "CaptureLink" c
         left join "Project" p on p.id = c."projectId"
         left join "Listing" l on l.id = c."listingId"
        where c."tenantId" = $1 and c."deletedAt" is null`,
      t,
    ),
    projects: await rows(
      `select id, name, developer, community, city, status::text as status, "handoverAt",
              "priceFromAed" as "priceFrom", "priceToAed" as "priceTo", "permitNumber", description, amenities
         from "Project" where ${live}`,
      t,
    ),
    units: await rows(
      `select id, "projectId", "unitNumber", floor, view, "priceAed" as price, "sizeSqft", status::text as status,
              "heldById", "heldUntil"
         from "Unit" where ${live}`,
      t,
    ),
    listings: await rows(
      `select id, reference, title, purpose::text as purpose, "propertyType"::text as "propertyType",
              status::text as status, bedrooms, bathrooms, "sizeSqft", furnishing::text as furnishing,
              "priceAed" as price, "rentFrequency"::text as "rentFrequency",
              nullif(concat_ws(', ', "addressLine", community, city), '') as address, latitude, longitude, amenities,
              description, "permitNumber", "availableFrom", "ownerName", "ownerPhone", "ownerEmail", "agentId"
         from "Listing" where ${live}`,
      t,
    ),
    bookings: await rows(
      `select id, reference, "leadId", "unitId", "projectId", "listingId", status::text as status, "bookingDate",
              "dealValueAed" as "dealValue", "receivedAed" as received, "cancelReason", notes, "createdById", "updatedAt"
         from "Booking" where ${live}`,
      t,
    ),
    commissions: await rows(
      `select c."bookingId", c."userId", c."externalName", c.percent, c."amountAed" as amount,
              c.status::text as status, c."paidAt"
         from "Commission" c join "Booking" b on b.id = c."bookingId"
        where c."tenantId" = $1 and c."deletedAt" is null and b."deletedAt" is null`,
      t,
    ),
    notMoved,
  };
}

async function main() {
  const slug = arg('company');
  const into = arg('into');
  const url = process.env.LEAD_EAGLE_DATABASE_URL;
  if (!slug || !into || !url) {
    throw new Error(
      'Usage: LEAD_EAGLE_DATABASE_URL=… move-lead-eagle.ts --company <slug> --into <workspace> [--commit]',
    );
  }

  const workspace = await prisma.tenant.findFirst({ where: { slug: into, deletedAt: null }, select: { id: true } });
  if (!workspace) throw new Error(`No workspace ${into}. Make it in the platform portal first, with Lead Eagle.`);
  const entitled = await Promise.all(LEAD_MODULES.map((module) => hasModuleEntitlement(workspace.id, module)));
  if (!entitled.some(Boolean)) throw new Error(`${into} has no lead module. Give it Lead Eagle first.`);

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const snapshot = await readCompany(db, slug);
    const commit = flag('commit');
    const report = await moveCompany(workspace.id, snapshot, { commit, enableRealEstate: flag('enable-real-estate') });

    console.log(`\n${commit ? 'MOVED' : 'DRY RUN (nothing kept)'}: ${snapshot.company.name} → ${into}\n`);
    console.table(report.counts);
    if (Object.keys(report.notMoved).length) {
      console.log('Not moved (rows):');
      console.table(report.notMoved);
    }
    for (const problem of report.problems) console.log(`- ${problem}`);
  } finally {
    await db.end();
    await prisma.$disconnect();
  }
}

// Exits explicitly: the app's modules keep connections (Redis, the pool) open,
// and a one-off command should not wait on them.
if (process.argv[1]?.includes('move-lead-eagle')) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
