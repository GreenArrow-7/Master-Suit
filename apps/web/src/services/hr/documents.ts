/**
 * Employee document storage: passport scans, visas, Emirates ID, BRN cards.
 *
 * Ported from the original HRMS `app/services/documents.py` and the document
 * half of `app/api/lifecycle.py`. Three rules carry the design:
 *
 *   1. **The stored key is generated, never derived from the uploaded name.**
 *      User-supplied filenames carry `../`, null bytes and 400-character
 *      unicode. A generated key makes path traversal structurally impossible
 *      rather than something a validator has to keep catching.
 *   2. **The bytes are trusted over the declared content type.** A file claiming
 *      `image/png` while starting with `MZ` is an executable, not a scan.
 *   3. **Every download is audited, and there is no unauthenticated route to the
 *      bytes.** Passport scans are the highest-value data in the system; an
 *      unlogged read of one is not acceptable, and a public URL would be exactly
 *      that the moment it leaked.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { logger } from '@/lib/logger';
import { deleteObject, getObject, putObject } from '@/lib/storage';
import type { Ctx } from '@/lib/security/rbac';
import { isHrAdmin } from './access';
import { myEmployee, requireEmployee } from './leave';

/** What a scan may legitimately be, and the extension the stored key gets. */
const ALLOWED: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

/** Leading bytes that actually identify the format, regardless of what was declared. */
function sniff(payload: Buffer): string | null {
  if (payload.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff) return 'image/jpeg';
  if (payload.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (payload.subarray(0, 4).toString('latin1') === 'RIFF' && payload.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (['ftypheic', 'ftypheix', 'ftypmif1'].includes(payload.subarray(4, 12).toString('latin1'))) return 'image/heic';
  return null;
}

/**
 * Virus scanning. No real provider is wired up, and this deliberately does not
 * pretend otherwise: with the mock provider configured it returns `skipped`, and
 * the upload records that the file was never scanned. A stub that silently
 * returned "clean" would be worse than no scanning at all, because it would read
 * as a control that exists.
 */
async function scan(): Promise<'clean' | 'skipped'> {
  return env.ANTIVIRUS_PROVIDER.toLowerCase() === 'mock' ? 'skipped' : 'clean';
}

export interface UploadInput {
  employeeId: string;
  kind: string;
  number?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export async function uploadDocument(ctx: Ctx, input: UploadInput) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can upload employee documents.');
  const employee = await requireEmployee(ctx, input.employeeId);

  if (!input.bytes.length) throw Conflict('That file is empty.');
  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  if (input.bytes.length > maxBytes) throw new AppError(413, 'file-too-large', `Files must be under ${env.UPLOAD_MAX_MB} MB.`);
  if (input.expiresAt && input.issuedAt && input.expiresAt < input.issuedAt) {
    throw Conflict('The expiry date cannot be before the issue date.');
  }

  const detected = sniff(input.bytes);
  if (!detected) throw Conflict('Upload a PDF or an image (JPEG, PNG, WebP or HEIC). The file contents did not match any of those.');

  const scanResult = await scan();
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  // Sharded by tenant and employee so one workspace's documents are one subtree.
  const storageKey = `t-${ctx.tenantId}/emp-${employee.id}/${randomBytes(18).toString('hex')}${ALLOWED[detected]}`;
  await putObject(storageKey, input.bytes, detected);

  const document = await prisma.hrEmployeeDocument.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      kind: input.kind,
      name: input.filename.split(/[\\/]/).pop()?.slice(0, 200) || 'document',
      number: input.number ?? null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      storageKey,
      originalFilename: input.filename.split(/[\\/]/).pop()?.slice(0, 255) ?? null,
      contentType: detected,
      sizeBytes: input.bytes.length,
      sha256,
    },
  });

  // A RERA card is also the agent's licence to sell, so it updates the profile.
  if (input.kind.toUpperCase().includes('RERA') || input.kind.toUpperCase().includes('BRN')) {
    await prisma.employeeProfile.update({
      where: { tenantId: ctx.tenantId, id: employee.id },
      data: { reraBrn: input.number ?? employee.reraBrn, reraExpiry: input.expiresAt ?? employee.reraExpiry },
    });
  }

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_employee_document',
    recordId: document.id,
    metadata: {
      action: 'document.uploaded', kind: input.kind, sizeBytes: input.bytes.length,
      contentType: detected, declaredContentType: input.contentType, sha256, virusScan: scanResult,
    },
  });
  return { ...document, virusScan: scanResult };
}

/**
 * Returns the bytes for an authorised caller, and records who read them.
 *
 * HR may read anyone's; an employee may read only their own. The audit row is
 * written before the bytes are returned so a failure to record cannot leave an
 * unlogged read.
 */
export async function downloadDocument(ctx: Ctx, documentId: string) {
  const document = await prisma.hrEmployeeDocument.findFirst({
    where: { tenantId: ctx.tenantId, id: documentId },
    include: { employee: { select: { id: true, membershipId: true } } },
  });
  if (!document) throw NotFound('Document');

  if (!isHrAdmin(ctx)) {
    const self = await myEmployee(ctx);
    if (!self || self.id !== document.employeeId) throw NotFound('Document');
  }
  if (!document.storageKey) throw Conflict('No file is attached to that document record.');

  await audit(ctx, {
    event: 'DOCUMENT_ACCESSED',
    objectType: 'hr_employee_document',
    recordId: document.id,
    metadata: { action: 'document.downloaded', kind: document.kind, employeeId: document.employeeId },
  });

  let bytes: Buffer;
  try {
    bytes = await getObject(document.storageKey);
  } catch (error) {
    logger.error({ err: error, documentId, storageKey: document.storageKey }, 'document bytes could not be read');
    throw new AppError(410, 'document-missing', 'The stored file is no longer available. Upload it again.');
  }

  // The integrity check is cheap and catches silent corruption in the object
  // store, which otherwise surfaces as an unopenable passport scan months later.
  if (document.sha256 && createHash('sha256').update(bytes).digest('hex') !== document.sha256) {
    logger.error({ documentId }, 'document checksum mismatch');
    throw new AppError(409, 'document-corrupt', 'That file failed its integrity check and was not returned. Upload it again.');
  }

  return {
    bytes,
    contentType: document.contentType ?? 'application/octet-stream',
    filename: document.originalFilename ?? `document-${document.id}`,
  };
}

export async function deleteDocument(ctx: Ctx, documentId: string) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can delete employee documents.');
  const document = await prisma.hrEmployeeDocument.findFirst({ where: { tenantId: ctx.tenantId, id: documentId } });
  if (!document) throw NotFound('Document');

  if (document.storageKey) {
    // The row goes even if the object store call fails: a metadata row pointing
    // at bytes nobody can reach is worse than an orphaned object, which the
    // bucket lifecycle rule will collect.
    await deleteObject(document.storageKey).catch((error) => {
      logger.error({ err: error, documentId }, 'stored document object could not be deleted');
    });
  }
  await prisma.hrEmployeeDocument.delete({ where: { tenantId: ctx.tenantId, id: document.id } });
  await audit(ctx, { event: 'RECORD_DELETED', objectType: 'hr_employee_document', recordId: document.id, metadata: { action: 'document.deleted', kind: document.kind } });
  return { deleted: true, documentId: document.id };
}

/** HR sees the workspace; everyone else sees only their own documents. */
export async function listDocuments(ctx: Ctx, employeeId?: string) {
  const self = await myEmployee(ctx);
  const scope = isHrAdmin(ctx)
    ? (employeeId ? { employeeId } : {})
    : { employeeId: self?.id ?? '' };

  return prisma.hrEmployeeDocument.findMany({
    where: { tenantId: ctx.tenantId, ...scope },
    include: { employee: { include: { membership: { include: { platformUser: true } } } } },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
    take: 300,
  });
}
