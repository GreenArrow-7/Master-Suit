/**
 * Manifest loading and structural checks.
 *
 * JSON.parse only. No dynamic execution of any kind (SPEC-0001/CTRL-002).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isPlainFile, safeResolve } from './discover.mjs';

export const SUPPORTED_SCHEMA_VERSION = 1;

export const ARTIFACT_KEYS = [
  'spec',
  'clarifications',
  'plan',
  'threatModel',
  'testPlan',
  'tasks',
  'traceability',
  'convergence',
  'changeRecord',
];

export const APPROVAL_GATES = [
  'specification',
  'architecture',
  'security',
  'dataModel',
  'implementation',
  'convergence',
  'release',
  'emergency',
  'residualRisk',
];

export const ACTOR_TYPES = ['human', 'ai'];
export const DECISIONS = ['approved', 'rejected', 'pending'];

const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Load `sdd.json`. Returns `{ ok, manifest, error }`; a parse failure is a
 * finding for the caller, never a thrown crash.
 */
export function loadManifest(specDir) {
  const file = path.join(specDir, 'sdd.json');
  if (!isPlainFile(file)) {
    return { ok: false, error: 'sdd.json is missing or is not a regular file' };
  }
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: `sdd.json could not be read: ${err.code ?? 'unknown error'}` };
  }
  if (raw.length > MAX_MANIFEST_BYTES) {
    return { ok: false, error: 'sdd.json exceeds the supported size' };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'sdd.json is not valid JSON' };
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: 'sdd.json must contain a JSON object' };
  }
  return { ok: true, manifest };
}

/** Artefact paths declared by the manifest, resolved and containment-checked. */
export function resolveArtifacts(specDir, manifest) {
  const resolved = {};
  const unsafe = [];
  const missing = [];
  const artifacts = manifest.artifacts && typeof manifest.artifacts === 'object' ? manifest.artifacts : {};
  for (const key of ARTIFACT_KEYS) {
    const value = artifacts[key];
    if (value === undefined || value === null) {
      resolved[key] = null;
      continue;
    }
    const absolute = safeResolve(specDir, value);
    if (!absolute) {
      unsafe.push({ key, value: String(value).slice(0, 120) });
      resolved[key] = null;
      continue;
    }
    if (!isPlainFile(absolute)) {
      missing.push({ key, value });
      resolved[key] = null;
      continue;
    }
    resolved[key] = { relative: value, absolute };
  }
  return { resolved, unsafe, missing };
}

export function isApprovalRecordValid(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
  if (!APPROVAL_GATES.includes(record.gate)) return false;
  if (typeof record.role !== 'string' || record.role.trim() === '') return false;
  if (!ACTOR_TYPES.includes(record.actorType)) return false;
  if (!DECISIONS.includes(record.decision)) return false;
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return false;
  return true;
}

export function isReviewRecordValid(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.type !== 'string' || record.type.trim() === '') return false;
  if (typeof record.role !== 'string' || record.role.trim() === '') return false;
  if (!ACTOR_TYPES.includes(record.actorType)) return false;
  if (!DECISIONS.includes(record.decision)) return false;
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return false;
  return true;
}
