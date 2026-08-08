#!/usr/bin/env node
/**
 * Demo data for the real-estate modules, so the new screens have something on
 * them. Projects, listings, owners, mandates, requirements, a dial queue and a
 * few site visits, all for one workspace.
 *
 * Synthetic throughout — invented developers, invented landlords, coordinates
 * that are real places but attached to nothing real. Idempotent: re-running
 * tops up rather than duplicating.
 *
 *   node seed-realestate-demo.mjs [workspace-slug]
 */
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

const root = 'C:/Users/admin/Downloads/Master App/master-saas/apps/web';
for (const file of [`${root}/.env`]) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
  }
}

const slug = process.argv[2] ?? 'manath-homes';
const db = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
await db.connect();

const { rows: tenants } = await db.query(`SELECT id FROM "Tenant" WHERE slug = $1`, [slug]);
if (!tenants.length) {
  console.error(`No workspace with slug ${slug}`);
  process.exit(1);
}
const T = tenants[0].id;

// Every table below is FORCE ROW LEVEL SECURITY, which applies to the owner
// too. Without this the inserts fail their WITH CHECK.
await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [T]);

const { rows: users } = await db.query(
  `SELECT id, "fullName" FROM "User" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 6`,
  [T],
);
const { rows: leads } = await db.query(
  `SELECT id, "fullName", phone FROM "Lead" WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND phone IS NOT NULL ORDER BY "createdAt" LIMIT 40`,
  [T],
);
const agent = users[0]?.id;
if (!agent) {
  console.error('No users in that workspace');
  process.exit(1);
}

/**
 * Cuid-shaped, deliberately. Every route validates its path parameter with
 * `z.string().cuid()`, which requires a leading `c` — readable ids like
 * `lst_demo_3` sail through the seed and then 422 the moment a page asks for
 * that record. Demo data has to be shaped like real data or it tests nothing.
 */
const id = (p, n) => `c${p}demo${String(n).padStart(4, '0')}`;
const q = (sql, params) => db.query(sql, params);

// ── Reference data ──────────────────────────────────────────────────────────
const developers = [
  ['Aurora Developments', 2009],
  ['Cadence Properties', 2014],
  ['Northline Estates', 1998],
];
for (const [i, [name, year]] of developers.entries()) {
  await q(
    `INSERT INTO "Developer" ("id","tenantId","name","establishedYear","updatedAt")
     VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT ("tenantId","name") DO NOTHING`,
    [id('dev', i), T, name, year],
  );
}

const micromarkets = [
  ['Marina', 'Dubai', 25.0805, 55.1403],
  ['Downtown', 'Dubai', 25.1972, 55.2744],
  ['Business Bay', 'Dubai', 25.1857, 55.2645],
  ['Yas Island', 'Abu Dhabi', 24.4997, 54.6067],
];
for (const [i, [name, city, lat, lng]] of micromarkets.entries()) {
  await q(
    `INSERT INTO "Micromarket" ("id","tenantId","name","city","latitude","longitude","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT ("tenantId","city","name") DO NOTHING`,
    [id('mm', i), T, name, city, lat, lng],
  );
}

const amenities = [
  ['pool', 'Swimming pool', 'Leisure'],
  ['gym', 'Gymnasium', 'Leisure'],
  ['parking', 'Covered parking', 'Practical'],
  ['beach', 'Beach access', 'Leisure'],
  ['concierge', 'Concierge', 'Service'],
  ['security', '24h security', 'Service'],
  ['kids', "Children's play area", 'Family'],
  ['retail', 'Retail podium', 'Practical'],
];
for (const [i, [key, label, category]] of amenities.entries()) {
  await q(
    `INSERT INTO "Amenity" ("id","tenantId","key","label","category","position","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT ("tenantId","key") DO NOTHING`,
    [id('am', i), T, key, label, category, i],
  );
}

// ── Projects ────────────────────────────────────────────────────────────────
const projects = [
  [
    'Aurora Marina Residences',
    'AMR-01',
    0,
    0,
    'LAUNCHED',
    'UNDER_CONSTRUCTION',
    1_250_000,
    4_800_000,
    1650,
    ['1BHK', '2BHK', '3BHK'],
    ['pool', 'gym', 'beach', 'concierge'],
    true,
  ],
  [
    'Cadence Downtown Tower',
    'CDT-02',
    1,
    1,
    'READY',
    'READY_TO_MOVE',
    1_900_000,
    7_500_000,
    2100,
    ['2BHK', '3BHK', 'PENTHOUSE'],
    ['pool', 'gym', 'concierge', 'retail'],
    true,
  ],
  [
    'Northline Bay Lofts',
    'NBL-03',
    2,
    2,
    'UNDER_CONSTRUCTION',
    'UNDER_CONSTRUCTION',
    890_000,
    2_400_000,
    1420,
    ['STUDIO', '1BHK'],
    ['gym', 'parking', 'security'],
    false,
  ],
  [
    'Aurora Yas Villas',
    'AYV-04',
    0,
    3,
    'PRE_LAUNCH',
    'NEW_LAUNCH',
    3_400_000,
    9_800_000,
    1980,
    ['VILLA'],
    ['pool', 'kids', 'security', 'parking'],
    true,
  ],
  [
    'Cadence Marina Heights',
    'CMH-05',
    1,
    0,
    'LAUNCHED',
    'UNDER_CONSTRUCTION',
    1_050_000,
    3_100_000,
    1530,
    ['1BHK', '2BHK'],
    ['pool', 'gym', 'parking'],
    false,
  ],
  [
    'Northline Downtown Suites',
    'NDS-06',
    2,
    1,
    'SOLD_OUT',
    'READY_TO_MOVE',
    2_200_000,
    5_600_000,
    2350,
    ['2BHK', '3BHK'],
    ['gym', 'concierge', 'security'],
    false,
  ],
];

for (const [i, p] of projects.entries()) {
  const [name, code, devIdx, mmIdx, status, possession, min, max, rate, types, ams, priority] = p;
  const mm = micromarkets[mmIdx];
  const total = 120 + i * 40;
  const sold = i === 5 ? total : Math.round(total * 0.35);
  await q(
    `INSERT INTO "Project"
       ("id","tenantId","name","code","developerId","micromarketId","status","possessionStatus","possessionAt",
        "minPrice","maxPrice","pricePerSqft","currency","minAreaSqft","maxAreaSqft","unitTypes","amenityKeys",
        "highlights","address","latitude","longitude","description","reraNumber","reraAuthority","reraExpiresAt",
        "totalUnits","availableUnits","soldUnits","isPriority","isPitchable","launchedAt","createdAt","updatedAt","createdById")
     VALUES ($1,$2,$3,$4,$5,$6,$7::"ProjectStatus",$8::"PossessionStatus",NOW() + ($9 || ' months')::interval,
             $10,$11,$12,'AED',$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,'DLD',NOW() + interval '18 months',
             $23,$24,$25,$26,true,NOW() - interval '90 days',NOW(),NOW(),$27)
     ON CONFLICT ("tenantId","code") DO NOTHING`,
    [
      id('prj', i),
      T,
      name,
      code,
      id('dev', devIdx),
      id('mm', mmIdx),
      status,
      possession,
      String(6 + i * 4),
      min,
      max,
      rate,
      480 + i * 120,
      1400 + i * 600,
      types,
      ams,
      ['Handover with white goods', 'Post-handover payment plan', 'Direct developer inventory'],
      `${mm[0]}, ${mm[1]}`,
      mm[2] + i * 0.002,
      mm[3] + i * 0.002,
      `${name} is a ${types.join('/')} development in ${mm[0]}, ${mm[1]}. Demo data.`,
      `RERA-${1000 + i}`,
      total,
      total - sold,
      sold,
      priority,
      agent,
    ],
  );
}

// Unit plans and real units for the first two projects.
for (const pi of [0, 1]) {
  const plans =
    pi === 0
      ? [
          ['1 BHK Type A', '1BHK', 1, 1, 720, 1_250_000],
          ['2 BHK Type B', '2BHK', 2, 2, 1180, 2_100_000],
          ['3 BHK Corner', '3BHK', 3, 3, 1740, 3_400_000],
        ]
      : [
          ['2 BHK Skyline', '2BHK', 2, 2, 1290, 1_900_000],
          ['3 BHK Panorama', '3BHK', 3, 3, 1880, 3_600_000],
        ];

  for (const [j, [name, type, beds, baths, area, price]] of plans.entries()) {
    await q(
      `INSERT INTO "UnitPlan" ("id","tenantId","projectId","name","unitType","bedrooms","bathrooms","carpetAreaSqft","price","currency","position","updatedAt","createdById")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AED',$10,NOW(),$11) ON CONFLICT ("id") DO NOTHING`,
      [id(`plan${pi}`, j), T, id('prj', pi), name, type, beds, baths, area, price, j, agent],
    );
  }

  let n = 0;
  for (let floor = 1; floor <= 8; floor++) {
    for (let unit = 1; unit <= 4; unit++) {
      const status = n % 7 === 0 ? 'SOLD' : n % 5 === 0 ? 'HELD' : n % 11 === 0 ? 'BOOKED' : 'AVAILABLE';
      await q(
        `INSERT INTO "UnitInventory" ("id","tenantId","projectId","unitPlanId","tower","floor","unitNumber","status","price","currency","areaSqft","facing","heldUntil","updatedAt","createdById")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"UnitStatus",$9,'AED',$10,$11,$12,NOW(),$13)
         ON CONFLICT ("projectId","unitNumber") DO NOTHING`,
        [
          id(`unit${pi}`, n),
          T,
          id('prj', pi),
          id(`plan${pi}`, n % (pi === 0 ? 3 : 2)),
          pi === 0 ? 'Tower A' : 'Tower 1',
          floor,
          `${floor}0${unit}`,
          status,
          1_250_000 + n * 45_000,
          720 + (n % 3) * 300,
          ['Sea', 'City', 'Park', 'Boulevard'][n % 4],
          status === 'HELD' ? new Date(Date.now() + 36 * 3600_000) : null,
          agent,
        ],
      );
      n++;
    }
  }
}

// ── Owners, listings, mandates ──────────────────────────────────────────────
const owners = [
  ['Yusuf Rahman', '+971501110001', 'yusuf.demo@example.com', 'AE'],
  ['Priya Menon', '+971501110002', 'priya.demo@example.com', 'IN'],
  ['Tom Whelan', '+971501110003', 'tom.demo@example.com', 'IE'],
];
for (const [i, [name, phone, email, nat]] of owners.entries()) {
  await q(
    `INSERT INTO "Owner" ("id","tenantId","fullName","phone","phoneNormalized","email","nationality","ownerId","updatedAt","createdById")
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,NOW(),$7) ON CONFLICT ("id") DO NOTHING`,
    [id('own', i), T, name, phone, email, nat, agent],
  );
}

const listings = [
  [
    'Marina 2-bed with full sea view',
    'SALE',
    'APARTMENT',
    0,
    0,
    2,
    2,
    1180,
    2_450_000,
    null,
    'FURNISHED',
    ['pool', 'gym', 'beach'],
  ],
  [
    'Downtown 3-bed, Burj facing',
    'SALE',
    'APARTMENT',
    1,
    1,
    3,
    3,
    1890,
    4_900_000,
    null,
    'SEMI_FURNISHED',
    ['pool', 'concierge'],
  ],
  [
    'Business Bay 1-bed, ready now',
    'RENT',
    'APARTMENT',
    2,
    2,
    1,
    1,
    760,
    95_000,
    'YEARLY',
    'FURNISHED',
    ['gym', 'parking'],
  ],
  [
    'Yas Island 4-bed villa',
    'RENT',
    'VILLA',
    0,
    3,
    4,
    5,
    3400,
    260_000,
    'YEARLY',
    'UNFURNISHED',
    ['pool', 'kids', 'security'],
  ],
];
for (const [i, l] of listings.entries()) {
  const [title, type, prop, ownIdx, mmIdx, beds, baths, area, price, freq, furn, ams] = l;
  const mm = micromarkets[mmIdx];
  await q(
    `INSERT INTO "Listing"
       ("id","tenantId","reference","title","listingType","status","propertyType","propertyOwnerId","ownerId",
        "micromarketId","address","latitude","longitude","bedrooms","bathrooms","areaSqft","parkingSpaces",
        "furnishing","price","currency","rentFrequency","availableFrom","amenityKeys","highlights","description",
        "mandateType","mandateExpires","publishedAt","createdAt","updatedAt","createdById")
     VALUES ($1,$2,$3,$4,$5::"ListingType",'ACTIVE',$6::"PropertyType",$7,$8,
             $9,$10,$11,$12,$13,$14,$15,1,
             $16::"Furnishing",$17,'AED',$18::"RentFrequency",NOW(),$19,$20,$21,
             $22::"MandateType",NOW() + ($23 || ' days')::interval,NOW(),NOW(),NOW(),$24)
     ON CONFLICT ("tenantId","reference") DO NOTHING`,
    [
      id('lst', i),
      T,
      `LS-${String(900 + i).padStart(6, '0')}`,
      title,
      type,
      prop,
      id('own', ownIdx),
      agent,
      id('mm', mmIdx),
      `${mm[0]}, ${mm[1]}`,
      mm[2] - 0.003,
      mm[3] - 0.003,
      beds,
      baths,
      area,
      furn,
      price,
      freq,
      ams,
      ['Vacant on transfer', 'Chiller free'],
      `${title}. Demo listing data.`,
      i % 2 === 0 ? 'EXCLUSIVE' : 'NON_EXCLUSIVE',
      // The last one expires inside the month, so the chase banner has something.
      String(i === 3 ? 12 : 120 + i * 30),
      agent,
    ],
  );

  await q(
    `INSERT INTO "Mandate" ("id","tenantId","listingId","ownerId","type","status","startsAt","expiresAt","commissionPct","currency","signedAt","updatedAt","createdById")
     VALUES ($1,$2,$3,$4,$5::"MandateType",'ACTIVE',NOW() - interval '30 days',NOW() + ($6 || ' days')::interval,$7,'AED',NOW() - interval '30 days',NOW(),$8)
     ON CONFLICT ("id") DO NOTHING`,
    [
      id('mnd', i),
      T,
      id('lst', i),
      id('own', ownIdx),
      i % 2 === 0 ? 'EXCLUSIVE' : 'NON_EXCLUSIVE',
      String(i === 3 ? 12 : 120 + i * 30),
      2.5,
      agent,
    ],
  );
}

// ── Client requirements, so the demand check has something to match ─────────
const requirements = [
  ['BUY', ['APARTMENT'], [0, 1], 2, 3, 1_500_000, 3_000_000, 'Wants a sea view, flexible on handover date.'],
  ['RENT', ['APARTMENT'], [2], 1, 2, 70_000, 120_000, 'Relocating in March, needs furnished.'],
  ['BUY', ['VILLA'], [3], 4, 5, 3_000_000, 6_000_000, 'Family of five, schools nearby matter most.'],
];
for (const [i, r] of requirements.entries()) {
  const [purpose, types, mmIdxs, bmin, bmax, budgetMin, budgetMax, notes] = r;
  const lead = leads[i];
  if (!lead) continue;
  await q(
    `INSERT INTO "ClientRequirement"
       ("id","tenantId","leadId","purpose","status","propertyTypes","micromarketIds","bedroomsMin","bedroomsMax",
        "budgetMin","budgetMax","currency","notes","ownerId","updatedAt","createdById")
     VALUES ($1,$2,$3,$4::"RequirementPurpose",'OPEN',$5::"PropertyType"[],$6,$7,$8,$9,$10,'AED',$11,$12,NOW(),$12)
     ON CONFLICT ("id") DO NOTHING`,
    [
      id('req', i),
      T,
      lead.id,
      purpose,
      types,
      mmIdxs.map((x) => id('mm', x)),
      bmin,
      bmax,
      budgetMin,
      budgetMax,
      notes,
      agent,
    ],
  );
}

// ── A calling campaign with a dial queue ───────────────────────────────────
await q(
  `INSERT INTO "Campaign" ("id","tenantId","name","code","campaignType","status","startDate","currency","updatedAt","createdById","ownerId")
   VALUES ($1,$2,'Marina launch — outbound','CMP-DEMO-01','CALLING','RUNNING',NOW(),'AED',NOW(),$3,$3)
   ON CONFLICT ("tenantId","code") DO NOTHING`,
  [id('cmp', 0), T, agent],
);

let position = 0;
const usedNumbers = new Set();
for (const lead of leads.slice(0, 30)) {
  const phone = lead.phone;
  if (!phone || usedNumbers.has(phone)) continue;
  usedNumbers.add(phone);
  const status = position < 3 ? 'COMPLETED' : position === 3 ? 'CALLBACK' : 'PENDING';
  await q(
    `INSERT INTO "CampaignContact"
       ("id","tenantId","campaignId","leadId","displayName","phone","phoneNormalized","status","position",
        "attempts","nextAttemptAt","updatedAt","createdById")
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7::"CampaignContactStatus",$8,$9,$10,NOW(),$11)
     ON CONFLICT ("campaignId","phoneNormalized") DO NOTHING`,
    [
      id('cc', position),
      T,
      id('cmp', 0),
      lead.id,
      lead.fullName,
      phone,
      status,
      position,
      status === 'COMPLETED' ? 1 : 0,
      status === 'CALLBACK' ? new Date(Date.now() + 2 * 3600_000) : null,
      agent,
    ],
  );
  position++;
}

// ── Site visits across the register ────────────────────────────────────────
const visits = [
  ['PROPERTY_VISIT', 'REQUESTED', 0, 2, null, null],
  ['PROPERTY_VISIT', 'APPROVED', 1, 26, null, null],
  ['PROPERTY_VISIT', 'COMPLETED', 0, -20, 25.0806, 55.1404],
  // Punched from the far side of town: flagged, not refused.
  ['PROPERTY_VISIT', 'COMPLETED', 1, -44, 25.1972, 55.2744],
  ['CLIENT_MEETING', 'APPROVED', null, 50, null, null],
];
for (const [i, v] of visits.entries()) {
  const [kind, status, prjIdx, hours, lat, lng] = v;
  const lead = leads[i + 3];
  if (!lead) continue;
  const suspect = i === 3;
  await q(
    `INSERT INTO "SiteVisit"
       ("id","tenantId","kind","ownerId","leadId","projectId","address","status","verification","scheduledAt",
        "durationMin","decidedById","decidedAt","checkInAt","checkInLat","checkInLng","checkInAccuracy",
        "checkOutAt","distanceMeters","geofenceOk","locationSuspect","suspectReason","outcome","notes",
        "createdAt","updatedAt","createdById")
     VALUES ($1,$2,$3::"SiteVisitKind",$4,$5,$6,$7,$8::"SiteVisitStatus",'PENDING',NOW() + ($9 || ' hours')::interval,
             60,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW(),$4)
     ON CONFLICT ("id") DO NOTHING`,
    [
      id('sv', i),
      T,
      kind,
      agent,
      lead.id,
      prjIdx === null ? null : id('prj', prjIdx),
      prjIdx === null ? 'Emirates Towers, Sheikh Zayed Road, Dubai' : null,
      status,
      String(hours),
      status === 'REQUESTED' ? null : (users[1]?.id ?? agent),
      status === 'REQUESTED' ? null : new Date(Date.now() - 86_400_000),
      lat ? new Date(Date.now() + hours * 3600_000) : null,
      lat,
      lng,
      lat ? 14 : null,
      lat ? new Date(Date.now() + (hours + 1) * 3600_000) : null,
      lat ? (suspect ? 19_400 : 18) : null,
      lat ? !suspect : null,
      suspect,
      suspect ? 'implied travel of 412 km/h from the previous punch' : null,
      status === 'COMPLETED'
        ? suspect
          ? 'Client liked it, wants pricing'
          : 'Very interested, second viewing next week'
        : null,
      'Demo visit data.',
    ],
  );
}

const { rows: counts } = await db.query(
  `SELECT
     (SELECT count(*) FROM "Project" WHERE "tenantId"=$1) projects,
     (SELECT count(*) FROM "UnitInventory" WHERE "tenantId"=$1) units,
     (SELECT count(*) FROM "Listing" WHERE "tenantId"=$1) listings,
     (SELECT count(*) FROM "Owner" WHERE "tenantId"=$1) owners,
     (SELECT count(*) FROM "ClientRequirement" WHERE "tenantId"=$1) requirements,
     (SELECT count(*) FROM "CampaignContact" WHERE "tenantId"=$1) dial_queue,
     (SELECT count(*) FROM "SiteVisit" WHERE "tenantId"=$1) visits`,
  [T],
);
console.log(`workspace ${slug}`);
console.table(counts[0]);
await db.end();
