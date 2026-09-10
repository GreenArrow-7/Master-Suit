/**
 * Specification discovery and safe path handling.
 *
 * Implements SPEC-0001/CTRL-001: traversal never leaves the specs root, and
 * symbolic links are not followed.
 */

import { readdirSync, readFileSync, statSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';

export const SPEC_DIR_RE = /^SPEC-([0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  specsRoot: 'specs',
  ignoredDirectories: ['templates', 'node_modules', '.git'],
  enforcementMode: 'ADVISORY',
  transitionPhase: 'B2',
  applicationPaths: [],
  documentationRoots: ['docs', 'specs', 'tools'],
};

export function loadConfig(repoRoot) {
  const file = path.join(repoRoot, 'sdd.config.json');
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const error = new Error(`sdd.config.json is not valid JSON: ${err.message}`);
    error.configFailure = true;
    throw error;
  }
  return { ...DEFAULT_CONFIG, ...parsed };
}

/**
 * Resolve `relative` inside `baseDir` and refuse anything that escapes it.
 * Returns null when the path is unsafe, so callers report rather than read.
 */
export function safeResolve(baseDir, relative) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.length > 200) return null;
  if (relative.includes('\0')) return null;
  if (path.isAbsolute(relative)) return null;
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/** True when the path exists as a regular file and is not a symbolic link. */
export function isPlainFile(absolute) {
  try {
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) return false;
    return info.isFile();
  } catch {
    return false;
  }
}

export function readTextIfSafe(baseDir, relative) {
  const absolute = safeResolve(baseDir, relative);
  if (!absolute || !isPlainFile(absolute)) return null;
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Every entry directly under the specs root. Non-conforming directory names
 * are returned too, so SDD-V001 can report them instead of ignoring them.
 */
export function discoverSpecDirs(repoRoot, config) {
  const specsRoot = safeResolve(repoRoot, config.specsRoot);
  if (!specsRoot) {
    const error = new Error(`specsRoot escapes the repository: ${config.specsRoot}`);
    error.configFailure = true;
    throw error;
  }
  if (!existsSync(specsRoot)) {
    const error = new Error(`specs root not found: ${config.specsRoot}`);
    error.configFailure = true;
    throw error;
  }
  const ignored = new Set(config.ignoredDirectories ?? []);
  const out = [];
  for (const entry of readdirSync(specsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (ignored.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    const dir = path.join(specsRoot, entry.name);
    try {
      if (lstatSync(dir).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const match = SPEC_DIR_RE.exec(entry.name);
    out.push({
      name: entry.name,
      dir,
      specId: match ? `SPEC-${match[1]}` : null,
      slug: match ? match[2] : null,
      conforming: Boolean(match),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Artefact file names the model knows about, for SDD-V010. */
export const KNOWN_ARTIFACT_FILES = {
  'spec.md': 'spec',
  'clarifications.md': 'clarifications',
  'plan.md': 'plan',
  'threat-model.md': 'threatModel',
  'test-plan.md': 'testPlan',
  'tasks.md': 'tasks',
  'traceability.md': 'traceability',
  'convergence.md': 'convergence',
  'change-record.md': 'changeRecord',
};

export function listArtifactFilesOnDisk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (KNOWN_ARTIFACT_FILES[entry.name]) out.push(entry.name);
  }
  return out.sort();
}

export function fileExists(absolute) {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}
