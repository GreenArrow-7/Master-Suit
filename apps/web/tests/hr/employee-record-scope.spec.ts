/**
 * Who an HR viewer may see, on every surface that lists people.
 *
 * `employee:VIEW` at OWN scope used to open the employee directory, the
 * joining/leaving dashboard and the expiring-documents list for the whole
 * workspace: the directory page and the two lifecycle services read every
 * employee, while only the HR API's `employees` resource applied the rule.
 * A browser check reproduced it — an OWN-scope role saw the administrator's
 * name, work email and employee number — and the documents list additionally
 * carried every employee's passport and Emirates ID numbers.
 *
 * The rule, one function for all of them (`employeeRecordScope`): every record
 * with `employee:VIEW` at ORGANIZATION scope, otherwise the viewer's own.
 * Document numbers only with `hr_documents:VIEW_SENSITIVE_FIELDS`, or on the
 * viewer's own documents.
 *
 * Checked with populated data, through the real session, on the API resources
 * and on the two page server components, whose rendered element trees are
 * searched for the values they would put on screen.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PermissionAction, VisibilityScope } from '@prisma/client';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import EmployeesPage from '@/app/(workspace)/[workspaceSlug]/people/employees/page';
import LifecyclePage from '@/app/(workspace)/[workspaceSlug]/people/lifecycle/page';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `empscope-${suffix}`;
const DAY = 86_400_000;

let tenantId = '';
const cookies: Record<string, string> = {};
const people: Record<string, { employeeId: string; email: string; number: string; name: string }> = {};
const documentNumbers: Record<string, string> = {};

async function member(
  label: string,
  grants: [string, PermissionAction, VisibilityScope][],
  employee?: { status: string },
) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 20, defaultScope: 'OWN' },
  });
  for (const [module, action, scope] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const email = `${label}-${suffix}@empscope.test`;
  const name = `Scope ${label} ${suffix}`;
  const user = await createWorkspaceUser({ tenantId, roleId: role.id, email, fullName: name });
  cookies[label] = await createSessionToken(tenantId, user.id);
  if (employee) {
    const membership = await prisma.workspaceMembership.findFirstOrThrow({ where: { tenantId, salesUserId: user.id } });
    const number = `ES-${label}-${suffix}`;
    const profile = await prisma.employeeProfile.create({
      data: { tenantId, membershipId: membership.id, employeeNumber: number, employmentStatus: employee.status },
    });
    people[label] = { employeeId: profile.id, email, number, name };
  }
  return user;
}

async function expiringDocument(label: string, days: number) {
  const number = `P${randomBytes(4).toString('hex').toUpperCase()}`;
  documentNumbers[label] = number;
  await prisma.hrEmployeeDocument.create({
    data: {
      tenantId,
      employeeId: people[label].employeeId,
      kind: 'PASSPORT',
      name: `Passport ${label}`,
      number,
      expiresAt: new Date(Date.now() + days * DAY),
    },
  });
}

async function overdueTask(label: string, title: string) {
  await prisma.hrChecklistTask.create({
    data: {
      tenantId,
      employeeId: people[label].employeeId,
      phase: 'ONBOARDING',
      title,
      blocking: true,
      dueDate: new Date(Date.now() - 3 * DAY),
    },
  });
}

const at = (resource: string, query = '') => ({
  path: `/api/v1/workspaces/${slug}/hr/${resource}${query}`,
  params: { workspaceSlug: slug, resource },
});
const read = (resource: string, as: string, query = '') => {
  const { path, params } = at(resource, query);
  return get(hrRead, path, cookies[as], params);
};

/** Every string a rendered element tree would put on screen or in props. */
function strings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) strings(item, out, seen);
    return out;
  }
  const element = node as { props?: unknown };
  if ('props' in element) return strings(element.props, out, seen);
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_') || typeof value === 'function') continue;
    strings(value, out, seen);
  }
  return out;
}

async function renderAs(as: string, page: (props: never) => Promise<unknown>, search: Record<string, string> = {}) {
  cookieJar.value = cookies[as];
  const tree = await page({
    params: Promise.resolve({ workspaceSlug: slug }),
    searchParams: Promise.resolve(search),
  } as never);
  return strings(tree).join('\n');
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'EmpScope LLC', displayName: 'EmpScope', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const O = 'ORGANIZATION' as const;
  await member(
    'hradmin',
    [
      ['employee', 'VIEW', O],
      ['employee', 'EDIT', O],
    ],
    { status: 'ACTIVE' },
  );
  await member('hrdocs', [
    ['employee', 'VIEW', O],
    ['hr_documents', 'VIEW_SENSITIVE_FIELDS', O],
  ]);
  await member('plain', [['employee', 'VIEW', 'OWN']], { status: 'ONBOARDING' });
  await member(
    'manager',
    [
      ['employee', 'VIEW', 'TEAM'],
      ['leave', 'APPROVE', 'TEAM'],
    ],
    { status: 'ACTIVE' },
  );
  await member('norecord', [['employee', 'VIEW', 'OWN']]);
  await member('joiner', [], { status: 'ONBOARDING' });
  await member('leaver', [], { status: 'NOTICE' });

  await expiringDocument('plain', 20);
  await expiringDocument('joiner', 30);
  await expiringDocument('leaver', -5);
  await overdueTask('plain', 'Signed offer letter returned');
  await overdueTask('joiner', 'Entry permit / employment visa');
  await overdueTask('joiner', 'Medical fitness test');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@empscope.test` } } });
});

const everyone = () => Object.values(people);
const others = (label: string) =>
  Object.entries(people)
    .filter(([key]) => key !== label)
    .map(([, p]) => p);

describe('HR API: the employees resource', () => {
  it('returns every employee to ORGANIZATION scope — the positive control', async () => {
    const res = await read('employees', 'hradmin');
    expect(res.status).toBe(200);
    expect(res.body.map((row: { employeeNumber: string }) => row.employeeNumber).sort()).toEqual(
      everyone()
        .map((p) => p.number)
        .sort(),
    );
  });

  it('returns only their own record to OWN scope, and nothing to a viewer without one', async () => {
    const own = await read('employees', 'plain');
    expect(own.body.map((row: { employeeNumber: string }) => row.employeeNumber)).toEqual([people.plain.number]);
    const none = await read('employees', 'norecord');
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);
  });
});

describe('HR API: the lifecycle dashboard', () => {
  it('names every joiner and leaver for ORGANIZATION scope', async () => {
    const res = await read('lifecycle', 'hradmin');
    expect(res.status).toBe(200);
    expect(res.body.joining.map((row: { employeeNumber: string }) => row.employeeNumber).sort()).toEqual(
      [people.plain.number, people.joiner.number].sort(),
    );
    expect(res.body.leaving.map((row: { employeeNumber: string }) => row.employeeNumber)).toEqual([
      people.leaver.number,
    ]);
    expect(res.body.overdueTasks).toBe(3);
    expect(res.body.documentsExpiring60d).toBe(3);
    expect(res.body.documentsExpired).toBe(1);
  });

  it('shows OWN scope only their own journey, and counts only their own', async () => {
    const res = await read('lifecycle', 'plain');
    expect(res.body.joining.map((row: { employeeNumber: string }) => row.employeeNumber)).toEqual([
      people.plain.number,
    ]);
    expect(res.body.leaving).toEqual([]);
    expect(res.body.overdueTasks).toBe(1);
    expect(res.body.documentsExpiring60d).toBe(1);
    expect(res.body.documentsExpired).toBe(0);
    const text = JSON.stringify(res.body);
    for (const other of others('plain')) expect(text).not.toContain(other.name);
  });

  it('shows a viewer with no employee record nothing at all', async () => {
    const res = await read('lifecycle', 'norecord');
    expect(res.body).toMatchObject({ joining: [], leaving: [], overdueTasks: 0, documentsExpiring60d: 0 });
  });
});

describe('HR API: expiring documents', () => {
  it('lists every document for ORGANIZATION scope, with numbers only for identity-document readers', async () => {
    const admin = await read('expiring-documents', 'hradmin');
    expect(admin.body.map((row: { employeeId: string }) => row.employeeId).sort()).toEqual(
      [people.plain.employeeId, people.joiner.employeeId, people.leaver.employeeId].sort(),
    );
    expect(admin.body.every((row: { number: string | null }) => row.number === null)).toBe(true);

    const docs = await read('expiring-documents', 'hrdocs');
    expect(docs.body.map((row: { number: string }) => row.number).sort()).toEqual(
      Object.values(documentNumbers).sort(),
    );
  });

  it('lists only their own document, with its number, for OWN scope', async () => {
    const res = await read('expiring-documents', 'plain');
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ employeeId: people.plain.employeeId, number: documentNumbers.plain });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(documentNumbers.joiner);
    expect(text).not.toContain(documentNumbers.leaver);
  });

  it('returns nothing when OWN scope names another employee', async () => {
    const res = await read('expiring-documents', 'plain', `?employeeId=${people.joiner.employeeId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('the Employees page', () => {
  it('lists everyone for ORGANIZATION scope — the positive control', async () => {
    const text = await renderAs('hradmin', EmployeesPage as never);
    for (const person of everyone()) {
      expect(text).toContain(person.email);
      expect(text).toContain(person.number);
    }
    expect(text).toContain(`${everyone().length} employees in this workspace.`);
  });

  it('lists only their own row for OWN scope', async () => {
    const text = await renderAs('plain', EmployeesPage as never);
    expect(text).toContain(people.plain.email);
    for (const other of others('plain')) {
      expect(text).not.toContain(other.email);
      expect(text).not.toContain(other.number);
      expect(text).not.toContain(other.name);
    }
    expect(text).toContain('1 employees in this workspace.');
  });

  it('does not let search reach past the scope', async () => {
    const text = await renderAs('plain', EmployeesPage as never, { q: people.hradmin.number });
    expect(text).not.toContain(people.hradmin.email);
    expect(text).toContain(`0 employees matching "${people.hradmin.number}".`);
  });

  it('lists nobody for a viewer with no employee record', async () => {
    const text = await renderAs('norecord', EmployeesPage as never);
    for (const person of everyone()) expect(text).not.toContain(person.email);
    expect(text).toContain('0 employees in this workspace.');
  });

  it('keeps TEAM scope to its own row too — the API rule, unchanged', async () => {
    const text = await renderAs('manager', EmployeesPage as never);
    expect(text).toContain(people.manager.email);
    for (const other of others('manager')) expect(text).not.toContain(other.email);
  });
});

describe('the Lifecycle page', () => {
  it('shows HR every joiner, leaver and expiring document', async () => {
    const text = await renderAs('hradmin', LifecyclePage as never);
    for (const label of ['plain', 'joiner', 'leaver']) expect(text).toContain(people[label].name);
  });

  it('shows OWN scope only their own journey and document', async () => {
    const text = await renderAs('plain', LifecyclePage as never);
    expect(text).toContain(people.plain.name);
    expect(text).not.toContain(people.joiner.name);
    expect(text).not.toContain(people.leaver.name);
    expect(text).not.toContain(people.hradmin.name);
  });

  it("will not open another employee's checklist for OWN scope", async () => {
    const text = await renderAs('plain', LifecyclePage as never, { employee: people.joiner.employeeId });
    expect(text).not.toContain('Entry permit / employment visa');
    expect(text).not.toContain('Medical fitness test');
  });

  it('opens their own checklist, and an approver may open a report’s', async () => {
    const own = await renderAs('plain', LifecyclePage as never, { employee: people.plain.employeeId });
    expect(own).toContain('Signed offer letter returned');
    const approver = await renderAs('manager', LifecyclePage as never, { employee: people.joiner.employeeId });
    expect(approver).toContain('Entry permit / employment visa');
  });
});
