# Subprocess allowlist security review

**Task:** `TASK-011` · **Session:** `ASES-0002` · **Date:** 2026-09-07
**Resolves:** `CONV-006` · **Raised under:** `CHG-001`

## What was wrong

`ST-002` permitted `child_process` in two files, named individually. B3 added
two more legitimate callers, so the test went red. The code was safe; the
allowlist was stale, and it authorised **by file name alone** — a name in the
list would have sheltered an unsafe implementation added later.

## Required properties, checked before allowlisting anything

Each caller was read and verified against all six. Allowlisting on the
strength of the file name was explicitly forbidden by the task.

| # | Property | `lib/agent.mjs` | `tests/agent.test.mjs` |
|---|---|---|---|
| 1 | Fixed argument-array execution (`execFileSync`), not `exec`/`execSync`/`spawn` | yes | yes |
| 2 | Shell explicitly disabled | `shell: false` | `shell: false` |
| 3 | Executable is a fixed literal | `'git'` | `process.execPath` |
| 4 | Untrusted input cannot become command text | yes — see below | yes, arguments are test literals |
| 5 | Git ref input validated before use | `isSafeRef` before every call | not applicable, no ref |
| 6 | No environment-derived command execution | yes | yes |

### Property 4 in detail

`agent.mjs` funnels every git call through one private helper that takes a
fixed argument array. Three call sites supply it:

| Call site | Arguments | Variable part |
|---|---|---|
| `gitChangedFiles` | `['diff', '--name-only', '--no-renames', base]` | `base` |
| `gitStatusPaths` | `['status', '--porcelain']` | none |
| `gitHead` | `['rev-parse', 'HEAD']` | none |

`base` is the only value reaching git from outside, and `isSafeRef` screens it
first: `^[A-Za-z0-9._/-]{1,100}$` with a leading dash rejected. That excludes
`--upload-pack=`, whitespace, semicolons, backticks and command substitution.
Because there is no shell, a hostile ref could at worst become an argument,
and the dash rule stops it becoming an option.

Hardening already present and confirmed: `cwd` pinned to the repository root,
20-second timeout, 8 MiB output cap, `stdin` closed and `stderr` discarded,
and every failure returning `null` so the caller reports UNKNOWN rather than
assuming an empty result.

## What changed in the test

The allowlist is now a map of file to the specification that reviewed it, and
**membership authorises nothing on its own**. Two new checks run against every
file that imports `child_process`, reviewed or not:

- it must use `execFileSync`, and must not use `spawn`, `spawnSync` or `fork`;
- it must declare `shell: false`;
- it must import nothing from `child_process` except `execFileSync`;
- every `execFileSync` target must be a string literal or `process.execPath`;
- any file reaching `git` must reference `isSafeRef`;
- the target must not be environment-derived.

A third check keeps the list honest in the other direction: an entry whose
file no longer imports `child_process` fails the test, so the allowlist cannot
accumulate stale permissions.

The universal prohibitions are unchanged and still apply to every file with no
exemption: `eval`, `new Function`, `execSync`, `child_process` `exec`, and
`shell: true`.

### One correction during the work

The first version of the universal `exec` check used `/\bexec\s*\(/`, which
matched `RegExp.prototype.exec` in five unrelated files. It was narrowed to
match only an `exec` imported from `child_process`, or `require(...).exec`.
The check was made precise, not removed.

## The allowlist is stricter than before

| | Before | After |
|---|---|---|
| Authorises by | file name | file name **and** six verified properties |
| Entries carry a reason | no | yes, naming the reviewing specification |
| Stale entries detected | no | yes |
| `spawn` / `fork` prohibited | no | yes |
| Explicit `shell: false` required | no | yes |
| Literal executable required | no | yes |
| Ref validation required for git callers | no | yes |

## Verification

`ST-002` passes. `ST-009` passes, in two parts. The B2 suite is **56 of 56**,
having grown from 54 by the two `ST-009` tests.

The predicates were then probed against twelve synthetic cases to confirm they
are not vacuous. All eleven hostile patterns were caught; the one benign case,
a `RegExp.exec` call, was correctly ignored.

| Probe | Caught |
|---|---|
| `shell: true` | yes |
| `child_process` `exec` import | yes |
| `execSync` | yes |
| `require('child_process').exec` | yes |
| `spawn` alongside a safe call | yes |
| Non-literal executable | yes |
| Environment-derived executable | yes |
| git invoked without ref validation | yes |
| Shell not explicitly disabled | yes |
| `eval` | yes |
| `new Function` | yes |
| `RegExp.exec` (benign) | correctly ignored |

## Scope discipline

`ASES-0002` declared `tools/sdd/tests/validator.test.mjs` as its only allowed
path, with `tools/sdd/lib/agent.mjs` and `tools/sdd/lib/diff.mjs` **prohibited**.

That is deliberate. The session reviewing the callers could not edit the
callers, so it could not make a caller pass by changing the caller. Only the
test moved.

## Residual limitations

- The checks are **textual**, not semantic. They read source with regular
  expressions rather than parsing it, so a sufficiently unusual formatting of
  a hostile call could evade them. They raise the cost of an unsafe change and
  do not make one impossible.
- `git` is resolved through `PATH`, and the child inherits the parent
  environment including any `GIT_*` variables. A compromised environment can
  therefore influence what runs. This is the pre-existing baseline shared with
  `tools/sdd/lib/diff.mjs`; B3 introduces no new exposure, and it is not
  closed here.
- The allowlist records **that** a review happened, not its quality. This
  review was performed by an AI and accepted by nobody. Application Security
  has not reviewed it.
