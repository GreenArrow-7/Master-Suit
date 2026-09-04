import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';

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
        title="Employees"
        description={
          rows.length === 500
            ? `Showing the first 500 employees — narrow with search.`
            : query
              ? `${rows.length} employees matching "${query}".`
              : `${rows.length} employees in this workspace.`
        }
        actions={
          <Link className="lf-btn lf-btn--sm" href={`/${workspaceSlug}/people/employees/new`}>
            Invite employee
          </Link>
        }
      />
      {/* The same toolbar as the Sales lists: a search box, and a way back.
          The labelled card-form with its own Search button was the one place
          in the product where finding a record took a form submission. */}
      <div className="lf-toolbar">
        <form className="lf-toolbar__search" method="get" role="search">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" />
          </svg>
          <input
            className="lf-input"
            name="q"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Search by name, work email or employee number"
            aria-label="Search employees"
            // Native, no client JS: an empty or whitespace-only submission would
            // navigate to `?q=`, which reads as a search that matched nothing
            // rather than no search at all.
            required
            pattern=".*\S.*"
            title="Type a name, work email or employee number"
          />
        </form>
        {query && (
          <Link className="lf-btn lf-btn--ghost lf-btn--sm" href={`/${workspaceSlug}/people/employees`}>
            Clear all
          </Link>
        )}
      </div>
      <WorkspaceTable
        // The toolbar above already searches server-side; a second, client-side
        // box over the same rows was two controls with one accessible name.
        searchable={false}
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
          <Badge key="status" value={employee.employmentStatus} />,
        ])}
      />
    </div>
  );
}
