#!/usr/bin/env node
/**
 * The 100k-row acceptance check for the project catalogue.
 *
 * The module's requirement is that every list route answers under 400 ms at
 * 100 000 projects, using Postgres indexes rather than a search engine. That
 * cannot live in the test suite — seeding 100k rows on every run would make the
 * suite unusable — so it lives here and is run deliberately.
 *
 *   node scripts/bench-projects.mjs            # seed 100k, measure, leave data
 *   node scripts/bench-projects.mjs --rows 250000
 *   node scripts/bench-projects.mjs --clean    # remove the benchmark tenant
 *
 * Timings are measured against the *application* role, not the owner, so
 * row-level security is in the plan exactly as it is in production. Measuring
 * as the owner would quietly skip the policy and report a number the real
 * server never achieves.
 */
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

for (const file of ['.env.test', '.env']) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
  }
  break;
}

const args = process.argv.slice(2);
const rows = Number(args[args.indexOf('--rows') + 1]) || 100_000;
const clean = args.includes('--clean');

const TENANT = 'bench-catalogue-tenant';
const BUDGET_MS = 400;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Every statement runs with the tenant pinned, the way the Prisma extension
// pins it per query. Without this, RLS returns nothing and the benchmark
// measures an empty table very quickly.
const pin = () => client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);
await pin();

if (clean) {
  await client.query(`DELETE FROM "Project" WHERE "tenantId" = $1`, [TENANT]);
  await client.query(`DELETE FROM "Micromarket" WHERE "tenantId" = $1`, [TENANT]);
  await client.query(`DELETE FROM "Developer" WHERE "tenantId" = $1`, [TENANT]);
  console.log('benchmark data removed');
  await client.end();
  process.exit(0);
}

const existing = Number(
  (await client.query(`SELECT count(*) FROM "Project" WHERE "tenantId" = $1`, [TENANT])).rows[0].count,
);

if (existing < rows) {
  console.log(`seeding ${(rows - existing).toLocaleString()} projects…`);

  // A realistic spread, because a catalogue where every row shares a
  // micromarket has index selectivity no real workspace ever sees.
  const MICROMARKETS = 60;
  const DEVELOPERS = 120;

  await client.query(
    `INSERT INTO "Micromarket" ("id","tenantId","name","city","updatedAt")
     SELECT 'bm_' || g, $1, 'Micromarket ' || g, 'City ' || (g % 8), NOW()
     FROM generate_series(1, $2::int) g
     ON CONFLICT DO NOTHING`,
    [TENANT, MICROMARKETS],
  );
  await client.query(
    `INSERT INTO "Developer" ("id","tenantId","name","updatedAt")
     SELECT 'bd_' || g, $1, 'Developer ' || g, NOW()
     FROM generate_series(1, $2::int) g
     ON CONFLICT DO NOTHING`,
    [TENANT, DEVELOPERS],
  );

  const BATCH = 10_000;
  for (let from = existing; from < rows; from += BATCH) {
    const to = Math.min(from + BATCH, rows);
    await client.query(
      `INSERT INTO "Project" (
         "id","tenantId","name","code","developerId","micromarketId","status","possessionStatus",
         "minPrice","maxPrice","pricePerSqft","currency","unitTypes","amenityKeys",
         "totalUnits","availableUnits","soldUnits","isPriority","isPitchable","createdAt","updatedAt"
       )
       SELECT
         'bp_' || g,
         $1,
         (ARRAY['Marina','Palm','Downtown','Creek','Hills','Bay','Gardens','Heights'])[1 + g % 8]
           || ' ' || (ARRAY['Residences','Towers','Villas','Court','Park'])[1 + g % 5] || ' ' || g,
         'BM-' || g,
         'bd_' || (1 + g % $2::int),
         'bm_' || (1 + g % $3::int),
         (ARRAY['PLANNED','PRE_LAUNCH','LAUNCHED','UNDER_CONSTRUCTION','READY'])[1 + g % 5]::"ProjectStatus",
         (ARRAY['READY_TO_MOVE','UNDER_CONSTRUCTION','NEW_LAUNCH'])[1 + g % 3]::"PossessionStatus",
         (500000 + (g % 40) * 250000)::numeric(18,2),
         (900000 + (g % 40) * 400000)::numeric(18,2),
         (700 + (g % 900))::numeric(18,2),
         'AED',
         -- CASE rather than an array of arrays: Postgres arrays are rectangular,
         -- so ARRAY[ARRAY['1BHK'], ARRAY['2BHK','3BHK']] is a syntax error.
         CASE g % 4
           WHEN 0 THEN ARRAY['1BHK','2BHK']
           WHEN 1 THEN ARRAY['2BHK','3BHK']
           WHEN 2 THEN ARRAY['STUDIO','1BHK']
           ELSE ARRAY['VILLA']
         END,
         CASE g % 4
           WHEN 0 THEN ARRAY['pool','gym']
           WHEN 1 THEN ARRAY['gym','parking']
           WHEN 2 THEN ARRAY['pool','beach','gym']
           ELSE ARRAY['parking']
         END,
         -- Derived from the total rather than picked independently, or
         -- Project_unit_counts_check refuses the batch: available + sold can
         -- never exceed the units that exist. The constraint caught exactly
         -- that when this generator was first written.
         (100 + g % 400),
         (100 + g % 400) - (g % 30) - (g % 20),
         (g % 30),
         (g % 50 = 0), (g % 97 <> 0),
         NOW() - (g || ' minutes')::interval,
         NOW() - (g || ' minutes')::interval
       FROM generate_series($4::int, $5::int) g
       ON CONFLICT DO NOTHING`,
      [TENANT, DEVELOPERS, MICROMARKETS, from + 1, to],
    );
    process.stdout.write(`\r  ${to.toLocaleString()} / ${rows.toLocaleString()}`);
  }
  console.log('\nanalyzing…');
  await client.query(`ANALYZE "Project"`);
}

const total = Number(
  (await client.query(`SELECT count(*) FROM "Project" WHERE "tenantId" = $1`, [TENANT])).rows[0].count,
);
console.log(`\n${total.toLocaleString()} projects in the benchmark workspace\n`);

/** Median and p95 over enough runs that one cold cache does not decide it. */
async function measure(label, sql, params = []) {
  const runs = 15;
  const times = [];
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    await client.query(sql, params);
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(runs / 2)];
  const p95 = times[Math.floor(runs * 0.95)];
  const ok = p95 < BUDGET_MS;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} p50 ${p50.toFixed(1).padStart(7)} ms   p95 ${p95.toFixed(1).padStart(7)} ms`,
  );
  return ok;
}

// The first page of each query the catalogue actually issues.
const PAGE = 50;
const results = [];

results.push(
  await measure(
    'catalogue, no filter',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'filtered by micromarket',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "micromarketId" = 'bm_7'
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'filtered by budget',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL
       AND ("minPrice" <= 2000000 OR "minPrice" IS NULL)
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'name search (trigram)',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "name" ILIKE '%marina%'
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'amenity facet (GIN)',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "amenityKeys" && ARRAY['beach']
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'available only',
    `SELECT id FROM "Project" WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "availableUnits" > 0
     ORDER BY "updatedAt" DESC, id DESC LIMIT ${PAGE}`,
    [TENANT],
  ),
);

results.push(
  await measure(
    'facet counts by micromarket',
    `SELECT "micromarketId", count(*) FROM "Project"
     WHERE "tenantId" = $1 AND "deletedAt" IS NULL GROUP BY 1`,
    [TENANT],
  ),
);

console.log('');
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `All ${results.length} routes under ${BUDGET_MS} ms.` : `${failed} route(s) over budget.`);

await client.end();
process.exit(failed === 0 ? 0 : 1);
