/**
 * Invitations — the only way a login comes into existence.
 *
 * The previous mechanism was an administrator typing a plaintext password into a
 * form and reading it out. Three things were wrong with that: the administrator
 * knew the credential, there was no expiry on it, and an offer once made could
 * not be withdrawn. `UserStatus.INVITED` existed and counted against the seat
 * limit, but nothing ever set it.
 *
 * The token is 256 bits of randomness, stored only as a SHA-256 hash. A leaked
 * database row is not redeemable; a leaked *email* is, which is why it expires.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma, withTx } from '@/lib/db';
import { env } from '@/lib/env';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { assertMayAdministerRole, type Ctx } from '@/lib/security/rbac';
import { audit } from '@/lib/security/audit';
import { hashPassword, checkPolicy } from '@/lib/auth/password';
import { sendMail } from '@/lib/mailer';
import { passwordPolicy } from './accounts';
import { buildChecklist, isAgent } from '@/services/hr/lifecycle';
import { resolvePolicy } from '@/services/hr/settings';

export const INVITE_TTL_HOURS = 72;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface InviteInput {
  email: string;
  fullName: string;
  roleId: string;
  /** Present when accepting should also create an HR record. */
  employeeNumber?: string;
  jobTitle?: string;
  departmentId?: string;
  /** Set by the ATS when the invitation comes from a hired candidate — §109. */
  candidateId?: string;
  /** The agreed start date from the accepted offer, rather than the acceptance date. */
  joiningDate?: Date;
  /** Full-time, contract, and so on — asked for on the invitation form. */
  employmentType?: string;
}

/**
 * Seats are counted at invite time, not at acceptance.
 *
 * Counting only on acceptance lets an administrator issue a hundred invitations
 * against ten seats and discover the problem when the eleventh person tries to
 * join — by which point the promise has already been made.
 */
async function assertSeatAvailable(ctx: Ctx) {
  const workspace = await prisma.tenant.findFirst({
    where: { id: ctx.tenantId },
    select: { maxUsers: true, maxEmployees: true },
  });
  if (!workspace?.maxUsers) return;

  const [members, pending] = await Promise.all([
    prisma.workspaceMembership.count({ where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'INVITED'] } } }),
    prisma.workspaceInvitation.count({ where: { tenantId: ctx.tenantId, pendingKey: { not: null } } }),
  ]);
  if (members + pending >= workspace.maxUsers) {
    throw Conflict(
      `This workspace is at its limit of ${workspace.maxUsers} users, counting ${pending} invitation${pending === 1 ? '' : 's'} not yet accepted. ` +
        'Revoke an outstanding invitation or raise the limit.',
    );
  }
}

export async function inviteUser(ctx: Ctx, input: InviteInput) {
  const email = input.email.trim().toLowerCase();

  const role = await prisma.role.findFirst({ where: { tenantId: ctx.tenantId, id: input.roleId } });
  if (!role) throw NotFound('Role');
  // Same guard as every other path that binds someone to a role: you cannot
  // invite a person into a role you could not administer yourself.
  assertMayAdministerRole(ctx, role.rank, role.id);

  const alreadyHere = await prisma.workspaceMembership.findFirst({
    where: { tenantId: ctx.tenantId, platformUser: { normalizedEmail: email }, status: { in: ['ACTIVE', 'INVITED'] } },
    select: { id: true },
  });
  if (alreadyHere) throw Conflict('That person is already a member of this workspace.');

  await assertSeatAvailable(ctx);

  const token = randomBytes(32).toString('base64url');
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      tenantId: ctx.tenantId,
      email,
      pendingKey: email,
      fullName: input.fullName.trim(),
      roleId: role.id,
      employeeNumber: input.employeeNumber,
      jobTitle: input.jobTitle,
      departmentId: input.departmentId || null,
      candidateId: input.candidateId ?? null,
      joiningDate: input.joiningDate ?? null,
      employmentType: input.employmentType ?? null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000),
      invitedById: ctx.actor.id,
    },
  });

  await deliver(ctx, invitation.id, email, input.fullName, token);
  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'invitation',
    recordId: invitation.id,
    metadata: { action: 'user.invited', email, roleKey: role.key },
  });

  return publicView(invitation);
}

export async function resendInvitation(ctx: Ctx, invitationId: string) {
  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { tenantId: ctx.tenantId, id: invitationId },
  });
  if (!invitation) throw NotFound('Invitation');
  if (invitation.acceptedAt) throw Conflict('That invitation has already been accepted.');
  if (invitation.revokedAt) throw Conflict('That invitation was revoked. Send a new one.');

  // A fresh token, not the old one: a resend is also the remedy for an email
  // that went to the wrong inbox, and the previous link must stop working.
  const token = randomBytes(32).toString('base64url');
  const updated = await prisma.workspaceInvitation.update({
    where: { tenantId: ctx.tenantId, id: invitation.id },
    data: {
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000),
      sendCount: { increment: 1 },
      lastSentAt: new Date(),
    },
  });

  await deliver(ctx, updated.id, updated.email, updated.fullName, token);
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'invitation',
    recordId: updated.id,
    metadata: { action: 'user.invitation_resent', email: updated.email, sendCount: updated.sendCount },
  });
  return publicView(updated);
}

export async function revokeInvitation(ctx: Ctx, invitationId: string, reason?: string) {
  const invitation = await prisma.workspaceInvitation.findFirst({
    where: { tenantId: ctx.tenantId, id: invitationId },
  });
  if (!invitation) throw NotFound('Invitation');
  if (invitation.acceptedAt)
    throw Conflict('That invitation has already been accepted. Deactivate the account instead.');

  const updated = await prisma.workspaceInvitation.update({
    where: { tenantId: ctx.tenantId, id: invitation.id },
    // pendingKey to null frees the address for a future invitation and takes the
    // row out of the "one open invitation" constraint. The history stays.
    data: { revokedAt: new Date(), revokedReason: reason ?? null, pendingKey: null },
  });

  await audit(ctx, {
    event: 'RECORD_DELETED',
    objectType: 'invitation',
    recordId: updated.id,
    metadata: { action: 'user.invitation_revoked', email: updated.email, reason },
  });
  return publicView(updated);
}

export async function listInvitations(ctx: Ctx) {
  const rows = await prisma.workspaceInvitation.findMany({
    where: { tenantId: ctx.tenantId },
    include: { role: { select: { key: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((row) => ({ ...publicView(row), role: row.role }));
}

/**
 * Redeems a token and creates the account.
 *
 * Deliberately not tenant-scoped on entry: the caller is not signed in and the
 * workspace is not known until the token resolves. That is why the lookup is by
 * the token's hash — a value only the holder of the emailed link can produce.
 */
export async function acceptInvitation(token: string, input: { password: string; fullName?: string }) {
  // Two steps, deliberately. The token lookup is a bootstrap read with no tenant
  // context, and `Role` is RLS-forced — joining it here returns null, exactly as
  // joining `User` from the login query did. The tenant becomes known from the
  // row, and only then can the related records be read.
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: sha256(token) },
  });

  const invalid = () => Forbidden('This invitation link is invalid, expired, or has already been used.');
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) throw invalid();
  if (invitation.expiresAt < new Date()) throw invalid();

  const tenant = await prisma.tenant.findUnique({
    where: { id: invitation.tenantId },
    select: { id: true, slug: true, status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt || tenant.status !== 'ACTIVE') throw invalid();

  const role = await prisma.role.findFirst({
    where: { tenantId: invitation.tenantId, id: invitation.roleId },
    select: { id: true, key: true },
  });
  if (!role) throw invalid();

  const problems = checkPolicy(input.password, await passwordPolicy(invitation.tenantId));
  if (problems.length) {
    throw Invalid(problems.map((message) => ({ field: 'password', code: 'weak-password', message })));
  }

  const email = invitation.email;
  const fullName = (input.fullName ?? invitation.fullName).trim();
  const passwordHash = await hashPassword(input.password);

  const result = await withTx(invitation.tenantId, async (tx) => {
    // An existing identity keeps its own password: the person already has one
    // for another workspace, and an invitation to a second is not authority to
    // change the credential that guards the first.
    const existing = await tx.platformUser.findUnique({
      where: { normalizedEmail: email },
      select: { id: true, deletedAt: true },
    });
    if (existing?.deletedAt) throw invalid();

    const platformUser = existing
      ? await tx.platformUser.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
      : await tx.platformUser.create({
          data: {
            email,
            normalizedEmail: email,
            fullName,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            passwordChangedAt: new Date(),
          },
        });

    const salesUser = await tx.user.create({
      data: {
        tenantId: invitation.tenantId,
        email,
        fullName,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        roleId: invitation.roleId,
        jobTitle: invitation.jobTitle,
      },
    });

    const membership = await tx.workspaceMembership.create({
      data: {
        tenantId: invitation.tenantId,
        platformUserId: platformUser.id,
        salesUserId: salesUser.id,
        status: 'ACTIVE',
        roleSnapshot: role.key,
        joinedAt: new Date(),
      },
    });
    await tx.membershipRole.create({
      data: { tenantId: invitation.tenantId, membershipId: membership.id, roleId: invitation.roleId },
    });

    // An invitation that named an employee number is an HR hire, so the
    // employee record is created here rather than needing a second step.
    if (invitation.employeeNumber) {
      const employee = await tx.employeeProfile.create({
        data: {
          tenantId: invitation.tenantId,
          membershipId: membership.id,
          employeeNumber: invitation.employeeNumber,
          departmentId: invitation.departmentId,
          designation: invitation.jobTitle,
          employmentStatus: 'ACTIVE',
          // An ATS hire carries the agreed start date from the accepted offer;
          // acceptance can happen weeks before it, so "today" would be wrong and
          // would skew every service-length calculation from gratuity down.
          joinedOn: invitation.joiningDate ?? new Date(),
          employmentType: invitation.employmentType,
          hiredFromCandidateId: invitation.candidateId,
        },
      });

      // An ATS hire arrives with its onboarding already decided, so the checklist
      // is built here rather than waiting for somebody to remember. This is the
      // step that used to be a manual click: the employee record does not exist
      // until this moment, and there is no HR actor on an unauthenticated
      // acceptance, which is why `buildChecklist` takes only a tenant.
      if (invitation.candidateId) {
        const settings = await tx.organizationSetting.findUnique({
          where: { tenantId: invitation.tenantId },
          select: { hrPolicy: true },
        });
        const policy = resolvePolicy(settings?.hrPolicy);
        const department = invitation.departmentId
          ? await tx.department.findFirst({
              where: { tenantId: invitation.tenantId, id: invitation.departmentId },
              select: { name: true, code: true },
            })
          : null;
        // The RERA track is a regulatory exposure when it is missed, so it is
        // derived here rather than left for HR to notice.
        const agentTrack = isAgent(
          { reraBrn: null, departmentCode: department?.code ?? null, department },
          policy.agentDepartments,
        );
        await buildChecklist(
          { tenantId: invitation.tenantId },
          employee.id,
          'ONBOARDING',
          employee.joinedOn ?? new Date(),
          agentTrack,
          tx,
        );
      }
    }

    await tx.workspaceInvitation.update({
      where: { tenantId: invitation.tenantId, id: invitation.id },
      data: { acceptedAt: new Date(), pendingKey: null },
    });

    return { platformUserId: platformUser.id, reusedIdentity: Boolean(existing) };
  });

  await prisma.platformAuditEvent
    .create({
      data: {
        tenantId: invitation.tenantId,
        actorUserId: result.platformUserId,
        event: 'RECORD_CREATED',
        objectType: 'invitation',
        objectId: invitation.id,
        metadata: { action: 'user.invitation_accepted', email, reusedIdentity: result.reusedIdentity },
      },
    })
    .catch(() => {});

  return {
    workspaceSlug: tenant.slug,
    email,
    // The person already had a password for another workspace; the one they just
    // typed was not applied, and saying so beats a silent failure to sign in.
    credential: result.reusedIdentity ? ('EXISTING' as const) : ('CREATED' as const),
  };
}

/** What a token-holder sees before deciding to accept. No token, no ids. */
export async function previewInvitation(token: string) {
  // Same two-step as acceptInvitation: the joined records are RLS-forced and
  // the tenant is not known until the token resolves.
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) return null;

  const [tenant, role] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: invitation.tenantId },
      select: { displayName: true, status: true, deletedAt: true },
    }),
    prisma.role.findFirst({
      where: { tenantId: invitation.tenantId, id: invitation.roleId },
      select: { name: true },
    }),
  ]);
  if (!tenant || tenant.deletedAt || tenant.status !== 'ACTIVE' || !role) return null;

  return {
    email: invitation.email,
    fullName: invitation.fullName,
    workspaceName: tenant.displayName,
    roleName: role.name,
    expiresAt: invitation.expiresAt,
  };
}

async function deliver(ctx: Ctx, invitationId: string, email: string, fullName: string, token: string) {
  const workspace = await prisma.tenant.findFirst({
    where: { id: ctx.tenantId },
    select: { displayName: true },
  });
  const link = `${env.APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  await sendMail(
    email,
    `You have been invited to ${workspace?.displayName ?? 'a workspace'}`,
    `${fullName},\n\nYou have been invited to join ${workspace?.displayName ?? 'a workspace'}.\n\n` +
      `${link}\n\nThe link expires in ${INVITE_TTL_HOURS} hours and can be used once. ` +
      'You will choose your own password — nobody else will know it.',
  );
}

/** Never returns tokenHash. */
function publicView(invitation: {
  id: string;
  email: string;
  fullName: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  sendCount: number;
  lastSentAt: Date;
}) {
  const status = invitation.acceptedAt
    ? 'ACCEPTED'
    : invitation.revokedAt
      ? 'REVOKED'
      : invitation.expiresAt < new Date()
        ? 'EXPIRED'
        : 'PENDING';
  return {
    id: invitation.id,
    email: invitation.email,
    fullName: invitation.fullName,
    status,
    expiresAt: invitation.expiresAt,
    sendCount: invitation.sendCount,
    lastSentAt: invitation.lastSentAt,
  };
}
