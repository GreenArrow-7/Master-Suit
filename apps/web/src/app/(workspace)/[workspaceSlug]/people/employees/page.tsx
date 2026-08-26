import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';

export default async function EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  // Matches the three columns the table actually shows a person by. The input
  // lives on this page: the People top bar deliberately leads with the
  // breadcrumb instead of a search box, and when that changed the `?q=`
  // handling here was left with no way to reach it from the UI — the e2e
  // search specs are what caught the regression.
  const query = (await searchParams).q?.trim();
  const search = query
    ? {
        OR: [
          { employeeNumber: { contains: query, mode: 'insensitive' as const } },
          { membership: { platformUser: { fullName: { contains: query, mode: 'insensitive' as const } } } },
          { membership: { platformUser: { email: { contains: query, mode: 'insensitive' as const } } } },
        ],
      }
    : {};

  const rows = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, ...search },
    // Exactly the columns the table shows. The previous include pulled the full
    // PlatformUser row — passwordHash, mfaSecret and recovery codes included —
    // for every employee on every visit to this page.
    select: {
      id: true,
      employeeNumber: true,
      designation: true,
      employmentStatus: true,
      membership: {
        select: {
          roleSnapshot: true,
          platformUser: { select: { fullName: true, email: true } },
          salesUser: { select: { role: { select: { name: true } } } },
        },
      },
      department: { select: { name: true } },
    },
    orderBy: { employeeNumber: 'asc' },
    // ponytail: hard cap, no pager — the search box is the escape hatch. Wire a
    // Pager like the leads list if a workspace ever exceeds this headcount.
    take: 500,
  });
  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="People"
        title="Employees"
        description={
          rows.length === 500
            ? `Showing the first 500 employee records — narrow with search.`
            : query
              ? `${rows.length} employee records matching "${query}".`
              : `${rows.length} employee records in this workspace.`
        }
        breadcrumbs={[{ label: 'People', href: `/${workspaceSlug}/people` }, { label: 'Employees' }]}
        actions={
          <Link className="lf-btn" href={`/${workspaceSlug}/people/employees/new`}>
            Invite employee
          </Link>
        }
      />
      <form className="lf-card lf-filters" method="get" role="search">
        <div className="lf-field lf-filters__search">
          <label className="lf-label" htmlFor="emp-q">
            Search employees
          </label>
          <input
            id="emp-q"
            className="lf-input"
            name="q"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Name, work email or employee number"
            // Native, no client JS: an empty or whitespace-only submission would
            // navigate to `?q=`, which reads as a search that matched nothing
            // rather than no search at all. `required` blocks empty; the pattern
            // blocks spaces.
            required
            pattern=".*\S.*"
            title="Type a name, work email or employee number"
          />
        </div>
        <button className="lf-btn" type="submit">
          Search
        </button>
        {query && (
          <Link className="lf-btn lf-btn--ghost" href={`/${workspaceSlug}/people/employees`}>
            Clear
          </Link>
        )}
      </form>
      <WorkspaceTable
        empty={
          query
            ? `Nothing matches "${query}". Search covers name, work email and employee number.`
            : 'Invite the first employee and they will appear here once they accept.'
        }
        headers={['Employee', 'Number', 'Department', 'Designation', 'Role', 'Status']}
        rows={rows.map((employee) => [
          [
            <strong key="name">{employee.membership.platformUser.fullName}</strong>,
            <span key="email">{employee.membership.platformUser.email}</span>,
          ],
          employee.employeeNumber,
          employee.department?.name ?? '—',
          employee.designation ?? '—',
          employee.membership.salesUser?.role.name ?? employee.membership.roleSnapshot ?? '—',
          employee.employmentStatus,
        ])}
      />
    </div>
  );
}
