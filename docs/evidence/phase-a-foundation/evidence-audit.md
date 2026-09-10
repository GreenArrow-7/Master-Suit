# Evidence-quality audit

Audit of the 26 Phase A documents against the YOUHAN ONE formal evidence
standard. Executed at commit `f16ed67`.

## Deliverable completeness

**VERIFIED — 26 of 26 expected files present.** Inventory with byte counts
and SHA-256 digests: `phase-a-files.txt`. Directory structure matches the
Phase A specification exactly: two root files, `docs/SYSTEM_INVENTORY.md`,
`docs/architecture/` (6), `docs/security/` (5), `docs/operations/` (5),
`docs/standards/` (4), plus `docs/PHASE_A_GAP_ANALYSIS.md`,
`docs/RISK_CLASSIFICATION.md` and `docs/EVIDENCE_CONFLICTS.md`.

## AGENTS.md — constitution consistency

**VERIFIED.** 11 sections: the one rule, engineering behaviour, spec-driven
development, security, database, testing, dependencies, production,
definition of done, where to look. Every topic the Phase A brief requires is
present; four were located under different wording than the brief's phrasing
and are quoted here so the check is reproducible:

| Required topic | Located as |
|---|---|
| minimal scoped changes | "Prefer the smallest scoped change that solves the stated problem" (§1.3) |
| do not rewrite unrelated code | "Do not rewrite, reformat, rename or 'clean up' unrelated code in the same change" (§1.3) |
| no credentials in logs | "No credentials, tokens, session cookies or personal data in logs, test output, screenshots, PR descriptions or agent transcripts" (§3) |
| no disabling security tooling | "never disable a security tool, lint rule, type check or test to make a build pass" (§3, wrapped across two lines) |

The SDD chain is stated verbatim, and §7 enumerates what an agent may never
authorise. §8 lists eleven Definition-of-Done items. The closing line states
that nothing in the file authorises an agent to approve a production release.

## CLAUDE.md — complementarity

**VERIFIED.** Seven sections, 78 lines, scoped to how Claude operates rather
than what the system is. It names `AGENTS.md` as governing in its first
sentence and states that `AGENTS.md` wins on conflict. It covers all twelve
behaviours the brief requires.

**Duplication check:** a line-level intersection of the two files, ignoring
blanks and short fragments, returned **zero shared sentences over 25
characters**. The two documents overlap in subject but not in text.

## Evidence Sources sections

**VERIFIED — 23 of 23 applicable documents carry one.** The three without are
`AGENTS.md` and `CLAUDE.md` (normative instruction documents, not
evidence-derived descriptions) and `docs/EVIDENCE_CONFLICTS.md` (a register
that cites evidence inline per conflict, per the standard's own format).

## Claim classification

Counts across the Phase A set: VERIFIED 35, TESTED 21, DOCUMENTED 14,
INFERRED 12, UNKNOWN 26. Evidence-level citations: E1 249, E2 140, E3 53,
E4 64, E5 1, E6 12.

Spot checks confirming the classification is load-bearing rather than
decorative:

- Tenant isolation is VERIFIED from `src/lib/db.ts` and the migrations, and
  separately TESTED from `tests/tenant/*`; the two are not merged into a
  claim of assurance.
- Idempotency and `If-Match` are DOCUMENTED only, with the code path
  explicitly not located (EVC-008).
- Production topology, backup execution and alert delivery are UNKNOWN.
- Worker concurrency beyond `maintenance` is INFERRED.

## Required UNKNOWN phrasing

The exact string `UNKNOWN — requires runtime/infrastructure verification`
appears 8 times; the production-specific variant
`UNKNOWN — requires production/infrastructure verification` appears twice in
`operations/BACKUP_RESTORE.md`, where the fact concerns the production host
rather than general runtime; `UNKNOWN — requires verification` appears twice
for repository-answerable questions that Phase A did not exhaust
(geocoding provider, public-form abuse controls). All three forms are
permitted by the standard. Full list: `unknowns.snapshot.md`.

## Findings raised and resolved during this audit

| ID | Finding | Action |
|---|---|---|
| EQ-01 | Subjective-language scan across all 26 files returned one hit, "guarantees" in `RISK_CLASSIFICATION.md`, used as "asserts new security or operational guarantees" | False positive, no change |
| EQ-02 | Claims of the form "engineering quality is high" | **Not present in any Phase A document.** Such phrasing appeared only in a conversational summary, not in the deliverables. No document asserts a quality judgement about the codebase |
| EQ-03 | Package presence versus active use | Handled: `dependency-change-check.md` states the caveat explicitly, and documents cite the importing module when asserting use |
| EQ-04 | Tests treated as full assurance | Not found. `SYSTEM_INVENTORY.md` and the security documents keep TESTED separate from VERIFIED throughout |
| EQ-05 | `operations/OBSERVABILITY.md` said "None. No Sentry/OTel/Datadog dependency or exporter exists" — an unqualified negative claim | **Corrected.** Rewritten to state what was inspected, and to mark host-installed agents as `UNKNOWN — requires runtime/infrastructure verification` |
| EQ-06 | `standards/ERROR_HANDLING.md` implied all user-facing failures avoid a bare `Error` | **Corrected.** Now says this held in the paths inspected and was not audited across all 173 route files |
| EQ-07 | Negative-claim scan flagged 25 further lines | Reviewed individually. All are either normative imperatives in `AGENTS.md`/`CLAUDE.md` ("never bypass…"), repository facts verifiable by listing ("there is no root `package.json`"), or claims attributed to a cited source. No further change |
| EQ-08 | Repository config presented as production truth | Not found. `operations/DEPLOYMENT.md`, `ENVIRONMENTS.md` and `SYSTEM_OVERVIEW.md` each state that repository configuration is not proof of the live deployment |
| EQ-09 | Current state mixed with recommendations | Not found. Five documents carry an explicit "Recommended future standard (not current)" heading; the rest contain no recommendations |
| EQ-10 | Legacy code presented as active | Not found. `prisma/schema.pre-unified.prisma`, `prisma/legacy-migrations/` and `infrastructure/postgres/*.sql` are each labelled `Legacy / potentially inactive` in three documents |
| EQ-11 | Unresolved conflicts disappearing from summaries | Not found. All 14 EVC ids are cross-referenced from at least one other document; the release-blocking conflict appears in the gap analysis, the backup document and the acceptance record |

Corrections EQ-05 and EQ-06 edited Phase A output only. No pre-existing file
was touched.

## Security-observation qualification

**VERIFIED.** Thirteen observations. Ten carry an explicit exploitability
status: Possible ×4, Unverified ×3, Not exploitable based on current evidence
×2, UNKNOWN ×1. The three without are SEC-OBS-009 (an accepted risk already
recorded by the project as finding F-03), SEC-OBS-012 and SEC-OBS-013, which
are informational. **No observation is written as a confirmed
vulnerability.** No exploit path, payload or reproduction step appears
anywhere in the Phase A set.

## Traceability

Every architecture, security and operations document cites file paths and,
where useful, symbol names rather than line numbers, so references survive
edits. An engineer can trace each material statement to a named repository
artefact.

## Evidence Sources

E1: the 26 Phase A documents; `git status`; filesystem inventory.
E2: `apps/web/package.json`, `infra/**`, `.github/workflows/**`.
Method: keyword and pattern scans over the Phase A set, line-level
intersection between `AGENTS.md` and `CLAUDE.md`, and manual review of every
flagged line.
