import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  ALREADY_PROCESSING,
  cancelAccountDeletion,
  requestAccountDeletion,
  sweepAccountDeletions,
  type RetainedCategory,
} from '@/services/identity/accountDeletion';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * What happens when erasure does not go cleanly the first time.
 *
 * Every case here exists because a reviewer found the shipped behaviour and the code's own
 * description of it disagreeing. The executor documented itself as resumable and the sweep
 * never selected a resumable row; the queue admitted blocked requests with no way out of
 * it; cancelling a request the worker held told the person it did not exist. The tests
 * that were supposed to cover those all went through `processAccountDeletion` directly,
 * so they proved properties of a function rather than of the system that runs it.
 *
 * These go through `sweepAccountDeletions` — the only thing that calls the executor in
 * production — and are scoped to their own accounts, because the suites run in parallel
 * against one database and an unscoped sweep erases a sibling's fixtures mid-assertion.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';
const ownedPlatformUserIds = new Set<string>();
let seq = 0;
let fixture: Fixture;

function ctxFor(tenantId: string, userId: string): Ctx {
  return {
    tenantId,
    actor: { id: userId, permissions: new Map() },
    requestId: `test-${Math.random().toString(36).slice(2)}`,
    ip: '127.0.0.1',
    userAgent: 'vitest',
  } as unknown as Ctx;
}

/** Only this file's accounts, so a sibling suite's open requests are never touched. */
function mine() {
  return [...ownedPlatformUserIds];
}

async function makePerson(label: string) {
  const role = await prisma.role.create({
    data: {
      tenantId: fixture.a.tenantId,
      key: `recov-${seq++}-${Date.now()}`,
      name: label,
      rank: 60,
      defaultScope: 'OWN',
    },
  });
  const user = await createWorkspaceUser({
    tenantId: fixture.a.tenantId,
    roleId: role.id,
    email: `recov-${seq}-${Date.now()}@example.com`,
    fullName: label,
  });
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { id: true, platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  ownedPlatformUserIds.add(membership.platformUserId);
  return { user, ...membership, ctx: ctxFor(fixture.a.tenantId, user.id) };
}

/** An employment record with the identifiers and documents HR actually holds. */
async function giveEmployeeRecord(membershipId: string) {
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId: fixture.a.tenantId,
      membershipId,
      employeeNumber: `EMP-DEL-${seq++}-${Date.now()}`,
      iban: 'AE070331234567890123456',
      bankName: 'Test Bank',
      bankAgentId: '123456',
      wpsPersonId: '784198000000000',
      reraBrn: 'BRN-0001',
    },
    select: { id: true },
  });
  await prisma.hrEmployeeDocument.create({
    data: {
      tenantId: fixture.a.tenantId,
      employeeId: employee.id,
      kind: 'PASSPORT',
      name: 'Passport scan',
      storageKey: `hr/${employee.id}/passport.pdf`,
    },
  });
  await prisma.hrFaceTemplate.create({
    data: {
      tenantId: fixture.a.tenantId,
      employeeId: employee.id,
      embedding: Buffer.alloc(8, 1),
    },
  });
  await prisma.biometricConsent.create({
    data: {
      tenantId: fixture.a.tenantId,
      employeeId: employee.id,
      policyVersion: 'v1',
      grantedAt: new Date(),
    },
  });
  return employee;
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({ where: { platformUserId: { in: mine() } } });
  await fixture.cleanup();
});

describe('an erasure that was interrupted', () => {
  it('is resumed by the sweep and finishes, rather than being stranded half-erased', async () => {
    const person = await makePerson('Crashed Midway');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });

    // The state a crash leaves behind: step 1 has run, so the account is already
    // deactivated and its sessions are gone, and the row is still IN_PROGRESS because
    // nothing got as far as writing a result. This is not a hypothetical — it is what
    // both failure paths in the executor deliberately produce.
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { status: 'DEACTIVATED' } });
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const tally = await sweepAccountDeletions(20, mine());
    expect(tally.considered).toBeGreaterThanOrEqual(1);

    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, completedAt: true },
    });
    // Before this, the sweep selected only REQUESTED and BLOCKED. The row stayed
    // IN_PROGRESS for ever: unfinishable because nothing picked it up, unwithdrawable
    // because cancel refuses a started request, and unrepeatable because the partial
    // unique index counts it as open. A deactivated account with no way out.
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).not.toBeNull();
    expect(
      (await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } })).passwordHash,
    ).toBeNull();
  });

  it('is left alone while it is still running', async () => {
    const person = await makePerson('Currently Running');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    // A fresh IN_PROGRESS row belongs to a run that is still going. Picking it up would
    // put two executors on one account, which is why the staleness window has to be
    // longer than the interval between sweeps.
    const tally = await sweepAccountDeletions(20, [person.platformUserId]);
    expect(tally.considered).toBe(0);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'IN_PROGRESS',
    );
  });
});

describe('a request the executor already holds', () => {
  it('cannot be withdrawn, and says so rather than claiming it does not exist', async () => {
    const person = await makePerson('Too Late To Stop');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    // The specific message, not any rejection. Cancel used to filter its read to
    // REQUESTED and BLOCKED, so an IN_PROGRESS row matched nothing and the person was
    // told "Deletion request not found" — of the two possible wrong answers, the one
    // that is certainly false.
    await expect(cancelAccountDeletion(person.ctx)).rejects.toThrow(ALREADY_PROCESSING);

    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'IN_PROGRESS',
    );
  });
});

describe('a request that is blocked', () => {
  it('is not re-checked on every sweep, so it cannot starve the queue behind it', async () => {
    const person = await makePerson('Blocked Indefinitely');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: true } });

    const first = await sweepAccountDeletions(20, [person.platformUserId]);
    expect(first.blocked).toBe(1);

    // Immediately again. The sweep takes the oldest twenty open rows, and a request
    // blocked by an owner who never transfers keeps the oldest requestedAt for ever —
    // twenty of those filled every batch on every run and nothing newer was ever reached.
    const second = await sweepAccountDeletions(20, [person.platformUserId]);
    expect(second.considered).toBe(0);

    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: false } });
    await prisma.accountDeletionRequest.deleteMany({ where: { id: request.id } });
  });

  it('is re-checked once the cooldown has passed, and completes if the blocker is gone', async () => {
    const person = await makePerson('Blocked Then Transferred');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: true } });
    expect((await sweepAccountDeletions(20, [person.platformUserId])).blocked).toBe(1);

    // Ownership transferred, and the cooldown elapsed. updatedAt is maintained by Prisma,
    // so it is moved with raw SQL rather than an update that would only refresh it.
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: false } });
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.$executeRaw`UPDATE "AccountDeletionRequest" SET "updatedAt" = ${longAgo} WHERE "id" = ${request.id}`;

    expect((await sweepAccountDeletions(20, [person.platformUserId])).completed).toBe(1);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'COMPLETED',
    );
  });
});

describe('the things erasure is supposed to remove', () => {
  it('removes the factor rows, the pending challenges, the face template and the consent', async () => {
    const person = await makePerson('Fully Equipped');
    await giveEmployeeRecord(person.id);
    await prisma.authenticationFactor.create({
      data: { platformUserId: person.platformUserId, type: 'TOTP', secret: 'enc:whatever', verifiedAt: new Date() },
    });
    await prisma.platformMfaChallenge.create({
      data: {
        platformUserId: person.platformUserId,
        tokenHash: `chal-${Math.random().toString(36).slice(2)}`,
        credentialVersion: 1,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    // The rows exist before the sweep runs. Without this the deletions and the
    // verification counters below were both executing against nothing, and a change that
    // removed either of them would still have gone green.
    expect(await prisma.authenticationFactor.count({ where: { platformUserId: person.platformUserId } })).toBe(1);
    expect(
      await prisma.hrFaceTemplate.count({
        where: { tenantId: fixture.a.tenantId, employee: { membershipId: person.id } },
      }),
    ).toBe(1);

    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    expect((await sweepAccountDeletions(20, [person.platformUserId])).completed).toBe(1);

    expect(await prisma.authenticationFactor.count({ where: { platformUserId: person.platformUserId } })).toBe(0);
    expect(await prisma.platformMfaChallenge.count({ where: { platformUserId: person.platformUserId } })).toBe(0);
    expect(
      await prisma.hrFaceTemplate.count({
        where: { tenantId: fixture.a.tenantId, employee: { membershipId: person.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.biometricConsent.count({
        where: { tenantId: fixture.a.tenantId, employee: { membershipId: person.id } },
      }),
    ).toBe(0);

    const outcome = (
      await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { outcome: true },
      })
    ).outcome as { faceTemplatesDeleted: number; authenticationFactorsDeleted: number };
    expect(outcome.faceTemplatesDeleted).toBe(1);
    expect(outcome.authenticationFactorsDeleted).toBe(1);
  });
});

describe('what the completed request admits it did not remove', () => {
  it('names the employment record, the identity documents and the backups, with counts', async () => {
    const person = await makePerson('Has An HR File');
    await giveEmployeeRecord(person.id);

    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    expect((await sweepAccountDeletions(20, [person.platformUserId])).completed).toBe(1);

    const outcome = (
      await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { outcome: true },
      })
    ).outcome as unknown as { retained: RetainedCategory[] };
    const categories = outcome.retained.map((entry) => entry.category);

    // The point of the manifest. A COMPLETED row used to say nothing about the IBAN, the
    // WPS person id and the scanned passport still sitting on the employment record, which
    // made "your account has been deleted" a claim the data did not support.
    expect(categories).toContain('hr_employment_record');
    expect(categories).toContain('hr_financial_identifiers');
    expect(categories).toContain('hr_identity_documents');
    expect(categories).toContain('workspace_attribution');
    expect(categories).toContain('backups');

    const documents = outcome.retained.find((entry) => entry.category === 'hr_identity_documents');
    expect(documents?.count).toBe(1);
    expect(documents?.reason).toMatch(/Not erased by this request/);

    // Counted from the database, so it has to still be true of the database.
    expect(
      await prisma.hrEmployeeDocument.count({
        where: { tenantId: fixture.a.tenantId, employee: { membershipId: person.id } },
      }),
    ).toBe(1);
  });
});
