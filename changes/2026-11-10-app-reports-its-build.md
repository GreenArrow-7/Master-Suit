# The phone app says which build it is

## What

`appendUserAgent` was the literal `YouhanOneApp/0.1.0-dev-poc`. It stayed that
through 1.2.0 and would have stayed it through every release after. It now
carries `MARKETING_VERSION` — read from the Xcode project, not duplicated — and
the build number, so a request says `YouhanOneApp/1.2.0+18`.

## Why

A field report on 9 November described defects on an iPhone, and the first
question was which build that iPhone was running. There was no way to answer it
from the server: the only thing the app told the server about itself was a
version string that had been wrong since before 1.2.0.

The number had to come from somewhere that cannot drift, so it is read out of
`App.xcodeproj/project.pbxproj` at sync time, and the sync is **refused** if it
is not there. A fallback would mean a build quietly reporting a version it does
not have, which is the fault being fixed. The build number is
`GITHUB_RUN_NUMBER`, the same value the workflow already stamps into
`CURRENT_PROJECT_VERSION`, and `local` off CI.

Nothing matches on the suffix: `isAppUserAgent` and `isIosAppUserAgent` both
match the `YouhanOneApp/` prefix. That is deliberate and now has a test, because
a suffix that changes every release is exactly the thing somebody will match on
by accident.

## Where

- `apps/mobile/capacitor.config.js` — `appendUserAgent` and the
  `marketingVersion()` that feeds it.
- `apps/web/tests/unit/ios-app-user-agent.spec.ts` — the samples carry a real
  version, and a new case proves recognition across four different ones.

## Behaviour

No change for anyone using the app. The App Store 3.1.1 gate, which hides
purchase paths inside the iOS app, keys on the prefix and is unaffected.

## Verified

- `node -e "require('./apps/mobile/capacitor.config.js')"` → `YouhanOneApp/1.2.0+local`.
- `tests/unit/ios-app-user-agent.spec.ts` — 10 passed, including the four
  version suffixes.

## Left open

This only helps **from the next build onwards**. The copy installed today still
reports `0.1.0-dev-poc`, so the build on the reporter's phone must still be read
from Settings → General → iPhone Storage, or from TestFlight.
