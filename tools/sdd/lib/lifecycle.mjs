/**
 * Lifecycle states and legal transitions.
 *
 * Mirrors docs/sdd/SPEC_LIFECYCLE.md. This module does not define policy; it
 * encodes the policy that document states. A change here without a change
 * there is a defect.
 */

export const STATES = [
  'DRAFT',
  'CLARIFYING',
  'READY_FOR_PLAN',
  'PLANNED',
  'READY_FOR_APPROVAL',
  'APPROVED_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'VERIFYING',
  'CONVERGED',
  'READY_FOR_RELEASE',
  'RELEASED',
  'ON_HOLD',
  'CANCELLED',
  'SUPERSEDED',
];

export const RISKS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

/** States at or beyond which implementation is under way. */
export const IMPLEMENTATION_STATES = new Set([
  'APPROVED_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'VERIFYING',
  'CONVERGED',
  'READY_FOR_RELEASE',
  'RELEASED',
]);

const PAUSABLE = [
  'DRAFT',
  'CLARIFYING',
  'READY_FOR_PLAN',
  'PLANNED',
  'READY_FOR_APPROVAL',
  'APPROVED_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'VERIFYING',
];

export const TRANSITIONS = {
  DRAFT: ['CLARIFYING', 'READY_FOR_PLAN', 'ON_HOLD', 'CANCELLED'],
  CLARIFYING: ['READY_FOR_PLAN', 'DRAFT', 'ON_HOLD', 'CANCELLED'],
  READY_FOR_PLAN: ['PLANNED', 'CLARIFYING', 'ON_HOLD', 'CANCELLED'],
  PLANNED: ['READY_FOR_APPROVAL', 'READY_FOR_PLAN', 'CLARIFYING', 'ON_HOLD', 'CANCELLED'],
  READY_FOR_APPROVAL: ['APPROVED_FOR_IMPLEMENTATION', 'PLANNED', 'CLARIFYING', 'ON_HOLD', 'CANCELLED'],
  APPROVED_FOR_IMPLEMENTATION: ['IMPLEMENTING', 'ON_HOLD', 'CANCELLED'],
  IMPLEMENTING: ['VERIFYING', 'ON_HOLD', 'CANCELLED'],
  VERIFYING: ['CONVERGED', 'IMPLEMENTING', 'ON_HOLD'],
  CONVERGED: ['READY_FOR_RELEASE', 'IMPLEMENTING', 'ON_HOLD'],
  READY_FOR_RELEASE: ['RELEASED', 'CONVERGED', 'ON_HOLD'],
  RELEASED: ['SUPERSEDED'],
  ON_HOLD: [...PAUSABLE, 'CANCELLED'],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function isState(value) {
  return STATES.includes(value);
}

export function isRisk(value) {
  return RISKS.includes(value);
}

export function isLegalTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Artefact requirements, by risk level and current status.
 *
 * Derived from docs/sdd/RISK_TO_PROCESS_MATRIX.md. Requirements are
 * status-aware on purpose: a convergence report is not expected while a
 * specification is still a draft, so demanding one would be a false failure.
 */
const ORDER = new Map(STATES.map((s, i) => [s, i]));

function atOrAfter(status, gate) {
  const a = ORDER.get(status);
  const b = ORDER.get(gate);
  if (a === undefined || b === undefined) return false;
  if (status === 'ON_HOLD' || status === 'CANCELLED' || status === 'SUPERSEDED') return false;
  return a >= b;
}

export function requiredArtifacts(risk, status) {
  const required = new Set();
  if (risk === 'R0') return required;
  required.add('spec');

  const rank = Number(risk.slice(1));
  if (rank >= 2) {
    if (atOrAfter(status, 'PLANNED')) {
      required.add('plan');
      required.add('testPlan');
    }
    if (atOrAfter(status, 'READY_FOR_APPROVAL')) {
      required.add('tasks');
      required.add('traceability');
    }
    if (atOrAfter(status, 'CONVERGED')) {
      required.add('convergence');
    }
  }
  if (rank >= 3 && atOrAfter(status, 'PLANNED')) {
    required.add('clarifications');
  }
  if (rank >= 4 && atOrAfter(status, 'PLANNED')) {
    required.add('threatModel');
  }
  return required;
}

/** Risk levels at which implementation must be gated by a human approval. */
export function requiresImplementationApproval(risk) {
  return risk === 'R4' || risk === 'R5';
}
