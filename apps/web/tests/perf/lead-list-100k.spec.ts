/**
 * M4-20: the lead list at 100,000 leads (changes/2026-10-13-lead-bulk-tag-delete-move.md).
 * Not a CI test: vitest.config.mts excludes tests/perf, and it runs only with
 * PERF_100K=yes, against a scratch database, one case at a time:
 *
 *   PERF_100K=yes npx vitest run --config vitest.perf.mts -t seed      a tenant "perf100k-*" with 100,000 leads
 *   PERF_100K=yes npx vitest run --config vitest.perf.mts -t timing    GET /api/v1/leads and the grid page, page 1 and 200
 *   PERF_100K=yes npx vitest run --config vitest.perf.mts -t sql       the list's own SELECTs in Postgres (app role, RLS on)
 *   PERF_100K=yes npx vitest run --config vitest.perf.mts -t cleanup   deletes every perf100k-* tenant and its identities
 *
 *   PERF_100K=yes npx vitest run --config vitest.perf.mts -t more      the Follow-ups API and the Source to Booking report
 *
 * PERF_LEADS sets the size (default 100,000; NFR-10 ran it at 1,000,000). The
 * seed writes the leads, and a follow-up on every fifth, in SQL as the app role
 * (row-level security on), one statement each.
 *
 * Each timing is 5 warm-up runs, then 50 timed: p50 and p95, as an
 * ORGANIZATION administrator and as an OWN agent. The tenant's ids are kept in
 * the OS temp folder between cases. Nothing printed names a database URL.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { GET as listLeads } from '@/app/api/v1/leads/route';
import { GET as listFollowUps } from '@/app/api/v1/follow-ups/route';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { get } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

const STATE = path.join(tmpdir(), 'lead-list-100k.json');
const TOTAL = Number(process.env.PERF_LEADS ?? 100_000);
const AGENTS = 5;
type State = { tenantId: string; adminId: string; agentId: string; seedSeconds: number };
/** Results go to stdout (the vitest log). */
const print = (json: string) => process.stdout.write(`${json}\n`);
const state = (): State => JSON.parse(readFileSync(STATE, 'utf8'));

/** p50/p95 of 50 timed runs after 5 warm-ups. */
async function time(fn: () => Promise<unknown>) {
  for (let i = 0; i < 5; i++) await fn();
  const runs: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    await fn();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  return { p50: +runs[24]!.toFixed(1), p95: +runs[47]!.toFixed(1), max: +runs[49]!.toFixed(1) };
}

describe.runIf(process.env.PERF_100K === 'yes')('M4-20, NFR-10, NFR-11: the lead lists at scale', () => {
  it('seed', { timeout: 1_800_000 }, async () => {
    const suffix = Date.now().toString(36);
    const { id: tenantId } = await prisma.tenant.create({
      data: {
        slug: `perf100k-${suffix}`,
        legalName: 'Perf 100k LLC',
        displayName: 'Perf 100k',
        status: 'ACTIVE',
        timezone: 'Asia/Dubai',
      },
    });
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    const work: Grants = [
      ['leads', 'VIEW'],
      ['leads', 'CREATE'],
      ['leads', 'EDIT'],
      ['leads', 'DELETE'],
      ['leads', 'ASSIGN'],
      ['leads', 'EXPORT'],
      ['leads', 'VIEW_SENSITIVE_FIELDS'],
      ['tasks', 'VIEW'],
      ['tasks', 'CREATE'],
      ['reports', 'VIEW'],
    ];
    const role = async (key: string, scope: 'OWN' | 'ORGANIZATION') => {
      const row = await prisma.role.create({
        data: { tenantId, key, name: key, rank: scope === 'OWN' ? 40 : 10, defaultScope: scope },
      });
      await grantPermissions(tenantId, row.id, work, scope);
      return row.id;
    };
    const orgRole = await role('perf-admin', 'ORGANIZATION');
    const ownRole = await role('perf-agent', 'OWN');
    const user = (roleId: string, name: string) =>
      createWorkspaceUser({ tenantId, roleId, email: `${name}@perf100k-${suffix}.test`, fullName: `Perf ${name}` });
    const admin = await user(orgRole, 'admin');
    const agents = [];
    for (let i = 0; i < AGENTS; i++) agents.push(await user(ownRole, `agent${i}`));
    const stages: string[] = [];
    for (const [i, key] of ['new', 'contacted', 'qualified', 'visit', 'won', 'lost'].entries()) {
      stages.push(
        (await prisma.leadStage.create({ data: { tenantId, key, name: key, position: i, isDefault: i === 0 } })).id,
      );
    }

    const started = performance.now();
    // One statement each, as the app role with the tenant set (row-level security
    // on). Deterministic spread: a lead's age over a year and its last touch from
    // its index; about 3% closed out and 1% deleted, as a working book has; the
    // sources in turn; a follow-up on every fifth lead, a third of them done.
    const sql = new Client({ connectionString: process.env.DATABASE_URL });
    await sql.connect();
    try {
      await sql.query('BEGIN');
      await sql.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await sql.query(
        `insert into "Lead" (id, "tenantId", reference, "fullName", phone, "phoneNormalized", email, "stageId",
           "ownerId", score, tags, status, "deletedAt", source, "createdAt", "updatedAt")
         select 'c' || substr(md5($1 || i), 1, 24), $1, 'PF-' || lpad(i::text, 7, '0'), 'Perf Lead ' || i,
           '+9715' || lpad(i::text, 8, '0'), '+9715' || lpad(i::text, 8, '0'), 'lead' || i || '@perf.test',
           ($2::text[])[1 + i % 6], ($3::text[])[1 + i % ${AGENTS}], (i * 37) % 100,
           case when i % 7 = 0 then array['vip'] else array[]::text[] end,
           case when i % 33 = 0 then 'ARCHIVED' end,
           case when i % 100 = 1 then t.updated end,
           (enum_range(null::"RecordSource"))[1 + i % 14], t.created, t.updated
         from generate_series(0, $4::int - 1) i,
           lateral (select now() - ((i::bigint * 7919) % 525600) * interval '1 minute' as created) c,
           lateral (select c.created as created,
             c.created + ((i::bigint * 104729) % 1000) / 1000.0 * (now() - c.created) as updated) t`,
        [tenantId, stages, agents.map((a) => a.id), TOTAL],
      );
      await sql.query(
        `insert into "FollowUpTask" (id, "tenantId", "leadId", "ownerId", title, "dueAt", status, "completedAt",
           "createdAt", "updatedAt")
         select 'c' || substr(md5('f' || id), 1, 24), "tenantId", id, "ownerId", 'Call back',
           now() + (((hashtext(id) % 60) + 60) % 60 - 30) * interval '1 day',
           case when hashtext(id) % 3 = 0 then 'COMPLETED'::"TaskStatus" else 'OPEN'::"TaskStatus" end,
           case when hashtext(id) % 3 = 0 then now() end, "createdAt", "updatedAt"
         from "Lead" where "tenantId" = $1 and "deletedAt" is null and abs(hashtext(id || 'f')) % 5 = 0`,
        [tenantId],
      );
      await sql.query('COMMIT');
    } finally {
      await sql.end();
    }
    const vacuum = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await vacuum.connect();
    await vacuum.query('ANALYZE "Lead"; ANALYZE "FollowUpTask"');
    await vacuum.end();
    const seedSeconds = Math.round((performance.now() - started) / 1000);
    writeFileSync(STATE, JSON.stringify({ tenantId, adminId: admin.id, agentId: agents[0]!.id, seedSeconds }));
    print(JSON.stringify({ seeded: TOTAL, seedSeconds }));
    expect(await prisma.lead.count({ where: { tenantId } })).toBeGreaterThan(TOTAL * 0.98);
  });

  it('timing', { timeout: 1_800_000 }, async () => {
    const { tenantId, adminId, agentId } = state();
    const results: Record<string, unknown> = { at: new Date().toISOString() };
    for (const [who, userId] of [
      ['ORGANIZATION admin', adminId],
      ['OWN agent', agentId],
    ] as const) {
      const cookie = await createSessionToken(tenantId, userId);
      const api = async (cursor?: string) => {
        const res = await get(listLeads, `/api/v1/leads?limit=50${cursor ? `&cursor=${cursor}` : ''}`, cookie);
        if (res.status !== 200) throw new Error(`GET /leads ${res.status}`);
        return res.body as { nextCursor: string | null };
      };
      // Page 200's cursor: 199 pages walked, as an API client would.
      let cursor: string | undefined;
      for (let page = 1; page < 200; page++) cursor = (await api(cursor)).nextCursor ?? undefined;
      if (!cursor) throw new Error('fewer than 200 pages');
      const page200 = cursor;
      // The grid's link to the same place names the 9,950th lead by its id (leadPage).
      const after = JSON.parse(Buffer.from(page200, 'base64url').toString()).id as string;
      const grid = async (search: Record<string, string>) => {
        cookieJar.value = cookie;
        await LeadsPage({ searchParams: Promise.resolve(search) });
      };
      results[who] = {
        'GET /api/v1/leads page 1': await time(() => api()),
        'GET /api/v1/leads page 200 (cursor)': await time(() => api(page200)),
        'grid page 1': await time(() => grid({})),
        'grid page 200 (keyset, after=)': await time(() => grid({ page: '200', after })),
        'grid page 200 (old ?page=200 link, offset)': await time(() => grid({ page: '200' })),
      };
    }
    print(JSON.stringify(results, null, 2));
  });

  it('more', { timeout: 1_800_000 }, async () => {
    const { tenantId, adminId, agentId } = state();
    const results: Record<string, unknown> = { at: new Date().toISOString(), leads: TOTAL };
    // The Reports screen's own permission, for a tenant seeded before the seed granted it.
    for (const role of await prisma.role.findMany({ where: { tenantId }, select: { id: true, defaultScope: true } })) {
      await grantPermissions(tenantId, role.id, [['reports', 'VIEW']], role.defaultScope).catch(() => {});
    }
    for (const [who, userId] of [
      ['ORGANIZATION admin', adminId],
      ['OWN agent', agentId],
    ] as const) {
      const cookie = await createSessionToken(tenantId, userId);
      const followUps = async (query: string) => {
        const res = await get(listFollowUps, `/api/v1/follow-ups${query}`, cookie);
        if (res.status !== 200) throw new Error(`GET /follow-ups ${res.status}`);
      };
      const report = async () => {
        cookieJar.value = cookie;
        // The page's own default period: the first of the month two months back to now.
        await ReportsPage({ searchParams: Promise.resolve({ report: 'source-to-booking' }) });
      };
      results[who] = {
        'GET /api/v1/follow-ups (open)': await time(() => followUps('')),
        'GET /api/v1/follow-ups?due=overdue': await time(() => followUps('?due=overdue')),
        'Source to Booking report (default period)': await time(report),
      };
    }
    print(JSON.stringify(results, null, 2));
  });

  it('sql', { timeout: 1_800_000 }, async () => {
    const { tenantId, agentId } = state();
    // The app role, so row-level security applies as it does to the app.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const open = `("status" IS NULL OR "status" NOT IN ('INVALID','DUPLICATE','ARCHIVED')) AND "deletedAt" IS NULL`;
      const order = `ORDER BY "updatedAt" DESC, id DESC`;
      const org = { where: `"tenantId" = $1 AND ${open}`, params: [tenantId] as unknown[] };
      const own = {
        where: `"tenantId" = $1 AND ("ownerId" = $2 OR "secondaryOwnerId" = $2) AND ${open}`,
        params: [tenantId, agentId] as unknown[],
      };
      const cols = `id, reference, "fullName", email, phone, company, score, "stageId", "ownerId", "nextFollowUpAt", "updatedAt"`;
      const out: Record<string, unknown> = {};
      for (const [who, list] of Object.entries({ ORG: org, OWN: own })) {
        // Page 200 starts after the 9,950th row.
        const [at] = (
          await client.query(`select "updatedAt", id from "Lead" where ${list.where} ${order} offset 9949 limit 1`, [
            ...list.params,
          ])
        ).rows;
        const n = list.params.length + 1;
        const keyset = `"updatedAt" <= $${n} AND ("updatedAt" < $${n} OR ("updatedAt" = $${n} AND id < $${n + 1}))`;
        const shapes: Record<string, [string, unknown[], string]> = {
          'page 1': [list.where, list.params, 'LIMIT 51'],
          'page 200 keyset': [`${list.where} AND ${keyset}`, [...list.params, at.updatedAt, at.id], 'LIMIT 51'],
          'page 200 offset': [list.where, list.params, 'LIMIT 51 OFFSET 9950'],
        };
        for (const [name, [where, params, tail]] of Object.entries(shapes)) {
          const sql = `SELECT ${cols} FROM "Lead" WHERE ${where} ${order} ${tail}`;
          out[`${who} ${name}`] = await time(() => client.query(sql, params));
        }
      }
      await client.query('COMMIT');
      print(JSON.stringify(out, null, 2));
    } finally {
      await client.end();
    }
  });

  it('cleanup', { timeout: 1_800_000 }, async () => {
    // The owner role: the leads in batches, then each tenant, whose cascade takes the rest.
    const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await client.connect();
    try {
      const tenants = (await client.query(`select id from "Tenant" where slug like 'perf100k-%'`)).rows;
      for (const { id } of tenants) {
        // The follow-ups first: their cascade from Lead finds them by leadId,
        // which no index leads with, so each lead deleted scanned the table.
        await client.query(`delete from "FollowUpTask" where "tenantId" = $1`, [id]);
        const batch = `delete from "Lead" where id in (select id from "Lead" where "tenantId" = $1 limit 10000)`;
        while ((await client.query(batch, [id])).rowCount) {
          /* next batch */
        }
        await client.query(`delete from "Tenant" where id = $1`, [id]);
      }
      await client.query(`delete from "PlatformUser" where email like '%@perf100k-%.test'`);
      // No parallel workers: Docker's 64 MB /dev/shm cannot hold them after a 1M-row delete.
      await client.query('VACUUM (ANALYZE, PARALLEL 0) "Lead"');
      const { rows } = await client.query(`select pg_size_pretty(pg_database_size(current_database())) as size`);
      print(JSON.stringify({ tenantsDeleted: tenants.length, databaseSize: rows[0].size }));
      expect((await client.query(`select 1 from "Tenant" where slug like 'perf100k-%'`)).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
