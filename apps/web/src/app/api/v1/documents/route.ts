import { LEAD_MODULES } from '@/lib/security/entitlements';
import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { readUpload } from '@/lib/api/read-body';
import { visibilityWhere } from '@/lib/security/visibility';
import { scanBuffer } from '@/lib/antivirus';
import { putObject } from '@/lib/storage';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';

/**
 * Upload a document against a lead. Multipart: the kernel leaves the body unread
 * until readUpload, after authentication, entitlement and permission.
 *
 * Same antivirus discipline as HR documents, simplified: a CLEAN file is
 * stored and downloadable, an INFECTED one is never stored (the row remains as
 * the record of the attempt), and a scanner ERROR stores nothing rather than
 * keeping unscanned bytes around.
 */
export const POST = route(
  { module: 'leads', action: 'EDIT', productModule: LEAD_MODULES, sessionOnly: true },
  async ({ ctx, req }) => {
    const { form, file } = await readUpload(req);

    const leadId = String(form.get('leadId') ?? '');
    if (!leadId) throw new AppError(422, 'validation-failed', 'A lead is required.');
    const scope = await visibilityWhere(ctx, 'leads', 'EDIT', { includeUnassigned: true });
    const lead = await prisma.lead.findFirst({ where: { ...scope, id: leadId }, select: { id: true } });
    if (!lead) throw new AppError(404, 'not-found', 'Lead not found.');

    const category = String(form.get('category') ?? '') || null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'application/octet-stream';
    const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';

    const scan = await scanBuffer(bytes);
    let storageKey = '';
    if (scan.verdict === 'CLEAN') {
      storageKey = `documents/t-${ctx.tenantId}/lead-${lead.id}/${crypto.randomUUID()}-${safeName}`;
      await putObject(storageKey, bytes, contentType);
    }

    const document = await prisma.document.create({
      data: {
        tenantId: ctx.tenantId,
        name: file.name.slice(0, 200),
        category,
        storageKey,
        storageBucket: scan.verdict === 'CLEAN' ? env.S3_BUCKET : 'none',
        mimeType: contentType,
        sizeBytes: bytes.length,
        status: scan.verdict === 'CLEAN' ? 'UPLOADED' : 'REJECTED',
        scanState: scan.verdict,
        scanResult: scan.verdict === 'CLEAN' ? null : (scan.detail ?? scan.verdict),
        leadId: lead.id,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
      },
      select: { id: true, name: true, status: true, scanState: true, sizeBytes: true, createdAt: true },
    });

    if (scan.verdict !== 'CLEAN') {
      // The row records the attempt; tell the uploader plainly.
      return NextResponse.json(
        {
          ...document,
          detail:
            scan.verdict === 'INFECTED'
              ? 'The file failed the malware scan and was not stored.'
              : 'The malware scanner was unavailable; try again.',
        },
        { status: 422 },
      );
    }

    return document;
  },
);
