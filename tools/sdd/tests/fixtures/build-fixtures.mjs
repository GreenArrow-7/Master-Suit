#!/usr/bin/env node
/**
 * Materialises the three canonical VALID fixture specifications.
 *
 * Run once to (re)create `fixtures/valid/specs/`. The generated files are
 * committed and inspectable; this script exists so they can be regenerated
 * consistently if the contract changes.
 *
 * Invalid fixtures are not generated here. They are produced at test time by
 * mutating a copy of this valid tree in a temporary directory, so that each
 * invalid case differs from a known-good baseline by exactly one defect.
 *
 * All content is synthetic. No real credentials, no production data.
 *
 *   node tools/sdd/tests/fixtures/build-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'valid', 'specs');

function spec(dirName, files) {
  const dir = path.join(ROOT, dirName);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const text = Array.isArray(body) ? `${body.join('\n')}\n` : body;
    writeFileSync(path.join(dir, name), text);
  }
}

const manifest = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// ── SPEC-0001 · R1 lightweight ──────────────────────────────────────────────
spec('SPEC-0001-lightweight-example', {
  'sdd.json': manifest({
    schemaVersion: 1,
    specId: 'SPEC-0001',
    slug: 'lightweight-example',
    kind: 'change',
    risk: 'R1',
    status: 'IMPLEMENTING',
    artifacts: {
      spec: 'spec.md',
      clarifications: null,
      plan: null,
      threatModel: null,
      testPlan: null,
      tasks: null,
      traceability: null,
      convergence: null,
      changeRecord: null,
    },
    statusHistory: [
      { status: 'DRAFT', date: '2026-01-01' },
      { status: 'READY_FOR_PLAN', date: '2026-01-02' },
      { status: 'PLANNED', date: '2026-01-03' },
      { status: 'READY_FOR_APPROVAL', date: '2026-01-04' },
      { status: 'APPROVED_FOR_IMPLEMENTATION', date: '2026-01-05' },
      { status: 'IMPLEMENTING', date: '2026-01-06' },
    ],
    approvals: [
      { gate: 'specification', role: 'Product Owner', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-04' },
    ],
    reviews: [],
    evidenceConflicts: [],
  }),
  'spec.md': [
    '# SPEC-0001 — Lightweight example',
    '',
    'Synthetic fixture for validator tests. Sample content only.',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Specification ID | `SPEC-0001` |',
    '| Risk | `R1` |',
    '| Status | `IMPLEMENTING` |',
    '',
    '## Problem',
    '',
    'A label reads incorrectly on a sample screen.',
    '',
    '## Scope',
    '',
    'The label text only.',
    '',
    '## Out of scope',
    '',
    'Everything else.',
    '',
    '## Acceptance criteria',
    '',
    '- `AC-001` — The label reads correctly.',
  ],
});

// ── SPEC-0002 · R2 normal, converged ────────────────────────────────────────
spec('SPEC-0002-normal-example', {
  'sdd.json': manifest({
    schemaVersion: 1,
    specId: 'SPEC-0002',
    slug: 'normal-example',
    kind: 'change',
    risk: 'R2',
    status: 'CONVERGED',
    artifacts: {
      spec: 'spec.md',
      clarifications: null,
      plan: 'plan.md',
      threatModel: null,
      testPlan: 'test-plan.md',
      tasks: 'tasks.md',
      traceability: 'traceability.md',
      convergence: 'convergence.md',
      changeRecord: null,
    },
    statusHistory: [
      { status: 'DRAFT', date: '2026-01-01' },
      { status: 'READY_FOR_PLAN', date: '2026-01-02' },
      { status: 'PLANNED', date: '2026-01-03' },
      { status: 'READY_FOR_APPROVAL', date: '2026-01-04' },
      { status: 'APPROVED_FOR_IMPLEMENTATION', date: '2026-01-05' },
      { status: 'IMPLEMENTING', date: '2026-01-06' },
      { status: 'VERIFYING', date: '2026-01-07' },
      { status: 'CONVERGED', date: '2026-01-08' },
    ],
    approvals: [
      { gate: 'specification', role: 'Product Owner', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-04' },
    ],
    reviews: [
      { type: 'code-review', role: 'Engineering Reviewer', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-07' },
    ],
    evidenceConflicts: [],
  }),
  'spec.md': [
    '# SPEC-0002 — Normal example',
    '',
    'Synthetic fixture for validator tests. Sample content only.',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Specification ID | `SPEC-0002` |',
    '| Risk | `R2` |',
    '| Status | `CONVERGED` |',
    '',
    '## Functional requirements',
    '',
    '- `FR-001` — A sample list must show ten rows per page.',
    '',
    '## Acceptance criteria',
    '',
    '- `AC-001` — Ten rows are shown on the first page.',
  ],
  'plan.md': [
    '# SPEC-0002 — Plan',
    '',
    '## Technical decisions',
    '',
    '### AD-001',
    '',
    '**Decision:** Reuse the existing paging helper.',
    '**Requirements supported:** `FR-001`.',
  ],
  'test-plan.md': [
    '# SPEC-0002 — Test plan',
    '',
    '| Test | Requirement | Purpose |',
    '|---|---|---|',
    '| `UT-001` | `FR-001` | Ten rows are returned |',
    '| `IT-001` | `AC-001` | The first page shows ten rows |',
  ],
  'tasks.md': [
    '# SPEC-0002 — Tasks',
    '',
    '## TASK-001',
    '',
    '**Purpose:** Set the page size.',
    '**Requirements:** `FR-001`.',
    '**Allowed scope:** the sample list component.',
    '**Status:** `DONE`',
  ],
  'traceability.md': [
    '# SPEC-0002 — Traceability',
    '',
    '| Requirement | Task | Test | Result |',
    '|---|---|---|---|',
    '| `FR-001` | `TASK-001` | `UT-001` | pass |',
    '| `AC-001` | `TASK-001` | `IT-001` | pass |',
  ],
  'convergence.md': [
    '# SPEC-0002 — Convergence',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Recommended verdict | PASS |',
    '',
    'No findings were raised.',
  ],
});

// ── SPEC-0003 · R4 security-sensitive ───────────────────────────────────────
spec('SPEC-0003-security-example', {
  'sdd.json': manifest({
    schemaVersion: 1,
    specId: 'SPEC-0003',
    slug: 'security-example',
    kind: 'change',
    risk: 'R4',
    status: 'IMPLEMENTING',
    artifacts: {
      spec: 'spec.md',
      clarifications: 'clarifications.md',
      plan: 'plan.md',
      threatModel: 'threat-model.md',
      testPlan: 'test-plan.md',
      tasks: 'tasks.md',
      traceability: 'traceability.md',
      convergence: null,
      changeRecord: null,
    },
    statusHistory: [
      { status: 'DRAFT', date: '2026-01-01' },
      { status: 'CLARIFYING', date: '2026-01-02' },
      { status: 'READY_FOR_PLAN', date: '2026-01-03' },
      { status: 'PLANNED', date: '2026-01-04' },
      { status: 'READY_FOR_APPROVAL', date: '2026-01-05' },
      { status: 'APPROVED_FOR_IMPLEMENTATION', date: '2026-01-06' },
      { status: 'IMPLEMENTING', date: '2026-01-07' },
    ],
    approvals: [
      { gate: 'specification', role: 'Product Owner', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-05' },
      { gate: 'security', role: 'Application Security', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-06' },
      { gate: 'implementation', role: 'Application Security', actorType: 'human', decision: 'approved', evidenceRef: 'sample', date: '2026-01-06' },
    ],
    reviews: [],
    evidenceConflicts: [],
  }),
  'spec.md': [
    '# SPEC-0003 — Security example',
    '',
    'Synthetic fixture for validator tests. Sample content only.',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Specification ID | `SPEC-0003` |',
    '| Risk | `R4` |',
    '| Status | `IMPLEMENTING` |',
    '',
    '## Functional requirements',
    '',
    '- `FR-001` — A sample export must include only permitted rows.',
    '',
    '## Security requirements',
    '',
    '- `SEC-001` — A caller outside the owning group must receive no rows.',
    '',
    '## Acceptance criteria',
    '',
    '- `AC-001` — An outside caller sees no rows.',
  ],
  'clarifications.md': [
    '# SPEC-0003 — Clarifications',
    '',
    '## CL-001',
    '',
    '**Question:** Which scope governs the export?',
    '**Decision:** The existing group scope.',
    '**Decision owner:** Solution Architect',
    '**Status:** `INCORPORATED`',
    '**Affected requirements:** `SEC-001`',
  ],
  'plan.md': [
    '# SPEC-0003 — Plan',
    '',
    '## Technical decisions',
    '',
    '### AD-001',
    '',
    '**Decision:** Reuse the existing scope resolver.',
    '**Requirements supported:** `SEC-001`.',
  ],
  'threat-model.md': [
    '# SPEC-0003 — Threat model',
    '',
    '## Threats',
    '',
    '### TH-001',
    '',
    '**Threat:** A caller outside the group reads rows.',
    '**Required controls:** `CTRL-001`',
    '**Verification:** `ST-001`',
    '**Status:** `MITIGATED`',
    '',
    '## Controls',
    '',
    '### CTRL-001',
    '',
    '**Control:** Apply the existing scope filter.',
    '**Requirements supported:** `SEC-001`',
    '**Verification:** `ST-001`',
  ],
  'test-plan.md': [
    '# SPEC-0003 — Test plan',
    '',
    '| Test | Requirement | Purpose |',
    '|---|---|---|',
    '| `UT-001` | `FR-001` | Permitted rows are returned |',
    '| `ST-001` | `SEC-001` | An outside caller receives no rows |',
    '| `IT-001` | `AC-001` | End-to-end check |',
  ],
  'tasks.md': [
    '# SPEC-0003 — Tasks',
    '',
    '## TASK-001',
    '',
    '**Purpose:** Apply the scope filter to the export.',
    '**Requirements:** `FR-001`, `SEC-001`.',
    '**Allowed scope:** the sample export service.',
    '**Status:** `DONE`',
  ],
  'traceability.md': [
    '# SPEC-0003 — Traceability',
    '',
    '| Requirement | Task | Test | Result |',
    '|---|---|---|---|',
    '| `FR-001` | `TASK-001` | `UT-001` | pass |',
    '| `SEC-001` | `TASK-001` | `ST-001` | pass |',
    '| `AC-001` | `TASK-001` | `IT-001` | pass |',
    '',
    '| Threat | Control | Test |',
    '|---|---|---|',
    '| `TH-001` | `CTRL-001` | `ST-001` |',
  ],
});

process.stdout.write('valid fixtures written\n');
