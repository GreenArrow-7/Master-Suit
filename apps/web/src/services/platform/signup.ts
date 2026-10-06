import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { Conflict, NotFound } from '@/lib/errors';
import { assertPasswordPolicy, DEFAULT_POLICY, hashPassword } from '@/lib/auth/password';
import { sendMail } from '@/lib/mailer';
import { getNumericSetting } from '@/lib/platform-settings';
import { createWorkspace } from './createWorkspace';

/**
 * Self-serve sign-up (Lead Eagle plan, gap 8): a company makes its own Lead
 * Eagle workspace on a trial. Closed until the platform owner sets the trial
 * length in the console — who may make a workspace is a business decision.
 *
 * Two steps, so an address nobody controls never owns anything: the request
 * keeps only the hash of a link mailed to the address, and the workspace is
 * made when the link is used, through the same `createWorkspace` the portal's
 * wizard uses. Using the link proves the address, which is why an address that
 * already has an account here may be attached to the new workspace.
 */
const LINK_HOURS = 24;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The app's own top-level routes: a workspace there would shadow them. */
const RESERVED = new Set([
  'api',
  'c',
  'f',
  'l',
  'li',
  'p',
  'privacy',
  'rsvp',
  'support',
  'testimonial',
  'no-platform-access',
  'accept-invite',
  'enroll-2fa',
  'forgot-password',
  'login',
  'monitoring',
  'platform',
  'reset-password',
  'service-login',
  'signup',
  'admin',
  'www',
  'app',
]);

/**
 * What sign-up offers, or null when it is closed: the trial's length (the
 * console setting; 0 closes it) and the plan a new workspace goes on — the
 * smallest active one that includes Lead Eagle. Open needs both, so nobody is
 * mailed a link that could only fail.
 */
export async function signupOffer() {
  const days = await getNumericSetting('signupTrialDays');
  if (!days) return null;
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { active: true, modules: { has: 'LEAD_EAGLE' } },
    orderBy: { seatLimit: 'asc' },
  });
  return plan ? { days, plan } : null;
}

async function assertSlugFree(slug: string) {
  const taken = RESERVED.has(slug) || !!(await prisma.tenant.findFirst({ where: { slug }, select: { id: true } }));
  if (taken) throw Conflict('That workspace address is taken. Try another.');
}

export async function requestSignup(input: {
  companyName: string;
  slug: string;
  fullName: string;
  email: string;
  password: string;
}) {
  if (!(await signupOffer())) throw NotFound('Sign-up');
  assertPasswordPolicy(input.password, DEFAULT_POLICY, 'password');
  await assertSlugFree(input.slug);

  const token = randomBytes(32).toString('base64url');
  const email = input.email.trim().toLowerCase();
  await prisma.signupRequest.create({
    data: {
      tokenHash: hash(token),
      email,
      companyName: input.companyName,
      slug: input.slug,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
      expiresAt: new Date(Date.now() + LINK_HOURS * 3_600_000),
    },
  });
  await sendMail(
    email,
    `Confirm your ${input.companyName} workspace`,
    `${input.fullName},\n\nConfirm this address to create ${input.companyName} on YOUHAN ONE:\n\n` +
      `${env.APP_URL.replace(/\/$/, '')}/signup/confirm?token=${encodeURIComponent(token)}\n\n` +
      `The link works once, for ${LINK_HOURS} hours. If you did not ask for this, ignore it: nothing has been created.`,
  );
}

export async function confirmSignup(token: string) {
  const offer = await signupOffer();
  const request = await prisma.signupRequest.findUnique({ where: { tokenHash: hash(token) } });
  if (!offer || !request || request.consumedAt || request.expiresAt < new Date()) throw NotFound('Sign-up link');
  await assertSlugFree(request.slug);
  const { days, plan } = offer;

  // Claimed first, conditionally: two clicks on one link make one workspace.
  const { count } = await prisma.signupRequest.updateMany({
    where: { id: request.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (!count) throw NotFound('Sign-up link');

  const now = new Date();
  try {
    const { created, reusedExistingIdentity } = await createWorkspace(
      {
        workspaceName: request.companyName,
        slug: request.slug,
        legalName: request.companyName,
        displayName: request.companyName,
        country: 'AE',
        timezone: 'Asia/Dubai',
        currency: 'AED',
        primaryAdminName: request.fullName,
        primaryAdminEmail: request.email,
        enabledModules: ['LEAD_EAGLE'],
        maxEmployees: plan.seatLimit,
        maxUsers: plan.seatLimit,
        maxStorageMb: plan.storageMb,
        trialStartDate: now,
        trialEndDate: new Date(now.getTime() + days * 86_400_000),
        status: 'ACTIVE',
      },
      plan,
      request.passwordHash,
      { platformUserId: null },
    );
    return { slug: created.slug, email: request.email, reusedExistingIdentity };
  } catch (error) {
    // The link is given back when the workspace could not be made.
    await prisma.signupRequest.update({ where: { id: request.id }, data: { consumedAt: null } });
    throw error;
  }
}
