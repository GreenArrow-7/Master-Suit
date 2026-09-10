# Security re-review after remediation

**Phase:** B3 convergence · **Date:** 2026-09-07
**Covers:** `TASK-011` (`ASES-0002`) and `TASK-012` (`ASES-0003`)
**Reviewer:** AI, Security Reviewer role. **Not an Application Security risk
acceptance.** That gate is unresolved and nothing here changes it.

This re-review supplements `security-review.md`; it does not replace it.

## 1. `child_process` allowlist handling

The allowlist was the defect. It authorised by file name, so a name in the
list would have covered any implementation later placed in that file.

It now carries a reason per entry naming the reviewing specification, and
membership grants nothing by itself: `ST-009` verifies six properties on every
file that imports `child_process`, listed or not. A third check fails the
suite if an entry no longer imports `child_process`, so permissions cannot
silently accumulate.

Newly prohibited across the whole tool: `spawn`, `spawnSync`, `fork`, an
implicit shell, a non-literal executable, and importing anything from
`child_process` other than `execFileSync`.

**Assessment:** stricter than before. The check is textual, so it raises the
cost of an unsafe change rather than making one impossible.

## 2. Git invocation

Unchanged in substance and re-verified. One private helper, `execFileSync`,
fixed argument array, `shell: false`, executable the literal `'git'`, `cwd`
pinned to the repository root, 20-second timeout, 8 MiB cap, stdin closed,
stderr discarded, every failure returning `null` so the caller reports UNKNOWN.

`gitStatusPaths` gained rename parsing, which is new parsing of git output.
It splits on the literal `" -> "` and strips surrounding quotes. A path
containing that sequence would be split incorrectly, producing two paths
rather than one. The consequence is over-reporting — more paths judged against
scope, not fewer — which fails in the safe direction. Recorded as a
limitation, not a defect.

## 3. Ref validation

`isSafeRef` is unchanged: `^[A-Za-z0-9._/-]{1,100}$`, leading dash rejected,
applied before any ref reaches git. `UT-144` covers an upload-pack style
argument. `ST-009` now additionally fails any file that invokes git without
referencing `isSafeRef` at all, so a future caller cannot quietly skip it.

`--base` became optional on `scope-check`. When absent, only the working tree
is examined. When present it is still validated, and an unresolvable range is
reported as UNKNOWN rather than treated as empty.

## 4. Initial-state and session-delta handling

The new attribution path is the largest change and got the most attention.

| Concern | Behaviour |
|---|---|
| Digest algorithm | SHA-256 over file bytes |
| A path already dirty, untouched since | `PRE_EXISTING`, not judged |
| A path already dirty, modified again by the session | `SESSION`, judged — the case naive subtraction gets wrong |
| Created, deleted | `SESSION`, via the digest-to-null transition |
| No digest recorded | `UNATTRIBUTED`, `SDD-V052` warning |
| Directory entry | `UNATTRIBUTED` |

The directory case was found during this re-review and fixed inside the task.
git collapses an untracked directory into one status entry, so a change to a
file beneath it does not alter the entry. Digesting a directory returned
`null`, which compared equal to the recorded `null` and would have classified
the whole tree as `PRE_EXISTING` — a silent pass over arbitrary content. It
now returns an explicit directory marker and classifies as `UNATTRIBUTED`.
`UT-017` covers it.

**Every ambiguous case resolves to "review required", never to "safe".**

## 5. Path traversal, normalisation, symlinks

Unchanged and re-verified. `unsafeScopeReason` still rejects empty and
over-long paths, null bytes, absolute paths, drive letters, traversal
segments, paths resolving outside the repository, and symlinks whose real path
escapes.

`fileDigest` resolves through `safeResolve`, so a hostile path in a session
record cannot read outside the repository. It strips a trailing separator
before resolving, and `UT-017` asserts a trailing separator does not defeat
the directory check. `lstat` is used rather than `stat`, so a symlink is
never followed into a digest.

`normalisePath` handles both separator styles; `UT-016` asserts attribution is
stable across them and that a record written with Windows separators still
matches a POSIX-form query.

## 6. Repository drift

Unchanged. `SDD-V052` remains a `WARNING`, asserted by `UT-148` so a later
edit cannot quietly promote it. Drift is reported and never repaired; nothing
in this pass added a code path that writes to a drifted file.

## 7. TOCTOU

Honestly stated rather than claimed solved.

Digests are captured at session start and compared at check time. Everything
between those two moments is invisible: a file changed and changed back
reads as `PRE_EXISTING`, and a check reflects the tree as it was when the
check ran, not as it will be a second later.

This is inherent to a snapshot comparison over a mutable working tree. The
tool reports on a moment. It is not a monitor, and nothing here should be read
as one.

The same applies to `preflight`. Authorisation is evaluated once; the
repository can change immediately afterwards. `scope-check` is what catches
the result, after the fact.

## 8. Forged session state — the most important limitation here

**A session record is an ordinary file in the repository, and an agent that
can write code can write that file.**

An agent could add its own changed paths to `initialChangedPaths` with their
current digests, and every one of them would classify as `PRE_EXISTING` and
escape the scope check. Nothing in the tool prevents this. The digest makes
attribution *decidable*; it does not make the record *trustworthy*.

This is the same class of limitation B2 already recorded for approval records:
the artefact proves a claim was made, not that the claim is true. Real
assurance comes from commit authorship, code review and branch protection —
from outside this tool.

`SDD-V052` narrows the gap slightly: a record with no digests cannot silently
pass, it produces warnings. It does nothing against a record with fabricated
digests.

Recorded as a carried-forward limitation. Not closed, and not closeable from
inside the repository.

## 9. Environment

Unchanged and unclosed. `git` is resolved through `PATH` and the child
inherits the parent environment including any `GIT_*` variables, so a
compromised environment can influence what runs. This is the pre-existing
baseline shared with `tools/sdd/lib/diff.mjs`. B3 introduces no new exposure.

## Findings

No new security defect remains open in the B3 code. One was found and fixed
during this re-review: the collapsed-directory digest described in §4.

Four residual limitations, all recorded and none accepted by a human:

1. Forged session state — a record is only as trustworthy as the commit
   containing it (§8).
2. Textual rather than semantic security checks (§1).
3. TOCTOU: the tool reports on a moment (§7).
4. `PATH` and `GIT_*` inheritance (§9).

## Verdict

The remediation holds. Both defects are closed, the allowlist is stricter than
before, and attribution fails safe in every ambiguous case.

**This review accepts no residual risk.** Application Security has not
reviewed this phase, and the security gate on `SPEC-0002` remains
`UNRESOLVED`.

---

## Recheck — governance closure pass, 2026-09-07

**No control-plane code changed in this pass**, so nothing above is
superseded. Verified by comparing every watched file against the hash recorded
in `phase-b3-files.txt` at the previous review: `tools/sdd/lib/agent.mjs`,
`tools/sdd/cli.mjs`, `tools/sdd/lib/validate.mjs`, `tools/sdd/rules/rules.mjs`,
both test suites, and the three schemas are byte-identical.

The pass changed evidence documents, the decision table, `EVC-015` and the
convergence findings' statuses. None of those is executable.

The security areas listed for recheck therefore carry their previous
assessments unchanged: subprocess invocation, git ref validation, shell
execution, path traversal, separator normalisation, symlink escape,
digest and session attribution, scope bypass, repository drift, forged
`actorType`, forged review record, forged approval record, secret leakage,
unsafe JSON, and unsafe subprocess arguments.

**CI trust boundary: not applicable.** `.github/workflows/sdd-validate.yml` was
not modified, because the required DevOps authorisation does not exist. It is
`D6`.

The four residual limitations stand and none is accepted by a human: forged
session state, textual rather than semantic checks, TOCTOU, and `PATH` /
`GIT_*` inheritance.

---

## Exception mechanism review — 2026-09-08

`tools/sdd/lib/exceptions.mjs` can downgrade an ERROR, so it was reviewed as a
control-bypass surface rather than as a convenience.

| Concern | Finding |
|---|---|
| Hard-coded specification bypass | **None.** `UT-045` asserts no `SPEC-NNNN` or `EXC-NNN` literal appears in the module |
| Wildcard or broad scope | Rejected. `specId` must match `^SPEC-\d{4}$`; `SPEC-*` fails (`UT-040`) |
| Forged exception record | Eight malformed shapes each fail closed and are reported as `SDD-V061` (`UT-040`) |
| `actorType: "ai"` approval | Rejected (`UT-045`) |
| Wrong-role approval | Only Solution Architect or Application Security; Product Owner, QA, Intern and empty all rejected (`UT-041`) |
| Cross-spec reuse | Exact `specId` match only (`UT-038`) |
| Rule-id confusion | Exact `ruleId` match, and the id must exist in the catalogue (`UT-037`, `UT-040`) |
| Cross-rule leakage | An exception to `SDD-V060` does not touch `SDD-V059` (`UT-043`) |
| Expired handling | `EXPIRED`, `WITHDRAWN` and `PROPOSED` all suppress nothing (`UT-039`, `UT-042`) |
| Malicious `evidenceRef` | Never parsed, never resolved as a path, never echoed into a finding |
| Silent suppression | Impossible by construction: a covered finding is downgraded to `INFO` with its rule id, message and the exception id intact |
| Parser ambiguity | JSON only, size-bounded at 64 KiB, must contain an `exceptions` array; anything else is reported |

**Fails closed throughout.** Every rejection path leaves the original `ERROR`
standing. There is no code path in which an unusable exception results in a
quieter output than no exception at all.

**Determinism preserved.** Expiry is enforced by `status`, not by comparing a
date to the clock, because the validator must not read the current time
(`NFR-003`). The cost is that a lapsed exception stays active until a human
flips its status — which is rule 8 of the standard, and is now a dependency on
human review rather than on the tool. Recorded rather than glossed.

**What it still cannot do.** Prove that the Solution Architect named in
`EXC-001` approved anything. The record is a structured claim, checked for
shape and role, in a file anyone who can commit can write. Same limitation as
every approval record in this system, and unchanged by this work.

### Residual limitations

1. An exception is only as trustworthy as the commit containing it.
2. A lapsed exception does not self-expire; a human must act.
3. The register is a second source of truth alongside the markdown; nothing
   checks that the two agree.
