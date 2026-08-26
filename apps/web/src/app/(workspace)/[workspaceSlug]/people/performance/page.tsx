import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { myEmployee, reportingLine } from '@/services/hr/leave';
import {
  goalsFor,
  isPerformanceAdmin,
  listCycles,
  mayReadAllPerformance,
  performanceSummary,
  pipsFor,
  reviewsFor,
} from '@/services/hr/performance';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { cycle: selectedCycle } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  const hr = isPerformanceAdmin(ctx);
  const wide = mayReadAllPerformance(ctx) || hr;

  const cycles = await listCycles(ctx);
  const cycleId = selectedCycle ?? cycles.find((row) => row.status !== 'CLOSED')?.id ?? cycles[0]?.id;

  const [reviews, goals, pips, summary, competencies, team] = await Promise.all([
    cycleId ? reviewsFor(ctx, { cycleId }) : [],
    goalsFor(ctx, undefined, cycleId),
    pipsFor(ctx),
    cycleId ? performanceSummary(ctx, cycleId) : null,
    prisma.hrCompetency.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    wide
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, id: { in: await reportingLine(ctx) } },
          include: { membership: { include: { platformUser: true } } },
        }),
  ]);

  const myReview = reviews.find((review) => review.employeeId === self?.id);
  const toWrite = reviews.filter((review) => review.employeeId !== self?.id && review.status === 'PENDING_MANAGER');
  const toCalibrate = hr ? reviews.filter((review) => review.status === 'CALIBRATION') : [];
  const goalWeight = goals.reduce((total, goal) => (goal.status === 'CANCELLED' ? total : total + goal.weight), 0);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Performance</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '78ch' }}>
          You write your self-assessment first, so your manager&apos;s rating is informed by it. Their assessment stays
          hidden from you until it has been calibrated and released, and only you can acknowledge the result.
        </p>
      </section>

      {cycles.length > 1 && (
        <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {cycles.map((row) => (
            <a
              key={row.id}
              className={row.id === cycleId ? 'lf-btn' : 'lf-btn lf-btn--ghost'}
              href={`?cycle=${row.id}`}
            >
              {row.name}
            </a>
          ))}
        </section>
      )}

      {summary && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--lf-space-4)',
          }}
        >
          {[
            ['Outstanding', summary.outstanding],
            ['Complete', summary.byStatus.COMPLETE ?? 0],
            ['Active plans', summary.activePips],
            ...Object.entries(summary.ratingDistribution).map(([rating, count]) => [`Rated ${rating}`, count]),
          ].map(([label, value]) => (
            <article className="lf-card" key={String(label)} style={{ padding: 'var(--lf-space-5)' }}>
              <div className="lf-eyebrow">{label}</div>
              <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 32, marginTop: 6 }}>{String(value)}</div>
            </article>
          ))}
        </section>
      )}

      {myReview && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>My review</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              {STATUS_HELP[myReview.status]}
            </p>
          </div>

          {myReview.status === 'PENDING_SELF' && (
            <WorkspaceRecordForm
              endpoint={`${actions}/review-self`}
              submitLabel="Submit self-assessment"
              fields={[
                {
                  name: 'reviewId',
                  label: 'Review',
                  type: 'select',
                  required: true,
                  options: [{ value: myReview.id, label: 'My review' }],
                },
                { name: 'comments', label: 'How did the period go?', required: true },
                {
                  name: 'rating',
                  label: 'Your own rating (1–5)',
                  type: 'select',
                  options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
                },
              ]}
            />
          )}

          {myReview.selfComments && (
            <div>
              <strong>What I said</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-600)' }}>{myReview.selfComments}</p>
            </div>
          )}

          {myReview.managerComments ? (
            <div>
              <strong>
                My manager ({myReview.managerRating}/5
                {myReview.finalRating && myReview.finalRating !== myReview.managerRating
                  ? ` · calibrated to ${myReview.finalRating}/5`
                  : ''}
                )
              </strong>
              <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-600)' }}>{myReview.managerComments}</p>
            </div>
          ) : (
            myReview.status !== 'PENDING_SELF' && (
              <p style={{ margin: 0, color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-sm)' }}>
                Your manager&apos;s assessment is released once it has been calibrated.
              </p>
            )
          )}

          {myReview.status === 'AWAITING_ACKNOWLEDGEMENT' && (
            <WorkspaceActionButton
              endpoint={`${actions}/review-acknowledge`}
              body={{ reviewId: myReview.id }}
              label="Acknowledge"
              promptFor={{ name: 'note', label: 'Anything to add? (optional)', required: false }}
            />
          )}
        </section>
      )}

      {toWrite.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Reviews waiting on me</h2>
          <WorkspaceTable
            headers={['Employee', 'They rated themselves', 'What they said']}
            rows={toWrite.map((review) => [
              review.employee.membership.platformUser.fullName,
              review.selfRating ? `${review.selfRating}/5` : '—',
              review.selfComments ?? '—',
            ])}
          />
          <div style={{ marginTop: 12 }}>
            <WorkspaceRecordForm
              endpoint={`${actions}/review-manager`}
              submitLabel="Submit manager review"
              fields={[
                {
                  name: 'reviewId',
                  label: 'Whose review',
                  type: 'select',
                  required: true,
                  options: toWrite.map((review) => ({
                    value: review.id,
                    label: review.employee.membership.platformUser.fullName,
                  })),
                },
                { name: 'comments', label: 'Assessment', required: true },
                {
                  name: 'rating',
                  label: 'Rating (1–5)',
                  type: 'select',
                  required: true,
                  options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
                },
              ]}
            />
          </div>
        </section>
      )}

      {toCalibrate.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Awaiting calibration</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            The manager&apos;s rating is kept alongside the final one, so a moved rating stays visible to the employee
            who disputes it.
          </p>
          <WorkspaceTable
            headers={['Employee', 'Self', 'Manager', 'Comments']}
            rows={toCalibrate.map((review) => [
              review.employee.membership.platformUser.fullName,
              review.selfRating ? `${review.selfRating}/5` : '—',
              review.managerRating ? `${review.managerRating}/5` : '—',
              review.managerComments ?? '—',
            ])}
          />
          <div style={{ marginTop: 12 }}>
            <WorkspaceRecordForm
              endpoint={`${actions}/review-calibrate`}
              submitLabel="Set final rating"
              fields={[
                {
                  name: 'reviewId',
                  label: 'Review',
                  type: 'select',
                  required: true,
                  options: toCalibrate.map((review) => ({
                    value: review.id,
                    label: review.employee.membership.platformUser.fullName,
                  })),
                },
                {
                  name: 'finalRating',
                  label: 'Final rating (1–5)',
                  type: 'select',
                  required: true,
                  options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
                },
                { name: 'note', label: 'Why, if it differs from the manager’s' },
              ]}
            />
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>My goals — {goalWeight}% weighted</h2>
        <WorkspaceTable
          headers={['Objective', 'Measure', 'Target', 'Weight', 'Progress', 'Status']}
          empty="No goal has been set for this cycle."
          rows={goals.map((goal) => [
            goal.title,
            goal.metric ?? '—',
            goal.target ?? '—',
            `${goal.weight}%`,
            `${goal.progress}%`,
            <span className="lf-badge" key="status">
              {goal.status}
            </span>,
          ])}
        />
        <div style={{ marginTop: 12 }}>
          <WorkspaceRecordForm
            endpoint={`${actions}/goal-set`}
            submitLabel="Add goal"
            fields={[
              ...(wide || team.length > 1
                ? [
                    {
                      name: 'employeeId',
                      label: 'For (blank for yourself)',
                      type: 'select' as const,
                      options: team.map((employee) => ({
                        value: employee.id,
                        label: employee.membership.platformUser.fullName,
                      })),
                    },
                  ]
                : []),
              ...(cycleId
                ? [
                    {
                      name: 'cycleId',
                      label: 'Cycle',
                      type: 'select' as const,
                      options: cycles.map((row) => ({ value: row.id, label: row.name })),
                    },
                  ]
                : []),
              { name: 'title', label: 'Objective', required: true },
              { name: 'metric', label: 'How it is measured' },
              { name: 'target', label: 'Target' },
              { name: 'weight', label: 'Weight %', type: 'number' },
              { name: 'dueOn', label: 'Due', type: 'date' },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Improvement plans</h2>
        <WorkspaceTable
          headers={['Employee', 'Objective', 'Window', 'Status', 'Checkpoints', 'Acknowledged']}
          empty="No improvement plan is open."
          rows={pips.map((pip) => [
            pip.employee.membership.platformUser.fullName,
            pip.objective,
            `${date(pip.startsOn)} – ${date(pip.endsOn)}`,
            <span className="lf-badge" key="status">
              {pip.status.replace(/_/g, ' ')}
            </span>,
            `${pip.checkpoints.filter((checkpoint) => checkpoint.completedAt).length}/${pip.checkpoints.length}`,
            pip.acknowledgedAt ? (
              date(pip.acknowledgedAt)
            ) : pip.employeeId === self?.id && pip.status === 'ACTIVE' ? (
              <WorkspaceActionButton
                key="ack"
                endpoint={`${actions}/pip-acknowledge`}
                body={{ pipId: pip.id }}
                label="Acknowledge"
              />
            ) : (
              'Not yet'
            ),
          ])}
        />
      </section>

      {hr && cycleId && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Cycle administration</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              Opening a cycle creates one review per eligible employee, so an unstarted review is visible rather than
              merely absent. {competencies.length} competencies are configured.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <WorkspaceActionButton endpoint={`${actions}/cycle-open`} body={{ cycleId }} label="Open cycle" />
            <WorkspaceActionButton
              endpoint={`${actions}/cycle-status`}
              body={{ cycleId, status: 'CALIBRATION' }}
              label="Move to calibration"
              variant="ghost"
            />
            <WorkspaceActionButton
              endpoint={`${actions}/cycle-status`}
              body={{ cycleId, status: 'CLOSED' }}
              label="Close cycle"
              variant="ghost"
              confirm="Close this cycle?"
            />
            {competencies.length === 0 && (
              <WorkspaceActionButton
                endpoint={`${actions}/competencies-seed`}
                body={{}}
                label="Seed competency framework"
              />
            )}
          </div>
        </section>
      )}

      {hr && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Open a review cycle</h2>
          <WorkspaceRecordForm
            endpoint={`${actions}/cycle-create`}
            submitLabel="Create cycle"
            fields={[
              { name: 'name', label: 'Name', required: true },
              {
                name: 'type',
                label: 'Type',
                type: 'select',
                options: ['ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'PROBATION', 'CUSTOM'].map((value) => ({
                  value,
                  label: value.toLowerCase(),
                })),
              },
              { name: 'periodStart', label: 'Period start', type: 'date', required: true },
              { name: 'periodEnd', label: 'Period end', type: 'date', required: true },
              { name: 'selfReviewDueAt', label: 'Self-assessment due', type: 'date' },
              { name: 'managerReviewDueAt', label: 'Manager review due', type: 'date' },
            ]}
          />
        </section>
      )}
    </div>
  );
}

const STATUS_HELP: Record<string, string> = {
  PENDING_SELF: 'Write your self-assessment. Your manager cannot rate you until you have.',
  PENDING_MANAGER: 'Submitted. Your manager is writing theirs.',
  CALIBRATION: 'Your manager has written theirs. HR is calibrating ratings across teams before it is released.',
  AWAITING_ACKNOWLEDGEMENT: 'Released. Read it and acknowledge when you are ready.',
  COMPLETE: 'Complete.',
};

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
