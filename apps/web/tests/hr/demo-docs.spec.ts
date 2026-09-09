/**
 * SPEC-0007/UT-011 — the demonstration runbook says what it must, and leaks
 * nothing.
 *
 * Two mechanical questions about a prose document: does it name the things an
 * operator needs, and has anybody pasted a credential into it. The second is
 * the one worth automating — a password reaches documentation by accident, in a
 * hurry, and nobody notices in review.
 *
 * Whether the runbook is *clear* is a human judgement and is left to
 * convergence. This case does not pretend to answer it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const doc = readFileSync(path.join(repoRoot, 'docs', 'DEMO.md'), 'utf8');

describe('SPEC-0007/UT-011 demonstration documentation', () => {
  it('names the three demonstration personas', () => {
    for (const persona of ['sales.rep@example.com', 'hr.manager@example.com', 'admin@example.com']) {
      expect(doc, `the runbook does not name ${persona}`).toContain(persona);
    }
    for (const role of ['sales_rep', 'hr_admin', 'org_admin']) {
      expect(doc, `the runbook does not name the ${role} role`).toContain(role);
    }
  });

  /**
   * SPEC-0007/UT-012 · FR-017 · CHG-004.
   *
   * The runbook is where somebody looks up "what do I send the client", so the
   * one client-facing address must be in it and must be unmistakable. Naming it
   * is not enough: the three internal personas are also in this document, and a
   * runbook that lists four addresses without saying which one leaves the
   * decision to whoever is in a hurry.
   */
  it('names the single client-facing login and marks the others internal', () => {
    expect(doc, 'the runbook does not name the client login').toContain('demo@youhan.in');
    expect(doc, 'the runbook does not mark the client login as the single one').toMatch(
      /single client-facing login|the only login a client|one client-facing login/i,
    );
    expect(doc, 'the runbook does not mark the other personas as internal').toMatch(/internal/i);
  });

  it('names the seed and reset commands and the database', () => {
    expect(doc).toContain('ALLOW_DEMO_SEED=yes');
    expect(doc).toMatch(/npm run db:seed -- --reset/);
    expect(doc).toContain('master_saas_demo');
  });

  it('records the exclusions a demonstrator will be asked about', () => {
    for (const topic of [/payroll/i, /biometric/i, /mock/i]) {
      expect(doc, `the runbook does not mention ${topic}`).toMatch(topic);
    }
  });

  /**
   * The one that matters. A credential in a committed runbook is a leak that
   * survives every rotation, and `SEC-007` forbids it.
   *
   * Looks for assignment shapes rather than trying to recognise a password:
   * `DEMO_PASSWORD=<something>` is the mistake somebody actually makes when
   * pasting a working command out of a terminal.
   */
  it('contains no credential', () => {
    const leaks = [
      /DEMO_PASSWORD\s*=\s*["']?[A-Za-z0-9._~+/-]{6,}/,
      /PLATFORM_OWNER_PASSWORD\s*=\s*["']?[A-Za-z0-9._~+/-]{6,}/,
      /password\s*[:=]\s*["'][^"'\s]{6,}["']/i,
      /postgresql:\/\/[^\s:]+:[^\s@]{8,}@/,
    ];
    for (const pattern of leaks) {
      const hit = doc.match(pattern);
      expect(hit?.[0] ?? null, `the runbook appears to carry a credential: ${hit?.[0]?.slice(0, 24)}…`).toBeNull();
    }
  });
});
