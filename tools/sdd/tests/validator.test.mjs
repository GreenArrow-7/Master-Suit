/**
 * Validator tests. Node built-in runner, no dependency.
 *
 *   node --test tools/sdd/tests/validator.test.mjs
 *
 * Strategy: three canonical VALID fixtures live on disk under
 * fixtures/valid/. Every INVALID case is produced by copying that known-good
 * tree into a temporary directory and introducing exactly one defect, so a
 * failure is attributable to that defect and nothing else.
 *
 * All fixture content is synthetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..');
const CLI = path.join(TOOL_ROOT, 'cli.mjs');
const VALID_ROOT = path.join(HERE, 'fixtures', 'valid');

/** Run the CLI and capture stdout and exit code without throwing. */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, timeout: 60000 });
    return { code: 0, stdout };
  } catch (err) {
    return { code: typeof err.status === 'number' ? err.status : 2, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function runJson(root) {
  const result = run(['validate', '--all', '--root', root, '--format', 'json']);
  return { ...result, json: result.stdout ? JSON.parse(result.stdout) : null };
}

function rules(json) {
  return new Set((json?.findings ?? []).map((f) => f.ruleId));
}

/** A temporary copy of the valid tree, plus a minimal conflict register. */
function scratch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sdd-fixture-'));
  cpSync(VALID_ROOT, dir, { recursive: true });
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'EVIDENCE_CONFLICTS.md'), '# Register\n\n### EVC-001 — sample\n\nStatus: OPEN\n');
  return dir;
}

const specDir = (root, name) => path.join(root, 'specs', name);
const S1 = 'SPEC-0001-lightweight-example';
const S2 = 'SPEC-0002-normal-example';
const S3 = 'SPEC-0003-security-example';

function editManifest(root, name, mutate) {
  const file = path.join(specDir(root, name), 'sdd.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  mutate(manifest);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function editFile(root, name, file, mutate) {
  const target = path.join(specDir(root, name), file);
  writeFileSync(target, mutate(readFileSync(target, 'utf8')));
}

/** Assert a mutated tree fails and emits the expected rule. */
function expectRule(mutate, ruleId, options = {}) {
  const root = scratch();
  try {
    mutate(root);
    const { code, json } = runJson(root);
    const emitted = rules(json);
    assert.ok(emitted.has(ruleId), `expected ${ruleId}, got ${[...emitted].sort().join(', ') || 'none'}`);
    if (!options.warningOnly) {
      assert.equal(code, 1, 'an ERROR finding must exit 1');
      assert.equal(json.result, 'FAIL');
    }
    for (const forbidden of options.notEmitted ?? []) {
      assert.ok(!emitted.has(forbidden), `${forbidden} should not have been emitted`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── Valid cases ─────────────────────────────────────────────────────────────

test('IT-001/002/003 valid fixtures validate with no findings', () => {
  const { code, json } = runJson(VALID_ROOT);
  assert.equal(code, 0);
  assert.equal(json.result, 'PASS');
  assert.equal(json.errors, 0);
  assert.deepEqual(json.findings, []);
});

test('UT-001 discovery finds every fixture specification', () => {
  const out = run(['validate', '--spec', 'SPEC-0002', '--root', VALID_ROOT, '--format', 'json']);
  assert.equal(out.code, 0);
  const missing = run(['validate', '--spec', 'SPEC-9999', '--root', VALID_ROOT]);
  assert.equal(missing.code, 2, 'an unknown spec filter is a tooling failure');
});

test('UT-003 JSON output is deterministic across runs', () => {
  const a = run(['validate', '--all', '--root', VALID_ROOT, '--format', 'json']).stdout;
  const b = run(['validate', '--all', '--root', VALID_ROOT, '--format', 'json']).stdout;
  assert.equal(a, b);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(a), 'output must not contain a timestamp');
});

test('UT-008 text output names rule, severity, location and message', () => {
  const root = scratch();
  try {
    editManifest(root, S2, (m) => { m.risk = 'R9'; });
    const out = run(['validate', '--all', '--root', root, '--format', 'text']);
    assert.equal(out.code, 1);
    assert.match(out.stdout, /ERROR\s+SDD-V006/, 'severity and rule id must appear');
    assert.match(out.stdout, /SPEC-0002/, 'the specification must be named');
    assert.match(out.stdout, /sdd\.json/, 'the artefact must be named');
    assert.match(out.stdout, /Unknown risk level/, 'a human-readable message must appear');
    assert.match(out.stdout, /result=FAIL\s+errors=\d+\s+warnings=\d+/, 'a summary line must appear');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-009 JSON findings are sorted by spec, then rule, then artefact', () => {
  const root = scratch();
  try {
    // Several unrelated defects across two specifications, so ordering matters.
    editManifest(root, S2, (m) => { m.risk = 'R9'; m.status = 'NOT_A_STATE'; });
    editFile(root, S3, 'spec.md', (t) => `${t}\n- \`FR-001\` — duplicate declaration.\n`);
    const { json } = runJson(root);
    assert.ok(json.findings.length >= 3);
    const key = (f) => [f.specId ?? '', f.ruleId, f.artifact ?? '', f.message].join(' | ');
    const sorted = [...json.findings].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    assert.deepEqual(json.findings.map(key), sorted.map(key), 'findings must be emitted in sorted order');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-006 a missing specs root is a tooling failure, not a pass', () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'sdd-empty-'));
  try {
    const out = run(['validate', '--all', '--root', empty]);
    assert.equal(out.code, 2);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('UT-007 every finding carries a known rule id', async () => {
  const { RULES } = await import('../rules/rules.mjs');
  const root = scratch();
  try {
    editManifest(root, S2, (m) => { m.risk = 'R9'; });
    const { json } = runJson(root);
    assert.ok(json.findings.length > 0);
    for (const f of json.findings) {
      assert.ok(RULES[f.ruleId], `unknown rule id emitted: ${f.ruleId}`);
      assert.ok(['ERROR', 'WARNING', 'INFO'].includes(f.severity));
      assert.equal(typeof f.message, 'string');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-004/005 exit codes are 0 on clean and 1 on error', () => {
  assert.equal(run(['validate', '--all', '--root', VALID_ROOT]).code, 0);
  const root = scratch();
  try {
    editManifest(root, S2, (m) => { m.status = 'NOT_A_STATE'; });
    assert.equal(run(['validate', '--all', '--root', root]).code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Invalid cases, one defect each ──────────────────────────────────────────

test('SDD-V001 bad directory name', () => {
  expectRule((root) => renameSync(specDir(root, S1), specDir(root, 'SPEC-1-bad')), 'SDD-V001');
});

test('SDD-V002 spec id does not match the directory', () => {
  expectRule((root) => editManifest(root, S1, (m) => { m.specId = 'SPEC-0099'; }), 'SDD-V002');
});

test('SDD-V003 duplicate SPEC number', () => {
  expectRule((root) => {
    cpSync(specDir(root, S2), specDir(root, 'SPEC-0002-duplicate-example'), { recursive: true });
    editManifest(root, 'SPEC-0002-duplicate-example', (m) => { m.slug = 'duplicate-example'; });
  }, 'SDD-V003');
});

test('SDD-V004 malformed manifest', () => {
  expectRule((root) => writeFileSync(path.join(specDir(root, S1), 'sdd.json'), '{ not json'), 'SDD-V004');
});

test('SDD-V005 unsupported schema version', () => {
  expectRule((root) => editManifest(root, S1, (m) => { m.schemaVersion = 99; }), 'SDD-V005');
});

test('SDD-V006 unknown risk level', () => {
  expectRule((root) => editManifest(root, S1, (m) => { m.risk = 'R9'; }), 'SDD-V006');
});

test('SDD-V007 unknown lifecycle state', () => {
  expectRule((root) => editManifest(root, S1, (m) => { m.status = 'ALMOST_DONE'; }), 'SDD-V007');
});

test('SDD-V008 declared artefact missing from disk', () => {
  expectRule((root) => rmSync(path.join(specDir(root, S2), 'plan.md')), 'SDD-V008');
});

test('SDD-V008 path traversal in an artefact path is rejected', () => {
  expectRule((root) => editManifest(root, S1, (m) => { m.artifacts.spec = '../../secrets.txt'; }), 'SDD-V008');
});

test('SDD-V009 required artefact missing for the risk level', () => {
  expectRule((root) => {
    editManifest(root, S2, (m) => { m.risk = 'R3'; });
    editFile(root, S2, 'spec.md', (t) => t.replace('| Risk | `R2` |', '| Risk | `R3` |'));
  }, 'SDD-V009');
});

test('SDD-V011 spec id disagrees with the manifest', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => t.replace('| Specification ID | `SPEC-0002` |', '| Specification ID | `SPEC-0077` |')), 'SDD-V011');
});

test('SDD-V012 risk disagrees with the manifest', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => t.replace('| Risk | `R2` |', '| Risk | `R4` |')), 'SDD-V012');
});

test('SDD-V013 status disagrees with the manifest', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => t.replace('| Status | `CONVERGED` |', '| Status | `DRAFT` |')), 'SDD-V013');
});

test('SDD-V014 duplicate requirement identifier', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => `${t}\n- \`FR-001\` — a second declaration of the same id.\n`), 'SDD-V014');
});

test('SDD-V016 broken qualified reference', () => {
  expectRule((root) => editFile(root, S2, 'traceability.md', (t) => `${t}\nSee SPEC-0099/FR-001 for context.\n`), 'SDD-V016');
});

test('SDD-V017 open clarification while implementing', () => {
  expectRule((root) => editFile(root, S3, 'clarifications.md', (t) => t.replace('**Status:** `INCORPORATED`', '**Status:** `OPEN`')), 'SDD-V017');
});

test('SDD-V018 illegal lifecycle transition', () => {
  expectRule((root) => editManifest(root, S1, (m) => {
    m.statusHistory = [{ status: 'DRAFT', date: '2026-01-01' }, { status: 'IMPLEMENTING', date: '2026-01-02' }];
  }), 'SDD-V018');
});

test('SDD-V019 status does not equal the final history entry', () => {
  expectRule((root) => editManifest(root, S2, (m) => {
    m.statusHistory.push({ status: 'READY_FOR_RELEASE', date: '2026-01-09' });
  }), 'SDD-V019');
});

test('SDD-V020 R4 implementing without a human implementation approval', () => {
  expectRule((root) => editManifest(root, S3, (m) => {
    m.approvals = m.approvals.filter((a) => a.gate !== 'implementation');
  }), 'SDD-V020');
});

test('SDD-V021 structurally incomplete approval record', () => {
  expectRule((root) => editManifest(root, S1, (m) => {
    m.approvals.push({ gate: 'specification', role: 'Product Owner', actorType: 'human', decision: 'approved' });
  }), 'SDD-V021');
});

test('SDD-V022 an AI actor cannot satisfy a human-required gate', () => {
  expectRule((root) => editManifest(root, S3, (m) => {
    for (const a of m.approvals) if (a.gate === 'implementation') a.actorType = 'ai';
  }), 'SDD-V022');
});

test('SDD-V023 R4 without a threat model', () => {
  expectRule((root) => {
    editManifest(root, S3, (m) => { m.artifacts.threatModel = null; });
    rmSync(path.join(specDir(root, S3), 'threat-model.md'));
  }, 'SDD-V023');
});

test('SDD-V024 missing test plan', () => {
  expectRule((root) => {
    editManifest(root, S2, (m) => { m.artifacts.testPlan = null; });
    rmSync(path.join(specDir(root, S2), 'test-plan.md'));
  }, 'SDD-V024');
});

test('SDD-V025 missing tasks artefact', () => {
  expectRule((root) => {
    editManifest(root, S2, (m) => { m.artifacts.tasks = null; });
    rmSync(path.join(specDir(root, S2), 'tasks.md'));
  }, 'SDD-V025');
});

test('SDD-V026 task cites neither a requirement nor a decision', () => {
  expectRule((root) => editFile(root, S2, 'tasks.md', (t) => t.replace('**Requirements:** `FR-001`.', '**Requirements:** to be decided.')), 'SDD-V026');
});

test('SDD-V027 requirement with no test coverage', () => {
  expectRule((root) => editFile(root, S2, 'test-plan.md', (t) => t.replace('| `UT-001` | `FR-001` | Ten rows are returned |\n', '')), 'SDD-V027');
});

test('SDD-V028 security requirement without a security test', () => {
  expectRule((root) => editFile(root, S3, 'test-plan.md', (t) => t.replace('| `ST-001` | `SEC-001` |', '| `UT-002` | `SEC-001` |')), 'SDD-V028');
});

test('SDD-V029 acceptance criterion without a verification mapping', () => {
  expectRule((root) => {
    editFile(root, S2, 'test-plan.md', (t) => t.replace('| `IT-001` | `AC-001` | The first page shows ten rows |\n', ''));
    editFile(root, S2, 'traceability.md', (t) => t.replace('| `AC-001` | `TASK-001` | `IT-001` | pass |\n', ''));
  }, 'SDD-V029');
});

test('SDD-V030 traceability references an identifier that does not exist', () => {
  expectRule((root) => editFile(root, S2, 'traceability.md', (t) => `${t}| \`FR-099\` | \`TASK-001\` | \`UT-001\` | pass |\n`), 'SDD-V030');
});

test('SDD-V032 CONVERGED with an open convergence finding', () => {
  expectRule((root) => editFile(root, S2, 'convergence.md', (t) => `${t}\n### CONV-001\n\n**Finding:** something remains.\n**Status:** \`OPEN\`\n`), 'SDD-V032');
});

test('SDD-V033 invalid convergence verdict', () => {
  expectRule((root) => editFile(root, S2, 'convergence.md', (t) => t.replace('| Recommended verdict | PASS |', '| Recommended verdict | PROBABLY FINE |')), 'SDD-V033');
});

test('SDD-V034 RELEASED without a release approval', () => {
  expectRule((root) => {
    editManifest(root, S2, (m) => {
      m.status = 'RELEASED';
      m.statusHistory.push({ status: 'READY_FOR_RELEASE', date: '2026-01-09' }, { status: 'RELEASED', date: '2026-01-10' });
    });
    editFile(root, S2, 'spec.md', (t) => t.replace('| Status | `CONVERGED` |', '| Status | `RELEASED` |'));
  }, 'SDD-V034');
});

test('SDD-V035 evidence-conflict reference that does not exist', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => `${t}\nRelated conflict: EVC-999.\n`), 'SDD-V035');
});

test('SDD-V036 a specification must not mark a conflict resolved', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => `${t}\nEVC-001 is now RESOLVED by this specification.\n`), 'SDD-V036');
});

test('SDD-V037 duplicate change-record identifier', () => {
  expectRule((root) => {
    writeFileSync(path.join(specDir(root, S2), 'change-record.md'), '# Changes\n\n## CHG-001\n\nFirst.\n\n## CHG-001\n\nSecond.\n');
    editManifest(root, S2, (m) => { m.artifacts.changeRecord = 'change-record.md'; });
  }, 'SDD-V037');
});

test('SDD-V039 R0 must not have a specification directory', () => {
  expectRule((root) => {
    editManifest(root, S1, (m) => { m.risk = 'R0'; });
    editFile(root, S1, 'spec.md', (t) => t.replace('| Risk | `R1` |', '| Risk | `R0` |'));
  }, 'SDD-V039');
});

test('SDD-V038 R1 carrying a heavy artefact is a warning, not an error', () => {
  const root = scratch();
  try {
    writeFileSync(path.join(specDir(root, S1), 'plan.md'), '# Plan\n\nUnexpected at R1.\n');
    editManifest(root, S1, (m) => { m.artifacts.plan = 'plan.md'; });
    const { code, json } = runJson(root);
    assert.ok(rules(json).has('SDD-V038'));
    assert.equal(code, 0, 'a warning alone must not fail the run');
    assert.equal(json.result, 'PASS');
    const strict = run(['validate', '--all', '--root', root, '--strict']);
    assert.equal(strict.code, 1, '--strict promotes warnings to errors');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SDD-V040 broken repository document reference', () => {
  expectRule((root) => editFile(root, S2, 'spec.md', (t) => `${t}\nSee \`docs/does-not-exist.md\` for detail.\n`), 'SDD-V040');
});

// ── Security tests ──────────────────────────────────────────────────────────

/**
 * Files reviewed and permitted to import `child_process`, each with the date
 * and the reason. Membership alone authorises nothing: `ST-002` additionally
 * proves the required properties hold in the file, so an entry here cannot
 * shelter an unsafe implementation.
 *
 * Adding a name is a security decision. Extended by SPEC-0002/TASK-011 after
 * the review recorded in
 * docs/evidence/phase-b3-agent-integration/allowlist-security-review.md.
 */
const SUBPROCESS_REVIEWED = new Map([
  ['lib/diff.mjs', 'SPEC-0001: read-only git for diff-aware validation'],
  ['tests/validator.test.mjs', 'SPEC-0001: runs the CLI under test'],
  ['lib/agent.mjs', 'SPEC-0002/TASK-011: read-only git for drift and scope'],
  ['tests/agent.test.mjs', 'SPEC-0002/TASK-011: runs the CLI under test'],
]);

const relFromTool = (full) => path.relative(TOOL_ROOT, full).split(path.sep).join('/');

/** Every .mjs under tools/sdd/ except fixtures, which are synthetic data. */
function toolSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures') continue;
        walk(full);
      } else if (entry.name.endsWith('.mjs')) {
        files.push(full);
      }
    }
  };
  walk(TOOL_ROOT);
  return files;
}

test('ST-002 the tool contains no dynamic execution construct', () => {
  const offenders = [];
  for (const full of toolSources()) {
    const text = readFileSync(full, 'utf8');
    // Universal. No file is exempt from these, reviewed or not.
    if (/\beval\s*\(/.test(text)) offenders.push(`${full}: eval`);
    if (/new\s+Function\s*\(/.test(text)) offenders.push(`${full}: new Function`);
    if (/\bexecSync\s*\(/.test(text)) offenders.push(`${full}: execSync`);
    // child_process `exec` only. A bare /\bexec\s*\(/ would match RegExp.exec.
    if (/import\s*\{[^}]*\bexec\b[^}]*\}\s*from\s*['"]node:child_process['"]/.test(text)) {
      offenders.push(`${full}: child_process exec`);
    }
    if (/require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*exec\b/.test(text)) {
      offenders.push(`${full}: child_process exec`);
    }
    if (/shell:\s*true/.test(text)) offenders.push(`${full}: shell true`);
    if (/child_process/.test(text) && !SUBPROCESS_REVIEWED.has(relFromTool(full))) {
      offenders.push(`${full}: child_process, not in the reviewed set`);
    }
  }
  assert.deepEqual(offenders, [], `dynamic execution constructs found: ${offenders.join('; ')}`);
});

test('ST-009 every reviewed subprocess caller uses fixed-argument execution with no shell', () => {
  const offenders = [];
  for (const full of toolSources()) {
    const text = readFileSync(full, 'utf8');
    if (!/child_process/.test(text)) continue;
    const rel = relFromTool(full);

    // A reviewed file must actually use the safe primitive, and only it.
    if (!/\bexecFileSync\s*\(/.test(text)) offenders.push(`${rel}: imports child_process without using execFileSync`);
    if (/\bspawn(Sync)?\s*\(/.test(text)) offenders.push(`${rel}: spawn`);
    if (/\bfork\s*\(/.test(text)) offenders.push(`${rel}: fork`);
    if (!/shell:\s*false/.test(text)) offenders.push(`${rel}: does not explicitly disable the shell`);
    if (!/import\s*\{\s*execFileSync\s*\}\s*from\s*'node:child_process'/.test(text)) {
      offenders.push(`${rel}: imports more than execFileSync from child_process`);
    }

    // The executable must be a literal, never a value derived from input.
    for (const m of text.matchAll(/execFileSync\s*\(\s*([^,]+),/g)) {
      const target = m[1].trim();
      const literal = /^'[A-Za-z0-9._-]+'$/.test(target) || target === 'process.execPath';
      if (!literal) offenders.push(`${rel}: executable is not a literal (${target.slice(0, 40)})`);
    }

    // A file that reaches git must validate refs before passing them.
    if (/execFileSync\s*\(\s*'git'/.test(text) && !/isSafeRef/.test(text)) {
      offenders.push(`${rel}: invokes git without ref validation`);
    }

    // No environment-derived command text.
    if (/execFileSync\s*\(\s*(process\.env|[A-Za-z_$][\w$]*\s*\?\?|`)/.test(text)) {
      offenders.push(`${rel}: executable may be environment-derived`);
    }
  }
  assert.deepEqual(offenders, [], `unsafe subprocess usage: ${offenders.join('; ')}`);
});

test('ST-009 the reviewed set is exact — no stale or speculative entry', () => {
  const importers = new Set(
    toolSources().filter((f) => /child_process/.test(readFileSync(f, 'utf8'))).map(relFromTool),
  );
  for (const name of SUBPROCESS_REVIEWED.keys()) {
    assert.ok(importers.has(name), `${name} is allowlisted but no longer imports child_process; remove it`);
  }
  for (const [, reason] of SUBPROCESS_REVIEWED) {
    assert.match(reason, /^SPEC-\d{4}/, 'every entry names the specification that reviewed it');
  }
});

test('ST-003 a pathological line does not cause catastrophic backtracking', async () => {
  const { allIds, declaredIds, qualifiedRefs, docRefs } = await import('../lib/markdown.mjs');
  const hostile = `${'a'.repeat(20000)}-${'0'.repeat(5000)} FR-001 ${'`'.repeat(5000)}`;
  const started = process.hrtime.bigint();
  allIds(hostile);
  declaredIds(hostile);
  qualifiedRefs(hostile);
  docRefs(hostile);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 2000, `parsing took ${ms.toFixed(0)}ms, which suggests backtracking`);
});

test('ST-004 artefact content is not echoed into findings', () => {
  const root = scratch();
  const canary = 'SYNTHETIC-CANARY-VALUE-abcdefghijklmnop';
  try {
    editFile(root, S2, 'spec.md', (t) => `${t}\nSample only: ${canary}\n- \`FR-001\` — duplicate to force a finding.\n`);
    const { stdout } = runJson(root);
    assert.ok(stdout.length > 0);
    assert.ok(!stdout.includes(canary), 'file content must never reach validator output');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ST-001 a traversing artefact path is reported without reading the target', () => {
  const root = scratch();
  const outside = path.join(root, 'outside-secret.txt');
  try {
    writeFileSync(outside, 'SYNTHETIC-OUTSIDE-CONTENT');
    editManifest(root, S1, (m) => { m.artifacts.spec = '../../outside-secret.txt'; });
    const { stdout, json } = runJson(root);
    assert.ok(rules(json).has('SDD-V008'));
    assert.ok(!stdout.includes('SYNTHETIC-OUTSIDE-CONTENT'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Regression ──────────────────────────────────────────────────────────────

function hashTree(dir) {
  const entries = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(`${path.relative(dir, full)}:${createHash('sha256').update(readFileSync(full)).digest('hex')}:${statSync(full).size}`);
    }
  };
  walk(dir);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

test('REG-001 the validator writes nothing', () => {
  const before = hashTree(VALID_ROOT);
  run(['validate', '--all', '--root', VALID_ROOT]);
  run(['validate', '--all', '--root', VALID_ROOT, '--format', 'json']);
  assert.equal(hashTree(VALID_ROOT), before, 'the validator must not modify any file');
});

// ── Repository self-check ───────────────────────────────────────────────────

test('IT-005/006 the repository own SDD artefacts validate cleanly', () => {
  const { code, json } = runJson(REPO_ROOT);
  assert.equal(json.errors, 0, `repository findings: ${JSON.stringify(json.findings, null, 2)}`);
  assert.equal(code, 0);
});

test('IT-004 diff-aware mode reports rather than guesses', () => {
  const out = run(['validate', '--changed', '--base', 'HEAD', '--root', REPO_ROOT, '--format', 'json']);
  assert.ok(out.code === 0 || out.code === 1);
  const json = JSON.parse(out.stdout);
  assert.ok(Array.isArray(json.notes));
  for (const f of json.findings) {
    if (f.ruleId === 'SDD-V041') assert.equal(f.severity, 'WARNING', 'change association is advisory during the transition');
  }
});

test('an invalid --base is refused as a tooling failure', () => {
  const out = run(['validate', '--changed', '--base', '--upload-pack=evil', '--root', REPO_ROOT]);
  assert.equal(out.code, 2);
});

// ── Convergence verdict parsing (SPEC-0002/TASK-014) ────────────────────────
//
// The parser previously prefix-matched, so `PASS WITH ACCEPTED LIMITATIONS`
// read back as `PASS` and the fact that limitations had been accepted was
// silently erased. Matching is now exact after whitespace normalisation.

const verdictOf = async (text) => {
  const { convergenceVerdict } = await import('../lib/traceability.mjs');
  return convergenceVerdict(text);
};
const row = (value) => `| Recommended verdict | \`${value}\` |`;

test('UT-018 PASS reads as PASS', async () => {
  assert.equal(await verdictOf(row('PASS')), 'PASS');
});

test('UT-019 PASS WITH ACCEPTED LIMITATIONS is not collapsed to PASS', async () => {
  const got = await verdictOf(row('PASS WITH ACCEPTED LIMITATIONS'));
  assert.equal(got, 'PASS WITH ACCEPTED LIMITATIONS');
  assert.notEqual(got, 'PASS', 'the prefix-match defect must not return');
});

test('UT-020 FAIL reads as FAIL', async () => {
  assert.equal(await verdictOf(row('FAIL')), 'FAIL');
});

test('UT-021 an unsupported value starting with a valid verdict is rejected', async () => {
  const { CONVERGENCE_VERDICTS } = await import('../lib/traceability.mjs');
  const got = await verdictOf(row('PASS SOMETHING ELSE'));
  assert.ok(!CONVERGENCE_VERDICTS.includes(got), 'must not be accepted as a verdict');
  assert.notEqual(got, 'PASS');
});

test('UT-022 a truncated verdict is rejected', async () => {
  const { CONVERGENCE_VERDICTS } = await import('../lib/traceability.mjs');
  const got = await verdictOf(row('PASS WITH ACCEPTED'));
  assert.ok(!CONVERGENCE_VERDICTS.includes(got));
});

test('UT-023 surrounding and repeated whitespace normalises', async () => {
  assert.equal(await verdictOf('| Recommended verdict |    PASS   WITH   ACCEPTED   LIMITATIONS   |'),
    'PASS WITH ACCEPTED LIMITATIONS');
  assert.equal(await verdictOf('   Verdict:   FAIL   '), 'FAIL');
  assert.equal(await verdictOf(row('  pass  ')), 'PASS', 'case is normalised');
});

test('UT-024 a verdict word embedded in prose is not read as the declaration', async () => {
  assert.equal(await verdictOf('The verdict was PASS in an earlier draft, before FAIL.'), null);
  assert.equal(await verdictOf('- `PASS` — every check passes; no `CONV-` finding is `OPEN`.'), null);
  assert.equal(await verdictOf('Recommended reading: PASS the report to QA.'), null);
});

test('UT-025 conflicting duplicate declarations are rejected, not silently resolved', async () => {
  const { AMBIGUOUS_VERDICT, CONVERGENCE_VERDICTS } = await import('../lib/traceability.mjs');
  const got = await verdictOf(`${row('PASS')}\n| Verdict | \`FAIL\` |`);
  assert.equal(got, AMBIGUOUS_VERDICT);
  assert.ok(!CONVERGENCE_VERDICTS.includes(got), 'ambiguity must fail the enum check');
  // Agreeing duplicates are not a conflict.
  assert.equal(await verdictOf(`${row('FAIL')}\nVerdict: FAIL`), 'FAIL');
});

/*
 * The original assertion pinned SPEC-0002's verdict to the literal string
 * `PASS WITH ACCEPTED LIMITATIONS`. That value legitimately changed when a
 * later convergence re-run moved the verdict, and the test failed for a reason
 * that had nothing to do with the parser — it was testing the document, not
 * the code.
 *
 * The invariant is what mattered all along: whatever verdict the document
 * declares must round-trip exactly, with no prefix collapse. Asserted here by
 * reading the declaration out of the document independently and requiring the
 * parser to agree, so the test still fails the moment prefix matching returns
 * and no longer fails when the verdict simply moves.
 */
test('UT-025 a real convergence document round-trips its verdict exactly', async () => {
  const { CONVERGENCE_VERDICTS } = await import('../lib/traceability.mjs');
  const file = path.join(REPO_ROOT, 'specs', 'SPEC-0002-agent-integration-controlled-execution', 'convergence.md');
  const text = readFileSync(file, 'utf8');

  // Read the declaration straight out of the metadata row, without the parser.
  const row = text.split('\n').find((l) => /^\|\s*Recommended verdict\s*\|/.test(l));
  assert.ok(row, 'the document must declare a verdict');
  const declared = row.split('|')[2].replace(/`/g, '').trim();

  const got = await verdictOf(text);
  assert.equal(got, declared, 'the parser must return exactly what the document declares');
  assert.ok(CONVERGENCE_VERDICTS.includes(got), 'and it must be a permitted verdict');

  // The regression that prompted this test: a multi-word verdict must never be
  // truncated to the shorter one it starts with.
  for (const verdict of CONVERGENCE_VERDICTS) {
    const round = await verdictOf(`| Recommended verdict | \`${verdict}\` |`);
    assert.equal(round, verdict, `${verdict} must not collapse`);
  }
});

// ── R3 specification approval (SPEC-0002/TASK-015) ──────────────────────────
//
// SDD-V059 enforces gate 1 at R3: a human specification approval by a Product
// Owner or Solution Architect. SDD-V060 checks ordering separately, so "the
// approval is missing" and "the approval came late" stay distinguishable.
//
// SDD-V020, the R4/R5 implementation-readiness gate, is a different gate and
// must remain untouched by all of this.

const S4 = 'SPEC-0004-approval-example';
const specApproval = (m) => m.approvals.find((a) => a.gate === 'specification');

test('UT-026 R3 with a Product Owner human specification approval passes', () => {
  const { code, json } = runJson(VALID_ROOT);
  assert.equal(code, 0);
  assert.ok(!rules(json).has('SDD-V059'));
  assert.ok(!rules(json).has('SDD-V060'));
});

test('UT-027 R3 with a Solution Architect human specification approval passes', () => {
  const root = scratch();
  try {
    editManifest(root, S4, (m) => { specApproval(m).role = 'Solution Architect'; });
    const { code, json } = runJson(root);
    assert.ok(!rules(json).has('SDD-V059'), 'Solution Architect is a permitted approver');
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-028 R3 in an implementation state with no specification approval is rejected', () => {
  expectRule((root) => editManifest(root, S4, (m) => {
    m.approvals = m.approvals.filter((a) => a.gate !== 'specification');
  }), 'SDD-V059');
});

test('UT-029 an ai actor cannot satisfy the R3 specification gate', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).actorType = 'ai'; }), 'SDD-V059');
});

test('UT-030 an unsupported approving role is rejected', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).role = 'Intern'; }), 'SDD-V059');
});

test('UT-031 an approval for another gate does not satisfy the specification gate', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).gate = 'architecture'; }), 'SDD-V059');
});

test('UT-032 an approval naming another specification does not satisfy this one', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).evidenceRef = 'approved under SPEC-0009'; }), 'SDD-V059');
});

test('UT-033 a malformed specification approval record is rejected', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).date = 'last Tuesday'; }), 'SDD-V059');
});

test('UT-034 R2 is unaffected by the R3 specification gate', () => {
  const root = scratch();
  try {
    // S2 is R2 and carries no specification approval at all.
    const { code, json } = runJson(root);
    assert.ok(!rules(json).has('SDD-V059'), 'R2 must not be caught by an R3 rule');
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-035 the R4/R5 implementation-readiness gate is unchanged', () => {
  // S3 is R4 IMPLEMENTING. Removing its implementation approval must still be
  // SDD-V020, and must not be re-reported as the R3 specification rule.
  expectRule(
    (root) => editManifest(root, S3, (m) => { m.approvals = m.approvals.filter((a) => a.gate !== 'implementation'); }),
    'SDD-V020',
    { notEmitted: ['SDD-V059'] },
  );
});

test('UT-035 SDD-V060 reports an approval dated after implementation began', () => {
  expectRule((root) => editManifest(root, S4, (m) => { specApproval(m).date = '2026-06-01'; }), 'SDD-V060');
});

test('UT-035 SDD-V060 reports rather than guesses when a date is missing', () => {
  expectRule((root) => editManifest(root, S4, (m) => {
    for (const step of m.statusHistory) delete step.date;
  }), 'SDD-V060');
});

test('UT-035 SDD-V059 and SDD-V060 are distinct concerns', async () => {
  const { RULES } = await import('../rules/rules.mjs');
  assert.ok(RULES['SDD-V059'] && RULES['SDD-V060']);
  assert.notEqual(RULES['SDD-V059'].title, RULES['SDD-V060'].title);
  assert.equal(RULES['SDD-V059'].severity, 'ERROR');
  assert.equal(RULES['SDD-V060'].severity, 'ERROR');
  // A missing approval is V059 only: ordering is not evaluated when there is
  // nothing valid to order.
  const root = scratch();
  try {
    editManifest(root, S4, (m) => { m.approvals = m.approvals.filter((a) => a.gate !== 'specification'); });
    const emitted = rules(runJson(root).json);
    assert.ok(emitted.has('SDD-V059'));
    assert.ok(!emitted.has('SDD-V060'), 'ordering is not reported when the approval is absent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Validation exceptions (SPEC-0002/TASK-017) ──────────────────────────────
//
// Synthetic throughout. SPEC-0002 is never the subject of these tests: a
// mechanism proven only on the case it was built for proves nothing.
//
// S4 is the R3 fixture. Dating its specification approval after its
// implementation transition makes it trip SDD-V060, which is the condition an
// exception is then asked to cover.

const LATE_APPROVAL = (m) => {
  m.approvals.find((a) => a.gate === 'specification').date = '2026-06-01';
};

const EXC_OK = {
  exceptionId: 'EXC-900',
  ruleId: 'SDD-V060',
  specId: 'SPEC-0004',
  status: 'APPROVED',
  decision: 'approved',
  actorType: 'human',
  approvingRole: 'Solution Architect',
  effectiveDate: '2026-09-08',
  expiry: null,
  expiryCondition: 'synthetic fixture',
  reason: 'synthetic fixture',
  compensatingControl: 'synthetic fixture',
};

/** Write an exception register into a scratch root. */
function writeExceptions(root, exceptions) {
  mkdirSync(path.join(root, 'docs', 'sdd'), { recursive: true });
  writeFileSync(
    path.join(root, 'docs', 'sdd', 'validation-exceptions.json'),
    `${JSON.stringify({ schemaVersion: 1, exceptions }, null, 2)}\n`,
  );
}

/** Findings for a scratch tree whose S4 has a late specification approval. */
function withLateApproval(exceptions) {
  const root = scratch();
  try {
    editManifest(root, S4, LATE_APPROVAL);
    if (exceptions) writeExceptions(root, exceptions);
    const { code, json } = runJson(root);
    const v060 = (json.findings ?? []).filter((f) => f.ruleId === 'SDD-V060');
    return { code, json, v060, ids: rules(json) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('UT-036 a correctly scoped approved exception downgrades the finding and keeps it visible', () => {
  const { code, v060, json } = withLateApproval([EXC_OK]);
  assert.equal(code, 0, 'an excepted finding must not block');
  assert.equal(json.errors, 0);
  assert.equal(v060.length, 1, 'the finding is downgraded, never deleted');
  assert.equal(v060[0].severity, 'INFO');
  assert.match(v060[0].message, /EXCEPTED under EXC-900/, 'the exception id must be visible');
  assert.match(v060[0].message, /dated after/, 'the original condition text is preserved');
});

test('UT-037 an exception for another rule does not suppress SDD-V060', () => {
  const { code, v060 } = withLateApproval([{ ...EXC_OK, ruleId: 'SDD-V059' }]);
  assert.equal(v060[0].severity, 'ERROR');
  assert.equal(code, 1);
});

test('UT-038 an exception for another specification does not suppress it', () => {
  const { code, v060 } = withLateApproval([{ ...EXC_OK, specId: 'SPEC-0003' }]);
  assert.equal(v060[0].severity, 'ERROR');
  assert.equal(code, 1);
});

test('UT-039 an unapproved exception suppresses nothing', () => {
  for (const status of ['PROPOSED', 'WITHDRAWN']) {
    const { code, v060 } = withLateApproval([{ ...EXC_OK, status }]);
    assert.equal(v060[0].severity, 'ERROR', `${status} must not suppress`);
    assert.equal(code, 1);
  }
});

test('UT-040 a malformed exception suppresses nothing and is reported', () => {
  const cases = [
    { ...EXC_OK, exceptionId: 'nope' },
    { ...EXC_OK, ruleId: 'SDD-V999' },
    { ...EXC_OK, specId: 'SPEC-*' },
    { ...EXC_OK, effectiveDate: 'soon' },
    { ...EXC_OK, expiry: null, expiryCondition: '' },
    { ...EXC_OK, reason: '' },
    { ...EXC_OK, compensatingControl: '' },
    'not an object',
  ];
  for (const bad of cases) {
    const { code, v060, ids } = withLateApproval([bad]);
    assert.equal(v060[0].severity, 'ERROR', `malformed exception must fail closed: ${JSON.stringify(bad).slice(0, 40)}`);
    assert.ok(ids.has('SDD-V061'), 'an unusable exception must be reported');
    assert.equal(code, 1);
  }
});

test('UT-041 an exception approved by the wrong role suppresses nothing', () => {
  for (const role of ['Product Owner', 'QA / Release Engineering', 'Intern', '']) {
    const { code, v060 } = withLateApproval([{ ...EXC_OK, approvingRole: role }]);
    assert.equal(v060[0].severity, 'ERROR', `${role || '(empty)'} must not be able to approve an exception`);
    assert.equal(code, 1);
  }
});

test('UT-042 an expired or inactive exception does not suppress', () => {
  const { code, v060, ids } = withLateApproval([{ ...EXC_OK, status: 'EXPIRED', expiry: '2026-01-01' }]);
  assert.equal(v060[0].severity, 'ERROR');
  assert.ok(!ids.has('SDD-V061'), 'a deliberately expired record is not a defect, just inoperative');
  assert.equal(code, 1);
});

test('UT-043 an exception to SDD-V060 does not suppress SDD-V059', () => {
  const root = scratch();
  try {
    // Both conditions at once: no specification approval at all, plus a
    // blanket-looking exception aimed at the ordering rule.
    editManifest(root, S4, (m) => { m.approvals = m.approvals.filter((a) => a.gate !== 'specification'); });
    writeExceptions(root, [EXC_OK]);
    const { code, json } = runJson(root);
    const v059 = (json.findings ?? []).filter((f) => f.ruleId === 'SDD-V059');
    assert.equal(v059.length, 1);
    assert.equal(v059[0].severity, 'ERROR', 'an exception to one rule must never cover another');
    assert.equal(code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-044 a future R3 specification with a late approval and no exception still FAILS', () => {
  const { code, v060, json } = withLateApproval(null);
  assert.equal(v060.length, 1);
  assert.equal(v060[0].severity, 'ERROR', 'SDD-V060 must remain enforced where no exception applies');
  assert.equal(json.result, 'FAIL');
  assert.equal(code, 1);
});

test('UT-045 an ai actor cannot approve an exception', () => {
  const { code, v060, ids } = withLateApproval([{ ...EXC_OK, actorType: 'ai' }]);
  assert.equal(v060[0].severity, 'ERROR');
  assert.ok(ids.has('SDD-V061'));
  assert.equal(code, 1);
});

test('UT-045 the mechanism contains no specification-specific branch', () => {
  const source = readFileSync(path.join(TOOL_ROOT, 'lib', 'exceptions.mjs'), 'utf8');
  assert.ok(!/SPEC-\d{4}/.test(source.replace(/SPEC-NNNN/g, '')), 'no hard-coded specification id may appear');
  assert.ok(!/EXC-\d{3}/.test(source.replace(/EXC-NNN/g, '')), 'no hard-coded exception id may appear');
});

// ── TASK-020 / CHG-008 — scope declarations, repository-wide ────────────────
//
// SDD-V062 refuses a malformed declaration at preflight, which protects new
// work. SDD-V064 makes the declarations already in the repository visible
// instead of leaving them to be found one session at a time
// (SPEC-0003/CONV-008 residual). WARNING, so historical debt is reported
// permanently rather than hidden behind an exception that would downgrade it
// to INFO.

/** Replace the Allowed scope line of the fixture's first task. */
const FIXTURE_A = '`src/components/SampleList.tsx`';
const FIXTURE_B = '`src/services/sampleExport.ts`';

const withScope = (allowed, prohibited = FIXTURE_B) => (root) =>
  editFile(root, S2, 'tasks.md', (t) =>
    // The fixture declares no prohibited paths, so the line is inserted rather
    // than replaced; a replace alone would silently be a no-op.
    t.replace(
      /\*\*Allowed scope:\*\*[^\n]*\n/,
      `**Allowed scope:** ${allowed}\n**Prohibited paths:** ${prohibited}\n`,
    ));

test('UT-068 a non-path identifier in a scope declaration is reported repository-wide', () => {
  expectRule(withScope(`${FIXTURE_A}, added by \`CHG-001\`, ${FIXTURE_B}.`), 'SDD-V064', { warningOnly: true });
});

test('UT-069 a glob in a scope declaration is reported repository-wide', () => {
  expectRule(withScope('`tools/sdd/tests/**`'), 'SDD-V064', { warningOnly: true });
});

test('UT-070 prose mixed into a declaration is reported, and so is a prose prohibition', () => {
  expectRule(withScope('evidence package only.'), 'SDD-V064', { warningOnly: true });
  expectRule(
    withScope(`${FIXTURE_A}.`, `${FIXTURE_B}, and the Playwright and Vitest configuration files`),
    'SDD-V064',
    { warningOnly: true },
  );
});

test('UT-071 a clean declaration emits nothing, and the rule never fails the run on its own', () => {
  const root = scratch();
  try {
    withScope(`${FIXTURE_A}, ${FIXTURE_B}.`)(root);
    const { code, json } = runJson(root);
    const emitted = rules(json);
    assert.ok(!emitted.has('SDD-V064'), 'a structured list is clean');
    assert.equal(code, 0, 'and the tree still validates');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Severity is deliberately WARNING: an ERROR would force either rewriting
  // historical DONE task records or minting an exception, and an exception
  // downgrades a finding to INFO — less visible than leaving it as a warning.
  const root2 = scratch();
  try {
    withScope('`tools/sdd/tests/**`')(root2);
    const { code, json } = runJson(root2);
    assert.equal(json.result, 'PASS', 'a malformed historical declaration is reported, not fatal');
    assert.equal(code, 0);
    const v064 = (json.findings ?? []).filter((f) => f.ruleId === 'SDD-V064');
    assert.ok(v064.length > 0);
    assert.equal(v064[0].severity, 'WARNING');
    assert.ok(/TASK-\d{3}/.test(v064[0].message), 'the finding names the task it belongs to');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});
