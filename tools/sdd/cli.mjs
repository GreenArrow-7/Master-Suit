#!/usr/bin/env node
/**
 * SDD validator command line.
 *
 *   node tools/sdd/cli.mjs validate --all
 *   node tools/sdd/cli.mjs validate --spec SPEC-0001
 *   node tools/sdd/cli.mjs validate --all --format json
 *   node tools/sdd/cli.mjs validate --changed --base <ref>
 *
 * Exit codes: 0 clean, 1 validation failure, 2 tooling or configuration
 * failure. See docs/sdd/VALIDATION_RULES.md.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/discover.mjs';
import { validate, summarise } from './lib/validate.mjs';
import { changedFiles, associateChanges, isSafeRef } from './lib/diff.mjs';
import { RULES, severityOf } from './rules/rules.mjs';
import * as agent from './lib/agent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const EXIT_OK = 0;
const EXIT_VALIDATION = 1;
const EXIT_TOOLING = 2;

function parseArgs(argv) {
  const args = {
    command: null, sub: null, all: false, spec: null, format: 'text', strict: false,
    changed: false, base: null, head: null, root: null, role: null, task: [], session: null, actor: null,
  };
  const rest = argv.slice(2);
  if (rest.length === 0) return args;
  args.command = rest[0];
  let start = 1;
  if (args.command === 'agent') {
    args.sub = rest[1] ?? null;
    start = 2;
  }
  for (let i = start; i < rest.length; i += 1) {
    const token = rest[i];
    switch (token) {
      case '--role':
        args.role = rest[++i] ?? null;
        break;
      case '--task':
        if (rest[i + 1]) args.task.push(rest[++i]);
        break;
      case '--session':
        args.session = rest[++i] ?? null;
        break;
      case '--actor':
        args.actor = rest[++i] ?? null;
        break;
      case '--all':
        args.all = true;
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--changed':
        args.changed = true;
        break;
      case '--spec':
        args.spec = rest[++i] ?? null;
        break;
      case '--format':
        args.format = rest[++i] ?? 'text';
        break;
      case '--base':
        args.base = rest[++i] ?? null;
        break;
      case '--head':
        args.head = rest[++i] ?? null;
        break;
      case '--root':
        args.root = rest[++i] ?? null;
        break;
      default:
        if (token.startsWith('-')) throw Object.assign(new Error(`unknown option: ${token}`), { configFailure: true });
    }
  }
  return args;
}

function usage() {
  return [
    'SDD validator',
    '',
    'Usage:',
    '  node tools/sdd/cli.mjs validate --all [--format text|json] [--strict]',
    '  node tools/sdd/cli.mjs validate --spec SPEC-NNNN [--format text|json]',
    '  node tools/sdd/cli.mjs validate --changed --base <ref> [--head <ref>]',
    '  node tools/sdd/cli.mjs rules [--format text|json]',
    '',
    'Agent control plane:',
    '  node tools/sdd/cli.mjs agent preflight --spec SPEC-NNNN --role ROLE [--task TASK-NNN]',
    '  node tools/sdd/cli.mjs agent create-session --spec SPEC-NNNN --role ROLE --task TASK-NNN [--actor id]',
    '  node tools/sdd/cli.mjs agent scope-check --spec SPEC-NNNN --session ASES-NNNN --base <ref>',
    '  node tools/sdd/cli.mjs agent verify-session --spec SPEC-NNNN [--session ASES-NNNN]',
    '  node tools/sdd/cli.mjs agent review-check --spec SPEC-NNNN',
    '',
    'Roles: PLANNER IMPLEMENTER TESTER SECURITY_REVIEWER QA_REVIEWER',
    '       CONVERGENCE_REVIEWER ARCHITECTURE_REVIEWER',
    '',
    'Exit codes: 0 clean, 1 validation failure, 2 tooling failure.',
  ].join('\n');
}

function renderText(findings, summary, extra) {
  const lines = [];
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of findings) {
      const where = [f.specId, f.artifact].filter(Boolean).join(' · ');
      const at = f.line ? `:${f.line}` : '';
      lines.push(`${f.severity.padEnd(7)} ${f.ruleId}  ${where}${at}`);
      lines.push(`        ${f.message}`);
    }
    lines.push('');
  }
  for (const note of extra ?? []) lines.push(note);
  if ((extra ?? []).length > 0) lines.push('');
  lines.push(`result=${summary.result}  errors=${summary.errors}  warnings=${summary.warnings}`);
  return lines.join('\n');
}

function renderJson(findings, summary, extra) {
  return JSON.stringify(
    {
      version: 1,
      result: summary.result,
      errors: summary.errors,
      warnings: summary.warnings,
      findings: findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        specId: f.specId,
        artifact: f.artifact,
        message: f.message,
        line: f.line,
      })),
      notes: extra ?? [],
    },
    null,
    2,
  );
}

const AGENT_SUBS = ['preflight', 'create-session', 'close-session', 'scope-check', 'verify-session', 'review-check'];

/**
 * Agent control plane. Every subcommand reports; none repairs a governance
 * artefact, and `create-session` refuses to write when preflight fails
 * (SPEC-0002/CL-004, FR-003).
 */
function runAgent(args) {
  if (!AGENT_SUBS.includes(args.sub)) {
    process.stderr.write(`unknown agent subcommand: ${args.sub ?? '(none)'}\n\n${usage()}\n`);
    return EXIT_TOOLING;
  }
  if (args.format !== 'text' && args.format !== 'json') {
    process.stderr.write(`unknown format: ${args.format}\n`);
    return EXIT_TOOLING;
  }
  if (!args.spec) {
    process.stderr.write('agent commands require --spec SPEC-NNNN\n');
    return EXIT_TOOLING;
  }

  const repoRoot = args.root ? path.resolve(args.root) : REPO_ROOT;
  let config;
  let result;
  try {
    config = loadConfig(repoRoot);
    result = validate(repoRoot, config, { specFilter: args.spec });
  } catch (err) {
    process.stderr.write(`validator failure: ${err.message}\n`);
    return EXIT_TOOLING;
  }
  const spec = result.specs.find((s) => s.specId === args.spec);
  if (!spec) {
    process.stderr.write(`specification ${args.spec} could not be loaded\n`);
    return EXIT_TOOLING;
  }

  // A blocking structural error means no agent action is authorised at all.
  const blocking = result.findings.filter((f) => f.severity === 'ERROR');
  const findings = [...blocking];
  const notes = [];
  if (blocking.length > 0) notes.push(`${blocking.length} blocking SDD validation error(s); no agent action is authorised until they are fixed.`);

  const records = agent.listRecords(spec.dir);

  if (args.sub === 'preflight' || args.sub === 'create-session') {
    if (!args.role) {
      process.stderr.write('--role is required\n');
      return EXIT_TOOLING;
    }
    const taskId = args.task[0] ?? null;
    findings.push(...agent.preflight(repoRoot, spec, { role: args.role, taskId }));

    if (args.sub === 'create-session') {
      const errors = findings.filter((f) => f.severity === 'ERROR');
      if (errors.length > 0) {
        notes.push('Session NOT created: preflight failed. Creating a session never authorises implementation.');
      } else if (args.task.length === 0) {
        process.stderr.write('--task is required to create a session\n');
        return EXIT_TOOLING;
      } else {
        const next = `ASES-${String(records.sessions.length + 1).padStart(4, '0')}`;
        const session = agent.buildSession(repoRoot, spec, { sessionId: next, role: args.role, taskIds: args.task, actorId: args.actor });
        const file = agent.writeSession(spec.dir, session);
        notes.push(`Session ${next} created at ${path.relative(repoRoot, file).split(path.sep).join('/')}.`);
      }
    }
  }

  if (args.sub === 'close-session') {
    if (!args.session) { process.stderr.write('--session is required\n'); return EXIT_TOOLING; }
    const entry = records.sessions.find((s) => s.id === args.session);
    if (!entry) { process.stderr.write(`session ${args.session} not found\n`); return EXIT_TOOLING; }
    if (!entry.ok) {
      findings.push(agent.finding('SDD-V047', { specId: spec.specId, artifact: entry.file, message: entry.error }));
    } else if (agent.hasFinalEvidence(entry.data)) {
      // End-state evidence is written once. Recapturing it later would let a
      // closed session silently absorb whatever happened since.
      notes.push(`${entry.id} already carries end-state evidence; it was not recaptured.`);
    } else {
      const paths = agent.gitStatusPaths(repoRoot);
      if (paths === null) {
        notes.push('UNKNOWN: git status could not be read, so no end-state evidence was captured.');
      } else {
        const updated = { ...entry.data, finalChangedPaths: paths, finalDigests: agent.captureFinalState(repoRoot, paths) };
        const file = agent.writeSession(spec.dir, updated);
        notes.push(`End-state evidence captured for ${entry.id} over ${paths.length} path(s): ${file}`);
      }
    }
  }

  if (args.sub === 'scope-check') {
    if (!args.session) { process.stderr.write('--session is required\n'); return EXIT_TOOLING; }
    if (args.base && !agent.isSafeRef(args.base)) { process.stderr.write('--base must be a safe git ref\n'); return EXIT_TOOLING; }
    const entry = records.sessions.find((s) => s.id === args.session);
    if (!entry) { process.stderr.write(`session ${args.session} not found\n`); return EXIT_TOOLING; }
    if (!entry.ok) {
      findings.push(agent.finding('SDD-V047', { specId: spec.specId, artifact: entry.file, message: entry.error }));
    } else {
      findings.push(...agent.sessionFindings(spec, entry.data, entry.id));

      // Scope is judged on what this session introduced, not on everything
      // currently dirty (SPEC-0002/CONV-007, TASK-012).
      let extra = [];
      if (args.base) {
        const ranged = agent.gitChangedFiles(repoRoot, args.base);
        if (ranged === null) notes.push(`UNKNOWN: the git range ${args.base} could not be resolved; only the working tree was examined.`);
        else extra = ranged;
      }
      const delta = agent.sessionDelta(repoRoot, entry.data, extra);
      if (delta.evidenceMissing) {
        notes.push(
          `LIMITED: ${entry.id} is ${entry.data.status} and recorded no end-state evidence, so its scope cannot be`
          + ' re-evaluated. Nothing is attributed to it. Its result at the time it ran stands.',
        );
        findings.push(...agent.historicalEvidenceFindings(spec, entry.data, delta));
      } else if (!delta.statusAvailable) {
        notes.push('UNKNOWN: git status could not be read, so attribution was not evaluated.');
      } else {
        if (delta.historical) {
          notes.push(`${entry.id} is ${entry.data.status}; evaluated against its own recorded end state, not the current working tree.`);
        }
        notes.push(
          `Attribution — session ${delta.session.length}`
          + ` · pre-existing and untouched ${delta.preExisting.length}`
          + ` · unattributed ${delta.unattributed.length}.`,
        );
        if (delta.preExisting.length > 0) {
          notes.push(`${delta.preExisting.length} path(s) were already changed before this session and are unchanged since; they are not attributed to it.`);
        }
        findings.push(...agent.scopeFindings(repoRoot, spec, entry.data, delta.session));
        findings.push(...agent.attributionFindings(spec, delta));
        if (delta.unattributed.length > 25) {
          notes.push(`${delta.unattributed.length - 25} further unattributed path(s) were not listed.`);
        }
      }
      findings.push(...agent.driftFindings(repoRoot, spec, entry.data));
    }
  }

  if (args.sub === 'verify-session') {
    for (const entry of records.sessions) {
      if (args.session && entry.id !== args.session) continue;
      if (!entry.ok) { findings.push(agent.finding('SDD-V047', { specId: spec.specId, artifact: entry.file, message: entry.error })); continue; }
      findings.push(...agent.sessionFindings(spec, entry.data, entry.id));
    }
    for (const entry of records.verifications) {
      if (!entry.ok) { findings.push(agent.finding('SDD-V049', { specId: spec.specId, artifact: entry.file, message: entry.error })); continue; }
      findings.push(...agent.verificationFindings(spec, entry.data, entry.id));
    }
    notes.push(`Sessions ${records.sessions.length}; verification records ${records.verifications.length}.`);
  }

  if (args.sub === 'review-check') {
    for (const entry of records.reviews) {
      if (!entry.ok) { findings.push(agent.finding('SDD-V050', { specId: spec.specId, artifact: entry.file, message: entry.error })); continue; }
      findings.push(...agent.reviewFindings(spec, entry.data, entry.id, records.sessions));
    }
    notes.push(`Review records ${records.reviews.length}.`);
  }

  const ordered = findings.sort((a, b) => {
    const r = a.ruleId.localeCompare(b.ruleId);
    if (r !== 0) return r;
    const art = String(a.artifact ?? '').localeCompare(String(b.artifact ?? ''));
    if (art !== 0) return art;
    return a.message.localeCompare(b.message);
  });
  const summary = summarise(ordered);
  const output = args.format === 'json' ? renderJson(ordered, summary, notes) : renderText(ordered, summary, notes);
  process.stdout.write(`${output}\n`);
  return summary.errors > 0 ? EXIT_VALIDATION : EXIT_OK;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return EXIT_TOOLING;
  }

  if (!args.command || args.command === 'help' || args.command === '--help') {
    process.stdout.write(`${usage()}\n`);
    return EXIT_OK;
  }

  if (args.command === 'rules') {
    if (args.format === 'json') {
      process.stdout.write(`${JSON.stringify({ version: 1, rules: RULES }, null, 2)}\n`);
    } else {
      for (const [id, rule] of Object.entries(RULES)) {
        process.stdout.write(`${id}  ${rule.severity.padEnd(7)} ${rule.title}\n`);
      }
    }
    return EXIT_OK;
  }

  if (args.command === 'agent') return runAgent(args);

  if (args.command !== 'validate') {
    process.stderr.write(`unknown command: ${args.command}\n\n${usage()}\n`);
    return EXIT_TOOLING;
  }
  if (args.format !== 'text' && args.format !== 'json') {
    process.stderr.write(`unknown format: ${args.format}\n`);
    return EXIT_TOOLING;
  }
  if (!args.all && !args.spec && !args.changed) {
    process.stderr.write(`validate requires --all, --spec or --changed\n\n${usage()}\n`);
    return EXIT_TOOLING;
  }

  const repoRoot = args.root ? path.resolve(args.root) : REPO_ROOT;

  let config;
  let result;
  try {
    config = loadConfig(repoRoot);
    result = validate(repoRoot, config, { specFilter: args.spec });
  } catch (err) {
    process.stderr.write(`validator failure: ${err.message}\n`);
    return EXIT_TOOLING;
  }

  let findings = result.findings;
  const notes = [];

  if (args.changed) {
    if (!args.base || !isSafeRef(args.base)) {
      process.stderr.write('--changed requires a valid --base <ref>\n');
      return EXIT_TOOLING;
    }
    const files = changedFiles(repoRoot, args.base, args.head);
    if (files === null) {
      notes.push('UNKNOWN: the git range could not be resolved, so change association was not evaluated.');
    } else {
      const { appFiles, associated, unassociated } = associateChanges(files, result.specs, config.applicationPaths ?? []);
      notes.push(`Changed tracked files: ${files.length}; application files: ${appFiles.length}; associated: ${associated.length}.`);
      if (unassociated.length > 0) {
        const mode = config.enforcementMode === 'ENFORCED' ? 'ERROR' : severityOf('SDD-V041');
        for (const file of unassociated.slice(0, 50)) {
          findings.push({
            ruleId: 'SDD-V041',
            severity: mode,
            specId: null,
            artifact: file,
            message: 'Changed application file is not associated with a declared specification',
            line: null,
          });
        }
        if (unassociated.length > 50) notes.push(`${unassociated.length - 50} further unassociated files were not listed.`);
      }
    }
  }

  if (args.strict) {
    findings = findings.map((f) => (f.severity === 'WARNING' ? { ...f, severity: 'ERROR' } : f));
  }

  const summary = summarise(findings);
  const output = args.format === 'json' ? renderJson(findings, summary, notes) : renderText(findings, summary, notes);
  process.stdout.write(`${output}\n`);
  return summary.errors > 0 ? EXIT_VALIDATION : EXIT_OK;
}

process.exitCode = main();
