# The iOS package manifest resolves on a Mac again

**What** — `apps/mobile/ios/App/CapApp-SPM/Package.swift` had the push-notifications
package path written with Windows backslashes. Replaced with forward slashes by
running the project's own `scripts/fix-ios-spm-paths.mjs`. One line. No PR yet.

**Why** — a defect found while building the Android APK. Swift Package Manager
cannot resolve `..\..\..\node_modules\@capacitor\push-notifications`, so any iOS
build fails at dependency resolution — including the `ios-testflight.yml`
workflow, whose whole job is archiving on a macOS runner. `7053cadc` added the
normalising script and made the paths portable; `b3b41717` (the push-plugin
batch) re-broke them by committing raw `cap sync` output from Windows, which is
exactly what the script exists to prevent. The guard was not run.

**Where**

- `apps/mobile/ios/App/CapApp-SPM/Package.swift` — the one path. The file says
  "DO NOT MODIFY — managed by Capacitor CLI", and this is what the CLI writes on
  Windows; `npm run sync` produces the same corrected result.

**Behaviour** — nothing on Android, nothing a customer sees. An iOS build, in
Xcode or on the TestFlight runner, now resolves the package instead of failing.

**Verified** — `node scripts/fix-ios-spm-paths.mjs` reports "backslash paths
normalised", and a second run reports "paths already portable", so it is
idempotent and the committed state is now its fixed point. `cap sync` followed by
the script reproduces this file byte for byte. **Not built on a Mac** — there is
no Mac in this session, so that SPM now resolves is reasoned from the path, not
observed.

**Left open** — nothing stops the next Windows `cap sync` commit from re-breaking
it. The script is wired into `npm run sync` only, so it is skipped by anyone who
runs `cap sync` directly. A CI check asserting no backslash appears in a
`path:` in this file would close that, and is deliberately not in this change.
