import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { myEmployee } from '@/services/hr/leave';
import { candidateDetail, isHiringApprover, isRecruiter, mayReadBands } from '@/services/hr/recruitment';

/** Stages a recruiter can move a candidate to by hand. HIRED is not one of them. */
const MOVEABLE = [
  'SCREENING',
  'SHORTLISTED',
  'INTERVIEW',
  'ASSESSMENT',
  'FINAL_INTERVIEW',
  'ON_HOLD',
  'REJECTED',
  'WITHDRAWN',
];

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; candidateId: string }> }) {
  const { workspaceSlug, candidateId } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['recruitment', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const candidate = await candidateDetail(ctx, candidateId);
  const recruiter = isRecruiter(ctx);
  const approver = isHiringApprover(ctx);
  const bands = mayReadBands(ctx);
  const self = await myEmployee(ctx);

  const employees = recruiter
    ? await prisma.employeeProfile.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
        include: { membership: { include: { platformUser: true } } },
        orderBy: { employeeNumber: 'asc' },
      })
    : [];

  const liveOffer = candidate.offers.find((offer) =>
    ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(offer.status),
  );
  const acceptedOffer = candidate.offers.find((offer) => offer.status === 'ACCEPTED');
  const hired = candidate.stage === 'HIRED';
  const employee = candidate.employees[0];
  // Panels the signed-in person actually sat on: everyone else's scorecard is
  // readable, but only your own is writable.
  const myInterviews = candidate.interviews.filter(
    (interview) => self && interview.panelIds.includes(self.id) && interview.status !== 'CANCELLED',
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">
          <Link className="lf-link" href={`/${workspaceSlug}/people/recruitment`}>
            Recruitment
          </Link>
        </div>
        <h1 style={{ margin: '8px 0 0' }}>{candidate.fullName}</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
          {candidate.requisition.title}
          {candidate.requisition.department ? ` · ${candidate.requisition.department.name}` : ''} ·{' '}
          <span className="lf-badge">{candidate.stage.replace('_', ' ')}</span>
        </p>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-sm)' }}>
          {candidate.email}
          {candidate.phone ? ` · ${candidate.phone}` : ''}
          {candidate.source ? ` · via ${candidate.source}` : ''}
          {candidate.experienceYears != null ? ` · ${candidate.experienceYears} years` : ''}
        </p>
      </section>

      {hired && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Hired</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              {employee
                ? `The employee record ${employee.employeeNumber} exists and is linked to this application.`
                : 'An invitation has been issued. The employee record is created when it is accepted, and will link back here.'}
            </p>
          </div>
          {employee && (
            <WorkspaceActionButton
              endpoint={`${actions}/candidate-onboard`}
              body={{ candidateId: candidate.id }}
              label="Start onboarding checklist"
            />
          )}
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Pipeline history</h2>
        <WorkspaceTable
          headers={['When', 'From', 'To', 'Note']}
          rows={candidate.stageEvents.map((event) => [
            date(event.createdAt),
            event.fromStage?.replace('_', ' ') ?? '—',
            event.toStage.replace('_', ' '),
            event.note ?? '—',
          ])}
        />
        {recruiter && !hired && (
          <div style={{ marginTop: 12 }}>
            <WorkspaceRecordForm
              endpoint={`${actions}/candidate-move`}
              submitLabel="Move stage"
              fields={[
                {
                  name: 'stage',
                  label: 'Move to',
                  type: 'select',
                  required: true,
                  options: MOVEABLE.map((stage) => ({ value: stage, label: stage.replace('_', ' ') })),
                },
                { name: 'note', label: 'Note (required when rejecting)' },
                {
                  name: 'candidateId',
                  label: 'Candidate',
                  type: 'select',
                  required: true,
                  options: [{ value: candidate.id, label: candidate.fullName }],
                },
              ]}
            />
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Interviews</h2>
        <WorkspaceTable
          headers={['When', 'Type', 'Status', 'Panel', 'Feedback']}
          empty="No interview has been scheduled."
          rows={candidate.interviews.map((interview) => [
            `${date(interview.scheduledAt)} ${time(interview.scheduledAt)}`,
            interview.type,
            <span className="lf-badge" key="status">
              {interview.status}
            </span>,
            interview.panelIds.length,
            interview.feedback.length
              ? interview.feedback
                  .map(
                    (item) =>
                      `${item.interviewer.membership.platformUser.fullName}: ${item.rating}/5 ${item.recommendation.replace('_', ' ')}`,
                  )
                  .join(' · ')
              : 'Awaiting',
          ])}
        />

        {myInterviews.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 'var(--lf-text-md)', margin: '0 0 8px' }}>My scorecard</h3>
            <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              Only the panel can score an interview. Submitting again replaces your own.
            </p>
            <WorkspaceRecordForm
              endpoint={`${actions}/interview-feedback`}
              submitLabel="Submit feedback"
              fields={[
                {
                  name: 'interviewId',
                  label: 'Interview',
                  type: 'select',
                  required: true,
                  options: myInterviews.map((interview) => ({
                    value: interview.id,
                    label: `${date(interview.scheduledAt)} · ${interview.type}`,
                  })),
                },
                {
                  name: 'rating',
                  label: 'Overall (1–5)',
                  type: 'select',
                  required: true,
                  options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
                },
                {
                  name: 'recommendation',
                  label: 'Recommendation',
                  type: 'select',
                  required: true,
                  options: ['STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO'].map((value) => ({
                    value,
                    label: value.replace('_', ' '),
                  })),
                },
                { name: 'notes', label: 'Notes' },
              ]}
            />
          </div>
        )}

        {recruiter && !hired && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 'var(--lf-text-md)', margin: '0 0 8px' }}>Schedule an interview</h3>
            <WorkspaceRecordForm
              endpoint={`${actions}/interview-schedule`}
              submitLabel="Schedule"
              fields={[
                {
                  name: 'candidateId',
                  label: 'Candidate',
                  type: 'select',
                  required: true,
                  options: [{ value: candidate.id, label: candidate.fullName }],
                },
                { name: 'scheduledAt', label: 'When', type: 'datetime-local', required: true },
                {
                  name: 'type',
                  label: 'Type',
                  type: 'select',
                  options: ['PHONE', 'VIDEO', 'ONSITE', 'PANEL', 'TECHNICAL'].map((value) => ({ value, label: value })),
                },
                {
                  name: 'panelIds',
                  label: 'Panel',
                  type: 'multiselect',
                  required: true,
                  options: employees.map((row) => ({
                    value: row.id,
                    label: row.membership.platformUser.fullName,
                  })),
                },
                { name: 'location', label: 'Location or link' },
              ]}
            />
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Offers</h2>
        <WorkspaceTable
          headers={['Version', 'Package', 'Joining', 'Status', 'Actions']}
          empty="No offer has been made."
          rows={candidate.offers.map((offer) => [
            `v${offer.version}`,
            bands && offer.basic != null ? `${offer.currency} ${total(offer)}` : bands ? '—' : 'hidden',
            date(offer.joiningDate),
            <span className="lf-badge" key="status">
              {offer.status.replace('_', ' ')}
            </span>,
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="actions">
              {approver && ['DRAFT', 'PENDING_APPROVAL'].includes(offer.status) && (
                <>
                  <WorkspaceActionButton
                    endpoint={`${actions}/offer-decide`}
                    body={{ offerId: offer.id, approve: true }}
                    label="Approve"
                  />
                  <WorkspaceActionButton
                    endpoint={`${actions}/offer-decide`}
                    body={{ offerId: offer.id, approve: false }}
                    label="Withdraw"
                    variant="danger"
                    promptFor={{ name: 'note', label: 'Why?' }}
                  />
                </>
              )}
              {recruiter && offer.status === 'APPROVED' && (
                <WorkspaceActionButton
                  endpoint={`${actions}/offer-send`}
                  body={{ offerId: offer.id }}
                  label="Mark sent"
                />
              )}
              {recruiter && offer.status === 'SENT' && (
                <>
                  <WorkspaceActionButton
                    endpoint={`${actions}/offer-response`}
                    body={{ offerId: offer.id, accepted: true }}
                    label="Accepted"
                  />
                  <WorkspaceActionButton
                    endpoint={`${actions}/offer-response`}
                    body={{ offerId: offer.id, accepted: false }}
                    label="Declined"
                    variant="ghost"
                    promptFor={{ name: 'note', label: 'Reason given' }}
                  />
                </>
              )}
            </span>,
          ])}
        />

        {recruiter && bands && !hired && !liveOffer && !acceptedOffer && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 'var(--lf-text-md)', margin: '0 0 8px' }}>Make an offer</h3>
            <WorkspaceRecordForm
              endpoint={`${actions}/offer-create`}
              submitLabel="Create offer"
              fields={[
                {
                  name: 'candidateId',
                  label: 'Candidate',
                  type: 'select',
                  required: true,
                  options: [{ value: candidate.id, label: candidate.fullName }],
                },
                { name: 'basic', label: 'Basic', type: 'number', required: true },
                { name: 'housing', label: 'Housing allowance', type: 'number' },
                { name: 'transport', label: 'Transport allowance', type: 'number' },
                { name: 'otherAllowance', label: 'Other allowances', type: 'number' },
                { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
                { name: 'expiresAt', label: 'Offer expires', type: 'date' },
              ]}
            />
          </div>
        )}
      </section>

      {recruiter && acceptedOffer && !hired && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Complete the hire</h2>
          <p style={{ margin: '6px 0 12px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            Issues an invitation to {candidate.email}. The employee record is created when they accept and sets their
            password — nobody else ever knows it — and it will date from {date(acceptedOffer.joiningDate)} rather than
            the day they click the link.
          </p>
          <WorkspaceRecordForm
            endpoint={`${actions}/candidate-hire`}
            submitLabel="Issue invitation"
            fields={[
              {
                name: 'candidateId',
                label: 'Candidate',
                type: 'select',
                required: true,
                options: [{ value: candidate.id, label: candidate.fullName }],
              },
              { name: 'employeeNumber', label: 'Employee number', required: true },
              { name: 'designation', label: 'Job title' },
            ]}
          />
        </section>
      )}
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
const time = (value: Date) =>
  value.toLocaleTimeString('en-AE', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const total = (offer: { basic: unknown; housing: unknown; transport: unknown; otherAllowance: unknown }) =>
  [offer.basic, offer.housing, offer.transport, offer.otherAllowance]
    .reduce((sum: number, part) => sum + Number(part ?? 0), 0)
    .toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
