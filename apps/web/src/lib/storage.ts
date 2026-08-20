/**
 * Object storage for uploaded files.
 *
 * S3-compatible, which in local development means the MinIO container in
 * `infra/docker-compose.yml`. Objects are private: nothing here ever returns a
 * public URL, because the only route to the bytes must be an authorised handler
 * that can check permissions and write an audit row. A pre-signed URL would
 * bypass both the moment it leaked.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from './env';
import { logger } from './logger';

const globalForS3 = globalThis as unknown as { __s3?: S3Client; __bucketReady?: Promise<void> };

export const s3 =
  globalForS3.__s3 ??
  new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
if (env.NODE_ENV !== 'production') globalForS3.__s3 = s3;

/**
 * Creates the bucket on first use. A fresh clone has an empty MinIO volume, and
 * failing the first upload with a raw NoSuchBucket is a worse first run than
 * simply making it. Memoised so it costs one HEAD per process.
 */
function ensureBucket(): Promise<void> {
  globalForS3.__bucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
        logger.info({ bucket: env.S3_BUCKET }, 'storage: bucket created');
      } catch (error) {
        globalForS3.__bucketReady = undefined; // let the next call retry
        throw error;
      }
    }
  })();
  return globalForS3.__bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await ensureBucket();
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string) {
  await ensureBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/**
 * Promotes an object from one key to another — used to move a file out of
 * quarantine once it has a clean verdict.
 *
 * Copy then delete, in that order: if the delete fails the object exists twice,
 * which is untidy but harmless. Deleting first and failing the copy would lose
 * the file.
 */
export async function moveObject(fromKey: string, toKey: string, contentType: string) {
  const body = await getObject(fromKey);
  await putObject(toKey, body, contentType);
  await deleteObject(fromKey).catch(() => {});
  return toKey;
}

/** One stored object, as much of it as a retention sweep needs. */
export interface StoredObject {
  key: string;
  lastModified: Date | null;
  size: number;
}

/**
 * Every object under a prefix, following continuation tokens.
 *
 * `IsTruncated` is the trap here: a single ListObjectsV2 returns at most 1,000
 * keys and says so in a field it is easy not to read. A retention sweep that
 * ignores it silently stops deleting once a workspace passes a thousand
 * captures — which is the point at which deleting them starts to matter.
 */
export async function listObjects(prefix: string): Promise<StoredObject[]> {
  await ensureBucket();
  const objects: StoredObject[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({ key: item.Key, lastModified: item.LastModified ?? null, size: item.Size ?? 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

/**
 * The immediate "directories" under a prefix.
 *
 * `Delimiter` makes S3 collapse everything below the next `/` into a
 * CommonPrefix, so listing tenants costs one page per thousand tenants rather
 * than one entry per stored object.
 */
export async function listPrefixes(prefix: string): Promise<string[]> {
  await ensureBucket();
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: token,
      }),
    );
    for (const item of page.CommonPrefixes ?? []) if (item.Prefix) prefixes.push(item.Prefix);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return prefixes;
}

/**
 * Deletes many objects, in the batches the API accepts.
 *
 * 1,000 per request is S3's documented maximum and MinIO enforces it too, so a
 * sweep that passed a whole workspace's captures in one call would fail with
 * MalformedXML rather than delete anything.
 *
 * Returns how many were actually removed, because the caller reports a count
 * and `Deleted` is the only honest source for it — a key the bucket policy
 * refuses comes back under `Errors`, not as a failure of the request.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  await ensureBucket();
  let removed = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
      }),
    );
    removed += result.Deleted?.length ?? 0;
    for (const error of result.Errors ?? []) {
      logger.warn({ key: error.Key, code: error.Code, message: error.Message }, 'storage: object could not be deleted');
    }
  }
  return removed;
}
