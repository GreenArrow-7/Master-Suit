import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The security screen refuses a platform identity instead of dying on it.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * The owner reported "the application is crashing" with a screenshot of
 * `/{slug}/profile/security` showing nothing but the background. It was neither
 * blank nor the forced-password loop #97 fixed: the page had thrown, and the
 * root error boundary's card is vertically centred, so a screenshot cropped to
 * the top of the window shows only empty background.
 *
 * A platform owner who has opened a break-glass grant enters a customer
 * workspace as a support actor, whose `ctx.actor.id` is a synthetic `platform:`
 * id with no `WorkspaceMembership` row. `assertPageAccess` refuses self-service
 * screens only to a *monitoring* session, so break-glass reached the page, and
 * `twoFactorStatus` and `myDeletionRequest` — both of which resolve the viewer's
 * own account through that membership — threw NotFound mid-render.
 *
 * The guard belongs on this page rather than in the gate: SELF_SERVICE also
 * marks the dashboard, the inbox and the People and Sales landings, which a
 * break-glass owner is meant to reach.
 */

const forbidden = vi.fn(() => {
  throw new Error('FORBIDDEN_INTERRUPT');
});
const resolveWorkspacePage = vi.fn();

vi.mock('next/navigation', () => ({ forbidden, redirect: vi.fn() }));
vi.mock('@/lib/workspace-page', () => ({ resolveWorkspacePage, SELF_SERVICE: Symbol('self-service') }));

/** Every loader the page reaches for. Each one would throw for a platform actor. */
const twoFactorStatus = vi.fn(async () => ({ enabled: false }));
const myDeletionRequest = vi.fn(async () => null);
const mustChangePassword = vi.fn(async () => false);
const myEmployee = vi.fn(async () => null);

vi.mock('@/services/identity/accounts', () => ({ mustChangePassword }));
vi.mock('@/services/identity/twoFactor', () => ({ twoFactorStatus }));
vi.mock('@/services/identity/accountDeletion', () => ({ myDeletionRequest, executionEnabled: () => false }));
vi.mock('@/services/hr/attendance', () => ({ activeConsent: vi.fn(async () => null) }));
vi.mock('@/services/hr/leave', () => ({ myEmployee }));
vi.mock('../../src/app/(workspace)/[workspaceSlug]/profile/security/SecurityScreen', () => ({
  default: () => null,
}));

const { default: SecurityPage } = await import('../../src/app/(workspace)/[workspaceSlug]/profile/security/page');

const open = (platformMode?: 'monitoring' | 'break-glass' | 'service') => {
  resolveWorkspacePage.mockResolvedValue({
    ctx: {
      tenantId: 't1',
      actor: {
        id: platformMode ? 'platform:pu1' : 'su1',
        ...(platformMode ? { platformMode } : {}),
      },
    },
  });
  return SecurityPage({ params: Promise.resolve({ workspaceSlug: 'acme' }) });
};

describe('the security screen and platform identities', () => {
  beforeEach(() => {
    forbidden.mockClear();
    twoFactorStatus.mockClear();
    myDeletionRequest.mockClear();
  });

  // 'break-glass' is the regression: it is the mode the reported crash ran in.
  it.each(['break-glass', 'service', 'monitoring'] as const)('refuses a %s session', async (mode) => {
    await expect(open(mode)).rejects.toThrow('FORBIDDEN_INTERRUPT');
    expect(forbidden).toHaveBeenCalled();
  });

  it('refuses before asking for a credential the viewer does not have', async () => {
    await expect(open('break-glass')).rejects.toThrow('FORBIDDEN_INTERRUPT');
    // These are the two that threw NotFound and produced the error page.
    expect(twoFactorStatus).not.toHaveBeenCalled();
    expect(myDeletionRequest).not.toHaveBeenCalled();
  });

  it('still renders for an ordinary member, who does hold one', async () => {
    await expect(open()).resolves.toBeDefined();
    expect(forbidden).not.toHaveBeenCalled();
    expect(twoFactorStatus).toHaveBeenCalled();
  });
});
