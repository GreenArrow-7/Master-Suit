/**
 * Rule engine.
 *
 * Deterministic: same inputs, same findings, same order. No timestamps, no
 * randomness, no network, no writes (SPEC-0001/DATA-001, NFR-003).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { RULES, severityOf } from '../rules/rules.mjs';
import { loadExceptions, applyExceptions, EXCEPTIONS_FILE } from './exceptions.mjs';
import {
  discoverSpecDirs,
  listArtifactFilesOnDisk,
  KNOWN_ARTIFACT_FILES,
  safeResolve,
  isPlainFile,
} from './discover.mjs';
import { loadManifest, resolveArtifacts, SUPPORTED_SCHEMA_VERSION, ARTIFACT_KEYS } from './manifest.mjs';
import {
  isState,
  isRisk,
  isLegalTransition,
  requiredArtifacts,
  requiresImplementationApproval,
  IMPLEMENTATION_STATES,
} from './lifecycle.mjs';
import {
  humanApprovalFor,
  aiApprovalsOnHumanGates,
  malformedApprovals,
  specificationApprovalProblem,
  validSpecificationApprovals,
} from './approvals.mjs';
import { taskScope } from './agent.mjs';
import {
  allIds,
  declaredIds,
  qualifiedRefs,
  evcRefs,
  docRefs,
  metadataValue,
  toLines,
} from './markdown.mjs';
import {
  requirementIds,
  acceptanceIds,
  mentionedIdSet,
  securityRequirementsWithoutSecurityTest,
  tasksWithoutRationale,
  openConvergenceFindings,
  convergenceVerdict,
  AMBIGUOUS_VERDICT,
  openClarifications,
  CONVERGENCE_VERDICTS,
} from './traceability.mjs';

/** Artefacts reported by their own dedicated rule rather than by SDD-V009. */
const DEDICATED = { threatModel: 'SDD-V023', testPlan: 'SDD-V024', tasks: 'SDD-V025', convergence: 'SDD-V031' };

function finding(ruleId, { specId = null, artifact = null, message, line = null }) {
  if (!RULES[ruleId]) throw new Error(`unknown rule id: ${ruleId}`);
  return { ruleId, severity: severityOf(ruleId), specId, artifact, message, line };
}

function readIfPresent(absolute) {
  if (!absolute || !isPlainFile(absolute)) return null;
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

/** Evidence-conflict identifiers declared by the register. */
function knownEvcIds(repoRoot) {
  const file = path.join(repoRoot, 'docs', 'EVIDENCE_CONFLICTS.md');
  if (!isPlainFile(file)) return null;
  const ids = new Set();
  for (const line of toLines(readFileSync(file, 'utf8'))) {
    const m = /^#{2,4}\s+(EVC-\d{3})\b/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

function collectSpec(repoRoot, entry) {
  const findings = [];
  if (!entry.conforming) {
    findings.push(
      finding('SDD-V001', {
        specId: null,
        artifact: entry.name,
        message: 'Specification directory must be named SPEC-NNNN-short-slug',
      }),
    );
    return { findings, spec: null };
  }

  const loaded = loadManifest(entry.dir);
  if (!loaded.ok) {
    findings.push(finding('SDD-V004', { specId: entry.specId, artifact: 'sdd.json', message: loaded.error }));
    return { findings, spec: null };
  }
  const manifest = loaded.manifest;

  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    findings.push(
      finding('SDD-V005', {
        specId: entry.specId,
        artifact: 'sdd.json',
        message: `Unsupported manifest schemaVersion; expected ${SUPPORTED_SCHEMA_VERSION}`,
      }),
    );
  }
  if (manifest.specId !== entry.specId) {
    findings.push(
      finding('SDD-V002', {
        specId: entry.specId,
        artifact: 'sdd.json',
        message: `Manifest specId does not match the directory (${String(manifest.specId).slice(0, 40)})`,
      }),
    );
  }
  if (manifest.slug !== entry.slug) {
    findings.push(
      finding('SDD-V002', {
        specId: entry.specId,
        artifact: 'sdd.json',
        message: 'Manifest slug does not match the directory suffix',
      }),
    );
  }

  const risk = manifest.risk;
  const status = manifest.status;
  if (!isRisk(risk)) {
    findings.push(finding('SDD-V006', { specId: entry.specId, artifact: 'sdd.json', message: `Unknown risk level: ${String(risk).slice(0, 20)}` }));
  }
  if (!isState(status)) {
    findings.push(finding('SDD-V007', { specId: entry.specId, artifact: 'sdd.json', message: `Unknown lifecycle state: ${String(status).slice(0, 40)}` }));
  }
  if (risk === 'R0') {
    findings.push(finding('SDD-V039', { specId: entry.specId, artifact: 'sdd.json', message: 'R0 work must not have a specification directory' }));
  }

  const { resolved, unsafe, missing } = resolveArtifacts(entry.dir, manifest);
  for (const item of unsafe) {
    findings.push(finding('SDD-V008', { specId: entry.specId, artifact: 'sdd.json', message: `Artefact path for "${item.key}" escapes the specification directory or is not a safe relative path` }));
  }
  for (const item of missing) {
    findings.push(finding('SDD-V008', { specId: entry.specId, artifact: String(item.value).slice(0, 80), message: `Artefact declared for "${item.key}" does not exist as a regular file` }));
  }

  const onDisk = listArtifactFilesOnDisk(entry.dir);
  for (const file of onDisk) {
    const key = KNOWN_ARTIFACT_FILES[file];
    if (resolved[key] === null) {
      findings.push(finding('SDD-V010', { specId: entry.specId, artifact: file, message: `${file} exists on disk but the manifest declares "${key}" as null` }));
    }
  }

  const texts = {};
  for (const key of ARTIFACT_KEYS) texts[key] = readIfPresent(resolved[key]?.absolute ?? null);

  if (isRisk(risk) && isState(status)) {
    const required = requiredArtifacts(risk, status);
    for (const key of required) {
      if (resolved[key]) continue;
      const ruleId = DEDICATED[key] ?? 'SDD-V009';
      findings.push(finding(ruleId, { specId: entry.specId, artifact: `${key}`, message: `${risk} at ${status} requires the ${key} artefact` }));
    }
    if (risk === 'R1') {
      for (const key of ['plan', 'threatModel', 'testPlan', 'traceability', 'convergence']) {
        if (resolved[key]) {
          findings.push(finding('SDD-V038', { specId: entry.specId, artifact: key, message: `R1 is the lightweight model; ${key} is present but not expected` }));
        }
      }
    }
  }

  if (texts.spec) {
    const metaId = metadataValue(texts.spec, 'Specification ID');
    const metaRisk = metadataValue(texts.spec, 'Risk');
    const metaStatus = metadataValue(texts.spec, 'Status');
    if (metaId && metaId !== manifest.specId) {
      findings.push(finding('SDD-V011', { specId: entry.specId, artifact: 'spec.md', message: 'Specification ID in spec.md disagrees with the manifest' }));
    }
    if (metaRisk && metaRisk !== risk) {
      findings.push(finding('SDD-V012', { specId: entry.specId, artifact: 'spec.md', message: 'Risk in spec.md disagrees with the manifest' }));
    }
    if (metaStatus && metaStatus !== status) {
      findings.push(finding('SDD-V013', { specId: entry.specId, artifact: 'spec.md', message: 'Status in spec.md disagrees with the manifest' }));
    }
  }

  const history = Array.isArray(manifest.statusHistory) ? manifest.statusHistory : [];
  for (let i = 0; i < history.length; i += 1) {
    const step = history[i];
    const value = step && typeof step === 'object' ? step.status : undefined;
    if (!isState(value)) {
      findings.push(finding('SDD-V018', { specId: entry.specId, artifact: 'sdd.json', message: `statusHistory[${i}] is not a valid lifecycle state` }));
      continue;
    }
    if (i > 0) {
      const previous = history[i - 1]?.status;
      if (isState(previous) && !isLegalTransition(previous, value)) {
        findings.push(finding('SDD-V018', { specId: entry.specId, artifact: 'sdd.json', message: `Illegal lifecycle transition ${previous} to ${value}` }));
      }
    }
  }
  if (history.length === 0) {
    findings.push(finding('SDD-V019', { specId: entry.specId, artifact: 'sdd.json', message: 'statusHistory is empty; the current status has no recorded history' }));
  } else if (history[history.length - 1]?.status !== status) {
    findings.push(finding('SDD-V019', { specId: entry.specId, artifact: 'sdd.json', message: 'Current status does not equal the final statusHistory entry' }));
  }

  for (const bad of malformedApprovals(manifest)) {
    findings.push(finding('SDD-V021', { specId: entry.specId, artifact: 'sdd.json', message: `approvals[${bad.index}] is structurally incomplete or uses an unknown gate, actorType or decision` }));
  }
  for (const record of aiApprovalsOnHumanGates(manifest)) {
    findings.push(finding('SDD-V022', { specId: entry.specId, artifact: 'sdd.json', message: `Gate "${record.gate}" requires a human; an approval with actorType "ai" cannot satisfy it` }));
  }
  if (isRisk(risk) && isState(status) && requiresImplementationApproval(risk) && IMPLEMENTATION_STATES.has(status)) {
    if (!humanApprovalFor(manifest, 'implementation')) {
      findings.push(finding('SDD-V020', { specId: entry.specId, artifact: 'sdd.json', message: `${risk} at ${status} requires a human implementation approval before implementation begins` }));
    }
  }

  // Gate 1 at R3 (SPEC-0002/TASK-015, enforcing EVC-015 Option A). Separate
  // from the implementation-readiness gate above, which is R4/R5 only.
  if (risk === 'R3' && isState(status) && IMPLEMENTATION_STATES.has(status)) {
    const problem = specificationApprovalProblem(manifest, entry.specId);
    if (problem !== null) {
      findings.push(finding('SDD-V059', { specId: entry.specId, artifact: 'sdd.json', message: `R3 at ${status} requires a human specification approval: ${problem}` }));
    } else {
      // Ordering. Only reported where the recorded dates prove the gate was
      // crossed; where they cannot, that is said rather than guessed.
      const entered = history.find((step) => step && IMPLEMENTATION_STATES.has(step.status));
      const enteredOn = typeof entered?.date === 'string' ? entered.date : null;
      const approvals = validSpecificationApprovals(manifest, entry.specId);
      const earliest = approvals.map((r) => r.date).sort()[0] ?? null;
      if (enteredOn === null || earliest === null) {
        findings.push(finding('SDD-V060', { specId: entry.specId, artifact: 'sdd.json', message: 'Specification approval ordering cannot be established: the approval date or the implementation transition date is missing' }));
      } else if (earliest > enteredOn) {
        findings.push(finding('SDD-V060', { specId: entry.specId, artifact: 'sdd.json', message: `Specification approval is dated after the specification entered ${entered.status}; the gate was crossed before it was approved` }));
      }
    }
  }
  if (status === 'RELEASED' && !humanApprovalFor(manifest, 'release')) {
    findings.push(finding('SDD-V034', { specId: entry.specId, artifact: 'sdd.json', message: 'RELEASED requires a human release approval record' }));
  }

  if (isState(status) && IMPLEMENTATION_STATES.has(status)) {
    for (const id of openClarifications(texts.clarifications)) {
      findings.push(finding('SDD-V017', { specId: entry.specId, artifact: 'clarifications.md', message: `${id} is OPEN while the specification is at ${status}` }));
    }
  }

  const declarationsByArtifact = new Map();
  for (const key of ARTIFACT_KEYS) {
    if (!texts[key]) continue;
    const decls = declaredIds(texts[key]);
    declarationsByArtifact.set(key, decls);
    const seen = new Map();
    for (const decl of decls) {
      if (seen.has(decl.id)) {
        findings.push(finding('SDD-V014', { specId: entry.specId, artifact: resolved[key].relative, message: `${decl.id} is declared more than once`, line: decl.line }));
      } else {
        seen.set(decl.id, decl.line);
      }
    }
  }
  const owner = new Map();
  for (const [key, decls] of declarationsByArtifact) {
    for (const decl of new Set(decls.map((d) => d.id))) {
      if (owner.has(decl) && owner.get(decl) !== key) {
        findings.push(finding('SDD-V015', { specId: entry.specId, artifact: resolved[key].relative, message: `${decl} is declared in both ${owner.get(decl)} and ${key}` }));
      } else {
        owner.set(decl, key);
      }
    }
  }

  if (texts.changeRecord) {
    const chg = declaredIds(texts.changeRecord).filter((d) => d.prefix === 'CHG');
    const seen = new Set();
    for (const decl of chg) {
      if (seen.has(decl.id)) {
        findings.push(finding('SDD-V037', { specId: entry.specId, artifact: 'change-record.md', message: `${decl.id} is declared more than once`, line: decl.line }));
      }
      seen.add(decl.id);
    }
  }

  if (texts.spec) {
    const requirements = requirementIds(texts.spec);
    const testPlanIds = texts.testPlan ? mentionedIdSet(texts.testPlan) : new Set();
    const traceIds = texts.traceability ? mentionedIdSet(texts.traceability) : new Set();
    if (texts.testPlan) {
      for (const id of requirements) {
        if (!testPlanIds.has(id)) {
          findings.push(finding('SDD-V027', { specId: entry.specId, artifact: 'test-plan.md', message: `${id} has no test coverage in the test plan` }));
        }
      }
      for (const id of securityRequirementsWithoutSecurityTest(texts.spec, texts.testPlan)) {
        findings.push(finding('SDD-V028', { specId: entry.specId, artifact: 'test-plan.md', message: `${id} is a security requirement with no security test verifying it` }));
      }
    }
    if (texts.traceability || texts.testPlan) {
      const verified = new Set([...traceIds, ...testPlanIds]);
      for (const id of acceptanceIds(texts.spec)) {
        if (!verified.has(id)) {
          findings.push(finding('SDD-V029', { specId: entry.specId, artifact: 'traceability.md', message: `${id} has no verification mapping` }));
        }
      }
    }
  }

  if (texts.tasks) {
    for (const id of tasksWithoutRationale(texts.tasks)) {
      findings.push(finding('SDD-V026', { specId: entry.specId, artifact: 'tasks.md', message: `${id} cites neither a requirement nor an approved technical decision` }));
    }
    // Scope-declaration syntax, repository-wide. `SDD-V062` refuses a malformed
    // declaration at preflight, which protects new work; this makes the
    // declarations already in the repository visible instead of leaving them to
    // be discovered one session at a time (SPEC-0003/CONV-008, CHG-008).
    for (const id of [...new Set(declaredIds(texts.tasks).filter((d) => d.prefix === 'TASK').map((d) => d.id))]) {
      const scope = taskScope(texts.tasks, id);
      for (const problem of scope?.problems ?? []) {
        findings.push(finding('SDD-V064', { specId: entry.specId, artifact: 'tasks.md', message: `${id} — ${problem}` }));
      }
    }
  }

  if (texts.traceability) {
    // The traceability matrix is a set of references, not declarations, so it
    // must not vouch for its own identifiers. Excluding it is what lets
    // SDD-V030 catch a phantom reference at all.
    const known = new Set();
    for (const key of ARTIFACT_KEYS) {
      if (key === 'traceability') continue;
      if (!texts[key]) continue;
      for (const item of allIds(texts[key])) known.add(item.id);
    }
    const seenPhantom = new Set();
    for (const item of allIds(texts.traceability)) {
      if (known.has(item.id)) continue;
      if (seenPhantom.has(item.id)) continue;
      seenPhantom.add(item.id);
      findings.push(finding('SDD-V030', { specId: entry.specId, artifact: 'traceability.md', message: `${item.id} is referenced but is not declared anywhere in this specification`, line: item.line }));
    }
  }

  if (texts.convergence) {
    const open = openConvergenceFindings(texts.convergence);
    if (isState(status) && ['CONVERGED', 'READY_FOR_RELEASE', 'RELEASED'].includes(status) && open.length > 0) {
      for (const id of open) {
        findings.push(finding('SDD-V032', { specId: entry.specId, artifact: 'convergence.md', message: `${id} is OPEN while the specification is at ${status}` }));
      }
    }
    const verdict = convergenceVerdict(texts.convergence);
    if (verdict !== null && !CONVERGENCE_VERDICTS.includes(verdict)) {
      // The two cases are distinguished, but the offending text is never
      // echoed: artefact content must not reach validator output (ST-004).
      const message = verdict === AMBIGUOUS_VERDICT
        ? 'Two or more different convergence verdicts are declared; exactly one is permitted'
        : 'Convergence verdict is not one of the permitted values';
      findings.push(finding('SDD-V033', { specId: entry.specId, artifact: 'convergence.md', message }));
    }
  }

  const declaredPaths = new Set();
  if (texts.tasks) {
    for (const line of toLines(texts.tasks)) {
      const m = /`((?:apps|tools|docs|specs)\/[A-Za-z0-9._/-]{3,150})`/g;
      let hit;
      while ((hit = m.exec(line)) !== null) declaredPaths.add(hit[1]);
    }
  }

  return {
    findings,
    spec: {
      specId: entry.specId,
      dir: entry.dir,
      manifest,
      risk,
      status,
      texts,
      resolved,
      declaredPaths,
      ids: new Set(
        ARTIFACT_KEYS.flatMap((key) => (texts[key] ? allIds(texts[key]).map((i) => i.id) : [])),
      ),
    },
  };
}

function crossSpecChecks(repoRoot, specs) {
  const findings = [];
  const byId = new Map();
  for (const spec of specs) {
    if (!byId.has(spec.specId)) byId.set(spec.specId, []);
    byId.get(spec.specId).push(spec);
  }
  for (const [specId, group] of [...byId].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.length > 1) {
      findings.push(finding('SDD-V003', { specId, artifact: null, message: `${specId} is used by ${group.length} specification directories` }));
    }
  }

  const evcKnown = knownEvcIds(repoRoot);
  for (const spec of specs) {
    for (const key of ARTIFACT_KEYS) {
      const text = spec.texts[key];
      if (!text) continue;
      const artifactName = spec.resolved[key]?.relative ?? key;

      const reported = new Set();
      for (const ref of qualifiedRefs(text)) {
        if (reported.has(ref.ref)) continue;
        const target = byId.get(ref.specId);
        const resolvedRef = target && target.some((s) => s.ids.has(ref.localId));
        if (!resolvedRef) {
          reported.add(ref.ref);
          findings.push(finding('SDD-V016', { specId: spec.specId, artifact: artifactName, message: `Qualified reference ${ref.ref} does not resolve`, line: ref.line }));
        }
      }

      if (evcKnown) {
        const seen = new Set();
        for (const ref of evcRefs(text)) {
          if (seen.has(ref.id)) continue;
          seen.add(ref.id);
          if (!evcKnown.has(ref.id)) {
            findings.push(finding('SDD-V035', { specId: spec.specId, artifact: artifactName, message: `${ref.id} is not declared in docs/EVIDENCE_CONFLICTS.md`, line: ref.line }));
          }
        }
      }

      for (const line of toLines(text)) {
        if (/\bEVC-\d{3}\b[^|]{0,120}?\b(?:RESOLVED|is resolved|now resolved|marked resolved)\b/.test(line)) {
          findings.push(finding('SDD-V036', { specId: spec.specId, artifact: artifactName, message: 'A specification may cite an evidence conflict but must never mark one resolved' }));
          break;
        }
      }

      const seenDoc = new Set();
      for (const ref of docRefs(text)) {
        if (seenDoc.has(ref.path)) continue;
        seenDoc.add(ref.path);
        const fromRoot = safeResolve(repoRoot, ref.path);
        const fromSpec = safeResolve(spec.dir, ref.path);
        const found = (fromRoot && existsSync(fromRoot)) || (fromSpec && existsSync(fromSpec));
        if (!found) {
          findings.push(finding('SDD-V040', { specId: spec.specId, artifact: artifactName, message: `Referenced document ${ref.path} does not exist`, line: ref.line }));
        }
      }
    }
  }
  return findings;
}

function sortFindings(findings) {
  return findings.sort((a, b) => {
    const s = String(a.specId ?? '').localeCompare(String(b.specId ?? ''));
    if (s !== 0) return s;
    const r = a.ruleId.localeCompare(b.ruleId);
    if (r !== 0) return r;
    const art = String(a.artifact ?? '').localeCompare(String(b.artifact ?? ''));
    if (art !== 0) return art;
    return a.message.localeCompare(b.message);
  });
}

export function validate(repoRoot, config, options = {}) {
  const entries = discoverSpecDirs(repoRoot, config);
  if (options.specFilter && !entries.some((e) => e.specId === options.specFilter)) {
    const error = new Error(`no specification directory found for ${options.specFilter}`);
    error.configFailure = true;
    throw error;
  }

  const inScope = (specId) => !options.specFilter || specId === options.specFilter;

  /*
   * Every specification is collected even when the report is filtered to one,
   * because a qualified reference such as SPEC-0001/TH-005 can only resolve
   * against the specification that owns it. Filtering the *input* made
   * SDD-V016 fire on references that were perfectly valid.
   */
  let findings = [];
  const specs = [];
  const reported = [];
  for (const entry of entries) {
    const result = collectSpec(repoRoot, entry);
    if (inScope(entry.specId)) findings = findings.concat(result.findings);
    if (result.spec) {
      specs.push(result.spec);
      if (inScope(result.spec.specId)) reported.push(result.spec);
    }
  }
  findings = findings.concat(crossSpecChecks(repoRoot, specs).filter((f) => inScope(f.specId)));

  /*
   * Approved exceptions are applied last, to findings that already exist.
   * A covered ERROR becomes INFO and keeps its rule id and its message, so the
   * condition stays visible; it is never removed. An unusable exception record
   * suppresses nothing and is reported, so the register fails closed.
   */
  const register = loadExceptions(repoRoot);
  for (const problem of register.problems) {
    findings.push(
      finding('SDD-V061', {
        specId: null,
        artifact: EXCEPTIONS_FILE.split(path.sep).join('/'),
        message: `Exception ${problem.exceptionId ?? '(unidentified)'} cannot be applied: ${problem.problem}`,
      }),
    );
  }
  const applied = applyExceptions(findings, register.active);

  return { findings: sortFindings(applied.findings), specs: reported, excepted: applied.excepted };
}

export function summarise(findings) {
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;
  return { errors, warnings, result: errors > 0 ? 'FAIL' : 'PASS' };
}
