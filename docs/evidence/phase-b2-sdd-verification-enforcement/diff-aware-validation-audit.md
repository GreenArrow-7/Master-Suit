# Diff-aware validation audit

## What was built

```bash
node tools/sdd/cli.mjs validate --changed --base <ref> [--head <ref>]
```

Lists tracked files changed against a git range, selects those under the
configured `applicationPaths`, and reports whether each is associated with a
declared specification.

## Association is deliberately narrow

A file counts as associated only when a task artefact names that exact path
in backticks. Nothing is inferred from directory proximity, naming, commit
message or timing.

This produces more UNKNOWNs than a heuristic would, which is the point. A
guessed mapping is worse than no mapping, because it looks authoritative:
a reviewer trusting a wrong association skips the check that would have
caught the problem. Where association cannot be established, the tool says
so.

## Failure behaviour

| Condition | Behaviour |
|---|---|
| git unavailable, or the range cannot be resolved | A note: "UNKNOWN: the git range could not be resolved". No finding is invented |
| `--base` missing or unsafe | Exit 2, a tooling failure, never a silent pass |
| Application file with no association | `SDD-V041`, WARNING during the transition |
| More than 50 unassociated files | First 50 listed, remainder counted in a note. No silent truncation |

## Safety

git is invoked through `execFileSync` with a fixed argument array,
`shell: false`, a 20-second timeout and a bounded buffer. The base reference
must match `^[A-Za-z0-9._/-]{1,100}$` and must not begin with `-`, so an
argument such as `--upload-pack=…` is refused. A test asserts exit 2 for that
input.

Only tracked files are listed. Untracked working-tree files, including the
uncommitted UI redesign, are never read by this mode.

## Observed against this repository

```text
$ node tools/sdd/cli.mjs validate --changed --base HEAD --format json
result=PASS  errors=0  warnings=34
Changed tracked files: 34; application files: 34; associated: 0.
```

The 34 files are the pre-existing UI redesign. Every finding is
`SDD-V041` at WARNING, the run exits 0, and the result is PASS. **Pre-SDD work
is reported, not failed**, which is the property the transition policy exists
to guarantee.

## Advisory during the transition

`SDD-V041` is a WARNING. `enforcementMode` in `sdd.config.json` is
`ADVISORY`. The repository contains substantial pre-SDD application work, and
making this blocking today would fail that work for existing. The conditions
for promotion are in `transition-policy-audit.md`.

`validate --all`, the form the proposed CI workflow runs, does not perform
change association at all, so CI adoption cannot accidentally make this rule
blocking.

## Evidence Sources

E1: `tools/sdd/lib/diff.mjs`, `tools/sdd/cli.mjs`, `sdd.config.json`.
E3: the `IT-004` and invalid-`--base` tests.
