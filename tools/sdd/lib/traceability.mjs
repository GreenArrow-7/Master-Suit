/**
 * Traceability and convergence helpers.
 *
 * These extract structure only. Whether a plan or threat model is *adequate*
 * is human review work and is deliberately out of scope (SPEC-0001/CL-002).
 */

import { allIds, declaredIds, sectionsById, toLines, REQUIREMENT_PREFIXES, TEST_PREFIXES } from './markdown.mjs';

export const CONVERGENCE_VERDICTS = ['PASS', 'PASS WITH ACCEPTED LIMITATIONS', 'FAIL'];
export const OPEN_FINDING_STATUS = 'OPEN';

/** Requirement identifiers declared in spec.md. */
export function requirementIds(specText) {
  return declaredIds(specText)
    .filter((d) => REQUIREMENT_PREFIXES.includes(d.prefix))
    .map((d) => d.id);
}

/** Acceptance-criteria identifiers declared in spec.md. */
export function acceptanceIds(specText) {
  return declaredIds(specText)
    .filter((d) => d.prefix === 'AC')
    .map((d) => d.id);
}

/** Every identifier mentioned in a document, as a Set. */
export function mentionedIdSet(text) {
  return new Set(allIds(text).map((entry) => entry.id));
}

/** Test identifiers mentioned in a document. */
export function testIdSet(text) {
  return new Set(allIds(text).filter((e) => TEST_PREFIXES.includes(e.prefix)).map((e) => e.id));
}

/**
 * For each security requirement, whether the test plan associates it with a
 * security test on the same line. Co-location on a line is the deterministic
 * signal available without a full document model.
 */
export function securityRequirementsWithoutSecurityTest(specText, testPlanText) {
  const secIds = requirementIds(specText).filter((id) => id.startsWith('SEC-'));
  if (secIds.length === 0) return [];
  const lines = toLines(testPlanText ?? '');
  const covered = new Set();
  for (const line of lines) {
    if (!/\bST-\d{3}\b/.test(line)) continue;
    for (const id of secIds) {
      if (line.includes(id)) covered.add(id);
    }
  }
  return secIds.filter((id) => !covered.has(id));
}

/** Tasks that cite neither a requirement nor an approved technical decision. */
export function tasksWithoutRationale(tasksText) {
  const sections = sectionsById(tasksText ?? '');
  const offenders = [];
  for (const [id, body] of sections) {
    if (!id.startsWith('TASK-')) continue;
    const hasRequirement = /\b(?:FR|NFR|SEC|DATA|OBS)-\d{3}\b/.test(body);
    const hasDecision = /\bAD-\d{3}\b/.test(body);
    if (!hasRequirement && !hasDecision) offenders.push(id);
  }
  return offenders;
}

/** Convergence findings whose status line says OPEN. */
export function openConvergenceFindings(convergenceText) {
  const sections = sectionsById(convergenceText ?? '');
  const open = [];
  for (const [id, body] of sections) {
    if (!id.startsWith('CONV-')) continue;
    if (/\*\*Status:\*\*\s*`?OPEN`?/i.test(body) || /^\s*Status:\s*`?OPEN`?/im.test(body)) open.push(id);
  }
  return open;
}

/**
 * Returned when a document declares more than one distinct verdict. It is
 * deliberately not a permitted verdict, so the enum check rejects it.
 */
export const AMBIGUOUS_VERDICT = 'AMBIGUOUS';

/** Strip the decoration a verdict may legitimately carry, then normalise. */
function normaliseVerdict(raw) {
  return String(raw)
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[.,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Every line that *declares* a verdict, as opposed to mentioning one.
 *
 * A declaration is either the metadata table row `| Recommended verdict | X |`
 * or a line beginning `Verdict:` / `Recommended verdict:`. Prose that happens
 * to contain the word is not a declaration, which is why the label must sit at
 * the start of the line or in the table's label cell.
 */
function declaredVerdicts(text) {
  const LABEL = /^(?:recommended verdict|verdict)$/i;
  const found = [];
  for (const line of toLines(text)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map((c) => c.trim());
      // cells[0] is empty for a leading pipe; label then value.
      if (cells.length >= 3 && LABEL.test(cells[1].replace(/[`*]/g, '').trim())) {
        const value = normaliseVerdict(cells[2]);
        if (value) found.push(value);
      }
      continue;
    }
    const m = /^(?:\*\*)?(recommended verdict|verdict)(?:\*\*)?\s*:\s*(.+)$/i.exec(trimmed);
    if (m) {
      const value = normaliseVerdict(m[2]);
      if (value) found.push(value);
    }
  }
  return found;
}

/**
 * The declared convergence verdict, or null when none is stated.
 *
 * Matching is **exact** against `CONVERGENCE_VERDICTS` after whitespace
 * normalisation. It was previously a prefix match, which silently read
 * `PASS WITH ACCEPTED LIMITATIONS` as `PASS` and erased the fact that
 * limitations had been accepted (SPEC-0002/TASK-014).
 *
 * An unsupported value is returned as written so the enum check reports it; a
 * document declaring two different verdicts returns `AMBIGUOUS_VERDICT`.
 * Neither is coerced into a supported value.
 */
export function convergenceVerdict(convergenceText) {
  if (!convergenceText) return null;
  const found = declaredVerdicts(convergenceText);
  if (found.length === 0) return null;
  const distinct = [...new Set(found)];
  if (distinct.length > 1) return AMBIGUOUS_VERDICT;
  const value = distinct[0];
  return CONVERGENCE_VERDICTS.includes(value) ? value : value;
}

/** Clarifications whose status is OPEN. */
export function openClarifications(clarificationsText) {
  if (!clarificationsText) return [];
  const sections = sectionsById(clarificationsText);
  const open = [];
  for (const [id, body] of sections) {
    if (!id.startsWith('CL-')) continue;
    if (/\*\*Status:\*\*\s*`?OPEN`?/i.test(body)) open.push(id);
  }
  return open;
}
