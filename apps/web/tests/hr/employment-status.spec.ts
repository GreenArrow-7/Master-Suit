import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AT_WORK_STATUSES, EMPLOYMENT_STATUSES } from '@/services/hr/rules';

/**
 * `employmentStatus` is a plain String column, so nothing but agreement keeps
 * its spellings in step — and two of them had drifted. Offboarding writes
 * `NOTICE`, but the People dashboard counted `ON_NOTICE`, so its "On notice"
 * tile read 0 however many people were serving notice, and the employees PATCH
 * endpoint accepted `ON_NOTICE` and would have written a value the lifecycle
 * screens do not recognise.
 */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('employment status vocabulary', () => {
  it('has one spelling for serving notice', () => {
    expect(EMPLOYMENT_STATUSES).toContain('NOTICE');
    expect(EMPLOYMENT_STATUSES as readonly string[]).not.toContain('ON_NOTICE');
  });

  it('is not spelled ON_NOTICE anywhere in the module', () => {
    for (const path of [
      'src/services/hr/dashboard.ts',
      'src/services/hr/lifecycle.ts',
      'src/services/hr/attendance.ts',
      'src/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route.ts',
      // The reads moved out of that route into this module. A guard that does
      // not follow the code it guards stops guarding anything.
      'src/services/hr/reads.ts',
    ]) {
      expect(read(path), path).not.toContain('ON_NOTICE');
    }
  });

  it('counts the status offboarding actually writes', () => {
    // startOffboarding writes NOTICE; the dashboard tile must count the same.
    expect(read('src/services/hr/lifecycle.ts')).toContain("employmentStatus: 'NOTICE'");
    expect(read('src/services/hr/dashboard.ts')).toContain("employmentStatus: 'NOTICE'");
  });

  /**
   * Someone created as anything but ACTIVE lands on PROBATION — the normal path
   * for a hire starting next month. They were then refused at the door on day
   * one with "You have no active employment record."
   */
  it('lets probationers and people serving notice record attendance', () => {
    expect(AT_WORK_STATUSES).toContain('PROBATION');
    expect(AT_WORK_STATUSES).toContain('NOTICE');
    expect(AT_WORK_STATUSES).toContain('ONBOARDING');
    expect(AT_WORK_STATUSES).toContain('ACTIVE');
  });

  it('keeps people who have left, or are suspended, out', () => {
    expect(AT_WORK_STATUSES).not.toContain('EXITED');
    expect(AT_WORK_STATUSES).not.toContain('SUSPENDED');
  });
});
