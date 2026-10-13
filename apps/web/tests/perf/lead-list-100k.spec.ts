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
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { get } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

const STATE = path.join(tmpdir(), 'lead-list-100k.json');
const TOTAL = 100_000;
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

describe.runIf(process.env.PERF_100K === 'yes')('M4-20: the lead list at 100,000 leads', () => {
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

    const now = Date.now();
    const year = 365 * 86_400_000;
    // Deterministic spread: a lead's age and last touch from its index.
    const rand = (n: number) => (((Math.sin(n * 12.9898) * 43758.5453) % 1) + 1) % 1;
    const started = performance.now();
    for (let from = 0; from < TOTAL; from += 1_000) {
      const data = [];
      for (let i = from; i < Math.min(TOTAL, from + 1_000); i++) {
        const createdAt = new Date(now - rand(i) * year);
        const updatedAt = new Date(createdAt.getTime() + rand(i + 1) * (now - createdAt.getTime()));
        const digits = String(1_000_000 + i).slice(-7);
        data.push({
          tenantId,
          reference: `PF-${String(i).padStart(6, '0')}`,
          fullName: `Perf Lead ${i}`,
          phone: `+97150${digits}`,
          phoneNormalized: `+97150${digits}`,
          email: `lead${i}@perf.test`,
          stageId: stages[i % stages.length]!,
          ownerId: agents[i % AGENTS]!.id,
          score: Math.floor(rand(i + 2) * 100),
          tags: i % 7 === 0 ? ['vip'] : [],
          // About 3% closed out and 1% deleted, as a working book has.
          status: i % 33 === 0 ? 'ARCHIVED' : null,
          deletedAt: i % 100 === 1 ? updatedAt : null,
          createdAt,
          updatedAt,
        });
      }
      await prisma.lead.createMany({ data });
    }
    const seedSeconds = Math.round((performance.now() - started) / 1000);
    writeFileSync(STATE, JSON.stringify({ tenantId, adminId: admin.id, agentId: agents[0]!.id, seedSeconds }));
    print(JSON.stringify({ seeded: TOTAL, seedSeconds }));
    expect(await prisma.lead.count({ where: { tenantId } })).toBeGreaterThan(98_000);
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
        const batch = `delete from "Lead" where id in (select id from "Lead" where "tenantId" = $1 limit 10000)`;
        while ((await client.query(batch, [id])).rowCount) {
          /* next batch */
        }
        await client.query(`delete from "Tenant" where id = $1`, [id]);
      }
      await client.query(`delete from "PlatformUser" where email like '%@perf100k-%.test'`);
      await client.query('VACUUM ANALYZE "Lead"');
      const { rows } = await client.query(`select pg_size_pretty(pg_database_size(current_database())) as size`);
      print(JSON.stringify({ tenantsDeleted: tenants.length, databaseSize: rows[0].size }));
      expect((await client.query(`select 1 from "Tenant" where slug like 'perf100k-%'`)).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
