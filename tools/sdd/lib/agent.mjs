/**
 * Agent control plane: preflight, sessions, scope, drift, verification and
 * review records. Introduced by SPEC-0002.
 *
 * Same discipline as the rest of the validator: every record is untrusted
 * input, nothing is executed, paths are contained, and the tool reports rather
 * than repairs. There is deliberately no command that edits a governance
 * artefact (SPEC-0002/CL-004).
 */

import {
  readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, lstatSync, realpathSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { severityOf, RULES } from '../rules/rules.mjs';
import { safeResolve, isPlainFile } from './discover.mjs';
import { sectionsById, toLines } from './markdown.mjs';
import { isState, isRisk, requiresImplementationApproval, IMPLEMENTATION_STATES } from './lifecycle.mjs';
import { humanApprovalFor } from './approvals.mjs';

export const ROLES = [
  'PLANNER', 'IMPLEMENTER', 'TESTER', 'SECURITY_REVIEWER',
  'QA_REVIEWER', 'CONVERGENCE_REVIEWER', 'ARCHITECTURE_REVIEWER',
];

/** Lifecycle states in which each role may legitimately act. */
export const ROLE_STATES = {
  PLANNER: ['DRAFT', 'CLARIFYING', 'READY_FOR_PLAN', 'PLANNED'],
  IMPLEMENTER: ['APPROVED_FOR_IMPLEMENTATION', 'IMPLEMENTING'],
  TESTER: ['IMPLEMENTING', 'VERIFYING'],
  SECURITY_REVIEWER: ['IMPLEMENTING', 'VERIFYING', 'CONVERGED'],
  QA_REVIEWER: ['VERIFYING', 'CONVERGED', 'READY_FOR_RELEASE'],
  CONVERGENCE_REVIEWER: ['VERIFYING', 'CONVERGED'],
  ARCHITECTURE_REVIEWER: ['PLANNED', 'READY_FOR_APPROVAL', 'IMPLEMENTING', 'VERIFYING'],
};

/** Roles whose review discharges an independence requirement. */
export const REVIEWING_ROLES = ['SECURITY_REVIEWER', 'QA_REVIEWER', 'CONVERGENCE_REVIEWER', 'ARCHITECTURE_REVIEWER'];

export const SESSION_STATUSES = ['READY', 'IN_PROGRESS', 'COMPLETE', 'PARTIAL', 'BLOCKED', 'FAILED'];
export const RESULTS = ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED'];
export const REVIEW_DECISIONS = ['APPROVE', 'REQUEST_CHANGES', 'BLOCKED'];
export const REVIEW_TYPES = ['code-review', 'security-review', 'qa-review', 'architecture-review', 'convergence-review'];
export const ACTOR_TYPES = ['human', 'ai'];

export const ID_RE = { session: /^ASES-\d{4}$/, verification: /^VER-\d{4}$/, review: /^REV-\d{4}$/ };
const MAX_RECORD_BYTES = 128 * 1024;

export function finding(ruleId, { specId = null, artifact = null, message, line = null }) {
  if (!RULES[ruleId]) throw new Error(`unknown rule id: ${ruleId}`);
  return { ruleId, severity: severityOf(ruleId), specId, artifact, message, line };
}

// ── Records ─────────────────────────────────────────────────────────────────

export function loadRecord(file) {
  if (!isPlainFile(file)) return { ok: false, error: 'record is missing or is not a regular file' };
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, error: 'record could not be read' };
  }
  if (raw.length > MAX_RECORD_BYTES) return { ok: false, error: 'record exceeds the supported size' };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'record is not valid JSON' };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'record must contain a JSON object' };
  }
  return { ok: true, data };
}

export const executionDir = (specDir) => path.join(specDir, 'execution');

/** Every agent record under a specification, grouped by kind. */
export function listRecords(specDir) {
  const dir = executionDir(specDir);
  const out = { sessions: [], verifications: [], reviews: [] };
  if (!existsSync(dir)) return out;
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    const item = { id, file: name, ...loadRecord(path.join(dir, name)) };
    if (ID_RE.session.test(id)) out.sessions.push(item);
    else if (ID_RE.verification.test(id)) out.verifications.push(item);
    else if (ID_RE.review.test(id)) out.reviews.push(item);
  }
  return out;
}

// ── Task scope ──────────────────────────────────────────────────────────────

const BACKTICKED = /`([^`\n]{1,200})`/g;

/** How a backticked token inside a scope declaration is understood. */
export const SCOPE_TOKEN = { PATH: 'path', IDENTIFIER: 'identifier', MALFORMED: 'malformed' };

/**
 * Identifiers that legitimately appear inside a scope declaration as prose
 * references — "added by `CHG-001`" — and are not paths. They are ignored
 * rather than reported, because the prose check below catches the sentence
 * they sit in.
 */
const SCOPE_IDENTIFIER = /^(?:SPEC|TASK|CHG|CONV|ASES|VER|REV|EXC|EVC|FR|NFR|SEC|DATA|OBS|ACC|AC|CL|AD|TH|CTRL|UT|IT|E2E|ST|PT|REG)-\d{3,4}$|^SDD-V\d{3}$/;

/** `CL-002` permits exact paths and directory prefixes. A pattern is not a path. */
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Classify one backticked token from a scope declaration.
 *
 * The parser used to accept every backticked token as a path. That let
 * `CHG-001` become an allowed path in `SPEC-0001/TASK-012` and
 * `tablesearch-a11y` become one in `SPEC-0003/TASK-003`
 * (`SPEC-0003/CONV-008`, remediated under `CHG-007`).
 */
export function classifyScopeToken(token) {
  const t = String(token ?? '').trim();
  if (t.length === 0 || t.length > 200) return SCOPE_TOKEN.MALFORMED;
  if (SCOPE_IDENTIFIER.test(t)) return SCOPE_TOKEN.IDENTIFIER;
  if (GLOB_CHARS.test(t)) return SCOPE_TOKEN.MALFORMED;
  if (t.includes('/')) return SCOPE_TOKEN.PATH;
  // A bare filename is a path only if it carries an extension; `evidence`
  // and `tablesearch-a11y` do not.
  if (/^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,10}$/.test(t)) return SCOPE_TOKEN.PATH;
  return SCOPE_TOKEN.MALFORMED;
}

/**
 * Whatever remains of a scope declaration once the label, every backticked
 * span, punctuation and a small set of connectives are removed.
 *
 * A structured declaration leaves nothing. Anything left is prose, and a
 * declaration that mixes prose with paths cannot be trusted to be complete —
 * `SPEC-0003/TASK-003` prohibited "the Playwright and Vitest configuration
 * files" in prose, which carried no backticks and so never entered the
 * prohibited list at all.
 *
 * This deliberately does **not** try to understand the prose. It only asks
 * whether the declaration is structured.
 */
export function scopeProseResidue(regionText) {
  return String(regionText ?? '')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\*\*[^*\n]*?:?\*\*/g, ' ')
    .replace(/[\s,;.:()[\]\-–—*_/]+/g, ' ')
    .replace(/\b(?:and|or|none|the)\b/gi, ' ')
    .trim();
}

/**
 * Allowed and prohibited paths declared by a task section, plus the linkage
 * and test facts preflight needs.
 *
 * Exact paths and directory prefixes only, per SPEC-0002/CL-002. No globs and
 * no regular expressions: a pattern is too easy to write so broadly that it
 * authorises everything.
 *
 * Returns a `problems` array. A declaration that cannot be parsed
 * deterministically is reported, never silently reduced to whatever happened
 * to parse — a prohibited path lost to prose under-restricts the session, and
 * the scope check then passes the change it existed to catch.
 */
export function taskScope(tasksText, taskId) {
  const body = sectionsById(tasksText ?? '').get(taskId);
  if (body === undefined) return null;
  const problems = [];
  const collect = (label) => {
    const out = [];
    const region = [];
    let capturing = false;
    let seen = false;
    for (const line of toLines(body)) {
      if (new RegExp(`^\\*\\*${label}:?\\*\\*`).test(line)) { capturing = true; seen = true; }
      else if (capturing && /^\*\*[A-Z]/.test(line)) capturing = false;
      if (!capturing) continue;
      region.push(line);
      BACKTICKED.lastIndex = 0;
      let m;
      while ((m = BACKTICKED.exec(line)) !== null) {
        const token = m[1].trim().replace(/[.,;]$/, '');
        const kind = classifyScopeToken(token);
        if (kind === SCOPE_TOKEN.PATH) out.push(token);
        else if (kind === SCOPE_TOKEN.MALFORMED) {
          problems.push(`${label}: \`${token.slice(0, 60)}\` is not a path or directory prefix`);
        }
      }
    }
    if (!seen) return out;
    const residue = scopeProseResidue(region.join('\n'));
    if (residue.length > 0) {
      problems.push(`${label}: declaration contains prose (${residue.slice(0, 60)}), so it cannot be read as a complete list`);
    }
    return out;
  };
  return {
    allowed: collect('Allowed scope'),
    prohibited: collect('Prohibited paths'),
    problems,
    hasRequirement: /\b(?:FR|NFR|SEC|DATA|OBS)-\d{3}\b/.test(body) || /\bAD-\d{3}\b/.test(body),
    requiredTests: [...body.matchAll(/\b(?:UT|IT|E2E|ST|PT|REG)-\d{3}\b/g)].map((m) => m[0]),
    status: (/\*\*Status:\*\*\s*`?([A-Z_]+)`?/.exec(body) ?? [])[1] ?? null,
  };
}

/** Normalise a repository-relative path for comparison across platforms. */
export function normalisePath(p) {
  return String(p).split('\\').join('/').replace(/^\.\//, '');
}

/**
 * Why `declared` is not a safe repository-relative path, or null when it is.
 * Rejects absolute paths, drive letters, traversal segments, and symbolic
 * links that escape the repository.
 */
export function unsafeScopeReason(repoRoot, declared) {
  const value = String(declared ?? '');
  if (value.length === 0 || value.length > 200) return 'empty or over-long path';
  if (value.includes('\0')) return 'path contains a null byte';
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return 'absolute path';
  const norm = normalisePath(value);
  if (norm.split('/').includes('..')) return 'path contains a traversal segment';
  const resolved = safeResolve(repoRoot, norm.replace(/\/$/, ''));
  if (!resolved) return 'path resolves outside the repository';
  if (existsSync(resolved)) {
    try {
      if (lstatSync(resolved).isSymbolicLink()) {
        const real = realpathSync(resolved);
        const rel = path.relative(path.resolve(repoRoot), real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return 'symbolic link escapes the repository';
      }
    } catch {
      return 'path could not be inspected safely';
    }
  }
  return null;
}

/**
 * Evidence a task's own execution necessarily produces, writable inside the
 * session's **own** specification regardless of the task's declared scope.
 *
 * A closed enumeration, not a pattern. The line is: these artefacts **record
 * what happened**. Anything that **states what should happen** is absent and
 * stays absent — `spec.md`, `plan.md` and `clarifications.md` carry intent,
 * `test-plan.md` carries test design, `sdd.json` carries approvals and
 * `convergence.md` carries a verdict. None may be written on the strength of
 * merely having run.
 *
 * Added by SPEC-0002/CHG-008 TASK-021 after `SPEC-0003/CONV-010`: `ASES-0008`
 * could not record the evidence of its own execution without deviating from
 * its declared scope, and the control plane had the same gap — it writes a
 * session record into the specification directory that almost no task
 * declares, and never checked itself.
 */
export const META_ARTEFACT_FILES = Object.freeze(['traceability.md', 'change-record.md']);
export const META_ARTEFACT_DIRS = Object.freeze(['execution/']);

/**
 * Whether `file` is execution evidence belonging to `specDirName`.
 *
 * `specDirName` is the session's own specification directory, so evidence in
 * another specification is never covered.
 */
export function isMetaArtefact(file, specDirName) {
  const dirName = typeof specDirName === 'string'
    ? specDirName
    : (specDirName?.name ?? (specDirName?.dir ? path.basename(specDirName.dir) : null));
  if (!dirName) return false;
  const target = normalisePath(file);
  const base = `specs/${normalisePath(dirName).replace(/\/$/, '')}/`;
  if (!target.startsWith(base)) return false;
  const rest = target.slice(base.length);
  if (META_ARTEFACT_FILES.includes(rest)) return true;
  return META_ARTEFACT_DIRS.some((dir) => rest.startsWith(dir) && rest.length > dir.length);
}

/** Exact path or directory-prefix match, with a case-insensitive fallback. */
export function matchesScope(file, allowed) {
  const target = normalisePath(file);
  const lower = target.toLowerCase();
  for (const entry of allowed) {
    const rule = normalisePath(entry);
    const ruleLower = rule.toLowerCase();
    if (rule.endsWith('/')) {
      if (target.startsWith(rule) || lower.startsWith(ruleLower)) return true;
    } else {
      if (target === rule || lower === ruleLower) return true;
      if (target.startsWith(`${rule}/`) || lower.startsWith(`${ruleLower}/`)) return true;
    }
  }
  return false;
}

// ── git ─────────────────────────────────────────────────────────────────────

const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;
export const isSafeRef = (ref) => typeof ref === 'string' && REF_RE.test(ref) && !ref.startsWith('-');

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 20000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

export function gitChangedFiles(repoRoot, base) {
  if (!isSafeRef(base)) return null;
  const out = git(repoRoot, ['diff', '--name-only', '--no-renames', base]);
  if (out === null) return null;
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(normalisePath);
}

/**
 * Working-tree paths git currently reports as changed.
 *
 * A rename is reported as `old -> new`; both sides are returned, because a
 * rename changes two paths and scope must be judged on both.
 */
export function gitStatusPaths(repoRoot) {
  const out = git(repoRoot, ['status', '--porcelain']);
  if (out === null) return null;
  const paths = [];
  for (const line of out.split(/\r?\n/)) {
    const entry = line.slice(3).trim();
    if (!entry) continue;
    for (const part of entry.split(' -> ')) {
      const p = part.trim().replace(/^"(.*)"$/, '$1');
      if (p) paths.push(normalisePath(p));
    }
  }
  return [...new Set(paths)].sort();
}

export const gitHead = (repoRoot) => (git(repoRoot, ['rev-parse', 'HEAD']) ?? '').trim() || null;

// ── Attribution ─────────────────────────────────────────────────────────────

/**
 * Which changes belong to this session.
 *
 * Scope must be judged on what the session introduced, not on everything
 * currently dirty (SPEC-0002/CONV-007). Path-set subtraction alone is not
 * enough: a file that was already dirty and was then modified again by the
 * session would be subtracted away and silently authorised, which is the
 * permissive direction and the wrong one to guess in.
 *
 * So the session records a content digest for each initially-changed path,
 * and attribution compares digests. Where that evidence is missing the answer
 * is UNATTRIBUTED — review required — never "safe".
 */
export const ATTRIBUTION = { SESSION: 'SESSION', PRE_EXISTING: 'PRE_EXISTING', UNATTRIBUTED: 'UNATTRIBUTED' };

/**
 * Marker for a path that is a directory rather than a file. git reports an
 * untracked directory as a single collapsed entry, so a change to a file
 * inside it does not alter the entry. A directory therefore cannot be
 * digested, and must never be reported as unchanged on that basis.
 */
export const DIRECTORY_DIGEST = '<directory>';

/**
 * SHA-256 of a repository file. Returns null when the path does not exist,
 * and DIRECTORY_DIGEST when it is a directory.
 */
export function fileDigest(repoRoot, rel) {
  const abs = safeResolve(repoRoot, normalisePath(rel).replace(/\/$/, ''));
  if (!abs || !existsSync(abs)) return null;
  try {
    const stat = lstatSync(abs);
    if (stat.isDirectory()) return DIRECTORY_DIGEST;
    if (!stat.isFile()) return null;
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Digest every path that is already dirty, at session start. A null value
 * means the path did not exist then — a deletion already in flight, or a path
 * that cannot be read — which is itself evidence.
 */
export function captureInitialState(repoRoot, paths) {
  const out = {};
  for (const p of paths) out[normalisePath(p)] = fileDigest(repoRoot, p);
  return out;
}

/** Attribute one changed path to the session, to pre-existing work, or to neither. */
export function attribute(repoRoot, session, file, observedDigest = undefined) {
  const target = normalisePath(file);
  const initial = new Set((session.initialChangedPaths ?? []).map(normalisePath));
  if (!initial.has(target)) return ATTRIBUTION.SESSION;

  const digests = session.initialDigests;
  if (!digests || typeof digests !== 'object' || !Object.prototype.hasOwnProperty.call(digests, target)) {
    // The path was dirty before the session and no digest was recorded, so
    // there is nothing to compare against. Report rather than assume.
    return ATTRIBUTION.UNATTRIBUTED;
  }
  const before = digests[target];
  // `observedDigest` is the state to treat as "now". For a closed session that
  // is its recorded end state, so a later session's edit is never attributed
  // to it; for an open one it is omitted and the live tree is read.
  const now = observedDigest === undefined ? fileDigest(repoRoot, target) : observedDigest;
  // A directory has no content to compare. git collapses an untracked
  // directory into one entry, so an unchanged entry does not mean the tree
  // beneath it is unchanged. Report rather than declare it safe.
  if (before === DIRECTORY_DIGEST || now === DIRECTORY_DIGEST) return ATTRIBUTION.UNATTRIBUTED;
  // Covers modification, creation and deletion in one comparison: a file that
  // existed and no longer does moves from a digest to null, which differs.
  return before === now ? ATTRIBUTION.PRE_EXISTING : ATTRIBUTION.SESSION;
}

/** A session that has finished. Its result must not change afterwards. */
export const TERMINAL_SESSION_STATUSES = Object.freeze(['COMPLETE', 'PARTIAL', 'BLOCKED', 'FAILED']);

export function isTerminalSession(session) {
  return TERMINAL_SESSION_STATUSES.includes(session?.status);
}

/**
 * Whether a terminal session recorded enough to be re-evaluated against its
 * own end state rather than against whatever the tree looks like now.
 */
export function hasFinalEvidence(session) {
  const d = session?.finalDigests;
  return !!d && typeof d === 'object' && !Array.isArray(d);
}

/**
 * The tree as it stood when the session closed.
 *
 * Symmetric with `captureInitialState`. Without it a session records where it
 * began and nothing about where it ended, so on any later run "changed by this
 * session" and "changed after this session ended" are indistinguishable
 * (SPEC-0003/CONV-009).
 */
export function captureFinalState(repoRoot, paths) {
  const out = {};
  for (const p of paths ?? []) out[normalisePath(p)] = fileDigest(repoRoot, p);
  return out;
}

/**
 * Split every changed path into what the session did, what predates it, and
 * what cannot be told apart. `extra` carries paths from a git diff range so
 * work already committed during the session is included.
 *
 * **An in-flight session is judged against the live tree, exactly as before.**
 * A terminal session is judged against its own recorded end state, so a later
 * authorised session's edits are never attributed to it. A terminal session
 * with no end state recorded is reported as such and attributed to nothing —
 * a documented limited result, never an invented one.
 */
export function sessionDelta(repoRoot, session, extra = []) {
  const out = { session: [], preExisting: [], unattributed: [], statusAvailable: true, historical: false, evidenceMissing: false };

  if (isTerminalSession(session)) {
    out.historical = true;
    if (!hasFinalEvidence(session)) {
      // Refuse to guess. Blaming this session for whatever is dirty now is
      // exactly the defect being fixed.
      out.evidenceMissing = true;
      return out;
    }
    const final = session.finalDigests;
    const all = [...new Set([...Object.keys(final), ...extra.map(normalisePath)])].sort();
    for (const file of all) {
      const kind = attribute(repoRoot, session, file, Object.prototype.hasOwnProperty.call(final, file) ? final[file] : null);
      if (kind === ATTRIBUTION.SESSION) out.session.push(file);
      else if (kind === ATTRIBUTION.PRE_EXISTING) out.preExisting.push(file);
      else out.unattributed.push(file);
    }
    return out;
  }

  const status = gitStatusPaths(repoRoot);
  out.statusAvailable = status !== null;
  const all = [...new Set([...(status ?? []), ...extra.map(normalisePath)])].sort();
  for (const file of all) {
    const kind = attribute(repoRoot, session, file);
    if (kind === ATTRIBUTION.SESSION) out.session.push(file);
    else if (kind === ATTRIBUTION.PRE_EXISTING) out.preExisting.push(file);
    else out.unattributed.push(file);
  }
  return out;
}

/** A terminal session that cannot be re-evaluated says so, and blames nobody. */
export function historicalEvidenceFindings(spec, session, delta) {
  if (!delta.evidenceMissing) return [];
  return [finding('SDD-V063', {
    specId: spec.specId,
    artifact: `${session.sessionId}.json`,
    message: 'Session closed without recorded end-state evidence; its scope cannot be re-evaluated and no change is attributed to it',
  })];
}

/** Paths whose origin could not be established. A warning, never a pass. */
export function attributionFindings(spec, delta) {
  return delta.unattributed.slice(0, 25).map((file) => finding('SDD-V052', {
    specId: spec.specId,
    artifact: file,
    message: 'Changed before this session with no recorded digest; attribution is unproven, review rather than assume',
  }));
}

// ── Record shape validation ─────────────────────────────────────────────────

export function sessionProblems(record, id) {
  const p = [];
  const s = record;
  if (s.schemaVersion !== 1) p.push('unsupported schemaVersion');
  if (s.sessionId !== id) p.push('sessionId does not match the file name');
  if (!ID_RE.session.test(String(s.sessionId))) p.push('sessionId must be ASES-NNNN');
  if (!ROLES.includes(s.role)) p.push(`unknown role: ${String(s.role).slice(0, 30)}`);
  if (!Array.isArray(s.taskIds) || s.taskIds.length === 0) p.push('taskIds must be a non-empty array');
  if (!Array.isArray(s.allowedPaths)) p.push('allowedPaths must be an array');
  if (s.prohibitedPaths !== undefined && !Array.isArray(s.prohibitedPaths)) p.push('prohibitedPaths must be an array');
  if (!Array.isArray(s.requiredTests)) p.push('requiredTests must be an array');
  if (!SESSION_STATUSES.includes(s.status)) p.push(`unknown status: ${String(s.status).slice(0, 30)}`);
  if (s.actorType !== undefined && !ACTOR_TYPES.includes(s.actorType)) p.push('actorType must be human or ai');
  if (typeof s.startedFromCommit !== 'string' || !s.startedFromCommit) p.push('startedFromCommit is required');
  return p;
}

export function verificationProblems(record, id) {
  const p = [];
  const v = record;
  if (v.schemaVersion !== 1) p.push('unsupported schemaVersion');
  if (v.verificationId !== id) p.push('verificationId does not match the file name');
  if (!ID_RE.verification.test(String(v.verificationId))) p.push('verificationId must be VER-NNNN');
  if (!Array.isArray(v.taskIds)) p.push('taskIds must be an array');
  if (!Array.isArray(v.tests)) p.push('tests must be an array');
  if (!Array.isArray(v.commands)) p.push('commands must be an array');
  if (!RESULTS.includes(v.result)) p.push(`unknown result: ${String(v.result).slice(0, 30)}`);
  if (!ROLES.includes(v.actorRole)) p.push('actorRole must be a known agent role');
  if (!ACTOR_TYPES.includes(v.actorType)) p.push('actorType must be human or ai');
  return p;
}

export function reviewProblems(record, id) {
  const p = [];
  const r = record;
  if (r.schemaVersion !== 1) p.push('unsupported schemaVersion');
  if (r.reviewId !== id) p.push('reviewId does not match the file name');
  if (!ID_RE.review.test(String(r.reviewId))) p.push('reviewId must be REV-NNNN');
  if (!REVIEW_TYPES.includes(r.reviewType)) p.push(`unknown reviewType: ${String(r.reviewType).slice(0, 30)}`);
  if (!ROLES.includes(r.reviewerRole)) p.push('reviewerRole must be a known agent role');
  if (!ACTOR_TYPES.includes(r.actorType)) p.push('actorType must be human or ai');
  if (!REVIEW_DECISIONS.includes(r.decision)) p.push(`unknown decision: ${String(r.decision).slice(0, 30)}`);
  if (typeof r.sessionId !== 'string' || !r.sessionId) p.push('sessionId is required');
  if (r.satisfiesHumanGate !== undefined && typeof r.satisfiesHumanGate !== 'boolean') p.push('satisfiesHumanGate must be boolean');
  return p;
}

// ── Preflight ───────────────────────────────────────────────────────────────

/**
 * Decide whether an agent session may be authorised. Returns findings; an
 * empty ERROR set means authorised. The caller never overrides this.
 */
export function preflight(repoRoot, spec, { role, taskId }) {
  const out = [];
  const id = spec.specId;
  const at = (ruleId, message, artifact = 'sdd.json') => out.push(finding(ruleId, { specId: id, artifact, message }));

  if (!ROLES.includes(role)) {
    at('SDD-V042', `Unknown agent role: ${String(role).slice(0, 30)}`);
    return out;
  }
  if (!isRisk(spec.risk)) { at('SDD-V006', `Unknown risk level: ${String(spec.risk).slice(0, 20)}`); return out; }
  if (!isState(spec.status)) { at('SDD-V007', `Unknown lifecycle state: ${String(spec.status).slice(0, 30)}`); return out; }

  if (!ROLE_STATES[role].includes(spec.status)) {
    at('SDD-V043', `Role ${role} may not act while the specification is ${spec.status}`);
  }

  const tasksText = spec.texts?.tasks ?? null;
  const scope = taskId ? taskScope(tasksText, taskId) : null;

  if (taskId) {
    if (!tasksText || scope === null) {
      at('SDD-V044', `Task ${taskId} does not exist in this specification`, 'tasks.md');
      return out;
    }
    if (scope.status === 'WITHDRAWN' || scope.status === 'CANCELLED') {
      at('SDD-V044', `Task ${taskId} is ${scope.status} and may not be executed`, 'tasks.md');
    }
    // Before anything is read *from* the scope, establish that it could be
    // read at all. A declaration that mixes prose with paths may be missing a
    // boundary nobody can see (SPEC-0003/CONV-008, remediated under CHG-007).
    for (const problem of scope.problems ?? []) {
      at('SDD-V062', `Task ${taskId} has a malformed scope declaration — ${problem}`, 'tasks.md');
    }
    if (role === 'IMPLEMENTER') {
      if (scope.allowed.length === 0) {
        at('SDD-V045', `Task ${taskId} declares no allowed scope`, 'tasks.md');
      }
      for (const declared of scope.allowed.concat(scope.prohibited)) {
        const reason = unsafeScopeReason(repoRoot, declared);
        if (reason) at('SDD-V056', `Declared scope path is unsafe (${reason})`, 'tasks.md');
      }
      if (!scope.hasRequirement) {
        at('SDD-V026', `Task ${taskId} cites neither a requirement nor an approved technical decision`, 'tasks.md');
      }
      if (scope.requiredTests.length === 0) {
        at('SDD-V057', `Task ${taskId} identifies no required tests`, 'tasks.md');
      }
    }
  } else if (role === 'IMPLEMENTER') {
    at('SDD-V044', 'An implementer session must name a task');
  }

  if (requiresImplementationApproval(spec.risk) && IMPLEMENTATION_STATES.has(spec.status)) {
    if (!humanApprovalFor(spec.manifest, 'implementation')) {
      at('SDD-V020', `${spec.risk} requires a recorded human implementation approval before implementation`);
    }
  }
  return out;
}

// ── Session, scope, drift, verification, review ──────────────────────────────

export function buildSession(repoRoot, spec, { sessionId, role, taskIds, actorId = null }) {
  const scopes = taskIds.map((t) => taskScope(spec.texts?.tasks ?? null, t)).filter(Boolean);
  const initial = gitStatusPaths(repoRoot) ?? [];
  return {
    schemaVersion: 1,
    sessionId,
    specId: spec.specId,
    role,
    actorType: 'ai',
    actorId,
    taskIds,
    startedFromCommit: gitHead(repoRoot) ?? 'unknown',
    initialChangedPaths: initial,
    initialDigests: captureInitialState(repoRoot, initial),
    allowedPaths: [...new Set(scopes.flatMap((s) => s.allowed))],
    prohibitedPaths: [...new Set(scopes.flatMap((s) => s.prohibited))],
    requiredTests: [...new Set(scopes.flatMap((s) => s.requiredTests))],
    requiredApprovals: requiresImplementationApproval(spec.risk) ? ['implementation'] : [],
    status: 'READY',
    result: null,
  };
}

export function writeSession(specDir, session) {
  const dir = executionDir(specDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.sessionId}.json`);
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
  return file;
}

/** Compare a changed-file list against a session's declared scope. */
export function scopeFindings(repoRoot, spec, session, changed) {
  const out = [];
  const id = spec.specId;
  for (const declared of (session.allowedPaths ?? []).concat(session.prohibitedPaths ?? [])) {
    const reason = unsafeScopeReason(repoRoot, declared);
    if (reason) {
      out.push(finding('SDD-V056', { specId: id, artifact: String(declared).slice(0, 80), message: `Declared scope path is unsafe (${reason})` }));
    }
  }
  const allowed = (session.allowedPaths ?? []).filter((p) => !unsafeScopeReason(repoRoot, p));
  const prohibited = (session.prohibitedPaths ?? []).filter((p) => !unsafeScopeReason(repoRoot, p));
  for (const file of changed) {
    if (matchesScope(file, prohibited)) {
      out.push(finding('SDD-V058', { specId: id, artifact: file, message: 'Protected path modified without an approved scope expansion' }));
      continue;
    }
    if (matchesScope(file, allowed)) continue;
    // Execution evidence the task's own run produces. Checked after the
    // prohibited list, so a task may still forbid its own evidence paths and
    // have that honoured.
    if (isMetaArtefact(file, spec)) continue;
    out.push(finding('SDD-V046', { specId: id, artifact: file, message: 'Changed file is outside the approved task scope' }));
  }
  return out;
}

/**
 * Repository drift. Reports; never reverts, never overwrites
 * (SPEC-0002/CL-003). Legitimate concurrent work is expected, so drift is a
 * warning that asks for review rather than an error.
 */
export function driftFindings(repoRoot, spec, session) {
  const out = [];
  const head = gitHead(repoRoot);
  if (head && session.startedFromCommit && session.startedFromCommit !== 'unknown' && head !== session.startedFromCommit) {
    out.push(finding('SDD-V052', {
      specId: spec.specId, artifact: `${session.sessionId}.json`,
      message: `Repository moved from ${String(session.startedFromCommit).slice(0, 12)} to ${head.slice(0, 12)}; review before continuing`,
    }));
  }
  const now = gitStatusPaths(repoRoot);
  if (now === null) return out;
  const before = new Set((session.initialChangedPaths ?? []).map(normalisePath));
  const allowed = (session.allowedPaths ?? []).filter((p) => !unsafeScopeReason(repoRoot, p));
  const appeared = now.filter((f) => !before.has(f) && !matchesScope(f, allowed));
  for (const file of appeared.slice(0, 25)) {
    out.push(finding('SDD-V052', {
      specId: spec.specId, artifact: file,
      message: 'Changed outside this session and outside its scope; review rather than overwrite',
    }));
  }
  return out;
}

export function verificationFindings(spec, record, id) {
  const out = [];
  const problems = verificationProblems(record, id);
  for (const p of problems) out.push(finding('SDD-V049', { specId: spec.specId, artifact: `${id}.json`, message: p }));
  if (problems.length > 0) return out;
  const planned = new Set([...(spec.texts?.testPlan ?? '').matchAll(/\b(?:UT|IT|E2E|ST|PT|REG)-\d{3}\b/g)].map((m) => m[0]));
  for (const t of record.tests) {
    const testId = typeof t === 'string' ? t : t?.id;
    if (typeof testId !== 'string') {
      out.push(finding('SDD-V054', { specId: spec.specId, artifact: `${id}.json`, message: 'Test entry has no identifier' }));
      continue;
    }
    if (!planned.has(testId)) {
      out.push(finding('SDD-V054', { specId: spec.specId, artifact: `${id}.json`, message: `${testId} is not present in the test plan` }));
    }
  }
  return out;
}

export function reviewFindings(spec, record, id, sessions) {
  const out = [];
  const problems = reviewProblems(record, id);
  for (const p of problems) out.push(finding('SDD-V050', { specId: spec.specId, artifact: `${id}.json`, message: p }));
  if (problems.length > 0) return out;

  const session = sessions.find((s) => s.ok && s.data?.sessionId === record.sessionId);
  if (!session) {
    out.push(finding('SDD-V055', { specId: spec.specId, artifact: `${id}.json`, message: `Review references execution session ${String(record.sessionId).slice(0, 20)}, which does not exist` }));
    return out;
  }
  const sameActor = record.actorId !== undefined && session.data.actorId !== undefined
    && record.actorId !== null && record.actorId === session.data.actorId;
  const sameSession = record.reviewerSessionId !== undefined && record.reviewerSessionId === record.sessionId;
  if (sameActor || sameSession) {
    out.push(finding('SDD-V051', { specId: spec.specId, artifact: `${id}.json`, message: 'A session may not provide the independent review of its own work' }));
  }
  if (record.satisfiesHumanGate === true && record.actorType !== 'human') {
    out.push(finding('SDD-V053', { specId: spec.specId, artifact: `${id}.json`, message: 'A review with actorType "ai" cannot satisfy a gate that requires a human' }));
  }
  return out;
}

/** Session-level checks that do not need a diff. */
export function sessionFindings(spec, session, id) {
  const out = [];
  const problems = sessionProblems(session, id);
  for (const p of problems) out.push(finding('SDD-V047', { specId: spec.specId, artifact: `${id}.json`, message: p }));
  if (problems.length > 0) return out;
  if (session.specId !== spec.specId) {
    out.push(finding('SDD-V048', { specId: spec.specId, artifact: `${id}.json`, message: `Session claims ${String(session.specId).slice(0, 20)} but lives under ${spec.specId}` }));
  }
  const known = new Set([...(spec.texts?.tasks ?? '').matchAll(/\bTASK-\d{3}\b/g)].map((m) => m[0]));
  for (const t of session.taskIds ?? []) {
    if (!known.has(t)) {
      out.push(finding('SDD-V044', { specId: spec.specId, artifact: `${id}.json`, message: `Session references ${String(t).slice(0, 20)}, which does not exist` }));
    }
  }
  if (session.status === 'COMPLETE' && (session.requiredTests ?? []).length > 0) {
    const verified = new Set((session.verifiedTests ?? []).map(String));
    const missing = session.requiredTests.filter((t) => !verified.has(t));
    if (missing.length > 0) {
      out.push(finding('SDD-V057', { specId: spec.specId, artifact: `${id}.json`, message: `COMPLETE claimed while ${missing.length} required test(s) have no recorded verification` }));
    }
  }
  return out;
}
