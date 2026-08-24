/**
 * The object-store calls, driven by the real AWS SDK against a real HTTP server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `listObjects`, `listPrefixes` and `deleteObjects` in `src/lib/storage.ts` each
 * carry the one piece of logic a stand-in cannot check, and until now nothing
 * checked it:
 *
 *   · `listObjects` follows `IsTruncated` / `NextContinuationToken`. A single
 *     ListObjectsV2 returns at most 1,000 keys and says so in a field it is easy
 *     not to read. A sweep that ignores it silently stops deleting once a
 *     workspace passes a thousand captures — which is the point at which
 *     deleting them starts to matter.
 *   · `listPrefixes` does the same over `CommonPrefixes`.
 *   · `deleteObjects` slices into 1,000-key batches, because that is S3's
 *     documented maximum and MinIO enforces it: one oversized call fails with
 *     MalformedXML and deletes *nothing*.
 *
 * Both assessments recorded these as unverified, and the reason was the test:
 * `capture-vault.spec.ts` mocks `listObjects` at the module boundary, so the
 * loop inside it never runs. The code that deletes a customer's recordings had
 * never been executed by anything.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * It stands up a real HTTP server speaking enough of the S3 wire protocol, and
 * points a real `S3Client` at it. The SDK does its own signing, its own XML
 * parsing and its own response shaping; only the storage backend is in memory.
 * So what is exercised is the actual `do…while` in `storage.ts` against actual
 * `<IsTruncated>true</IsTruncated>` on the wire.
 *
 * ── What it still does not prove, said plainly ──────────────────────────────
 *
 * That MinIO and AWS behave the way this server does. The semantics here are
 * taken from the S3 API documentation and matched to the fields `storage.ts`
 * reads; a vendor that differs in some other field would not be caught. That
 * needs one manual run against MinIO and is recorded in the assessment as
 * exactly that. What is closed is the larger half: our own paging and batching.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

/** Objects the fake bucket holds, key → size. Insertion order is not sorted; S3 sorts. */
const bucket = new Map<string, number>();
/** Every DeleteObjects request body seen, so batching can be asserted rather than assumed. */
const deleteBatches: string[][] = [];
/** Keys the "bucket policy" refuses, to prove Errors are counted separately from Deleted. */
const undeletable = new Set<string>();

const xml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

/** ListObjectsV2 returns at most this many, exactly as S3 does. */
const PAGE = 1000;

function listBody(url: URL): string {
  const prefix = url.searchParams.get('prefix') ?? '';
  const delimiter = url.searchParams.get('delimiter') ?? '';
  const after = url.searchParams.get('continuation-token') ?? '';

  const all = [...bucket.keys()].filter((k) => k.startsWith(prefix)).sort();

  let contents: string[] = [];
  let commonPrefixes: string[] = [];
  if (delimiter) {
    const seen = new Set<string>();
    for (const key of all) {
      const rest = key.slice(prefix.length);
      const cut = rest.indexOf(delimiter);
      if (cut === -1) contents.push(key);
      else seen.add(prefix + rest.slice(0, cut + delimiter.length));
    }
    commonPrefixes = [...seen].sort();
  } else {
    contents = all;
  }

  // One cursor across both collections, which is what makes a delimiter listing
  // paginate at all — a token that only indexed Contents would loop forever on
  // a prefix-only page.
  const items = [
    ...commonPrefixes.map((p) => ({ kind: 'prefix' as const, id: p })),
    ...contents.map((k) => ({ kind: 'key' as const, id: k })),
  ];
  const start = after ? items.findIndex((i) => i.id === after) + 1 : 0;
  const page = items.slice(start, start + PAGE);
  const truncated = start + PAGE < items.length;
  const next = truncated ? page[page.length - 1]!.id : '';

  const body = page
    .map((i) =>
      i.kind === 'prefix'
        ? `<CommonPrefixes><Prefix>${xml(i.id)}</Prefix></CommonPrefixes>`
        : `<Contents><Key>${xml(i.id)}</Key><LastModified>2026-08-22T00:00:00.000Z</LastModified>` +
          `<Size>${bucket.get(i.id)}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>test-bucket</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount>` +
    `<MaxKeys>${PAGE}</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
    (next ? `<NextContinuationToken>${xml(next)}</NextContinuationToken>` : '') +
    body +
    `</ListBucketResult>`
  );
}

function deleteBody(raw: string): string {
  const keys = [...raw.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) =>
    m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );

  // The real refusal: S3 and MinIO both cap DeleteObjects at 1,000 and answer a
  // larger body with MalformedXML, having deleted nothing.
  if (keys.length > 1000) {
    return (
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>MalformedXML</Code>` +
      `<Message>The XML you provided was not well-formed or did not validate against our published schema</Message></Error>`
    );
  }

  deleteBatches.push(keys);
  const deleted: string[] = [];
  const errors: string[] = [];
  for (const key of keys) {
    if (undeletable.has(key)) {
      errors.push(`<Error><Key>${xml(key)}</Key><Code>AccessDenied</Code><Message>refused</Message></Error>`);
      continue;
    }
    bucket.delete(key);
    deleted.push(`<Deleted><Key>${xml(key)}</Key></Deleted>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><DeleteResult>${deleted.join('')}${errors.join('')}</DeleteResult>`;
}

let server: Server;
let storage: typeof import('@/lib/storage');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status: number, body = '', type = 'application/xml') => {
        res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      };

      if (req.method === 'HEAD') return send(200);
      if (req.method === 'POST' && url.searchParams.has('delete')) return send(200, deleteBody(raw));
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') return send(200, listBody(url));
      if (req.method === 'PUT') {
        const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\//, ''));
        if (key) bucket.set(key, Buffer.byteLength(raw));
        return send(200);
      }
      return send(200);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  // The client is built from `env` at import time, so the endpoint has to be in
  // place before the module is first loaded.
  process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  delete (globalThis as { __s3?: unknown }).__s3;
  delete (globalThis as { __bucketReady?: unknown }).__bucketReady;
  storage = await import('@/lib/storage');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('listObjects follows continuation tokens', () => {
  it('returns every object past the 1,000-key page boundary', async () => {
    bucket.clear();
    // 2,300 forces three pages: two full, one partial. A loop that reads only
    // the first page returns 1,000 and reports success.
    for (let i = 0; i < 2300; i += 1) bucket.set(`t-1/obj-${String(i).padStart(5, '0')}`, i);

    const found = await storage.listObjects('t-1/');

    expect(found).toHaveLength(2300);
    expect(found[0]!.key).toBe('t-1/obj-00000');
    expect(found[2299]!.key).toBe('t-1/obj-02299');
    // No key appears twice — the classic off-by-one when a token is resumed.
    expect(new Set(found.map((o) => o.key)).size).toBe(2300);
    // Sizes survive the round trip rather than defaulting to 0.
    expect(found.find((o) => o.key === 't-1/obj-00042')!.size).toBe(42);
  });

  it('respects the prefix rather than returning the whole bucket', async () => {
    bucket.clear();
    for (let i = 0; i < 1200; i += 1) bucket.set(`t-1/keep-${i}`, 1);
    for (let i = 0; i < 1200; i += 1) bucket.set(`t-2/other-${i}`, 1);

    const found = await storage.listObjects('t-2/');

    expect(found).toHaveLength(1200);
    expect(found.every((o) => o.key.startsWith('t-2/'))).toBe(true);
  });
});

describe('listPrefixes follows continuation tokens', () => {
  it('returns every common prefix past the page boundary', async () => {
    bucket.clear();
    // 1,500 tenants, two objects each: the delimiter must collapse them to
    // 1,500 prefixes across two pages, not 3,000 keys.
    for (let i = 0; i < 1500; i += 1) {
      bucket.set(`recordings/t-${String(i).padStart(5, '0')}/a.bin`, 1);
      bucket.set(`recordings/t-${String(i).padStart(5, '0')}/b.bin`, 1);
    }

    const prefixes = await storage.listPrefixes('recordings/');

    expect(prefixes).toHaveLength(1500);
    expect(prefixes[0]).toBe('recordings/t-00000/');
    expect(prefixes[1499]).toBe('recordings/t-01499/');
    expect(new Set(prefixes).size).toBe(1500);
  });
});

describe('deleteObjects batches at the limit the API enforces', () => {
  it('splits 2,500 keys into 1,000 / 1,000 / 500 and deletes them all', async () => {
    bucket.clear();
    deleteBatches.length = 0;
    undeletable.clear();
    const keys: string[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const key = `t-1/del-${i}`;
      bucket.set(key, 1);
      keys.push(key);
    }

    const removed = await storage.deleteObjects(keys);

    expect(removed).toBe(2500);
    expect(deleteBatches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(bucket.size).toBe(0);
  });

  it('counts what the bucket actually removed, not what was asked', async () => {
    bucket.clear();
    deleteBatches.length = 0;
    undeletable.clear();
    for (let i = 0; i < 10; i += 1) bucket.set(`t-1/x-${i}`, 1);
    // Two the policy refuses. They come back under Errors, not as a failed
    // request — so a caller counting its own input would over-report.
    undeletable.add('t-1/x-3');
    undeletable.add('t-1/x-7');

    const removed = await storage.deleteObjects([...Array(10)].map((_, i) => `t-1/x-${i}`));

    expect(removed).toBe(8);
    expect(bucket.has('t-1/x-3')).toBe(true);
    expect(bucket.has('t-1/x-7')).toBe(true);
  });

  it('sends nothing at all for an empty list', async () => {
    deleteBatches.length = 0;
    expect(await storage.deleteObjects([])).toBe(0);
    expect(deleteBatches).toHaveLength(0);
  });
});
