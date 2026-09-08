/**
 * Stable validation rule catalogue.
 *
 * Every finding the validator emits carries one of these identifiers. Adding,
 * removing or re-severing a rule is a governed change: see
 * docs/sdd/ENFORCEMENT_STANDARD.md. Documentation of intent lives in
 * docs/sdd/VALIDATION_RULES.md; this file is the machine-side source of truth
 * for identifier and severity.
 */

export const SEVERITY = { ERROR: 'ERROR', WARNING: 'WARNING', INFO: 'INFO' };

export const RULES = {
  'SDD-V001': { severity: 'ERROR', title: 'Specification directory naming' },
  'SDD-V002': { severity: 'ERROR', title: 'SPEC id matches directory' },
  'SDD-V003': { severity: 'ERROR', title: 'No duplicate SPEC numbers' },
  'SDD-V004': { severity: 'ERROR', title: 'Manifest is valid JSON' },
  'SDD-V005': { severity: 'ERROR', title: 'Supported manifest schema version' },
  'SDD-V006': { severity: 'ERROR', title: 'Valid risk level' },
  'SDD-V007': { severity: 'ERROR', title: 'Valid lifecycle state' },
  'SDD-V008': { severity: 'ERROR', title: 'Manifest artefact references exist and stay in the directory' },
  'SDD-V009': { severity: 'ERROR', title: 'Required artefacts exist for the risk level and status' },
  'SDD-V010': { severity: 'WARNING', title: 'Artefacts on disk are declared in the manifest' },
  'SDD-V011': { severity: 'ERROR', title: 'Spec metadata id agrees with the manifest' },
  'SDD-V012': { severity: 'ERROR', title: 'Spec risk agrees with the manifest' },
  'SDD-V013': { severity: 'ERROR', title: 'Spec lifecycle status agrees with the manifest' },
  'SDD-V014': { severity: 'ERROR', title: 'Identifiers are declared once within a specification' },
  'SDD-V015': { severity: 'ERROR', title: 'No identifier is declared in two artefacts' },
  'SDD-V016': { severity: 'ERROR', title: 'Fully-qualified references resolve' },
  'SDD-V017': { severity: 'ERROR', title: 'Open clarifications block implementation states' },
  'SDD-V018': { severity: 'ERROR', title: 'Lifecycle history contains only legal transitions' },
  'SDD-V019': { severity: 'ERROR', title: 'Current status equals the final history state' },
  'SDD-V020': { severity: 'ERROR', title: 'Required implementation approval exists' },
  'SDD-V021': { severity: 'ERROR', title: 'Approval records are structurally complete' },
  'SDD-V022': { severity: 'ERROR', title: 'AI cannot satisfy a human-required gate' },
  'SDD-V023': { severity: 'ERROR', title: 'R4 and R5 require a threat model' },
  'SDD-V024': { severity: 'ERROR', title: 'Required test plan exists' },
  'SDD-V025': { severity: 'ERROR', title: 'Required tasks artefact exists' },
  'SDD-V026': { severity: 'ERROR', title: 'Every task cites a requirement or approved decision' },
  'SDD-V027': { severity: 'ERROR', title: 'Every requirement has test coverage' },
  'SDD-V028': { severity: 'ERROR', title: 'Security requirements have security verification' },
  'SDD-V029': { severity: 'ERROR', title: 'Acceptance criteria have verification mappings' },
  'SDD-V030': { severity: 'ERROR', title: 'Traceability references real identifiers' },
  'SDD-V031': { severity: 'ERROR', title: 'Convergence artefact exists when the lifecycle requires it' },
  'SDD-V032': { severity: 'ERROR', title: 'Open blocking convergence findings prevent CONVERGED' },
  'SDD-V033': { severity: 'ERROR', title: 'Convergence verdict is valid' },
  'SDD-V034': { severity: 'ERROR', title: 'RELEASED requires a release approval record' },
  'SDD-V035': { severity: 'ERROR', title: 'Referenced evidence-conflict ids exist' },
  'SDD-V036': { severity: 'ERROR', title: 'A specification must not mark an evidence conflict resolved' },
  'SDD-V037': { severity: 'ERROR', title: 'Change-record ids are unique within the owning specification' },
  'SDD-V038': { severity: 'WARNING', title: 'R1 follows the lightweight single-directory model' },
  'SDD-V039': { severity: 'ERROR', title: 'R0 creates no specification directory' },
  'SDD-V040': { severity: 'ERROR', title: 'Repository document references resolve' },
  'SDD-V041': { severity: 'WARNING', title: 'Changed application files are associated with a specification' },

  // ── Agent control plane, added by SPEC-0002 ───────────────────────────────
  // Appended after the highest existing identifier. No rule above is
  // renumbered, re-severed or removed (SPEC-0002/AD-006).
  'SDD-V042': { severity: 'ERROR', title: 'Agent role is known and permitted' },
  'SDD-V043': { severity: 'ERROR', title: 'Lifecycle permits the requested role action' },
  'SDD-V044': { severity: 'ERROR', title: 'Requested task exists' },
  'SDD-V045': { severity: 'ERROR', title: 'Task declares an allowed scope' },
  'SDD-V046': { severity: 'ERROR', title: 'Changed file is inside approved task scope' },
  'SDD-V047': { severity: 'ERROR', title: 'Agent session record is valid' },
  'SDD-V048': { severity: 'ERROR', title: 'Session belongs to the specification it claims' },
  'SDD-V049': { severity: 'ERROR', title: 'Required verification record exists' },
  'SDD-V050': { severity: 'ERROR', title: 'Review record is valid' },
  'SDD-V051': { severity: 'ERROR', title: 'Review is separate from the session it reviews' },
  'SDD-V052': { severity: 'WARNING', title: 'Repository drift requires review' },
  'SDD-V053': { severity: 'ERROR', title: 'AI review cannot satisfy a human-required gate' },
  'SDD-V054': { severity: 'ERROR', title: 'Verification references identifiers that exist' },
  'SDD-V055': { severity: 'ERROR', title: 'Review references an execution session that exists' },
  'SDD-V056': { severity: 'ERROR', title: 'Declared scope paths are safe and contained' },
  'SDD-V057': { severity: 'ERROR', title: 'COMPLETE is not claimed without the required tests' },
  'SDD-V058': { severity: 'ERROR', title: 'Protected path was not modified without approved scope expansion' },

  // R3 specification approval (SPEC-0002/TASK-015, enforcing EVC-015 Option A).
  // Deliberately separate from SDD-V020, which governs the R4/R5
  // implementation-readiness gate. The two are different gates.
  'SDD-V059': { severity: 'ERROR', title: 'R3 specification approval exists and is valid' },
  'SDD-V060': { severity: 'ERROR', title: 'Specification approval precedes implementation' },

  // Validation exception register (SPEC-0002/TASK-017).
  'SDD-V061': { severity: 'WARNING', title: 'Validation exception record is usable' },
  'SDD-V062': { severity: 'ERROR', title: 'Task scope declaration is machine-readable' },
  'SDD-V063': { severity: 'WARNING', title: 'A closed session carries the end-state evidence needed to re-evaluate it' },
  'SDD-V064': { severity: 'WARNING', title: 'Task scope declarations across the repository are machine-readable' },
};

/** Rule ids that are known to the catalogue. */
export const RULE_IDS = Object.freeze(Object.keys(RULES));

export function severityOf(ruleId) {
  const rule = RULES[ruleId];
  if (!rule) throw new Error(`unknown rule id: ${ruleId}`);
  return rule.severity;
}
