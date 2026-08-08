import { describe, expect, it } from 'vitest';
import { isActiveWorkspaceMembership, isPlatformOwner } from '@/lib/auth/platform-policy';

const active = {
  status: 'ACTIVE',
  tenant: { status: 'ACTIVE', deletedAt: null },
  salesUser: { status: 'ACTIVE', deletedAt: null },
};

describe('platform identity policy', () => {
  it('keeps platform ownership separate from customer roles', () => {
    expect(isPlatformOwner('OWNER')).toBe(true);
    expect(isPlatformOwner('USER')).toBe(false);
    expect(isPlatformOwner('company_admin')).toBe(false);
    expect(isPlatformOwner('SUPPORT')).toBe(false);
  });

  it('accepts only a fully active membership chain', () => {
    expect(isActiveWorkspaceMembership(active)).toBe(true);
    expect(isActiveWorkspaceMembership({ ...active, status: 'SUSPENDED' })).toBe(false);
    expect(isActiveWorkspaceMembership({ ...active, tenant: { ...active.tenant, status: 'SUSPENDED' } })).toBe(false);
    expect(isActiveWorkspaceMembership({ ...active, salesUser: null })).toBe(false);
    expect(isActiveWorkspaceMembership({ ...active, salesUser: { status: 'DEACTIVATED', deletedAt: null } })).toBe(
      false,
    );
  });

  it('rejects soft-deleted workspaces and sales actors', () => {
    expect(isActiveWorkspaceMembership({ ...active, tenant: { ...active.tenant, deletedAt: new Date() } })).toBe(false);
    expect(isActiveWorkspaceMembership({ ...active, salesUser: { ...active.salesUser, deletedAt: new Date() } })).toBe(
      false,
    );
  });
});
