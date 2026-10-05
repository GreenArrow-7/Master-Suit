/**
 * The four HR downloads — payslip PDF, WPS bank file, HR document, HR report —
 * run the kernel's prologue with `sessionOnly`.
 *
 * No session is a 401, and so is an API key holding the very role the session
 * holds: the key is never read. Another workspace's slug is a 404. A real HR
 * session reaches each handler: the report comes back as CSV, and a payslip, run
 * or document that does not exist is the service's own 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { issueApiKey } from '@/lib/auth/apiKey';
import { grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { GET as payslipPdf } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/payslips/[payslipId]/pdf/route';
import { GET as wpsFile } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/payroll/[runId]/wps/route';
import { GET as documentDownload } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/documents/[documentId]/download/route';
import { GET as reportExport } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/reports/[reportKey]/export/route';

type Handler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

let fixture: Fixture;
let apiKey = '';

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { id: fixture.a.userId, tenantId: fixture.a.tenantId },
    select: { roleId: true },
  });
  await grantPermissions(fixture.a.tenantId, roleId, [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['payroll', 'VIEW'],
    ['payroll', 'EXPORT'],
    ['hr_documents', 'VIEW'],
  ]);
  apiKey = (await issueApiKey(fixture.a.tenantId, 'hr-download-key', roleId, [], fixture.a.userId)).key;
});

afterAll(async () => {
  await fixture.cleanup();
});

/** Each route as [name, handler, (slug) => [path, params]], pointing at a record that does not exist. */
const ROUTES: [string, Handler, (slug: string) => [string, Record<string, string>]][] = [
  ['payslip PDF', payslipPdf, (s) => [`/hr/payslips/none/pdf`, { workspaceSlug: s, payslipId: 'none' }]],
  ['WPS file', wpsFile, (s) => [`/hr/payroll/none/wps`, { workspaceSlug: s, runId: 'none' }]],
  ['HR document', documentDownload, (s) => [`/hr/documents/none/download`, { workspaceSlug: s, documentId: 'none' }]],
  [
    'HR report',
    reportExport,
    (s) => [`/hr/reports/headcount-by-department/export`, { workspaceSlug: s, reportKey: 'headcount-by-department' }],
  ],
];

const call = (
  handler: Handler,
  slug: string,
  at: (slug: string) => [string, Record<string, string>],
  headers: Record<string, string>,
) => {
  const [path, params] = at(slug);
  return handler(new Request(`http://localhost/api/v1/workspaces/${slug}${path}`, { headers }), {
    params: Promise.resolve(params),
  });
};

describe.each(ROUTES)('the %s', (_name, handler, at) => {
  it('refuses no session, and an API key holding the same role, with 401', async () => {
    expect((await call(handler, fixture.a.slug, at, {})).status).toBe(401);
    expect((await call(handler, fixture.a.slug, at, { authorization: `Bearer ${apiKey}` })).status).toBe(401);
  });

  it("answers another workspace's slug with 404", async () => {
    expect((await call(handler, fixture.b.slug, at, { cookie: fixture.a.cookie })).status).toBe(404);
  });
});

describe('an HR session', () => {
  it('gets the report as CSV', async () => {
    const res = await call(reportExport, fixture.a.slug, ROUTES[3]![2], { cookie: fixture.a.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it("reaches the payslip, run and document lookups, whose missing record is the service's 404", async () => {
    for (const [name, handler, at] of ROUTES.slice(0, 3)) {
      const res = await call(handler, fixture.a.slug, at, { cookie: fixture.a.cookie });
      expect(res.status, name).toBe(404);
    }
  });
});
