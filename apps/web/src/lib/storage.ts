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
  GetObjectCommand,
  HeadBucketCommand,
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
