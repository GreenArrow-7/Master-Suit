/**
 * Agent control-plane tests. Node built-in runner, no dependency.
 *
 *   node --test tools/sdd/tests/agent.test.mjs
 *
 * Strategy matches the validator suite: one canonical VALID fixture lives on
 * disk under fixtures/agent/. Every INVALID case copies that known-good tree
 * into a temporary directory and introduces exactly one defect, so a failure
 * is attributable to that defect and nothing else.
 *
 * All fixture content is synthetic. It describes no real YOUHAN ONE
 * behaviour, and carries no credential.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLES, ROLE_STATES, taskScope, normalisePath, unsafeScopeReason, matchesScope, isSafeRef,
  sessionProblems, verificationProblems, reviewProblems,
  scopeFindings, driftFindings, verificationFindings, reviewFindings, sessionFindings,
  listRecords, loadRecord,
  gitStatusPaths, gitHead, captureInitialState, attribute, sessionDelta, attributionFindings,
  fileDigest, DIRECTORY_DIGEST,
  captureFinalState, isTerminalSession, hasFinalEvidence, historicalEvidenceFindings,
  isMetaArtefact,
} from '../lib/agent.mjs';
import { validate } from '../lib/validate.mjs';
import { loadConfig } from '../lib/discover.mjs';
import { RULES } from '../rules/rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..');
const CLI = path.join(TOOL_ROOT, 'cli.mjs');
const AGENT_ROOT = path.join(HERE, 'fixtures', 'agent');
const SPEC = 'SPEC-0001-agent-example';

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, timeout: 60000 });
    return { code: 0, stdout };
  } catch (err) {
    return { code: typeof err.status === 'number' ? err.status : 2, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function agentJson(root, sub, extra = []) {
  const out = run(['agent', sub, '--spec', 'SPEC-0001', '--root', root, '--format', 'json', ...extra]);
  return { ...out, json: out.stdout ? JSON.parse(out.stdout) : null };
}

const rules = (json) => new Set((json?.findings ?? []).map((f) => f.ruleId));
const ruleIds = (findings) => new Set(findings.map((f) => f.ruleId));

/** A temporary copy of the valid agent fixture tree. */
function scratch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-agent-'));
  cpSync(AGENT_ROOT, dir, { recursive: true });
  return dir;
}

const specDir = (root) => path.join(root, 'specs', SPEC);
const recordFile = (root, id) => path.join(specDir(root), 'execution', `${id}.json`);

function editRecord(root, id, mutate) {
  const file = recordFile(root, id);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  mutate(data);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function editFile(root, name, mutate) {
  const file = path.join(specDir(root), name);
  writeFileSync(file, mutate(readFileSync(file, 'utf8')));
}

/** The loaded specification object the library functions expect. */
function loadSpec(root) {
  const result = validate(root, loadConfig(root), { specFilter: 'SPEC-0001' });
  const spec = result.specs.find((s) => s.specId === 'SPEC-0001');
  assert.ok(spec, 'fixture specification must load');
  return spec;
}

const readSession = (root, id = 'ASES-0001') => JSON.parse(readFileSync(recordFile(root, id), 'utf8'));

// ── Valid cases ─────────────────────────────────────────────────────────────

test('UT-101 the agent fixture validates with no findings', () => {
  const { code, json } = (() => {
    const out = run(['validate', '--all', '--root', AGENT_ROOT, '--format', 'json']);
    return { code: out.code, json: JSON.parse(out.stdout) };
  })();
  assert.equal(json.errors, 0, `unexpected findings: ${JSON.stringify(json.findings, null, 2)}`);
  assert.equal(code, 0);
});

test('UT-102 preflight authorises an implementer on an approved task', () => {
  const { code, json } = agentJson(AGENT_ROOT, 'preflight', ['--role', 'IMPLEMENTER', '--task', 'TASK-001']);
  assert.equal(json.errors, 0, JSON.stringify(json.findings));
  assert.equal(code, 0);
});

test('UT-103 preflight authorises a reviewing role with no task', () => {
  const { code, json } = agentJson(AGENT_ROOT, 'preflight', ['--role', 'SECURITY_REVIEWER']);
  assert.equal(json.errors, 0, JSON.stringify(json.findings));
  assert.equal(code, 0);
});

test('UT-104 a well-formed session record produces no findings', () => {
  const spec = loadSpec(AGENT_ROOT);
  const session = readSession(AGENT_ROOT);
  assert.deepEqual(sessionProblems(session, 'ASES-0001'), []);
  assert.deepEqual(sessionFindings(spec, session, 'ASES-0001'), []);
});

test('UT-105 a well-formed verification record produces no findings', () => {
  const spec = loadSpec(AGENT_ROOT);
  const record = loadRecord(recordFile(AGENT_ROOT, 'VER-0001'));
  assert.ok(record.ok);
  assert.deepEqual(verificationProblems(record.data, 'VER-0001'), []);
  assert.deepEqual(verificationFindings(spec, record.data, 'VER-0001'), []);
});

test('UT-106 an independent review by a different actor produces no findings', () => {
  const spec = loadSpec(AGENT_ROOT);
  const records = listRecords(spec.dir);
  const review = records.reviews.find((r) => r.id === 'REV-0001');
  assert.ok(review?.ok);
  assert.deepEqual(reviewProblems(review.data, 'REV-0001'), []);
  assert.deepEqual(reviewFindings(spec, review.data, 'REV-0001', records.sessions), []);
});

test('UT-107 changed files inside the declared scope raise nothing', () => {
  const spec = loadSpec(AGENT_ROOT);
  const session = readSession(AGENT_ROOT);
  const changed = ['src/export/service.ts', 'src/shared/scope/resolver.ts'];
  assert.deepEqual(scopeFindings(AGENT_ROOT, spec, session, changed), []);
});

// ── Invalid cases, one defect each ──────────────────────────────────────────

test('UT-111 SDD-V042 an unknown role is refused', () => {
  const { code, json } = agentJson(AGENT_ROOT, 'preflight', ['--role', 'ARCHITECT_OF_DESTINY']);
  assert.ok(rules(json).has('SDD-V042'));
  assert.equal(code, 1);
});

test('UT-112 SDD-V043 a role may not act outside its lifecycle states', () => {
  const { code, json } = agentJson(AGENT_ROOT, 'preflight', ['--role', 'PLANNER']);
  assert.ok(rules(json).has('SDD-V043'));
  assert.equal(code, 1);
});

test('UT-113 SDD-V044 a task that does not exist is refused', () => {
  const { code, json } = agentJson(AGENT_ROOT, 'preflight', ['--role', 'IMPLEMENTER', '--task', 'TASK-987']);
  assert.ok(rules(json).has('SDD-V044'));
  assert.equal(code, 1);
});

test('UT-114 SDD-V045 a task declaring no scope cannot be implemented', () => {
  const dir = scratch();
  try {
    editFile(dir, 'tasks.md', (s) => s.replace(/\*\*Allowed scope:\*\*.*\n/, ''));
    const { code, json } = agentJson(dir, 'preflight', ['--role', 'IMPLEMENTER', '--task', 'TASK-001']);
    assert.ok(rules(json).has('SDD-V045'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-115 SDD-V046 a changed file outside the approved scope is reported', () => {
  const spec = loadSpec(AGENT_ROOT);
  const session = readSession(AGENT_ROOT);
  const findings = scopeFindings(AGENT_ROOT, spec, session, ['src/billing/invoice.ts']);
  assert.ok(ruleIds(findings).has('SDD-V046'));
});

test('UT-116 SDD-V047 a malformed session record is rejected', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'ASES-0001', (s) => { s.schemaVersion = 99; });
    const { code, json } = agentJson(dir, 'verify-session');
    assert.ok(rules(json).has('SDD-V047'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-117 SDD-V048 a session claiming another specification is rejected', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'ASES-0001', (s) => { s.specId = 'SPEC-0099'; });
    const { code, json } = agentJson(dir, 'verify-session');
    assert.ok(rules(json).has('SDD-V048'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-118 SDD-V049 a malformed verification record is rejected', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'VER-0001', (s) => { s.result = 'PROBABLY_FINE'; });
    const { code, json } = agentJson(dir, 'verify-session');
    assert.ok(rules(json).has('SDD-V049'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-119 SDD-V050 a malformed review record is rejected', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'REV-0001', (s) => { s.decision = 'LOOKS_GOOD_TO_ME'; });
    const { code, json } = agentJson(dir, 'review-check');
    assert.ok(rules(json).has('SDD-V050'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-120 SDD-V051 a session may not review its own work', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'REV-0001', (s) => { s.actorId = 'agent-alpha'; });
    const { code, json } = agentJson(dir, 'review-check');
    assert.ok(rules(json).has('SDD-V051'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-121 SDD-V051 a review whose reviewing session is the reviewed session is rejected', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'REV-0001', (s) => { s.reviewerSessionId = 'ASES-0001'; s.actorId = 'agent-gamma'; });
    const { json } = agentJson(dir, 'review-check');
    assert.ok(rules(json).has('SDD-V051'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-122 SDD-V052 repository drift is a warning, not silence and not a revert', () => {
  // Run against the real repository, read-only, with a commit the session
  // could not have started from.
  const spec = loadSpec(AGENT_ROOT);
  const session = { ...readSession(AGENT_ROOT), startedFromCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const findings = driftFindings(REPO_ROOT, spec, session);
  assert.ok(ruleIds(findings).has('SDD-V052'));
  for (const f of findings) assert.equal(f.severity, 'WARNING');
});

test('UT-123 SDD-V053 an AI review cannot satisfy a human-required gate', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'REV-0001', (s) => { s.satisfiesHumanGate = true; });
    const { code, json } = agentJson(dir, 'review-check');
    assert.ok(rules(json).has('SDD-V053'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-124 SDD-V054 a verification cannot cite a test the plan does not contain', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'VER-0001', (s) => { s.tests.push({ id: 'UT-777', outcome: 'PASS' }); });
    const { code, json } = agentJson(dir, 'verify-session');
    assert.ok(rules(json).has('SDD-V054'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-125 SDD-V055 a review cannot cite a session that does not exist', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'REV-0001', (s) => { s.sessionId = 'ASES-0404'; });
    const { code, json } = agentJson(dir, 'review-check');
    assert.ok(rules(json).has('SDD-V055'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-126 SDD-V056 an escaping scope path is refused', () => {
  const spec = loadSpec(AGENT_ROOT);
  const session = { ...readSession(AGENT_ROOT), allowedPaths: ['../../etc/'] };
  const findings = scopeFindings(AGENT_ROOT, spec, session, []);
  assert.ok(ruleIds(findings).has('SDD-V056'));
});

test('UT-127 SDD-V057 COMPLETE is refused while a required test is unverified', () => {
  const dir = scratch();
  try {
    editRecord(dir, 'ASES-0001', (s) => { s.verifiedTests = ['UT-001']; });
    const { code, json } = agentJson(dir, 'verify-session');
    assert.ok(rules(json).has('SDD-V057'));
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-128 SDD-V058 a prohibited path takes precedence over an allowed prefix', () => {
  const spec = loadSpec(AGENT_ROOT);
  const session = readSession(AGENT_ROOT);
  const findings = scopeFindings(AGENT_ROOT, spec, session, ['src/export/legacy/old.ts']);
  const ids = ruleIds(findings);
  assert.ok(ids.has('SDD-V058'));
  assert.ok(!ids.has('SDD-V046'), 'a prohibited path is reported once, as prohibited');
});

// ── Refusal to write, and refusal to widen ──────────────────────────────────

test('UT-131 create-session refuses to write a record when preflight fails', () => {
  const dir = scratch();
  try {
    const before = listRecords(specDir(dir)).sessions.length;
    const { code, json } = agentJson(dir, 'create-session', ['--role', 'IMPLEMENTER', '--task', 'TASK-987']);
    assert.equal(code, 1);
    assert.ok(json.notes.some((n) => n.includes('Session NOT created')));
    assert.equal(listRecords(specDir(dir)).sessions.length, before, 'no session record may be written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-132 a blocking structural error blocks every agent action', () => {
  const dir = scratch();
  try {
    editFile(dir, 'spec.md', (s) => s.replace('- `SEC-001`', '- `SEC-404`'));
    for (const sub of ['preflight', 'verify-session', 'review-check']) {
      const extra = sub === 'preflight' ? ['--role', 'SECURITY_REVIEWER'] : [];
      const { code, json } = agentJson(dir, sub, extra);
      assert.equal(code, 1, `${sub} must not authorise anything while validation fails`);
      assert.ok(json.notes.some((n) => n.includes('no agent action is authorised')), sub);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Unit-level behaviour ────────────────────────────────────────────────────

test('UT-141 task scope reads exact paths and directory prefixes only', () => {
  const text = readFileSync(path.join(AGENT_ROOT, 'specs', SPEC, 'tasks.md'), 'utf8');
  const scope = taskScope(text, 'TASK-001');
  assert.deepEqual(scope.allowed, ['src/export/', 'src/shared/scope/']);
  assert.deepEqual(scope.prohibited, ['src/export/legacy/']);
  assert.deepEqual(scope.requiredTests, ['UT-001', 'ST-001']);
  assert.equal(scope.hasRequirement, true);
  assert.equal(scope.status, 'IN_PROGRESS');
  assert.equal(taskScope(text, 'TASK-987'), null);
});

test('UT-142 unsafe scope paths are named, not silently dropped', () => {
  const cases = ['', '/etc/passwd', 'C:/Windows', '../outside', 'a/../../b', 'x'.repeat(201)];
  for (const c of cases) {
    assert.ok(unsafeScopeReason(REPO_ROOT, c), `expected a reason for ${JSON.stringify(c.slice(0, 20))}`);
  }
  assert.equal(unsafeScopeReason(REPO_ROOT, 'tools/sdd/'), null);
  assert.equal(unsafeScopeReason(REPO_ROOT, 'tools/sdd/cli.mjs'), null);
});

test('UT-143 scope matching is prefix-based and does not match a sibling by name', () => {
  assert.equal(matchesScope('src/export/a.ts', ['src/export/']), true);
  assert.equal(matchesScope('src/export', ['src/export']), true);
  assert.equal(matchesScope('src/export/a.ts', ['src/export']), true);
  assert.equal(matchesScope('src/exports/a.ts', ['src/export/']), false);
  assert.equal(matchesScope('src/exporter.ts', ['src/export']), false);
  assert.equal(matchesScope('src/export/a.ts', []), false);
  assert.equal(matchesScope('src\\export\\a.ts', ['src/export/']), true, 'a Windows separator must not defeat the check');
});

test('UT-144 a git ref that could become an option is refused', () => {
  assert.equal(isSafeRef('HEAD'), true);
  assert.equal(isSafeRef('origin/main'), true);
  assert.equal(isSafeRef('--upload-pack=evil'), false);
  assert.equal(isSafeRef('a b'), false);
  assert.equal(isSafeRef(''), false);
  assert.equal(isSafeRef(null), false);
});

test('UT-145 every role has a declared set of permitted lifecycle states', () => {
  assert.equal(ROLES.length, 7);
  for (const role of ROLES) {
    assert.ok(Array.isArray(ROLE_STATES[role]) && ROLE_STATES[role].length > 0, role);
  }
  assert.ok(!ROLE_STATES.IMPLEMENTER.includes('DRAFT'), 'implementation may not begin in DRAFT');
  assert.ok(!ROLE_STATES.IMPLEMENTER.includes('READY_FOR_APPROVAL'), 'implementation may not begin before approval');
});

test('UT-146 an unreadable or non-object record is reported, never assumed empty', () => {
  const dir = scratch();
  try {
    writeFileSync(recordFile(dir, 'ASES-0001'), '[]\n');
    const loaded = loadRecord(recordFile(dir, 'ASES-0001'));
    assert.equal(loaded.ok, false);
    writeFileSync(recordFile(dir, 'ASES-0001'), '{ not json\n');
    assert.equal(loadRecord(recordFile(dir, 'ASES-0001')).ok, false);
    assert.equal(loadRecord(path.join(specDir(dir), 'execution', 'ASES-9999.json')).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-147 path normalisation is stable across separators', () => {
  assert.equal(normalisePath('a\\b\\c.ts'), 'a/b/c.ts');
  assert.equal(normalisePath('./a/b.ts'), 'a/b.ts');
  assert.equal(normalisePath('a/b.ts'), 'a/b.ts');
});

test('UT-148 every agent rule is declared in the shared catalogue', () => {
  for (let n = 42; n <= 58; n += 1) {
    const id = `SDD-V0${n}`;
    assert.ok(RULES[id], `${id} must exist in rules.mjs`);
    assert.ok(RULES[id].title && RULES[id].severity, id);
  }
  assert.equal(RULES['SDD-V052'].severity, 'WARNING', 'drift asks for review; it does not block');
});

// ── The tool reports; it never repairs ──────────────────────────────────────

test('REG-101 no agent read command writes to the fixture tree', () => {
  const before = JSON.stringify(listRecords(path.join(AGENT_ROOT, 'specs', SPEC)));
  run(['agent', 'preflight', '--spec', 'SPEC-0001', '--role', 'IMPLEMENTER', '--task', 'TASK-001', '--root', AGENT_ROOT]);
  run(['agent', 'verify-session', '--spec', 'SPEC-0001', '--root', AGENT_ROOT]);
  run(['agent', 'review-check', '--spec', 'SPEC-0001', '--root', AGENT_ROOT]);
  assert.equal(JSON.stringify(listRecords(path.join(AGENT_ROOT, 'specs', SPEC))), before);
});

// ── Session-delta attribution (SPEC-0002/TASK-012, resolves CONV-007) ────────
//
// Scope must be judged on what the session introduced. Every case below runs
// against a real throwaway git repository, because attribution depends on what
// git actually reports, not on what a stub says it would.

function gitRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-delta-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, shell: false, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'fixture@example.invalid');
  g('config', 'user.name', 'fixture');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
  mkdirSync(path.join(dir, 'ui'), { recursive: true });
  for (const [f, body] of [
    ['src/export/service.ts', 'export const a = 1;\n'],
    ['src/export/other.ts', 'export const b = 2;\n'],
    ['ui/Widget.tsx', 'export const W = 3;\n'],
    ['ui/Panel.tsx', 'export const P = 4;\n'],
  ]) writeFileSync(path.join(dir, f), body);
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  return { dir, git: g };
}

/** A session over `allowed`, started after `dirty` were already modified. */
function startSession(dir, { allowed = ['src/export/'], dirty = [] } = {}) {
  for (const f of dirty) writeFileSync(path.join(dir, f), 'pre-existing edit\n');
  const initial = gitStatusPaths(dir) ?? [];
  return {
    schemaVersion: 1,
    sessionId: 'ASES-0001',
    specId: 'SPEC-0001',
    role: 'IMPLEMENTER',
    actorType: 'ai',
    actorId: 'delta-fixture',
    taskIds: ['TASK-001'],
    startedFromCommit: gitHead(dir) ?? 'unknown',
    initialChangedPaths: initial,
    initialDigests: captureInitialState(dir, initial),
    allowedPaths: allowed,
    prohibitedPaths: [],
    requiredTests: [],
    status: 'IN_PROGRESS',
    result: null,
  };
}

const write = (dir, f, body) => writeFileSync(path.join(dir, f), body);
const SPEC0001 = { specId: 'SPEC-0001' };

function withRepo(fn) {
  const repo = gitRepo();
  try {
    return fn(repo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

test('UT-008 a pre-existing dirty file the session never touched is not attributed to it', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir, { dirty: ['ui/Widget.tsx', 'ui/Panel.tsx'] });
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, [], 'the session introduced nothing');
    assert.deepEqual(delta.preExisting, ['ui/Panel.tsx', 'ui/Widget.tsx']);
    assert.deepEqual(delta.unattributed, []);
    assert.deepEqual(scopeFindings(dir, SPEC0001, session, delta.session), [], 'pre-existing work is never a scope violation');
  });
});

test('UT-009 a clean file modified by the session inside scope passes', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir);
    write(dir, 'src/export/service.ts', 'export const a = 99;\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['src/export/service.ts']);
    assert.deepEqual(scopeFindings(dir, SPEC0001, session, delta.session), []);
  });
});

test('UT-010 a clean file modified by the session outside scope fails', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir);
    write(dir, 'ui/Widget.tsx', 'export const W = 99;\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['ui/Widget.tsx']);
    assert.ok(ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'));
  });
});

test('UT-011 a pre-existing dirty file modified again by the session, inside scope, is attributed and passes', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir, { dirty: ['src/export/service.ts'] });
    write(dir, 'src/export/service.ts', 'export const a = 12345;\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['src/export/service.ts'], 'a second edit by the session belongs to the session');
    assert.deepEqual(delta.preExisting, []);
    assert.deepEqual(scopeFindings(dir, SPEC0001, session, delta.session), []);
  });
});

test('UT-012 a pre-existing dirty file modified again by the session, outside scope, is attributed and fails', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir, { dirty: ['ui/Widget.tsx'] });
    write(dir, 'ui/Widget.tsx', 'export const W = 12345;\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['ui/Widget.tsx'], 'subtracting the path set alone would have hidden this');
    assert.ok(ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'));
  });
});

test('UT-013 a file created during the session is attributed to it', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir);
    write(dir, 'src/export/fresh.ts', 'export const c = 5;\n');
    write(dir, 'ui/Fresh.tsx', 'export const F = 6;\n');
    const delta = sessionDelta(dir, session);
    assert.ok(delta.session.includes('src/export/fresh.ts'));
    assert.ok(delta.session.includes('ui/Fresh.tsx'));
    assert.ok(ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'), 'the out-of-scope new file is reported');
  });
});

test('UT-014 a deleted file is attributed and judged against scope', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir);
    rmSync(path.join(dir, 'ui/Panel.tsx'));
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['ui/Panel.tsx']);
    assert.ok(ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'), 'deleting an out-of-scope file is a scope violation');
  });
});

test('UT-015 a rename is attributed on both paths', () => {
  withRepo(({ dir, git }) => {
    const session = startSession(dir);
    git('mv', 'src/export/other.ts', 'ui/Moved.ts');
    const delta = sessionDelta(dir, session);
    assert.ok(delta.session.includes('src/export/other.ts'), 'the source path is part of the change');
    assert.ok(delta.session.includes('ui/Moved.ts'), 'so is the destination');
    assert.ok(ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'), 'moving a file out of scope is reported');
  });
});

test('UT-016 attribution is stable across path separators', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir, { dirty: ['ui/Widget.tsx'] });
    assert.equal(attribute(dir, session, 'ui\\Widget.tsx'), 'PRE_EXISTING');
    assert.equal(attribute(dir, session, './ui/Widget.tsx'), 'PRE_EXISTING');
    assert.equal(attribute(dir, session, 'src\\export\\service.ts'), 'SESSION');
    const windowsStyle = {
      ...session,
      initialChangedPaths: ['ui\\Widget.tsx'],
      initialDigests: { 'ui/Widget.tsx': session.initialDigests['ui/Widget.tsx'] },
    };
    assert.equal(attribute(dir, windowsStyle, 'ui/Widget.tsx'), 'PRE_EXISTING');
  });
});

test('UT-017 a path with no recorded digest is REVIEW REQUIRED, never a silent pass', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir, { dirty: ['ui/Widget.tsx'] });
    delete session.initialDigests;
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.unattributed, ['ui/Widget.tsx']);
    assert.deepEqual(delta.session, [], 'it is not blamed');
    assert.deepEqual(delta.preExisting, [], 'and it is not declared safe either');
    const findings = attributionFindings(SPEC0001, delta);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'SDD-V052');
    assert.equal(findings[0].severity, 'WARNING');
    assert.match(findings[0].message, /attribution is unproven/);
  });
});

test('UT-017 an unrelated change made after session start is attributed and judged', () => {
  withRepo(({ dir }) => {
    const session = startSession(dir);
    write(dir, 'ui/Panel.tsx', 'a concurrent edit by somebody else\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.session, ['ui/Panel.tsx']);
    assert.ok(
      ruleIds(scopeFindings(dir, SPEC0001, session, delta.session)).has('SDD-V046'),
      'a change the session cannot vouch for is surfaced, not assumed benign',
    );
  });
});

test('UT-017 a collapsed untracked directory is never declared unchanged', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'ui', 'nested'), { recursive: true });
    write(dir, 'ui/nested/a.tsx', 'first\n');
    const session = startSession(dir);
    assert.ok(
      session.initialChangedPaths.some((p) => p.startsWith('ui/nested')),
      'git collapses the untracked directory into one entry',
    );
    write(dir, 'ui/nested/a.tsx', 'the session changed this\n');
    const delta = sessionDelta(dir, session);
    assert.deepEqual(delta.preExisting, [], 'a directory entry must never be reported as unchanged');
    assert.ok(delta.unattributed.length > 0 || delta.session.length > 0, 'it is surfaced one way or the other');
    assert.equal(fileDigest(dir, 'ui/nested'), DIRECTORY_DIGEST);
    assert.equal(fileDigest(dir, 'ui/nested/'), DIRECTORY_DIGEST, 'a trailing separator does not defeat the check');
  });
});

// ── TASK-018 / CHG-007 — scope declarations are structured, never prose ──────
//
// SPEC-0003/CONV-008. taskScope() used to harvest every backticked token in a
// scope declaration as a path, and could not tell that prose in the same
// region described a boundary that was never backticked. Every fixture below
// is synthetic; the first reproduces the real defect exactly.

/** Wrap a scope declaration in the minimum task section taskScope() needs. */
const taskWith = (allowed, prohibited = '`tools/x.mjs`') =>
  [
    '## TASK-001',
    '',
    '**Purpose:** synthetic.',
    '**Requirements:** `FR-001`.',
    `**Allowed scope:** ${allowed}`,
    `**Prohibited paths:** ${prohibited}`,
    '**Required tests:** `UT-001`.',
    '**Status:** `TODO`',
  ].join('\n');

const scopeOf = (allowed, prohibited) => taskScope(taskWith(allowed, prohibited), 'TASK-001');

test('UT-046 the original CONV-008 case: a filename fragment in prose is not admitted as a path', () => {
  const scope = scopeOf('a new Playwright spec under `apps/web/tests/e2e/`, named `tablesearch-a11y` created by this task.');
  assert.deepEqual(scope.allowed, ['apps/web/tests/e2e/'], 'only the real path survives');
  assert.ok(
    scope.problems.some((p) => p.includes('tablesearch-a11y')),
    'and the non-path token is reported rather than silently dropped',
  );
});

test('UT-047 a prohibited path described in prose is reported, never silently lost', () => {
  // The dangerous direction. An unparsed prohibition under-restricts the
  // session and the scope check then passes what it existed to catch.
  const scope = scopeOf('`tools/a.mjs`', '`tools/b.mjs`, and the Playwright and Vitest configuration files');
  assert.deepEqual(scope.prohibited, ['tools/b.mjs']);
  assert.ok(
    scope.problems.some((p) => p.startsWith('Prohibited paths') && p.includes('prose')),
    'the sentence that named a boundary without backticking it must be surfaced',
  );
});

test('UT-048 multiple allowed paths across several lines all parse, with no problem', () => {
  const scope = taskScope(
    [
      '## TASK-001',
      '',
      '**Requirements:** `FR-001`.',
      '**Allowed scope:** `tools/a.mjs`, `tools/b.mjs`,',
      '`docs/sdd/C.md`, `sdd.config.json`.',
      '**Prohibited paths:** `tools/z.mjs`.',
      '**Required tests:** `UT-001`.',
    ].join('\n'),
    'TASK-001',
  );
  assert.deepEqual(scope.allowed, ['tools/a.mjs', 'tools/b.mjs', 'docs/sdd/C.md', 'sdd.config.json']);
  assert.deepEqual(scope.problems, [], 'a structured multi-line list is clean');
});

test('UT-049 multiple prohibited paths parse in full, with no partial-list truncation', () => {
  const scope = scopeOf('`tools/a.mjs`', '`tools/x.mjs`, `tools/y.mjs`, `docs/`, `apps/web/package.json`.');
  assert.deepEqual(scope.prohibited, ['tools/x.mjs', 'tools/y.mjs', 'docs/', 'apps/web/package.json']);
  assert.deepEqual(scope.problems, []);
});

test('UT-050 a backticked identifier is ignored, not turned into a path', () => {
  // SPEC-0001/TASK-012 cited CHG-001 in its allowed scope and the parser
  // returned it as an allowed path.
  const scope = scopeOf('`docs/sdd/CI_ENFORCEMENT.md`, added by `CHG-001`, `.github/workflows/x.yml`.');
  assert.ok(!scope.allowed.includes('CHG-001'), 'an identifier is never a path');
  assert.deepEqual(scope.allowed, ['docs/sdd/CI_ENFORCEMENT.md', '.github/workflows/x.yml']);
  assert.ok(scope.problems.some((p) => p.includes('prose')), 'the prose around it is still reported');
});

test('UT-051 a glob is refused, because CL-002 permits exact paths and prefixes only', () => {
  const scope = scopeOf('`tools/sdd/tests/**`');
  assert.deepEqual(scope.allowed, [], 'a pattern is not a path');
  assert.ok(scope.problems.some((p) => p.includes('tools/sdd/tests')));
  for (const pattern of ['`a/b?.mjs`', '`a/[bc].mjs`', '`docs/{a,b}.md`']) {
    assert.ok(scopeOf(pattern).problems.length > 0, `${pattern} must be refused`);
  }
});

test('UT-052 a wholly prose declaration yields no paths and is reported', () => {
  // SPEC-0001/TASK-011 declares "evidence package only." and the parser
  // returned an empty allowed list while saying nothing at all.
  const scope = scopeOf('evidence package only.');
  assert.deepEqual(scope.allowed, []);
  assert.ok(scope.problems.some((p) => p.startsWith('Allowed scope')), 'silence here is the defect');
});

test('UT-053 an absent declaration is not reported as malformed', () => {
  // A missing section is SDD-V045's business, not this rule's. Reporting it
  // twice would make the real signal harder to read.
  const scope = taskScope(
    ['## TASK-001', '', '**Requirements:** `FR-001`.', '**Required tests:** `UT-001`.'].join('\n'),
    'TASK-001',
  );
  assert.deepEqual(scope.allowed, []);
  assert.deepEqual(scope.prohibited, []);
  assert.deepEqual(scope.problems, [], 'absent is not the same as malformed');
});

test('UT-054 the declaration ends at the next field and does not swallow later prose', () => {
  const scope = taskScope(
    [
      '## TASK-001',
      '',
      '**Requirements:** `FR-001`.',
      '**Allowed scope:** `tools/a.mjs`.',
      '**Prohibited paths:** `tools/z.mjs`.',
      '**Security implications:** none; this touches no `tools/secret.mjs` boundary.',
      '**Definition of Done:** the file `tools/other.mjs` is untouched.',
      '**Required tests:** `UT-001`.',
    ].join('\n'),
    'TASK-001',
  );
  assert.deepEqual(scope.allowed, ['tools/a.mjs'], 'later fields contribute no paths');
  assert.deepEqual(scope.prohibited, ['tools/z.mjs']);
  assert.deepEqual(scope.problems, [], 'and their prose is not mistaken for a malformed scope');
});

test('UT-055 every real specification in this repository still parses as it should', () => {
  // Existing-artefact compatibility. The clean declarations must stay clean,
  // and the known-malformed ones must be reported rather than quietly wrong.
  const root = path.resolve(HERE, '..', '..', '..');
  const cases = [
    ['specs/SPEC-0002-agent-integration-controlled-execution/tasks.md', 'TASK-018'],
    ['specs/SPEC-0002-agent-integration-controlled-execution/tasks.md', 'TASK-011'],
    ['specs/SPEC-0001-sdd-verification-enforcement/tasks.md', 'TASK-002'],
  ];
  for (const [file, taskId] of cases) {
    const scope = taskScope(readFileSync(path.join(root, file), 'utf8'), taskId);
    assert.ok(scope, `${taskId} exists in ${file}`);
    assert.equal(scope.problems.length, 0, `${taskId} in ${file} parses cleanly`);
    assert.ok(scope.allowed.length > 0, `${taskId} still yields its allowed paths`);
  }
  const legacy = taskScope(
    readFileSync(path.join(root, 'specs/SPEC-0001-sdd-verification-enforcement/tasks.md'), 'utf8'),
    'TASK-012',
  );
  assert.ok(!legacy.allowed.includes('CHG-001'), 'the identifier is no longer an allowed path');
  assert.ok(legacy.problems.length > 0, 'and its prose declaration is reported');
});

// ── TASK-019 / CHG-008 — a closed session's result is stable ─────────────────
//
// SPEC-0003/CONV-009. A session record captured where it started and nothing
// about where it ended, so re-running scope-check later evaluated it against
// the live tree and blamed it for edits other sessions made afterwards.
// Observed three times in one pass: ASES-0001, ASES-0003 and ASES-0008.

/** Close a session the way the CLI does: capture the end state, then mark it. */
const close = (dir, session, { status = 'COMPLETE', result = 'PASS' } = {}) => {
  const paths = gitStatusPaths(dir) ?? [];
  return { ...session, status, result, finalChangedPaths: paths, finalDigests: captureFinalState(dir, paths) };
};

test('UT-056 a closed session keeps the result it had when it ran', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    const a = startSession(dir, { allowed: ['src/export/'] });
    write(dir, 'src/export/csv.ts', 'session A wrote this\n');
    const live = sessionDelta(dir, a);
    assert.deepEqual(live.session, ['src/export/csv.ts'], 'in flight, judged against the live tree');
    assert.deepEqual(scopeFindings(dir, SPEC0001, a, live.session), [], 'and it is inside scope');

    const closed = close(dir, a);
    const after = sessionDelta(dir, closed);
    assert.equal(after.historical, true);
    assert.deepEqual(after.session, ['src/export/csv.ts'], 'the same answer after closing');
    assert.deepEqual(scopeFindings(dir, SPEC0001, closed, after.session), []);
  });
});

test('UT-057 a later session’s edit to a path the first prohibited is not blamed on the first', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    mkdirSync(path.join(dir, 'tests'), { recursive: true });

    // Session A: allowed src/export/, prohibited tests/. Closes clean.
    const a = close(dir, {
      ...startSession(dir, { allowed: ['src/export/'] }),
      prohibitedPaths: ['tests/'],
    });
    write(dir, 'src/export/csv.ts', 'session A wrote this\n');
    const aClosed = close(dir, { ...a, prohibitedPaths: ['tests/'] });
    assert.deepEqual(scopeFindings(dir, SPEC0001, aClosed, sessionDelta(dir, aClosed).session), [],
      'session A is clean at the moment it closes');

    // Session B, later, edits exactly what A prohibited. Entirely legitimate:
    // it is a different session with a different scope.
    write(dir, 'tests/csv.spec.ts', 'session B wrote this\n');

    const recheck = sessionDelta(dir, aClosed);
    assert.ok(!recheck.session.includes('tests/csv.spec.ts'), 'B’s file is not attributed to A');
    assert.deepEqual(scopeFindings(dir, SPEC0001, aClosed, recheck.session), [],
      're-validating A still reproduces A’s original result');
  });
});

test('UT-058 a prohibited edit made *during* the session still fails, before and after closing', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    const a = { ...startSession(dir, { allowed: ['src/export/'] }), prohibitedPaths: ['tests/'] };

    // The session itself crosses its own boundary.
    write(dir, 'tests/csv.spec.ts', 'the session edited a prohibited path\n');

    const live = sessionDelta(dir, a);
    const liveFindings = scopeFindings(dir, SPEC0001, a, live.session);
    assert.ok(liveFindings.some((f) => f.ruleId === 'SDD-V058'), 'caught while the session is open');

    const closed = close(dir, a);
    const after = scopeFindings(dir, SPEC0001, closed, sessionDelta(dir, closed).session);
    assert.ok(after.some((f) => f.ruleId === 'SDD-V058'), 'and still caught after it closes — the fix hides nothing');
  });
});

test('UT-059 a genuinely unattributable change stays visible after closing', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    const a = startSession(dir, { allowed: ['src/export/'] });
    // A path dirty before the session with no recorded digest: attribution
    // cannot be established either way.
    a.initialChangedPaths = [...a.initialChangedPaths, 'src/export/mystery.ts'];
    write(dir, 'src/export/mystery.ts', 'no digest was recorded for this\n');

    const closed = close(dir, a);
    const delta = sessionDelta(dir, closed);
    assert.ok(delta.unattributed.includes('src/export/mystery.ts'), 'reported, never silently attributed');
    assert.ok(attributionFindings(SPEC0001, delta).some((f) => f.ruleId === 'SDD-V052'));
  });
});

test('UT-060 a closed session with no end-state evidence reports a limited state and blames nobody', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    // Every session recorded before this change looks like this.
    const legacy = {
      ...startSession(dir, { allowed: ['src/export/'] }),
      prohibitedPaths: ['tests/'],
      status: 'COMPLETE',
      result: 'PASS',
    };
    write(dir, 'tests/csv.spec.ts', 'changed long after that session ended\n');

    const delta = sessionDelta(dir, legacy);
    assert.equal(delta.historical, true);
    assert.equal(delta.evidenceMissing, true);
    assert.deepEqual(delta.session, [], 'nothing is attributed');
    assert.deepEqual(delta.preExisting, []);
    assert.deepEqual(delta.unattributed, []);
    assert.deepEqual(scopeFindings(dir, SPEC0001, legacy, delta.session), [],
      'and no violation is invented against it');

    const reported = historicalEvidenceFindings(SPEC0001, legacy, delta);
    assert.equal(reported.length, 1, 'the limitation is documented, not silent');
    assert.equal(reported[0].ruleId, 'SDD-V063');
  });
});

test('UT-061 an in-flight session is still judged against the live tree', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    for (const status of ['READY', 'IN_PROGRESS']) {
      const open = { ...startSession(dir, { allowed: ['src/export/'] }), prohibitedPaths: ['tests/'], status };
      write(dir, 'tests/live.spec.ts', `edited while ${status}\n`);
      const delta = sessionDelta(dir, open);
      assert.equal(delta.historical, false, `${status} is not historical`);
      // git collapses the untracked directory into one entry, so the live tree
      // is observed as `tests/` rather than the file beneath it.
      assert.ok(
        delta.session.some((p) => p.startsWith('tests')),
        `${status} still reads the live tree`,
      );
      assert.ok(
        scopeFindings(dir, SPEC0001, open, delta.session).some((f) => f.ruleId === 'SDD-V058'),
        `${status} enforcement is unchanged`,
      );
      rmSync(path.join(dir, 'tests/live.spec.ts'), { force: true });
    }
  });
});

test('UT-062 pre-existing work stays PRE_EXISTING across closing', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    write(dir, 'src/export/untouched.ts', 'dirty before the session\n');
    const a = startSession(dir, { allowed: ['src/export/'], dirty: [] });
    a.initialChangedPaths = gitStatusPaths(dir) ?? [];
    a.initialDigests = captureInitialState(dir, a.initialChangedPaths);

    write(dir, 'src/export/csv.ts', 'the session wrote this\n');
    const closed = close(dir, a);
    const delta = sessionDelta(dir, closed);
    assert.ok(delta.preExisting.includes('src/export/untouched.ts'), 'untouched pre-existing work is not claimed');
    assert.ok(delta.session.includes('src/export/csv.ts'));
  });
});

test('UT-063 end-state evidence is captured once and is not silently refreshed', () => {
  withRepo(({ dir }) => {
    mkdirSync(path.join(dir, 'src', 'export'), { recursive: true });
    const a = startSession(dir, { allowed: ['src/export/'] });
    write(dir, 'src/export/csv.ts', 'first\n');
    const closed = close(dir, a);
    const captured = JSON.stringify(closed.finalDigests);

    assert.equal(isTerminalSession(closed), true);
    assert.equal(hasFinalEvidence(closed), true);
    assert.equal(hasFinalEvidence(a), false, 'an open session carries none');

    // Whatever happens next must not change what the record already says.
    write(dir, 'src/export/csv.ts', 'changed afterwards\n');
    assert.equal(JSON.stringify(closed.finalDigests), captured, 'the recorded end state is immutable');
    const delta = sessionDelta(dir, closed);
    assert.deepEqual(delta.session, ['src/export/csv.ts'], 'still attributed by the digest it recorded');
  });
});

// ── TASK-021 / CHG-008 — execution evidence is not a scope deviation ────────
//
// SPEC-0003/CONV-010. `allowedPaths` was derived only from a task's declared
// implementation scope, so a task had no lawful way to record the evidence its
// own run produces. ASES-0008 hit it visibly; the control plane had the same
// gap silently, writing a session record into a directory almost no task
// declares.

const SPEC_DIR = 'SPEC-0002-agent-integration-controlled-execution';
const OWN = (rest) => `specs/${SPEC_DIR}/${rest}`;
const SPEC_OBJ = { specId: 'SPEC-0002', name: SPEC_DIR };

test('UT-064 a task may record the evidence its own execution produces', () => {
  withRepo(({ dir }) => {
    const session = { ...startSession(dir, { allowed: ['tools/sdd/lib/agent.mjs'] }), prohibitedPaths: [] };
    const evidence = [
      OWN('execution/ASES-0008.json'),
      OWN('execution/VER-0008.json'),
      OWN('execution/REV-0010.json'),
      OWN('traceability.md'),
      OWN('change-record.md'),
    ];
    assert.deepEqual(
      scopeFindings(dir, SPEC_OBJ, session, evidence),
      [],
      'none of these is a scope deviation',
    );
  });
});

test('UT-065 artefacts that state intent are still outside scope', () => {
  withRepo(({ dir }) => {
    const session = { ...startSession(dir, { allowed: ['tools/sdd/lib/agent.mjs'] }), prohibitedPaths: [] };
    // Each of these carries something a task must not grant itself: a
    // requirement, a plan, a decision, a test design, an approval, a verdict.
    for (const rest of ['spec.md', 'plan.md', 'clarifications.md', 'test-plan.md', 'sdd.json', 'convergence.md']) {
      const emitted = scopeFindings(dir, SPEC_OBJ, session, [OWN(rest)]);
      assert.ok(
        emitted.some((f) => f.ruleId === 'SDD-V046'),
        `${rest} must stay outside the allowance`,
      );
    }
  });
});

test('UT-066 the allowance never reaches another specification', () => {
  withRepo(({ dir }) => {
    const session = { ...startSession(dir, { allowed: ['tools/sdd/lib/agent.mjs'] }), prohibitedPaths: [] };
    const foreign = [
      'specs/SPEC-0003-tablesearch-accessibility/execution/ASES-0001.json',
      'specs/SPEC-0003-tablesearch-accessibility/traceability.md',
      'specs/SPEC-0003-tablesearch-accessibility/change-record.md',
    ];
    for (const file of foreign) {
      assert.ok(
        scopeFindings(dir, SPEC_OBJ, session, [file]).some((f) => f.ruleId === 'SDD-V046'),
        `${file} belongs to another specification`,
      );
    }
    assert.equal(isMetaArtefact(foreign[0], SPEC_OBJ), false);
  });
});

test('UT-067 an explicit prohibition still outranks the allowance', () => {
  withRepo(({ dir }) => {
    // A task that deliberately forbids its own execution directory — a review
    // task, say — must have that honoured. The allowance is checked after the
    // prohibited list, never before it.
    const session = {
      ...startSession(dir, { allowed: ['tools/sdd/lib/agent.mjs'] }),
      prohibitedPaths: [`specs/${SPEC_DIR}/execution/`],
    };
    const emitted = scopeFindings(dir, SPEC_OBJ, session, [OWN('execution/ASES-0008.json')]);
    assert.ok(emitted.some((f) => f.ruleId === 'SDD-V058'), 'an explicit prohibition wins');

    // And the enumeration is closed: a file that merely looks like evidence is
    // not covered.
    const open = { ...startSession(dir, { allowed: ['tools/sdd/lib/agent.mjs'] }), prohibitedPaths: [] };
    for (const rest of ['execution', 'execution/', 'traceability.md.bak', 'notes/change-record.md']) {
      assert.equal(isMetaArtefact(OWN(rest), SPEC_OBJ), false, `${rest} is not execution evidence`);
    }
    assert.ok(scopeFindings(dir, SPEC_OBJ, open, [OWN('traceability.md.bak')]).length > 0);
  });
});
