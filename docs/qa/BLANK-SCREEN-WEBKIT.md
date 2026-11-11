# The blank screen, in Safari's engine

Written 11 November 2026. Everything below was observed; nothing is inferred
from a name or a comment.

## What was run

The two reported journeys, in **WebKit** — the engine Safari and iOS WKWebView
use, and a different engine from the Chromium everything else here is tested in
— at iPhone 13 dimensions, carrying the app's own user agent
(`YouhanOneApp/1.2.0+18`), against a seeded database, with every console
message, page error, failed request, 4xx response body and API write recorded.

The probe is `apps/web/webkit-probe.mjs`.

## The finding

Both journeys **complete**. Neither blanks.

```
── create a lead and save
  state: {"url":"/…/sales/leads/cmwbq1qcz00n07shzjd67tdor", "heading":"WebKit Probe …", "blank":false}
  writes this step: ["POST /api/v1/leads"]          ← exactly one

── edit details, change tags, save
  [save] PATCH answered 200
  state: {"url":"/…/sales/leads/cmwbq1qcz00n07shzjd67tdor", "blank":false}
  writes this step: ["PATCH /api/v1/leads/cmwbq1qcz…"]   ← exactly one
```

**The third step is where it goes wrong.** Navigating away immediately after
the tag save:

```
── navigate away
  [requestfailed]  GET /…/sales/leads/cmwbq1qcz…?_rsc=ITFZqvlvOI7ZIdXo — Load request cancelled
  [console.error]  Failed to fetch RSC payload for /…/sales/leads/cmwbq1qcz… .
                   Falling back to browser navigation. TypeError: Load failed
  [requestfailed]  GET /…/sales/leads — Load request cancelled

  Navigation to "/…/sales/leads" is interrupted by another navigation to
  "/…/sales/leads/cmwbq1qcz…"
```

Read in order, that is:

1. The tag save calls `router.refresh()` (`LeadDetail.tsx:302`), which starts an
   RSC fetch for the lead page.
2. The user navigates somewhere else before it returns.
3. WebKit cancels the in-flight fetch — correct, the page is leaving.
4. Next.js cannot tell a cancellation from a failure, so it does what it does on
   a failed RSC fetch: **a full browser navigation back to the page it was
   fetching.**
5. That hard navigation **interrupts the navigation the user asked for.**

So after saving, a tap on another screen can be overridden by a full page load
back to the lead. On a phone a full load is a white screen for its duration, and
the destination is the page the user was trying to leave. Tap again, save again,
same thing.

**This has not been proven to be the reported defect.** It was not reproduced as
a permanently blank screen, and it has not been seen on the device. It is the
first mechanism found that is specific to Safari's engine, lands on the exact
reported journey, and produces a white screen plus a navigation that does not go
where it was told.

## Why Chromium never showed it

The same journey in Chromium produces no RSC failure and no fallback. Chromium
either completes the fetch first or discards the cancellation quietly. That is
why fifteen attempts in a Chromium at phone dimensions found nothing: **the
viewport was right and the engine was wrong.**

## What is NOT the cause — each eliminated by experiment

| Candidate                             | Verdict                 | How                                                                                                                                          |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A failed write                        | **No**                  | The lead and the tags are in the database; one POST, one PATCH, both 200                                                                     |
| The service worker                    | **No**                  | `public/sw.js` answers only `navigate`-mode requests; an RSC payload is not one                                                              |
| A missing page error boundary         | **No**                  | `app/error.tsx` exists and renders a panel                                                                                                   |
| **No `global-error.tsx`**             | **No**                  | A client error thrown above `app/error.tsx` is caught by Next 16's own default — "This page couldn't load", with Reload and Back. Not blank. |
| **The Content-Security-Policy**       | **No**                  | Stripping `content-security-policy` at the proxy left all 12 fetch failures in place                                                         |
| `push()` racing `refresh()` on create | **Was real, now fixed** | Two overlapping fetches of one URL, measured at 1848ms and 535ms; one fetch now                                                              |

## Two things in the log that are the harness, not the product

Both are recorded so nobody chases them later.

- **`Fetch API cannot load … due to access control checks`** over TLS: WebKit
  refuses `fetch()` to a host whose certificate it does not trust, even when
  navigation errors are ignored. A self-signed certificate therefore breaks
  every RSC fetch in a way that looks exactly like an application fault.
- **A blank dashboard over plain HTTP against the production bundle**: the
  production build sets `secure: true` on the session cookie, so a browser
  never returns it over HTTP and every page renders unauthenticated.
  `playwright.config.ts` says this already.

Testing the **production bundle** in WebKit therefore needs a **trusted**
certificate. `apps/web/scripts/make-local-tls.sh` creates one, and its CA has to
be imported into the operating system's trust store — a machine-level change,
not made here.

## The device test, and what it should show

One action, with a prediction — worth more than a list of checks:

1. On the iPhone, open a lead.
2. **More ▾ → Edit details**, change the tags, **Save**.
3. **Within about a second of the save**, tap **Leads** (or any other item) in
   the bottom bar.

If this is the defect: the screen goes white and you end up **back on the lead
you were leaving**, not on Leads. Try it two or three times — it depends on
whether the refresh has returned, so it will not happen every time.

Then the control: do the same, but **wait three seconds** after Save before
tapping. If that is reliably fine and the fast version is not, this is it.

If instead the screen stays blank permanently and the app must be killed, that
is something else and this document is wrong about the cause.

## The candidate fix, not applied

`next.config.ts` does not set `experimental.appNavFailHandling`, which exists in
Next 16.4.2 and governs how the router handles a failed app navigation. It is a
candidate and nothing more: **it has not been enabled**, because turning on an
experimental framework flag in production on the strength of its name is the
kind of guess this investigation exists to avoid. It should be read, tried
against this probe, and only then considered.

The other direction is the application's own: `patchLead` refreshes
fire-and-forget, and an edit that does not need the whole page re-rendered
should not ask for one.
