/**
 * Approval-gate evaluation.
 *
 * Implements SPEC-0001/CTRL-005. A gate that requires a human is satisfied
 * only by a record whose actorType is "human".
 *
 * Limitation, stated rather than implied: this proves a structured record
 * exists, not that a human made the decision. Anyone who can commit can write
 * the record. See docs/sdd/MACHINE_CONTRACT.md and SPEC-0001/TH-005.
 */

import { isApprovalRecordValid } from './manifest.mjs';

/** Gates that may never be satisfied by an AI actor. */
export const HUMAN_REQUIRED_GATES = new Set([
  'specification',
  'architecture',
  'security',
  'dataModel',
  'implementation',
  'convergence',
  'release',
  'emergency',
  'residualRisk',
]);

export function approvalsOf(manifest) {
  return Array.isArray(manifest.approvals) ? manifest.approvals : [];
}

export function reviewsOf(manifest) {
  return Array.isArray(manifest.reviews) ? manifest.reviews : [];
}

/** An approved record on `gate` made by a human. */
export function humanApprovalFor(manifest, gate) {
  return approvalsOf(manifest).find(
    (record) =>
      isApprovalRecordValid(record) &&
      record.gate === gate &&
      record.decision === 'approved' &&
      record.actorType === 'human',
  );
}

/** Records that attempt to satisfy a human-required gate as an AI actor. */
export function aiApprovalsOnHumanGates(manifest) {
  return approvalsOf(manifest).filter(
    (record) =>
      record &&
      typeof record === 'object' &&
      HUMAN_REQUIRED_GATES.has(record.gate) &&
      record.actorType === 'ai' &&
      record.decision === 'approved',
  );
}

export function malformedApprovals(manifest) {
  return approvalsOf(manifest)
    .map((record, index) => ({ record, index }))
    .filter((entry) => !isApprovalRecordValid(entry.record));
}

// ── Specification approval (SPEC-0002/TASK-015) ──────────────────────────────
//
// Gate 1 of docs/sdd/HUMAN_APPROVAL_GATES.md, enforcing the EVC-015 Option A
// policy: an R3 specification requires a human specification approval before
// implementation begins. This is a DIFFERENT gate from implementation
// readiness (gate 5, R4/R5 only), which stays with humanApprovalFor(…,
// 'implementation') and SDD-V020. The two are never conflated.

/** Roles permitted to approve a specification at R3. */
export const SPECIFICATION_APPROVER_ROLES = Object.freeze(['Product Owner', 'Solution Architect']);

const normaliseRole = (role) => String(role ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function isSpecificationApprover(role) {
  return SPECIFICATION_APPROVER_ROLES.some((allowed) => normaliseRole(allowed) === normaliseRole(role));
}

/**
 * Why no valid R3 specification approval is present, or null when one is.
 *
 * Returns a specific reason rather than a boolean so the finding can say what
 * is wrong. The reason never quotes artefact content.
 */
export function specificationApprovalProblem(manifest, specId) {
  const claimed = approvalsOf(manifest).filter((r) => r && typeof r === 'object' && r.gate === 'specification');
  if (claimed.length === 0) return 'no specification approval record exists';

  const wellFormed = claimed.filter((r) => isApprovalRecordValid(r));
  if (wellFormed.length === 0) return 'the specification approval record is malformed';

  const approved = wellFormed.filter((r) => r.decision === 'approved');
  if (approved.length === 0) return 'no specification approval record records an approved decision';

  const human = approved.filter((r) => r.actorType === 'human');
  if (human.length === 0) return 'the specification gate requires a human; an approval with actorType "ai" cannot satisfy it';

  // An approval whose evidence names a different specification does not
  // satisfy this one.
  const ownSpec = human.filter((r) => {
    const refs = String(r.evidenceRef ?? '').match(/SPEC-\d{4}/g) ?? [];
    return refs.every((ref) => ref === specId);
  });
  if (ownSpec.length === 0) return 'the specification approval names a different specification';

  const permitted = ownSpec.filter((r) => isSpecificationApprover(r.role));
  if (permitted.length === 0) {
    return `the approving role is not permitted; expected ${SPECIFICATION_APPROVER_ROLES.join(' or ')}`;
  }
  return null;
}

/** The valid specification approvals, for ordering checks. */
export function validSpecificationApprovals(manifest, specId) {
  if (specificationApprovalProblem(manifest, specId) !== null) return [];
  return approvalsOf(manifest).filter(
    (r) =>
      isApprovalRecordValid(r) &&
      r.gate === 'specification' &&
      r.decision === 'approved' &&
      r.actorType === 'human' &&
      isSpecificationApprover(r.role),
  );
}
