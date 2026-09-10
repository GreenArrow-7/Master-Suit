# Scope enforcement audit

**Phase:** B3 · **Specification:** `SPEC-0002` · **Date:** 2026-09-07

## Where scope comes from

From the approved task, not from the agent. `taskScope` reads the
`**Allowed scope:**` and `**Prohibited paths:**` blocks of a task section and
collects the backticked paths. An agent that wants wider scope must change the
task, which is a change record, which is a human decision.

## Exact paths and directory prefixes only

No globs, no regular expressions. `SPEC-0002/CL-002` records the reason: a
pattern is too easy to write broadly enough to authorise everything, and a
wildcard under a source root reads as a narrow declaration while behaving as a
total one.

`matchesScope` therefore accepts a path when it equals a declared entry, or
sits under a declared entry treated as a directory. `UT-143` pins the edges:

| Changed file | Declared | Matches |
|---|---|---|
| `src/export/a.ts` | `src/export/` | yes |
| `src/export/a.ts` | `src/export` | yes |
| `src/exports/a.ts` | `src/export/` | **no** |
| `src/exporter.ts` | `src/export` | **no** |
| the same path with Windows separators | `src/export/` | yes |
| anything | nothing declared | **no** |

The two "no" rows are the ones a naive prefix comparison gets wrong. The last
row is the fail-closed default: an empty scope authorises nothing.

The Windows-separator row matters on this repository specifically. Paths reach
the checker from git in POSIX form and from the filesystem in native form, and
a checker that missed the difference would pass every file on a developer
workstation.

## Path safety

`unsafeScopeReason` returns a named reason rather than a boolean, so a refusal
can be reported precisely. It rejects an empty or over-long path, a null byte,
an absolute path, a Windows drive letter, any traversal segment, anything
resolving outside the repository, and a symbolic link whose real path escapes.
`UT-142` exercises six of these; `UT-126` confirms an escaping path surfaces
as `SDD-V056` through `scopeFindings`.

## Prohibited beats allowed

A prohibited path wins even when it sits inside an allowed prefix, and is
reported once as `SDD-V058` rather than twice. `UT-128` asserts both halves: a
file under allowed `src/export/` and prohibited `src/export/legacy/` produces
`SDD-V058` and not `SDD-V046`.

Reporting it once matters. A file listed under two rules invites the reader to
resolve the more convenient one.

## git invocation

`gitChangedFiles` and `gitStatusPaths` call `execFileSync` on git with a fixed
argument array, no shell, a 20-second timeout and an 8 MiB buffer. Refs are
screened by `isSafeRef` first, which refuses anything beginning with a dash;
`UT-144` covers an upload-pack style argument. There is no shell anywhere in
the path, so a ref cannot become a command.

**Result:** scope is derived from the approved task, matched conservatively,
and enforced fail-closed.
