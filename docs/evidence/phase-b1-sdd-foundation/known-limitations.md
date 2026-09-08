# Phase B1 — known limitations

What Phase B1 deliberately did not do, and what must be tracked forward. None
of these prevents accepting the B1 foundation; several are prerequisites for
later stages.

## L-01 — The workflow has never been exercised

**Status:** by design. The B1 brief prohibits a pilot feature.
The process is internally consistent on paper. Whether it is workable in
practice — whether an R2 change really needs only "short" artefacts, whether
the clarification checklist finds the right ambiguities, whether convergence
catches anything traceability missed — is unknown until a real change runs
through it. That is Phase B2 or B3 work.
**Consequence:** the first pilot should be a genuine but low-risk change, and
the process should be revised from what actually went wrong rather than
defended.

## L-02 — No automation, no enforcement

Nothing checks that a specification exists, that identifiers are unique, that
traceability is complete, or that an approval was recorded. Every rule in
`docs/sdd/` is currently enforced by the reader.
**Consequence:** Phase B2 should add mechanical checks. Candidates, in
increasing order of cost: a link and identifier checker over `specs/`, a
pull-request template mirroring `AGENTS.md` §8 and the risk level, and a CI
step that fails when a spec directory is internally inconsistent. CI changes
were out of scope for B1.

## L-03 — `.gitattributes` deliberately not added

The cross-platform prerequisite from Phase A (GAP-AGENT-03, EVC-014) was
inspected, measured and **not remediated**, because the safe remedy is not a
documentation-only change.

**The problem, precisely.** Three unit specs fail on Windows and are expected
to pass on Linux CI:

| Spec | Failure | Cause |
|---|---|---|
| `apps/web/tests/unit/capture-vault.spec.ts` | 4 assertions | Path separator: the code produces `\` on Windows, the assertion expects `/` |
| `apps/web/tests/unit/env-example-parses.spec.ts` | 5 assertions | The line regex `^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$` does not match a trailing `\r`, so a CRLF working copy parses zero variables |
| `apps/web/tests/unit/observability.spec.ts` | 3 assertions | POSIX file mode `0o600` is unavailable on Windows, and a byte-comparison fails on CRLF |

**Why the obvious fix is unsafe right now.** Measured at commit `f16ed67`:

| Measurement | Value |
|---|---|
| Tracked files | 1,192 |
| Tracked files with an LF index copy and a CRLF working copy | 1,110 (93%) |
| `core.autocrlf` on this machine | `true` |
| `.gitattributes` | absent |

Adding `* text=auto eol=lf` would trigger renormalisation across almost the
whole repository, on top of an uncommitted UI redesign. The B1 brief
explicitly forbids adding `.gitattributes` where it "could immediately rewrite
or normalize existing tracked files without a controlled impact review". It
would.

**Recommended controlled remediation, for a later phase.** In this order, as
its own change, on a clean working tree:

1. Land or set aside the pending UI redesign so the tree is clean.
2. Add `.gitattributes` with `* text=auto eol=lf` in a commit that contains
   nothing else.
3. Run `git add --renormalize .` deliberately and review the resulting diff as
   a mechanical change.
4. Verify `git ls-files --eol` reports the intended state and that CI stays
   green.
5. Separately, make the three specs platform-tolerant: normalise separators in
   the capture-vault assertion, split on `/\r?\n/` in the env parser test, and
   guard the POSIX mode assertions. That is a **test change** and needs its
   own risk classification, which under `docs/RISK_CLASSIFICATION.md` is R2.

Phase B1 changed no test and no repository configuration. The item remains
open as GAP-AGENT-03 and EVC-014.

## L-04 — Phase A unknowns are unchanged

All 27 unknowns in `docs/evidence/phase-a-foundation/unknowns.snapshot.md`
remain open, including the eleven production-release blockers. B1 is a
process foundation and resolves none of them. In particular, backup execution
(EVC-005) and the active deployment mechanism (EVC-003) still require host
verification.

## L-05 — All 14 evidence conflicts remain open

Unchanged tally: 9 OPEN, 3 PARTIALLY RESOLVED, 2 ACCEPTED DIFFERENCE, 0
RESOLVED, including the one C4 (EVC-004, tenant isolation) and the one
release-blocking conflict (EVC-005, backups). B1 documents forbid a
specification from closing a conflict, so this will not change through SDD
work alone.

## L-06 — Approval roles are functional, not staffed

`docs/sdd/HUMAN_APPROVAL_GATES.md` defines six roles. Who holds each of them
is not recorded anywhere in the repository, deliberately: the brief forbids
inventing personal names. Until they are assigned, an R4 approval has no
identified approver.
**Consequence:** assigning the roles is a prerequisite before the first R4
change, not before B1 acceptance.

## L-07 — No specification exists yet

`SPEC-0001` is unallocated. The storage convention, templates and lifecycle
exist; nothing has been written into them. This is exactly what the brief
required, and it means the templates have never been stress-tested by a real
requirement.

## L-08 — ADR relationship left as-is

Two ADR directories exist (`docs/adr/`, `docs/ADRs/`) with duplicate numbering,
recorded in Phase A as EVC-013 and GAP-DOC-03. The SDD `AD-` identifier lives
inside a plan and is distinct from a repository-level ADR. B1 did not
reconcile the two conventions or move any file; deciding whether plan-level
`AD-` decisions should ever be promoted to a repository ADR is open.

## Evidence Sources

E1: `git ls-files --eol`, `git config --get core.autocrlf`, `git status`, and
the three named test files, read but not modified.
E4: `docs/PHASE_A_GAP_ANALYSIS.md`, `docs/EVIDENCE_CONFLICTS.md`,
`docs/evidence/phase-a-foundation/unknowns.snapshot.md`.
