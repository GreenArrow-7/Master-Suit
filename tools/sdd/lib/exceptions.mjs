/**
 * Validation exceptions.
 *
 * Implements the register in docs/sdd/VALIDATION_EXCEPTIONS.md as a machine
 * check. An approved, correctly scoped exception downgrades one rule on one
 * specification to INFO so the condition stays visible and auditable; it never
 * deletes the finding.
 *
 * Fails closed. Anything malformed, unapproved, mis-scoped or approved by the
 * wrong role suppresses nothing, and the original ERROR stands.
 *
 * There is deliberately no specification-specific branch anywhere in this
 * file. A hard-coded bypass would make the register decorative.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RULES } from '../rules/rules.mjs';
import { isPlainFile } from './discover.mjs';

/** Where the machine-readable register lives, relative to the repository root. */
export const EXCEPTIONS_FILE = path.join('docs', 'sdd', 'validation-exceptions.json');

const MAX_BYTES = 64 * 1024;
const ID_RE = /^EXC-\d{3}$/;
const SPEC_RE = /^SPEC-\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Roles that may approve an exception (VALIDATION_EXCEPTIONS.md rule 4:
 * Application Security for a security rule, Solution Architect otherwise).
 */
export const EXCEPTION_APPROVER_ROLES = Object.freeze(['Solution Architect', 'Application Security']);

/**
 * Statuses that make an exception operative. Expiry is enforced by status
 * rather than by comparing a date to the clock: the validator is deterministic
 * (NFR-003) and must not read the current time. VALIDATION_EXCEPTIONS.md
 * rule 8 puts the onus on a human to review an expiry and flip the status.
 */
export const ACTIVE_STATUS = 'APPROVED';

const normalise = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Why this record cannot suppress anything, or null when it is usable. */
export function exceptionProblem(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return 'not an object';
  if (!ID_RE.test(String(record.exceptionId))) return 'exceptionId must be EXC-NNN';
  if (!RULES[record.ruleId]) return 'ruleId is not a known validator rule';
  if (!SPEC_RE.test(String(record.specId))) return 'specId must name exactly one SPEC-NNNN; wildcards are not permitted';
  if (record.status !== ACTIVE_STATUS) return `status is not ${ACTIVE_STATUS}`;
  if (record.actorType !== 'human') return 'an exception cannot be approved by an ai actor';
  if (record.decision !== 'approved') return 'decision is not "approved"';
  if (!EXCEPTION_APPROVER_ROLES.some((r) => normalise(r).toLowerCase() === normalise(record.approvingRole).toLowerCase())) {
    return `approvingRole must be one of: ${EXCEPTION_APPROVER_ROLES.join(', ')}`;
  }
  if (!DATE_RE.test(String(record.effectiveDate))) return 'effectiveDate must be YYYY-MM-DD';
  const hasEnd = DATE_RE.test(String(record.expiry ?? '')) || normalise(record.expiryCondition).length > 0;
  if (!hasEnd) return 'an exception must carry an expiry date or an ending condition';
  if (normalise(record.reason).length === 0) return 'reason is required';
  if (normalise(record.compensatingControl).length === 0) return 'compensatingControl is required';
  return null;
}

/**
 * Load the register. Returns usable exceptions and the problems found, so a
 * broken record is reported rather than silently ignored.
 */
export function loadExceptions(repoRoot) {
  const file = path.join(repoRoot, EXCEPTIONS_FILE);
  if (!isPlainFile(file)) return { active: [], problems: [] };
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { active: [], problems: [{ exceptionId: null, problem: 'register could not be read' }] };
  }
  if (raw.length > MAX_BYTES) return { active: [], problems: [{ exceptionId: null, problem: 'register exceeds the supported size' }] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { active: [], problems: [{ exceptionId: null, problem: 'register is not valid JSON' }] };
  }
  const list = Array.isArray(parsed?.exceptions) ? parsed.exceptions : null;
  if (list === null) return { active: [], problems: [{ exceptionId: null, problem: 'register must contain an "exceptions" array' }] };

  const active = [];
  const problems = [];
  for (const record of list) {
    const problem = exceptionProblem(record);
    // A record deliberately marked EXPIRED or WITHDRAWN is not a defect; it is
    // simply not operative. Anything else that fails is reported.
    const status = record && typeof record === 'object' ? record.status : undefined;
    if (problem === null) active.push(record);
    else if (status === 'EXPIRED' || status === 'WITHDRAWN' || status === 'PROPOSED') continue;
    else problems.push({ exceptionId: record?.exceptionId ?? null, problem });
  }
  return { active, problems };
}

/** The exception covering this finding, or null. Exact rule and spec match only. */
export function exceptionFor(active, finding) {
  if (!finding || finding.severity !== 'ERROR') return null;
  return active.find((e) => e.ruleId === finding.ruleId && e.specId === finding.specId) ?? null;
}

/**
 * Apply the register to a finding set.
 *
 * A covered ERROR becomes INFO, keeps its rule id, and gains the exception id
 * in its message. It is never removed: the condition still exists and a reader
 * must be able to see that it does.
 */
export function applyExceptions(findings, active) {
  if (active.length === 0) return { findings, excepted: [] };
  const excepted = [];
  const out = findings.map((f) => {
    const hit = exceptionFor(active, f);
    if (!hit) return f;
    excepted.push({ exceptionId: hit.exceptionId, ruleId: f.ruleId, specId: f.specId });
    return {
      ...f,
      severity: 'INFO',
      message: `EXCEPTED under ${hit.exceptionId}: ${f.message}`,
    };
  });
  return { findings: out, excepted };
}
