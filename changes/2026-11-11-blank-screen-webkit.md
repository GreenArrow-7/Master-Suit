# The blank screen, reproduced in Safari's engine for the first time

## What

A WebKit probe of the two reported journeys against a seeded workspace, at
iPhone dimensions, carrying the app's own user agent. WebKit is the engine
Safari and iOS WKWebView use, and a different engine from the Chromium every
other test here runs in.

Both journeys complete. The step after them does not:

```
── navigate away
  [requestfailed]  GET /…/sales/leads/<id>?_rsc=… — Load request cancelled
  [console.error]  Failed to fetch RSC payload for /…/sales/leads/<id>.
                   Falling back to browser navigation. TypeError: Load failed
  Navigation to "/…/sales/leads" is interrupted by another navigation to
  "/…/sales/leads/<id>"
```

The tag save's `router.refresh()` is still in flight; navigating away cancels
it; Next cannot tell a cancellation from a failure and does a **full browser
navigation back to the page it was fetching**, which overrides where the user
was going.

Findings and evidence: [docs/qa/BLANK-SCREEN-WEBKIT.md](../docs/qa/BLANK-SCREEN-WEBKIT.md).

## Why

Fifteen attempts in Chromium at phone dimensions found nothing, which is now
explained: the viewport was right and **the engine was wrong**. The same journey
in Chromium produces no RSC failure and no fallback.

Four candidates were eliminated by experiment rather than by argument, including
two this project's own earlier reports listed as live:

- **No `global-error.tsx` leaves a blank page** — disproven. A client error
  thrown above `app/error.tsx` is caught by Next 16's own default page, with
  working Reload and Back buttons.
- **The Content-Security-Policy blocks the RSC fetch** — disproven. Stripping
  the header at a proxy left every failure in place.

## Where

- `apps/web/webkit-probe.mjs` — the probe. Standalone, takes a base URL and
  credentials, prints what it saw.
- `docs/qa/BLANK-SCREEN-WEBKIT.md` — the findings, the eliminations, the two
  harness artefacts that are **not** the product, and the device test.

## Behaviour

No application change. This is an investigation, and the cause is not yet proven
enough to fix.

## Verified

The probe runs end to end and reports: one `POST /api/v1/leads` per create, one
`PATCH` per tag save, both answered 200, neither screen blank, and the
cancellation-plus-fallback above on the step after.

## Left open

- **It is not proven to be the reported defect.** No permanently blank screen
  was produced, and nothing has been seen on the device. The document says so in
  those words.
- **`experimental.appNavFailHandling` was not enabled.** It exists in Next
  16.4.2 and governs how the router handles a failed app navigation. Turning on
  an experimental framework flag in production on the strength of its name is
  the guess this work exists to avoid.
- **The production bundle cannot be driven in WebKit here.** It needs a trusted
  certificate: WebKit refuses `fetch()` to an untrusted host even when
  navigation errors are ignored, and over plain HTTP the production build's
  `secure` session cookie is never returned. `scripts/make-local-tls.sh` makes
  the certificate; importing its CA is a machine-level change and was not made.
