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

## Result against the production bundle — all four acceptance criteria met

Run 11 November against the **production build** (`next build`, standalone
server), in WebKit, at iPhone dimensions, on an isolated database:

| Acceptance criterion             | Result                                                  |
| -------------------------------- | ------------------------------------------------------- |
| Saved data persists exactly once | **Yes.** One `POST /api/v1/leads`, one `PATCH`, one row |
| The screen remains visible       | **Yes.** Every step reported `blank: false`             |
| Navigation keeps working         | **Yes.** Away to Leads, back to the lead, both rendered |
| No restart required              | **Yes.** No force-close, no reload needed               |

Tag persistence confirmed in the database rather than from the page, after the
probe's own text check gave a false negative:

```
       fullName        |   phone    |           tags
-----------------------+------------+---------------------------
 WebKit Probe mwbqxd9p | 0579003107 | {vip,investor,wkmwbqxd9p}
 WebKit Probe mwbqwhi4 | 0578962002 | {vip,investor,wkmwbqwhi4}
 WebKit Probe mwbq1gte | 0577522297 | {vip,investor,wkmwbq1gte}
     … six runs, every one carrying its tags
```

**The reported defect did not reproduce on the production bundle in Safari's
engine.** That is a result, not a conclusion: it does not mean the defect is
absent on the device, where the network, the WKWebView process model and a real
thumb's timing all differ.

## The correctly configured HTTPS run, and both timings

Run against the **unmodified** production bundle — `NODE_ENV=production`, secure
cookies intact, HSTS and CSP intact, `APP_URL` equal to the browser origin
(`https://localhost:3443`), no header stripping and no patched build output.

|                           | **settled** (save completes, then navigate) | **immediate** (navigate while the save is in flight) |
| ------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Screen blank at any step  | **No**                                      | **No**                                               |
| Navigation away           | Leads rendered                              | Leads rendered                                       |
| Navigation back           | lead rendered                               | lead rendered                                        |
| Tags persisted            | yes                                         | **yes**                                              |
| Writes to `/api/v1/leads` | `POST`, `PATCH` — **one each**              | `POST`, `PATCH`, **`PATCH`**                         |

**The immediate variant sends the tag save twice.** One tap, two `PATCH`
requests to the same lead. The end state is correct and the screen never
blanks, but "each save must persist exactly once" is not satisfied by a journey
that issues two writes.

This is the clearest behavioural difference the two timings produce, it is on
the exact reported journey, and it appears only when the user navigates before
the save returns — which is what a thumb does.

**Not yet attributed.** `patchLead` sends through `sendLater`, the offline
outbox, so the second write may be that queue retrying a request the navigation
cancelled — by design and converging on the same value — or it may be a genuine
double submit. Those are different defects with different fixes and the
difference has not been established. It is written down here rather than
guessed at.

## What the harness could not settle

The `Fetch API cannot load … due to access control checks` errors are **not**
the application. Eliminated across six configurations:

| Variable removed                               | Errors still present?                    |
| ---------------------------------------------- | ---------------------------------------- |
| CSP stripped entirely                          | **Yes** — 26, against 15 with it present |
| TLS removed (plain HTTP)                       | **Yes**                                  |
| Proxy removed (direct to the server)           | **Yes**                                  |
| Dev bundle instead of production               | **Yes**                                  |
| `APP_URL` made equal to the browser origin     | **Yes**                                  |
| **WebKit replaced by Chromium, same endpoint** | **No — zero**                            |

Same server, same certificate, same CSP, same origin, same bundle: 15+ in
WebKit, **0** in Chromium. The variable is the engine, and since every
application-side variable has been removed, this is Playwright's WebKit build
rather than the product.

One argument says it cannot be the product: if iOS WebKit genuinely refused
every RSC fetch, **every** navigation in the app would be a full page load for
every iPhone user, always — not an intermittent fault. The reporter's app works
most of the time, so the real iOS WebKit is completing these fetches.

That reasoning is not proof. Real Safari is the only thing that settles it.

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

| Candidate                                             | Verdict                 | How                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A failed write                                        | **No**                  | The lead and the tags are in the database; one POST, one PATCH, both 200                                                                                                                 |
| The service worker                                    | **No**                  | `public/sw.js` answers only `navigate`-mode requests; an RSC payload is not one                                                                                                          |
| A missing page error boundary                         | **No**                  | `app/error.tsx` exists and renders a panel                                                                                                                                               |
| **No `global-error.tsx`**                             | **No**                  | A client error thrown above `app/error.tsx` is caught by Next 16's own default — "This page couldn't load", with Reload and Back. Not blank.                                             |
| **The Content-Security-Policy**                       | **No, twice**           | Stripping the header entirely left the failures in place — 26 of them with CSP removed against 15 with it present. Tested over TLS and over plain HTTP, through a proxy and direct.      |
| **The RSC "access control checks" errors themselves** | **The harness**         | They track the proxy and origin configuration, not the application. The journey met every acceptance criterion **despite** them, because Next's fallback navigation recovered each time. |
| `push()` racing `refresh()` on create                 | **Was real, now fixed** | Two overlapping fetches of one URL, measured at 1848ms and 535ms; one fetch now                                                                                                          |

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
