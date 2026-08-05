import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import DocumentUpload from '@/components/workspace/DocumentUpload';
import { isHrAdmin } from '@/services/hr/access';
import { listDocuments } from '@/services/hr/documents';
import { expirySeverity } from '@/services/hr/rules';

/** The documents UAE employment actually turns on. */
const KINDS = [
  'PASSPORT', 'EMIRATES_ID', 'RESIDENCE_VISA', 'LABOUR_CARD', 'ENTRY_PERMIT',
  'RERA_BRN_CARD', 'EDUCATION_CERTIFICATE', 'EMPLOYMENT_CONTRACT', 'MEDICAL_INSURANCE', 'OTHER',
];

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const base = `/api/v1/workspaces/${workspaceSlug}/hr`;
  const hr = isHrAdmin(ctx);

  const [documents, employees] = await Promise.all([
    listDocuments(ctx),
    hr ? prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }) : [],
  ]);

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    <section>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Employee documents</h1>
      <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '80ch' }}>
        Passport scans and visas are the highest-value data in this system. Files are stored under generated keys, the format is identified from the file&apos;s own bytes rather than what the browser claimed, and
        <strong> every download is recorded against the person who made it</strong>. There is no public link to any of them.
        {hr ? '' : ' You can see your own documents here.'}
      </p>
    </section>

    {hr && <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Upload a document</h2>
      <DocumentUpload
        endpoint={`${base}/documents/upload`}
        kinds={KINDS}
        employees={employees.map((employee) => ({ value: employee.id, label: `${employee.employeeNumber} · ${employee.membership.platformUser.fullName}` }))}
      />
    </section>}

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Documents</h2>
      <WorkspaceTable
        headers={['Employee', 'Kind', 'Number', 'Expires', 'Size', 'File', '']}
        empty="No documents on file."
        rows={documents.map((document) => {
          const daysLeft = document.expiresAt ? Math.round((document.expiresAt.getTime() - Date.now()) / 86_400_000) : null;
          return [
            document.employee.membership.platformUser.fullName,
            document.kind.replace(/_/g, ' '),
            document.number ?? '—',
            document.expiresAt
              ? <span key="e">{document.expiresAt.toLocaleDateString('en-AE', { timeZone: 'UTC' })}
                  <span className="lf-badge" style={{ marginLeft: 6 }}>{expirySeverity(daysLeft!)}</span>
                </span>
              : '—',
            document.sizeBytes ? `${Math.max(1, Math.round(document.sizeBytes / 1024))} KB` : '—',
            document.storageKey
              ? <a key="d" className="lf-btn lf-btn--ghost" href={`${base}/documents/${document.id}/download`}>Download</a>
              : <span key="d" style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>metadata only</span>,
            hr
              ? <WorkspaceActionButton
                  key="x" endpoint={`${base}/actions/document-delete`} body={{ documentId: document.id }}
                  label="Delete" variant="danger"
                  confirm={`Delete this ${document.kind.replace(/_/g, ' ').toLowerCase()} permanently? The stored file goes with it.`}
                />
              : '—',
          ];
        })}
      />
    </section>
  </div>;
}
