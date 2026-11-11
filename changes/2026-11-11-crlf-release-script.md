# A release script with CRLF does not run, and I wrote one

## What

`docs/release/production-release.sh` was committed with CRLF on all 202 lines.
The production release stopped at:

```
bash\r: No such file or directory
```

The script was correct. Its syntax was valid. It could not start.

Normalised to LF, `.gitattributes` added to pin it for everyone, and
`tests/unit/shell-line-endings.spec.ts` added so CI catches the next one
instead of a production host.

## Why

**I introduced it**, and the history says exactly when:

| Commit                               | CR characters | Lines |
| ------------------------------------ | ------------- | ----- |
| `83d9a85e`                           | **0**         | 157   |
| `0fdd34d0` — the release-gate repair | **202**       | 202   |
| `HEAD`                               | 202           | 202   |

I edited that file with a Python script on Windows using
`io.open(path, 'w', encoding='utf-8')`. Python's text mode translates `\n` to
the platform line separator on write, so every line gained a carriage return.
`core.autocrlf` is `false` in this checkout, so nothing normalised it on the way
into git, and the broken file shipped.

The failure mode is unkind. The kernel reads the shebang `#!/usr/bin/env bash\r`
and looks for an interpreter literally named `bash\r`. The message names
neither the file nor the real problem, and every other explanation — a missing
bash, a bad path, a permissions error — looks more plausible than the truth.

Only this one file was affected. Every other tracked `.sh` was already LF, and
`git add --renormalize .` after the change staged nothing else.

## Where

- `docs/release/production-release.sh` — CRLF removed, content untouched.
- `.gitattributes` — **new**. `* text=auto` plus `eol=lf` pinned on `*.sh`,
  `*.bash`, `*.mjs`, `*.cjs` and Dockerfiles: things run by a shell or a kernel
  shebang on a Linux host, whatever platform they were edited on.
- `apps/web/tests/unit/shell-line-endings.spec.ts` — **new**.

`core.autocrlf` is per-clone and could not have prevented this for everyone.
`.gitattributes` travels with the repository.

## Behaviour

The release script runs. Nothing else changes — the diff is line endings only,
and `bash -n` is clean.

## Verified

- `bash -n docs/release/production-release.sh` — clean; CR count 0; still 202
  lines, so nothing was lost.
- `tests/unit/shell-line-endings.spec.ts` — 2 passed, and **both fail when the
  CRLF is put back**, confirmed by re-adding it and re-running:
  `AssertionError: CRLF in: docs/release/production-release.sh`.
- The guard refuses to pass on an empty file list, so it cannot silently check
  nothing.

## Left open

This changes the release candidate. `6ca4e589` carries the broken script and
must not be released; the new candidate is the commit that follows this one,
and its images need building before preflight.

The `.gitattributes` rules apply from here on. A file already committed with
CRLF in some other branch stays that way until it is renormalised there — the
test is what will find it.
