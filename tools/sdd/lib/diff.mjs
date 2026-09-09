/**
 * Diff-aware validation.
 *
 * Reports whether changed application files are associated with a declared
 * specification. Deliberately conservative: where association cannot be
 * established deterministically it reports UNKNOWN rather than inventing a
 * mapping (SPEC-0001/FR-007).
 *
 * git is invoked with a fixed argument array through execFileSync, never
 * through a shell, and the base reference is validated before use.
 */

import { execFileSync } from 'node:child_process';

const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

export function isSafeRef(ref) {
  return typeof ref === 'string' && REF_RE.test(ref) && !ref.startsWith('-');
}

/**
 * Tracked files changed against `base`. Returns null when git is unavailable
 * or the range cannot be resolved, so the caller reports UNKNOWN.
 */
export function changedFiles(repoRoot, base, head) {
  if (!isSafeRef(base)) return null;
  if (head !== undefined && head !== null && !isSafeRef(head)) return null;
  const args = ['diff', '--name-only', '--no-renames', base];
  if (head) args.push(head);
  let out;
  try {
    out = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function isApplicationPath(file, applicationPaths) {
  return applicationPaths.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

/**
 * Associate changed application files with specifications.
 *
 * Association is established only when a task artefact names the exact path.
 * Anything else is UNKNOWN, which is the honest answer: a heuristic mapping
 * would be worse than no mapping because it would look authoritative.
 */
export function associateChanges(files, specs, applicationPaths) {
  const appFiles = files.filter((f) => isApplicationPath(f, applicationPaths));
  const associated = [];
  const unassociated = [];
  for (const file of appFiles) {
    const owner = specs.find((spec) => spec.declaredPaths.has(file));
    if (owner) associated.push({ file, specId: owner.specId });
    else unassociated.push(file);
  }
  return { appFiles, associated, unassociated };
}
