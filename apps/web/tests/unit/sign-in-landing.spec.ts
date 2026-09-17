import { describe, expect, it } from 'vitest';
import { loginPathFor, signInLanding } from '@/lib/security/redirect';

const DASHBOARD = '/manath-homes/dashboard';
const MINE = ['manath-homes', 'second-co'];

describe('loginPathFor', () => {
  it('carries the screen and its query to sign-in', () => {
    expect(loginPathFor('/manath-homes/sales/leads/abc', '?tab=notes')).toBe(
      '/login?next=%2Fmanath-homes%2Fsales%2Fleads%2Fabc%3Ftab%3Dnotes',
    );
  });

  it.each([
    ['no path', null],
    ['a protocol-relative path', '//evil.example/x'],
    ['a backslash path', '/\\evil.example'],
    ['the sign-in page itself', '/login'],
  ])('is plain /login for %s', (_name, path) => {
    expect(loginPathFor(path)).toBe('/login');
  });

  it('is plain /login when the return target is unreasonably long', () => {
    expect(loginPathFor(`/manath-homes/${'a'.repeat(3000)}`)).toBe('/login');
  });
});

describe('signInLanding', () => {
  it('returns to the requested screen in one of the account’s workspaces', () => {
    expect(signInLanding('/manath-homes/sales/leads/abc', DASHBOARD, MINE)).toBe('/manath-homes/sales/leads/abc');
    expect(signInLanding('/second-co/tasks?due=today', DASHBOARD, MINE)).toBe('/second-co/tasks?due=today');
  });

  it.each([
    ['nothing requested', null],
    ['another site, protocol-relative', '//evil.example/manath-homes'],
    ['another site, absolute', 'https://evil.example/manath-homes/dashboard'],
    ['a backslash trick', '/\\evil.example'],
    ['a workspace the account does not belong to', '/someone-else/sales/leads'],
    ['the sign-in page', '/login?next=/manath-homes'],
    ['a header-splitting attempt', '/manath-homes/x\r\nSet-Cookie: a=b'],
  ])('keeps the server’s destination for %s', (_name, next) => {
    expect(signInLanding(next, DASHBOARD, MINE)).toBe(DASHBOARD);
  });

  it.each([
    ['a forced password change', '/manath-homes/profile/security'],
    ['two-factor enrolment', '/enroll-2fa'],
    ['monitoring', '/monitoring'],
    ['the platform console', '/platform'],
  ])('never skips %s', (_name, destination) => {
    expect(signInLanding('/manath-homes/sales/leads/abc', destination, MINE)).toBe(destination);
  });
});
