/**
 * Per-role dashboards (§5): the persona is resolved from server permissions,
 * and the resolution order is the contract — an HR administrator who can also
 * read audit logs is an HR admin, not an auditor.
 *
 * Pure resolver test: no database. loadDashboard's queries are exercised by the
 * page render in the e2e/browser pass; this pins the branching that decides
 * which dashboard a role even gets.
 */
import { describe, expect, it } from 'vitest';
import { resolvePersona } from '@/services/hr/dashboard';
import type { Scope } from '@/lib/security/rbac';
import { buildActor, buildCtx } from '../helpers/ctx';

/** A ctx holding exactly the given `module:ACTION → scope` grants. */
function ctxWith(grants: Record<string, Scope>) {
  return buildCtx(
    buildActor({ id: 'u1', tenantId: 't1', permissions: new Map(Object.entries(grants)) as never }),
  );
}

describe('resolvePersona', () => {
  it('employee:EDIT at ORGANIZATION is the HR administrator', () => {
    expect(resolvePersona(ctxWith({ 'employee:EDIT': 'ORGANIZATION' }))).toBe('hr_admin');
  });

  it('HR admin wins over a co-held audit grant', () => {
    expect(resolvePersona(ctxWith({ 'employee:EDIT': 'ORGANIZATION', 'auditlogs:VIEW': 'ORGANIZATION' }))).toBe('hr_admin');
  });

  it('payroll:VIEW without HR admin is the payroll dashboard', () => {
    expect(resolvePersona(ctxWith({ 'payroll:VIEW': 'ORGANIZATION' }))).toBe('payroll');
  });

  it('recruitment access is the recruiter dashboard', () => {
    expect(resolvePersona(ctxWith({ 'recruitment:VIEW': 'ORGANIZATION' }))).toBe('recruiter');
  });

  it('users:MANAGE_USERS is the IT administrator', () => {
    expect(resolvePersona(ctxWith({ 'users:MANAGE_USERS': 'ORGANIZATION' }))).toBe('it_admin');
  });

  it('team-scoped attendance approval is a manager', () => {
    expect(resolvePersona(ctxWith({ 'attendance:APPROVE': 'TEAM' }))).toBe('manager');
  });

  it('read-only reports access with no write authority is the auditor', () => {
    expect(resolvePersona(ctxWith({ 'reports:VIEW': 'ORGANIZATION' }))).toBe('auditor');
  });

  it('nothing but self-service is an ordinary employee', () => {
    expect(resolvePersona(ctxWith({ 'attendance:VIEW': 'OWN' }))).toBe('employee');
  });
});
