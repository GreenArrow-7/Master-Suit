# The reported journey, as a test that runs in Safari's engine

## What

`apps/web/tests/e2e/lead-save-navigate.spec.ts`, and a `webkit-journey`
Playwright project that runs **only** that file at iPhone 13 dimensions.
On `diagnostics/on-lead-release`.

## Why

The reported fault is a blank screen after saving a lead and moving straight
on. Everything that had been written about it was either a desktop Chromium
run or a one-off probe script. This puts the journey itself into the suite:

    create a lead → edit it → Save → navigate at once → the destination loads
    → reopen it → what was typed is what is stored

The part that matters is "at once". `click()` resolves on the click, not on
the request it starts, so the navigation begins while the PATCH is still open —
which is what a thumb does and what a settled test never exercises.

## Where

- `tests/e2e/lead-save-navigate.spec.ts` — the journey, `JOURNEY_ROUNDS`
  (default 5) times per run.
- `playwright.config.ts` — the `webkit-journey` project. Scoped to this one
  spec: running the whole suite twice would cost half an hour a run and add no
  coverage of anything else.

## Behaviour

Three things are asserted per round: the destination renders something, the
stored tags match what was typed, and the save is **one** save.

That last one is asserted on the request key, not the request count.
`sendOrQueue` mints one id per write and sends it as `idempotency-key`; a
request the navigation cancels is kept and goes again under that same id, and
the server replays it. So two PATCHes under one key is the outbox converging,
and two PATCHes under two keys is a double submit — different defects with
different fixes, and counting requests cannot tell them apart. That is why
`docs/qa/BLANK-SCREEN-WEBKIT.md` could not attribute the duplicate it saw.

## Verified

**6 rounds, WebKit at iPhone 13 dimensions**, against the dev server:

```
round 1: 1 PATCH request(s), 1 distinct key(s), 0 replayed, statuses 200
… rounds 2-6 identical
```

Every round: destination rendered, tags correct, one PATCH. Chromium green too.

**The duplicate did not recur**, so it is still not attributed — it was seen
against the production bundle over HTTPS with a different navigation. What has
changed is that the next occurrence will say which of the two it is instead of
leaving it open.

**This is browser evidence, not device evidence.** The journey has now been
driven in Safari's engine at phone dimensions and does not fail there. The
iPhone is still the only thing that settles it.

## Three things found while building it, worth not forgetting

- `source: 'WALK_IN'` is not a valid lead source — the enum is MANUAL,
  QUICK_CREATE, IMPORT, PUBLIC_FORM, LANDING_PAGE, API, WEBHOOK, REFERRAL.
  The same wrong value was in `docs/release/staging-acceptance.sh` and is
  corrected on that branch.
- An account made by `createWorkspaceUser` has `passwordChangedAt` null, which
  counts as an administrator-issued temporary password and redirects every
  navigation to the password screen.
- The sidebar's "Leads" link reports as visible on a phone viewport while
  refusing a tap — the sidebar is off-canvas. The journey taps the record's own
  `← Leads` back link, which is what a person taps anyway.

## WebKit is opt-in, and why

CI installs chromium only, deliberately — the comment above that step says
`--with-deps` shells out to apt-get, which this runner avoids. A project CI
cannot launch would fail every run for a reason unrelated to the code, so the
`webkit-journey` project only exists when `RUN_WEBKIT_JOURNEY=yes`:

```
npx playwright install webkit
RUN_WEBKIT_JOURNEY=yes npx playwright test --project=webkit-journey
```

The journey itself still runs on **every** CI run under chromium, which has no
`testMatch` and picks it up. Verified both ways: `--list` shows chromium alone
without the flag and both projects with it.

## Left open

The fixture signs in through the API rather than the form, because `fill` does
not land in the email field under WebKit with iPhone emulation: it posts an
empty string and the server answers 422, while the same credentials return 200
on the API and the form works in Chromium. That is almost certainly a harness
interaction — nobody could sign in on a real iPhone otherwise — but it is
written down rather than silently worked around.
