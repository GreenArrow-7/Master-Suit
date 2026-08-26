/**
 * The read client, and the export ceiling — two settings that were declared and
 * read nowhere.
 *
 * `DATABASE_REPLICA_URL` built a second Prisma client that nothing imported, so
 * an operator who set it got a second connection pool answering no queries.
 * `EXPORT_MAX_ROWS` was a number in `.env.production` that matched what was
 * actually enforced only by coincidence — nothing enforced anything.
 *
 * The case worth testing is not "reports read from the replica", which is a
 * one-line import. It is the guard that makes the swap safe: `prismaRead`
 * refuses writes **in every configuration**, including the no-replica fallback
 * where it is the primary client. Without that, a write added to a report module
 * works in development and on any deployment without a replica, and fails only
 * where one exists — which is production, under the load that made a replica
 * worth having.
 */
import { describe, expect, it } from 'vitest';
import { prisma, prismaRead, ReadReplicaWriteError } from '@/lib/db';
import { csvStream } from '@/lib/csv';

const drain = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks.join('');
};

describe('prismaRead', () => {
  it('refuses every write operation, naming the client and the fix', async () => {
    // Each call is tenant-scoped on purpose. The tenant guard is the *outer*
    // extension — it was registered first — so a write that also lacks a tenant
    // filter is refused by that one instead, which is a correct refusal for a
    // different reason. Scoping them isolates the guard under test.
    for (const attempt of [
      () => prismaRead.lead.create({ data: { tenantId: 't', fullName: 'x' } as never }),
      () => prismaRead.lead.createMany({ data: [{ tenantId: 't' }] as never }),
      () => prismaRead.lead.update({ where: { tenantId: 't', id: 'x' } as never, data: {} as never }),
      () => prismaRead.lead.updateMany({ where: { tenantId: 't' }, data: {} as never }),
      () =>
        prismaRead.lead.upsert({
          where: { tenantId: 't', id: 'x' } as never,
          create: { tenantId: 't' } as never,
          update: {} as never,
        }),
      () => prismaRead.lead.delete({ where: { tenantId: 't', id: 'x' } as never }),
      () => prismaRead.lead.deleteMany({ where: { tenantId: 't' } }),
    ]) {
      await expect(attempt()).rejects.toThrow(ReadReplicaWriteError);
      await expect(attempt()).rejects.toThrow(/prismaRead.*Use `prisma`/s);
    }
  });

  it('is refused by the tenant guard first when the write is also unscoped', async () => {
    // Recorded rather than corrected: both layers refuse, and which speaks first
    // follows extension order. A developer who sees "missing tenantId filter" in
    // a report module has two things to fix, and that one is the more serious.
    await expect(prismaRead.lead.deleteMany({ where: {} })).rejects.toThrow(/without a tenantId filter/);
  });

  it('refuses raw execute, which is how a write would otherwise slip past', async () => {
    await expect(prismaRead.$executeRawUnsafe('UPDATE "Lead" SET score = 0')).rejects.toThrow(ReadReplicaWriteError);
  });

  it('still answers reads', async () => {
    // The guard must not be so broad that it takes the feature with it.
    await expect(prismaRead.tenant.findMany({ take: 1 })).resolves.toBeInstanceOf(Array);
  });

  it('leaves the primary client able to write', async () => {
    // `$extends` returns a new client; extending it must not have reached back
    // into `prisma`, which every mutation in the product goes through.
    expect(prisma).not.toBe(prismaRead);
    // A write that fails on its own merits — the tenant guard, not the read
    // guard — proves the primary is not carrying the read-only extension.
    await expect(prisma.lead.create({ data: {} as never })).rejects.not.toThrow(ReadReplicaWriteError);
  });
});

describe('the export ceiling', () => {
  const columns = [{ label: 'Id', value: (r: { id: string }) => r.id }];
  const rows = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));

  it('stops at maxRows and reports the file as truncated', async () => {
    let served = 0;
    const done: { rows: number; truncated: boolean }[] = [];
    const body = await drain(
      csvStream({
        columns,
        pageSize: 100,
        maxRows: 250,
        page: async (_cursor, take) => {
          const page = rows(take, served);
          served += take;
          return page;
        },
        onDone: async (n, truncated) => void done.push({ rows: n, truncated }),
      }),
    );

    // 250 rows plus the header line.
    expect(body.trimEnd().split('\r\n')).toHaveLength(251);
    expect(done).toEqual([{ rows: 250, truncated: true }]);
    // And it asked for exactly 250, not three full pages: the last page is
    // trimmed rather than fetched and discarded.
    expect(served).toBe(250);
  });

  it('reports a short result as complete, not truncated', async () => {
    const done: { rows: number; truncated: boolean }[] = [];
    await drain(
      csvStream({
        columns,
        pageSize: 100,
        maxRows: 250,
        page: async (cursor) => (cursor ? [] : rows(40, 0)),
        onDone: async (n, truncated) => void done.push({ rows: n, truncated }),
      }),
    );
    expect(done).toEqual([{ rows: 40, truncated: false }]);
  });

  it('calls onDone exactly once when the cap lands on a page boundary', async () => {
    // The boundary case: a full page that reaches the cap must close the stream
    // there rather than closing once for "reached the cap" and again on the next
    // empty pull — which would audit the same export twice.
    const done: number[] = [];
    await drain(
      csvStream({
        columns,
        pageSize: 50,
        maxRows: 100,
        page: async (_cursor, take) => rows(take, done.length),
        onDone: async (n) => void done.push(n),
      }),
    );
    expect(done).toEqual([100]);
  });
});
