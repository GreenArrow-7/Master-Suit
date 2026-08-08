import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import {
  isHiringApprover,
  isRecruiter,
  listCandidates,
  listRequisitions,
  mayReadBands,
  pipelineSummary,
} from '@/services/hr/recruitment';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['recruitment', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const recruiter = isRecruiter(ctx);
  const approver = isHiringApprover(ctx);
  const bands = mayReadBands(ctx);

  const [requisitions, candidates, summary, employees, departments] = await Promise.all([
    listRequisitions(ctx),
    listCandidates(ctx),
    pipelineSummary(ctx),
    recruiter
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : [],
    recruiter
      ? prisma.department.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, orderBy: { name: 'asc' } })
      : [],
  ]);

  const open = requisitions.filter((row) => row.status === 'OPEN');

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Recruitment</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '78ch' }}>
          A hire is completed from an accepted offer, not by moving a stage. Doing it issues the joiner an invitation,
          and the employee record created when they accept points back at this application.
          {!bands && ' Salary bands and offered compensation are hidden from your role.'}
        </p>
      </section>

      <section
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--lf-space-4)' }}
      >
        {[
          ['Open roles', summary.openRequisitions],
          ['In pipeline', Object.entries(summary.byStage).filter(([stage]) => !TERMINAL.includes(stage)).reduce((total, [, count]) => total + count, 0)],
          ['Offers out', summary.byStage.OFFER ?? 0],
          ['Hired', summary.hires],
          ['Avg days to hire', summary.averageDaysToHire ?? '—'],
        ].map(([label, value]) => (
          <article className="lf-card" key={String(label)} style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow">{label}</div>
            <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 32, marginTop: 6 }}>{value}</div>
          </article>
        ))}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Requisitions</h2>
        <WorkspaceTable
          headers={['Role', 'Department', 'Openings', bands ? 'Band' : 'Status', 'Candidates', 'Actions']}
          empty="No requisition has been raised yet."
          rows={requisitions.map((row) => [
            row.title,
            row.department?.name ?? '—',
            row.openings,
            bands
              ? row.salaryMin || row.salaryMax
                ? `${row.currency} ${row.salaryMin ?? '?'} – ${row.salaryMax ?? '?'}`
                : '—'
              : row.status.replace('_', ' '),
            row._count.candidates,
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="actions">
              <span className="lf-badge">{row.status.replace('_', ' ')}</span>
              {recruiter && row.status === 'DRAFT' && (
                <WorkspaceActionButton
                  endpoint={`${actions}/requisition-submit`}
                  body={{ requisitionId: row.id }}
                  label="Submit"
                />
              )}
              {approver && row.status === 'PENDING_APPROVAL' && (
                <>
                  <WorkspaceActionButton
                    endpoint={`${actions}/requisition-decide`}
                    body={{ requisitionId: row.id, approve: true }}
                    label="Approve"
                  />
                  <WorkspaceActionButton
                    endpoint={`${actions}/requisition-decide`}
                    body={{ requisitionId: row.id, approve: false }}
                    label="Reject"
                    variant="danger"
                    promptFor={{ name: 'note', label: 'Why is this refused?' }}
                  />
                </>
              )}
              {recruiter && row.status === 'OPEN' && (
                <WorkspaceActionButton
                  endpoint={`${actions}/requisition-status`}
                  body={{ requisitionId: row.id, status: 'CLOSED' }}
                  label="Close"
                  variant="ghost"
                  confirm="Close this requisition to new applications?"
                />
              )}
            </span>,
          ])}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Candidates</h2>
        <WorkspaceTable
          headers={['Name', 'Role', 'Stage', 'Source', 'Applied', '']}
          empty="Nobody has applied yet."
          rows={candidates.map((candidate) => [
            candidate.fullName,
            candidate.requisition.title,
            <span className="lf-badge" key="stage">
              {candidate.stage.replace('_', ' ')}
            </span>,
            candidate.source ?? '—',
            date(candidate.createdAt),
            <Link key="open" className="lf-link" href={`/${workspaceSlug}/people/recruitment/${candidate.id}`}>
              Open
            </Link>,
          ])}
        />
      </section>

      {recruiter && (
        <>
          <section>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Raise a requisition</h2>
            <WorkspaceRecordForm
              endpoint={`${actions}/requisition-create`}
              submitLabel="Create requisition"
              fields={[
                { name: 'title', label: 'Role title', required: true },
                {
                  name: 'departmentId',
                  label: 'Department',
                  type: 'select',
                  options: departments.map((department) => ({ value: department.id, label: department.name })),
                },
                {
                  name: 'hiringManagerId',
                  label: 'Hiring manager',
                  type: 'select',
                  options: employees.map((employee) => ({
                    value: employee.id,
                    label: employee.membership.platformUser.fullName,
                  })),
                },
                { name: 'openings', label: 'Openings', type: 'number' },
                { name: 'employmentType', label: 'Employment type' },
                ...(bands
                  ? [
                      { name: 'salaryMin', label: 'Salary band from', type: 'number' as const },
                      { name: 'salaryMax', label: 'Salary band to', type: 'number' as const },
                    ]
                  : []),
                { name: 'reason', label: 'Reason for hiring' },
                { name: 'description', label: 'Job description' },
              ]}
            />
          </section>

          <section>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Add a candidate</h2>
            {open.length === 0 ? (
              <p style={{ color: 'var(--lf-ink-600)' }}>
                No requisition is open. A candidate can only be added to an approved, open role.
              </p>
            ) : (
              <WorkspaceRecordForm
                endpoint={`${actions}/candidate-add`}
                submitLabel="Add candidate"
                fields={[
                  {
                    name: 'requisitionId',
                    label: 'Applying for',
                    type: 'select',
                    required: true,
                    options: open.map((row) => ({ value: row.id, label: row.title })),
                  },
                  { name: 'fullName', label: 'Full name', required: true },
                  { name: 'email', label: 'Email', type: 'email', required: true },
                  { name: 'phone', label: 'Phone' },
                  { name: 'source', label: 'Source (referral, LinkedIn, agency…)' },
                  { name: 'experienceYears', label: 'Years of experience', type: 'number' },
                ]}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

const TERMINAL = ['HIRED', 'REJECTED', 'WITHDRAWN'];
const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
