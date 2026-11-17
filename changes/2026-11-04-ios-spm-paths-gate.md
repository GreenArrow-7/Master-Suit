# CI refuses a Windows iOS package manifest

**What** — a `--check` mode on the existing `fix-ios-spm-paths.mjs`, an
`check:ios-paths` script, and CI gate 3c-ii that runs it. No new file. No PR yet.

**Why** — the previous change fixed the backslash paths but left nothing to stop
the next regression, and this has regressed once already: `7053cadc` made the
paths portable and added the normaliser, `b3b41717` re-broke them. The
normaliser only runs as part of `npm run sync`, so anyone running `cap sync`
directly reintroduces the fault, in a file whose header says "DO NOT MODIFY —
managed by Capacitor CLI" and which nobody therefore reads in review. The cost
is every iOS build, `ios-testflight.yml` included.

**Where**

- `apps/mobile/scripts/fix-ios-spm-paths.mjs` — `--check` writes nothing and
  exits 1. Write mode is unchanged, so `npm run sync` behaves exactly as before.
- `apps/mobile/package.json` — `check:ios-paths`.
- `.github/workflows/ci.yml` — gate 3c-ii, after the observability gate. Needs
  `working-directory: apps/mobile` because the workflow defaults to `apps/web`.
  No `npm ci`: the script imports only Node builtins.

**Behaviour** — nothing at runtime. A PR carrying a manifest with a backslash in
a `path:` now fails CI with the command that fixes it, instead of reaching a Mac.

**Verified** — on the fixed tree the gate exits 0; restoring the manifest from
`39956898` (the `b3b41717` state) makes it exit 1 with the message, **so it fails
on the old code**, and the file is unchanged afterwards, confirming `--check`
never writes. Write mode then restored the manifest to its committed bytes.
`ci.yml` parses and the step resolves with the right working directory.
**The gate has not run on a GitHub runner** — nothing is pushed.

**Left open** — the gate reads one file in one package. A second Capacitor
plugin would add another `path:` to the same manifest, which this still covers;
a second manifest would not be seen. Good enough until there is one.
