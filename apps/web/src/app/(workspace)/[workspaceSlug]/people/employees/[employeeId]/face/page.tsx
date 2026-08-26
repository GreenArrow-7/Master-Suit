import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import { getHrPolicy } from '@/services/hr/settings';
import { Forbidden } from '@/lib/errors';
import FaceEnrolmentConsole from './FaceEnrolmentConsole';

export const metadata = { title: 'Face enrolment' };

const stamp = (value: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);

/**
 * Administrator face enrolment for one employee.
 *
 * Shows who is being enrolled, whether they have consented, and whether they
 * are enrolled — then the capture session itself. The template count is
 * metadata and is safe to show; the templates are never selected here, because
 * a face template is the one credential that cannot be reissued after a leak.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; employeeId: string }> }) {
  const { workspaceSlug, employeeId } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'EDIT'] });
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can run face enrolment.');

  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
    select: {
      id: true,
      employeeNumber: true,
      designation: true,
      employmentStatus: true,
      department: { select: { name: true } },
      designationRecord: { select: { name: true } },
      membership: { select: { platformUser: { select: { fullName: true, email: true } } } },
    },
  });
  if (!employee) notFound();

  const [templates, consent, policy, lastVerification] = await Promise.all([
    // Count only: never select `embedding`.
    prisma.hrFaceTemplate.aggregate({
      where: { tenantId: ctx.tenantId, employeeId: employee.id },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.biometricConsent.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: employee.id, grantedAt: { not: null }, withdrawnAt: null },
      select: { grantedAt: true, policyVersion: true },
    }),
    getHrPolicy(ctx),
    // `select` rather than `omit`: the two cannot be combined, and naming the
    // two columns wanted keeps the coordinates and capture path out by default
    // rather than by remembering to exclude them.
    prisma.hrAttendancePunch.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: employee.id },
      orderBy: { serverTime: 'desc' },
      select: { serverTime: true, result: true },
    }),
  ]);

  const enrolledCount = templates._count._all;
  const enrolled = enrolledCount >= policy.faceSamplesRequired;
  const person = employee.membership.platformUser;

  const facts: [string, string][] = [
    ['Employee', `${person.fullName} · ${employee.employeeNumber}`],
    ['Work email', person.email],
    ['Department', employee.department?.name ?? '—'],
    ['Designation', employee.designationRecord?.name ?? employee.designation ?? '—'],
    ['Employment status', employee.employmentStatus],
    ['Consent', consent?.grantedAt ? `Given ${stamp(consent.grantedAt)} · ${consent.policyVersion}` : 'Not given'],
    ['Enrollment', enrolled ? `Enrolled · ${enrolledCount} templates` : 'Not enrolled'],
    ['Templates updated', templates._max.createdAt ? stamp(templates._max.createdAt) : '—'],
    [
      'Last verification',
      lastVerification ? `${stamp(lastVerification.serverTime)} · ${lastVerification.result}` : '—',
    ],
  ];

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Face enrolment</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '92ch' }}>
          Run this in person, with the employee at the camera. You supervise the session; the consent has to be theirs.
        </p>
      </section>

      <div className="lf-card lf-face__facts">
        <span className="lf-badge" data-tone={enrolled ? 'ok' : 'warn'}>
          {enrolled ? 'ENROLLED' : 'NOT ENROLLED'}
        </span>
        <dl>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <FaceEnrolmentConsole
        actionsBase={`/api/v1/workspaces/${workspaceSlug}/hr/actions`}
        employeeId={employee.id}
        employeeName={person.fullName}
        consented={Boolean(consent?.grantedAt)}
        enrolled={enrolledCount > 0}
        samplesRequired={policy.faceSamplesRequired}
        activityHref={`/${workspaceSlug}/people/face-activity?employee=${employee.id}`}
      />
    </div>
  );
}
