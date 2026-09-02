import { describe, expect, it } from 'vitest';
import { productFromPathname, resolveActiveProduct } from '@/lib/nav/activeProduct';

describe('productFromPathname', () => {
  it('reads the module segment', () => {
    expect(productFromPathname('/abc/people/dashboard')).toBe('people');
    expect(productFromPathname('/abc/sales/leads')).toBe('sales');
  });

  it('matches a segment rather than a substring', () => {
    // A Sales screen that happens to be about people.
    expect(productFromPathname('/abc/sales/people')).toBe('sales');
    // A workspace whose slug contains the word.
    expect(productFromPathname('/people-first/sales/leads')).toBe('sales');
    expect(productFromPathname('/salesforce-co/people/leave')).toBe('people');
  });

  it('returns null on shared routes', () => {
    for (const path of ['/abc/dashboard', '/abc/tasks', '/abc/admin/users', '/abc/profile/security']) {
      expect(productFromPathname(path)).toBeNull();
    }
  });
});

describe('resolveActiveProduct', () => {
  const both = ['HRMS', 'SALES'];

  it('follows the URL even when the company owns both products', () => {
    // The regression: `modules.includes('SALES') ? 'sales' : 'people'` answered
    // 'sales' for every one of these.
    expect(resolveActiveProduct('/abc/people/dashboard', both)).toBe('people');
    expect(resolveActiveProduct('/abc/people/leave', both)).toBe('people');
    expect(resolveActiveProduct('/abc/people/employees', both)).toBe('people');
    expect(resolveActiveProduct('/abc/sales/leads', both)).toBe('sales');
  });

  it('ignores entitlement when the path is explicit', () => {
    expect(resolveActiveProduct('/abc/people/leave', ['SALES'])).toBe('people');
  });

  it('uses the last-used product on shared routes', () => {
    expect(resolveActiveProduct('/abc/dashboard', both, 'people')).toBe('people');
    expect(resolveActiveProduct('/abc/dashboard', both, 'sales')).toBe('sales');
  });

  it('ignores a remembered product the company no longer owns', () => {
    expect(resolveActiveProduct('/abc/dashboard', ['HRMS'], 'sales')).toBe('people');
    expect(resolveActiveProduct('/abc/dashboard', ['SALES'], 'people')).toBe('sales');
  });

  it('follows the single owned product on shared routes', () => {
    expect(resolveActiveProduct('/abc/dashboard', ['HRMS'])).toBe('people');
    expect(resolveActiveProduct('/abc/dashboard', ['SALES'])).toBe('sales');
  });

  it('never puts an HRMS-only workspace on the Sales rail', () => {
    expect(resolveActiveProduct('/abc/admin/users', ['HRMS'], 'sales')).toBe('people');
  });
});
