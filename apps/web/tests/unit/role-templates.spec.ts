import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOGUE } from '@/lib/security/permissionCatalogue';
import {
  COMPANY_ADMIN_KEY,
  PRIMARY_TEMPLATE_KEYS,
  ROLE_TEMPLATES,
  SPECIALIST_ROLE_KEYS,
  templatesFor,
} from '@/lib/roles/templates';

/**
 * The six role templates, and the permissions they deliberately do not grant.
 *
 * Most of this file is about absence. A template is a default an administrator
 * then edits, so a grant that should not be there is not a cosmetic mistake —
 * it is the moment an HR officer can approve their own payroll run or an
 * operations coordinator can release a commission. Each omission asserted
 * below is named in the brief and in docs/product/SIX-ROLE-SIMPLIFICATION.md.
 */
const byKey = (key: string) => ROLE_TEMPLATES.find((template) => template.key === key)!;
const held = (key: string) => new Set(byKey(key).grants.map((g) => `${g.module}:${g.action}`));
const scopeOf = (key: string, token: string) =>
  byKey(key).grants.find((g) => `${g.module}:${g.action}` === token)?.scope;

describe('the six role templates', () => {
  it('names only permissions the catalogue defines', () => {
    const unknown: string[] = [];
    for (const template of ROLE_TEMPLATES)
      for (const grant of template.grants) {
        const actions = PERMISSION_CATALOGUE[grant.module];
        if (!actions || !actions.includes(grant.action))
          unknown.push(`${template.key} → ${grant.module}:${grant.action}`);
      }
    // A pair outside the catalogue can never be granted: provisioning looks the
    // permission up by (module, action) and silently skips what it cannot find,
    // so a typo here is a role quietly missing an ability.
    expect(unknown).toEqual([]);
  });

  it('does not re-create the Company Administrator role', () => {
    // createWorkspace.ts already creates it holding the whole catalogue.
    expect(ROLE_TEMPLATES.map((t) => t.key)).not.toContain(COMPANY_ADMIN_KEY);
    // It is still one of the six the UI lists.
    expect(PRIMARY_TEMPLATE_KEYS).toContain(COMPANY_ADMIN_KEY);
    expect(PRIMARY_TEMPLATE_KEYS).toHaveLength(6);
    expect(new Set(PRIMARY_TEMPLATE_KEYS).size).toBe(6);
  });

  it('keys nothing a provisioned workspace already uses', () => {
    // The Lead Eagle starter roles stay in service under Advanced; a template
    // sharing a key would collide on Role's (tenantId, key) unique index.
    for (const key of ROLE_TEMPLATES.map((t) => t.key)) expect(SPECIALIST_ROLE_KEYS).not.toContain(key);
  });

  it('gives every template a description and a module summary', () => {
    for (const template of ROLE_TEMPLATES) {
      expect(template.description.length, template.key).toBeGreaterThan(20);
      expect(template.summary.length, template.key).toBeGreaterThan(0);
      // The description is what replaces the key in the UI, so it must not be one.
      expect(template.description, template.key).not.toContain('_');
    }
  });

  describe('HR Administrator prepares payroll and cannot approve it', () => {
    const grants = held('hr_administrator');

    it('prepares', () => {
      expect(grants).toContain('payroll:CREATE');
      expect(grants).toContain('payroll:EDIT');
    });

    it('cannot approve payroll', () => {
      // services/hr/payroll.ts also refuses preparedById === actor.id whatever
      // the role holds. This keeps the role from being the one that decides.
      expect(grants).not.toContain('payroll:APPROVE');
    });

    it('cannot decide recruitment offers', () => {
      expect(grants).toContain('recruitment:CREATE');
      expect(grants).not.toContain('recruitment:APPROVE');
    });

    it('cannot read salary without an explicit grant', () => {
      expect(grants).not.toContain('hr_documents:VIEW_SENSITIVE_FIELDS');
    });

    it('holds no sales or money module', () => {
      for (const token of [...grants])
        expect(token, 'HR Administrator reaches into sales or money').not.toMatch(
          /^(leads|calls|opportunities|collections|commissions|payouts|agencyfee|dialer):/,
        );
    });
  });

  describe('Real Estate Operations sees money status and authorises none of it', () => {
    const grants = held('realestate_ops');

    it('sees collection and commission status', () => {
      expect(grants).toContain('collections:VIEW');
      expect(grants).toContain('commissions:VIEW');
    });

    it('approves neither, and holds no payout or agency fee at all', () => {
      expect(grants).not.toContain('collections:APPROVE');
      expect(grants).not.toContain('commissions:APPROVE');
      for (const token of [...grants]) expect(token).not.toMatch(/^(payouts|agencyfee|payroll):/);
    });

    it('works the inventory and the transaction', () => {
      for (const token of ['projects:EDIT', 'listings:EDIT', 'bookings:CREATE', 'visits:APPROVE'])
        expect(grants).toContain(token);
    });
  });

  describe('Sales Agent works only their own records', () => {
    const grants = held('sales_agent');

    it('is OWN scope throughout', () => {
      expect(byKey('sales_agent').defaultScope).toBe('OWN');
      for (const grant of byKey('sales_agent').grants)
        expect(grant.scope, `${grant.module}:${grant.action}`).toBe('OWN');
    });

    it('can place and work an AI-assisted call', () => {
      // These two are the whole live-call experience: the routes for live
      // coaching, audit scoring and follow-up drafting gate on calls:EDIT, and
      // the Live Call workspace on dialer:VIEW.
      expect(grants).toContain('calls:EDIT');
      expect(grants).toContain('dialer:VIEW');
    });

    it('cannot assign or reassign leads, bulk-update, import or export them', () => {
      for (const action of ['ASSIGN', 'REASSIGN', 'BULK_UPDATE', 'IMPORT', 'EXPORT'])
        expect(grants).not.toContain(`leads:${action}`);
    });

    it('holds no administrative or money module', () => {
      for (const token of [...grants])
        expect(token).not.toMatch(
          /^(users|roles|settings|integrations|automation|payroll|payouts|collections|commissions|agencyfee|auditlogs):/,
        );
    });
  });

  describe('Sales Manager reaches the team, not the company', () => {
    const grants = held('sales_manager');

    it('defaults to TEAM', () => {
      expect(byKey('sales_manager').defaultScope).toBe('TEAM');
    });

    it('assigns and reviews the team’s work at TEAM scope', () => {
      for (const token of ['leads:ASSIGN', 'leads:REASSIGN', 'calls:EDIT', 'visits:APPROVE', 'leave:APPROVE'])
        expect(scopeOf('sales_manager', token), token).toBe('TEAM');
    });

    it('reads the inventory across the company but cannot change it', () => {
      expect(scopeOf('sales_manager', 'projects:VIEW')).toBe('ORGANIZATION');
      expect(scopeOf('sales_manager', 'listings:VIEW')).toBe('ORGANIZATION');
      expect(grants).not.toContain('projects:EDIT');
      expect(grants).not.toContain('listings:EDIT');
    });

    it('cannot approve pool allocation, which does not narrow by scope', () => {
      expect(grants).toContain('allocation:VIEW');
      expect(grants).not.toContain('allocation:APPROVE');
    });

    it('holds no money module and cannot manage users, roles or settings', () => {
      for (const token of [...grants])
        expect(token).not.toMatch(
          /^(payroll|payouts|collections|commissions|agencyfee|users|roles|settings|integrations):/,
        );
    });
  });

  describe('Employee reaches nothing but their own', () => {
    const grants = held('employee_self');

    it('grants only own attendance, leave and tasks', () => {
      expect([...grants].sort()).toEqual(
        ['attendance:CREATE', 'attendance:VIEW', 'leave:CREATE', 'leave:VIEW', 'tasks:EDIT', 'tasks:VIEW'].sort(),
      );
    });

    it('is OWN scope throughout', () => {
      for (const grant of byKey('employee_self').grants) expect(grant.scope).toBe('OWN');
    });

    it('cannot read another employee, a lead, a call or any money record', () => {
      // The self-service screens need no permission; a grant here would widen
      // what an employee reads about colleagues.
      for (const token of [
        'employee:VIEW',
        'leads:VIEW',
        'calls:VIEW',
        'payroll:VIEW',
        'hr_documents:VIEW',
        'hr_reports:VIEW',
        'collections:VIEW',
        'commissions:VIEW',
      ])
        expect(grants, token).not.toContain(token);
    });
  });

  describe('templatesFor, by product module', () => {
    it('offers Employee to every workspace', () => {
      expect(templatesFor([]).map((t) => t.key)).toEqual(['employee_self']);
    });

    it('offers HR Administrator only with HRMS', () => {
      expect(templatesFor(['SALES']).map((t) => t.key)).not.toContain('hr_administrator');
      expect(templatesFor(['HRMS']).map((t) => t.key)).toContain('hr_administrator');
    });

    it('offers the sales pair to any lead module, and Real Estate Operations only where it belongs', () => {
      // Not named `module`: Next forbids assigning to that identifier.
      for (const productModule of ['SALES', 'REAL_ESTATE', 'LEAD_EAGLE']) {
        const keys = templatesFor([productModule]).map((t) => t.key);
        expect(keys, productModule).toContain('sales_manager');
        expect(keys, productModule).toContain('sales_agent');
      }
      expect(templatesFor(['LEAD_EAGLE']).map((t) => t.key)).not.toContain('realestate_ops');
      expect(templatesFor(['REAL_ESTATE']).map((t) => t.key)).toContain('realestate_ops');
    });

    it('offers all five non-administrator templates to a fully entitled workspace', () => {
      expect(templatesFor(['SALES', 'HRMS', 'REAL_ESTATE', 'LEAD_EAGLE'])).toHaveLength(ROLE_TEMPLATES.length);
    });
  });
});
